import fs from 'fs';
import os from 'os';
import path from 'path';
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mock_fetch, json, answer, capture} from './helpers';

// The whole program, as `reply` runs it: commander parsing, the top-level error handler and the
// exit code. Importing the entry point runs it against process.argv, so each test sets argv,
// imports a fresh copy, and waits for the exit it makes.
const run_program = async(args: string[]): Promise<{code: number; err: string}>=>{
    let exited!: (code: number) => void;
    const exit = new Promise<number>(resolve=>{ exited = resolve; });
    // Only the first exit counts: the stub returns, so the handler runs on past it.
    let first: number | undefined;
    vi.spyOn(process, 'exit').mockImplementation(((code?: number)=>{
        if (first === undefined)
        {
            first = code ?? 0;
            exited(first);
        }
    }) as typeof process.exit);
    process.argv = ['node', 'reply', ...args];
    vi.resetModules();
    let code = -1;
    const {err} = await capture(async()=>{
        await import('../../index');
        code = await exit;
    });
    return {code, err: err.split('\n')[0]};
};

const argv = process.argv;
let dir: string;
beforeEach(()=>{
    mock_fetch.mockReset();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-program-'));
    process.env.REPLY_CONFIG_DIR = dir;
});
afterEach(()=>{
    vi.restoreAllMocks();
    process.argv = argv;
    delete process.env.REPLY_CONFIG_DIR;
    fs.rmSync(dir, {recursive: true, force: true});
});

const lost_connection = ()=>Object.assign(new TypeError('fetch failed'),
    {cause: Object.assign(new Error('ECONNRESET'), {code: 'ECONNRESET'})});

