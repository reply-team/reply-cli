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

const EMPTY: Journal = {version: 1, hosts: {}};

const read_journal = (env?: Env): Journal=>{
    const file = skills_file(env);
    let raw: string;
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch {
        return {version: 1, hosts: {}};
    }
    if (!raw.trim())
    {
        return {version: 1, hosts: {}};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new RuntimeError('The skills journal is corrupt.', {
            code: 'skills.journal_corrupt',
            detail: file,
            hint: 'Delete the file and re-run `reply skills install`.',
        });
    }
    const doc = parsed as Journal;
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || typeof doc.hosts !== 'object' || !doc.hosts)
    {
        throw new RuntimeError('The skills journal is corrupt.', {
            code: 'skills.journal_corrupt',
            detail: file,
            hint: 'Delete the file and re-run `reply skills install`.',
        });
    }
    return {version: 1, hosts: doc.hosts};
};

const write_journal = (journal: Journal, env?: Env): void=>{
    const file = skills_file(env);
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
    fs.writeFileSync(file, JSON.stringify(journal, null, 2) + '\n', 'utf8');
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

export {EMPTY, read_journal, write_journal, journal_entry, record_pack, forget_pack};
export type {Journal, Journal_entry};
