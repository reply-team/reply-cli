import {describe, it, expect, beforeEach, vi} from 'vitest';

const mock_fetch = vi.fn();
vi.stubGlobal('fetch', mock_fetch);

import {handle_login, handle_login_token, handle_whoami} from '../../commands/auth';
import type {Cli_context} from '../../context';
import type {CredentialStore, Oauth_record, Credential_record} from '../../credentials/types';
import {Api_error} from '../../utils/errors';

const ok = (data: unknown)=>
    new Response(JSON.stringify(data), {status: 200, headers: {'Content-Type': 'application/json'}});
const unauthorized = ()=>new Response('no', {status: 401});   // non-transient — no retry backoff

const make_store = ()=>{
    const saved: Record<string, Credential_record> = {};
    return {
        set: vi.fn(async(k: string, r: Credential_record)=>{ saved[k] = r; }),
        get: vi.fn(async(k: string)=>saved[k]),
        remove: vi.fn(async()=>true),
        keys: vi.fn(async()=>Object.keys(saved)),
        saved,
    };
};

const make_ctx = (store: ReturnType<typeof make_store>): Cli_context=>({
    profile: 'default', authority: 'https://auth', api_base: 'https://api.dev.reply.io/v3',
    key: 'default', store: store as unknown as CredentialStore, refresh: async(r)=>r,
});

const OAUTH: Oauth_record = {type: 'oauth', access_token: 'AT', refresh_token: 'RT', expires_at: 4_000_000_000_000};
const fake_login = async(): Promise<Oauth_record>=>({...OAUTH});

describe('handle_login — persist before identity lookup', ()=>{
    beforeEach(()=>{ vi.clearAllMocks(); });

    it('stores the login then enriches it with the principal on whoami success', async()=>{
        mock_fetch.mockResolvedValue(ok({userId: 1223, username: 'v@r.io', teamId: 1045}));
        const store = make_store();
        await handle_login(make_ctx(store), {}, fake_login);
        expect(store.set).toHaveBeenCalled();
        expect(store.saved['default']).toMatchObject({
            type: 'oauth', access_token: 'AT', user: {id: 1223, username: 'v@r.io', team_id: 1045},
        });
    });

    it('keeps the login stored even when whoami fails (no lost token)', async()=>{
        mock_fetch.mockResolvedValue(unauthorized());
        const store = make_store();
        await expect(handle_login(make_ctx(store), {}, fake_login)).resolves.toBeUndefined();
        expect(store.saved['default']).toMatchObject({type: 'oauth', access_token: 'AT'});
    });
});

describe('handle_login_token — verify then store', ()=>{
    beforeEach(()=>{ vi.clearAllMocks(); });

    it('stores the api key with the resolved principal on success', async()=>{
        mock_fetch.mockResolvedValue(ok({userId: 7, username: 'a@b.co', teamId: 9}));
        const store = make_store();
        await handle_login_token(make_ctx(store), {}, async()=>'the-key');
        expect(store.saved['default']).toMatchObject({type: 'api_key', key: 'the-key', user: {id: 7}});
    });

    it('does NOT store an unverifiable key (whoami rejects it)', async()=>{
        mock_fetch.mockResolvedValue(unauthorized());
        const store = make_store();
        await expect(handle_login_token(make_ctx(store), {}, async()=>'bad-key')).rejects.toBeInstanceOf(Api_error);
        expect(store.set).not.toHaveBeenCalled();
    });
});

describe('handle_whoami — ephemeral credentials are never written to disk', ()=>{
    beforeEach(()=>{ vi.clearAllMocks(); });

    it('does not persist a credential passed via --api-key', async()=>{
        mock_fetch.mockResolvedValue(ok({userId: 1, username: 'x', teamId: 2}));
        const store = make_store();
        await handle_whoami(make_ctx(store), {apiKey: 'ephemeral-key'});
        expect(store.set).not.toHaveBeenCalled();
    });
});
