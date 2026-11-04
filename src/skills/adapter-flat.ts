import fs from 'fs';
import os from 'os';
import path from 'path';
import {forget_pack, journal_entry, read_journal, record_pack} from './journal';
import {pack_dir} from './packs';
import type {Env} from '../config';
import type {Detected_host} from './detect';
import type {Journal_entry} from './journal';
import type {Host_def, Host_outcome, Operation, Pack, Pack_outcome, Scope} from './types';

// Every host receives a pack as a directory of skills, so installing is a
// copy: from the pack's directory in this CLI's own package into the host's
// skills directory. Nothing is downloaded and no other program is run.

// Where this host reads skills from, for the requested scope.
const skills_target = (def: Host_def, scope: Scope, home: string, cwd: string): string=>
    scope === 'project'
        ? path.join(cwd, def.project_skills_dir)
        : path.join(home, def.user_skills_dir);

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

// Whether the files an entry claims are still there. A complete entry at the
// right version says nothing about the filesystem, so `install` and `list` ask
// this before reporting a pack installed. Canonical form too, so this agrees
// with owns_dir about a path recorded in a different spelling.
const entry_files_present = (
    entry: Journal_entry,
    canonicalise: (target: string)=>string = canonical,
): boolean=>
    entry.files.every(file=>fs.existsSync(file) || fs.existsSync(canonicalise(file)));

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

// The path as the filesystem spells it, so two spellings of one file compare
// equal — `path.relative` is case-sensitive on POSIX while macOS is not. Only
// answerable for a path that exists; anything else comes back resolved.
const canonical = (target: string): string=>{
    try {
        return fs.realpathSync.native(target);
    } catch {
        return path.resolve(target);
    }
};

// True when every file under `dir` is accounted for by files we already know
// about — our own previous install, or a sibling host's at a shared directory.
// Anything else there is foreign and must not be clobbered. Raw comparison keeps
// this agreeing with delete_files; canonical recognises our own skill through a
// case difference, without which an install refuses a file it wrote itself.
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

// 'ok' with no failures, 'failed' when every pack in this operation failed,
// 'partial' otherwise.
const status_of = (packs: Pack_outcome[]): Host_outcome['status']=>{
    const failed = packs.filter(p=>p.action === 'failed');
    if (!failed.length)
    {
        return 'ok';
    }
    return failed.length === packs.length ? 'failed' : 'partial';
};

// A copy that landed at the version the pack was already on is not an
// upgrade, so `current` means one thing everywhere. But "the version moved"
// and "the bytes moved" are two different facts: repairing an install that
// never finished rewrites files at an unchanged version. `current` cannot say
// that, so `refreshed` does — otherwise a run that really did rewrite the
// user's files reads as a no-op and the reporter never tells them to start a
// new session.
//
// `from` is the version the host had before — a journal entry's, or the old
// plugin's this copy replaces — and undefined when it had none.
const copied_outcome = (
    pack_name: string,
    version: string,
    from: string | undefined,
    repaired = false,
): Pack_outcome=>{
    if (from === undefined)
    {
        return {name: pack_name, action: 'installed', version};
    }
    if (from !== version)
    {
        return {name: pack_name, action: 'upgraded', version, from};
    }
    return repaired
        ? {name: pack_name, action: 'current', version, refreshed: true}
        : {name: pack_name, action: 'current', version};
};

type Flat_opts = {
    operation: Operation;
    host: Detected_host;
    packs: Pack[];
    scope: Scope;
    home?: string;
    cwd?: string;
    env?: Env;
    dry_run?: boolean;
    // The directory holding each pack's directory of skills; the package's
    // own `skills` by default.
    source?: string;
    // Packs the host has as a plugin an earlier version installed, by name and
    // version: `update` copies them too, and an outcome counts from there.
    adopt?: Record<string, string>;
    // Injected like detect.ts's `exists`, so case handling is assertable without
    // depending on the runner's filesystem. Defaults to asking the OS.
    canonicalise?: (target: string)=>string;
};

