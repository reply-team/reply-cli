import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {TOKEN_TIMEOUT_MS} from '../auth/token';
import {RuntimeError} from '../utils/errors';

// A lock file beside the credentials file, created exclusively, so one reply process at a time
// reads, refreshes and writes the sign-in. Several commands started together would otherwise each
// spend the same one-time refresh token, and all but one would be refused.
//
// Only a create puts a lock in place, and it fails while one is there. Every removal of a lock, a
// holder letting go or a stale one taken over, happens under a second exclusive file, the guard,
// after reading the lock again: so the lock read is the lock removed, and no process removes a
// lock it has not just checked.

type Lock_opts = {
    wait_ms?: number;    // how long to wait for another holder before giving up
    stale_ms?: number;   // a lock held longer than this is taken over, its holder alive or not
};

// The longest a holder needs is one token request and one write. A waiter outlasts a stale lock,
// so a holder that hangs never blocks the others for good.
const LOCK_STALE_MS = TOKEN_TIMEOUT_MS + 10_000;
const LOCK_WAIT_MS = LOCK_STALE_MS + 15_000;
const POLL_MS = 50;
// The guard is held for a read and an unlink; one this old was left by a process that died holding it.
const GUARD_STALE_MS = 5_000;
// How long Windows may refuse a create with no lock in place: a lock being deleted refuses it for
// a moment, and a directory that can't be written refuses it for good.
const CREATE_GRACE_MS = 1_000;
const RELEASE_RETRY_MS = [20, 40, 80, 160, 320];
const WINDOWS_BUSY = ['EPERM', 'EACCES', 'EBUSY'];

// A pid means something only in its own pid namespace: sandboxes and containers that give each
// command a namespace of its own give them all the same pid, or each other's. Linux names the
// namespace; elsewhere there is none to tell apart.
const PID_NS = ((): string | undefined=>{
    try {
        return fs.readlinkSync('/proc/self/ns/pid');
    } catch {
        return undefined;
    }
})();

// The locks this process let go of but couldn't delete, by id: the only locks with this process's
// pid that are known not to be held.
const left_here = new Set<string>();

const new_id = (): string=>crypto.randomBytes(8).toString('hex');

class Lock_timeout_error extends RuntimeError {
    constructor(file: string)
    {
        super('Another reply process kept the credential store locked.', {
            code: 'store.locked', detail: file,
            hint: 'Run the command again. If no other reply process is running, delete the lock file.',
        });
        this.name = 'Lock_timeout_error';
    }
}

const lock_error = (file: string, e: unknown): RuntimeError=>new RuntimeError('Could not lock the credential store.', {
    code: 'store.lock', detail: file, hint: (e as Error).message,
});

const alive = (pid: number): boolean=>{
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
};

const read_lock = (file: string): {text: string; mtime_ms: number} | undefined=>{
    try {
        return {text: fs.readFileSync(file, 'utf8'), mtime_ms: fs.statSync(file).mtimeMs};
    } catch {
        return undefined;
    }
};

const quietly = (fn: () => void): void=>{
    try {
        fn();
    } catch {
        // Best effort: a lock or guard left behind is taken over by the rules above.
    }
};

// A lock that can't be read as a holder (cut off before it was written) is judged by the file's age.
// Its pid is trusted only on the host and in the pid namespace that wrote it; anywhere else, a pid
// that looks gone, or looks like this process's own, may be a live peer's.
const is_stale = (held: {text: string; mtime_ms: number}, stale_ms: number): boolean=>{
    let holder: {pid?: unknown; host?: unknown; ns?: unknown; id?: unknown; taken_at?: unknown} | null = null;
    try {
        holder = JSON.parse(held.text);
    } catch {
        holder = null;
    }
    const taken_at = typeof holder?.taken_at === 'number' ? holder.taken_at : held.mtime_ms;
    if (Date.now() - taken_at > stale_ms)
    {
        return true;
    }
    if (typeof holder?.pid !== 'number' || holder.host !== os.hostname() || holder.ns !== PID_NS)
    {
        return false;
    }
    if (holder.pid === process.pid)
    {
        return typeof holder.id === 'string' && left_here.has(holder.id);
    }
    return !alive(holder.pid);
};

// One attempt at the guard; what lets it go, or undefined when another process has it.
const try_guard = (file: string): (() => void) | undefined=>{
    const guard = `${file}.guard`;
    try {
        fs.writeFileSync(guard, JSON.stringify({pid: process.pid, id: new_id()}), {flag: 'wx', mode: 0o600});
        return ()=>quietly(()=>fs.unlinkSync(guard));
    } catch {
        const held = read_lock(guard);
        if (held && Date.now() - held.mtime_ms > GUARD_STALE_MS)
        {
            quietly(()=>{
                if (fs.readFileSync(guard, 'utf8') === held.text)
                {
                    fs.unlinkSync(guard);
                }
            });
        }
        return undefined;
    }
};

// Removes the lock if it still reads `text`. False when it doesn't, or the guard is busy.
const remove_if_still = (file: string, text: string): boolean=>{
    const release_guard = try_guard(file);
    if (!release_guard)
    {
        return false;
    }
    try {
        if (fs.readFileSync(file, 'utf8') !== text)
        {
            return false;
        }
        fs.unlinkSync(file);
        return true;
    } catch {
        return false;
    } finally {
        release_guard();
    }
};

// Letting go never fails the command. A lock left behind is taken over by this process's next write
// at once, and by any other process once this one has ended or the lock is stale by its age.
const release = async(file: string, mine: string, id: string): Promise<void>=>{
    for (const wait of [...RELEASE_RETRY_MS, 0])
    {
        if (remove_if_still(file, mine) || read_lock(file)?.text !== mine)
        {
            return;
        }
        if (wait)
        {
            await new Promise(resolve=>setTimeout(resolve, wait));
        }
    }
    left_here.add(id);
};

// Takes the lock, waiting for a live holder, and returns what lets it go.
const take_lock = async(file: string, opts: Lock_opts = {}): Promise<() => Promise<void>>=>{
    const wait_ms = opts.wait_ms ?? LOCK_WAIT_MS;
    const stale_ms = opts.stale_ms ?? LOCK_STALE_MS;
    const started = Date.now();
    let refused_since: number | undefined;
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
    for (;;)
    {
        const id = new_id();
        const mine = JSON.stringify({pid: process.pid, host: os.hostname(), ns: PID_NS, id, taken_at: Date.now()});
        let windows_refusal: unknown;
        try {
            fs.writeFileSync(file, mine, {flag: 'wx', mode: 0o600});
            return ()=>release(file, mine, id);
        } catch (e) {
            const code = (e as NodeJS.ErrnoException).code;
            if (process.platform === 'win32' && WINDOWS_BUSY.includes(String(code)))
            {
                windows_refusal = e;
            }
            else if (code !== 'EEXIST')
            {
                throw lock_error(file, e);
            }
        }
        const held = read_lock(file);
        if (held)
        {
            refused_since = undefined;
            if (is_stale(held, stale_ms) && remove_if_still(file, held.text))
            {
                continue;
            }
        }
        else if (windows_refusal)
        {
            refused_since ??= Date.now();
            if (Date.now() - refused_since >= CREATE_GRACE_MS)
            {
                throw lock_error(file, windows_refusal);
            }
        }
        if (Date.now() - started >= wait_ms)
        {
            throw new Lock_timeout_error(file);
        }
        await new Promise(resolve=>setTimeout(resolve, POLL_MS + Math.random() * POLL_MS));
    }
};

export {take_lock, Lock_timeout_error};
export type {Lock_opts};
