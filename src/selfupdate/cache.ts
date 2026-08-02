import fs from 'fs';
import path from 'path';
import {update_check_file} from '../config';
import type {Env} from '../config';
import type {Channel} from './types';

// Unlike the skills journal, a damaged file here is not an error: this caches
// the answer to one question. Anything unreadable means "never checked", which
// costs a single HTTP request and repairs itself on the next write.

type Check_cache = {
    version: 1;
    channel: Channel;
    latest?: string;
    checked_at?: string;
    // Set when the last attempt failed, so a machine that has been offline all
    // day does not retry on every `--version`.
    failed_at?: string;
};

const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 60 * 1000;

const read_check_cache = (env?: Env): Check_cache | undefined=>{
    let raw: string;
    try {
        raw = fs.readFileSync(update_check_file(env), 'utf8');
    } catch {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return undefined;
    }
    const doc = parsed as Check_cache;
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)
        || (doc.channel !== 'public' && doc.channel !== 'internal'))
    {
        return undefined;
    }
    return doc;
};

const write_check_cache = (entry: Check_cache, env?: Env): void=>{
    const file = update_check_file(env);
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entry, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
};

// A cache written for one channel says nothing about the other, so switching
// package (public <-> internal) invalidates it outright.
const cache_is_fresh = (entry: Check_cache | undefined, channel: Channel, now: Date): boolean=>{
    if (!entry || entry.channel !== channel)
    {
        return false;
    }
    const stamp = entry.failed_at ?? entry.checked_at;
    if (!stamp)
    {
        return false;
    }
    const at = Date.parse(stamp);
    if (Number.isNaN(at))
    {
        return false;
    }
    const ttl = entry.failed_at ? FAILURE_TTL_MS : SUCCESS_TTL_MS;
    return now.getTime() - at < ttl;
};

export {read_check_cache, write_check_cache, cache_is_fresh, SUCCESS_TTL_MS, FAILURE_TTL_MS};
export type {Check_cache};
