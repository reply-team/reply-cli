import fs from 'fs';
import os from 'os';
import path from 'path';
import {default_runner} from './adapter-native';
import {forget_pack, journal_entry, read_journal, record_pack} from './journal';
import {DEFAULT_REF, REPO} from './packs';
import type {Env} from '../config';
import type {Detected_host} from './detect';
import type {Journal_entry} from './journal';
import type {Host_def, Host_outcome, Operation, Pack, Pack_outcome, Runner, Scope} from './types';

// For hosts with no plugin mechanism: a pack is just a directory of skills, so
// installing is a copy. `git` is required here; both native hosts already need
// it for `marketplace add`, and the resolved commit lands in the journal.

type Clone_result = {dir: string; commit: string};
type Clone_fn = (opts: {ref: string; run: Runner; tmp_root: string})=>Promise<Clone_result>;

const clone_repo: Clone_fn = async({ref, run, tmp_root})=>{
    const dir = fs.mkdtempSync(path.join(tmp_root, 'reply-skills-'));
    const url = `https://github.com/${REPO}.git`;
    const cloned = await run('git', ['clone', '--depth', '1', '--branch', ref, url, dir]);
    if (cloned.code !== 0)
    {
        fs.rmSync(dir, {recursive: true, force: true});
        throw new Error((cloned.stderr || cloned.stdout).trim() || `git clone failed for ${url}`);
    }
    const head = await run('git', ['-C', dir, 'rev-parse', 'HEAD']);
    if (head.code !== 0)
    {
        fs.rmSync(dir, {recursive: true, force: true});
        throw new Error((head.stderr || head.stdout).trim() || `git rev-parse HEAD failed for ${url}`);
    }
    return {dir, commit: head.stdout.trim().slice(0, 7)};
};

// Where this host reads skills from, for the requested scope. A native host
// only lands here under --project, because its plugin mechanism is user-scoped.
// Returns undefined when the host has no directory configured for this scope
// (e.g. a native host under `user` scope) so the caller can report a status
// instead of joining `undefined` into a path.
const skills_target = (def: Host_def, scope: Scope, home: string, cwd: string): string | undefined=>{
    const rel = scope === 'project' ? def.project_skills_dir : def.user_skills_dir;
    return rel === undefined ? undefined : path.join(scope === 'project' ? cwd : home, rel);
};

// Mutates `written` as it goes, rather than returning a fresh array, so that
// a throw partway through (a read-only destination, a full disk) still leaves
// the caller with exactly the files that landed before the failure — see the
// install loop, which journals that partial list instead of orphaning it.
const copy_dir = (from: string, to: string, written: string[]): void=>{
    fs.mkdirSync(to, {recursive: true});
    for (const entry of fs.readdirSync(from, {withFileTypes: true}))
    {
        const src = path.join(from, entry.name);
        const dst = path.join(to, entry.name);
        if (entry.isDirectory())
        {
            copy_dir(src, dst, written);
            continue;
        }
        fs.copyFileSync(src, dst);
        written.push(dst);
    }
};

