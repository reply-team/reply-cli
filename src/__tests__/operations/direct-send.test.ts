import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_direct_send, type Direct_send_name, type Direct_send_opts} from '../../operations/direct-send';

const SUBJECT = 'Quick question, Marta';
const BODY = '<p>Hi Marta, does Tuesday at 10 work?</p>';
const stdin = (value: unknown)=>()=>(typeof value === 'string' ? value : JSON.stringify(value));
const EMAIL_OPTS: Direct_send_opts = {contactId: '456', emailAccountId: '12', message: '-'};

const send = (name: Direct_send_name, message: unknown, opts: Direct_send_opts)=>
    handle_direct_send(name, opts, ctx(), {json: true}, stdin(message));
const run = async(name: Direct_send_name, message: unknown, opts: Direct_send_opts)=>
    JSON.parse((await capture(()=>send(name, message, opts))).out);
const failure = (name: Direct_send_name, message: unknown, opts: Direct_send_opts)=>
    send(name, message, opts).catch((x: unknown)=>x);

const lost_connection = ()=>Object.assign(new TypeError('fetch failed'),
    {cause: Object.assign(new Error('ECONNRESET'), {code: 'ECONNRESET'})});

// What a failure shows a caller: none of it may carry the person's words.
const shown = (e: unknown): string=>{
    const err = e as {message?: string; title?: string; hint?: string; detail?: string};
    return [err.message, err.title, err.hint, err.detail].join(' ');
};

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('contact send-email', ()=>{
    it('sends one email from the mailbox named, with the subject and body from stdin, and adds no time of its own', async()=>{
        answer(json({status: 'sent', messageId: '<m1@example.com>'}));
        expect(await run('send-email', {subject: SUBJECT, body: BODY}, EMAIL_OPTS)).toStrictEqual({
            status: 'sent', contact_id: 456, message_id: '<m1@example.com>', sent_at: null, reply_status: 'sent',
        });
        expect(sent()).toEqual([{
            method: 'POST', url: 'https://api/v3/contacts/456/send-direct-email', body: {emailAccountId: 12, subject: SUBJECT, body: BODY},
        }]);
    });

    it('keeps Reply\'s own word as reply_status, gives a null messageId as null, and never takes a time from the answer', async()=>{
        answer(json({status: 'new', messageId: null, sentAtUtc: '2026-10-19T10:00:00Z', date: '2026-10-19T10:00:00Z'}));
        expect(await run('send-email', {subject: SUBJECT, body: BODY}, EMAIL_OPTS)).toStrictEqual({
            status: 'sent', contact_id: 456, message_id: null, sent_at: null, reply_status: 'new',
        });
        mock_fetch.mockReset();
        answer(json({}));
        expect(await run('send-email', {subject: SUBJECT, body: BODY}, EMAIL_OPTS)).toStrictEqual({
            status: 'sent', contact_id: 456, message_id: null, sent_at: null, reply_status: null,
        });
    });

    it('a mailbox id beyond 32 bits goes to Reply as the number given', async()=>{
        answer(json({status: 'sent', messageId: null}));
        await run('send-email', {subject: SUBJECT, body: BODY}, {...EMAIL_OPTS, emailAccountId: '4294967296'});
        expect((sent()[0].body as {emailAccountId: unknown}).emailAccountId).toBe(4294967296);
    });

    it('maps Reply\'s refusals of the email, each definite, with the ids it was given', async()=>{
        const cases: [Response, string, string | undefined][] = [
            [json({code: 'contact.notFound', detail: 'Contact with ID 456 not found.'}, 404), 'contact.not_found', 'contact.notFound'],
            [json({code: 'contact.emailAccountNotFound', detail: 'Email account is not found or access is denied.'}, 400),
                'email_account.not_found', 'contact.emailAccountNotFound'],
            [json({code: 'contact.contactInBlackList', detail: 'Contact email is on the blacklist.'}, 400),
                'contact.blacklisted', 'contact.contactInBlackList'],
            [json({code: 'contact.forbidden', detail: 'Feature scopes [SendEmail] are denied for userId 1.'}, 403),
                'access.feature_unavailable', 'contact.forbidden'],
            [json({title: 'Validation failed', errors: [{pointer: '/subject', detail: '\'subject\' must not be empty.'}]}, 400),
                'reply.invalid_request', undefined],
            [json({code: 'contact.somethingElse'}, 400), 'reply.refused', 'contact.somethingElse'],
        ];
        for (const [res, code, reply_code] of cases)
        {
            mock_fetch.mockReset();
            answer(res);
            const e = await failure('send-email', {subject: SUBJECT, body: BODY}, EMAIL_OPTS);
            expect(e, code).toMatchObject({code, exit_code: 1, ids: {contact_id: 456, email_account_id: 12}});
            expect((e as {reply_code?: string}).reply_code, code).toBe(reply_code);
            expect(sent(), code).toHaveLength(1);
        }
    });
});

