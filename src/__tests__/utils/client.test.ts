import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';

const mock_fetch = vi.fn();
vi.stubGlobal('fetch', mock_fetch);

import {create_client, get} from '../../utils/client';
import {Api_error, RuntimeError, Unknown_outcome_error} from '../../utils/errors';

const BASE = 'https://api.dev.reply.io/v3';

const real_set_timeout = globalThis.setTimeout;
const instant_timers = ()=>{
    vi.stubGlobal('setTimeout', ((fn: (...a: unknown[])=>void)=>real_set_timeout(fn, 0)) as unknown as typeof setTimeout);
};

const json_res = (data: unknown, status = 200)=>
    new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});
const err_res = (status: number, body: unknown = '', headers: Record<string, string> = {})=>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {status, headers});

describe('utils/client', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks();
    });
    afterEach(()=>{
        vi.stubGlobal('setTimeout', real_set_timeout);
    });

    it('sends Authorization: Bearer against the given base URL — one path for JWT or API key', async()=>{
        mock_fetch.mockResolvedValue(json_res({userId: 1}));
        const result = await get(BASE, 'tok', '/whoami');
        expect(mock_fetch).toHaveBeenCalledWith(
            'https://api.dev.reply.io/v3/whoami',
            expect.objectContaining({
                method: 'GET',
                headers: expect.objectContaining({Authorization: 'Bearer tok'}),
            }),
        );
        expect(result).toEqual({userId: 1});
    });

    it('returns null on an empty 200 body', async()=>{
        mock_fetch.mockResolvedValue(new Response('', {status: 200}));
        expect(await get(BASE, 'tok', '/x')).toBeNull();
    });

    it('throws Api_error with status + parsed body on a non-ok response', async()=>{
        mock_fetch.mockResolvedValue(err_res(404, {title: 'Not found', code: 'x.notFound'}));
        const err = await get(BASE, 'tok', '/x').catch(e=>e);
        expect(err).toBeInstanceOf(Api_error);
        expect(err.status).toBe(404);
        expect(err.code).toBe('x.notFound');
    });

    it('attaches a 401 hint mentioning login', async()=>{
        mock_fetch.mockResolvedValue(err_res(401, {title: 'Unauthorized'}));
        const err = await get(BASE, 'tok', '/x').catch(e=>e);
        expect(err.hint).toMatch(/login|credential/i);
    });

    it('retries transient 500s then succeeds', async()=>{
        instant_timers();
        mock_fetch
            .mockResolvedValueOnce(err_res(500))
            .mockResolvedValueOnce(json_res({ok: true}));
        expect(await get(BASE, 'tok', '/x')).toEqual({ok: true});
        expect(mock_fetch).toHaveBeenCalledTimes(2);
    });

    it('gives up after max retries on persistent 503', async()=>{
        instant_timers();
        // A fresh Response per call, as fetch gives: every body is now read, and a body reads once.
        mock_fetch.mockImplementation(async()=>err_res(503));
        const err = await get(BASE, 'tok', '/x').catch(e=>e);
        expect(err).toBeInstanceOf(Api_error);
        expect(err.status).toBe(503);
        expect(mock_fetch).toHaveBeenCalledTimes(4); // initial + 3 retries
    });

    it('wraps a network failure in a RuntimeError after retries', async()=>{
        instant_timers();
        mock_fetch.mockRejectedValue(new TypeError('fetch failed'));
        const err = await get(BASE, 'tok', '/x').catch(e=>e);
        expect(err).toBeInstanceOf(RuntimeError);
    });

    it('create_client binds base + token for get', async()=>{
        mock_fetch.mockResolvedValue(json_res({userId: 9}));
        const client = create_client(BASE, 'tok');
        await client.get('/whoami');
        expect(mock_fetch).toHaveBeenCalledWith(
            'https://api.dev.reply.io/v3/whoami',
            expect.objectContaining({headers: expect.objectContaining({Authorization: 'Bearer tok'})}),
        );
    });

    it('create_client attaches extra headers alongside Authorization', async()=>{
        mock_fetch.mockResolvedValue(json_res({ok: true}));
        const client = create_client(BASE, 'tok', {'X-TEAM-ID': '1045', 'X-USER-ID': '7'});
        await client.get('/whoami');
        expect(mock_fetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({headers: expect.objectContaining({
                Authorization: 'Bearer tok', 'X-TEAM-ID': '1045', 'X-USER-ID': '7',
            })}),
        );
    });

    it('sends no extra headers when none are given', async()=>{
        mock_fetch.mockResolvedValue(json_res({ok: true}));
        await create_client(BASE, 'tok').get('/x');
        const [, init] = mock_fetch.mock.calls[0];
        expect(init.headers['X-TEAM-ID']).toBeUndefined();
    });

    it('get forwards opts.headers', async()=>{
        mock_fetch.mockResolvedValue(json_res({ok: true}));
        await get(BASE, 'tok', '/x', {headers: {'X-TEAM-ID': '9'}});
        expect(mock_fetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({headers: expect.objectContaining({'X-TEAM-ID': '9'})}),
        );
    });

    describe('base+path joining is slash-safe', ()=>{
        it('collapses a double slash (base trailing / + path leading /)', async()=>{
            mock_fetch.mockResolvedValue(json_res({ok: true}));
            await get('https://api.reply.io/', 'tok', '/v3/whoami');
            expect(mock_fetch.mock.calls[0][0]).toBe('https://api.reply.io/v3/whoami');
        });
        it('inserts a missing slash (base no-slash + path no-slash)', async()=>{
            mock_fetch.mockResolvedValue(json_res({ok: true}));
            await get('https://api.reply.io', 'tok', 'v3/whoami');
            expect(mock_fetch.mock.calls[0][0]).toBe('https://api.reply.io/v3/whoami');
        });
        it('leaves a well-formed base+path unchanged (incl. query)', async()=>{
            mock_fetch.mockResolvedValue(json_res({ok: true}));
            await get('https://api.reply.io', 'tok', '/v3/contacts?limit=10');
            expect(mock_fetch.mock.calls[0][0]).toBe('https://api.reply.io/v3/contacts?limit=10');
        });
    });

    describe('request_raw', ()=>{
        it('returns {status,data,…} for a 2xx without throwing, Authorization redacted', async()=>{
            mock_fetch.mockResolvedValue(json_res({ok: true}, 200));
            const {request_raw} = await import('../../utils/client');
            const r = await request_raw(BASE, 'tok', 'GET', '/x');
            expect(r).toMatchObject({status: 200, data: {ok: true}});
            expect(r.request.headers.Authorization).toMatch(/^Bearer •+$/);
            expect(JSON.stringify(r)).not.toContain('tok');
        });
        it('returns {status,data} for a 4xx without throwing', async()=>{
            mock_fetch.mockResolvedValue(err_res(403, {code: 'TEAM_REQUIRED', teams: []}));
            const {request_raw} = await import('../../utils/client');
            const r = await request_raw(BASE, 'tok', 'GET', '/x');
            expect(r.status).toBe(403);
            expect((r.data as {code: string}).code).toBe('TEAM_REQUIRED');
        });
        it('serializes a body and sets the method', async()=>{
            mock_fetch.mockResolvedValue(json_res({id: 1}, 201));
            const {request_raw} = await import('../../utils/client');
            await request_raw(BASE, 'tok', 'POST', '/x', {a: 1});
            const [, init] = mock_fetch.mock.calls[0];
            expect(init.method).toBe('POST');
            expect(init.body).toBe('{"a":1}');
        });
        it('retries a transient 503 then returns', async()=>{
            instant_timers();
            mock_fetch.mockResolvedValueOnce(err_res(503)).mockResolvedValueOnce(json_res({ok: true}));
            const {request_raw} = await import('../../utils/client');
            expect((await request_raw(BASE, 'tok', 'GET', '/x')).status).toBe(200);
        });
        it('throws RuntimeError on network failure after retries', async()=>{
            instant_timers();
            mock_fetch.mockRejectedValue(new TypeError('fetch failed'));
            const {request_raw} = await import('../../utils/client');
            await expect(request_raw(BASE, 'tok', 'GET', '/x')).rejects.toThrow(RuntimeError);
        });
    });

    it('sends a User-Agent identifying the CLI on every request', async()=>{
        mock_fetch.mockResolvedValue(json_res({ok: true}));
        await get(BASE, 'tok', '/x');
        const [, init] = mock_fetch.mock.calls[0];
        expect(init.headers['User-Agent']).toMatch(/^reply-cli\/\d+\.\d+\.\d+/);
    });

    describe('retry policy: reads vs writes', ()=>{
        const net_error = (code?: string)=>Object.assign(new TypeError('fetch failed'),
            code ? {cause: Object.assign(new Error(code), {code})} : {});

        it('a POST is not resent on a 503: the answer comes back as it is', async()=>{
            instant_timers();
            mock_fetch.mockResolvedValue(err_res(503));
            const {request_raw} = await import('../../utils/client');
            expect((await request_raw(BASE, 'tok', 'POST', '/x', {a: 1})).status).toBe(503);
            expect(mock_fetch).toHaveBeenCalledTimes(1);
        });

        it('a POST whose connection broke after sending is an unknown outcome (exit 3), not resent', async()=>{
            instant_timers();
            mock_fetch.mockRejectedValue(net_error('ECONNRESET'));
            const {request_raw} = await import('../../utils/client');
            const err = await request_raw(BASE, 'tok', 'POST', '/x', {a: 1}).catch(e=>e);
            expect(err).toBeInstanceOf(Unknown_outcome_error);
            expect(err.exit_code).toBe(3);
            expect(mock_fetch).toHaveBeenCalledTimes(1);
        });

        it('a POST that never connected is retried, and succeeds', async()=>{
            instant_timers();
            mock_fetch.mockRejectedValueOnce(net_error('ECONNREFUSED')).mockResolvedValueOnce(json_res({ok: true}));
            const {request_raw} = await import('../../utils/client');
            expect((await request_raw(BASE, 'tok', 'POST', '/x', {a: 1})).status).toBe(200);
            expect(mock_fetch).toHaveBeenCalledTimes(2);
        });

        it('a POST that never connects is a network failure after 3 retries', async()=>{
            instant_timers();
            mock_fetch.mockRejectedValue(net_error('ENOTFOUND'));
            const {request_raw} = await import('../../utils/client');
            const err = await request_raw(BASE, 'tok', 'POST', '/x', {a: 1}).catch(e=>e);
            expect(err).toBeInstanceOf(RuntimeError);
            expect(err.code).toBe('network');
            expect(mock_fetch).toHaveBeenCalledTimes(4);
        });

        it('a POST marked as a read is retried on a 503', async()=>{
            instant_timers();
            mock_fetch.mockResolvedValueOnce(err_res(503)).mockResolvedValueOnce(json_res({ok: true}));
            const {request_raw} = await import('../../utils/client');
            expect((await request_raw(BASE, 'tok', 'POST', '/x', {}, {kind: 'read'})).status).toBe(200);
            expect(mock_fetch).toHaveBeenCalledTimes(2);
        });

        it('a 429 with Retry-After of 3 s or less is waited out, for a write too', async()=>{
            instant_timers();
            mock_fetch.mockResolvedValueOnce(err_res(429, '', {'Retry-After': '2'})).mockResolvedValueOnce(json_res({ok: true}));
            const {request_raw} = await import('../../utils/client');
            expect((await request_raw(BASE, 'tok', 'POST', '/x', {a: 1})).status).toBe(200);
            expect(mock_fetch).toHaveBeenCalledTimes(2);
        });

        it('a 429 with Retry-After over 3 s comes back at once', async()=>{
            instant_timers();
            mock_fetch.mockResolvedValue(err_res(429, '', {'Retry-After': '30'}));
            const {request_raw} = await import('../../utils/client');
            const r = await request_raw(BASE, 'tok', 'GET', '/x');
            expect(r.status).toBe(429);
            expect(r.response_headers['retry-after']).toBe('30');
            expect(mock_fetch).toHaveBeenCalledTimes(1);
        });

        it('a 429 whose Retry-After is an HTTP date a minute away comes back at once', async()=>{
            instant_timers();
            const later = new Date(Date.now() + 60_000).toUTCString();
            mock_fetch.mockResolvedValue(err_res(429, '', {'Retry-After': later}));
            const {request_raw} = await import('../../utils/client');
            expect((await request_raw(BASE, 'tok', 'GET', '/x')).status).toBe(429);
            expect(mock_fetch).toHaveBeenCalledTimes(1);
        });

        it('a 429 with no Retry-After is retried with backoff', async()=>{
            instant_timers();
            mock_fetch.mockResolvedValueOnce(err_res(429)).mockResolvedValueOnce(json_res({ok: true}));
            const {request_raw} = await import('../../utils/client');
            expect((await request_raw(BASE, 'tok', 'GET', '/x')).status).toBe(200);
            expect(mock_fetch).toHaveBeenCalledTimes(2);
        });

        const broken_body = ()=>new Response(new ReadableStream({
            start(c){ c.error(new TypeError('terminated')); },
        }), {status: 200});

        it('a POST whose answer breaks off mid-body is an unknown outcome (exit 3), not resent', async()=>{
            instant_timers();
            mock_fetch.mockResolvedValue(broken_body());
            const {request_raw} = await import('../../utils/client');
            const err = await request_raw(BASE, 'tok', 'POST', '/x', {a: 1}).catch(e=>e);
            expect(err).toBeInstanceOf(Unknown_outcome_error);
            expect(mock_fetch).toHaveBeenCalledTimes(1);
        });

        it('a GET whose answer breaks off mid-body is asked again', async()=>{
            instant_timers();
            mock_fetch.mockResolvedValueOnce(broken_body()).mockResolvedValueOnce(json_res({ok: true}));
            const {request_raw} = await import('../../utils/client');
            expect((await request_raw(BASE, 'tok', 'GET', '/x')).status).toBe(200);
            expect(mock_fetch).toHaveBeenCalledTimes(2);
        });

        it('parse_retry_after reads seconds and HTTP dates, and nothing else', async()=>{
            const {parse_retry_after} = await import('../../utils/client');
            expect(parse_retry_after('7')).toBe(7);
            expect(parse_retry_after(null)).toBeNull();
            expect(parse_retry_after('soon')).toBeNull();
            expect(parse_retry_after(new Date(Date.now() - 5_000).toUTCString())).toBe(0);
            expect(parse_retry_after('1.5')).toBeNull();
            expect(parse_retry_after('-5')).toBeNull();
        });

        it('a write that failed TLS or found no route never left: it is retried, then a network failure', async()=>{
            instant_timers();
            for (const code of ['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'EHOSTUNREACH', 'ENETUNREACH'])
            {
                mock_fetch.mockReset();
                mock_fetch.mockRejectedValue(net_error(code));
                const {request_raw} = await import('../../utils/client');
                const err = await request_raw(BASE, 'tok', 'POST', '/x', {a: 1}).catch(e=>e);
                expect(err).toBeInstanceOf(RuntimeError);
                expect(err.detail).toContain(code);
                expect(mock_fetch).toHaveBeenCalledTimes(4);
            }
        });

        it('an unknown outcome names the underlying cause in its detail', async()=>{
            mock_fetch.mockRejectedValue(net_error('ECONNRESET'));
            const {request_raw} = await import('../../utils/client');
            const err = await request_raw(BASE, 'tok', 'POST', '/x', {a: 1}).catch(e=>e);
            expect(err).toBeInstanceOf(Unknown_outcome_error);
            expect(err.detail).toContain('ECONNRESET');
        });
    });
});
