import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mock_fetch = vi.fn();
vi.stubGlobal('fetch', mock_fetch);

import {handle_api, read_body_arg} from '../../commands/api';
import {UsageError} from '../../utils/errors';
import type {Cli_context} from '../../context';
import type {CredentialStore, Api_key_record} from '../../credentials/types';

const res = (data: unknown, status = 200)=>
    new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});

const api_key_record: Api_key_record = {type: 'api_key', key: 'k', user: {id: 1}};
const fake_store = (): CredentialStore=>({
    get: async()=>api_key_record, set: async()=>{}, remove: async()=>true, keys: async()=>['dev'],
});
const ctx = (): Cli_context=>({
    profile: 'dev', authority: 'https://auth', api_base: 'https://api', key: 'dev',
    store: fake_store(), refresh: async(r)=>r,
});

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

const method_of = ()=>mock_fetch.mock.calls[0][1].method as string;

let dir: string;
beforeEach(()=>{
    vi.clearAllMocks();
    process.exitCode = 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-api-'));
});
afterEach(()=>{
    process.exitCode = 0;
    fs.rmSync(dir, {recursive: true, force: true});
});

describe('handle_api', ()=>{
    it('GETs by default and builds the URL as base + path literally', async()=>{
        mock_fetch.mockResolvedValue(res({ok: true}, 200));
        const {out} = await capture(()=>handle_api('/v3/whoami', {}, ctx(), {}));
        expect(method_of()).toBe('GET');
        expect(mock_fetch.mock.calls[0][0]).toBe('https://api/v3/whoami');
        expect(JSON.parse(out)).toEqual({code: 200, data: {ok: true}});
    });

    it('POSTs when a --body is given and sends it', async()=>{
        mock_fetch.mockResolvedValue(res({id: 1}, 201));
        await capture(()=>handle_api('/x', {body: '{"a":1}'}, ctx(), {}));
        expect(method_of()).toBe('POST');
        expect(mock_fetch.mock.calls[0][1].body).toBe('{"a":1}');
    });

    it('honors an explicit --method override', async()=>{
        mock_fetch.mockResolvedValue(res({}, 200));
        await capture(()=>handle_api('/x/9', {method: 'delete'}, ctx(), {}));
        expect(method_of()).toBe('DELETE');
    });

    it('rejects an invalid JSON body', async()=>{
        await expect(handle_api('/x', {body: '{bad'}, ctx(), {})).rejects.toThrow(UsageError);
    });

    it('rejects a disallowed method', async()=>{
        await expect(handle_api('/x', {method: 'FROB'}, ctx(), {})).rejects.toThrow(UsageError);
    });

    it('prints {code,data} and sets exit 1 on a non-2xx', async()=>{
        mock_fetch.mockResolvedValue(res({code: 'contact.notFound'}, 404));
        const {out} = await capture(()=>handle_api('/x', {}, ctx(), {}));
        expect(JSON.parse(out).code).toBe(404);
        expect(process.exitCode).toBe(1);
    });

    it('--verbose prints a redacted req/resp trace to stderr (stdout stays {code,data})', async()=>{
        mock_fetch.mockResolvedValue(res({ok: true}, 200));
        const secret_store: CredentialStore = {
            get: async()=>({type: 'api_key', key: 'SEKRET-TOKEN', user: {id: 1}}),
            set: async()=>{}, remove: async()=>true, keys: async()=>['dev'],
        };
        const c: Cli_context = {
            profile: 'dev', authority: 'https://auth', api_base: 'https://api', key: 'dev',
            store: secret_store, refresh: async(r)=>r,
        };
        const {out, err} = await capture(()=>handle_api('/v3/whoami', {}, c, {verbose: true}));
        expect(err).toContain('> GET https://api/v3/whoami');
        expect(err).toMatch(/> Authorization: Bearer •+/);
        expect(err).toContain('< 200');
        expect(err).not.toContain('SEKRET-TOKEN');
        expect(JSON.parse(out).code).toBe(200);
    });

    it('prints team-conflict guidance to stderr on TEAM_REQUIRED', async()=>{
        mock_fetch.mockResolvedValue(res({code: 'TEAM_REQUIRED', teams: [{teamId: 1045, teamName: 'Acme'}]}, 403));
        const {out, err} = await capture(()=>handle_api('/contacts', {}, ctx(), {}));
        expect(JSON.parse(out).code).toBe(403);
        expect(err).toMatch(/multiple teams/i);
        expect(err).toContain('1045');
        expect(process.exitCode).toBe(1);
    });
});

describe('read_body_arg', ()=>{
    it('parses inline JSON', ()=>{
        expect(read_body_arg('{"a":1}')).toEqual({a: 1});
    });

    it('reads @file', ()=>{
        const f = path.join(dir, 'body.json');
        fs.writeFileSync(f, '{"b":2}');
        expect(read_body_arg(`@${f}`)).toEqual({b: 2});
    });

    it('reads - from stdin (injected)', ()=>{
        expect(read_body_arg('-', ()=>'{"c":3}')).toEqual({c: 3});
    });

    it('returns undefined when absent', ()=>{
        expect(read_body_arg(undefined)).toBeUndefined();
    });

    it('throws UsageError on invalid JSON', ()=>{
        expect(()=>read_body_arg('nope')).toThrow(UsageError);
    });
});
