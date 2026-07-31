import fs from 'fs';
import path from 'path';
import {skills_file} from '../config';
import {RuntimeError} from '../utils/errors';
import type {Env} from '../config';
import type {Scope} from './types';

// Installer-side state, and only for flat-directory hosts: native hosts are
// asked directly (`plugin list --json`), so there is no second copy of the
// truth to drift. This records what we wrote so `update` is idempotent and
// `remove` deletes our files and nothing else.

type Journal_entry = {
    version: string;
    ref: string;
    commit?: string;
    scope: Scope;
    // The resolved project root a project-scope entry belongs to. The key
    // below is host -> scope -> pack, which cannot tell two checkouts apart:
    // without this, `remove --project` run from a second repository finds the
    // first one's entry, deletes nothing (containment refuses every path) and
    // still forgets the entry. Absent on user-scope entries, whose directory
    // is the home directory and therefore unambiguous.
    project_root?: string;
    // Absolute paths written by the flat adapter.
    files: string[];
    // False when the copy this entry describes did not finish — a version
    // match alone is not enough to call a pack installed, since a failed
    // copy can land partway through, at the target version, with some files
    // on disk and some not. An incomplete entry must never be reported
    // `current` and must always be treated as work still to do.
    complete: boolean;
    installed_at: string;
};

// Keyed host -> scope -> pack, so a user-scope install and a project-scope
// install of the same pack on the same host never share an entry: consulting
// or forgetting one must never look, or delete, in the other's target
// directory (see adapter-flat.ts, which resolves a different directory per
// scope).
type Journal = {
    version: 1;
    hosts: Record<string, Record<string, Record<string, Journal_entry>>>;
};

const CORRUPT_HINT = 'Delete the file and re-run `reply skills install`.';

const read_journal = (env?: Env): Journal=>{
    const file = skills_file(env);
    let raw: string;
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        {
            return {version: 1, hosts: {}};
        }
        throw new RuntimeError('Could not read the skills journal.', {
            code: 'skills.journal_read',
            detail: file,
            hint: (e as Error).message,
        });
    }
    if (!raw.trim())
    {
        return {version: 1, hosts: {}};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new RuntimeError('The skills journal is corrupt (invalid JSON).', {
            code: 'skills.journal_corrupt',
            detail: file,
            hint: CORRUPT_HINT,
        });
    }
    const doc = parsed as Journal;
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || typeof doc.hosts !== 'object' || !doc.hosts)
    {
        throw new RuntimeError('The skills journal is corrupt (unexpected shape).', {
            code: 'skills.journal_corrupt',
            detail: file,
            hint: CORRUPT_HINT,
        });
    }
    return {version: 1, hosts: doc.hosts};
};

const write_journal = (journal: Journal, env?: Env): void=>{
    const file = skills_file(env);
    const dir = path.dirname(file);
    fs.mkdirSync(dir, {recursive: true, mode: 0o700});
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(journal, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
};

const journal_entry = (host: string, scope: Scope, pack: string, env?: Env): Journal_entry | undefined=>
    read_journal(env).hosts[host]?.[scope]?.[pack];

const record_pack = (host: string, scope: Scope, pack: string, entry: Journal_entry, env?: Env): void=>{
    const journal = read_journal(env);
    const scopes = journal.hosts[host] ?? {};
    scopes[scope] = {...(scopes[scope] ?? {}), [pack]: entry};
    journal.hosts[host] = scopes;
    write_journal(journal, env);
};

const forget_pack = (host: string, scope: Scope, pack: string, env?: Env): Journal_entry | undefined=>{
    const journal = read_journal(env);
    const scopes = journal.hosts[host];
    const packs = scopes?.[scope];
    const existing = packs?.[pack];
    if (!existing)
    {
        return undefined;
    }
    delete packs[pack];
    if (!Object.keys(packs).length)
    {
        delete scopes![scope];
    }
    if (scopes && !Object.keys(scopes).length)
    {
        delete journal.hosts[host];
    }
    write_journal(journal, env);
    return existing;
};

export {read_journal, write_journal, journal_entry, record_pack, forget_pack};
export type {Journal, Journal_entry};
