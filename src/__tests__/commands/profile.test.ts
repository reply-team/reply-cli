import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {handle_rename, handle_delete, handle_show, parse_url, profile_command} from '../../commands/profile';
import {FileCredentialStore} from '../../credentials/file-store';
import {add_profile, set_current_profile, list_profiles, current_profile_name} from '../../profile';
import {UsageError} from '../../utils/errors';
import type {Credential_record} from '../../credentials/types';

let dir: string;
const env_for = (over: Record<string, string> = {})=>({REPLY_CONFIG_DIR: dir, ...over});
const store_for = ()=>new FileCredentialStore(path.join(dir, 'credentials.json'));
const api_key: Credential_record = {type: 'api_key', key: 'secret-xyz', user: {id: 1, username: 'alice'}};

// Capture both console.log (human path) and process.stdout.write (print/JSON path).
const capture = async(fn: () => Promise<void>): Promise<string>=>{
    const out: string[] = [];
    const log = console.log;
    const write = process.stdout.write;
    console.log = (...a: unknown[])=>{ out.push(a.join(' ')); };
    process.stdout.write = ((chunk: unknown): boolean=>{ out.push(String(chunk)); return true; }) as typeof process.stdout.write;
    try { await fn(); } finally { console.log = log; process.stdout.write = write; }
    return out.join('\n').trim();
};

