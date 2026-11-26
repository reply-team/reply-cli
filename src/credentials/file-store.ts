import {AsyncLocalStorage} from 'async_hooks';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {credentials_file} from '../config';
import {RuntimeError} from '../utils/errors';
import {take_lock, type Lock_opts} from './lock';
import type {Credential_record, CredentialStore} from './types';

type Key_map = Record<string, Credential_record>;

// On Windows, while another program has the file open (an antivirus scan or a backup can take
// seconds), a read of it and a rename over it can be refused. A write's read and rename wait out
// those refusals from one copy of these waits: about 5 s in all, so that with the token request a
// refresh still lets go of the lock before it counts as stale.
const BUSY_RETRY_MS = [20, 40, 80, 160, 320, 640, 1_000, 1_000, 1_000, 1_000];
const BUSY = ['EPERM', 'EACCES', 'EBUSY'];

const pause = (ms: number): Promise<void>=>new Promise(resolve=>setTimeout(resolve, ms));

// v1 credential backend: a single JSON file keyed by profile name, written
// with strict 0600 perms in a 0700 dir (the gh/aws/az plaintext-file model).
// Every write is a read-modify-write of the whole file under the lock beside it.
class FileCredentialStore implements CredentialStore {
    private readonly file: string;
    private readonly lock_opts: Lock_opts;
    private readonly locked = new AsyncLocalStorage<boolean>();

    constructor(file: string, opts: {lock?: Lock_opts} = {})
    {
        this.file = file;
        this.lock_opts = opts.lock ?? {};
    }

    async get(key: string): Promise<Credential_record | undefined>
    {
        return (await this.read())[key];
    }

    async set(key: string, record: Credential_record): Promise<void>
    {
        await this.with_lock(async()=>{
            const waits = [...BUSY_RETRY_MS];
            const map = await this.read(waits);
            map[key] = record;
            await this.write(map, waits);
        });
    }

    async remove(key: string, only_if?: (record: Credential_record) => boolean): Promise<boolean>
    {
        return this.with_lock(async()=>{
            const waits = [...BUSY_RETRY_MS];
            const map = await this.read(waits);
            if (!(key in map) || (only_if && !only_if(map[key])))
            {
                return false;
            }
            delete map[key];
            await this.write(map, waits);
            return true;
        });
    }

    async keys(): Promise<string[]>
    {
        return Object.keys(await this.read());
    }

    async with_lock<T>(fn: () => Promise<T>): Promise<T>
    {
        if (this.locked.getStore())
        {
            return fn();
        }
        const release = await take_lock(`${this.file}.lock`, this.lock_opts);
        try {
            return await this.locked.run(true, fn);
        } finally {
            await release();
        }
    }

    // Only the read a write starts with waits, from the write's `waits`, and only on Windows:
    // elsewhere these codes are a permission no wait fixes. A plain read fails at once and loses
    // nothing, since a refresh reads before it sends its request; waiting there would add to its
    // time under the lock.
    private async read(waits: number[] = []): Promise<Key_map>
    {
        let raw: string;
        for (;;)
        {
            try {
                raw = fs.readFileSync(this.file, 'utf8');
                break;
            } catch (e) {
                const code = (e as NodeJS.ErrnoException).code;
                if (code === 'ENOENT')
                {
                    return {};
                }
                const wait = process.platform === 'win32' && BUSY.includes(String(code)) ? waits.shift() : undefined;
                if (wait === undefined)
                {
                    throw new RuntimeError('Could not read the credential store.', {
                        code: 'store.read', detail: this.file,
                        hint: (e as Error).message,
                    });
                }
                await pause(wait);
            }
        }
        if (!raw.trim())
        {
            return {};
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new RuntimeError('Credential store is corrupt (invalid JSON).', {
                code: 'store.corrupt', detail: this.file,
                hint: 'Delete the file and log in again.',
            });
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        {
            throw new RuntimeError('Credential store is corrupt (unexpected shape).', {
                code: 'store.corrupt', detail: this.file,
                hint: 'Delete the file and log in again.',
            });
        }
        return parsed as Key_map;
    }

    // Atomic write: temp file created 0600, then renamed into place so the
    // final file is never briefly world-readable and rewrites keep 0600.
    private async write(map: Key_map, waits: number[]): Promise<void>
    {
        const dir = path.dirname(this.file);
        fs.mkdirSync(dir, {recursive: true, mode: 0o700});
        fs.chmodSync(dir, 0o700);
        // Two processes can share a pid, each in a pid namespace of its own: the name can't rest on it alone.
        const tmp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(map, null, 2), {mode: 0o600});
        fs.chmodSync(tmp, 0o600);
        for (;;)
        {
            try {
                fs.renameSync(tmp, this.file);
                return;
            } catch (e) {
                const wait = BUSY.includes(String((e as NodeJS.ErrnoException).code)) ? waits.shift() : undefined;
                if (wait === undefined)
                {
                    fs.rmSync(tmp, {force: true});
                    throw e;
                }
                await pause(wait);
            }
        }
    }
}

const default_credential_store = (): CredentialStore=>
    new FileCredentialStore(credentials_file());

export {FileCredentialStore, default_credential_store};
