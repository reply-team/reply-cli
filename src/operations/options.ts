import type {Command} from 'commander';
import {UsageError} from '../utils/errors';

type Op_globals = {
    apiKey?: string;
    profile?: string;
    teamId?: string;
    userId?: string;
    userEmail?: string;
    json?: boolean;
    pretty?: boolean;
};

const read_op_globals = (cmd: Command): Op_globals=>{
    const o = cmd.optsWithGlobals();
    return {
        apiKey: o.apiKey, profile: o.profile,
        teamId: o.teamId, userId: o.userId, userEmail: o.userEmail,
        json: o.json, pretty: o.pretty,
    };
};

const LARGEST_REPLY_ID = 2147483647;
const LARGEST_SAFE_ID = Number.MAX_SAFE_INTEGER;

// Reply numbers its sequences, contacts, lists and threads with positive 32-bit integers, so a
// value that is not one names nothing an account could hold and is refused before any call. Its
// mailboxes are numbered in 64 bits; for them the bound is the largest whole number a JSON number
// carries exactly.
const parse_id = (raw: string, label: string, largest = LARGEST_REPLY_ID): number=>{
    const value = raw.trim();
    if (!/^[1-9][0-9]*$/.test(value) || Number(value) > largest)
    {
        // Not echoed when it looks like an address: stderr may be logged where personal data must not go.
        throw new UsageError(`${label} must be a Reply id: a positive whole number.`, {
            code: 'usage.id', hint: raw.includes('@') ? undefined : `Got: ${raw}`,
        });
    }
    return Number(value);
};

const parse_int_in = (raw: string | undefined, label: string, min: number, max: number, fallback: number): number=>{
    if (raw === undefined)
    {
        return fallback;
    }
    const value = raw.trim();
    if (!/^-?[0-9]+$/.test(value) || Number(value) < min || Number(value) > max)
    {
        throw new UsageError(`${label} must be a whole number from ${min} to ${max}.`, {code: 'usage.range', hint: `Got: ${raw}`});
    }
    return Number(value);
};

const ISO_8601 = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/i;

// ISO 8601 only: a date, or a date and a time. A time without a zone is taken as UTC, never as the
// machine's local time, which would shift a window silently.
const parse_iso = (raw: string, label: string): string=>{
    const m = ISO_8601.exec(raw.trim());
    const zone = m?.[3] === undefined ? 'Z' : m[3].toUpperCase().replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
    const at = m === null ? NaN : Date.parse(`${m[1]}T${m[2] ?? '00:00'}${zone}`);
    if (isNaN(at))
    {
        throw new UsageError(`${label} must be a date and time, e.g. 2026-10-01T00:00:00Z.`, {code: 'usage.date', hint: `Got: ${raw}`});
    }
    return new Date(at).toISOString();
};

const MOMENT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})$/i;

// A moment Reply acts at, such as a send's: a date and time with its offset, sent as the same instant
// in UTC. Without an offset the CLI would have to choose a zone for it, so one is refused.
const parse_moment = (raw: string, label: string): string=>{
    const m = MOMENT.exec(raw.trim());
    const at = m === null ? NaN : Date.parse(`${m[1]}T${m[2]}${m[3].toUpperCase().replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')}`);
    if (isNaN(at))
    {
        throw new UsageError(`${label} must be a date and time with its offset, e.g. 2026-11-03T14:00:00Z.`, {code: 'usage.date', hint: `Got: ${raw}`});
    }
    return new Date(at).toISOString();
};

// An Idempotency-Key header as Reply takes one: 1 to 255 printable ASCII characters. A space at
// either end is refused rather than trimmed away by the header on its way out.
const parse_idempotency_key = (raw: string): string=>{
    if (!/^[\x21-\x7e](?:[\x20-\x7e]{0,253}[\x21-\x7e])?$/.test(raw))
    {
        throw new UsageError('--idempotency-key must be 1 to 255 printable ASCII characters, with no space at either end.', {
            code: 'usage.idempotency_key',
        });
    }
    return raw;
};

const parse_choice =<T extends string>(raw: string | undefined, label: string, allowed: readonly T[]): T | undefined=>{
    if (raw === undefined)
    {
        return undefined;
    }
    if (!(allowed as readonly string[]).includes(raw))
    {
        throw new UsageError(`${label} must be one of: ${allowed.join(', ')}.`, {code: 'usage.choice', hint: `Got: ${raw}`});
    }
    return raw as T;
};

export {
    read_op_globals, parse_id, parse_int_in, parse_iso, parse_moment, parse_idempotency_key, parse_choice, LARGEST_REPLY_ID, LARGEST_SAFE_ID,
};
export type {Op_globals};
