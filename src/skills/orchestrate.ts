import {run_flat, status_of} from './adapter-flat';
import {default_detect_deps, select_hosts, type Detect_deps, type Detected_host} from './detect';
import {host_ids} from './hosts';
import {read_journal} from './journal';
import {PACK_NAME, RETIRED_PACKS, plugin_id, resolve_packs} from './packs';
import {default_runner, old_plugins, remove_plugin} from './plugins';
import {summarize} from './report';
import {cli_version} from '../config';
import type {Env} from '../config';
import type {
    Host_def, Host_outcome, Operation, Orphaned_packs, Pack, Pack_outcome, Report, Runner, Scope,
} from './types';

// The one flow all four commands share: detect hosts, resolve the pack, copy
// it into each host, and reach the plugins an earlier version installed
// through a host's own CLI. Every external dependency is injectable so the
// whole thing is testable offline.

type Skills_deps = {
    detect?: Detect_deps;
    run?: Runner;
    home?: string;
    cwd?: string;
    env?: Env;
    // The directory holding each pack's directory; the package's own
    // `skills` by default.
    source?: string;
};

type Skills_opts = {
    operation: Operation;
    requested: string[];
    agents?: string[];
    project: boolean;
    dry_run: boolean;
    deps?: Skills_deps;
};

const not_detected = (def: Host_def): Host_outcome=>({
    host: def.id, label: def.label, kind: def.kind, status: 'skipped', reason: 'not-detected',
    detail: `${def.label} was requested with --agent but is not installed on this machine`,
    verified: def.verified,
    needs_new_session: def.needs_new_session,
});

// Journal branches belonging to no host in the registry. Everything else here
// iterates hosts, so a retired assistant's packs go unreachable the moment its
// entry leaves hosts.ts — reading the journal directly is what still finds them.
const orphaned_packs = (env?: Env): Orphaned_packs[]=>{
    const known = new Set(host_ids());
    const orphans: Orphaned_packs[] = [];
    for (const [host, scopes] of Object.entries(read_journal(env).hosts))
    {
        if (known.has(host))
        {
            continue;
        }
        for (const [scope, packs] of Object.entries(scopes))
        {
            const entries = Object.entries(packs);
            if (!entries.length)
            {
                continue;
            }
            const files = entries.flatMap(([, entry])=>entry.files ?? []);
            orphans.push({
                host,
                scope: scope as Scope,
                packs: entries.map(([name])=>name),
                files: files.length,
                sample: files[0],
            });
        }
    }
    return orphans;
};

// Whether this run can ask the host's own CLI about the plugins an earlier
// version installed: the host has one, it resolved, and its plugins live in
// the scope this run acts on (Codex's are user-scoped only).
const reaches_plugins = (host: Detected_host, scope: Scope): boolean=>
    !!host.def.plugin_cli && !!host.bin && !(scope === 'project' && host.def.id === 'codex');

// The plugin rows `list` adds beside the copies, under the plugin's own id.
const listed_plugins = (packs: Pack[], plugins: Record<string, string>): Pack_outcome[]=>packs
    .filter(pack=>plugins[pack.name] !== undefined)
    .map(pack=>{
        const name = plugin_id(pack.name);
        const version = plugins[pack.name];
        if (pack.retired)
        {
            return {name, action: 'current', version, retired: true};
        }
        return version === pack.version
            ? {name, action: 'current', version}
            : {name, action: 'upgraded', version: pack.version, from: version};
    });