// True when `target` resolves inside `root` — never equal to it, never above
// it via `..`. Every path handed to delete_files must pass this: the journal
// is JSON in the user's config directory, and a hand-edited or stale entry
// must not be able to name a file outside the host's own skills directory.
// `path.relative` — not string equality — so this agrees with the OS on
// whether two differently-cased paths are the same file, which matters on
// Windows: is_within, owns_dir and the protected-files check must all reach
// the same answer for the same pair of paths.
const is_within = (root: string, target: string): boolean=>{
    const rel = path.relative(root, target);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

const paths_equal = (a: string, b: string): boolean=>
    path.relative(a, b) === '';

// Removes the files we're told to, minus two carve-outs: anything outside
// `target_root` (a tampered or stale journal entry) and anything another
// host's own journal entry still claims (several flat hosts share the same
// project-scope directory, see claimed_by_others). What's left is pruned back
// to empty directories, but `target_root` itself is never removed.
const delete_files = (files: string[], target_root: string, protected_files: Set<string> = new Set()): void=>{
    const resolved_root = path.resolve(target_root);
    const dirs = new Set<string>();
    for (const file of files)
    {
        const resolved = path.resolve(file);
        if (!is_within(resolved_root, resolved) || [...protected_files].some(p=>paths_equal(p, resolved)))
        {
            continue;
        }
        try {
            fs.rmSync(resolved, {force: true});
        } catch {
            // Already gone — removal stays idempotent.
        }
        dirs.add(path.dirname(resolved));
    }
    for (const dir of [...dirs].sort((a, b)=>b.length - a.length))
    {
        if (dir === resolved_root)
        {
            continue;
        }
        try {
            if (!fs.readdirSync(dir).length)
            {
                fs.rmdirSync(dir);
            }
        } catch {
            // Non-empty or missing — leave it alone.
        }
    }
};

// Absolute file paths that some *other* host's journal entry for this exact
// (scope, pack) still claims. Several flat hosts resolve the same physical
// project-scope directory (`.agents/skills`), so deleting or overwriting one
// host's copy must not break a sibling host's install of the same pack.
const claimed_by_others = (env: Env | undefined, scope: Scope, pack_name: string, exclude_host: string): Set<string>=>{
    const journal = read_journal(env);
    const claimed = new Set<string>();
    for (const [host, scopes] of Object.entries(journal.hosts))
    {
        if (host === exclude_host)
        {
            continue;
        }
        const entry = scopes[scope]?.[pack_name];
        if (!entry)
        {
            continue;
        }
        for (const file of entry.files)
        {
            claimed.add(path.resolve(file));
        }
    }
    return claimed;
};

// True when every file under `dir` is accounted for by files we already know
// about — our own previous install of this pack, or a sibling host's install
// of the same pack at a shared directory. Anything else sitting at `dir` is
// foreign (typically user-authored) and must not be clobbered. Reuses
// is_within rather than a raw prefix check, so this agrees with delete_files'
// containment check on a differently-cased path (routine on Windows).
const owns_dir = (dir: string, known_files: Iterable<string>): boolean=>{
    for (const file of known_files)
    {
        if (is_within(dir, file))
        {
            return true;
        }
    }
    return false;
};

// Mirrors adapter-native.ts's status_of: 'ok' with no failures, 'failed' when
// every pack in this operation failed, 'partial' otherwise. Kept local rather
// than shared, since the two adapters are twin, independent implementations
// of the same rule.
const status_of = (packs: Pack_outcome[]): Host_outcome['status']=>{
    const failed = packs.filter(p=>p.action === 'failed');
    if (!failed.length)
    {
        return 'ok';
    }
    return failed.length === packs.length ? 'failed' : 'partial';
};

type Flat_opts = {
    operation: Operation;
    host: Detected_host;
    packs: Pack[];
    scope: Scope;
    ref?: string;
    run?: Runner;
    home?: string;
    cwd?: string;
    tmp_root?: string;
    env?: Env;
    dry_run?: boolean;
    clone?: Clone_fn;
};

const run_flat = async(opts: Flat_opts): Promise<Host_outcome>=>{
    const {operation, host, packs, scope} = opts;
    const run = opts.run ?? default_runner;
    const ref = opts.ref ?? DEFAULT_REF;
    const home = opts.home ?? os.homedir();
    const cwd = opts.cwd ?? process.cwd();
    const tmp_root = opts.tmp_root ?? os.tmpdir();
    const dry_run = opts.dry_run === true;
    const clone = opts.clone ?? clone_repo;
    const id = host.def.id;
    const base: Host_outcome = {
        host: id, label: host.def.label, kind: 'flat-skills-dir', scope, status: 'ok',
    };
    // Scope-bound wrappers: every journal lookup for this run goes through
    // these, so `scope` can never be forgotten at a call site.
    const entry_for = (pack_name: string): Journal_entry | undefined=>
        journal_entry(id, scope, pack_name, opts.env);
    const record_for = (pack_name: string, data: Journal_entry): void=>
        record_pack(id, scope, pack_name, data, opts.env);
    const forget_for = (pack_name: string): Journal_entry | undefined=>
        forget_pack(id, scope, pack_name, opts.env);
    const outcomes: Pack_outcome[] = [];

    if (operation === 'list')
    {
        for (const pack of packs)
        {
            const entry = entry_for(pack.name);
            if (!entry)
            {
                continue;
            }
            // An incomplete entry never reads as current, regardless of
            // version — it is a copy that did not finish, and needs a repair
            // install, not a clean bill of health.
            if (!entry.complete)
            {
                outcomes.push({
                    name: pack.name,
                    action: 'failed',
                    detail: 'installation incomplete; run `reply skills install` to repair',
                });
                continue;
            }
            outcomes.push(entry.version === pack.version
                ? {name: pack.name, action: 'current', version: entry.version}
                : {name: pack.name, action: 'upgraded', version: pack.version, from: entry.version});
        }
        return {...base, packs: outcomes, status: status_of(outcomes)};
    }

    // Every other operation touches the filesystem, so a host with no
    // directory configured for this scope (a native host under `user` scope)
    // is reported, not crashed on.
    const target_root = skills_target(host.def, scope, home, cwd);
    if (!target_root)
    {
        return {
            ...base,
            status: 'skipped',
            reason: 'no-skills-dir',
            detail: `${host.def.label} has no ${scope} skills directory`,
        };
    }

    if (operation === 'remove')
    {
        for (const pack of [...packs].reverse())
        {
            const entry = entry_for(pack.name);
            if (!entry)
            {
                continue;
            }
            if (!dry_run)
            {
                const protected_files = claimed_by_others(opts.env, scope, pack.name, id);
                delete_files(entry.files, target_root, protected_files);
                forget_for(pack.name);
            }
            outcomes.push({name: pack.name, action: 'removed', version: entry.version});
        }
        return {...base, packs: outcomes};
    }

    // install and update both need the repository contents. update only touches
    // packs the journal already knows about.
    const targets = operation === 'update'
        ? packs.filter(p=>entry_for(p.name))
        : packs;
    const pending = targets.filter(p=>{
        const entry = entry_for(p.name);
        return operation === 'update' || !entry || !entry.complete || entry.version !== p.version;
    });
    for (const pack of targets)
    {
        if (!pending.includes(pack))
        {
            outcomes.push({name: pack.name, action: 'current', version: pack.version});
        }
    }
    if (!pending.length)
    {
        return {...base, packs: outcomes};
    }
    if (dry_run)
    {
        for (const pack of pending)
        {
            const entry = entry_for(pack.name);
            outcomes.push(entry
                ? {name: pack.name, action: 'upgraded', version: pack.version, from: entry.version}
                : {name: pack.name, action: 'installed', version: pack.version});
        }
        return {...base, packs: outcomes};
    }

    let cloned: Clone_result;
    try {
        cloned = await clone({ref, run, tmp_root});
    } catch (error) {
        return {
            ...base,
            status: 'failed',
            reason: 'clone-failed',
            detail: (error as Error).message,
            hint: 'install git (the flat-directory install clones the skills repository), then re-run',
        };
    }

    // A per-host filesystem failure here (a read-only destination, a corrupt
    // clone layout, a journal write error) must become a Host_outcome, never
    // a rejected promise — one host failing must never abort the others, and
    // any pack already installed and journaled before the failure still counts.
    //
    // A pack whose dependency failed (or was itself blocked) must never be
    // attempted — mirrors adapter-native.ts's failed_names/blocked_names, so
    // the invariant "never reply-adapter without ai-sdr-core" holds the same
    // way regardless of which adapter is doing the installing.
    const failed_names = new Set<string>();
    const blocked_names = new Set<string>();
    const blocked_hint = (): string | undefined=>
        blocked_names.size
            ? `packs ${[...blocked_names].join(', ')} were not attempted because their dependencies failed; fix those installs and re-run`
            : undefined;
    try {
        for (const pack of pending)
        {
            const blocker = pack.dependencies.find(d=>failed_names.has(d) || blocked_names.has(d));
            if (blocker)
            {
                blocked_names.add(pack.name);
                continue;
            }
            const from = path.join(cloned.dir, 'plugins', pack.name, 'skills');
            const previous = entry_for(pack.name);
            const elsewhere = claimed_by_others(opts.env, scope, pack.name, id);
            const known_files = previous
                ? [...previous.files.map(f=>path.resolve(f)), ...elsewhere]
                : [...elsewhere];
            const skill_dirs = fs.readdirSync(from, {withFileTypes: true}).filter(e=>e.isDirectory());
            const collision = skill_dirs.find(skill=>{
                const dst_dir = path.join(target_root, skill.name);
                return fs.existsSync(dst_dir) && !owns_dir(dst_dir, known_files);
            });
            if (collision)
            {
                failed_names.add(pack.name);
                outcomes.push({
                    name: pack.name,
                    action: 'failed',
                    detail: `conflicts with an existing skill: ${collision.name}`,
                });
                continue;
            }
            if (previous)
            {
                delete_files(previous.files, target_root, elsewhere);
            }
            const written: string[] = [];
            try {
                for (const skill of skill_dirs)
                {
                    copy_dir(path.join(from, skill.name), path.join(target_root, skill.name), written);
                }
            } catch (copy_error) {
                // Whatever landed before the failure — possibly nothing — is
                // journaled as incomplete, never as done: a version match
                // alone must never read as installed when the copy did not
                // finish, or `install`'s own hint to re-run would do nothing.
                record_for(pack.name, {
                    version: pack.version, ref, commit: cloned.commit, scope,
                    files: written, complete: false, installed_at: new Date().toISOString(),
                });
                throw copy_error;
            }
            record_for(pack.name, {
                version: pack.version,
                ref,
                commit: cloned.commit,
                scope,
                files: written,
                complete: true,
                installed_at: new Date().toISOString(),
            });
            outcomes.push(previous
                ? {name: pack.name, action: 'upgraded', version: pack.version, from: previous.version}
                : {name: pack.name, action: 'installed', version: pack.version});
        }
    } catch (error) {
        // outcomes.length is not "something landed" — every entry pushed so
        // far could itself be a collision failure, so check the actions.
        const landed = outcomes.some(p=>p.action !== 'failed');
        return {
            ...base,
            status: landed ? 'partial' : 'failed',
            packs: outcomes,
            reason: 'copy-failed',
            detail: (error as Error).message,
            hint: blocked_hint() ?? 'check filesystem permissions for the skills directory, then re-run',
        };
    } finally {
        try {
            fs.rmSync(cloned.dir, {recursive: true, force: true});
        } catch {
            // Best-effort cleanup of the clone's temp directory — never masks
            // the result computed above.
        }
    }
    return {...base, packs: outcomes, status: status_of(outcomes), hint: blocked_hint()};
};

export {clone_repo, copy_dir, skills_target, run_flat};
export type {Clone_fn, Clone_result, Flat_opts};
