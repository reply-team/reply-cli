import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {spawn} from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type {AddressInfo} from 'net';

// The built CLI: this test runs real processes, so `npm run build` comes first.
const CLI = path.resolve(__dirname, '..', '..', '..', 'dist', 'index.js');
const PROFILE = 'race';
// Long enough for the second process to start and reach the token endpoint while the first waits.
const HOLD_MS = 2_000;

type Fake_reply = {
    url: string;
    refreshes: number;
    refresh_tokens: Set<string>;
    access_tokens: Set<string>;
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
// refresh tokens, as Reply's does, and answers a spent one with invalid_grant. It holds the first
// refresh until a second one arrives or HOLD_MS passes, so two processes that refresh at once both
// reach it with the same token.
const start_fake_reply = async(): Promise<Fake_reply>=>{
    let next = 1;
    let release_first: (() => void) | undefined;
    const fake = {
        refreshes: 0,
        refresh_tokens: new Set(['rt-0']),
        access_tokens: new Set<string>(),
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

    const server = http.createServer(async(req, res)=>{
        const body = await read_body(req);
        if (req.method === 'POST' && req.url === '/connect/token')
        {
            fake.refreshes += 1;
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
                    setTimeout(resolve, HOLD_MS);
                });
                release_first = undefined;
            }
            const [status, answer] = answer_refresh(new URLSearchParams(body));
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

type Run = {code: number | null; stdout: string; stderr: string};

const run_cli = (args: string[], env: NodeJS.ProcessEnv): Promise<Run>=>new Promise(resolve=>{
    const child = spawn(process.execPath, [CLI, ...args], {env, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk=>{ stdout += chunk; });
    child.stderr.on('data', chunk=>{ stderr += chunk; });
    child.on('close', code=>resolve({code, stdout, stderr}));
});

describe('two reply processes refreshing one expired sign-in together', ()=>{
    let dir: string;
    let fake: Fake_reply;

    beforeEach(async()=>{
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-race-'));
        fake = await start_fake_reply();
    });

    afterEach(async()=>{
        await fake.close();
        fs.rmSync(dir, {recursive: true, force: true});
    });

    // Breaks if the second process spends the one-time refresh token the first already spent, and
    // signs the person out on the refusal: what happens when an app starts several commands at once.
    it('both end signed in, on one refresh', async()=>{
        expect(fs.existsSync(CLI), `${CLI} is missing: run \`npm run build\` first`).toBe(true);
        const credentials = path.join(dir, 'credentials.json');
        fs.writeFileSync(path.join(dir, 'config.json'),
            JSON.stringify({profiles: {[PROFILE]: {authority: fake.url, api_base: fake.url}}}));
        fs.writeFileSync(credentials, JSON.stringify({[PROFILE]: {
            type: 'oauth', access_token: 'at-0', refresh_token: 'rt-0', expires_at: Date.now() - 60_000,
        }}));

        // Nothing outside the temp dir: no credential, profile or home from the machine running the test.
        const env: NodeJS.ProcessEnv = Object.fromEntries(
            Object.entries(process.env).filter(([name])=>!name.startsWith('REPLY_')));
        Object.assign(env, {
            REPLY_CONFIG_DIR: dir, REPLY_PROFILE: PROFILE, REPLY_NO_UPDATE_CHECK: '1',
            HOME: dir, USERPROFILE: dir, APPDATA: dir, XDG_CONFIG_HOME: dir,
        });

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
        const stored = JSON.parse(fs.readFileSync(credentials, 'utf8'))[PROFILE];
        expect(stored).toMatchObject({type: 'oauth', access_token: 'at-1', refresh_token: 'rt-1'});
        expect(stored.expires_at).toBeGreaterThan(Date.now());
        expect(fake.refresh_tokens.has(stored.refresh_token)).toBe(true);
        expect(fs.existsSync(`${credentials}.lock`)).toBe(false);
    }, 30_000);
});
