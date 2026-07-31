import {execFile} from 'child_process';
import {MARKETPLACE, REPO} from './packs';
import type {Detected_host} from './detect';
import type {Host_outcome, Operation, Pack, Pack_outcome, Runner, Run_result, Scope} from './types';

// Drives a host's own plugin CLI rather than copying files, so Claude Code's
// marketplace update channel keeps working and Codex installs natively.

const default_runner: Runner = (bin, args)=>new Promise<Run_result>(resolve=>{
    execFile(bin, args, {encoding: 'utf8', windowsHide: true}, (error, stdout, stderr)=>{
        const code = error && typeof (error as {code?: unknown}).code === 'number'
            ? (error as unknown as {code: number}).code
            : (error ? 1 : 0);
        resolve({code, stdout: stdout ?? '', stderr: stderr ?? ''});
    });
});

// Returns {ok: false, detail} if the listing failed or is unparseable.
// Returns {ok: true, versions} with only plugins from MARKETPLACE if the listing succeeded.
// Both hosts print a JSON listing, with different envelopes: Claude Code uses
// {plugins:[…]}, Codex uses {installed:[…]}. Rows carry marketplace metadata
// ('marketplace' for Claude Code, 'marketplaceName' for Codex) — only rows
// matching MARKETPLACE are included.
type Listing_result = {ok: true; versions: Record<string, string>} | {ok: false; detail?: string};

const installed_versions = async(host: Detected_host, run: Runner): Promise<Listing_result>=>{
    const bin = host.bin as string;
    const result = await run(bin, host.def.cli!.list_json());
    if (result.code !== 0)
    {
        return {ok: false, detail: (result.stderr || result.stdout).trim()};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(result.stdout);
    } catch {
        return {ok: false};
    }
    // Claude Code returns an array directly; older versions wrapped it in {plugins:[…]}.
    // Codex wraps it in {installed:[…]}.
    const doc = (parsed ?? {}) as Record<string, unknown>;
    const rows = Array.isArray(parsed)
        ? parsed
        : [doc.plugins, doc.installed].find(Array.isArray) as Record<string, unknown>[] | undefined;
    const out: Record<string, string> = {};
    for (const row of rows ?? [])
    {
        // Claude Code uses 'id' (e.g. "agentic-runtime@reply-skills") instead of 'name'.
        // Extract name from id if present, falling back to name field.
        let name = (row.name ?? row.id) as string | undefined;
        if (name && name.includes('@'))
        {
            const id_parts = name.split('@');
            const pack_name = id_parts[0];
            const marketplace = id_parts[1];
            // Only accept if marketplace matches or is empty
            if (marketplace === MARKETPLACE || marketplace === undefined)
            {
                name = pack_name;
            }
            else
            {
                continue;
            }
        }
        const version = row.version;
        // Check marketplace: accept rows that declare MARKETPLACE, or rows with no marketplace field.
        const marketplace = (row.marketplace ?? row.marketplaceName) as string | undefined;
        if (typeof name === 'string' && typeof version === 'string')
        {
            // If marketplace is declared, it must match MARKETPLACE; if not declared, accept it.
            if (marketplace === undefined || marketplace === MARKETPLACE)
            {
                out[name] = version;
            }
        }
    }
    return {ok: true, versions: out};
};

type Native_opts = {
    operation: Operation;
    host: Detected_host;
    packs: Pack[];
    scope: Scope;
    run?: Runner;
    dry_run?: boolean;
};

const skipped = (host: Detected_host): Host_outcome=>({
    host: host.def.id,
    label: host.def.label,
    kind: host.def.kind,
    status: 'skipped',
    reason: 'cli-not-resolved',
    detail: `${host.def.label} config found at ${host.config_dir} but its CLI could not be resolved`,
    hint: `add ${host.def.binaries[0]} to PATH, then re-run`,
});

const status_of = (packs: Pack_outcome[]): Host_outcome['status']=>{
    const failed = packs.filter(p=>p.action === 'failed');
    if (!failed.length)
    {
        return 'ok';
    }
    return failed.length === packs.length ? 'failed' : 'partial';
};

// The two dependency guards report the same way: name the packs the guard held
// back, so the user is told what is still to do rather than left to infer it.
// Install refuses a pack whose dependency failed; remove refuses a pack whose
// dependent failed. adapter-flat.ts carries the same pair verbatim — the two
// adapters are twin implementations of one rule, like status_of above.
const blocked_hint = (names: Iterable<string>): string | undefined=>{
    const list = [...names];
    return list.length
        ? `packs ${list.join(', ')} were not attempted because their dependencies failed; fix those installs and re-run`
        : undefined;
};

const kept_hint = (names: Iterable<string>): string | undefined=>{
    const list = [...names];
    return list.length
        ? `packs ${list.join(', ')} were kept because packs that depend on them could not be removed; fix those removals and re-run`
        : undefined;
};

