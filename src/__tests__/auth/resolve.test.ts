import {describe, it, expect, vi} from 'vitest';
import {resolve_credential} from '../../auth/resolve';
import {UsageError} from '../../utils/errors';
import {APP_NAME} from '../../config';
import type {Credential_record, CredentialStore, Oauth_record} from '../../credentials/types';

const API_KEY_ENV = `${APP_NAME.toUpperCase()}_API_KEY`;
const HOST = 'api.dev.reply.io';
const NOW = 1_700_000_000_000;

const fake_store = (seed: Record<string, Credential_record> = {})=>{
    const map: Record<string, Credential_record> = {...seed};
    const store: CredentialStore = {
        get: vi.fn(async(h: string)=>map[h]),
        set: vi.fn(async(h: string, r: Credential_record)=>{map[h] = r;}),
        remove: vi.fn(async(h: string)=>{
            const had = h in map;
            delete map[h];
            return had;
        }),
        keys: vi.fn(async()=>Object.keys(map)),
    };
    return {store, map};
};

const fresh_oauth = (over: Partial<Oauth_record> = {}): Oauth_record=>({
    type: 'oauth', access_token: 'at', refresh_token: 'rt', expires_at: NOW + 3_600_000, ...over,
});

describe('auth/resolve — credential precedence', ()=>{
    it('1) --api-key flag wins, is ephemeral, and never touches the store', async()=>{
        const {store} = fake_store({[HOST]: {type: 'api_key', key: 'stored'}});
        const r = await resolve_credential({api_key: 'flagkey'}, {key: HOST, store, env: {[API_KEY_ENV]: 'envkey'}, now: NOW});
        expect(r).toMatchObject({token: 'flagkey', type: 'api_key', source: 'flag', ephemeral: true});
        expect(store.get).not.toHaveBeenCalled();
    });

    it('2) <PREFIX>_API_KEY env is used when no flag, ephemeral, store untouched', async()=>{
        const {store} = fake_store({[HOST]: {type: 'api_key', key: 'stored'}});
        const r = await resolve_credential({}, {key: HOST, store, env: {[API_KEY_ENV]: 'envkey'}, now: NOW});
        expect(r).toMatchObject({token: 'envkey', source: 'env', ephemeral: true});
        expect(store.get).not.toHaveBeenCalled();
    });

    it('3) flag beats env', async()=>{
        const {store} = fake_store();
        const r = await resolve_credential({api_key: 'flagkey'}, {key: HOST, store, env: {[API_KEY_ENV]: 'envkey'}, now: NOW});
        expect(r.token).toBe('flagkey');
    });

    it('3) falls back to a stored api_key record (not ephemeral)', async()=>{
        const {store} = fake_store({[HOST]: {type: 'api_key', key: 'stored', user: {username: 'u'}}});
        const r = await resolve_credential({}, {key: HOST, store, env: {}, now: NOW});
        expect(r).toMatchObject({token: 'stored', type: 'api_key', source: 'store', ephemeral: false});
    });

    it('returns a stored oauth access token when it is still fresh', async()=>{
        const {store} = fake_store({[HOST]: fresh_oauth()});
        const refresh = vi.fn();
        const r = await resolve_credential({}, {key: HOST, store, env: {}, now: NOW, refresh});
        expect(r).toMatchObject({token: 'at', type: 'oauth', source: 'store'});
        expect(refresh).not.toHaveBeenCalled();
    });

    it('refreshes an expired oauth token and persists the new record', async()=>{
        const {store} = fake_store({[HOST]: fresh_oauth({expires_at: NOW - 1})});
        const refreshed: Oauth_record = fresh_oauth({access_token: 'new_at', expires_at: NOW + 3_600_000});
        const refresh = vi.fn(async()=>refreshed);
        const r = await resolve_credential({}, {key: HOST, store, env: {}, now: NOW, refresh});
        expect(refresh).toHaveBeenCalledOnce();
        expect(store.set).toHaveBeenCalledWith(HOST, refreshed);
        expect(r.token).toBe('new_at');
    });

    it('clears the record and errors when an expired token has no refresh token', async()=>{
        const {store} = fake_store({[HOST]: fresh_oauth({expires_at: NOW - 1, refresh_token: undefined})});
        await expect(resolve_credential({}, {key: HOST, store, env: {}, now: NOW, refresh: vi.fn()}))
            .rejects.toBeInstanceOf(UsageError);
        expect(store.remove).toHaveBeenCalledWith(HOST);
    });

    it('clears the record and errors when refresh fails', async()=>{
        const {store} = fake_store({[HOST]: fresh_oauth({expires_at: NOW - 1})});
        const refresh = vi.fn(async()=>{throw new Error('token endpoint said no');});
        await expect(resolve_credential({}, {key: HOST, store, env: {}, now: NOW, refresh}))
            .rejects.toBeInstanceOf(UsageError);
        expect(store.remove).toHaveBeenCalledWith(HOST);
    });

    it('errors (UsageError) when nothing is available and writes nothing', async()=>{
        const {store} = fake_store();
        await expect(resolve_credential({}, {key: HOST, store, env: {}, now: NOW}))
            .rejects.toBeInstanceOf(UsageError);
        expect(store.set).not.toHaveBeenCalled();
    });
});
