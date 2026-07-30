import {describe, it, expect, vi} from 'vitest';
import {run_native, installed_versions} from '../../skills/adapter-native';
import {host_by_id} from '../../skills/hosts';
import {PACKS_FALLBACK, resolve_packs} from '../../skills/packs';
import type {Detected_host} from '../../skills/detect';
import type {Run_result, Runner} from '../../skills/types';

const ok = (stdout = ''): Run_result=>({code: 0, stdout, stderr: ''});
const fail = (stderr = 'boom'): Run_result=>({code: 1, stdout: '', stderr});

const claude = (bin?: string): Detected_host=>
    ({def: host_by_id('claude-code'), bin: bin ?? '/usr/bin/claude', config_dir: '/home/a/.claude'});
const claude_no_bin = (): Detected_host=>
    ({def: host_by_id('claude-code'), bin: undefined, config_dir: '/home/a/.claude'});
const codex = (): Detected_host=>
    ({def: host_by_id('codex'), bin: 'C:\\codex.exe', config_dir: 'C:\\Users\\a\\.codex'});

const all = resolve_packs([], PACKS_FALLBACK);
const core_only = resolve_packs(['core'], PACKS_FALLBACK);
const adapter = resolve_packs(['adapter'], PACKS_FALLBACK);

// `claude plugin list --json` shape, trimmed to what the adapter reads.
const claude_list = (packs: {name: string; version: string}[]): string=>JSON.stringify({
    plugins: packs.map(p=>({name: p.name, marketplace: 'reply-skills', version: p.version, enabled: true})),
});

const runner_of = (results: Run_result[]): {run: Runner; calls: string[][]}=>{
    const calls: string[][] = [];
    let i = 0;
    const run: Runner = async(bin, args)=>{
        calls.push([bin, ...args]);
        return results[i++] ?? ok();
    };
    return {run, calls};
};

describe('installed_versions', ()=>{
    it('maps pack name to version from the host list', async()=>{
        const {run} = runner_of([ok(claude_list([{name: 'ai-sdr-core', version: '0.1.0'}]))]);
        expect(await installed_versions(claude(), run)).toEqual({'ai-sdr-core': '0.1.0'});
    });

    it('returns an empty map when the host prints nothing usable', async()=>{
        const {run} = runner_of([ok('not json')]);
        expect(await installed_versions(claude(), run)).toEqual({});
    });
});

