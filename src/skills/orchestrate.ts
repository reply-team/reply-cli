import os from 'os';
import {run_flat, type Clone_fn} from './adapter-flat';
import {run_native} from './adapter-native';
import {default_detect_deps, select_hosts, type Detect_deps} from './detect';
import {journal_entry} from './journal';
import {DEFAULT_REF, REPO, load_packs, resolve_packs} from './packs';
import {summarize} from './report';
import {UsageError} from '../utils/errors';
import type {Env} from '../config';
import type {Host_outcome, Operation, Pack, Report, Runner, Scope} from './types';

// The one flow all four commands share: detect hosts, resolve packs in
// dependency order, run the right adapter per host, collect outcomes. Every
// external dependency is injectable so the whole thing is testable offline.

type Skills_deps = {
    detect?: Detect_deps;
    run?: Runner;
    clone?: Clone_fn;
    home?: string;
    cwd?: string;
    tmp_root?: string;
    env?: Env;
    fetch_impl?: typeof fetch;
    ref?: string;
};

type Skills_opts = {
    operation: Operation;
    requested: string[];
    agents?: string[];
    project: boolean;
    dry_run: boolean;
    deps?: Skills_deps;
};

// A dependency may not be removed while something that needs it could stay
// behind: that is exactly the adapter-without-core state the installer exists to
// avoid. Deliberately conservative — it refuses based on the dependency graph
// alone, without first asking every host what it has installed. A selective
// removal is the rare path, the fix is one flag away, and being wrong in this
// direction only costs an extra keystroke, while being wrong in the other
// direction breaks a working assistant.
const guard_remove = (packs: Pack[], all: Pack[]): void=>{
    const going = new Set(packs.map(p=>p.name));
    for (const pack of all)
    {
        if (going.has(pack.name))
        {
            continue;
        }
        const needed = pack.dependencies.filter(d=>going.has(d));
        if (needed.length)
        {
            throw new UsageError(
                `${pack.name} depends on ${needed.join(', ')}; removing it alone can leave that pack broken.`,
                {
                    code: 'usage.skills_remove',
                    hint: `remove ${pack.name} too, or run \`reply skills remove\` to remove everything`,
                },
            );
        }
    }
};

const not_detected = (id: string, label: string, kind: Host_outcome['kind']): Host_outcome=>({
    host: id, label, kind, status: 'skipped', reason: 'not-detected',
    detail: `${label} was requested with --agent but is not installed on this machine`,
});

const run_skills = async(opts: Skills_opts): Promise<Report>=>{
    const deps = opts.deps ?? {};
    const detect = deps.detect ?? default_detect_deps();
    const ref = deps.ref ?? DEFAULT_REF;
    const registry = await load_packs({ref, fetch_impl: deps.fetch_impl});
    // Install and update pull dependencies; remove must not — see resolve_packs.
    const packs = resolve_packs(opts.requested, registry, {
        dependencies: opts.operation !== 'remove',
    });
    const scope: Scope = opts.project ? 'project' : 'user';

    if (opts.operation === 'remove' && opts.requested.length)
    {
        guard_remove(packs, registry.packs);
    }

    const {selected, missing} = select_hosts(opts.agents, detect);
    const hosts: Host_outcome[] = [];
    let commit: string | undefined;

    for (const host of selected)
    {
        // A native host under --project falls back to the flat adapter only
        // when its plugin mechanism cannot express project scope; Claude Code
        // can, Codex cannot.
        const native = host.def.kind === 'native-plugin'
            && !(scope === 'project' && host.def.id === 'codex');
        const outcome = native
            ? await run_native({
                operation: opts.operation, host, packs, scope,
                run: deps.run, dry_run: opts.dry_run,
            })
            : await run_flat({
                operation: opts.operation, host, packs, scope, ref,
                run: deps.run, clone: deps.clone, dry_run: opts.dry_run,
                home: deps.home ?? detect.home, cwd: deps.cwd,
                tmp_root: deps.tmp_root ?? os.tmpdir(), env: deps.env,
            });
        hosts.push(outcome);
    }
    for (const def of missing)
    {
        hosts.push(not_detected(def.id, def.label, def.kind));
    }

    // The commit is only known when something was cloned; native installs are
    // resolved by the host, which reports versions, not commits.
    const flat_used = hosts.some(h=>h.kind === 'flat-skills-dir' && h.status !== 'skipped');
    if (flat_used && !opts.dry_run)
    {
        for (const pack of packs)
        {
            for (const host of hosts)
            {
                const entry = journal_entry(host.host, scope, pack.name, deps.env);
                if (entry?.commit)
                {
                    commit = entry.commit;
                }
            }
        }
    }

    // `requested` is what the user asked for in canonical form; `resolved` is
    // that plus dependencies. Both are reported so an agent sees the pull
    // without parsing prose. resolve_packs puts dependencies first, so the
    // requested pack itself is always the last element.
    const canonical = opts.requested.map(r=>resolve_packs([r], registry).slice(-1)[0].name);

    return {
        action: opts.operation,
        source: commit ? {repo: REPO, ref, commit} : {repo: REPO, ref},
        requested: opts.requested.length ? canonical : packs.map(p=>p.name),
        resolved: packs.map(p=>p.name),
        hosts,
        summary: summarize(hosts),
    };
};

export {guard_remove, run_skills};
export type {Skills_deps, Skills_opts};
