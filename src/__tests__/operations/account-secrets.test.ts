import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mock_fetch, json, ctx, answer, capture} from './helpers';
import {handle_account_connect, handle_account_reconnect, handle_account_pending} from '../../operations/account-links';
import {CliError} from '../../utils/errors';
import type {Op_globals} from '../../operations/options';

// The secret rule: a link, the shared page's address and any token in them are printed once, in the stdout
// field `link`, and nowhere else. Every link command runs here with --verbose against a stubbed Reply; the
// whole of stderr, the trace and any error are searched for the token and the link.

const APP = 'https://app.example.test';
const missing = ()=>json({title: 'Not Found', status: 404}, 404);

type Case = {
    name: string;
    answers: (t: string) => Response[];
    run: (g: Op_globals) => Promise<void>;
    printed: number;        // how many times the token is on stdout: once in `link`, or never
    traced_link: boolean;   // whether an answer carried a link, so the trace shows it redacted
};

// A header that repeats the link, as a proxy or a debug build might: it must not leak either.
const leaky = (data: unknown, t: string, status = 200)=>json(data, status, {'X-Debug-Link': `${APP}/email-connect/${t}`});

const CASES: Case[] = [
    {name: 'connect email, connection link', printed: 1, traced_link: true,
        answers: t=>[json({connectionLink: `${APP}/email-connect/${t}`, pendingAccountId: 50, provider: 'gmail', expiresAtUtc: '2026-11-18T12:00:00Z'},
            201, {Location: 'v3/email-accounts/pending/50'})],
        run: g=>handle_account_connect({channel: 'email', provider: 'gmail'}, ctx(), g)},
    {name: 'reconnect email, connection link', printed: 1, traced_link: true,
        answers: t=>[leaky({connectionLink: `${APP}/email-connect/${t}`, pendingAccountId: 52, provider: 'office365',
            expiresAtUtc: '2026-11-18T12:00:00Z'}, t)],
        run: g=>handle_account_reconnect('12', {channel: 'email'}, ctx(), g)},
    ...(['gmail', 'office365', undefined] as const).map((provider): Case=>({
        name: `connect email, shared page, ${provider ?? 'index'}`, printed: 1, traced_link: true,
        answers: t=>[provider === undefined ? json([], 404) : missing(), leaky({url: `${APP}/hosted/eac/index/${t}`}, t)],
        run: g=>handle_account_connect({channel: 'email', provider, allowSharedPage: true}, ctx(), g),
    })),
    ...(['gmail', undefined] as const).map((provider): Case=>({
        name: `reconnect email, shared page, ${provider ?? 'index'}`, printed: 1, traced_link: true,
        answers: t=>[missing(), json({url: `${APP}/hosted/eac/index/${t}`})],
        run: g=>handle_account_reconnect('12', {channel: 'email', provider, allowSharedPage: true}, ctx(), g),
    })),
    {name: 'connect linkedin', printed: 1, traced_link: true,
        answers: t=>[json({connectionLink: `${APP}/linkedin-connect/${t}`, pendingAccountId: 51}, 201)],
        run: g=>handle_account_connect({channel: 'linkedin', name: 'Dana Example'}, ctx(), g)},
    {name: 'reconnect linkedin, a provider\'s link with the token in its query', printed: 1, traced_link: true,
        answers: t=>[json({connectionLink: `https://auth.example.test/wizard?state=${t}&lang=en`})],
        run: g=>handle_account_reconnect('34', {channel: 'linkedin'}, ctx(), g)},
    {name: 'pending, a LinkedIn entry with its link', printed: 0, traced_link: true,
        answers: t=>[json([]), json([{id: 7, name: 'Dana', connectionLink: `${APP}/linkedin-connect/${t}`, expiresAtUtc: null, isExpired: false}])],
        run: g=>handle_account_pending({}, ctx(), g)},
    {name: 'a shared page in a form the CLI cannot read, so an error', printed: 0, traced_link: true,
        answers: t=>[missing(), json({url: `${APP}/hosted/elsewhere/${t}`})],
        run: g=>handle_account_connect({channel: 'email', provider: 'gmail', allowSharedPage: true}, ctx(), g)},
    // The shared page's answer is a secret whatever its shape: a bare string, or a body with no address in it.
    {name: 'connect email, shared page answered as a bare string', printed: 1, traced_link: true,
        answers: t=>[missing(), leaky(`${APP}/hosted/eac/index/${t}`, t)],
        run: g=>handle_account_connect({channel: 'email', provider: 'office365', allowSharedPage: true}, ctx(), g)},
    {name: 'reconnect email, shared page answered as a bare string, the index', printed: 1, traced_link: true,
        answers: t=>[missing(), json(`${APP}/hosted/eac/index/${t}`)],
        run: g=>handle_account_reconnect('12', {channel: 'email', allowSharedPage: true}, ctx(), g)},
    {name: 'a shared page answered as a bare token, not an address, so an error', printed: 0, traced_link: true,
        answers: t=>[missing(), json(t)],
        run: g=>handle_account_connect({channel: 'email', provider: 'gmail', allowSharedPage: true}, ctx(), g)},
    {name: 'a shared page answered as text that is not an address, so an error', printed: 0, traced_link: true,
        answers: t=>[missing(), json(`hosted token ${t} for this user`)],
        run: g=>handle_account_connect({channel: 'email', provider: 'gmail', allowSharedPage: true}, ctx(), g)},
    {name: 'a shared page answered as an object holding no address, so an error', printed: 0, traced_link: true,
        answers: t=>[missing(), json({hostedToken: t})],
        run: g=>handle_account_connect({channel: 'email', provider: 'gmail', allowSharedPage: true}, ctx(), g)},
    {name: 'a shared page refused with the address in the refusal, so an error', printed: 0, traced_link: true,
        answers: t=>[missing(), json({title: 'Bad Request', detail: `open ${APP}/hosted/eac/index/${t} instead`}, 400)],
        run: g=>handle_account_connect({channel: 'email', provider: 'gmail', allowSharedPage: true}, ctx(), g)},
    {name: 'an answer without a usable link, so outcome unknown', printed: 0, traced_link: true,
        answers: t=>[json({connectionLink: 42, pendingAccountId: 51, debug: {url: `${APP}/linkedin-connect/${t}`}}, 201)],
        run: g=>handle_account_connect({channel: 'linkedin', name: 'Dana'}, ctx(), g)},
];

