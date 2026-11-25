import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {resolve_credential} from '../../auth/resolve';
import {refresh_stored, CLIENT_ID} from '../../auth/oauth-flow';
import {FileCredentialStore} from '../../credentials/file-store';
import {CliError, UsageError, format_hint} from '../../utils/errors';
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
        remove: vi.fn(async(h: string, only_if?: (r: Credential_record) => boolean)=>{
            if (!(h in map) || (only_if && !only_if(map[h])))
            {
                return false;
            }
            delete map[h];
            return true;
        }),
        keys: vi.fn(async()=>Object.keys(map)),
        with_lock: async<T>(fn: () => Promise<T>)=>fn(),
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

    // Breaks if a record with nothing to refresh it is kept, or if one another process stored while
    // this one waited for the lock (a new login, say) is removed in its place.
    it('clears the record and errors when an expired token has no refresh token, unless the lock shows a newer one', async()=>{
        const {store, map} = fake_store({[HOST]: fresh_oauth({expires_at: NOW - 1, refresh_token: undefined})});
        await expect(resolve_credential({}, {key: HOST, store, env: {}, now: NOW, refresh: vi.fn()}))
            .rejects.toMatchObject({code: 'auth.expired'});
        expect(map).toEqual({});

        const peer = fake_store({[HOST]: fresh_oauth({expires_at: NOW - 1, refresh_token: undefined})});
        peer.store.with_lock = async<T>(fn: () => Promise<T>)=>{
            peer.map[HOST] = fresh_oauth({access_token: 'peer_at'});
            return fn();
        };
        const r = await resolve_credential({}, {key: HOST, store: peer.store, env: {}, now: NOW, refresh: vi.fn()});
        expect(r).toMatchObject({token: 'peer_at', type: 'oauth', source: 'store'});
        expect(peer.map[HOST]).toEqual(fresh_oauth({access_token: 'peer_at'}));
    });

    it('errors (UsageError) when nothing is available and writes nothing', async()=>{
        const {store} = fake_store();
        await expect(resolve_credential({}, {key: HOST, store, env: {}, now: NOW}))
            .rejects.toBeInstanceOf(UsageError);
        expect(store.set).not.toHaveBeenCalled();
    });
});

