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
            // An email Reply cannot time maps to the codes a LinkedIn send's refusals of the same meaning map to, each
            // read only under the status Reply publishes it with.
            [json({code: 'contact.scheduleNotFound'}, 404), 'schedule.not_found', 'contact.scheduleNotFound'],
            [json({code: 'contact.scheduleHasNoSlot'}, 409), 'schedule.no_slot', 'contact.scheduleHasNoSlot'],
            [json({code: 'contact.contactTimeZoneMissing'}, 409), 'contact.time_zone_missing', 'contact.contactTimeZoneMissing'],
            [json({code: 'contact.scheduleNotFound'}, 400), 'reply.refused', 'contact.scheduleNotFound'],
            [json({code: 'contact.contactTimeZoneMissing'}, 404), 'reply.refused', 'contact.contactTimeZoneMissing'],
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
            [message, 404, 'directLinkedIn.scheduleNotFound', 'schedule.not_found'],
            [['linkedin-connect', {note: NOTE}], 409, 'directLinkedIn.scheduleHasNoSlot', 'schedule.no_slot'],
            [['linkedin-voice', {script: SCRIPT}], 409, 'directLinkedIn.contactTimeZoneMissing', 'contact.time_zone_missing'],
            [message, 400, 'directLinkedIn.scheduleNotFound', 'reply.refused'],
            [message, 404, 'directLinkedIn.contactTimeZoneMissing', 'reply.refused'],
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
        mock_fetch.mockReset();
        answer(json({status: 409, code: 'directLinkedIn.scheduleHasNoSlot'}, 409));
        expect((await failure('linkedin-message', {body: TEXT}, LINKEDIN_OPTS) as {title?: string}).title)
            .toBe('The sending schedule has no active day with a time range, so it never opens; nothing was sent.');
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
            // An exception escaping a send, on the email route and the LinkedIn ones alike.
            ['500', ()=>answer(json({title: 'Internal Server Error', status: 500}, 500, {'Content-Type': 'application/problem+json'}))],
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
            // A 400 with neither a code nor errors[] is read as Reply's exception only on the send call, never on the import.
            [[nobody(), nobody(), json({title: 'Bad Request', status: 400}, 400, {'Content-Type': 'application/problem+json'})], 'reply.refused', 1],
            // So is the LinkedIn sends' exception code.
            [[nobody(), nobody(), json({code: 'directLinkedIn.unknown', detail: 'Unexpected error.'}, 400)], 'reply.refused', 1],
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