const occurrences = (text: string, s: string): number=>text.split(s).length - 1;

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('the secret rule', ()=>{
    for (const c of CASES)
    {
        it(`${c.name}: the token is on stdout ${c.printed === 1 ? 'once, in link' : 'nowhere'}, and in no trace, error or stderr`, async()=>{
            const t = crypto.randomBytes(24).toString('base64url');
            answer(...c.answers(t));
            let error: unknown;
            const {out, err} = await capture(()=>c.run({json: true, verbose: true}).catch((e: unknown)=>{ error = e; }));
            const said = [err, ...(error instanceof CliError ? [error.message, JSON.stringify(error.to_json()), error.hint ?? ''] : [])].join('\n');

            expect(err, 'the trace ran').toMatch(/^> (GET|POST) https:\/\/api\//m);
            const link = c.printed === 1 ? JSON.parse(out).link as string : undefined;
            for (const form of [t, encodeURIComponent(t), ...(link === undefined ? [] : [link])])
            {
                expect(occurrences(said, form), `${form} in:\n${said}`).toBe(0);
            }
            expect(said.includes('<link redacted>'), said).toBe(c.traced_link);
            expect(occurrences(out, t), out).toBe(c.printed);
            if (link !== undefined)
            {
                expect(link).toContain(t);
            }
        });
    }
});

// The same through the program as `reply` runs it: --verbose reaches the account commands, and the error
// line is written with the link nowhere in it.
describe('the secret rule, through the program', ()=>{
    const argv = process.argv;
    let dir: string;
    beforeEach(()=>{
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-secrets-'));
        process.env.REPLY_CONFIG_DIR = dir;
    });
    afterEach(()=>{
        vi.restoreAllMocks();
        process.argv = argv;
        delete process.env.REPLY_CONFIG_DIR;
        fs.rmSync(dir, {recursive: true, force: true});
    });

    it('a shared page the CLI cannot read: exit 1, a trace on stderr, the token nowhere', async()=>{
        const t = crypto.randomBytes(24).toString('base64url');
        answer(missing(), json({url: `${APP}/hosted/elsewhere/${t}`}));
        let exited!: (code: number) => void;
        const exit = new Promise<number>(resolve=>{ exited = resolve; });
        let first: number | undefined;
        vi.spyOn(process, 'exit').mockImplementation(((code?: number)=>{
            if (first === undefined)
            {
                first = code ?? 0;
                exited(first);
            }
        }) as typeof process.exit);
        process.argv = ['node', 'reply', '--json', '-k', 'key-1', '--verbose', 'account', 'connect', '--channel', 'email', '--provider', 'gmail',
            '--allow-shared-page'];
        vi.resetModules();
        let code = -1;
        const {out, err} = await capture(async()=>{
            await import('../../index');
            code = await exit;
        });
        expect(code).toBe(1);
        expect(err).toContain('> GET https://api.reply.io/v1/SharedPageUrl');
        expect(err).toContain('<link redacted>');
        expect(err).toContain('"code":"reply.unavailable"');
        expect(occurrences(err + out, t), err).toBe(0);
    });
});
