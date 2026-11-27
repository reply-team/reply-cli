import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {spawn} from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type {AddressInfo} from 'net';

// The built CLI: these tests run real processes, so `npm run build` comes first.
const CLI = path.resolve(__dirname, '..', '..', '..', 'dist', 'index.js');
const PROFILE = 'race';
// Long enough for a second process to start and reach the sign-in server while the first waits.
const HOLD_MS = 2_000;

type Seen = {path: string; user_agent?: string; body: string};

type Fake_reply = {
    url: string;
    refreshes: number;
    refresh_tokens: Set<string>;
    access_tokens: Set<string>;
    seen: Seen[];
    revocation_status: number;
    on_revocation?: () => void;
    hold_ms: number;
    release: () => void;
    close: () => Promise<void>;
};

const read_body = (req: http.IncomingMessage): Promise<string>=>new Promise((resolve, reject)=>{
    let body = '';
    req.on('data', chunk=>{ body += chunk; });
    req.on('end', ()=>resolve(body));
    req.on('error', reject);
});

const send_json = (res: http.ServerResponse, status: number, body: unknown): void=>{
    res.writeHead(status, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(body));
};

// One local server for the sign-in server and the API. Its token endpoint hands out one-time
// refresh tokens, as Reply's does, and answers a spent one with invalid_grant. A refresh takes
// effect when it arrives and only its answer waits: the first one is held until a second one
// arrives, the test calls `release`, or `hold_ms` passes. So two processes that refresh at once
// both reach it with the same token, and a process that reads the file meanwhile still finds the
// spent one.
//
// Its revocation endpoint (RFC 7009) answers 200 for a token revoked and for one it doesn't know,
// and accepts only the request the CLI is meant to send: a refresh token named as one, for the
// CLI's client. `revocation_status` set to an error makes it refuse, revoking nothing; set to 307
// it redirects to `/moved`, which would revoke and confirm. `on_revocation` runs as a revocation
// arrives, before it is answered.
const start_fake_reply = async(): Promise<Fake_reply>=>{
    let next = 1;
    let release_first: (() => void) | undefined;
    const fake = {
        refreshes: 0,
        refresh_tokens: new Set(['rt-0']),
        access_tokens: new Set<string>(),
        seen: [] as Seen[],
        revocation_status: 200,
        on_revocation: undefined as (() => void) | undefined,
        hold_ms: HOLD_MS,
        release: ()=>release_first?.(),
    };

    const answer_refresh = (form: URLSearchParams): [number, unknown]=>{
        const token = form.get('refresh_token') ?? '';
        if (form.get('grant_type') !== 'refresh_token' || form.get('client_id') !== 'Reply.Cli' || !fake.refresh_tokens.delete(token))
        {
            return [400, {error: 'invalid_grant'}];
        }
        const n = next++;
        fake.refresh_tokens.add(`rt-${n}`);
        fake.access_tokens.add(`at-${n}`);
        return [200, {access_token: `at-${n}`, refresh_token: `rt-${n}`, expires_in: 3600, token_type: 'Bearer'}];
    };

    const answer_revocation = (form: URLSearchParams, status: number): [number, unknown]=>{
        if (form.get('client_id') !== 'Reply.Cli')
        {
            return [400, {error: 'invalid_client'}];
        }
        if (form.get('token_type_hint') !== 'refresh_token' || !form.get('token'))
        {
            return [400, {error: 'unsupported_token_type'}];
        }
        if (status !== 200)
        {
            return [status, {error: 'server_error'}];
        }
        fake.refresh_tokens.delete(form.get('token') ?? '');
        return [200, {}];
    };

    const server = http.createServer(async(req, res)=>{
        const body = await read_body(req);
        fake.seen.push({path: req.url ?? '', user_agent: req.headers['user-agent'], body});
        if (req.method === 'POST' && req.url === '/connect/token')
        {
            fake.refreshes += 1;
            const [status, answer] = answer_refresh(new URLSearchParams(body));
            if (release_first)
            {
                release_first();
                release_first = undefined;
                await new Promise(r=>setImmediate(r));
            }
            else if (fake.refreshes === 1)
            {
                await new Promise<void>(resolve=>{
                    release_first = resolve;
                    setTimeout(resolve, fake.hold_ms);
                });
                release_first = undefined;
            }
            send_json(res, status, answer);
            return;
        }
        if (req.method === 'POST' && req.url === '/connect/revocation')
        {
            fake.on_revocation?.();
            if (fake.revocation_status === 307)
            {
                res.writeHead(307, {Location: '/moved'});
                res.end();
                return;
            }
            const [status, answer] = answer_revocation(new URLSearchParams(body), fake.revocation_status);
            send_json(res, status, answer);
            return;
        }
        if (req.method === 'POST' && req.url === '/moved')
        {
            const [status, answer] = answer_revocation(new URLSearchParams(body), 200);
            send_json(res, status, answer);
            return;
        }
        if (req.method === 'GET' && req.url === '/v3/whoami')
        {
            const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
            if (!fake.access_tokens.has(token))
            {
                send_json(res, 401, {title: 'Unauthorized'});
                return;
            }
            send_json(res, 200, {userId: 7, username: 'ann@example.com', teamId: 3});
            return;
        }
        send_json(res, 404, {title: 'Not found'});
    });
    await new Promise<void>(resolve=>server.listen(0, '127.0.0.1', resolve));
    const {port} = server.address() as AddressInfo;
    return Object.assign(fake, {
        url: `http://127.0.0.1:${port}`,
        close: ()=>new Promise<void>(resolve=>server.close(()=>resolve())),
    });
};

