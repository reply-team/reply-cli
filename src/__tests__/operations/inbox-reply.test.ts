import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture, instant_timers, real_timers} from './helpers';
import {handle_inbox_reply} from '../../operations/inbox-reply';

const BODY = 'Thanks Marta, Tuesday at 10 works.';
const stdin = (value: unknown)=>()=>(typeof value === 'string' ? value : JSON.stringify(value));
const run = (message: unknown, thread = '9')=>
    capture(()=>handle_inbox_reply(thread, {message: '-'}, ctx(), {json: true}, stdin(message)));
const reject = (message: unknown)=>handle_inbox_reply('9', {message: '-'}, ctx(), {}, stdin(message));

const email_thread = ()=>json({id: 9, channel: 'email', contact: {id: 456, email: 'marta@example.com', isDeleted: false}, messages: []});
const linkedin_thread = ()=>json({id: 9, channel: 'linkedIn', contact: {id: 456, isDeleted: false}, messages: []});
const lost_connection = ()=>Object.assign(new TypeError('fetch failed'),
    {cause: Object.assign(new Error('ECONNRESET'), {code: 'ECONNRESET'})});

// What a failure shows a caller: none of it may carry the person's words.
const shown = (e: unknown): string=>{
    const err = e as {message?: string; title?: string; hint?: string; detail?: string};
    return [err.message, err.title, err.hint, err.detail].join(' ');
};

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('inbox reply', ()=>{
    it('reads the thread for its channel, then replies in it; an email reply may answer one message', async()=>{
        answer(email_thread(), json({channel: 'email', messageId: '<m2@example.com>', date: '2026-10-18T19:00:00Z', isOutbound: true}));
        const {out} = await run({body: BODY, reply_to_message_id: '<m1@example.com>'});
        expect(JSON.parse(out)).toEqual({
            status: 'sent', thread_id: 9, channel: 'email', message_id: '<m2@example.com>', sent_at: '2026-10-18T19:00:00Z',
        });
        expect(sent()).toEqual([
            {method: 'GET', url: 'https://api/v3/inbox/threads/9', body: undefined},
            {method: 'POST', url: 'https://api/v3/inbox/threads/9/messages',
                body: {channel: 'email', message: BODY, replyToMessageId: '<m1@example.com>'}},
        ]);
    });

    it('a LinkedIn reply carries only the channel and the text, and Reply gives it no message id', async()=>{
        answer(linkedin_thread(), json({channel: 'linkedIn', messageId: null, date: '2026-10-18T19:00:00Z', isOutbound: true}));
        const {out} = await run({body: BODY});
        expect(JSON.parse(out)).toEqual({status: 'sent', thread_id: 9, channel: 'linkedin', message_id: null, sent_at: '2026-10-18T19:00:00Z'});
        expect(sent()[1].body).toStrictEqual({channel: 'linkedIn', message: BODY});
    });

    it('an email reply without reply_to_message_id answers the latest message, so none is sent', async()=>{
        answer(email_thread(), json({channel: 'email', messageId: '<m2@example.com>', date: '2026-10-18T19:00:00Z'}));
        await run({body: BODY});
        expect(sent()[1].body).toStrictEqual({channel: 'email', message: BODY});
    });

    it('refuses before sending: reply_to_message_id on a LinkedIn thread, or a thread whose channel Reply cannot reply on', async()=>{
        const cases: [Response, unknown, string][] = [
            [linkedin_thread(), {body: BODY, reply_to_message_id: 'x'}, 'linkedin'],
            [json({id: 9, channel: 'unknown', contact: {isDeleted: false}, messages: []}), {body: BODY}, 'unknown'],
        ];
        for (const [thread, message, thread_channel] of cases)
        {
            mock_fetch.mockReset();
            answer(thread);
            await expect(reject(message)).rejects.toMatchObject({
                code: 'inbox.channel_mismatch', exit_code: 1, ids: {thread_id: 9}, details: {thread_channel},
            });
            expect(sent().map(r=>r.method), thread_channel).toEqual(['GET']);
        }
    });

    it('a thread Reply cannot find is inbox.thread_not_found, and nothing is sent', async()=>{
        answer(json({code: 'inboxThread.notFound'}, 404));
        await expect(reject({body: BODY})).rejects.toMatchObject({code: 'inbox.thread_not_found', ids: {thread_id: 9}});
        expect(mock_fetch).toHaveBeenCalledTimes(1);
    });

    it('maps Reply\'s refusals of the send', async()=>{
        const cases: [Response, string][] = [
            [json({code: 'inboxThread.notFound'}, 404), 'inbox.thread_not_found'],
            [json({code: 'inboxThread.channelMismatch'}, 400), 'inbox.channel_mismatch'],
            [json({code: 'inboxThread.contactOptedOut', detail: 'Contact has opted out.'}, 400), 'contact.opted_out'],
            [json({title: 'Validation failed', errors: [{pointer: '/message', detail: 'must not be empty'}]}, 400), 'reply.invalid_request'],
            [json({code: 'inboxThread.forbidden'}, 403), 'access.feature_unavailable'],
        ];
        for (const [res, code] of cases)
        {
            mock_fetch.mockReset();
            answer(email_thread(), res);
            await expect(reject({body: BODY}), code).rejects.toMatchObject({code, exit_code: 1, ids: {thread_id: 9}});
        }
    });

    it('a coded 502 is a refusal, not an unknown outcome, and carries the failed message\'s status code', async()=>{
        answer(
            linkedin_thread(),
            json({title: 'Bad Gateway', status: 502, detail: 'Failed to deliver the message.', code: 'inboxThread.threadSendFailed'}, 502),
            json({id: 9, channel: 'linkedIn', messages: [
                {channel: 'linkedIn', isOutbound: true, status: {state: 'needsAttention', code: 'linkedInInvalidCookie'}},
                {channel: 'linkedIn', isOutbound: false, body: 'inbound'},
                {channel: 'linkedIn', isOutbound: true, status: {state: 'needsAttention', code: 'linkedInSendingLimitExceeded'}},
            ]}),
        );
        const e = await reject({body: BODY}).catch((x: unknown)=>x);
        expect(e).toMatchObject({
            code: 'inbox.send_failed', exit_code: 1, status: 502, reply_code: 'inboxThread.threadSendFailed',
            ids: {thread_id: 9}, details: {status_code: 'linkedInSendingLimitExceeded'},
        });
        expect(sent().map(r=>r.method)).toEqual(['GET', 'POST', 'GET']);
    });

    it('a coded 502 whose follow-up read fails is still inbox.send_failed, with no status code', async()=>{
        answer(email_thread(), json({code: 'inboxThread.threadSendFailed'}, 502), json({code: 'inboxThread.forbidden'}, 403));
        await expect(reject({body: BODY})).rejects.toMatchObject({code: 'inbox.send_failed', exit_code: 1, details: {status_code: null}});
        expect(sent().filter(r=>r.method === 'POST')).toHaveLength(1);
    });

    it('a 502 without Reply\'s code, a 503, a 201 and an unreadable 200 are outcome.unknown (exit 3), sent once, each saying a repeat may send it twice', async()=>{
        const cases: [string, Response][] = [
            ['uncoded 502', json('<html>bad gateway</html>', 502)],
            ['503', json({code: 'inboxThread.unavailable'}, 503)],
            ['201', json({}, 201)],
            ['unreadable 200', json('<html>ok</html>', 200)],
        ];
        for (const [name, res] of cases)
        {
            mock_fetch.mockReset();
            answer(email_thread(), res);
            const e = await reject({body: BODY}).catch((x: unknown)=>x);
            expect(e, name).toMatchObject({code: 'outcome.unknown', exit_code: 3, ids: {thread_id: 9}});
            const hint = (e as {hint?: string}).hint ?? '';
            expect(hint, `${name}: ${hint}`).toContain('may send it twice');
            expect(hint, `${name}: ${hint}`).not.toContain('safe to re-run');
            expect(sent().filter(r=>r.method === 'POST'), name).toHaveLength(1);
        }
    });

    it('a 5xx on the thread read before the send is reply.unavailable (exit 1): nothing was sent', async()=>{
        instant_timers();
        try {
            // The client asks a read again after a 5xx, so every attempt answers 503.
            answer(...[1, 2, 3, 4].map(()=>json({title: 'Service Unavailable'}, 503)));
            const e = await reject({body: BODY}).catch((x: unknown)=>x);
            expect(e).toMatchObject({code: 'reply.unavailable', exit_code: 1, ids: {thread_id: 9}});
            expect((e as {hint?: string}).hint ?? '', 'no send-twice hint before a send').not.toContain('may send it twice');
            expect(sent().map(r=>r.method)).toEqual(['GET', 'GET', 'GET', 'GET']);
        } finally {
            real_timers();
        }
    });

    it('a lost answer is outcome.unknown (exit 3), never resent, and says a repeat may send the reply twice', async()=>{
        answer(email_thread());
        mock_fetch.mockRejectedValueOnce(lost_connection());
        const e = await reject({body: BODY}).catch((x: unknown)=>x);
        expect(e).toMatchObject({code: 'outcome.unknown', exit_code: 3, ids: {thread_id: 9}});
        const hint = (e as {hint?: string}).hint ?? '';
        expect(hint, hint).toContain('may send it twice');
        expect(hint, hint).not.toContain('safe to re-run');
        expect(mock_fetch).toHaveBeenCalledTimes(2);
    });

    it('takes the message from stdin only: inline JSON and @file are refused before any call, the text never echoed', async()=>{
        for (const source of [JSON.stringify({body: BODY}), '@message.json', undefined])
        {
            const e = await handle_inbox_reply('9', {message: source}, ctx(), {}, stdin({body: BODY})).catch((x: unknown)=>x);
            expect(e, String(source)).toMatchObject({code: 'usage.message', exit_code: 2});
            expect(shown(e), shown(e)).not.toContain('Tuesday');
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('refuses a message on stdin that is not {body, reply_to_message_id?}, without echoing it', async()=>{
        const bad = [
            `not json ${BODY}`, [BODY], {}, {body: '   '}, {body: 7}, {body: BODY, cc: 'ann@example.com'},
            {body: BODY, reply_to_message_id: ''}, {body: BODY, reply_to_message_id: 3},
        ];
        for (const message of bad)
        {
            const e = await reject(message).catch((x: unknown)=>x);
            expect(e, JSON.stringify(message)).toMatchObject({code: 'usage.message', exit_code: 2});
            expect(shown(e), shown(e)).not.toContain('Tuesday');
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('a thread id that is not a Reply id is a usage error before any call', async()=>{
        await expect(run({body: BODY}, 'abc')).rejects.toMatchObject({code: 'usage.id'});
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});
