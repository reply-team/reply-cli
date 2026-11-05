import {execFile} from 'child_process';
import {OLD_MARKETPLACE} from './packs';
import type {Detected_host} from './detect';
import type {Runner, Run_result, Scope} from './types';

// The plugins an earlier version of this CLI installed through a host's own
// plugin CLI (Claude Code, Codex). This CLI installs nothing that way any
// more: it only lists those plugins, so `list` and `remove` still reach them,
// and removes one when the copy from the package replaces it.

const default_runner: Runner = (bin, args)=>new Promise<Run_result>(resolve=>{
    execFile(bin, args, {encoding: 'utf8', windowsHide: true}, (error, stdout, stderr)=>{
        const code = error && typeof (error as {code?: unknown}).code === 'number'
            ? (error as unknown as {code: number}).code
            : (error ? 1 : 0);
        resolve({code, stdout: stdout ?? '', stderr: stderr ?? ''});
    });
});

type Listing_result = {ok: true; versions: Record<string, string>} | {ok: false; detail: string};

// Pack name → version, for the plugins of the old marketplace alone. Both
// hosts print a JSON listing, with different envelopes: Claude Code a direct
// array whose rows carry an `id` of the form "<pack>@<marketplace>" (older
// versions wrapped rows with `name` and `marketplace` in {plugins:[…]}), Codex
// {installed:[…]} with `marketplaceName`. A row is taken only when it names
// the old marketplace, so a plugin of the same name from anywhere else is
// never listed, and never removed. A row that names its scope (Claude Code's
// do) is taken only for the scope this run acts on.
const old_plugins = async(host: Detected_host, run: Runner, scope: Scope): Promise<Listing_result>=>{
    const cli = host.def.plugin_cli!;
    const result = await run(host.bin as string, cli.list_json());
    if (result.code !== 0)
    {
        return {ok: false, detail: (result.stderr || result.stdout).trim() || `exit code ${result.code}`};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(result.stdout);
    } catch {
        return {ok: false, detail: 'the plugin listing was not JSON'};
    }
    const doc = (parsed ?? {}) as Record<string, unknown>;
    const rows = (Array.isArray(parsed)
        ? parsed
        : [doc.plugins, doc.installed].find(Array.isArray) ?? []) as Record<string, unknown>[];
    const out: Record<string, string> = {};
    for (const row of rows)
    {
        const raw = (row?.name ?? row?.id) as unknown;
        if (typeof raw !== 'string' || typeof row.version !== 'string')
        {
            continue;
        }
        const at = raw.lastIndexOf('@');
        const name = at < 0 ? raw : raw.slice(0, at);
        const marketplace = at < 0 ? (row.marketplace ?? row.marketplaceName) : raw.slice(at + 1);
        if (marketplace === OLD_MARKETPLACE && (typeof row.scope !== 'string' || row.scope === scope))
        {
            out[name] = row.version;
        }
    }
    return {ok: true, versions: out};
};

const remove_plugin = async(
    host: Detected_host,
    run: Runner,
    id: string,
    scope: Scope,
): Promise<{ok: true} | {ok: false; detail: string}>=>{
    const result = await run(host.bin as string, host.def.plugin_cli!.remove(id, scope));
    return result.code === 0
        ? {ok: true}
        : {ok: false, detail: (result.stderr || result.stdout).trim() || `exit code ${result.code}`};
};

export {default_runner, old_plugins, remove_plugin};
export type {Listing_result};