const run_host = async(
    opts: Skills_opts,
    host: Detected_host,
    packs: Pack[],
    scope: Scope,
    detect: Detect_deps,
): Promise<Host_outcome>=>{
    const deps = opts.deps ?? {};
    const run = deps.run ?? default_runner;
    const {operation, dry_run} = opts;
    const listing = reaches_plugins(host, scope) ? await old_plugins(host, run, scope) : undefined;
    const plugins = listing?.ok ? listing.versions : {};
    const copying = operation === 'install' || operation === 'update';
    const adopt: Record<string, string> = copying && plugins[PACK_NAME] !== undefined
        ? {[PACK_NAME]: plugins[PACK_NAME]}
        : {};

    const outcome = await run_flat({
        operation, host, packs, scope, dry_run, adopt,
        home: deps.home ?? detect.home, cwd: deps.cwd, env: deps.env, source: deps.source,
    });
    const rows = [...outcome.packs ?? []];
    const extra: Partial<Host_outcome> = {};

    if (copying)
    {
        // The old plugin goes only once the copy that replaces it is in
        // place, so a refused or failed copy never leaves the host with
        // neither.
        const copied = rows.find(p=>p.name === PACK_NAME);
        if (plugins[PACK_NAME] !== undefined && copied && copied.action !== 'failed')
        {
            const id = plugin_id(PACK_NAME);
            const removed = dry_run ? {ok: true as const} : await remove_plugin(host, run, id, scope);
            extra.old_plugin = removed.ok
                ? {id, action: 'removed'}
                : {id, action: 'failed', detail: removed.detail};
        }
        const retired = RETIRED_PACKS.filter(name=>plugins[name] !== undefined).map(plugin_id);
        if (retired.length)
        {
            extra.retired_plugins = retired;
        }
    }
    else if (operation === 'list')
    {
        rows.push(...listed_plugins(packs, plugins));
    }
    else
    {
        for (const pack of packs.filter(p=>plugins[p.name] !== undefined))
        {
            const id = plugin_id(pack.name);
            const removed = dry_run ? {ok: true as const} : await remove_plugin(host, run, id, scope);
            rows.push(removed.ok
                ? {name: id, action: 'removed', version: plugins[pack.name]}
                : {name: id, action: 'failed', detail: removed.detail});
        }
    }

    if (listing && !listing.ok && !outcome.hint)
    {
        extra.hint = `${host.def.label} did not list its plugins (${listing.detail}), so a`
            + ` ${plugin_id(PACK_NAME)} plugin an earlier version installed, if there is one, was not reached`;
    }
    // A copy that failed outright keeps its own status; anything else is
    // recomputed over the plugin rows too.
    const status = outcome.reason ? outcome.status : status_of(rows);
    return {...outcome, ...extra, packs: rows, status};
};

const run_skills = async(opts: Skills_opts): Promise<Report>=>{
    const deps = opts.deps ?? {};
    const detect = deps.detect ?? default_detect_deps();
    const packs = resolve_packs(opts.requested, opts.operation);
    const scope: Scope = opts.project ? 'project' : 'user';

    const {selected, missing} = select_hosts(opts.agents, detect);
    const hosts: Host_outcome[] = [];

    for (const host of selected)
    {
        let outcome: Host_outcome;
        try {
            outcome = await run_host(opts, host, packs, scope, detect);
        } catch (error) {
            // An adapter is expected to turn every failure it knows about
            // into a Host_outcome; this is the backstop for the ones it
            // doesn't (a journal write racing an antivirus scanner, a corrupt
            // journal file) — one host's surprise must never take the others
            // down with it.
            outcome = {
                host: host.def.id, label: host.def.label, kind: host.def.kind, scope,
                status: 'failed',
                reason: 'host-error',
                detail: (error as Error).message,
                hint: `re-run \`reply skills ${opts.operation}\` once the underlying error for ${host.def.label} is resolved`,
            };
        }
        // Stamped here rather than per adapter: both are registry data, and
        // doing it once means no path can forget either.
        hosts.push({
            ...outcome,
            verified: host.def.verified,
            needs_new_session: host.def.needs_new_session,
        });
    }
    for (const def of missing)
    {
        hosts.push(not_detected(def));
    }

    // `list` alone: it answers "what is installed where". The other operations
    // act on hosts, and can do nothing about one they no longer know.
    const orphans = opts.operation === 'list' ? orphaned_packs(deps.env) : [];
    const names = packs.map(p=>p.name);

    return {
        action: opts.operation,
        source: {version: cli_version()},
        requested: names,
        resolved: names,
        hosts,
        summary: summarize(hosts, opts.operation),
        ...(orphans.length ? {orphans} : {}),
    };
};

export {run_skills};
export type {Skills_deps, Skills_opts};
