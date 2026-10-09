import {vi} from 'vitest';
import type {Cli_context} from '../../context';
import type {Api_key_record} from '../../credentials/types';

const mock_fetch = vi.fn();
vi.stubGlobal('fetch', mock_fetch);

const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response=>
    status === 204
        ? new Response(null, {status})
        : new Response(typeof data === 'string' ? data : JSON.stringify(data),
            {status, headers: {'Content-Type': 'application/json', ...headers}});

const api_key_record: Api_key_record = {type: 'api_key', key: 'k', user: {id: 1}};
const ctx = (): Cli_context=>({
    profile: 'dev', authority: 'https://auth', api_base: 'https://api', key: 'dev',
    store: {get: async()=>api_key_record, set: async()=>{}, remove: async()=>true, keys: async()=>['dev']},
    refresh: async(r)=>r,
});

// The requests made so far, in order, with bodies parsed.
const sent = (): {method: string; url: string; body: unknown}[]=>
    mock_fetch.mock.calls.map(([url, init]: [string, RequestInit])=>({
        method: String(init.method),
        url,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    }));

// Answers the next requests, in order.
const answer = (...responses: Response[]): void=>{
    for (const r of responses)
    {
        mock_fetch.mockResolvedValueOnce(r);
    }
};

const capture = async(fn: () => Promise<void>): Promise<{out: string; err: string}>=>{
    const out: string[] = [];
    const err: string[] = [];
    const log = console.log;
    const error = console.error;
    const write = process.stdout.write;
    console.log = (...a: unknown[])=>{ out.push(a.join(' ')); };
    console.error = (...a: unknown[])=>{ err.push(a.join(' ')); };
    process.stdout.write = ((c: unknown): boolean=>{ out.push(String(c)); return true; }) as typeof process.stdout.write;
    try { await fn(); } finally { console.log = log; console.error = error; process.stdout.write = write; }
    return {out: out.join('\n').trim(), err: err.join('\n').trim()};
};

const real_set_timeout = globalThis.setTimeout;
const instant_timers = (): void=>{
    vi.stubGlobal('setTimeout', ((fn: (...a: unknown[])=>void)=>real_set_timeout(fn, 0)) as unknown as typeof setTimeout);
};
const real_timers = (): void=>{
    vi.stubGlobal('setTimeout', real_set_timeout);
};

export {mock_fetch, json, ctx, sent, answer, capture, instant_timers, real_timers};