describe('the program', ()=>{
    it('takes global options before the noun, and a write whose answer was lost exits 3 with the envelope on stderr', async()=>{
        mock_fetch.mockRejectedValue(lost_connection());
        const {code, err} = await run_program(['--json', '-q', '-k', 'key-1', '--team-id', '7', 'sequence', 'pause', '123']);
        expect(code).toBe(3);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'outcome.unknown', ids: {sequence_id: 123}}});
        const [url, init] = mock_fetch.mock.calls[0] as [string, RequestInit];
        expect(url).toMatch(/\/v3\/sequences\/123\/pause$/);
        expect(init.headers).toMatchObject({'Authorization': 'Bearer key-1', 'X-TEAM-ID': '7'});
        expect(mock_fetch).toHaveBeenCalledTimes(1);
    });

    it('a definite refusal exits 1 with its code', async()=>{
        answer(json({code: 'sequenceAction.status', detail: 'current status is New'}, 409));
        const {code, err} = await run_program(['--json', '-k', 'key-1', 'sequence', 'pause', '123']);
        expect(code).toBe(1);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'sequence.not_pausable', reply_code: 'sequenceAction.status'}});
    });

    it('inbox reply refuses a message given on the argument list: exit 2, no request, the text not repeated', async()=>{
        const {code, err} = await run_program(['--json', '-k', 'key-1', 'inbox', 'reply', '9', '--message', '{"body":"Tuesday works"}']);
        expect(code).toBe(2);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'usage.message'}});
        expect(err, err).not.toContain('Tuesday');
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('contact update refuses fields given on the argument list: exit 2, no request, the values not repeated', async()=>{
        const {code, err} = await run_program(['--json', '-k', 'key-1', 'contact', 'update', '5', '--fields', '{"first_name":"Marta"}']);
        expect(code).toBe(2);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'usage.fields'}});
        expect(err, err).not.toContain('Marta');
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('sequence create refuses a name given on the argument list: exit 2, no request, the name not repeated', async()=>{
        const {code, err} = await run_program(['--json', '-k', 'key-1', 'sequence', 'create', '--name', '{"name":"Q4 Outreach"}']);
        expect(code).toBe(2);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'usage.name'}});
        expect(err, err).not.toContain('Outreach');
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('every direct send refuses its text given on the argument list: exit 2, no request, the text not repeated', async()=>{
        const sends: string[][] = [
            ['send-email', '--email-account-id', '12', '--message', '{"subject":"Hi Marta","body":"Tuesday works"}'],
            ['linkedin-connect', '--linkedin-account-id', '34', '--message', '{"note":"Hi Marta, Tuesday works"}'],
            ['linkedin-message', '--linkedin-account-id', '34', '--message', '{"body":"Hi Marta, Tuesday works"}'],
            ['linkedin-inmail', '--linkedin-account-id', '34', '--message', '{"subject":"Hi Marta","body":"Tuesday works"}'],
            ['linkedin-voice', '--linkedin-account-id', '34', '--message', '{"script":"Hi Marta, Tuesday works"}'],
        ];
        for (const [name, ...rest] of sends)
        {
            mock_fetch.mockReset();
            const {code, err} = await run_program(['--json', '-k', 'key-1', 'contact', name, '--contact-id', '456', ...rest]);
            expect(code, name).toBe(2);
            expect(JSON.parse(err), name).toMatchObject({error: {code: 'usage.message'}});
            expect(err, err).not.toContain('Marta');
            expect(err, err).not.toContain('Tuesday');
            expect(mock_fetch, name).not.toHaveBeenCalled();
        }
    });

    // Stdin as the program reads it: descriptor 0 answers the text piped in, every other read goes to the disk.
    const pipe_stdin = (text: string): void=>{
        const real = fs.readFileSync;
        vi.spyOn(fs, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[])=>
            (file === 0 ? text : (real as (...a: unknown[]) => unknown)(file, ...rest))) as typeof fs.readFileSync);
    };
    const requests = ()=>(mock_fetch.mock.calls as [string, RequestInit][]).map(([url, init])=>
        ({method: String(init.method), url, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined}));
    const PERSONAL = /marta|example\.com|tuesday|cto/i;

    it('a send to a person Reply does not hold takes the person and the text from stdin: the argument list carries '
        + 'neither, and Reply gets both', async()=>{
        pipe_stdin(JSON.stringify({contact: {email: 'marta@example.com', first_name: 'Marta'},
            message: {subject: 'Hi Marta', body: 'Tuesday works'}}));
        answer(json({items: [], hasMore: false}), json({items: [{id: 457, status: 'created'}]}),
            json({code: 'contact.contactInBlackList'}, 400));
        const args = ['--json', '-k', 'key-1', 'contact', 'send-email', '--contact', '-', '--email-account-id', '12', '--message', '-'];
        const {code, err} = await run_program(args);
        expect(args.join(' '), args.join(' ')).not.toMatch(PERSONAL);
        expect(code).toBe(1);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'contact.blacklisted', ids: {contact_id: 457, email_account_id: 12}}});
        expect(err, err).not.toMatch(PERSONAL);
        expect(requests()).toEqual([
            {method: 'GET', url: 'https://api.reply.io/v3/contacts?email=marta%40example.com&top=100&skip=0', body: undefined},
            {method: 'POST', url: 'https://api.reply.io/v3/contacts/import', body: {items: [{email: 'marta@example.com', firstName: 'Marta'}]}},
            {method: 'POST', url: 'https://api.reply.io/v3/contacts/457/send-direct-email',
                body: {emailAccountId: 12, subject: 'Hi Marta', body: 'Tuesday works'}},
        ]);
    });

    const LATER_SEND = ['--json', '-k', 'key-1', 'contact', 'linkedin-message', '--contact-id', '456', '--linkedin-account-id', '34',
        '--message', '-'];

    it('a send for later takes --send-after, --schedule-id and --idempotency-key: the first two in the body, the key as a header', async()=>{
        pipe_stdin(JSON.stringify({body: 'Thanks for connecting.'}));
        answer(json({code: 'directLinkedIn.notConnected'}, 409));
        const {code} = await run_program([...LATER_SEND,
            '--send-after', '2026-11-03T14:00:00Z', '--schedule-id', '41', '--idempotency-key', 'send-456-1']);
        expect(code).toBe(1);
        expect(requests()).toEqual([{method: 'POST', url: 'https://api.reply.io/v3/contacts/456/send-direct-linkedin-message',
            body: {linkedInAccountId: 34, message: 'Thanks for connecting.', sendAfter: '2026-11-03T14:00:00.000Z', scheduleId: 41}}]);
        expect((mock_fetch.mock.calls[0] as [string, RequestInit])[1].headers).toMatchObject({'Idempotency-Key': 'send-456-1'});
    });

    it('a send for later at a moment without its offset exits 2 before any request', async()=>{
        pipe_stdin(JSON.stringify({body: 'Thanks for connecting.'}));
        const {code, err} = await run_program([...LATER_SEND, '--send-after', '2026-11-03T14:00:00']);
        expect(code).toBe(2);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'usage.date'}});
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('a send to a person Reply already holds exits 1, sends nothing, and names the contact', async()=>{
        pipe_stdin(JSON.stringify({contact: {email: 'marta@example.com', first_name: 'Marta'},
            message: {subject: 'Hi Marta', body: 'Tuesday works'}}));
        // Were the send made, this refusal would answer it: a send Reply took ends without the exit this run waits for.
        answer(json({items: [{id: 456, email: 'marta@example.com'}], hasMore: false}), json({code: 'contact.contactInBlackList'}, 400));
        const {code, err} = await run_program(['--json', '-k', 'key-1', 'contact', 'send-email', '--contact', '-', '--email-account-id', '12',
            '--message', '-']);
        expect(code).toBe(1);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'contact.already_held', ids: {contact_id: 456, email_account_id: 12}}});
        expect(err, err).not.toMatch(PERSONAL);
        expect(requests().map(r=>r.method)).toEqual(['GET']);
    });

    it('contact update of a person Reply holds takes the person and the fields from stdin, and changes only the fields', async()=>{
        pipe_stdin(JSON.stringify({contact: {email: 'marta@example.com', linkedin_url: 'https://www.linkedin.com/in/marta-other'},
            fields: {title: 'CTO'}}));
        answer(json({items: [{id: 456, email: 'marta@example.com'}], hasMore: false}), json('', 503));
        const args = ['--json', '-k', 'key-1', 'contact', 'update', '--contact', '-', '--fields', '-'];
        const {code, err} = await run_program(args);
        expect(args.join(' '), args.join(' ')).not.toMatch(PERSONAL);
        expect(code).toBe(3);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'outcome.unknown', ids: {contact_id: 456}}});
        expect(requests().map(r=>[r.method, r.body])).toEqual([['GET', undefined], ['PATCH', {title: 'CTO'}]]);
        expect(requests()[1].url).toBe('https://api.reply.io/v3/contacts/456');
    });

    it('account list is a work command of its own: a channel it does not know exits 2 before any request', async()=>{
        const {code, err} = await run_program(['--json', '-k', 'key-1', 'account', 'list', '--channel', 'sms']);
        expect(code).toBe(2);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'usage.choice'}});
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('schedule list is a work command of its own: a flag or an id exits 2 before any request, a refusal exits 1', async()=>{
        for (const extra of [['--name', 'Business hours'], ['41']])
        {
            const {code} = await run_program(['--json', '-q', '-k', 'key-1', 'schedule', 'list', ...extra]);
            expect(code, extra.join(' ')).toBe(2);
        }
        expect(mock_fetch).not.toHaveBeenCalled();
        // What Reply answers a key without the sequences read scope: a problem with no code.
        answer(json({error: 'insufficient_scope', message: 'This endpoint requires scope \'…\'.', required_scope: '…'}, 403,
            {'Content-Type': 'application/problem+json'}));
        const {code, err} = await run_program(['--json', '-q', '-k', 'key-1', 'schedule', 'list']);
        expect(code).toBe(1);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'access.feature_unavailable', status: 403}});
        expect((mock_fetch.mock.calls[0] as [string, RequestInit])[0]).toBe('https://api.reply.io/v3/schedules');
    });

    it('direct-send is a work command of its own: no reference exits 2, a refused cancel exits 1 with its code', async()=>{
        for (const verb of ['get', 'cancel'])
        {
            const {code} = await run_program(['--json', '-q', '-k', 'key-1', 'direct-send', verb]);
            expect(code, verb).toBe(2);
        }
        expect(mock_fetch).not.toHaveBeenCalled();
        answer(json({code: 'directSend.alreadySent', detail: 'Already sent.'}, 409, {'Content-Type': 'application/problem+json'}));
        const {code, err} = await run_program(['--json', '-q', '-k', 'key-1', 'direct-send', 'cancel', 'email-1001']);
        expect(code).toBe(1);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'direct_send.already_sent', status: 409}});
        const [url, init] = mock_fetch.mock.calls[0] as [string, RequestInit];
        expect([init.method, url]).toEqual(['POST', 'https://api.reply.io/v3/direct-sends/email-1001/cancel']);
    });

    it('inbox events reads its flags through commander: both --cursor and --since exit 2, a refused cursor exits 1 with its code', async()=>{
        const both = await run_program(['--json', '-q', '-k', 'key-1', 'inbox', 'events', '--cursor', 'c1', '--since', '2026-11-03T14:00:00Z']);
        expect(both.code).toBe(2);
        expect(mock_fetch).not.toHaveBeenCalled();
        answer(json({title: 'Validation failed', status: 400, errors: [{pointer: '/cursor', detail: 'older than 30 days'}]}, 400,
            {'Content-Type': 'application/problem+json'}));
        const {code, err} = await run_program(['--json', '-q', '-k', 'key-1', 'inbox', 'events', '--cursor', 'c1', '--top', '50']);
        expect(code).toBe(1);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'inbox.cursor_refused', status: 400}});
        expect((mock_fetch.mock.calls[0] as [string, RequestInit])[0]).toBe('https://api.reply.io/v3/inbox/events?cursor=c1&top=50');
    });

    it('a usage error exits 2 before any request', async()=>{
        const {code, err} = await run_program(['--json', '-k', 'key-1', 'sequence', 'stats', '123', '--from', '2026-10-02', '--to', '2026-10-01']);
        expect(code).toBe(2);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'usage.stats'}});
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});