// A version that did not move is `current`, never `upgraded`. Every update
// path in both adapters answers this question through a helper like this one,
// so one machine can never report "already current" and "updated 0.1.0 →
// 0.1.0" for the same fact side by side.
const updated_outcome = (name: string, from: string, to: string): Pack_outcome=>
    from === to
        ? {name, action: 'current', version: to}
        : {name, action: 'upgraded', version: to, from};

const run_native = async(opts: Native_opts): Promise<Host_outcome>=>{
    const {operation, host, packs, scope} = opts;
    const run = opts.run ?? default_runner;
    const dry_run = opts.dry_run === true;
    const base: Host_outcome = {
        host: host.def.id, label: host.def.label, kind: host.def.kind, scope, status: 'ok',
    };
    if (!host.bin)
    {
        return skipped(host);
    }
    const cli = host.def.cli!;

    // Registering the marketplace is the precondition for every mutating
    // operation; it is idempotent on both hosts.
    if ((operation === 'install' || operation === 'update') && !dry_run)
    {
        const added = await run(host.bin, cli.marketplace_add(REPO));
        if (added.code !== 0)
        {
            return {
                ...base,
                status: 'failed',
                reason: 'marketplace-add-failed',
                detail: (added.stderr || added.stdout).trim(),
                hint: `run \`${host.def.binaries[0]} ${cli.marketplace_add(REPO).join(' ')}\` manually to see why`,
            };
        }
    }

    const listing = await installed_versions(host, run);
    const outcomes: Pack_outcome[] = [];

    if (operation === 'list')
    {
        if (!listing.ok)
        {
            return {
                ...base,
                status: 'failed',
                reason: 'list-failed',
                detail: listing.detail || 'failed to list installed plugins',
                hint: `run \`${host.def.binaries[0]} ${cli.list_json().join(' ')}\` manually to see why`,
            };
        }
        const installed = listing.versions;
        for (const pack of packs)
        {
            const have = installed[pack.name];
            if (!have)
            {
                continue;
            }
            outcomes.push(have === pack.version
                ? {name: pack.name, action: 'current', version: have}
                : {name: pack.name, action: 'upgraded', version: pack.version, from: have});
        }
        return {...base, packs: outcomes};
    }

    if (operation === 'remove')
    {
        if (!listing.ok)
        {
            return {
                ...base,
                status: 'failed',
                reason: 'list-failed',
                detail: listing.detail || 'failed to list installed plugins',
                hint: `run \`${host.def.binaries[0]} ${cli.list_json().join(' ')}\` manually to see why`,
            };
        }
        const installed = listing.versions;
        // Reverse dependency order: a dependent never outlives its dependency.
        // Ordering alone is not enough, though — if a dependent's removal
        // fails, removing its dependency anyway leaves the host holding an
        // adapter with no core, the one state this installer exists to
        // prevent. So the install guard below is mirrored here, transposed:
        // install refuses a pack whose dependency failed, remove refuses a
        // pack whose dependent did. Reverse order means every dependent has
        // already been visited by the time its dependency comes up, so the
        // block propagates transitively down the chain.
        const failed_names = new Set<string>();
        const blocked_names = new Set<string>();
        const kept_names = new Set<string>();
        for (const pack of [...packs].reverse())
        {
            const blocker = packs.find(p=>p.dependencies.includes(pack.name)
                && (failed_names.has(p.name) || blocked_names.has(p.name)));
            if (blocker)
            {
                blocked_names.add(pack.name);
                // Only a pack that is actually here is "kept" — blocking one
                // the host never had is bookkeeping for the chain, not news.
                if (installed[pack.name])
                {
                    kept_names.add(pack.name);
                }
                continue;
            }
            if (!installed[pack.name])
            {
                continue;
            }
            if (dry_run)
            {
                outcomes.push({name: pack.name, action: 'removed', version: installed[pack.name]});
                continue;
            }
            const result = await run(host.bin, cli.remove(pack.name, MARKETPLACE));
            if (result.code !== 0)
            {
                failed_names.add(pack.name);
                outcomes.push({name: pack.name, action: 'failed', detail: (result.stderr || result.stdout).trim()});
                continue;
            }
            outcomes.push({name: pack.name, action: 'removed', version: installed[pack.name]});
        }
        return {...base, packs: outcomes, status: status_of(outcomes), hint: kept_hint(kept_names)};
    }

    if (operation === 'update')
    {
        if (!listing.ok)
        {
            return {
                ...base,
                status: 'failed',
                reason: 'list-failed',
                detail: listing.detail || 'failed to list installed plugins',
                hint: `run \`${host.def.binaries[0]} ${cli.list_json().join(' ')}\` manually to see why`,
            };
        }
        const installed = listing.versions;
        const pre_update_versions = new Map(Object.entries(installed));

        // Deduplicate updates: if update_scope is 'marketplace', run once and apply to all packs.
        if (cli.update_scope === 'marketplace')
        {
            const installed_packs = packs.filter(p=>installed[p.name]);
            if (installed_packs.length > 0)
            {
                if (dry_run)
                {
                    for (const pack of installed_packs)
                    {
                        outcomes.push(updated_outcome(pack.name, installed[pack.name], pack.version));
                    }
                }
                else
                {
                    // Run the marketplace-wide update once
                    const result = await run(host.bin, cli.update(installed_packs[0].name, MARKETPLACE));
                    if (result.code === 0)
                    {
                        // Re-read listing to get actual versions. A whole-
                        // marketplace upgrade exits 0 whether or not any pack
                        // moved, so the post-update versions — not the exit
                        // code — decide between `upgraded` and `current`.
                        const post_listing = await installed_versions(host, run);
                        if (post_listing.ok)
                        {
                            const post_installed = post_listing.versions;
                            for (const pack of installed_packs)
                            {
                                const have = pre_update_versions.get(pack.name);
                                outcomes.push(updated_outcome(
                                    pack.name, have ?? '', post_installed[pack.name] ?? pack.version,
                                ));
                            }
                        }
                        else
                        {
                            // Re-read failed; use target version from registry
                            for (const pack of installed_packs)
                            {
                                const have = pre_update_versions.get(pack.name);
                                outcomes.push(updated_outcome(pack.name, have ?? '', pack.version));
                            }
                        }
                    }
                    else
                    {
                        // Update failed; report all packs as failed with the same detail
                        for (const pack of installed_packs)
                        {
                            outcomes.push({name: pack.name, action: 'failed', detail: (result.stderr || result.stdout).trim()});
                        }
                    }
                }
            }
        }
        else
        {
            // Per-pack updates (Claude Code)
            for (const pack of packs)
            {
                const have = installed[pack.name];
                if (!have)
                {
                    continue;
                }
                // Check if already at target version
                if (have === pack.version)
                {
                    outcomes.push({name: pack.name, action: 'current', version: have});
                    continue;
                }
                if (dry_run)
                {
                    outcomes.push({name: pack.name, action: 'upgraded', version: pack.version, from: have});
                    continue;
                }
                const result = await run(host.bin, cli.update(pack.name, MARKETPLACE));
                if (result.code === 0)
                {
                    // Re-read listing to get actual version. `plugin update`
                    // can exit 0 without moving the version, so this reports
                    // `current` rather than `upgraded 0.1.0 -> 0.1.0`.
                    const post_listing = await installed_versions(host, run);
                    if (post_listing.ok)
                    {
                        outcomes.push(updated_outcome(
                            pack.name, have, post_listing.versions[pack.name] ?? pack.version,
                        ));
                    }
                    else
                    {
                        // Re-read failed; use target version from registry
                        outcomes.push(updated_outcome(pack.name, have, pack.version));
                    }
                }
                else
                {
                    outcomes.push({name: pack.name, action: 'failed', detail: (result.stderr || result.stdout).trim()});
                }
            }
        }
        return {...base, packs: outcomes, status: status_of(outcomes)};
    }

    // install — dependency order, and a failed dependency stops its dependents
    // so the host is never left with an adapter and no core. Track both failed
    // and blocked packs to handle transitive dependency chains.
    const installed = listing.ok ? listing.versions : {};
    const failed_names = new Set<string>();
    const blocked_names = new Set<string>();
    for (const pack of packs)
    {
        const blocker = pack.dependencies.find(d=>failed_names.has(d) || blocked_names.has(d));
        if (blocker)
        {
            blocked_names.add(pack.name);
            continue;
        }
        const have = installed[pack.name];
        if (have === pack.version)
        {
            outcomes.push({name: pack.name, action: 'current', version: have});
            continue;
        }
        const action: Pack_outcome['action'] = have ? 'upgraded' : 'installed';
        if (dry_run)
        {
            outcomes.push(have
                ? {name: pack.name, action, version: pack.version, from: have}
                : {name: pack.name, action, version: pack.version});
            continue;
        }
        const result = await run(host.bin, cli.install(pack.name, MARKETPLACE, scope));
        if (result.code !== 0)
        {
            failed_names.add(pack.name);
            outcomes.push({name: pack.name, action: 'failed', detail: (result.stderr || result.stdout).trim()});
            continue;
        }
        outcomes.push(have
            ? {name: pack.name, action, version: pack.version, from: have}
            : {name: pack.name, action, version: pack.version});
    }

    return {...base, packs: outcomes, status: status_of(outcomes), hint: blocked_hint(blocked_names)};
};

export {default_runner, installed_versions, run_native};
export type {Native_opts};