const run_flat = async(opts: Flat_opts): Promise<Host_outcome>=>{
    const {operation, host, packs, scope} = opts;
    const home = opts.home ?? os.homedir();
    const cwd = opts.cwd ?? process.cwd();
    const dry_run = opts.dry_run === true;
    const canonicalise = opts.canonicalise ?? canonical;
    const source = opts.source ?? path.dirname(pack_dir());
    const adopt = opts.adopt ?? {};
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
        return entry && entry_files_present(entry, canonicalise) ? entry : undefined;
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
            if (!entry.complete || !entry_files_present(entry, canonicalise))
            {
                outcomes.push({
                    name: pack.name,
                    action: 'failed',
                    detail: pack.retired
                        ? 'installation incomplete; this CLI no longer offers the pack, so `reply skills remove` clears it'
                        : 'installation incomplete; run `reply skills install` to repair',
                });
                continue;
            }
            if (pack.retired)
            {
                outcomes.push({name: pack.name, action: 'current', version: entry.version, retired: true});
                continue;
            }
            outcomes.push(entry.version === pack.version
                ? {name: pack.name, action: 'current', version: entry.version}
                : {name: pack.name, action: 'upgraded', version: pack.version, from: entry.version});
        }
        return {...base, packs: outcomes, status: status_of(outcomes)};
    }

    const target_root = skills_target(host.def, scope, home, cwd);

    if (operation === 'remove')
    {
        for (const pack of packs)
        {
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
                outcomes.push({name: pack.name, action: 'failed', detail: refusal});
                continue;
            }
            forget_for(pack.name);
            outcomes.push({name: pack.name, action: 'removed', version: entry.version});
        }
        return {...base, packs: outcomes, status: status_of(outcomes)};
    }

    // install and update both copy. update only touches packs the host
    // already has: a journal entry, or the old plugin this copy replaces.
    const targets = operation === 'update'
        ? packs.filter(p=>entry_for(p.name) || adopt[p.name] !== undefined)
        : packs;
    const pending = targets.filter(p=>{
        const entry = entry_for(p.name);
        return !entry || !entry.complete || entry.version !== p.version
            || !entry_files_present(entry, canonicalise);
    });
    for (const pack of targets)
    {
        if (!pending.includes(pack))
        {
            outcomes.push({name: pack.name, action: 'current', version: pack.version});
        }
    }
    // The version the host had before this copy: our own complete copy's, or
    // the old plugin's this copy replaces.
    const from_for = (pack_name: string): {from?: string; repaired: boolean}=>{
        const previous = previous_for(pack_name);
        return previous
            ? {from: previous.version, repaired: !previous.complete}
            : {from: adopt[pack_name], repaired: false};
    };
    if (!pending.length)
    {
        return {...base, packs: outcomes};
    }
    if (dry_run)
    {
        for (const pack of pending)
        {
            outcomes.push(copied_outcome(pack.name, pack.version, from_for(pack.name).from));
        }
        return {...base, packs: outcomes};
    }

    // A per-host filesystem failure here (a read-only destination, a package
    // missing its pack, a journal write error) must become a Host_outcome,
    // never a rejected promise — one host failing must never abort the
    // others, and any pack already installed and journaled before the failure
    // still counts.
    try {
        for (const pack of pending)
        {
            const previous = entry_for(pack.name);
            const {from, repaired} = from_for(pack.name);
            const elsewhere = others_claim(pack.name);
            const known_files = previous
                ? [...previous.files.map(f=>path.resolve(f)), ...elsewhere]
                : [...elsewhere];
            const pack_source = path.join(source, pack.name);
            const skill_dirs = fs.readdirSync(pack_source, {withFileTypes: true}).filter(e=>e.isDirectory());
            const collision = skill_dirs.find(skill=>{
                const dst_dir = path.join(target_root, skill.name);
                return fs.existsSync(dst_dir) && !owns_dir(dst_dir, known_files, canonicalise);
            });
            if (collision)
            {
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
                    copy_dir(path.join(pack_source, skill.name), path.join(target_root, skill.name), written);
                }
            } catch (copy_error) {
                // Whatever landed before the failure — possibly nothing — is
                // journaled as incomplete, never as done: a version match
                // alone must never read as installed when the copy did not
                // finish, or `install`'s own hint to re-run would do nothing.
                record_for(pack.name, {
                    version: pack.version, scope,
                    files: written, complete: false, installed_at: new Date().toISOString(),
                });
                throw copy_error;
            }
            record_for(pack.name, {
                version: pack.version,
                scope,
                files: written,
                complete: true,
                installed_at: new Date().toISOString(),
            });
            outcomes.push(copied_outcome(pack.name, pack.version, from, repaired));
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
            hint: 'check filesystem permissions for the skills directory, then re-run',
        };
    }
    return {...base, packs: outcomes, status: status_of(outcomes)};
};

export {canonical, copy_dir, skills_target, status_of, run_flat};
export type {Flat_opts};