beforeEach(()=>{ dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-cmd-')); });
afterEach(()=>{ fs.rmSync(dir, {recursive: true, force: true}); });

describe('handle_rename', ()=>{
    it('moves the stored credential from old key to new key', async()=>{
        add_profile('alice@reply.io', {}, env_for());
        const store = store_for();
        await store.set('alice@reply.io', api_key);
        await handle_rename('alice@reply.io', 'ally@reply.io', {}, {store, env: env_for()});
        expect(await store.get('alice@reply.io')).toBeUndefined();
        expect(await store.get('ally@reply.io')).toEqual(api_key);
        expect(list_profiles(env_for()).available).toContain('ally@reply.io');
    });

    it('renames a profile that has no stored credential (no-op on store)', async()=>{
        add_profile('dev', {}, env_for());
        const store = store_for();
        await handle_rename('dev', 'staging', {}, {store, env: env_for()});
        expect(list_profiles(env_for()).available).toContain('staging');
        expect(await store.keys()).toEqual([]);
    });

    it('refuses when a credential already exists under the target key', async()=>{
        add_profile('dev', {}, env_for());
        const store = store_for();
        await store.set('taken', api_key);
        await expect(handle_rename('dev', 'taken', {}, {store, env: env_for()})).rejects.toThrow(UsageError);
    });

    it('repoints the current profile when the renamed one was current', async()=>{
        add_profile('dev', {}, env_for());
        set_current_profile('dev', env_for());
        await handle_rename('dev', 'staging', {}, {store: store_for(), env: env_for()});
        expect(current_profile_name(env_for())).toBe('staging');
    });
});

describe('handle_delete', ()=>{
    const yes = async()=>true;
    const no = async()=>false;

    it('removes the profile def and its stored credential (with --yes)', async()=>{
        add_profile('dev', {}, env_for());
        const store = store_for();
        await store.set('dev', api_key);
        await handle_delete('dev', {yes: true}, {}, {store, env: env_for()});
        expect(list_profiles(env_for()).available).not.toContain('dev');
        expect(await store.get('dev')).toBeUndefined();
    });

    it('resets current to default when the deleted profile was current', async()=>{
        add_profile('dev', {}, env_for());
        set_current_profile('dev', env_for());
        await handle_delete('dev', {yes: true}, {}, {store: store_for(), env: env_for()});
        expect(current_profile_name(env_for())).toBe('default');
    });

    it('prompts and aborts without mutating when the user declines', async()=>{
        add_profile('dev', {}, env_for());
        const store = store_for();
        await store.set('dev', api_key);
        await handle_delete('dev', {}, {}, {store, env: env_for(), is_tty: true, confirm: no});
        expect(list_profiles(env_for()).available).toContain('dev');
        expect(await store.get('dev')).toEqual(api_key);
    });

    it('proceeds when the interactive prompt is accepted', async()=>{
        add_profile('dev', {}, env_for());
        await handle_delete('dev', {}, {}, {store: store_for(), env: env_for(), is_tty: true, confirm: yes});
        expect(list_profiles(env_for()).available).not.toContain('dev');
    });

    it('refuses in a non-interactive shell without --yes', async()=>{
        add_profile('dev', {}, env_for());
        await expect(
            handle_delete('dev', {}, {}, {store: store_for(), env: env_for(), is_tty: false}),
        ).rejects.toThrow(UsageError);
    });

    it('rejects deleting the built-in default', async()=>{
        await expect(
            handle_delete('default', {yes: true}, {}, {store: store_for(), env: env_for()}),
        ).rejects.toThrow(UsageError);
    });
});

describe('handle_show', ()=>{
    const oauth: Credential_record = {
        type: 'oauth', access_token: 'tok-SECRET', refresh_token: 'refresh-SECRET',
        expires_at: 4102444800000, user: {id: 3, username: 'alice', team_id: 5},
    };

    it('never prints a token or refresh token value', async()=>{
        add_profile('dev', {}, env_for());
        const store = store_for();
        await store.set('dev', oauth);
        const text = await capture(()=>handle_show('dev', {}, {store, env: env_for()}));
        expect(text).not.toContain('tok-SECRET');
        expect(text).not.toContain('refresh-SECRET');
        expect(text.toLowerCase()).toContain('oauth');
        expect(text).toContain('alice');
    });

    it('does not leak a stored api key value', async()=>{
        add_profile('dev', {}, env_for());
        const store = store_for();
        await store.set('dev', api_key);   // key: 'secret-xyz'
        const text = await capture(()=>handle_show('dev', {}, {store, env: env_for()}));
        expect(text).not.toContain('secret-xyz');
    });

    it('defaults to the current profile when no name is given', async()=>{
        add_profile('dev', {}, env_for());
        set_current_profile('dev', env_for());
        const text = await capture(()=>handle_show(undefined, {}, {store: store_for(), env: env_for()}));
        expect(text).toContain('dev');
    });

    it('emits JSON with no secret values', async()=>{
        add_profile('dev', {api_base: 'https://api.dev.reply.io/v3'}, env_for());
        const store = store_for();
        await store.set('dev', api_key);
        const text = await capture(()=>handle_show('dev', {json: true}, {store, env: env_for()}));
        const parsed = JSON.parse(text);
        expect(parsed.name).toBe('dev');
        expect(parsed.backend.inherited.authority).toBe(true);
        expect(parsed.authorization.stored.present).toBe(true);
        expect(parsed.authorization.stored.method).toBe('api_key');
        expect(JSON.stringify(parsed)).not.toContain('secret-xyz');
    });
});

describe('parse_url', ()=>{
    it('accepts http and https URLs', ()=>{
        expect(parse_url('https://api.reply.io/v3')).toBe('https://api.reply.io/v3');
        expect(parse_url('http://localhost:5000')).toBe('http://localhost:5000');
        expect(parse_url(undefined)).toBeUndefined();
    });

    it('rejects non-URLs and non-http(s) schemes', ()=>{
        expect(()=>parse_url('not a url')).toThrow(UsageError);
        expect(()=>parse_url('ftp://example.com')).toThrow(UsageError);
        expect(()=>parse_url('file:///etc/passwd')).toThrow(UsageError);
    });
});

describe('profile add — name is required (name-on-create)', ()=>{
    it('errors when no name is given', async()=>{
        profile_command.exitOverride();
        for (const c of profile_command.commands) { c.exitOverride(); }
        await expect(profile_command.parseAsync(['add'], {from: 'user'})).rejects.toThrow();
    });
});
