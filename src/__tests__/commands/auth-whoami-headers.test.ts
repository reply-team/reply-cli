import {describe, it, expect, beforeEach, vi} from 'vitest';

const mock_fetch = vi.fn();
vi.stubGlobal('fetch', mock_fetch);

import {handle_whoami} from '../../commands/auth';
import type {Cli_context} from '../../context';
import type {CredentialStore, Oauth_record} from '../../credentials/types';

const json_res = (data: unknown)=>
    new Response(JSON.stringify(data), {status: 200, headers: {'Content-Type': 'application/json'}});

const oauth_record: Oauth_record = {
    type: 'oauth', access_token: 'tok', refresh_token: 'r', expires_at: 4_000_000_000_000,
};

const fake_store = (record: Oauth_record): CredentialStore=>({
    get: async()=>record,
    set: async()=>{},
    remove: async()=>true,
    keys: async()=>['dev'],
});

const ctx = (team_id?: number): Cli_context=>({
    profile: 'dev',
    authority: 'https://auth.example',
    api_base: 'https://api.dev.reply.io/v3',
    key: 'dev',
    team_id,
    store: fake_store(oauth_record),
    refresh: async(r)=>r,
});

const sent_headers = (): Record<string, string>=>mock_fetch.mock.calls[0][1].headers;

describe('auth whoami — attaches team/acting-user headers', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks();
        mock_fetch.mockResolvedValue(json_res({userId: 1, username: 'a@b.co', teamId: 5}));
    });

    it('sends the profile team_id as X-TEAM-ID alongside the bearer token', async()=>{
        await handle_whoami(ctx(1045), {});
        expect(sent_headers()).toMatchObject({Authorization: 'Bearer tok', 'X-TEAM-ID': '1045'});
    });

    it('lets --team-id override the profile team_id', async()=>{
        await handle_whoami(ctx(1045), {teamId: '2001'});
        expect(sent_headers()['X-TEAM-ID']).toBe('2001');
    });

    it('sends X-USER-ID from --user-id (org-key acting user)', async()=>{
        await handle_whoami(ctx(1045), {userId: '77'});
        expect(sent_headers()['X-USER-ID']).toBe('77');
    });

    it('sends no team/user headers when none are configured', async()=>{
        await handle_whoami(ctx(undefined), {});
        const h = sent_headers();
        expect(h['X-TEAM-ID']).toBeUndefined();
        expect(h['X-USER-ID']).toBeUndefined();
    });
});
