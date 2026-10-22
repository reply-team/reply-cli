import fs from 'fs';
import os from 'os';
import path from 'path';
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

// What a failure shows a caller, as text and as the --json line: none of it may carry the person's words.
const shown = (e: unknown): string=>{
    const err = e as {message?: string; title?: string; hint?: string; detail?: string; to_json?: () => unknown};
    return [err.message, err.title, err.hint, err.detail, JSON.stringify(err.to_json?.())].join(' ');
};

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('contact send-email', ()=>{
    it('sends one email from the mailbox named, with the subject and body from stdin, and adds no time of its own', async()=>{
        answer(json({status: 'sent', messageId: '<m1@example.com>'}));
        expect(await run('send-email', {subject: SUBJECT, body: BODY}, EMAIL_OPTS)).toStrictEqual({
            status: 'sent', contact_id: 456, contact_created: false, message_id: '<m1@example.com>', sent_at: null, reply_status: 'sent',
        });
        expect(sent()).toEqual([{
            method: 'POST', url: 'https://api/v3/contacts/456/send-direct-email', body: {emailAccountId: 12, subject: SUBJECT, body: BODY},
        }]);
    });

    it('keeps Reply\'s own word as reply_status, gives a null messageId as null, and never takes a time from the answer', async()=>{
        answer(json({status: 'new', messageId: null, sentAtUtc: '2026-10-19T10:00:00Z', date: '2026-10-19T10:00:00Z'}));
        expect(await run('send-email', {subject: SUBJECT, body: BODY}, EMAIL_OPTS)).toStrictEqual({
            status: 'sent', contact_id: 456, contact_created: false, message_id: null, sent_at: null, reply_status: 'new',
        });
        mock_fetch.mockReset();
        answer(json({}));
        expect(await run('send-email', {subject: SUBJECT, body: BODY}, EMAIL_OPTS)).toStrictEqual({
            status: 'sent', contact_id: 456, contact_created: false, message_id: null, sent_at: null, reply_status: null,
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
            expect(shown(e), shown(e)).not.toContain('Marta');
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
                status: 'sent', contact_id: 456, contact_created: false, activity_id: 1042, sent_at: '2026-10-19T10:30:00Z',
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
            status: 'sent', contact_id: 456, contact_created: false, activity_id: null, sent_at: null,
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
            status: 'already_connected', contact_id: 456, contact_created: false, activity_id: null, sent_at: null,
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
            expect(shown(e), shown(e)).not.toContain('Marta');
            expect(mock_fetch, `${name} ${reply_code}`).toHaveBeenCalledTimes(1);
        }
    });

    it('reads contact-not-found, the limits and already-connected only under the status Reply publishes each with', async()=>{
        const cases: [Direct_send_name, unknown, Direct_send_opts, string][] = [
            ['send-email', {subject: SUBJECT, body: BODY}, EMAIL_OPTS, 'contact.notFound'],
            ['linkedin-message', {body: TEXT}, LINKEDIN_OPTS, 'directLinkedIn.contactNotFound'],
            ['linkedin-message', {body: TEXT}, LINKEDIN_OPTS, 'directLinkedIn.dailyLimitReached'],
            ['linkedin-connect', {note: NOTE}, LINKEDIN_OPTS, 'directLinkedIn.weeklyLimitReached'],
            ['linkedin-connect', {note: NOTE}, LINKEDIN_OPTS, 'directLinkedIn.alreadyConnected'],
        ];
        // Under another status the code says nothing: a 400 is Reply's plain refusal, and a 503 may hide a send.
        const statuses: [number, string, number][] = [[400, 'reply.refused', 1], [503, 'outcome.unknown', 3]];
        for (const [name, text, opts, reply_code] of cases)
        {
            for (const [status, code, exit_code] of statuses)
            {
                mock_fetch.mockReset();
                answer(json({title: 'Refused', status, code: reply_code}, status));
                const e = await failure(name, text, opts);
                expect(e, `${name} ${status} ${reply_code}`).toMatchObject({code, exit_code, reply_code});
                expect(mock_fetch, `${name} ${status} ${reply_code}`).toHaveBeenCalledTimes(1);
            }
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
            expect(shown(e), shown(e)).not.toContain('Marta');
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
                expect(shown(e), shown(e)).not.toContain('Marta');
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

    it('refuses a missing contact, or a malformed contact or account id, before any call', async()=>{
        for (const [name, message, opts] of SENDS)
        {
            const account_flag = Object.keys(opts).find(k=>k.endsWith('AccountId')) as keyof Direct_send_opts;
            const cases: [Direct_send_opts, string][] = [
                [{contactId: undefined}, 'usage.contact'], [{contactId: 'abc'}, 'usage.id'], [{contactId: '0'}, 'usage.id'],
                [{[account_flag]: undefined}, 'usage.id'], [{[account_flag]: '-3'}, 'usage.id'],
            ];
            for (const [bad, code] of cases)
            {
                const e = await failure(name, message, {...opts, ...bad});
                expect(e, `${name} ${JSON.stringify(bad)}`).toMatchObject({code, exit_code: 2});
            }
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});

describe('a direct send to a person given by their fields', ()=>{
    const MARTA = {email: 'marta@example.com', first_name: 'Marta', last_name: 'Example'};
    const PROFILE = 'https://www.linkedin.com/in/marta-example';
    const EMAIL_LOOKUP = 'GET https://api/v3/contacts?email=marta%40example.com&top=100&skip=0';
    const PROFILE_LOOKUP = `GET https://api/v3/contacts?linkedIn=${encodeURIComponent(PROFILE)}&top=100&skip=0`;
    const IMPORT = 'POST https://api/v3/contacts/import';
    const nobody = ()=>json({items: [], hasMore: false});
    const held = (entry: Record<string, unknown>)=>json({items: [entry], hasMore: false});
    const imported = (id: number, status = 'created')=>json({items: [{id, status}]});
    const by_fields = (opts: Direct_send_opts): Direct_send_opts=>({...opts, contactId: undefined, contact: '-'});
    const lines = ()=>sent().map(r=>`${r.method} ${r.url}`);

    // The person and the text both come on stdin, so the argument list carries neither: it is checked on every run.
    const PERSONAL = /marta|example\.com|tuesday|meetup/i;
    const send_by_fields = (name: Direct_send_name, input: unknown, opts: Direct_send_opts)=>{
        expect(JSON.stringify(opts), JSON.stringify(opts)).not.toMatch(PERSONAL);
        return send(name, input, opts);
    };
    const run_by_fields = async(name: Direct_send_name, input: unknown, opts: Direct_send_opts)=>
        JSON.parse((await capture(()=>send_by_fields(name, input, opts))).out);
    const fail_by_fields = (name: Direct_send_name, input: unknown, opts: Direct_send_opts)=>
        send_by_fields(name, input, opts).catch((x: unknown)=>x);

    const LINKEDIN_SENDS: [Direct_send_name, unknown, string, string][] = [
        ['linkedin-connect', {note: NOTE}, 'send-direct-linkedin-connect', 'connect'],
        ['linkedin-message', {body: TEXT}, 'send-direct-linkedin-message', 'message'],
        ['linkedin-inmail', {subject: SUBJECT, body: TEXT}, 'send-direct-linkedin-inmail', 'inMail'],
        ['linkedin-voice', {script: SCRIPT}, 'send-direct-linkedin-ai-voice', 'aiVoice'],
    ];

    it('send-email: Reply holds nobody under the email, so it is looked up, imported with the person\'s names, then sent, '
        + 'and the answer names the contact it went to', async()=>{
        answer(nobody(), imported(457), json({status: 'sent', messageId: '<m1@example.com>'}));
        const message = {subject: SUBJECT, body: BODY};
        expect(await run_by_fields('send-email', {contact: MARTA, message}, by_fields(EMAIL_OPTS))).toStrictEqual({
            status: 'sent', contact_id: 457, contact_created: true, message_id: '<m1@example.com>', sent_at: null, reply_status: 'sent',
        });
        expect(lines()).toEqual([EMAIL_LOOKUP, IMPORT, 'POST https://api/v3/contacts/457/send-direct-email']);
        expect(sent()[1].body).toStrictEqual({items: [{email: 'marta@example.com', firstName: 'Marta', lastName: 'Example'}]});
        expect(sent()[2].body).toStrictEqual({emailAccountId: 12, subject: SUBJECT, body: BODY});
    });

    it('each LinkedIn send: Reply holds nobody under the profile, so it is looked up by it, the person imported keyed by it '
        + 'with no email, then sent', async()=>{
        for (const [name, message, path, action] of LINKEDIN_SENDS)
        {
            mock_fetch.mockReset();
            answer(nobody(), imported(458), activity(action));
            const person = {linkedin_url: PROFILE, first_name: 'Marta'};
            expect(await run_by_fields(name, {contact: person, message}, by_fields(LINKEDIN_OPTS)), name).toStrictEqual({
                status: 'sent', contact_id: 458, contact_created: true, activity_id: 1042, sent_at: '2026-10-19T10:30:00Z',
            });
            expect(lines(), name).toEqual([PROFILE_LOOKUP, IMPORT, `POST https://api/v3/contacts/458/${path}`]);
            expect(sent()[1].body, name).toStrictEqual({items: [{linkedInUrl: PROFILE, firstName: 'Marta'}], options: {keys: {linkedInUrl: true}}});
        }
    });

    it('a send looks the person up by every address it was given, the one it reaches them at first, and the import matches by '
        + 'the email as an add\'s does', async()=>{
        const both = {...MARTA, linkedin_url: PROFILE};
        answer(nobody(), nobody(), imported(457), activity('message'));
        expect(await run_by_fields('linkedin-message', {contact: both, message: {body: TEXT}}, by_fields(LINKEDIN_OPTS)))
            .toMatchObject({contact_id: 457, contact_created: true});
        expect(lines()).toEqual([PROFILE_LOOKUP, EMAIL_LOOKUP, IMPORT, 'POST https://api/v3/contacts/457/send-direct-linkedin-message']);
        expect(sent()[2].body).toStrictEqual({items: [{email: 'marta@example.com', linkedInUrl: PROFILE, firstName: 'Marta', lastName: 'Example'}]});
        mock_fetch.mockReset();
        answer(nobody(), nobody(), imported(457), json({status: 'sent'}));
        await run_by_fields('send-email', {contact: both, message: {subject: SUBJECT, body: BODY}}, by_fields(EMAIL_OPTS));
        expect(lines()).toEqual([EMAIL_LOOKUP, PROFILE_LOOKUP, IMPORT, 'POST https://api/v3/contacts/457/send-direct-email']);
    });

    // Reply does not refuse a direct send to a contact it holds as opted out, so a send given a person's fields acts only
    // on a contact it created: one Reply already holds, found by the lookup or matched by the import, is refused before
    // anything is sent and named, for the caller to read before sending to it by its id.
    describe('a send given a person\'s fields acts only on a contact it created', ()=>{
        type Case = {name: Direct_send_name; message: unknown; opts: Direct_send_opts; lookup: string; other: string; path: string; holder: object; other_holder: object; done: () => Response};
        const FIVE: Case[] = [
            {name: 'send-email', message: {subject: SUBJECT, body: BODY}, opts: EMAIL_OPTS, lookup: EMAIL_LOOKUP, other: PROFILE_LOOKUP,
                path: 'send-direct-email', holder: {email: 'Marta@Example.com'}, other_holder: {linkedInUrl: `${PROFILE}/`}, done: ()=>json({status: 'sent'})},
            ...LINKEDIN_SENDS.map(([name, message, path, action]): Case=>({name, message, opts: LINKEDIN_OPTS, lookup: PROFILE_LOOKUP, other: EMAIL_LOOKUP,
                path, holder: {linkedInUrl: `${PROFILE}/`}, other_holder: {email: 'Marta@Example.com'}, done: ()=>activity(action)})),
        ];
        const PERSON = {...MARTA, linkedin_url: PROFILE};
        const refused = (e: unknown, label: string)=>{
            expect(e, label).toMatchObject({code: 'contact.already_held', exit_code: 1, ids: {contact_id: 456}});
            const hint = (e as {hint?: string}).hint ?? '';
            expect(hint, `${label}: ${hint}`).toContain('contact get 456');
            expect(hint, `${label}: ${hint}`).toContain('--contact-id 456');
            expect(shown(e), shown(e)).toContain('nothing was sent');
            expect(shown(e), shown(e)).not.toMatch(PERSONAL);
            expect(lines().filter(l=>l.includes('send-direct')), label).toEqual([]);
        };

        it('refuses a person the lookup finds: nothing is imported or sent, and the contact is named', async()=>{
            for (const c of FIVE)
            {
                mock_fetch.mockReset();
                answer(held({id: 456, ...c.holder}), c.done());
                refused(await fail_by_fields(c.name, {contact: PERSON, message: c.message}, by_fields(c.opts)), c.name);
                expect(lines(), c.name).toEqual([c.lookup]);
            }
        });

        it('refuses a person the import matches to a contact Reply already holds, a teammate\'s too: nothing is sent, and the '
            + 'contact is named', async()=>{
            for (const c of FIVE)
            {
                for (const status of ['updated', 'skipped'])
                {
                    mock_fetch.mockReset();
                    answer(nobody(), nobody(), imported(456, status), c.done());
                    refused(await fail_by_fields(c.name, {contact: PERSON, message: c.message}, by_fields(c.opts)), `${c.name} ${status}`);
                    expect(lines(), `${c.name} ${status}`).toEqual([c.lookup, c.other, IMPORT]);
                }
            }
        });

        it('sends to a person the import creates', async()=>{
            for (const c of FIVE)
            {
                mock_fetch.mockReset();
                answer(nobody(), nobody(), imported(457), c.done());
                expect(await run_by_fields(c.name, {contact: PERSON, message: c.message}, by_fields(c.opts)), c.name)
                    .toMatchObject({status: 'sent', contact_id: 457, contact_created: true});
                expect(lines(), c.name).toEqual([c.lookup, c.other, IMPORT, `POST https://api/v3/contacts/457/${c.path}`]);
            }
        });

        it('refuses a person held only under the other address it was given: the lookup by the address it reaches them at '
            + 'finds nobody, the one by the other finds the contact, and nothing is imported or sent', async()=>{
            for (const c of FIVE)
            {
                mock_fetch.mockReset();
                answer(nobody(), held({id: 456, ...c.other_holder}), c.done());
                refused(await fail_by_fields(c.name, {contact: PERSON, message: c.message}, by_fields(c.opts)), c.name);
                expect(lines(), c.name).toEqual([c.lookup, c.other]);
            }
        });

        it('names the first contact found when two are held, one under each address: the address it reaches them at is asked '
            + 'first, and the second is never asked', async()=>{
            for (const c of FIVE)
            {
                mock_fetch.mockReset();
                answer(held({id: 456, ...c.holder}), held({id: 789, ...c.other_holder}), c.done());
                refused(await fail_by_fields(c.name, {contact: PERSON, message: c.message}, by_fields(c.opts)), c.name);
                expect(lines(), c.name).toEqual([c.lookup]);
            }
        });
    });

    it('a person without the address the send reaches them at is refused before any call, the address not repeated', async()=>{
        const cases: [Direct_send_name, unknown, Direct_send_opts][] = [
            ['send-email', {contact: {linkedin_url: PROFILE, first_name: 'Marta'}, message: {subject: SUBJECT, body: BODY}}, by_fields(EMAIL_OPTS)],
            ...LINKEDIN_SENDS.map(([name, message]): [Direct_send_name, unknown, Direct_send_opts]=>
                [name, {contact: MARTA, message}, by_fields(LINKEDIN_OPTS)]),
        ];
        for (const [name, input, opts] of cases)
        {
            const e = await fail_by_fields(name, input, opts);
            expect(e, name).toMatchObject({code: 'usage.contact', exit_code: 2});
            expect(shown(e), shown(e)).not.toMatch(PERSONAL);
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('refuses as the add commands do: two contacts held, an address or a profile Reply will not import, the plan\'s limit, '
        + 'an item the import failed; and nothing is sent', async()=>{
        const two = json({items: [{id: 1, email: 'marta@example.com'}, {id: 2, email: 'marta@example.com'}], hasMore: false});
        const cases: [Response[], string, number][] = [
            [[two], 'contact.not_unique', 1],
            [[nobody(), nobody(), json({status: 400, errors: [{pointer: '/items/0/email', detail: '\'marta@example\' is not valid'}]}, 400)],
                'contact.invalid_email', 1],
            [[nobody(), nobody(), json({status: 400, errors: [{pointer: '/items/0/linkedInUrl', detail: 'not valid'}]}, 400)],
                'contact.invalid_linkedin_url', 1],
            [[nobody(), nobody(), json({code: 'contact.limitExceeded', detail: 'Contact limit reached.'}, 400)], 'account.contact_limit_reached', 1],
            [[nobody(), nobody(), json({items: [{id: null, status: 'failed', error: 'Invalid data'}]})], 'reply.refused', 1],
        ];
        for (const [answers, code, exit_code] of cases)
        {
            mock_fetch.mockReset();
            answer(...answers);
            const e = await fail_by_fields('send-email', {contact: {...MARTA, linkedin_url: PROFILE}, message: {subject: SUBJECT, body: BODY}},
                by_fields(EMAIL_OPTS));
            expect(e, code).toMatchObject({code, exit_code, ids: {email_account_id: 12}});
            expect((e as {ids?: Record<string, unknown>}).ids, code).not.toHaveProperty('contact_id');
            expect(shown(e), shown(e)).not.toMatch(PERSONAL);
            expect(lines().filter(l=>l.includes('send-direct')), code).toEqual([]);
        }
    });

    it('a lost answer to the import is outcome.unknown (exit 3) that says nothing was sent; one to the send says it may go '
        + 'twice, and names the contact', async()=>{
        mock_fetch.mockResolvedValueOnce(nobody()).mockRejectedValueOnce(lost_connection());
        const input = {contact: MARTA, message: {subject: SUBJECT, body: BODY}};
        const before = await fail_by_fields('send-email', input, by_fields(EMAIL_OPTS)) as {hint?: string; ids?: object};
        expect(before).toMatchObject({code: 'outcome.unknown', exit_code: 3});
        expect(before.hint, before.hint).toContain('Nothing was sent');
        expect(before.hint, before.hint).toContain('contact.already_held');
        expect(before.hint, before.hint).not.toContain('may send it twice');
        expect(before.ids, JSON.stringify(before.ids)).not.toHaveProperty('contact_id');
        expect(lines()).toEqual([EMAIL_LOOKUP, IMPORT]);
        mock_fetch.mockReset();
        mock_fetch.mockResolvedValueOnce(nobody()).mockResolvedValueOnce(imported(457)).mockRejectedValueOnce(lost_connection());
        const after = await fail_by_fields('send-email', input, by_fields(EMAIL_OPTS)) as {hint?: string};
        expect(after).toMatchObject({code: 'outcome.unknown', exit_code: 3, ids: {contact_id: 457, email_account_id: 12}});
        expect(after.hint, after.hint).toContain('may send it twice');
        expect(shown(after), shown(after)).not.toMatch(PERSONAL);
    });

    it('a refusal of the send after an import carries the contact it created, and an invitation to someone already connected '
        + 'names them too', async()=>{
        answer(nobody(), imported(457), json({code: 'contact.contactInBlackList'}, 400));
        const e = await fail_by_fields('send-email', {contact: MARTA, message: {subject: SUBJECT, body: BODY}}, by_fields(EMAIL_OPTS));
        expect(e).toMatchObject({code: 'contact.blacklisted', exit_code: 1, ids: {contact_id: 457, email_account_id: 12}});
        mock_fetch.mockReset();
        answer(nobody(), imported(458), json({code: 'directLinkedIn.alreadyConnected'}, 409));
        expect(await run_by_fields('linkedin-connect', {contact: {linkedin_url: PROFILE, first_name: 'Marta'}, message: {note: NOTE}},
            by_fields(LINKEDIN_OPTS))).toStrictEqual({
            status: 'already_connected', contact_id: 458, contact_created: true, activity_id: null, sent_at: null,
        });
    });

    it('an invitation without a note reads the person alone from stdin', async()=>{
        answer(nobody(), imported(458), activity('connect'));
        const opts = {...by_fields(LINKEDIN_OPTS), message: undefined};
        await run_by_fields('linkedin-connect', {linkedin_url: PROFILE, first_name: 'Marta'}, opts);
        expect(sent()[2].body).toStrictEqual({linkedInAccountId: 34});
    });

    it('with --contact - and --message - both, stdin is one object holding each, read once', async()=>{
        answer(nobody(), imported(457), json({status: 'sent'}));
        let reads = 0;
        const input = JSON.stringify({contact: MARTA, message: {subject: SUBJECT, body: BODY}});
        await capture(()=>handle_direct_send('send-email', by_fields(EMAIL_OPTS), ctx(), {json: true}, ()=>{ reads++; return input; }));
        expect(reads).toBe(1);
        expect(sent()[2].body).toMatchObject({subject: SUBJECT, body: BODY});
    });

    it('refuses stdin that is not that object, without repeating any of it and before any call', async()=>{
        const message = {subject: SUBJECT, body: BODY};
        const cases: [unknown, string][] = [
            ['not json, Marta', 'usage.stdin'], [[MARTA, message], 'usage.stdin'], [{contact: MARTA}, 'usage.stdin'],
            [{message}, 'usage.stdin'], [{contact: MARTA, message, cc: 'marta@example.com'}, 'usage.stdin'],
            [{...MARTA, ...message}, 'usage.stdin'],
            [{contact: 'marta@example.com', message}, 'usage.contact'], [{contact: {...MARTA, phone: '1'}, message}, 'usage.contact'],
            [{contact: MARTA, message: {subject: SUBJECT}}, 'usage.message'], [{contact: MARTA, message: 'Hi Marta'}, 'usage.message'],
        ];
        for (const [input, code] of cases)
        {
            const e = await fail_by_fields('send-email', input, by_fields(EMAIL_OPTS));
            expect(e, JSON.stringify(input)).toMatchObject({code, exit_code: 2});
            expect(shown(e), shown(e)).not.toMatch(PERSONAL);
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('a person from a file leaves stdin to the text alone', async()=>{
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-send-'));
        const file = path.join(dir, 'person.json');
        fs.writeFileSync(file, JSON.stringify(MARTA));
        try {
            answer(nobody(), imported(457), json({status: 'sent'}));
            await run_by_fields('send-email', {subject: SUBJECT, body: BODY}, {...EMAIL_OPTS, contactId: undefined, contact: `@${file}`});
            expect(lines()).toEqual([EMAIL_LOOKUP, IMPORT, 'POST https://api/v3/contacts/457/send-direct-email']);
            expect(sent()[2].body).toMatchObject({subject: SUBJECT, body: BODY});
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });
});
