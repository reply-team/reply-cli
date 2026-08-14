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
// `path.relative` — not string equality — so `..` and redundant separators are
// resolved before the decision. Note it compares case-insensitively only on
// Windows: on macOS, whose filesystem ignores case, two spellings of one path
// come out as different files here, which is why ownership checks canonicalise
// first (see `canonical`). Deliberately strict for containment: refusing to
// delete a path we cannot prove is inside the root is the safe direction.
const is_within = (root: string, target: string): boolean=>{
    const rel = path.relative(root, target);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

const paths_equal = (a: string, b: string): boolean=>
    path.relative(a, b) === '';

// Whether the files an entry claims are still on disk. A complete entry at the
// right version says nothing about the filesystem: the directory can be deleted
// by hand, moved by a host upgrade, or eaten by a sync tool, and the entry keeps
// asserting the pack is installed. Consulted by `install` and `list` so neither
// reports a pack that is not there — otherwise `install` short-circuits to
// `current` over an empty directory, writes nothing, exits 0, and cannot repair
// what it just declared healthy. Per file, not per directory: a half-deleted
// pack is the same problem and needs the same repair.
const entry_files_present = (entry: Journal_entry): boolean=>
    entry.files.every(file=>fs.existsSync(file));

// What delete_files could not do. `outside` are paths the containment check
// refused — a tampered or stale journal entry naming somewhere else; `failed`
// are files the OS would not delete. Both are returned rather than swallowed:
// a caller that reports `removed` for a file still sitting on disk is lying,
// which is the only way this adapter's `remove` could ever mislead.
type Delete_failure = {file: string; message: string};
type Delete_result = {outside: string[]; failed: Delete_failure[]};

// Removes the files we're told to, minus two carve-outs: anything outside
// `target_root` (a tampered or stale journal entry) and anything another
// host's own journal entry still claims (several flat hosts share the same
// project-scope directory, see claimed_by_others). What's left is pruned back
// to empty directories, but `target_root` itself is never removed.
const delete_files = (files: string[], target_root: string, protected_files: Set<string> = new Set()): Delete_result=>{
    const resolved_root = path.resolve(target_root);
    const dirs = new Set<string>();
    const outside: string[] = [];
    const failed: Delete_failure[] = [];
    for (const file of files)
    {
        const resolved = path.resolve(file);
        if (!is_within(resolved_root, resolved))
        {
            if (fs.existsSync(resolved))
            {
                outside.push(resolved);
            }
            continue;
        }
        // A sibling host still claims this one; not deleting it is the point,
        // so it is neither a failure nor a refusal.
        if ([...protected_files].some(p=>paths_equal(p, resolved)))
        {
            continue;
        }
        try {
            // `force` already makes a missing file a no-op, so removal stays
            // idempotent without a catch. Anything that does throw here is a
            // real failure — a read-only file on Windows (EPERM), an open
            // handle (EBUSY) — and must be reported, not swallowed.
            fs.rmSync(resolved, {force: true});
        } catch (error) {
            failed.push({file: resolved, message: (error as Error).message});
            continue;
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
    return {outside, failed};
};

// The user-facing reason a removal did not fully happen, or undefined when it
// did. Anything but undefined means the pack must be reported `failed` and its
// journal entry kept, so the next run can retry.
const delete_detail = (result: Delete_result, target_root: string): string | undefined=>{
    const reasons: string[] = [];
    if (result.outside.length)
    {
        reasons.push(`${result.outside.length} recorded file(s) sit outside ${target_root} and were left alone`
            + `, starting with ${result.outside[0]}`);
    }
    for (const failure of result.failed)
    {
        reasons.push(`could not delete ${failure.file}: ${failure.message}`);
    }
    return reasons.length ? reasons.join('; ') : undefined;
};

// Absolute file paths that some *other* host's journal entry for this exact
// (scope, pack) still claims. Several flat hosts resolve the same physical
// project-scope directory (`.agents/skills`), so deleting or overwriting one
// host's copy must not break a sibling host's install of the same pack.
// `project_root` narrows this to the repository this run is acting on: a
// sibling's entry recorded in a different checkout claims nothing here.
const claimed_by_others = (
    env: Env | undefined,
    scope: Scope,
    pack_name: string,
    exclude_host: string,
    project_root?: string,
): Set<string>=>{
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
        if (project_root !== undefined && entry.project_root !== undefined
            && !paths_equal(entry.project_root, project_root))
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

// The path as the filesystem itself spells it, so two spellings of one file
// compare equal. `path.relative` is case-sensitive on POSIX, but macOS is
// case-insensitive, so a journal entry recording a different case than what is
// on disk names the same file while comparing as a different one. Only the OS
// can settle that, and only for a path that exists; anything else is returned
// resolved and unchanged.
const canonical = (target: string): string=>{
    try {
        return fs.realpathSync.native(target);
    } catch {
        return path.resolve(target);
    }
};

// True when every file under `dir` is accounted for by files we already know
// about — our own previous install of this pack, or a sibling host's install
// of the same pack at a shared directory. Anything else sitting at `dir` is
// foreign (typically user-authored) and must not be clobbered.
//
// Compared both raw and canonicalised: raw keeps this agreeing with
// delete_files' containment check, and canonical is what recognises our own
// skill through a case difference — without it, an install reports a conflict
// against a file its own journal entry claims, and refuses to touch it.
const owns_dir = (
    dir: string,
    known_files: Iterable<string>,
    canonicalise: (target: string)=>string = canonical,
): boolean=>{
    const real_dir = canonicalise(dir);
    for (const file of known_files)
    {
        if (is_within(dir, file) || is_within(real_dir, canonicalise(file)))
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

// Twins of adapter-native.ts's pair, for the same reason status_of is a twin:
// install refuses a pack whose dependency failed, remove refuses a pack whose
// dependent failed, and the user reads the identical sentence either way.
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

// A copy that landed at the version the pack was already on is not an upgrade,
// even though this adapter really did re-copy from a fresh clone — the commit
// carries that difference, the version does not. Mirrors
// adapter-native.ts's updated_outcome so `current` means one thing everywhere.
//
// But "the version moved" and "the bytes moved" are two different facts, and
// this adapter clones a *ref*: a new commit on `main` can rewrite every file
// at an unchanged 0.1.0, and so can repairing an install that never finished.
// `current` cannot say that, so `refreshed` does — otherwise a run that really
// did rewrite the user's files reads as a no-op and the reporter never tells
// them to start a new session.
//
// `commit` is the commit these files were copied from, and is passed only by
// the path that actually copied: a dry run never clones, so it cannot know
// whether the ref moved and must not guess.
const copied_outcome = (
    pack_name: string,
    version: string,
    previous: Journal_entry | undefined,
    commit?: string,
): Pack_outcome=>{
    if (previous === undefined)
    {
        return {name: pack_name, action: 'installed', version};
    }
    if (previous.version !== version)
    {
        return {name: pack_name, action: 'upgraded', version, from: previous.version};
    }
    const refreshed = commit !== undefined
        && (previous.commit !== commit || !previous.complete);
    return refreshed
        ? {name: pack_name, action: 'current', version, refreshed: true}
        : {name: pack_name, action: 'current', version};
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
    // How the filesystem spells a path, injected for the same reason detect.ts
    // injects `exists`: what needs asserting is that ownership survives a case
    // difference, and that cannot depend on whether the runner's filesystem
    // happens to ignore case. Defaults to asking the OS.
    canonicalise?: (target: string)=>string;
};

const run_flat = async(opts: Flat_opts): Promise<Host_outcome>=>{
    const {operation, host, packs, scope} = opts;
    const run = opts.run ?? default_runner;
    const ref = opts.ref ?? DEFAULT_REF;
    const home = opts.home ?? os.homedir();
    const cwd = opts.cwd ?? process.cwd();
    const tmp_root = opts.tmp_root ?? os.tmpdir();
    const dry_run = opts.dry_run === true;
    const canonicalise = opts.canonicalise ?? canonical;
    const clone = opts.clone ?? clone_repo;
    const id = host.def.id;
    const base: Host_outcome = {
        host: id, label: host.def.label, kind: 'flat-skills-dir', scope, status: 'ok',
    };
    // The repository a project-scope run acts on, and the identity a
    // project-scope journal entry is stamped with. Undefined under user scope,
    // whose directory is the home directory and cannot be confused with
    // another one.
    const project_root = scope === 'project' ? path.resolve(cwd) : undefined;
    // An entry written from a different checkout is not this run's to read,
    // replace or forget: `remove --project` from the wrong repository must
    // report nothing, rather than delete nothing (containment refuses every
    // path) and still claim `removed`. Entries written before the field
    // existed carry no root and are treated as ours, so nothing already
    // journaled becomes unreachable.
    const belongs_here = (entry: Journal_entry): boolean=>
        project_root === undefined
        || entry.project_root === undefined
        || paths_equal(entry.project_root, project_root);
    // Scope-bound wrappers: every journal lookup for this run goes through
    // these, so neither `scope` nor the project root can be forgotten at a
    // call site.
    const entry_for = (pack_name: string): Journal_entry | undefined=>{
        const entry = journal_entry(id, scope, pack_name, opts.env);
        return entry && belongs_here(entry) ? entry : undefined;
    };
    
    const previous_for = (pack_name: string): Journal_entry | undefined=>{
        const entry = entry_for(pack_name);
        return entry && entry_files_present(entry) ? entry : undefined;
    };
    const record_for = (pack_name: string, data: Journal_entry): void=>
        record_pack(id, scope, pack_name, project_root ? {...data, project_root} : data, opts.env);
    const forget_for = (pack_name: string): Journal_entry | undefined=>
        forget_pack(id, scope, pack_name, opts.env);
    const others_claim = (pack_name: string): Set<string>=>
        claimed_by_others(opts.env, scope, pack_name, id, project_root);
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
            // install, not a clean bill of health. Files that have since gone
            // missing are the same answer for the user: the pack is not usable
            // and `install` is what fixes it.
            if (!entry.complete || !entry_files_present(entry))
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
        // Reverse dependency order, and — since delete_files can now report a
        // file it could not remove — the same transposed guard as
        // adapter-native.ts: a dependency is never dropped once a pack that
        // depends on it failed to be removed, so no host is left holding an
        // adapter with no core. Reverse order means every dependent has
        // already been visited, so the block propagates down the chain.
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
                if (entry_for(pack.name))
                {
                    kept_names.add(pack.name);
                }
                continue;
            }
            const entry = entry_for(pack.name);
            if (!entry)
            {
                continue;
            }
            if (dry_run)
            {
                outcomes.push({name: pack.name, action: 'removed', version: entry.version});
                continue;
            }
            const refusal = delete_detail(
                delete_files(entry.files, target_root, others_claim(pack.name)),
                target_root,
            );
            if (refusal)
            {
                // The entry stays: forgetting it would strand whatever is
                // still on disk with nothing left tracking it.
                failed_names.add(pack.name);
                outcomes.push({name: pack.name, action: 'failed', detail: refusal});
                continue;
            }
            forget_for(pack.name);
            outcomes.push({name: pack.name, action: 'removed', version: entry.version});
        }
        return {...base, packs: outcomes, status: status_of(outcomes), hint: kept_hint(kept_names)};
    }

    // install and update both need the repository contents. update only touches
    // packs the journal already knows about.
    const targets = operation === 'update'
        ? packs.filter(p=>entry_for(p.name))
        : packs;
    const pending = targets.filter(p=>{
        const entry = entry_for(p.name);
        return operation === 'update' || !entry || !entry.complete || entry.version !== p.version
            || !entry_files_present(entry);
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
            outcomes.push(copied_outcome(pack.name, pack.version, previous_for(pack.name)));
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
    // Stamped only now that a clone actually happened this run — every
    // return past this point reports the commit this run cloned, never a
    // journal entry from some earlier run or a sibling host.
    const cloned_base: Host_outcome = {...base, commit: cloned.commit};

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
            const previously_installed = previous_for(pack.name);
            const elsewhere = others_claim(pack.name);
            const known_files = previous
                ? [...previous.files.map(f=>path.resolve(f)), ...elsewhere]
                : [...elsewhere];
            const skill_dirs = fs.readdirSync(from, {withFileTypes: true}).filter(e=>e.isDirectory());
            const collision = skill_dirs.find(skill=>{
                const dst_dir = path.join(target_root, skill.name);
                return fs.existsSync(dst_dir) && !owns_dir(dst_dir, known_files, canonicalise);
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
                // Best-effort: a file that survives here is either overwritten
                // by the copy below or fails it, and either way the copy's own
                // error path — not a silent skip — is what reaches the user.
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
            outcomes.push(copied_outcome(pack.name, pack.version, previously_installed, cloned.commit));
        }
    } catch (error) {
        // outcomes.length is not "something landed" — every entry pushed so
        // far could itself be a collision failure, so check the actions.
        const landed = outcomes.some(p=>p.action !== 'failed');
        return {
            ...cloned_base,
            status: landed ? 'partial' : 'failed',
            packs: outcomes,
            reason: 'copy-failed',
            detail: (error as Error).message,
            hint: blocked_hint(blocked_names) ?? 'check filesystem permissions for the skills directory, then re-run',
        };
    } finally {
        try {
            fs.rmSync(cloned.dir, {recursive: true, force: true});
        } catch {
            // Best-effort cleanup of the clone's temp directory — never masks
            // the result computed above.
        }
    }
    return {...cloned_base, packs: outcomes, status: status_of(outcomes), hint: blocked_hint(blocked_names)};
};

export {canonical, clone_repo, copy_dir, skills_target, run_flat};
export type {Clone_fn, Clone_result, Flat_opts};
