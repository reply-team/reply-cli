import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_direct_send, type Direct_send_name, type Direct_send_opts} from '../../operations/direct-send';

const SUBJECT = 'Quick question, Marta';
const BODY = '<p>Hi Marta, does Tuesday at 10 work?</p>';
const TEXT = 'Hi Marta, does Tuesday at 10 work?';
const NOTE = 'Hi Marta, we met at the meetup last week.';
const SCRIPT = 'Hi Marta, a quick note about Tuesday.';
const stdin = (value: unknown)=>()=>(typeof value === 'string' ? value : JSON.stringify(value));
const EMAIL_OPTS: Direct_send_opts = {contactId: '456', emailAccountId: '12', message: '-'};
const LINKEDIN_OPTS: Direct_send_opts = {contactId: '456', linkedinAccountId: '34', message: '-'};
const activity = (actionType: string)=>json({actionType, linkedInActivityId: 1042, sentAtUtc: '2026-10-19T10:30:00Z'});

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

describe('the LinkedIn sends', ()=>{
    it('each goes from the LinkedIn account named, with its text under Reply\'s own names, and answers Reply\'s activity and time', async()=>{
        const cases: [Direct_send_name, unknown, string, string, Record<string, unknown>][] = [
            ['linkedin-connect', {note: NOTE}, 'send-direct-linkedin-connect', 'connect', {linkedInAccountId: 34, message: NOTE}],
            ['linkedin-message', {body: TEXT}, 'send-direct-linkedin-message', 'message', {linkedInAccountId: 34, message: TEXT}],
            ['linkedin-inmail', {subject: SUBJECT, body: TEXT}, 'send-direct-linkedin-inmail', 'inMail',
                {linkedInAccountId: 34, subject: SUBJECT, body: TEXT}],
            ['linkedin-voice', {script: SCRIPT}, 'send-direct-linkedin-ai-voice', 'aiVoice', {linkedInAccountId: 34, script: SCRIPT}],
        ];
        for (const [name, message, path, action, body] of cases)
        {
            mock_fetch.mockReset();
            answer(activity(action));
            expect(await run(name, message, LINKEDIN_OPTS), name).toStrictEqual({
                status: 'sent', contact_id: 456, activity_id: 1042, sent_at: '2026-10-19T10:30:00Z',
            });
            const requests = sent();
            expect(requests.map(r=>[r.method, r.url]), name).toEqual([['POST', `https://api/v3/contacts/456/${path}`]]);
            expect(requests[0].body, name).toStrictEqual(body);
        }
    });

    it('passes Reply\'s sentAtUtc on exactly as given, and gives what Reply leaves out as null', async()=>{
        answer(json({actionType: 'message', linkedInActivityId: 1042, sentAtUtc: '2026-10-19T12:30:00.99Z'}));
        expect(await run('linkedin-message', {body: TEXT}, LINKEDIN_OPTS)).toMatchObject({sent_at: '2026-10-19T12:30:00.99Z'});
        mock_fetch.mockReset();
        answer(json({actionType: 'message', linkedInActivityId: '1042'}));
        expect(await run('linkedin-message', {body: TEXT}, LINKEDIN_OPTS)).toStrictEqual({
            status: 'sent', contact_id: 456, activity_id: null, sent_at: null,
        });
    });

    it('an invitation without --message carries no note, and stdin is never read', async()=>{
        answer(activity('connect'));
        const never = ()=>{ throw new Error('stdin was read'); };
        await capture(()=>handle_direct_send('linkedin-connect', {contactId: '456', linkedinAccountId: '34'}, ctx(), {json: true}, never));
        expect(sent()[0].body).toStrictEqual({linkedInAccountId: 34});
    });

    it('an invitation to someone already connected is already_connected, exit 0, sent once; on a message it is a refusal', async()=>{
        answer(json({title: 'Conflict', status: 409, code: 'directLinkedIn.alreadyConnected'}, 409));
        expect(await run('linkedin-connect', {note: NOTE}, LINKEDIN_OPTS)).toStrictEqual({
            status: 'already_connected', contact_id: 456, activity_id: null, sent_at: null,
        });
        expect(mock_fetch).toHaveBeenCalledTimes(1);
        mock_fetch.mockReset();
        answer(json({code: 'directLinkedIn.alreadyConnected'}, 409));
        await expect(send('linkedin-message', {body: TEXT}, LINKEDIN_OPTS)).rejects.toMatchObject({code: 'reply.refused', exit_code: 1});
    });

    it('maps Reply\'s refusals of a LinkedIn send, each definite, with the ids it was given', async()=>{
        const message: [Direct_send_name, unknown] = ['linkedin-message', {body: TEXT}];
        const cases: [[Direct_send_name, unknown], number, string, string][] = [
            [message, 404, 'directLinkedIn.contactNotFound', 'contact.not_found'],
            [message, 404, 'directLinkedIn.noLinkedInProfile', 'contact.no_linkedin_profile'],
            [message, 404, 'directLinkedIn.linkedInAccountNotFound', 'linkedin.account_not_found'],
            [message, 403, 'directLinkedIn.featureDisabled', 'linkedin.feature_disabled'],
            [message, 409, 'directLinkedIn.linkedInAccountInactive', 'linkedin.account_inactive'],
            [message, 409, 'directLinkedIn.invalidCookie', 'linkedin.invalid_cookie'],
            [message, 409, 'directLinkedIn.notConnected', 'linkedin.not_connected'],
            [message, 400, 'directLinkedIn.messageTooLong', 'linkedin.message_too_long'],
            [message, 400, 'directLinkedIn.missingVariables', 'linkedin.missing_variables'],
            [['linkedin-connect', {note: NOTE}], 400, 'directLinkedIn.invitesNotesLimit', 'linkedin.message_too_long'],
            [['linkedin-inmail', {subject: SUBJECT, body: TEXT}], 400, 'directLinkedIn.salesNavRequired', 'linkedin.sales_navigator_required'],
            [['linkedin-inmail', {subject: SUBJECT, body: TEXT}], 400, 'directLinkedIn.salesNavDisconnected', 'linkedin.sales_navigator_disconnected'],
            [['linkedin-inmail', {subject: SUBJECT, body: TEXT}], 400, 'directLinkedIn.noInMailCredits', 'linkedin.no_inmail_credits'],
            [['linkedin-voice', {script: SCRIPT}], 400, 'directLinkedIn.voiceProfileMissing', 'linkedin.voice_profile_missing'],
            [['linkedin-voice', {script: SCRIPT}], 400, 'directLinkedIn.voiceTooLong', 'linkedin.voice_too_long'],
            // Reply's code is read only under the status it publishes it with.
            [message, 400, 'directLinkedIn.notConnected', 'reply.refused'],
            [message, 403, 'directLinkedIn.somethingElse', 'access.denied'],
        ];
        for (const [[name, text], status, reply_code, code] of cases)
        {
            mock_fetch.mockReset();
            answer(json({title: 'Refused', status, detail: 'Reply\'s words.', code: reply_code}, status));
            const e = await failure(name, text, LINKEDIN_OPTS);
            expect(e, `${name} ${reply_code}`).toMatchObject({
                code, exit_code: 1, status, reply_code, ids: {contact_id: 456, linkedin_account_id: 34},
            });
            expect(mock_fetch, `${name} ${reply_code}`).toHaveBeenCalledTimes(1);
        }
    });

    it('a daily or weekly limit is linkedin.limit_reached with which one and Reply\'s wait; a 429 without its code stays rate_limited', async()=>{
        const cases: [string | undefined, string, string | undefined][] = [
            ['directLinkedIn.dailyLimitReached', 'linkedin.limit_reached', 'daily'],
            ['directLinkedIn.weeklyLimitReached', 'linkedin.limit_reached', 'weekly'],
            [undefined, 'rate_limited', undefined],
        ];
        for (const [reply_code, code, limit] of cases)
        {
            mock_fetch.mockReset();
            answer(json({title: 'Too Many Requests', status: 429, code: reply_code}, 429, {'Retry-After': '3600'}));
            const e = await failure('linkedin-connect', {note: NOTE}, LINKEDIN_OPTS);
            expect(e, code).toMatchObject({code, exit_code: 1, retry_after: 3600, ids: {contact_id: 456, linkedin_account_id: 34}});
            expect((e as {details?: unknown}).details, code).toEqual(limit === undefined ? undefined : {limit});
            expect(mock_fetch, code).toHaveBeenCalledTimes(1);
        }
    });

    it('holds a text to the length Reply publishes, counting characters as its document does, before any call', async()=>{
        const cases: [Direct_send_name, Record<string, string>, string, number][] = [
            ['linkedin-message', {}, 'body', 8000],
            ['linkedin-inmail', {body: TEXT}, 'subject', 200],
            ['linkedin-inmail', {subject: SUBJECT}, 'body', 1900],
            ['linkedin-voice', {}, 'script', 1000],
        ];
        for (const [name, rest, field, longest] of cases)
        {
            // One character over is refused, without the text.
            mock_fetch.mockReset();
            const e = await failure(name, {...rest, [field]: `Marta ${'a'.repeat(longest - 5)}`}, LINKEDIN_OPTS);
            expect(e, `${name} ${field}`).toMatchObject({code: 'usage.message', exit_code: 2});
            expect(shown(e), shown(e)).toContain(String(longest));
            expect(shown(e), shown(e)).not.toContain('Marta');
            expect(mock_fetch, `${name} ${field}`).not.toHaveBeenCalled();
            // The longest is sent as it is, and a character outside the basic plane counts once.
            for (const text of ['a'.repeat(longest), '\u{1F600}'.repeat(longest)])
            {
                mock_fetch.mockReset();
                answer(activity('message'));
                await run(name, {...rest, [field]: text}, LINKEDIN_OPTS);
                expect(Object.values(sent()[0].body as object), `${name} ${field} ${text.length}`).toContain(text);
            }
        }
    });

    it('sets no length of its own where Reply publishes none, and passes Reply\'s template variables on as written', async()=>{
        const cases: [Direct_send_name, unknown, Direct_send_opts][] = [
            ['linkedin-connect', {note: `Hi {{firstName}}, ${'a'.repeat(5000)}`}, LINKEDIN_OPTS],
            ['send-email', {subject: `{{firstName}}, ${'a'.repeat(2000)}`, body: `<p>Hi {{firstName}}</p>${'a'.repeat(200000)}`}, EMAIL_OPTS],
            ['linkedin-message', {body: 'Hi {{firstName}}, about Tuesday.'}, LINKEDIN_OPTS],
        ];
        for (const [name, text, opts] of cases)
        {
            mock_fetch.mockReset();
            answer(name === 'send-email' ? json({status: 'sent', messageId: null}) : activity('connect'));
            await run(name, text, opts);
            const body = sent()[0].body as Record<string, unknown>;
            for (const value of Object.values(text as object))
            {
                expect(Object.values(body), name).toContain(value);
            }
        }
    });
});

describe('every direct send', ()=>{
    // Each send, with a message it accepts and the flags it takes.
    const SENDS: [Direct_send_name, unknown, Direct_send_opts][] = [
        ['send-email', {subject: SUBJECT, body: BODY}, EMAIL_OPTS],
        ['linkedin-connect', {note: NOTE}, LINKEDIN_OPTS],
        ['linkedin-message', {body: TEXT}, LINKEDIN_OPTS],
        ['linkedin-inmail', {subject: SUBJECT, body: TEXT}, LINKEDIN_OPTS],
        ['linkedin-voice', {script: SCRIPT}, LINKEDIN_OPTS],
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
            // An invitation without --message is one without a note (above); every other send needs its text.
            const sources = name === 'linkedin-connect' ? [JSON.stringify(message), '@message.json'] : [JSON.stringify(message), '@message.json', undefined];
            for (const source of sources)
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
