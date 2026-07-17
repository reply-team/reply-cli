import fs from 'fs';
import path from 'path';
import {credentials_file} from '../config';
import {RuntimeError} from '../utils/errors';
import type {Credential_record, CredentialStore} from './types';

type Key_map = Record<string, Credential_record>;

// v1 credential backend: a single JSON file keyed by profile name, written
// with strict 0600 perms in a 0700 dir (the gh/aws/az plaintext-file model).
class FileCredentialStore implements CredentialStore {
    private readonly file: string;

    constructor(file: string)
    {
        this.file = file;
    }

    async get(key: string): Promise<Credential_record | undefined>
    {
        return this.read()[key];
    }

    async set(key: string, record: Credential_record): Promise<void>
    {
        const map = this.read();
        map[key] = record;
        this.write(map);
    }

    async remove(key: string): Promise<boolean>
    {
        const map = this.read();
        if (!(key in map))
        {
            return false;
        }
        delete map[key];
        this.write(map);
        return true;
    }

    async keys(): Promise<string[]>
    {
        return Object.keys(this.read());
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
    private write(map: Key_map): void
    {
        const dir = path.dirname(this.file);
        fs.mkdirSync(dir, {recursive: true, mode: 0o700});
        fs.chmodSync(dir, 0o700);
        const tmp = `${this.file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(map, null, 2), {mode: 0o600});
        fs.chmodSync(tmp, 0o600);
        fs.renameSync(tmp, this.file);
    }
}

const default_credential_store = (): CredentialStore=>
    new FileCredentialStore(credentials_file());

export {FileCredentialStore, default_credential_store};
