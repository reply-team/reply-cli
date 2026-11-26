import {AsyncLocalStorage} from 'async_hooks';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {credentials_file} from '../config';
import {RuntimeError} from '../utils/errors';
import {take_lock, type Lock_opts} from './lock';
import type {Credential_record, CredentialStore} from './types';

type Key_map = Record<string, Credential_record>;

// On Windows a rename over a file another process has open can fail for a moment.
const RENAME_RETRY_MS = [20, 40, 80, 160, 320];
const RENAME_BUSY = ['EPERM', 'EACCES', 'EBUSY'];

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
        return this.read()[key];
    }

    async set(key: string, record: Credential_record): Promise<void>
    {
        await this.with_lock(async()=>{
            const map = this.read();
            map[key] = record;
            await this.write(map);
        });
    }

    async remove(key: string, only_if?: (record: Credential_record) => boolean): Promise<boolean>
    {
        return this.with_lock(async()=>{
            const map = this.read();
            if (!(key in map) || (only_if && !only_if(map[key])))
            {
                return false;
            }
            delete map[key];
            await this.write(map);
            return true;
        });
    }

    async keys(): Promise<string[]>
    {
        return Object.keys(this.read());
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

    private read(): Key_map
    {
        let raw: string;
        try {
            raw = fs.readFileSync(this.file, 'utf8');
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            {
                return {};
            }
            throw new RuntimeError('Could not read the credential store.', {
                code: 'store.read', detail: this.file,
                hint: (e as Error).message,
            });
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
    private async write(map: Key_map): Promise<void>
    {
        const dir = path.dirname(this.file);
        fs.mkdirSync(dir, {recursive: true, mode: 0o700});
        fs.chmodSync(dir, 0o700);
        // Two processes can share a pid, each in a pid namespace of its own: the name can't rest on it alone.
        const tmp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(map, null, 2), {mode: 0o600});
        fs.chmodSync(tmp, 0o600);
        for (let attempt = 0; ; attempt++)
        {
            try {
                fs.renameSync(tmp, this.file);
                return;
            } catch (e) {
                if (attempt >= RENAME_RETRY_MS.length || !RENAME_BUSY.includes(String((e as NodeJS.ErrnoException).code)))
                {
                    fs.rmSync(tmp, {force: true});
                    throw e;
                }
            }
            await new Promise(resolve=>setTimeout(resolve, RENAME_RETRY_MS[attempt]));
        }
    }
}

const default_credential_store = (): CredentialStore=>
    new FileCredentialStore(credentials_file());

export {FileCredentialStore, default_credential_store};