describe('run_native install', ()=>{
    it('registers the marketplace once, then installs core first', async()=>{
        const {run, calls} = runner_of([ok(), ok(claude_list([])), ok(), ok(), ok()]);
        const outcome = await run_native({operation: 'install', host: claude(), packs: all, scope: 'user', run});
        expect(calls[0]).toEqual(['/usr/bin/claude', 'plugin', 'marketplace', 'add', 'reply-team/reply-skills']);
        expect(calls.slice(2).map(c=>c[3])).toEqual([
            'ai-sdr-core@reply-skills', 'reply-adapter@reply-skills', 'agentic-runtime@reply-skills',
        ]);
        expect(outcome.status).toBe('ok');
        expect(outcome.packs?.map(p=>p.action)).toEqual(['installed', 'installed', 'installed']);
    });

    it('passes the scope through', async()=>{
        const {run, calls} = runner_of([ok(), ok(claude_list([])), ok()]);
        await run_native({operation: 'install', host: claude(), packs: core_only, scope: 'project', run});
        expect(calls[2]).toContain('--scope');
        expect(calls[2]).toContain('project');
    });

    it('reports a pack already at the target version as current and runs no install', async()=>{
        const {run, calls} = runner_of([ok(), ok(claude_list([{name: 'ai-sdr-core', version: '0.1.0'}]))]);
        const outcome = await run_native({operation: 'install', host: claude(), packs: core_only, scope: 'user', run});
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'current', version: '0.1.0'}]);
        expect(calls).toHaveLength(2);
    });

    it('reports an older installed version as upgraded and records where it came from', async()=>{
        const {run} = runner_of([ok(), ok(claude_list([{name: 'ai-sdr-core', version: '0.0.9'}])), ok()]);
        const outcome = await run_native({operation: 'install', host: claude(), packs: core_only, scope: 'user', run});
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'upgraded', version: '0.1.0', from: '0.0.9'}]);
    });

    it('never attempts a dependent pack when its dependency failed', async()=>{
        const {run, calls} = runner_of([ok(), ok(claude_list([])), fail('core exploded')]);
        const outcome = await run_native({operation: 'install', host: claude(), packs: adapter, scope: 'user', run});
        expect(calls).toHaveLength(3);
        expect(outcome.status).toBe('failed');
        expect(outcome.packs?.map(p=>[p.name, p.action])).toEqual([['ai-sdr-core', 'failed']]);
        expect(outcome.hint).toContain('ai-sdr-core');
    });

    it('is partial when an independent pack fails but the core succeeded', async()=>{
        const {run} = runner_of([ok(), ok(claude_list([])), ok(), fail(), ok()]);
        const outcome = await run_native({operation: 'install', host: claude(), packs: all, scope: 'user', run});
        expect(outcome.status).toBe('partial');
        expect(outcome.packs?.map(p=>p.action)).toEqual(['installed', 'failed', 'installed']);
    });

    it('skips a host whose binary could not be resolved, with a fix', async()=>{
        const {run, calls} = runner_of([]);
        const outcome = await run_native({operation: 'install', host: claude_no_bin(), packs: all, scope: 'user', run});
        expect(outcome.status).toBe('skipped');
        expect(outcome.reason).toBe('cli-not-resolved');
        expect(outcome.hint).toContain('PATH');
        expect(calls).toEqual([]);
    });

    it('fails the host when marketplace registration fails', async()=>{
        const {run, calls} = runner_of([fail('no network')]);
        const outcome = await run_native({operation: 'install', host: claude(), packs: all, scope: 'user', run});
        expect(outcome.status).toBe('failed');
        expect(outcome.detail).toContain('no network');
        expect(calls).toHaveLength(1);
    });

    it('uses the Codex verb spelling', async()=>{
        const {run, calls} = runner_of([ok('{}'), ok('{"installed":[]}'), ok('{}')]);
        await run_native({operation: 'install', host: codex(), packs: core_only, scope: 'user', run});
        expect(calls[0]).toEqual(['C:\\codex.exe', 'plugin', 'marketplace', 'add', 'reply-team/reply-skills', '--json']);
        expect(calls[2]).toEqual(['C:\\codex.exe', 'plugin', 'add', 'ai-sdr-core@reply-skills', '--json']);
    });

    it('reads installed versions from the Codex list shape', async()=>{
        const listing = JSON.stringify({installed: [{name: 'ai-sdr-core', version: '0.1.0', marketplaceName: 'reply-skills'}]});
        const {run} = runner_of([ok('{}'), ok(listing)]);
        const outcome = await run_native({operation: 'install', host: codex(), packs: core_only, scope: 'user', run});
        expect(outcome.packs?.[0].action).toBe('current');
    });

    it('changes nothing on --dry-run but still reports the plan', async()=>{
        const {run, calls} = runner_of([ok(claude_list([]))]);
        const outcome = await run_native({
            operation: 'install', host: claude(), packs: core_only, scope: 'user', run, dry_run: true,
        });
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'installed', version: '0.1.0'}]);
        expect(calls.map(c=>c.slice(1, 3))).toEqual([['plugin', 'list']]);
    });
});

describe('run_native remove', ()=>{
    it('removes dependents before their dependency', async()=>{
        const installed = claude_list([
            {name: 'ai-sdr-core', version: '0.1.0'}, {name: 'reply-adapter', version: '0.1.0'},
        ]);
        const {run, calls} = runner_of([ok(installed), ok(), ok()]);
        const outcome = await run_native({operation: 'remove', host: claude(), packs: adapter, scope: 'user', run});
        expect(calls.slice(1).map(c=>c[3])).toEqual(['reply-adapter@reply-skills', 'ai-sdr-core@reply-skills']);
        expect(outcome.packs?.map(p=>p.action)).toEqual(['removed', 'removed']);
    });

    it('ignores a pack that is not installed', async()=>{
        const {run, calls} = runner_of([ok(claude_list([]))]);
        const outcome = await run_native({operation: 'remove', host: claude(), packs: core_only, scope: 'user', run});
        expect(outcome.packs).toEqual([]);
        expect(calls).toHaveLength(1);
    });
});

describe('run_native list and update', ()=>{
    it('list reports installed versions without mutating anything', async()=>{
        const {run, calls} = runner_of([ok(claude_list([{name: 'ai-sdr-core', version: '0.0.9'}]))]);
        const outcome = await run_native({operation: 'list', host: claude(), packs: all, scope: 'user', run});
        expect(calls).toHaveLength(1);
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'upgraded', version: '0.1.0', from: '0.0.9'}]);
    });

    it('update runs the host update verb only for installed packs', async()=>{
        const {run, calls} = runner_of([ok(), ok(claude_list([{name: 'ai-sdr-core', version: '0.0.9'}])), ok()]);
        const outcome = await run_native({operation: 'update', host: claude(), packs: all, scope: 'user', run});
        expect(calls[2]).toEqual(['/usr/bin/claude', 'plugin', 'update', 'ai-sdr-core@reply-skills']);
        expect(outcome.packs?.map(p=>p.name)).toEqual(['ai-sdr-core']);
    });
});
