import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mock_fetch = vi.fn();
vi.stubGlobal('fetch', mock_fetch);

import {handle_team_list, handle_team_current, handle_team_use, handle_team_clear} from '../../commands/team';
import {add_profile, resolve_profile} from '../../profile';
import {UsageError} from '../../utils/errors';
import type {Cli_context} from '../../context';
import type {CredentialStore, Api_key_record} from '../../credentials/types';

const res = (data: unknown, status = 200)=>
    new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});

const api_key_record: Api_key_record = {type: 'api_key', key: 'k', user: {id: 1}};
const fake_store = (): CredentialStore=>({
    get: async()=>api_key_record, set: async()=>{}, remove: async()=>true, keys: async()=>['dev'],
});

const real_set_timeout = globalThis.setTimeout;

let dir: string;
const env_dir = ()=>({REPLY_CONFIG_DIR: dir});
const ctx = (profile: string, team_id?: number): Cli_context=>({
    profile, authority: 'https://auth', api_base: 'https://api', key: profile, team_id,
    store: fake_store(), refresh: async(r)=>r,
});

const capture = async(fn: () => unknown | Promise<unknown>): Promise<string>=>{
    const out: string[] = [];
    const log = console.log;
    const write = process.stdout.write;
    console.log = (...a: unknown[])=>{ out.push(a.join(' ')); };
    process.stdout.write = ((c: unknown): boolean=>{ out.push(String(c)); return true; }) as typeof process.stdout.write;
    try { await fn(); } finally { console.log = log; process.stdout.write = write; }
    return out.join('\n').trim();
};

beforeEach(()=>{
    vi.clearAllMocks();
    vi.stubGlobal('setTimeout', ((fn: (...a: unknown[])=>void)=>real_set_timeout(fn, 0)) as unknown as typeof setTimeout);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-team-'));
    process.env.REPLY_CONFIG_DIR = dir;
});
afterEach(()=>{
    vi.stubGlobal('setTimeout', real_set_timeout);
    delete process.env.REPLY_CONFIG_DIR;
    fs.rmSync(dir, {recursive: true, force: true});
});

describe('handle_team_list', ()=>{
    it('lists teams and marks the profile team with *', async()=>{
        mock_fetch.mockResolvedValue(res([{teamId: 1045, teamName: 'Acme'}, {teamId: 2087, teamName: 'Beta'}]));
        const text = await capture(()=>handle_team_list(ctx('dev', 1045), {}));
        expect(text).toContain('Acme');
        expect(text).toContain('2087');
        expect(text).toMatch(/\*\s*1045/);
    });

    it('emits JSON with current_team_id + teams', async()=>{
        mock_fetch.mockResolvedValue(res([{teamId: 1045, teamName: 'Acme'}]));
        const text = await capture(()=>handle_team_list(ctx('dev', 1045), {json: true}));
        const parsed = JSON.parse(text);
        expect(parsed.current_team_id).toBe(1045);
        expect(parsed.teams).toEqual([{team_id: 1045, team_name: 'Acme'}]);
    });
});

describe('handle_team_current', ()=>{
    it('shows pinned (offline) and effective (from whoami)', async()=>{
        mock_fetch.mockResolvedValue(res({userId: 1, username: 'a', teamId: 2087}));
        const text = await capture(()=>handle_team_current(ctx('dev', 1045), {}));
        expect(text).toContain('pinned team');
        expect(text).toContain('1045');
        expect(text).toContain('effective team');
        expect(text).toContain('2087');
    });

    it('degrades to failed-to-retrieve when whoami errors', async()=>{
        mock_fetch.mockRejectedValue(new TypeError('offline'));
        const text = await capture(()=>handle_team_current(ctx('dev', 1045), {}));
        expect(text).toContain('pinned team');
        expect(text).toMatch(/failed to retrieve/i);
    });
});

describe('handle_team_use', ()=>{
    it('verifies membership and writes team_id to the current profile', async()=>{
        add_profile('dev', {}, env_dir());
        mock_fetch.mockResolvedValue(res([{teamId: 1045, teamName: 'Acme'}, {teamId: 2087, teamName: 'Beta'}]));
        await capture(()=>handle_team_use('2087', ctx('dev'), {}));
        expect(resolve_profile('dev', env_dir()).team_id).toBe(2087);
    });

    it('rejects a team the user is not in', async()=>{
        add_profile('dev', {}, env_dir());
        mock_fetch.mockResolvedValue(res([{teamId: 1045, teamName: 'Acme'}]));
        await expect(handle_team_use('9999', ctx('dev'), {})).rejects.toThrow(UsageError);
    });
});

describe('handle_team_clear', ()=>{
    it('clears the current profile team', async()=>{
        add_profile('dev', {team_id: 1045}, env_dir());
        await capture(()=>handle_team_clear(ctx('dev'), {}));
        expect(resolve_profile('dev', env_dir()).team_id).toBeUndefined();
    });
});
