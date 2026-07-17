import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {FileCredentialStore} from '../../credentials/file-store';
import {RuntimeError} from '../../utils/errors';
import type {Credential_record} from '../../credentials/types';

const POSIX = process.platform !== 'win32';

const OAUTH: Credential_record = {
    type: 'oauth',
    access_token: 'at',
    refresh_token: 'rt',
    expires_at: 1_700_000_000_000,
    user: {username: 'oleg@reply.io', id: 1},
};
const API_KEY: Credential_record = {type: 'api_key', key: 'sk_test', user: {username: 'ann@reply.io'}};

let dir: string;
let file: string;
let store: FileCredentialStore;

beforeEach(()=>{
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-store-'));
    file = path.join(dir, 'nested', 'credentials.json');
    store = new FileCredentialStore(file);
});

afterEach(()=>{
    fs.rmSync(dir, {recursive: true, force: true});
});

describe('credentials/FileCredentialStore', ()=>{
    it('returns undefined for a host before anything is stored', async()=>{
        expect(await store.get('oauth.dev.replyapp.io')).toBeUndefined();
        expect(await store.keys()).toEqual([]);
    });

    it('round-trips a record for a host', async()=>{
        await store.set('oauth.dev.replyapp.io', OAUTH);
        expect(await store.get('oauth.dev.replyapp.io')).toEqual(OAUTH);
    });

    it('keeps records per-host isolated', async()=>{
        await store.set('oauth.dev.replyapp.io', OAUTH);
        await store.set('api.reply.io', API_KEY);
        expect(await store.get('oauth.dev.replyapp.io')).toEqual(OAUTH);
        expect(await store.get('api.reply.io')).toEqual(API_KEY);
        expect((await store.keys()).sort()).toEqual(['api.reply.io', 'oauth.dev.replyapp.io']);
    });

    it('overwrites an existing host record', async()=>{
        await store.set('h', OAUTH);
        await store.set('h', API_KEY);
        expect(await store.get('h')).toEqual(API_KEY);
    });

    it('remove deletes a host and reports whether it existed', async()=>{
        await store.set('h', API_KEY);
        expect(await store.remove('h')).toBe(true);
        expect(await store.get('h')).toBeUndefined();
        expect(await store.remove('h')).toBe(false);
    });

    it('does not disturb other hosts on remove', async()=>{
        await store.set('a', OAUTH);
        await store.set('b', API_KEY);
        await store.remove('a');
        expect(await store.get('b')).toEqual(API_KEY);
    });

    it.skipIf(!POSIX)('writes the file with 0600 permissions', async()=>{
        await store.set('h', API_KEY);
        const mode = fs.statSync(file).mode & 0o777;
        expect(mode).toBe(0o600);
    });

    it.skipIf(!POSIX)('creates the parent config dir with 0700 permissions', async()=>{
        await store.set('h', API_KEY);
        const mode = fs.statSync(path.dirname(file)).mode & 0o777;
        expect(mode).toBe(0o700);
    });

    it.skipIf(!POSIX)('keeps 0600 after a rewrite', async()=>{
        await store.set('h', API_KEY);
        await store.set('h2', OAUTH);
        const mode = fs.statSync(file).mode & 0o777;
        expect(mode).toBe(0o600);
    });

    it('treats an empty file as no credentials', async()=>{
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, '');
        expect(await store.keys()).toEqual([]);
    });

    it('throws a RuntimeError on a corrupt store file', async()=>{
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, '{ this is not json');
        await expect(store.get('h')).rejects.toBeInstanceOf(RuntimeError);
        await expect(store.get('h')).rejects.toMatchObject({code: 'store.corrupt', detail: file});
    });

    it('throws a RuntimeError when the file holds a non-object', async()=>{
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, '["nope"]');
        await expect(store.keys()).rejects.toBeInstanceOf(RuntimeError);
    });
});
