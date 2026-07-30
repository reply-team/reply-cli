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

// Both hosts print a JSON listing, with different envelopes: Claude Code uses
// {plugins:[…]}, Codex uses {installed:[…]}. Anything unparseable means "we
// know nothing", which is safe: the adapter then just installs.
const installed_versions = async(host: Detected_host, run: Runner): Promise<Record<string, string>>=>{
    const bin = host.bin as string;
    const result = await run(bin, host.def.cli!.list_json());
    let parsed: unknown;
    try {
        parsed = JSON.parse(result.stdout);
    } catch {
        return {};
    }
    const doc = (parsed ?? {}) as Record<string, unknown>;
    const rows = [doc.plugins, doc.installed].find(Array.isArray) as Record<string, unknown>[] | undefined;
    const out: Record<string, string> = {};
    for (const row of rows ?? [])
    {
        const name = row.name;
        const version = row.version;
        if (typeof name === 'string' && typeof version === 'string')
        {
            out[name] = version;
        }
    }
    return out;
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

    const installed = await installed_versions(host, run);
    const outcomes: Pack_outcome[] = [];

    if (operation === 'list')
    {
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
        // Reverse dependency order: a dependent never outlives its dependency.
        for (const pack of [...packs].reverse())
        {
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
            outcomes.push(result.code === 0
                ? {name: pack.name, action: 'removed', version: installed[pack.name]}
                : {name: pack.name, action: 'failed', detail: (result.stderr || result.stdout).trim()});
        }
        return {...base, packs: outcomes, status: status_of(outcomes)};
    }

    if (operation === 'update')
    {
        for (const pack of packs)
        {
            const have = installed[pack.name];
            if (!have)
            {
                continue;
            }
            if (dry_run)
            {
                outcomes.push({name: pack.name, action: 'upgraded', version: pack.version, from: have});
                continue;
            }
            const result = await run(host.bin, cli.update(pack.name, MARKETPLACE));
            outcomes.push(result.code === 0
                ? {name: pack.name, action: 'upgraded', version: pack.version, from: have}
                : {name: pack.name, action: 'failed', detail: (result.stderr || result.stdout).trim()});
        }
        return {...base, packs: outcomes, status: status_of(outcomes)};
    }

    // install — dependency order, and a failed dependency stops its dependents
    // so the host is never left with an adapter and no core.
    const failed_names = new Set<string>();
    for (const pack of packs)
    {
        const blocked = pack.dependencies.find(d=>failed_names.has(d));
        if (blocked)
        {
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

    const status = status_of(outcomes);
    const hint = failed_names.size
        ? `packs depending on ${[...failed_names].join(', ')} were not attempted; fix that install and re-run`
        : undefined;
    return {...base, packs: outcomes, status, hint};
};

export {default_runner, installed_versions, run_native};
export type {Native_opts};
