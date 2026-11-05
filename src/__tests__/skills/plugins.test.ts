import {describe, it, expect} from 'vitest';
import {host_by_id} from '../../skills/hosts';
import {old_plugins, remove_plugin} from '../../skills/plugins';
import type {Detected_host} from '../../skills/detect';
import type {Run_result, Runner} from '../../skills/types';

const ok = (stdout = ''): Run_result=>({code: 0, stdout, stderr: ''});
const fail = (stderr = 'boom'): Run_result=>({code: 1, stdout: '', stderr});

const claude = (): Detected_host=>
    ({def: host_by_id('claude-code'), bin: '/usr/bin/claude', config_dir: '/home/a/.claude'});
const codex = (): Detected_host=>
    ({def: host_by_id('codex'), bin: 'C:\\codex.exe', config_dir: 'C:\\Users\\a\\.codex'});

// The older `claude plugin list --json` shape, rows with `name` and
// `marketplace` wrapped in {plugins:[…]}.
const claude_list = (packs: {name: string; version: string; marketplace?: string}[]): string=>JSON.stringify({
    plugins: packs.map(p=>({
        name: p.name, marketplace: p.marketplace ?? 'reply-skills', version: p.version, enabled: true,
    })),
});

// Claude Code's current `plugin list --json` shape: a direct array of rows
// with an `id` of the form "<pack>@<marketplace>" and the scope the plugin
// was installed in. The foreign row is the shape of a real one, a plugin of a
// marketplace other than the one an earlier version of this CLI registered.
const claude_list_direct = (rows: {id: string; version: string; scope?: string}[]): string=>JSON.stringify(
    rows.map(r=>({id: r.id, version: r.version, scope: r.scope ?? 'user', enabled: true})),
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

describe('old_plugins', ()=>{
    it('maps pack name to version from the older wrapped shape', async()=>{
        const {run, calls} = runner_of([ok(claude_list([{name: 'ai-sdr-core', version: '0.1.0'}]))]);
        expect(await old_plugins(claude(), run, 'user')).toEqual({ok: true, versions: {'ai-sdr-core': '0.1.0'}});
        expect(calls).toEqual([['/usr/bin/claude', 'plugin', 'list', '--json']]);
    });

    it('reads the direct-array id shape Claude Code now returns', async()=>{
        const {run} = runner_of([ok(claude_list_direct([{id: 'reply-adapter@reply-skills', version: '0.3.0'}]))]);
        expect(await old_plugins(claude(), run, 'user')).toEqual({ok: true, versions: {'reply-adapter': '0.3.0'}});
    });

    it('takes no plugin of another marketplace, even one of the same name', async()=>{
        const {run} = runner_of([ok(claude_list_direct([
            {id: 'elastic-elasticsearch@elastic-agent-skills', version: '0.2.4'},
            {id: 'reply-adapter@somebody-else', version: '9.9.9'},
        ]))]);
        expect(await old_plugins(claude(), run, 'user')).toEqual({ok: true, versions: {}});
    });

    it('takes a row only for the scope this run acts on', async()=>{
        const listing = claude_list_direct([
            {id: 'reply-adapter@reply-skills', version: '0.3.0', scope: 'project'},
            {id: 'ai-sdr-core@reply-skills', version: '0.3.0', scope: 'user'},
        ]);
        const {run} = runner_of([ok(listing), ok(listing)]);
        expect(await old_plugins(claude(), run, 'user')).toEqual({ok: true, versions: {'ai-sdr-core': '0.3.0'}});
        expect(await old_plugins(claude(), run, 'project')).toEqual({ok: true, versions: {'reply-adapter': '0.3.0'}});
    });

    it('reads the Codex shape, whose rows name no scope', async()=>{
        const listing = JSON.stringify({installed: [
            {name: 'reply-adapter', version: '0.3.0', marketplaceName: 'reply-skills'},
            {name: 'other', version: '1.0.0', marketplaceName: 'elsewhere'},
        ]});
        const {run} = runner_of([ok(listing)]);
        expect(await old_plugins(codex(), run, 'user')).toEqual({ok: true, versions: {'reply-adapter': '0.3.0'}});
    });

    it('fails with the host\'s own words when the listing fails or is not JSON', async()=>{
        const {run} = runner_of([fail('not logged in'), ok('not json')]);
        expect(await old_plugins(claude(), run, 'user')).toEqual({ok: false, detail: 'not logged in'});
        expect(await old_plugins(claude(), run, 'user')).toEqual({ok: false, detail: 'the plugin listing was not JSON'});
    });
});

describe('remove_plugin', ()=>{
    it('removes one plugin through Claude Code, in the scope asked', async()=>{
        const {run, calls} = runner_of([ok(), ok()]);
        expect(await remove_plugin(claude(), run, 'reply-adapter@reply-skills', 'user')).toEqual({ok: true});
        expect(await remove_plugin(claude(), run, 'reply-adapter@reply-skills', 'project')).toEqual({ok: true});
        expect(calls).toEqual([
            ['/usr/bin/claude', 'plugin', 'uninstall', 'reply-adapter@reply-skills'],
            ['/usr/bin/claude', 'plugin', 'uninstall', 'reply-adapter@reply-skills', '--scope', 'project'],
        ]);
    });

    it('removes one plugin through Codex, with its own verb', async()=>{
        const {run, calls} = runner_of([ok()]);
        await remove_plugin(codex(), run, 'reply-adapter@reply-skills', 'user');
        expect(calls).toEqual([['C:\\codex.exe', 'plugin', 'remove', 'reply-adapter@reply-skills', '--json']]);
    });

    it('reports the host\'s words when removal fails', async()=>{
        const {run} = runner_of([fail('Plugin is locked by another process')]);
        expect(await remove_plugin(claude(), run, 'reply-adapter@reply-skills', 'user'))
            .toEqual({ok: false, detail: 'Plugin is locked by another process'});
    });
});
