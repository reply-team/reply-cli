import {describe, it, expect, vi} from 'vitest';
import {run_native, installed_versions} from '../../skills/adapter-native';
import {host_by_id} from '../../skills/hosts';
import {PACKS_FALLBACK, resolve_packs} from '../../skills/packs';
import type {Detected_host} from '../../skills/detect';
import type {Pack, Run_result, Runner} from '../../skills/types';

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

// Claude Code's *current* `plugin list --json` shape: a direct array of rows
// with an `id` of the form "<pack>@<marketplace>" instead of separate `name`/
// `marketplace` fields. Captured for real from `claude plugin list --json`
// (Claude Code 2.1.220) on 2026-07-30, trimmed to the fields the adapter
// reads (`id`, `version`); the real output also carries `scope`, `enabled`,
// `installPath`, `installedAt`, `lastUpdated`, which installed_versions never
// looks at. Real row seen: {"id":"elastic-elasticsearch@elastic-agent-skills",
// "version":"0.2.4","scope":"user","enabled":true,...} — a plugin from a
// marketplace ('elastic-agent-skills') other than ours ('reply-skills').
const claude_list_direct = (rows: {id: string; version: string}[]): string=>JSON.stringify(
    rows.map(r=>({id: r.id, version: r.version, scope: 'user', enabled: true})),
);

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
        const result = await installed_versions(claude(), run);
        expect(result).toEqual({ok: true, versions: {'ai-sdr-core': '0.1.0'}});
    });

    it('returns failure when the host prints nothing usable', async()=>{
        const {run} = runner_of([ok('not json')]);
        const result = await installed_versions(claude(), run);
        expect(result).toEqual({ok: false});
    });

    it('reads installed versions from the direct-array id shape Claude Code now returns', async()=>{
        const {run} = runner_of([ok(claude_list_direct([{id: 'ai-sdr-core@reply-skills', version: '0.1.0'}]))]);
        const result = await installed_versions(claude(), run);
        expect(result).toEqual({ok: true, versions: {'ai-sdr-core': '0.1.0'}});
    });

    it('excludes a foreign-marketplace row in the direct-array id shape (real row, elastic-agent-skills)', async()=>{
        const {run} = runner_of([ok(claude_list_direct([
            {id: 'elastic-elasticsearch@elastic-agent-skills', version: '0.2.4'},
        ]))]);
        const result = await installed_versions(claude(), run);
        expect(result).toEqual({ok: true, versions: {}});
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
        expect(outcome.hint).toContain('reply-adapter');
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

    // C1 (final review): reverse order alone is not enough. A failed
    // `plugin uninstall reply-adapter` followed by a successful
    // `plugin uninstall ai-sdr-core` leaves the host with an adapter and no
    // core — the state this installer exists to prevent.
    it('never removes a dependency once removing a pack that depends on it failed', async()=>{
        const installed = claude_list([
            {name: 'ai-sdr-core', version: '0.1.0'}, {name: 'reply-adapter', version: '0.1.0'},
        ]);
        const {run, calls} = runner_of([ok(installed), fail('file is locked')]);
        const outcome = await run_native({operation: 'remove', host: claude(), packs: adapter, scope: 'user', run});
        // The listing, then the dependent's uninstall — and nothing else.
        expect(calls.slice(1).map(c=>c[3])).toEqual(['reply-adapter@reply-skills']);
        expect(outcome.packs).toEqual([
            {name: 'reply-adapter', action: 'failed', detail: 'file is locked'},
        ]);
        expect(outcome.status).toBe('failed');
        expect(outcome.hint).toContain('ai-sdr-core');
    });

    it('propagates the block down a dependency chain when the outermost removal failed', async()=>{
        const chain_a: Pack = {name: 'chainA', display_name: 'A', version: '1.0.0', description: '', dependencies: []};
        const chain_b: Pack = {name: 'chainB', display_name: 'B', version: '1.0.0', description: '', dependencies: ['chainA']};
        const chain_c: Pack = {name: 'chainC', display_name: 'C', version: '1.0.0', description: '', dependencies: ['chainB']};
        const listing = JSON.stringify({plugins: [chain_a, chain_b, chain_c].map(p=>
            ({name: p.name, marketplace: 'reply-skills', version: p.version}))});
        const {run, calls} = runner_of([ok(listing), fail('C is locked')]);
        const outcome = await run_native({
            operation: 'remove', host: claude(), packs: [chain_a, chain_b, chain_c], scope: 'user', run,
        });
        expect(calls.filter(c=>c[2] === 'uninstall').map(c=>c[3])).toEqual(['chainC@reply-skills']);
        expect(outcome.hint).toContain('chainB');
        expect(outcome.hint).toContain('chainA');
    });

    it('reports no hint and removes everything when nothing fails', async()=>{
        const installed = claude_list([
            {name: 'ai-sdr-core', version: '0.1.0'}, {name: 'reply-adapter', version: '0.1.0'},
        ]);
        const {run} = runner_of([ok(installed), ok(), ok()]);
        const outcome = await run_native({operation: 'remove', host: claude(), packs: adapter, scope: 'user', run});
        expect(outcome.packs?.map(p=>p.action)).toEqual(['removed', 'removed']);
        expect(outcome.status).toBe('ok');
        expect(outcome.hint).toBeUndefined();
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
        expect(calls[0]).toEqual(['/usr/bin/claude', 'plugin', 'marketplace', 'add', 'reply-team/reply-skills']);
        expect(calls[2]).toEqual(['/usr/bin/claude', 'plugin', 'update', 'ai-sdr-core@reply-skills']);
        expect(outcome.packs?.map(p=>p.name)).toEqual(['ai-sdr-core']);
    });

    it('update on Codex fires marketplace upgrade once for all installed packs', async()=>{
        const listing_before = JSON.stringify({installed: [
            {name: 'ai-sdr-core', version: '0.0.9', marketplaceName: 'reply-skills'},
            {name: 'reply-adapter', version: '0.0.8', marketplaceName: 'reply-skills'},
            {name: 'agentic-runtime', version: '0.0.7', marketplaceName: 'reply-skills'},
        ]});
        const listing_after = JSON.stringify({installed: [
            {name: 'ai-sdr-core', version: '0.1.0', marketplaceName: 'reply-skills'},
            {name: 'reply-adapter', version: '0.1.0', marketplaceName: 'reply-skills'},
            {name: 'agentic-runtime', version: '0.1.0', marketplaceName: 'reply-skills'},
        ]});
        const {run, calls} = runner_of([ok('{}'), ok(listing_before), ok('{}'), ok(listing_after)]);
        const outcome = await run_native({operation: 'update', host: codex(), packs: all, scope: 'user', run});
        expect(calls.filter(c=>c[1] === 'plugin' && c[2] === 'marketplace' && c[3] === 'upgrade')).toHaveLength(1);
        expect(outcome.packs?.map(p=>[p.name, p.action])).toEqual([['ai-sdr-core', 'upgraded'], ['reply-adapter', 'upgraded'], ['agentic-runtime', 'upgraded']]);
    });

    // I3 (final review): the marketplace path exits 0 whether or not anything
    // moved, and used to hardcode `upgraded`. On a machine with Claude Code
    // and Codex that printed "already current" and "updated" for one fact.
    it('update on Codex reports current when the marketplace upgrade moved nothing', async()=>{
        const listing = JSON.stringify({installed: [
            {name: 'ai-sdr-core', version: '0.1.0', marketplaceName: 'reply-skills'},
            {name: 'reply-adapter', version: '0.1.0', marketplaceName: 'reply-skills'},
        ]});
        // Same versions before and after — the upgrade succeeded, nothing moved.
        const {run} = runner_of([ok('{}'), ok(listing), ok('{}'), ok(listing)]);
        const outcome = await run_native({operation: 'update', host: codex(), packs: adapter, scope: 'user', run});
        expect(outcome.packs).toEqual([
            {name: 'ai-sdr-core', action: 'current', version: '0.1.0'},
            {name: 'reply-adapter', action: 'current', version: '0.1.0'},
        ]);
    });

    it('update on Codex reports current on --dry-run when every pack is already at the target version', async()=>{
        const listing = JSON.stringify({installed: [
            {name: 'ai-sdr-core', version: '0.1.0', marketplaceName: 'reply-skills'},
        ]});
        // A dry run registers no marketplace, so the listing is the first call.
        const {run} = runner_of([ok(listing)]);
        const outcome = await run_native({
            operation: 'update', host: codex(), packs: core_only, scope: 'user', run, dry_run: true,
        });
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'current', version: '0.1.0'}]);
    });

    it('update reports current when the host update verb exits 0 without moving the version', async()=>{
        // Registry target 0.1.0, host on 0.0.9, `plugin update` succeeds but
        // the post-update listing still says 0.0.9 — nothing changed, so the
        // report must not claim an upgrade happened.
        const stale = claude_list([{name: 'ai-sdr-core', version: '0.0.9'}]);
        const {run} = runner_of([ok(), ok(stale), ok(), ok(stale)]);
        const outcome = await run_native({operation: 'update', host: claude(), packs: core_only, scope: 'user', run});
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'current', version: '0.0.9'}]);
    });

    it('update reports current for pack already at target version', async()=>{
        const {run, calls} = runner_of([ok(), ok(claude_list([{name: 'ai-sdr-core', version: '0.1.0'}])), ok(claude_list([{name: 'ai-sdr-core', version: '0.1.0'}]))]);
        const outcome = await run_native({operation: 'update', host: claude(), packs: core_only, scope: 'user', run});
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'current', version: '0.1.0'}]);
        expect(calls).toHaveLength(2);
    });

    it('failed list on remove returns failed status with list-failed reason', async()=>{
        const {run, calls} = runner_of([fail('network error')]);
        const outcome = await run_native({operation: 'remove', host: claude(), packs: core_only, scope: 'user', run});
        expect(outcome.status).toBe('failed');
        expect(outcome.reason).toBe('list-failed');
        expect(outcome.detail).toContain('network error');
        expect(calls).toHaveLength(1);
    });

    it('failed list on update returns failed status with list-failed reason', async()=>{
        const {run, calls} = runner_of([ok(), fail('network error')]);
        const outcome = await run_native({operation: 'update', host: claude(), packs: core_only, scope: 'user', run});
        expect(outcome.status).toBe('failed');
        expect(outcome.reason).toBe('list-failed');
        expect(calls).toHaveLength(2);
    });

    it('failed list on list returns failed status with list-failed reason', async()=>{
        const {run, calls} = runner_of([fail('network error')]);
        const outcome = await run_native({operation: 'list', host: claude(), packs: all, scope: 'user', run});
        expect(outcome.status).toBe('failed');
        expect(outcome.reason).toBe('list-failed');
        expect(calls).toHaveLength(1);
    });

    it('plugin from different marketplace is treated as installed, not current', async()=>{
        const other_marketplace_list = JSON.stringify({plugins: [{name: 'ai-sdr-core', version: '0.1.0', marketplace: 'someone-else', enabled: true}]});
        const {run} = runner_of([ok(), ok(other_marketplace_list)]);
        const outcome = await run_native({operation: 'install', host: claude(), packs: core_only, scope: 'user', run});
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'installed', version: '0.1.0'}]);
    });

    it('same pack name from a different marketplace, in the direct-array id shape, is treated as installed, not current', async()=>{
        // Same pack name as ours but a foreign marketplace suffix on the id —
        // marketplace filtering must still apply in the new shape, not just the
        // old {plugins:[...]} envelope.
        const other_marketplace_list = claude_list_direct([{id: 'ai-sdr-core@someone-else', version: '0.1.0'}]);
        const {run} = runner_of([ok(), ok(other_marketplace_list)]);
        const outcome = await run_native({operation: 'install', host: claude(), packs: core_only, scope: 'user', run});
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'installed', version: '0.1.0'}]);
    });

    it('transitive dependency chain: A fails, B depends on A, C depends on B', async()=>{
        // Build a synthetic three-pack chain: chainA -> chainB -> chainC
        const chainA: Pack = {name: 'chainA', display_name: 'Chain A', version: '1.0.0', description: '', dependencies: []};
        const chainB: Pack = {name: 'chainB', display_name: 'Chain B', version: '1.0.0', description: '', dependencies: ['chainA']};
        const chainC: Pack = {name: 'chainC', display_name: 'Chain C', version: '1.0.0', description: '', dependencies: ['chainB']};
        const chain_packs = [chainA, chainB, chainC];
        const {run, calls} = runner_of([ok(), ok(claude_list([])), fail('A failed')]);
        const outcome = await run_native({operation: 'install', host: claude(), packs: chain_packs, scope: 'user', run});
        // Should have calls: marketplace add, list json, chainA install. No chainB or chainC install.
        const install_calls = calls.filter(c=>c[2] === 'install');
        expect(install_calls).toHaveLength(1);
        expect(install_calls[0][3]).toEqual('chainA@reply-skills');
        expect(outcome.status).toBe('failed');
        expect(outcome.hint).toContain('chainB');
        expect(outcome.hint).toContain('chainC');
    });

    it('failure that blocks nothing produces no hint', async()=>{
        // reply-adapter fails but nothing depends on it, so no hint
        const {run} = runner_of([ok(), ok(claude_list([])), ok(), fail(), ok()]);
        const outcome = await run_native({operation: 'install', host: claude(), packs: all, scope: 'user', run});
        expect(outcome.status).toBe('partial');
        expect(outcome.hint).toBeUndefined();
    });
});
