import fs from 'fs';
import os from 'os';
import path from 'path';
import {default_runner} from './adapter-native';
import {forget_pack, journal_entry, record_pack} from './journal';
import {DEFAULT_REF, REPO} from './packs';
import type {Env} from '../config';
import type {Detected_host} from './detect';
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
        throw new Error((cloned.stderr || cloned.stdout).trim() || `git clone failed for ${url}`);
    }
    const head = await run('git', ['-C', dir, 'rev-parse', 'HEAD']);
    return {dir, commit: head.stdout.trim().slice(0, 7)};
};

// Where this host reads skills from, for the requested scope. A native host
// only lands here under --project, because its plugin mechanism is user-scoped.
const skills_target = (def: Host_def, scope: Scope, home: string, cwd: string): string=>
    scope === 'project'
        ? path.join(cwd, def.project_skills_dir as string)
        : path.join(home, def.user_skills_dir as string);

const copy_dir = (from: string, to: string): string[]=>{
    const written: string[] = [];
    fs.mkdirSync(to, {recursive: true});
    for (const entry of fs.readdirSync(from, {withFileTypes: true}))
    {
        const src = path.join(from, entry.name);
        const dst = path.join(to, entry.name);
        if (entry.isDirectory())
        {
            written.push(...copy_dir(src, dst));
            continue;
        }
        fs.copyFileSync(src, dst);
        written.push(dst);
    }
    return written;
};

// Removes the directories we created, and nothing else: a user-authored skill
// sitting next to ours is never touched because it is not in the journal.
const delete_files = (files: string[]): void=>{
    const dirs = new Set<string>();
    for (const file of files)
    {
        try {
            fs.rmSync(file, {force: true});
        } catch {
            // Already gone — removal stays idempotent.
        }
        dirs.add(path.dirname(file));
    }
    for (const dir of [...dirs].sort((a, b)=>b.length - a.length))
    {
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
    const outcomes: Pack_outcome[] = [];

    if (operation === 'list')
    {
        for (const pack of packs)
        {
            const entry = journal_entry(id, pack.name, opts.env);
            if (!entry)
            {
                continue;
            }
            outcomes.push(entry.version === pack.version
                ? {name: pack.name, action: 'current', version: entry.version}
                : {name: pack.name, action: 'upgraded', version: pack.version, from: entry.version});
        }
        return {...base, packs: outcomes};
    }

    if (operation === 'remove')
    {
        for (const pack of [...packs].reverse())
        {
            const entry = journal_entry(id, pack.name, opts.env);
            if (!entry)
            {
                continue;
            }
            if (!dry_run)
            {
                delete_files(entry.files);
                forget_pack(id, pack.name, opts.env);
            }
            outcomes.push({name: pack.name, action: 'removed', version: entry.version});
        }
        return {...base, packs: outcomes};
    }

    // install and update both need the repository contents. update only touches
    // packs the journal already knows about.
    const targets = operation === 'update'
        ? packs.filter(p=>journal_entry(id, p.name, opts.env))
        : packs;
    const pending = targets.filter(p=>{
        const entry = journal_entry(id, p.name, opts.env);
        return operation === 'update' || !entry || entry.version !== p.version;
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
            const entry = journal_entry(id, pack.name, opts.env);
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

    const target_root = skills_target(host.def, scope, home, cwd);
    try {
        for (const pack of pending)
        {
            const from = path.join(cloned.dir, 'plugins', pack.name, 'skills');
            const previous = journal_entry(id, pack.name, opts.env);
            if (previous)
            {
                delete_files(previous.files);
            }
            const written: string[] = [];
            for (const skill of fs.readdirSync(from, {withFileTypes: true}))
            {
                if (skill.isDirectory())
                {
                    written.push(...copy_dir(path.join(from, skill.name), path.join(target_root, skill.name)));
                }
            }
            record_pack(id, pack.name, {
                version: pack.version,
                ref,
                commit: cloned.commit,
                scope,
                files: written,
                installed_at: new Date().toISOString(),
            }, opts.env);
            outcomes.push(previous
                ? {name: pack.name, action: 'upgraded', version: pack.version, from: previous.version}
                : {name: pack.name, action: 'installed', version: pack.version});
        }
    } finally {
        fs.rmSync(cloned.dir, {recursive: true, force: true});
    }
    return {...base, packs: outcomes};
};

export {clone_repo, skills_target, run_flat};
export type {Clone_fn, Clone_result, Flat_opts};