// A failed refresh against the real credentials file and the real token request, with only the
// token endpoint's answer recorded.
describe('auth/resolve — a refresh that fails', ()=>{
    const AUTHORITY = 'https://oauth.test';
    const PROFILE = 'default';
    const EXPIRED: Oauth_record = {
        type: 'oauth', access_token: 'at-old-SECRET', refresh_token: 'rt-old-SECRET', expires_at: NOW - 1, user: {id: 7},
    };
    const NEWER: Oauth_record = {
        type: 'oauth', access_token: 'at-new-SECRET', refresh_token: 'rt-new-SECRET', expires_at: NOW + 3_600_000, user: {id: 7},
    };
    const OTHER: Credential_record = {type: 'api_key', key: 'key-other-SECRET'};
    const SECRETS = ['at-old-SECRET', 'rt-old-SECRET', 'at-new-SECRET', 'rt-new-SECRET', 'key-other-SECRET'];
    const REFRESH_REQUEST = {
        url: `${AUTHORITY}/connect/token`,
        form: {grant_type: 'refresh_token', refresh_token: 'rt-old-SECRET', client_id: CLIENT_ID},
    };

    let dir: string;
    let file: string;
    const token_endpoint = vi.fn();

    beforeEach(()=>{
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-refresh-'));
        file = path.join(dir, 'credentials.json');
        fs.writeFileSync(file, JSON.stringify({[PROFILE]: EXPIRED, other: OTHER}, null, 2));
        token_endpoint.mockReset();
        vi.stubGlobal('fetch', token_endpoint);
    });

    afterEach(()=>{
        vi.unstubAllGlobals();
        fs.rmSync(dir, {recursive: true, force: true});
    });

    const store = (lock?: {wait_ms?: number}): FileCredentialStore=>new FileCredentialStore(file, {lock});
    const resolve = (s: FileCredentialStore = store())=>resolve_credential({}, {
        key: PROFILE, store: s, env: {}, now: NOW,
        refresh: record=>refresh_stored({authority: AUTHORITY, record, now: NOW, timeout_ms: 50}),
    });
    const failure = (s?: FileCredentialStore): Promise<CliError>=>resolve(s).then(
        r=>{ throw new Error(`resolved to a ${r.type} credential instead of failing`); },
        (e: unknown)=>e as CliError);
    const requests = ()=>token_endpoint.mock.calls.map(([url, init]: [string, RequestInit])=>
        ({url, form: Object.fromEntries(new URLSearchParams(String(init.body)))}));
    const json = (status: number, body: unknown, headers: Record<string, string> = {})=>
        new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', ...headers}});
    // Another live process's lock: this test's parent process holds it.
    const hold_lock = ()=>fs.writeFileSync(`${file}.lock`, JSON.stringify({pid: process.ppid, host: os.hostname(), taken_at: Date.now()}));
    // What the top-level handler prints for an error, with --json and without.
    const printed = (e: CliError): string=>[e.message, e.hint ? format_hint(e.hint) : '', JSON.stringify(e.to_json())].join('\n');
    const expect_no_secret = (e: CliError): void=>{
        for (const secret of SECRETS)
        {
            expect(printed(e)).not.toContain(secret);
        }
    };

    type Passing = {
        name: string;
        answer: (init: RequestInit) => Promise<Response>;
        code: string;
        retry_after?: number;
        refresh: Record<string, unknown>;
        says: string;
    };
    const PASSING: Passing[] = [
        {
            name: 'a 429 with Retry-After', code: 'rate_limited', retry_after: 30, refresh: {status: 429}, says: 'HTTP 429',
            answer: async()=>new Response('Too Many Requests', {status: 429, headers: {'Retry-After': '30'}}),
        },
        {
            name: 'a 429 without Retry-After', code: 'rate_limited', refresh: {status: 429}, says: 'HTTP 429',
            answer: async()=>new Response('Too Many Requests', {status: 429}),
        },
        {
            name: 'a 5xx', code: 'reply.unavailable', refresh: {status: 503}, says: 'HTTP 503',
            answer: async()=>new Response('upstream connect error', {status: 503}),
        },
        {
            name: 'a 405 maintenance page', code: 'reply.unavailable', refresh: {status: 405}, says: 'HTTP 405',
            answer: async()=>new Response('<html><body>We are down for maintenance</body></html>',
                {status: 405, headers: {'Content-Type': 'text/html'}}),
        },
        {
            name: 'a timeout', code: 'reply.unavailable', refresh: {reason: 'timeout'}, says: 'No answer',
            answer: init=>new Promise((_, reject)=>{
                init.signal!.addEventListener('abort', ()=>reject(init.signal!.reason));
            }),
        },
        {
            name: 'a network error', code: 'reply.unavailable', refresh: {reason: 'network'}, says: 'ECONNREFUSED',
            answer: async()=>{
                throw Object.assign(new TypeError('fetch failed'), {
                    cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {code: 'ECONNREFUSED'}),
                });
            },
        },
        {
            name: 'a 2xx that is not a token answer', code: 'reply.unavailable', refresh: {status: 200, reason: 'unreadable'},
            says: 'HTTP 200',
            answer: async()=>new Response('<html>ok</html>', {status: 200}),
        },
    ];

    // Breaks if a failure that a later attempt can get past signs the person out, or reads to the
    // caller as a sign-in problem no retry can help.
    it.each(PASSING)('keeps the sign-in byte for byte on $name and fails $code at exit 1', async c=>{
        const before = fs.readFileSync(file);
        token_endpoint.mockImplementation((_url: string, init: RequestInit)=>c.answer(init));
        const e = await failure();
        expect({code: e.code, exit_code: e.exit_code, retry_after: e.retry_after, details: e.details})
            .toEqual({code: c.code, exit_code: 1, retry_after: c.retry_after, details: {refresh: c.refresh}});
        expect(e.to_json().error.status).toBeUndefined();
        expect(e.message).toContain(c.says);
        expect(fs.readFileSync(file).equals(before)).toBe(true);
        expect(fs.existsSync(`${file}.lock`)).toBe(false);
        expect(requests()).toEqual([REFRESH_REQUEST]);
        expect_no_secret(e);
    });

    // Breaks if a lock another process never lets go of hangs the command or signs the person out.
    it('keeps the sign-in and fails reply.unavailable when another process holds the lock too long', async()=>{
        hold_lock();
        const before = fs.readFileSync(file);
        const e = await failure(store({wait_ms: 200}));
        expect({code: e.code, exit_code: e.exit_code, details: e.details})
            .toEqual({code: 'reply.unavailable', exit_code: 1, details: {refresh: {reason: 'lock_wait'}}});
        expect(fs.readFileSync(file).equals(before)).toBe(true);
        expect(token_endpoint).not.toHaveBeenCalled();
        expect_no_secret(e);
    });

    // Breaks if a definite refusal other than a dead grant deletes a sign-in a new login would replace anyway.
    it('keeps the sign-in on an OAuth refusal other than invalid_grant and fails auth.refresh_failed', async()=>{
        const before = fs.readFileSync(file);
        token_endpoint.mockResolvedValue(json(401, {error: 'invalid_client', error_description: 'Unknown client'}));
        const e = await failure();
        expect({code: e.code, exit_code: e.exit_code, details: e.details})
            .toEqual({code: 'auth.refresh_failed', exit_code: 2, details: {refresh: {status: 401, error: 'invalid_client'}}});
        expect(e.message).toContain('HTTP 401 invalid_client');
        expect(e.hint).toContain('auth login');
        expect(fs.readFileSync(file).equals(before)).toBe(true);
        expect(requests()).toEqual([REFRESH_REQUEST]);
        expect_no_secret(e);
    });

    // Breaks if a dead grant is kept (every command would send it again) or its reason is dropped; or
    // if the check that the file still holds it is a read of its own before the delete's, leaving a
    // window for a record stored in between to be deleted.
    it('removes the sign-in when the grant is refused and the file still holds it, deciding on the read it rewrites', async()=>{
        let refused = false;
        let rewritten = false;
        let reads = 0;
        token_endpoint.mockImplementation(async()=>{
            refused = true;
            return json(400, {error: 'invalid_grant'});
        });
        const read = fs.readFileSync;
        const rename = fs.renameSync;
        const spies = [
            vi.spyOn(fs, 'readFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, ...rest: unknown[])=>{
                if (refused && !rewritten && String(target) === file)
                {
                    reads += 1;
                }
                return (read as (...a: unknown[]) => unknown)(target, ...rest);
            }) as typeof fs.readFileSync),
            vi.spyOn(fs, 'renameSync').mockImplementation((from, to)=>{
                rename(from, to);
                rewritten ||= String(to) === file;
            }),
        ];
        let e: CliError;
        try {
            e = await failure();
        } finally {
            spies.forEach(s=>s.mockRestore());
        }
        expect(reads).toBe(1);
        expect({code: e.code, exit_code: e.exit_code, details: e.details})
            .toEqual({code: 'auth.refresh_failed', exit_code: 2, details: {refresh: {status: 400, error: 'invalid_grant'}}});
        expect(e.message).toContain('HTTP 400 invalid_grant');
        expect(e.hint).toContain('auth login');
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({other: OTHER});
        expect(fs.existsSync(`${file}.lock`)).toBe(false);
        expect(requests()).toEqual([REFRESH_REQUEST]);
        expect_no_secret(e);
    });

    // Breaks if a refusal caused by a peer that spent the same one-time token deletes the token that
    // peer stored; or if the error says a sign-in was removed when a peer had already removed it.
    // The peer here is a reply that takes no lock, such as an older version.
    it('uses a sign-in another process stored while the refresh was refused, deleting nothing', async()=>{
        token_endpoint.mockImplementation(async()=>{
            fs.writeFileSync(file, JSON.stringify({[PROFILE]: NEWER, other: OTHER}, null, 2));
            return json(400, {error: 'invalid_grant'});
        });
        const r = await resolve();
        expect(r).toMatchObject({token: 'at-new-SECRET', type: 'oauth', source: 'store'});
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({[PROFILE]: NEWER, other: OTHER});
        expect(requests()).toEqual([REFRESH_REQUEST]);

        fs.writeFileSync(file, JSON.stringify({[PROFILE]: EXPIRED, other: OTHER}, null, 2));
        token_endpoint.mockImplementation(async()=>{
            fs.writeFileSync(file, JSON.stringify({other: OTHER}, null, 2));
            return json(400, {error: 'invalid_grant'});
        });
        const e = await failure();
        expect({code: e.code, details: e.details})
            .toEqual({code: 'auth.refresh_failed', details: {refresh: {status: 400, error: 'invalid_grant'}}});
        expect(e.message).not.toContain('removed');
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({other: OTHER});
    });

    // Breaks if two processes that find one expired token both spend it: the second is refused.
    it('waits for another process refreshing, then uses what it stored and sends no refresh', async()=>{
        hold_lock();
        const resolved = resolve().catch((e: unknown)=>e);
        await new Promise(r=>setTimeout(r, 200));
        expect(token_endpoint).not.toHaveBeenCalled();
        fs.writeFileSync(file, JSON.stringify({[PROFILE]: NEWER, other: OTHER}, null, 2));
        fs.rmSync(`${file}.lock`);
        expect(await resolved).toMatchObject({token: 'at-new-SECRET', type: 'oauth', source: 'store'});
        expect(token_endpoint).not.toHaveBeenCalled();
    });
});
