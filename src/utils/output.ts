import pc from 'picocolors';
import type {Credential_record} from '../credentials/types';

// Output contract: data goes to stdout; status/errors go to stderr. This keeps
// `--json` stdout clean for piping while humans still see progress messages.

const REDACTED = '••••••••';

// Fully mask a secret — reveals neither content nor length. `auth status`
// never prints a raw token; this guarantees it by construction.
const redact = (_secret: string): string=>REDACTED;

// A display/serialization-safe copy of a credential record with every secret
// field masked.
const safe_record = (record: Credential_record): Record<string, unknown>=>{
    if (record.type === 'oauth')
    {
        return {
            ...record,
            access_token: REDACTED,
            refresh_token: record.refresh_token ? REDACTED : undefined,
        };
    }
    return {...record, key: REDACTED};
};

const is_tty = process.stdout.isTTY === true;

// --quiet silences routine progress on stderr (info/success). Warnings and
// errors are never suppressed — they carry information the user still needs.
let quiet_mode = false;
const set_quiet = (on: boolean): void=>{quiet_mode = on;};

const success = (msg: string): void=>{if (!quiet_mode) console.error(pc.green(`✓ ${msg}`));};
const warn = (msg: string): void=>console.error(pc.yellow(`⚠ ${msg}`));
const info = (msg: string): void=>{if (!quiet_mode) console.error(pc.dim(msg));};

type Print_opts = {
    json?: boolean;
    pretty?: boolean;
};

const serialize = (data: unknown, opts: Print_opts): string=>{
    if (opts.pretty)
    {
        return JSON.stringify(data, null, 2);
    }
    if (opts.json)
    {
        return JSON.stringify(data);
    }
    if (typeof data === 'string')
    {
        return data;
    }
    return JSON.stringify(data, null, 2);
};

const print = (data: unknown, opts: Print_opts = {}): void=>{
    process.stdout.write(serialize(data, opts) + '\n');
};

export {is_tty, pc, REDACTED, redact, safe_record, set_quiet, success, warn, info, print};
export type {Print_opts};
