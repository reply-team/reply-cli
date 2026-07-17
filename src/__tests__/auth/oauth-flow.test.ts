import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import http from 'http';
import {URL} from 'url';

const mock_fetch = vi.fn();
vi.stubGlobal('fetch', mock_fetch);

import {build_authorize_url, run_login, refresh_stored, browser_open_command, CLIENT_ID, SCOPE} from '../../auth/oauth-flow';
import {RuntimeError} from '../../utils/errors';
import type {Oauth_record} from '../../credentials/types';

const AUTHORITY = 'https://oauth.dev.replyapp.io';
const NOW = 1_700_000_000_000;

const token_res = (data: unknown, status = 200)=>
    new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});

// Simulate the browser: hit the loopback callback with the given code/state.
const hit_callback = (authorize_url: string, over: {code?: string; state?: string} = {})=>{
    const u = new URL(authorize_url);
    const redirect = new URL(u.searchParams.get('redirect_uri')!);
    const state = over.state ?? u.searchParams.get('state')!;
    const code = over.code ?? 'auth_code_123';
    const cb = `${redirect.origin}${redirect.pathname}?code=${code}&state=${encodeURIComponent(state)}`;
    http.get(cb, res=>{res.resume();});
};

// Hit the loopback callback with an ?error and capture the served HTML body.
const get_callback_body = (authorize_url: string, over: {error: string}): Promise<string>=>
    new Promise(resolve=>{
        const u = new URL(authorize_url);
        const redirect = new URL(u.searchParams.get('redirect_uri')!);
        const cb = `${redirect.origin}${redirect.pathname}?error=${encodeURIComponent(over.error)}`;
        http.get(cb, res=>{
            let body = '';
            res.on('data', d=>{ body += d; });
            res.on('end', ()=>resolve(body));
        });
    });

describe('auth/oauth-flow', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks();
    });
    afterEach(()=>{
        vi.restoreAllMocks();
    });

    describe('browser_open_command', ()=>{
        it('uses the native opener with the URL as a standalone arg on mac/linux', ()=>{
            expect(browser_open_command('darwin', 'https://x?a=1&b=2')).toEqual({command: 'open', args: ['https://x?a=1&b=2']});
            expect(browser_open_command('linux', 'https://x?a=1&b=2')).toEqual({command: 'xdg-open', args: ['https://x?a=1&b=2']});
        });

        it('uses rundll32 on Windows so an & in the URL is never parsed by cmd', ()=>{
            const url = 'https://oauth.dev.replyapp.io/connect/authorize?response_type=code&client_id=Reply.Cli&state=x';
            const {command, args} = browser_open_command('win32', url);
            expect(command).toBe('rundll32');
            expect(args[0]).toBe('url.dll,FileProtocolHandler');
            expect(args[1]).toBe(url);   // whole URL is one arg — & stays intact
            expect(args).toHaveLength(2);
        });
    });

    describe('build_authorize_url', ()=>{
        it('targets /connect/authorize with code+PKCE+state params', ()=>{
            const url = build_authorize_url({
                authority: AUTHORITY, client_id: CLIENT_ID,
                redirect_uri: 'http://127.0.0.1:5000/callback',
                scope: SCOPE, challenge: 'CHAL', state: 'STATE',
            });
            const u = new URL(url);
            expect(u.origin + u.pathname).toBe('https://oauth.dev.replyapp.io/connect/authorize');
            expect(u.searchParams.get('response_type')).toBe('code');
            expect(u.searchParams.get('client_id')).toBe('Reply.Cli');
            expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5000/callback');
            expect(u.searchParams.get('code_challenge')).toBe('CHAL');
            expect(u.searchParams.get('code_challenge_method')).toBe('S256');
            expect(u.searchParams.get('state')).toBe('STATE');
            expect(u.searchParams.get('scope')).toContain('offline_access');
        });

        it('uses the 127.0.0.1 IP literal for the loopback redirect (RFC 8252)', ()=>{
            expect(SCOPE).toContain('reply-web-api');
        });
    });

    describe('run_login (loopback, simulated redirect)', ()=>{
        it('completes the code exchange and returns an oauth record', async()=>{
            mock_fetch.mockResolvedValue(token_res({access_token: 'AT', refresh_token: 'RT', expires_in: 3600}));
            const record = await run_login({
                authority: AUTHORITY, now: NOW,
                open: (url: string)=>hit_callback(url),
            });
            expect(record).toEqual<Oauth_record>({
                type: 'oauth', access_token: 'AT', refresh_token: 'RT', expires_at: NOW + 3_600_000,
            });
            const [token_url, init] = mock_fetch.mock.calls[0];
            expect(token_url).toBe('https://oauth.dev.replyapp.io/connect/token');
            expect(String(init.body)).toContain('grant_type=authorization_code');
            expect(String(init.body)).toContain('code_verifier=');
        });

        it('rejects on a state mismatch (CSRF guard) without exchanging a token', async()=>{
            await expect(run_login({
                authority: AUTHORITY, now: NOW, timeout_ms: 3000,
                open: (url: string)=>hit_callback(url, {state: 'WRONG'}),
            })).rejects.toBeInstanceOf(RuntimeError);
            expect(mock_fetch).not.toHaveBeenCalled();
        });

        it('HTML-escapes a reflected ?error on the loopback page (no injection)', async()=>{
            const payload = '<img src=x onerror=alert(1)>';
            let body: Promise<string> | undefined;
            await expect(run_login({
                authority: AUTHORITY, now: NOW, timeout_ms: 3000,
                open: (url: string)=>{ body = get_callback_body(url, {error: payload}); },
            })).rejects.toBeInstanceOf(RuntimeError);
            const html = await body!;
            expect(html).not.toContain('<img src=x');
            expect(html).toContain('&lt;img src=x');
            expect(mock_fetch).not.toHaveBeenCalled();
        });
    });

    describe('refresh_stored', ()=>{
        it('posts a refresh_token grant and maps the new record, keeping the old refresh token', async()=>{
            mock_fetch.mockResolvedValue(token_res({access_token: 'AT2', expires_in: 3600}));
            const prev: Oauth_record = {type: 'oauth', access_token: 'AT', refresh_token: 'RT', expires_at: 1};
            const record = await refresh_stored({authority: AUTHORITY, record: prev, now: NOW});
            expect(record.access_token).toBe('AT2');
            expect(record.refresh_token).toBe('RT');
            const [, init] = mock_fetch.mock.calls[0];
            expect(String(init.body)).toContain('grant_type=refresh_token');
        });

        it('throws when the token endpoint returns an error', async()=>{
            mock_fetch.mockResolvedValue(token_res({error: 'invalid_grant'}, 400));
            const prev: Oauth_record = {type: 'oauth', access_token: 'AT', refresh_token: 'RT', expires_at: 1};
            await expect(refresh_stored({authority: AUTHORITY, record: prev, now: NOW}))
                .rejects.toBeInstanceOf(RuntimeError);
        });
    });
});