describe('every direct send', ()=>{
    // Each send, with a message it accepts and the flags it takes.
    const SENDS: [Direct_send_name, unknown, Direct_send_opts][] = [
        ['send-email', {subject: SUBJECT, body: BODY}, EMAIL_OPTS],
    ];

    it('an answer that may hide a send is outcome.unknown (exit 3), sent once, and says a repeat may send it twice', async()=>{
        const answers: [string, ()=>void][] = [
            ['lost answer', ()=>{ mock_fetch.mockRejectedValueOnce(lost_connection()); }],
            ['503', ()=>answer(json({title: 'Service Unavailable'}, 503))],
            ['uncoded 502', ()=>answer(json('<html>bad gateway</html>', 502))],
            ['201', ()=>answer(json({}, 201))],
            ['unreadable 200', ()=>answer(json('<html>ok</html>', 200))],
        ];
        for (const [name, message, opts] of SENDS)
        {
            for (const [label, give] of answers)
            {
                mock_fetch.mockReset();
                give();
                const e = await failure(name, message, opts);
                expect(e, `${name}, ${label}`).toMatchObject({code: 'outcome.unknown', exit_code: 3, ids: {contact_id: 456}});
                const hint = (e as {hint?: string}).hint ?? '';
                expect(hint, `${name}, ${label}: ${hint}`).toContain('may send it twice');
                expect(hint, `${name}, ${label}: ${hint}`).not.toContain('safe to re-run');
                expect(mock_fetch, `${name}, ${label}`).toHaveBeenCalledTimes(1);
            }
        }
    });

    it('takes the text from stdin only: inline JSON, @file and no --message are refused before any call, the text never echoed', async()=>{
        for (const [name, message, opts] of SENDS)
        {
            for (const source of [JSON.stringify(message), '@message.json', undefined])
            {
                const e = await failure(name, message, {...opts, message: source});
                expect(e, `${name} ${String(source)}`).toMatchObject({code: 'usage.message', exit_code: 2});
                expect(shown(e), shown(e)).not.toContain('Marta');
            }
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('refuses text on stdin that is not the send\'s own shape, without echoing any of it, malformed JSON included', async()=>{
        for (const [name, message, opts] of SENDS)
        {
            const fields = Object.keys(message as object);
            const bad: unknown[] = [
                `not json, Marta ${BODY}`, `{"${fields[0]}": Marta Example}`, [message], {}, {...(message as object), cc: 'marta@example.com'},
                ...fields.map(f=>({...(message as object), [f]: '   '})),
                ...fields.map(f=>({...(message as object), [f]: 7})),
                ...fields.map(f=>{ const m = {...(message as Record<string, unknown>)}; delete m[f]; return m; }),
            ];
            for (const text of bad)
            {
                const e = await failure(name, text, opts);
                expect(e, `${name} ${JSON.stringify(text)}`).toMatchObject({code: 'usage.message', exit_code: 2});
                expect(shown(e), shown(e)).not.toContain('Marta');
            }
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('refuses a missing or malformed contact or account id before any call', async()=>{
        for (const [name, message, opts] of SENDS)
        {
            const account_flag = Object.keys(opts).find(k=>k.endsWith('AccountId')) as keyof Direct_send_opts;
            for (const bad of [{contactId: undefined}, {contactId: 'abc'}, {contactId: '0'}, {[account_flag]: undefined}, {[account_flag]: '-3'}])
            {
                const e = await failure(name, message, {...opts, ...bad});
                expect(e, `${name} ${JSON.stringify(bad)}`).toMatchObject({code: 'usage.id', exit_code: 2});
            }
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});