// An address nothing listens on: a port the system handed out, closed again.
const closed_url = async(): Promise<string>=>{
    const server = http.createServer();
    await new Promise<void>(resolve=>server.listen(0, '127.0.0.1', resolve));
    const {port} = server.address() as AddressInfo;
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    return `http://127.0.0.1:${port}`;
};

type Run = {code: number | null; stdout: string; stderr: string};

const run_cli = (args: string[], env: NodeJS.ProcessEnv, on_spawn?: () => void): Promise<Run>=>new Promise(resolve=>{
    const child = spawn(process.execPath, [CLI, ...args], {env, stdio: ['ignore', 'pipe', 'pipe']});
    if (on_spawn)
    {
        child.on('spawn', on_spawn);
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk=>{ stdout += chunk; });
    child.stderr.on('data', chunk=>{ stderr += chunk; });
    child.on('close', code=>resolve({code, stdout, stderr}));
});

const until = async(done: () => boolean, ms = 10_000): Promise<void>=>{
    const end = Date.now() + ms;
    while (!done())
    {
        if (Date.now() > end)
        {
            throw new Error(`still waiting after ${ms} ms`);
        }
        await new Promise(r=>setTimeout(r, 20));
    }
};

// Nothing outside the temp dir: no credential, profile or home from the machine running the test.
const isolated_env = (dir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv=>{
    const env: NodeJS.ProcessEnv = Object.fromEntries(
        Object.entries(process.env).filter(([name])=>!name.startsWith('REPLY_')));
    return Object.assign(env, {
        REPLY_CONFIG_DIR: dir, REPLY_PROFILE: PROFILE, REPLY_NO_UPDATE_CHECK: '1',
        HOME: dir, USERPROFILE: dir, APPDATA: dir, XDG_CONFIG_HOME: dir,
    }, extra);
};

const oauth_record = (expires_at: number)=>({type: 'oauth', access_token: 'at-0', refresh_token: 'rt-0', expires_at});

// Points the profile at `authority` and stores `record` as its only credential.
const sign_in = (dir: string, authority: string, record: unknown): void=>{
    fs.writeFileSync(path.join(dir, 'config.json'),
        JSON.stringify({profiles: {[PROFILE]: {authority, api_base: authority}}}));
    fs.writeFileSync(path.join(dir, 'credentials.json'), JSON.stringify({[PROFILE]: record}));
};

const stored = (dir: string): unknown=>JSON.parse(fs.readFileSync(path.join(dir, 'credentials.json'), 'utf8'))[PROFILE];

const warnings = (r: Run): string[]=>r.stderr.split('\n').filter(l=>l.includes('may still be valid at Reply'));

describe('reply processes against one sign-in', ()=>{
    let dir: string;
    let fake: Fake_reply;

    beforeEach(async()=>{
        expect(fs.existsSync(CLI), `${CLI} is missing: run \`npm run build\` first`).toBe(true);
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-race-'));
        fake = await start_fake_reply();
    });

    afterEach(async()=>{
        await fake.close();
        fs.rmSync(dir, {recursive: true, force: true});
    });

    // Breaks if the second process spends the one-time refresh token the first already spent, and
    // signs the person out on the refusal: what happens when an app starts several commands at once.
    it('two processes refreshing one expired sign-in together both end signed in, on one refresh', async()=>{
        sign_in(dir, fake.url, oauth_record(Date.now() - 60_000));
        const env = isolated_env(dir);

        const runs = await Promise.all([
            run_cli(['auth', 'whoami', '--json'], env),
            run_cli(['auth', 'whoami', '--json'], env),
        ]);

        expect(runs.map(r=>r.code), runs.map(r=>r.stderr).join('\n')).toEqual([0, 0]);
        for (const r of runs)
        {
            expect(JSON.parse(r.stdout)).toEqual({userId: 7, username: 'ann@example.com', teamId: 3});
        }
        expect(fake.refreshes).toBe(1);
        const record = stored(dir) as {expires_at: number; refresh_token: string};
        expect(record).toMatchObject({type: 'oauth', access_token: 'at-1', refresh_token: 'rt-1'});
        expect(record.expires_at).toBeGreaterThan(Date.now());
        expect(fake.refresh_tokens.has(record.refresh_token)).toBe(true);
        expect(fs.existsSync(path.join(dir, 'credentials.json.lock'))).toBe(false);
    }, 30_000);

    // Breaks if a logout reads the refresh token outside the credentials lock: while another process
    // refreshes, it would revoke the spent token and leave the new one alive at Reply after the person
    // signed out. Breaks too if the revocation doesn't name the token as a refresh token or carry the
    // CLI's client id (the fake refuses it), or goes out under another User-Agent than the token
    // requests.
    it('a logout while another process refreshes ends the refreshed sign-in at Reply', async()=>{
        sign_in(dir, fake.url, oauth_record(Date.now() - 60_000));
        const env = isolated_env(dir, {REPLY_CLIENT: 'some-app/1.2.3'});
        // The refresh's answer waits for the test, not a clock started before the logout spawned: the
        // logout gets HOLD_MS from its own start to read the file while it still holds the spent token.
        fake.hold_ms = 20_000;

        const whoami = run_cli(['auth', 'whoami', '--json'], env);
        await until(()=>fake.refreshes === 1);
        const logout = await run_cli(['auth', 'logout', '--json'], env, ()=>setTimeout(fake.release, HOLD_MS));
        const refreshed = await whoami;

        expect([refreshed.code, logout.code], refreshed.stderr + logout.stderr).toEqual([0, 0]);
        expect(JSON.parse(logout.stdout)).toEqual({logged_out: true, revoked: true});
        expect(fake.refresh_tokens.size).toBe(0);
        expect(stored(dir)).toBeUndefined();
        const sign_in_requests = fake.seen.filter(s=>s.path.startsWith('/connect/'));
        expect(sign_in_requests.map(s=>s.path).sort()).toEqual(['/connect/revocation', '/connect/token']);
        expect(new Set(sign_in_requests.map(s=>s.user_agent))).toEqual(new Set([expect.stringMatching(/^some-app\/1\.2\.3 reply-cli\//)]));
    }, 30_000);

    // Breaks if a revocation that fails keeps the local record or fails the command (the person asked
    // to be signed out here), if nothing says the sign-in may live on at Reply, or if a token is
    // printed. Breaks too if a redirect is followed: it would post the refresh token wherever the
    // redirect points, and a page that answers there would count as confirmed.
    it('a logout the sign-in server refuses, redirects, or can\'t be reached for, still signs out here and says so', async()=>{
        const env = isolated_env(dir);

        fake.revocation_status = 503;
        sign_in(dir, fake.url, oauth_record(Date.now() + 3_600_000));
        const refused = await run_cli(['auth', 'logout', '--json'], env);
        expect(refused.code, refused.stderr).toBe(0);
        expect(JSON.parse(refused.stdout)).toEqual({logged_out: true, revoked: false});
        expect(refused.stderr.trim().split('\n')).toEqual(warnings(refused));
        expect(warnings(refused)).toHaveLength(1);
        expect(fake.refresh_tokens.has('rt-0')).toBe(true);
        expect(stored(dir)).toBeUndefined();

        fake.revocation_status = 307;
        sign_in(dir, fake.url, oauth_record(Date.now() + 3_600_000));
        const redirected = await run_cli(['auth', 'logout', '--json'], env);
        expect(redirected.code, redirected.stderr).toBe(0);
        expect(JSON.parse(redirected.stdout)).toEqual({logged_out: true, revoked: false});
        expect(warnings(redirected)).toEqual([expect.stringContaining('HTTP 307')]);
        expect(fake.seen.map(s=>s.path)).not.toContain('/moved');
        expect(fake.refresh_tokens.has('rt-0')).toBe(true);
        expect(stored(dir)).toBeUndefined();

        sign_in(dir, await closed_url(), oauth_record(Date.now() + 3_600_000));
        const unreachable = await run_cli(['auth', 'logout'], env);
        expect(unreachable.code, unreachable.stderr).toBe(0);
        expect(unreachable.stderr).toContain('Logged out.');
        expect(warnings(unreachable)).toHaveLength(1);
        expect(stored(dir)).toBeUndefined();

        for (const r of [refused, redirected, unreachable])
        {
            expect(r.stdout + r.stderr).not.toMatch(/rt-0|at-0/);
        }
    }, 30_000);

    // Breaks if a logout reports the sign-in ended at Reply after the record changed under it while
    // its revocation was out. That happens when it stalls past the lock's stale limit (a suspended
    // machine) and another process takes the lock over and stores a refreshed token: the token
    // revoked is then the spent one, and the new one is still live at Reply.
    it('a logout whose record changed during the revocation says the sign-in may still be valid', async()=>{
        sign_in(dir, fake.url, oauth_record(Date.now() + 3_600_000));
        fake.on_revocation = ()=>{
            // What a process that took the lock over leaves: rt-0 refreshed to rt-1, and rt-1 stored.
            fake.refresh_tokens.delete('rt-0');
            fake.refresh_tokens.add('rt-1');
            sign_in(dir, fake.url, {type: 'oauth', access_token: 'at-1', refresh_token: 'rt-1', expires_at: Date.now() + 3_600_000});
        };

        const logout = await run_cli(['auth', 'logout', '--json'], isolated_env(dir));

        expect(logout.code, logout.stderr).toBe(0);
        expect(JSON.parse(logout.stdout)).toEqual({logged_out: true, revoked: false});
        expect(logout.stderr.trim().split('\n')).toEqual(warnings(logout));
        expect(warnings(logout)).toHaveLength(1);
        expect(fake.refresh_tokens.has('rt-1')).toBe(true);
        expect(stored(dir)).toBeUndefined();
        expect(logout.stdout + logout.stderr).not.toMatch(/rt-[01]|at-[01]/);
    }, 30_000);

    // Breaks if an API key, stored or from --api-key or REPLY_API_KEY, is ever posted to the sign-in
    // server, if a logout with no sign-in to end sends anything or reports a revocation, or if a key
    // in play keeps a stored OAuth sign-in from being ended at Reply.
    it('a logout sends only a stored refresh token, never an API key', async()=>{
        const env = isolated_env(dir, {REPLY_API_KEY: 'env-key'});

        sign_in(dir, fake.url, {type: 'api_key', key: 'stored-key'});
        const api_key_logout = await run_cli(['auth', 'logout', '--json', '--api-key', 'flag-key'], env);
        expect(api_key_logout.code, api_key_logout.stderr).toBe(0);
        expect(JSON.parse(api_key_logout.stdout)).toEqual({logged_out: true});
        expect(stored(dir)).toBeUndefined();

        const nothing_stored = await run_cli(['auth', 'logout', '--json'], env);
        expect(nothing_stored.code, nothing_stored.stderr).toBe(0);
        expect(JSON.parse(nothing_stored.stdout)).toEqual({logged_out: false});
        expect(fake.seen).toEqual([]);

        sign_in(dir, fake.url, oauth_record(Date.now() + 3_600_000));
        const oauth_logout = await run_cli(['auth', 'logout', '--json', '--api-key', 'flag-key'], env);
        expect(oauth_logout.code, oauth_logout.stderr).toBe(0);
        expect(JSON.parse(oauth_logout.stdout)).toEqual({logged_out: true, revoked: true});
        expect(fake.refresh_tokens.has('rt-0')).toBe(false);
        expect(stored(dir)).toBeUndefined();
        expect(fake.seen.map(s=>s.path)).toEqual(['/connect/revocation']);
        expect(fake.seen[0].body).not.toMatch(/stored-key|env-key|flag-key/);
    }, 30_000);
});
