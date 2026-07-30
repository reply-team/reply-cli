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
    // Absolute paths written by the flat adapter.
    files: string[];
    installed_at: string;
};

type Journal = {
    version: 1;
    hosts: Record<string, Record<string, Journal_entry>>;
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

const journal_entry = (host: string, pack: string, env?: Env): Journal_entry | undefined=>
    read_journal(env).hosts[host]?.[pack];

const record_pack = (host: string, pack: string, entry: Journal_entry, env?: Env): void=>{
    const journal = read_journal(env);
    journal.hosts[host] = {...(journal.hosts[host] ?? {}), [pack]: entry};
    write_journal(journal, env);
};

const forget_pack = (host: string, pack: string, env?: Env): Journal_entry | undefined=>{
    const journal = read_journal(env);
    const packs = journal.hosts[host];
    const existing = packs?.[pack];
    if (!existing)
    {
        return undefined;
    }
    delete packs[pack];
    if (!Object.keys(packs).length)
    {
        delete journal.hosts[host];
    }
    write_journal(journal, env);
    return existing;
};

export {read_journal, write_journal, journal_entry, record_pack, forget_pack};
export type {Journal, Journal_entry};