describe('a send for later', ()=>{
    const SENDS: [Direct_send_name, unknown, Direct_send_opts][] = [
        ['send-email', {subject: SUBJECT, body: BODY}, EMAIL_OPTS],
        ['linkedin-connect', {note: NOTE}, LINKEDIN_OPTS],
        ['linkedin-message', {body: TEXT}, LINKEDIN_OPTS],
        ['linkedin-inmail', {subject: SUBJECT, body: TEXT}, LINKEDIN_OPTS],
        ['linkedin-voice', {script: SCRIPT}, LINKEDIN_OPTS],
    ];
    const LATER = {sendAfter: '2026-11-03T16:00:00+02:00', scheduleId: '41', idempotencyKey: 'send-456-step-2'};
    const headers_of = (i: number): Record<string, string>=>
        (mock_fetch.mock.calls[i] as [string, RequestInit])[1].headers as Record<string, string>;
    const accepted = (name: Direct_send_name, extra: Record<string, unknown>)=>
        json(name === 'send-email' ? {status: 'new', messageId: null, ...extra} : {linkedInActivityId: 1042, ...extra});

    it('each send carries the moment in UTC, the schedule and the key only when given, the key as a header and never in the body', async()=>{
        for (const [name, message, opts] of SENDS)
        {
            mock_fetch.mockReset();
            answer(accepted(name, {}), accepted(name, {}));
            await run(name, message, {...opts, ...LATER});
            const body = sent()[0].body as Record<string, unknown>;
            expect(body.sendAfter, name).toBe('2026-11-03T14:00:00.000Z');
            expect(body.scheduleId, name).toBe(41);
            expect(JSON.stringify(body), name).not.toContain('send-456-step-2');
            expect(headers_of(0)['Idempotency-Key'], name).toBe('send-456-step-2');
            await run(name, message, opts);
            const plain = sent()[1].body as Record<string, unknown>;
            expect('scheduleId' in plain, name).toBe(false);
            expect('sendAfter' in plain, name).toBe(false);
            expect('Idempotency-Key' in headers_of(1), name).toBe(false);
        }
    });

    it('adds reference, send_after and state to the answer, each only when Reply gives it, and keeps status as sent', async()=>{
        answer(accepted('send-email', {reference: 'email-1001', sendAfter: '2026-11-03T14:00:00Z', state: 'queued'}));
        expect(await run('send-email', {subject: SUBJECT, body: BODY}, {...EMAIL_OPTS, ...LATER})).toStrictEqual({
            status: 'sent', contact_id: 456, contact_created: false, message_id: null, sent_at: null, reply_status: 'new',
            reference: 'email-1001', send_after: '2026-11-03T14:00:00Z', state: 'queued',
        });
        mock_fetch.mockReset();
        answer(accepted('linkedin-message', {reference: 'linkedin-1042', state: 'sending', sendAfter: null}));
        expect(await run('linkedin-message', {body: TEXT}, LINKEDIN_OPTS)).toStrictEqual({
            status: 'sent', contact_id: 456, contact_created: false, activity_id: 1042, sent_at: null,
            reference: 'linkedin-1042', state: 'sending',
        });
    });

    it('adds estimated_send_at to a send waiting for its schedule\'s opening, a null kept as null, only when Reply gives it', async()=>{
        const waiting = {reference: 'linkedin-scheduled-77', state: 'waitingForSchedule', sendAfter: null, linkedInActivityId: null, sentAtUtc: null};
        const cases: [unknown, Record<string, unknown>][] = [
            ['2026-11-04T09:00:00Z', {estimated_send_at: '2026-11-04T09:00:00Z'}],
            [null, {estimated_send_at: null}],
            [undefined, {}],
            [7, {}],
        ];
        for (const [estimatedSendAt, added] of cases)
        {
            mock_fetch.mockReset();
            answer(json({...waiting, estimatedSendAt}));
            expect(await run('linkedin-message', {body: TEXT}, {...LINKEDIN_OPTS, scheduleId: '41'}), JSON.stringify(estimatedSendAt)).toStrictEqual({
                status: 'sent', contact_id: 456, contact_created: false, activity_id: null, sent_at: null,
                reference: 'linkedin-scheduled-77', state: 'waitingForSchedule', ...added,
            });
        }
    });

    it('adds the rendered subject and body of an email sent inside the request, each only when Reply gives it', async()=>{
        answer(accepted('send-email', {renderedSubject: 'Quick question, Marta', renderedBody: '<p>Hi Marta</p>', state: 'sent'}));
        expect(await run('send-email', {subject: SUBJECT, body: BODY}, EMAIL_OPTS)).toStrictEqual({
            status: 'sent', contact_id: 456, contact_created: false, message_id: null, sent_at: null, reply_status: 'new',
            state: 'sent', rendered_subject: 'Quick question, Marta', rendered_body: '<p>Hi Marta</p>',
        });
        mock_fetch.mockReset();
        answer(accepted('send-email', {reference: 'email-1001', state: 'queued', renderedSubject: null}));
        expect(await run('send-email', {subject: SUBJECT, body: BODY}, {...EMAIL_OPTS, ...LATER})).not.toHaveProperty('rendered_subject');
    });

    it('an answer without them prints exactly what it prints today, even when the flags were given', async()=>{
        answer(accepted('linkedin-voice', {sentAtUtc: '2026-10-19T10:30:00Z'}));
        expect(await run('linkedin-voice', {script: SCRIPT}, {...LINKEDIN_OPTS, ...LATER})).toStrictEqual({
            status: 'sent', contact_id: 456, contact_created: false, activity_id: 1042, sent_at: '2026-10-19T10:30:00Z',
        });
    });

    it('refuses a moment without its offset, a schedule id that is not one and a key Reply cannot take, before any call', async()=>{
        const cases: [Partial<Direct_send_opts>, string][] = [
            [{sendAfter: '2026-11-03T14:00:00'}, 'usage.date'],
            [{sendAfter: '2026-11-03'}, 'usage.date'],
            [{scheduleId: '0'}, 'usage.id'],
            [{scheduleId: 'business'}, 'usage.id'],
            [{idempotencyKey: ''}, 'usage.idempotency_key'],
            [{idempotencyKey: 'k'.repeat(256)}, 'usage.idempotency_key'],
            [{idempotencyKey: 'tab\there'}, 'usage.idempotency_key'],
        ];
        for (const [name, message, opts] of SENDS)
        {
            for (const [extra, code] of cases)
            {
                const e = await failure(name, message, {...opts, ...extra});
                expect(e, `${name} ${JSON.stringify(extra)}`).toMatchObject({code, exit_code: 2});
            }
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('a LinkedIn send carries useContactTimeZone, true or false, and retryWindowMinutes only when given, as Reply takes them', async()=>{
        const cases: [Partial<Direct_send_opts>, Record<string, unknown>][] = [
            [{useContactTimeZone: true}, {useContactTimeZone: true}],
            [{useContactTimeZone: false}, {useContactTimeZone: false}],
            [{retryWindowMinutes: '1'}, {retryWindowMinutes: 1}],
            [{retryWindowMinutes: ' 4320 '}, {retryWindowMinutes: 4320}],
            [{useContactTimeZone: true, retryWindowMinutes: '90'}, {useContactTimeZone: true, retryWindowMinutes: 90}],
            [{}, {}],
        ];
        for (const [name, message, opts] of SENDS.filter(([n])=>n !== 'send-email'))
        {
            for (const [extra, carried] of cases)
            {
                mock_fetch.mockReset();
                answer(accepted(name, {}));
                await run(name, message, {...opts, ...LATER, ...extra});
                const body = sent()[0].body as Record<string, unknown>;
                const label = `${name} ${JSON.stringify(extra)}`;
                expect(body.scheduleId, label).toBe(41);
                expect(Object.fromEntries(Object.entries(body).filter(([k])=>k === 'useContactTimeZone' || k === 'retryWindowMinutes')), label)
                    .toStrictEqual(carried);
            }
        }
    });

    it('refuses a retry window outside 1 to 4320 minutes before any call, and leaves the rules between the fields to Reply', async()=>{
        for (const [name, message, opts] of SENDS.filter(([n])=>n !== 'send-email'))
        {
            for (const raw of ['0', '4321', '-5', '1.5', 'ninety', '', '90m'])
            {
                const e = await failure(name, message, {...opts, retryWindowMinutes: raw});
                expect(e, `${name} ${JSON.stringify(raw)}`).toMatchObject({code: 'usage.range', exit_code: 2});
            }
        }
        expect(mock_fetch).not.toHaveBeenCalled();
        // Without --schedule-id or --send-after either goes to Reply as given, for Reply to refuse with errors[].
        answer(json({errors: [{pointer: '/useContactTimeZone', detail: 'Only with scheduleId.'}]}, 400));
        const e = await failure('linkedin-message', {body: TEXT}, {...LINKEDIN_OPTS, useContactTimeZone: true, retryWindowMinutes: '30'});
        expect(sent()[0].body).toMatchObject({useContactTimeZone: true, retryWindowMinutes: 30});
        expect(e).toMatchObject({code: 'reply.invalid_request', exit_code: 1, details: {fields: ['useContactTimeZone']}});
    });

    it('a direct email carries useContactTimeZone, true or false, only when given, and never a retry window', async()=>{
        const cases: [Partial<Direct_send_opts>, Record<string, unknown>][] = [
            [{useContactTimeZone: true}, {useContactTimeZone: true}],
            [{useContactTimeZone: false, retryWindowMinutes: '30'}, {useContactTimeZone: false}],
            [{retryWindowMinutes: '30'}, {}],
            [{}, {}],
        ];
        for (const [extra, carried] of cases)
        {
            mock_fetch.mockReset();
            answer(accepted('send-email', {}));
            await run('send-email', {subject: SUBJECT, body: BODY}, {...EMAIL_OPTS, ...LATER, ...extra});
            const body = sent()[0].body as Record<string, unknown>;
            expect(body.scheduleId, JSON.stringify(extra)).toBe(41);
            expect(Object.fromEntries(Object.entries(body).filter(([k])=>k === 'useContactTimeZone' || k === 'retryWindowMinutes')),
                JSON.stringify(extra)).toStrictEqual(carried);
        }
    });

    it('a key does not make a lost answer safe to repeat: a Reply that ignores the header would send it twice', async()=>{
        mock_fetch.mockRejectedValueOnce(lost_connection());
        const e = await failure('send-email', {subject: SUBJECT, body: BODY}, {...EMAIL_OPTS, ...LATER});
        expect(e).toMatchObject({code: 'outcome.unknown', exit_code: 3});
        expect((e as {hint?: string}).hint).toContain('may send it twice');
    });

    it('a 404 with no code of Reply\'s own stays reply.refused, status 404 and no reply code, an empty body, a problem without one, or a page that is not JSON', async()=>{
        const bare: [string, ()=>Response][] = [
            ['empty', ()=>new Response(null, {status: 404})],
            ['problem', ()=>json({title: 'Not Found', status: 404}, 404, {'Content-Type': 'application/problem+json'})],
            ['html', ()=>new Response('<html>Not Found</html>', {status: 404, headers: {'Content-Type': 'text/html'}})],
            ['text', ()=>new Response('Not Found', {status: 404, headers: {'Content-Type': 'text/plain'}})],
        ];
        for (const [name, message, opts] of SENDS)
        {
            for (const [label, res] of bare)
            {
                mock_fetch.mockReset();
                answer(res());
                const e = await failure(name, message, {...opts, ...LATER});
                expect(e, `${name} ${label}`).toMatchObject({code: 'reply.refused', status: 404, exit_code: 1});
                expect((e as {reply_code?: string}).reply_code, `${name} ${label}`).toBeUndefined();
            }
        }
    });
});

describe('a send made with an idempotency key', ()=>{
    const KEY = {idempotencyKey: 'send-456-step-2'};
    const SENDS: [Direct_send_name, unknown, Direct_send_opts, string][] = [
        ['send-email', {subject: SUBJECT, body: BODY}, {...EMAIL_OPTS, ...KEY}, 'contact'],
        ['linkedin-connect', {note: NOTE}, {...LINKEDIN_OPTS, ...KEY}, 'directLinkedIn'],
        ['linkedin-message', {body: TEXT}, {...LINKEDIN_OPTS, ...KEY}, 'directLinkedIn'],
        ['linkedin-inmail', {subject: SUBJECT, body: TEXT}, {...LINKEDIN_OPTS, ...KEY}, 'directLinkedIn'],
        ['linkedin-voice', {script: SCRIPT}, {...LINKEDIN_OPTS, ...KEY}, 'directLinkedIn'],
    ];

    it('maps the key Reply holds for a send still being made, and the key reused for another send, each definite', async()=>{
        for (const [name, message, opts, family] of SENDS)
        {
            for (const [reply_code, code] of [['idempotencyKeyInUse', 'idempotency_key.in_use'], ['idempotencyKeyReused', 'idempotency_key.reused']])
            {
                mock_fetch.mockReset();
                answer(json({code: `${family}.${reply_code}`, detail: 'Idempotency-Key conflict.'}, 409));
                const e = await failure(name, message, opts);
                expect(e, `${name} ${reply_code}`).toMatchObject({code, exit_code: 1, status: 409, reply_code: `${family}.${reply_code}`,
                    ids: {contact_id: 456}});
                expect(sent(), name).toHaveLength(1);
            }
        }
    });

    it('a reused key carries the send Reply holds under it, reference, state and send_after, each only when Reply gives it', async()=>{
        for (const [name, message, opts, family] of SENDS)
        {
            mock_fetch.mockReset();
            answer(json({code: `${family}.idempotencyKeyReused`, detail: 'Reused.', reference: 'email-1001', state: 'queued',
                sendAfter: '2026-11-03T14:00:00Z'}, 409));
            const e = await failure(name, message, opts);
            expect(e, name).toMatchObject({code: 'idempotency_key.reused',
                details: {reference: 'email-1001', state: 'queued', send_after: '2026-11-03T14:00:00Z'}});
            expect((e as {to_json: () => unknown}).to_json(), name).toMatchObject({error: {details: {reference: 'email-1001'}}});
        }
        mock_fetch.mockReset();
        answer(json({code: 'contact.idempotencyKeyReused', reference: 'email-1001', state: 7, sendAfter: null}, 409));
        expect((await failure('send-email', {subject: SUBJECT, body: BODY}, {...EMAIL_OPTS, ...KEY}) as {details?: unknown}).details)
            .toStrictEqual({reference: 'email-1001'});
    });

    it('a reused key or a key in use without the send carries no details: the output is what it was', async()=>{
        for (const reply_code of ['contact.idempotencyKeyReused', 'contact.idempotencyKeyInUse'])
        {
            mock_fetch.mockReset();
            answer(json({code: reply_code, detail: 'Conflict.'}, 409));
            const e = await failure('send-email', {subject: SUBJECT, body: BODY}, {...EMAIL_OPTS, ...KEY});
            expect((e as {details?: unknown}).details, reply_code).toBeUndefined();
            expect(JSON.stringify((e as {to_json: () => unknown}).to_json()), reply_code).not.toContain('details');
        }
        // A key in use names the send too when Reply gives it, as every refusal of a send does.
        mock_fetch.mockReset();
        answer(json({code: 'contact.idempotencyKeyInUse', detail: 'Conflict.', reference: 'email-1001'}, 409));
        expect((await failure('send-email', {subject: SUBJECT, body: BODY}, {...EMAIL_OPTS, ...KEY}) as {details?: unknown}).details)
            .toStrictEqual({reference: 'email-1001'});
    });

    it('reads those codes only under 409 and only in the send route\'s own family; any other answer is mapped as before', async()=>{
        const cases: [Direct_send_name, unknown, Direct_send_opts, Response][] = [
            ['send-email', {subject: SUBJECT, body: BODY}, {...EMAIL_OPTS, ...KEY}, json({code: 'contact.idempotencyKeyInUse'}, 400)],
            ['send-email', {subject: SUBJECT, body: BODY}, {...EMAIL_OPTS, ...KEY}, json({code: 'directLinkedIn.idempotencyKeyInUse'}, 409)],
            ['linkedin-message', {body: TEXT}, {...LINKEDIN_OPTS, ...KEY}, json({code: 'contact.idempotencyKeyReused'}, 409)],
        ];
        for (const [name, message, opts, res] of cases)
        {
            mock_fetch.mockReset();
            answer(res);
            expect(await failure(name, message, opts), name).toMatchObject({code: 'reply.refused', exit_code: 1});
        }
    });
});

describe('a direct email Reply renders', ()=>{
    const EMAIL: unknown = {subject: SUBJECT, body: BODY};

    it('maps a variable Reply could not fill to contact.missing_variables, with the bare names under details', async()=>{
        answer(json({code: 'contact.missingVariables', detail: 'The message has variables with no value.',
            missingVariables: ['FirstName', 'Company']}, 400));
        const e = await failure('send-email', EMAIL, EMAIL_OPTS);
        expect(e).toMatchObject({code: 'contact.missing_variables', status: 400, exit_code: 1, reply_code: 'contact.missingVariables',
            details: {missing_variables: ['FirstName', 'Company']}, ids: {contact_id: 456}});
        expect((e as {to_json: () => unknown}).to_json()).toMatchObject({error: {details: {missing_variables: ['FirstName', 'Company']}}});
    });

    it('leaves missing_variables out when Reply gives no list of names, as the reused key leaves its fields out', async()=>{
        for (const missing of [undefined, null, 'FirstName', ['FirstName', 7]])
        {
            mock_fetch.mockReset();
            answer(json({code: 'contact.missingVariables', detail: 'The message has variables with no value.', missingVariables: missing}, 400));
            const e = await failure('send-email', EMAIL, EMAIL_OPTS);
            expect(e, JSON.stringify(missing)).toMatchObject({code: 'contact.missing_variables', status: 400, exit_code: 1});
            expect((e as {details?: unknown}).details, JSON.stringify(missing)).toBeUndefined();
            expect((e as {to_json: () => {error: object}}).to_json().error, JSON.stringify(missing)).not.toHaveProperty('details');
        }
    });

    it('maps a template Reply could not render to contact.rendering_failed, with Reply\'s message as the detail', async()=>{
        answer(json({code: 'contact.renderingFailed', detail: 'Unclosed block at line 2.'}, 400));
        expect(await failure('send-email', EMAIL, EMAIL_OPTS)).toMatchObject({code: 'contact.rendering_failed', status: 400, exit_code: 1,
            reply_code: 'contact.renderingFailed', detail: 'Unclosed block at line 2.'});
    });

    it('reads the two codes only under 400; Reply\'s older contact.unknown stays reply.refused', async()=>{
        const cases: [Response, string][] = [
            [json({code: 'contact.missingVariables'}, 409), 'reply.refused'],
            [json({code: 'contact.renderingFailed'}, 409), 'reply.refused'],
            [json({code: 'contact.unknown', detail: 'The message has variables with no value.'}, 400), 'reply.refused'],
        ];
        for (const [res, code] of cases)
        {
            mock_fetch.mockReset();
            answer(res);
            expect(await failure('send-email', EMAIL, EMAIL_OPTS), code).toMatchObject({code, exit_code: 1});
        }
    });

    it('reads the two codes only from the email route: a LinkedIn send answering either falls to the usual mapping', async()=>{
        const sends: [Direct_send_name, unknown][] = [['linkedin-connect', {note: NOTE}], ['linkedin-message', {body: TEXT}],
            ['linkedin-inmail', {subject: SUBJECT, body: TEXT}], ['linkedin-voice', {script: SCRIPT}]];
        for (const [name, message] of sends)
        {
            for (const reply_code of ['contact.missingVariables', 'contact.renderingFailed'])
            {
                mock_fetch.mockReset();
                answer(json({code: reply_code, missingVariables: ['FirstName']}, 400));
                const e = await failure(name, message, LINKEDIN_OPTS);
                expect(e, `${name} ${reply_code}`).toMatchObject({code: 'reply.refused', status: 400, reply_code, exit_code: 1});
                expect((e as {details?: unknown}).details, `${name} ${reply_code}`).toBeUndefined();
            }
        }
    });

    it('sends trackLinks and trackOpens only when their flags are given, and nothing of them otherwise', async()=>{
        const cases: [Direct_send_opts, Record<string, unknown>][] = [
            [EMAIL_OPTS, {}],
            [{...EMAIL_OPTS, trackLinks: true}, {trackLinks: true}],
            [{...EMAIL_OPTS, trackOpens: true}, {trackOpens: true}],
            [{...EMAIL_OPTS, trackLinks: true, trackOpens: true}, {trackLinks: true, trackOpens: true}],
        ];
        for (const [opts, tracking] of cases)
        {
            mock_fetch.mockReset();
            answer(json({status: 'new', messageId: null}));
            await run('send-email', EMAIL, opts);
            const body = sent()[0].body as Record<string, unknown>;
            expect({trackLinks: body.trackLinks, trackOpens: body.trackOpens}, JSON.stringify(tracking))
                .toStrictEqual({trackLinks: tracking.trackLinks, trackOpens: tracking.trackOpens});
            expect(Object.keys(body).filter(k=>k.startsWith('track')), JSON.stringify(tracking)).toEqual(Object.keys(tracking));
        }
    });
});

describe('a refused send that Reply holds a row for', ()=>{
    const EMAIL: unknown = {subject: SUBJECT, body: BODY};
    const HELD = {reference: 'email-1001', state: 'failed', sendAfter: '2026-11-03T14:00:00Z'};
    const details_of = (e: unknown): unknown=>(e as {details?: unknown}).details;

    it('names the send under details, reference, state and send_after, beside the refusal\'s code and class as before', async()=>{
        answer(json({code: 'contact.renderingFailed', detail: 'Unclosed block at line 2.', ...HELD}, 400));
        const e = await failure('send-email', EMAIL, EMAIL_OPTS);
        expect(e).toMatchObject({code: 'contact.rendering_failed', status: 400, exit_code: 1, reply_code: 'contact.renderingFailed',
            ids: {contact_id: 456}});
        expect(details_of(e)).toStrictEqual({reference: 'email-1001', state: 'failed', send_after: '2026-11-03T14:00:00Z'});
        expect((e as {to_json: () => unknown}).to_json()).toMatchObject({error: {details: {reference: 'email-1001', state: 'failed'}}});
    });

    it('gives each field only when Reply gives it as a string', async()=>{
        const cases: [Record<string, unknown>, unknown][] = [
            [{reference: 'email-1001'}, {reference: 'email-1001'}],
            [{reference: 'email-1001', state: 7, sendAfter: null}, {reference: 'email-1001'}],
            [{state: {failed: true}, sendAfter: ['2026-11-03T14:00:00Z']}, undefined],
        ];
        for (const [held, details] of cases)
        {
            mock_fetch.mockReset();
            answer(json({code: 'contact.contactInBlackList', ...held}, 400));
            const e = await failure('send-email', EMAIL, EMAIL_OPTS);
            expect(e, JSON.stringify(held)).toMatchObject({code: 'contact.blacklisted', exit_code: 1});
            expect(details_of(e), JSON.stringify(held)).toStrictEqual(details);
        }
    });

    it('names it on a LinkedIn send\'s refusal too, a known code or one mapped as everywhere else', async()=>{
        const cases: [Direct_send_name, unknown, Response, string][] = [
            ['linkedin-message', {body: TEXT}, json({code: 'directLinkedIn.notConnected', ...HELD, reference: 'linkedin-1042'}, 409),
                'linkedin.not_connected'],
            ['linkedin-connect', {note: NOTE}, json({code: 'directLinkedIn.somethingNew', ...HELD, reference: 'linkedin-1042'}, 400),
                'reply.refused'],
        ];
        for (const [name, message, res, code] of cases)
        {
            mock_fetch.mockReset();
            answer(res);
            const e = await failure(name, message, LINKEDIN_OPTS);
            expect(e, name).toMatchObject({code, exit_code: 1});
            expect(details_of(e), name).toStrictEqual({reference: 'linkedin-1042', state: 'failed', send_after: '2026-11-03T14:00:00Z'});
        }
    });

    it('sits beside the details a refusal carries of its own: the unfilled names, a LinkedIn limit', async()=>{
        answer(json({code: 'contact.missingVariables', missingVariables: ['FirstName'], ...HELD}, 400));
        expect(details_of(await failure('send-email', EMAIL, EMAIL_OPTS))).toStrictEqual({missing_variables: ['FirstName'],
            reference: 'email-1001', state: 'failed', send_after: '2026-11-03T14:00:00Z'});
        mock_fetch.mockReset();
        answer(json({code: 'directLinkedIn.dailyLimitReached', reference: 'linkedin-1042'}, 429, {'Retry-After': '3600'}));
        expect(details_of(await failure('linkedin-message', {body: TEXT}, LINKEDIN_OPTS))).toStrictEqual({limit: 'daily',
            reference: 'linkedin-1042'});
    });

    it('a refusal without them carries no details, and the output is what it was', async()=>{
        for (const res of [json({code: 'contact.renderingFailed', detail: 'Unclosed block at line 2.'}, 400),
            json({code: 'contact.somethingNew'}, 400), json('<html>Bad Request</html>', 400)])
        {
            mock_fetch.mockReset();
            answer(res);
            const e = await failure('send-email', EMAIL, EMAIL_OPTS);
            expect(details_of(e)).toBeUndefined();
            expect(JSON.stringify((e as {to_json: () => unknown}).to_json())).not.toContain('details');
        }
    });
});

describe('a 400 on the send call with neither a code nor errors[]', ()=>{
    const SENDS: [Direct_send_name, unknown, Direct_send_opts][] = [
        ['send-email', {subject: SUBJECT, body: BODY}, EMAIL_OPTS],
        ['linkedin-connect', {note: NOTE}, LINKEDIN_OPTS],
        ['linkedin-message', {body: TEXT}, LINKEDIN_OPTS],
        ['linkedin-inmail', {subject: SUBJECT, body: TEXT}, LINKEDIN_OPTS],
        ['linkedin-voice', {script: SCRIPT}, LINKEDIN_OPTS],
    ];
    const problem = (body: unknown)=>json(body, 400, {'Content-Type': 'application/problem+json'});

    it('is Reply\'s exception path: outcome.unknown (exit 3), made once, and a repeat may send it twice', async()=>{
        for (const [name, message, opts] of SENDS)
        {
            for (const [label, res] of [['problem', ()=>problem({title: 'Internal error', status: 400})], ['json', ()=>json({title: 'Internal error'}, 400)]] as const)
            {
                mock_fetch.mockReset();
                answer(res());
                const e = await failure(name, message, opts);
                expect(e, `${name} ${label}`).toMatchObject({code: 'outcome.unknown', exit_code: 3, status: 400, ids: {contact_id: 456}});
                expect((e as {reply_code?: string}).reply_code, `${name} ${label}`).toBeUndefined();
                expect((e as {hint?: string}).hint ?? '', `${name} ${label}`).toContain('may send it twice');
                expect(mock_fetch, `${name} ${label}`).toHaveBeenCalledTimes(1);
            }
        }
    });

    it('keeps the send it names under details, should Reply give one', async()=>{
        answer(problem({title: 'Internal error', status: 400, reference: 'email-1001', state: 'failed'}));
        const e = await failure('send-email', {subject: SUBJECT, body: BODY}, EMAIL_OPTS);
        expect(e).toMatchObject({code: 'outcome.unknown', exit_code: 3, details: {reference: 'email-1001', state: 'failed'}});
    });

    it('with errors[] it is a request Reply refused as given, and a page that is not JSON maps as before', async()=>{
        for (const [name, message, opts] of SENDS)
        {
            const cases: [string, ()=>Response, string][] = [
                ['errors', ()=>problem({title: 'Validation failed', status: 400, errors: [{pointer: '/body', detail: 'must not be empty'}]}),
                    'reply.invalid_request'],
                ['empty errors', ()=>problem({title: 'Validation failed', status: 400, errors: []}), 'reply.invalid_request'],
                ['html', ()=>new Response('<html>Bad Request</html>', {status: 400, headers: {'Content-Type': 'text/html'}}), 'reply.refused'],
                ['text', ()=>new Response('Bad Request', {status: 400, headers: {'Content-Type': 'text/plain'}}), 'reply.refused'],
                ['empty', ()=>new Response(null, {status: 400}), 'reply.refused'],
            ];
            for (const [label, res, code] of cases)
            {
                mock_fetch.mockReset();
                answer(res());
                const e = await failure(name, message, opts);
                expect(e, `${name} ${label}`).toMatchObject({code, exit_code: 1, status: 400});
                expect(mock_fetch, `${name} ${label}`).toHaveBeenCalledTimes(1);
            }
        }
    });
});

describe('a 400 directLinkedIn.unknown on the send call', ()=>{
    const LINKEDIN: [Direct_send_name, unknown][] = [
        ['linkedin-connect', {note: NOTE}],
        ['linkedin-message', {body: TEXT}],
        ['linkedin-inmail', {subject: SUBJECT, body: TEXT}],
        ['linkedin-voice', {script: SCRIPT}],
    ];
    const unknown = (status: number, extra: Record<string, unknown> = {})=>
        json({code: 'directLinkedIn.unknown', detail: 'An unexpected error occurred.', ...extra}, status, {'Content-Type': 'application/problem+json'});

    it('is Reply\'s exception path on a LinkedIn send: outcome.unknown (exit 3), status 400 and Reply\'s code kept, made once, '
        + 'and a repeat may send it twice', async()=>{
        for (const [name, message] of LINKEDIN)
        {
            mock_fetch.mockReset();
            answer(unknown(400));
            const e = await failure(name, message, LINKEDIN_OPTS);
            expect(e, name).toMatchObject({code: 'outcome.unknown', exit_code: 3, status: 400, reply_code: 'directLinkedIn.unknown',
                ids: {contact_id: 456}});
            expect((e as {hint?: string}).hint ?? '', name).toContain('may send it twice');
            expect(mock_fetch, name).toHaveBeenCalledTimes(1);
        }
    });

    it('keeps the send it names under details, should Reply give one', async()=>{
        answer(unknown(400, {reference: 'linkedin-1042', state: 'failed'}));
        const e = await failure('linkedin-message', {body: TEXT}, LINKEDIN_OPTS);
        expect(e).toMatchObject({code: 'outcome.unknown', exit_code: 3, details: {reference: 'linkedin-1042', state: 'failed'}});
    });

    it('under any other status it maps as before', async()=>{
        for (const [name, message] of LINKEDIN)
        {
            for (const [status, code] of [[409, 'reply.refused'], [403, 'access.denied'], [404, 'reply.refused']] as const)
            {
                mock_fetch.mockReset();
                answer(unknown(status));
                const e = await failure(name, message, LINKEDIN_OPTS);
                expect(e, `${name} ${status}`).toMatchObject({code, exit_code: 1, status, reply_code: 'directLinkedIn.unknown'});
            }
        }
    });

    it('on send-email it maps as before, and Reply\'s contact.emailSendingFailed stays a refusal: nothing was sent', async()=>{
        for (const reply_code of ['directLinkedIn.unknown', 'contact.emailSendingFailed'])
        {
            mock_fetch.mockReset();
            answer(json({code: reply_code, detail: 'The email could not be sent.'}, 400, {'Content-Type': 'application/problem+json'}));
            const e = await failure('send-email', {subject: SUBJECT, body: BODY}, EMAIL_OPTS);
            expect(e, reply_code).toMatchObject({code: 'reply.refused', exit_code: 1, status: 400, reply_code, ids: {contact_id: 456}});
            expect(mock_fetch, reply_code).toHaveBeenCalledTimes(1);
        }
    });
});
