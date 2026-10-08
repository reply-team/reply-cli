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

// Reply numbers its sequences, contacts, lists and threads with positive 32-bit integers, so a
// value that is not one names nothing an account could hold and is refused before any call.
const parse_id = (raw: string, label: string): number=>{
    const value = raw.trim();
    if (!/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > LARGEST_REPLY_ID)
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

const parse_choice = <T extends string>(raw: string | undefined, label: string, allowed: readonly T[]): T | undefined=>{
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

// Reserved for Reply's idempotency keys. It is validated now, so a caller's key already has the
// shape the API will take, and otherwise unused until the API supports it.
const parse_idempotency_key = (raw: string | undefined): string | undefined=>{
    if (raw === undefined)
    {
        return undefined;
    }
    if (!/^[\x21-\x7e]{1,255}$/.test(raw))
    {
        throw new UsageError('--idempotency-key must be 1 to 255 printable characters without spaces.', {code: 'usage.idempotency_key'});
    }
    return raw;
};

const IDEMPOTENCY_KEY_HELP = 'Reserved: will make a repeated call exact once the Reply API supports idempotency keys; currently has no effect';

export {
    read_op_globals, parse_id, parse_int_in, parse_iso, parse_choice, parse_idempotency_key,
    LARGEST_REPLY_ID, IDEMPOTENCY_KEY_HELP,
};
export type {Op_globals};
