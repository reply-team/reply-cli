import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';

const mock_fetch = vi.fn();
vi.stubGlobal('fetch', mock_fetch);

import {create_client, get} from '../../utils/client';
import {Api_error, RuntimeError} from '../../utils/errors';

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
        mock_fetch.mockResolvedValue(err_res(503));
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

    it('sends a User-Agent identifying the CLI on every request', async()=>{
        mock_fetch.mockResolvedValue(json_res({ok: true}));
        await get(BASE, 'tok', '/x');
        const [, init] = mock_fetch.mock.calls[0];
        expect(init.headers['User-Agent']).toMatch(/^reply-cli\/\d+\.\d+\.\d+/);
    });
});
