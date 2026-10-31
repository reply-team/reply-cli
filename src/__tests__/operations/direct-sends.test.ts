import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_direct_send_get, handle_direct_send_cancel} from '../../operations/direct-sends';

beforeEach(()=>{ mock_fetch.mockReset(); });

const QUEUED = {
    reference: 'email-1001', channel: 'email', contactId: 456, state: 'queued', sendAfter: '2026-11-03T14:00:00Z',
    sentAt: null, messageId: null, failureReason: null, cancelledAt: null,
};
const CANCELLED = {...QUEUED, state: 'cancelled', cancelledAt: '2026-11-02T09:15:00Z'};

const get = async(reference: string)=>JSON.parse((await capture(()=>handle_direct_send_get(reference, ctx(), {json: true}))).out);
const cancel = async(reference: string)=>JSON.parse((await capture(()=>handle_direct_send_cancel(reference, ctx(), {json: true}))).out);
const failure = (fn: () => Promise<void>)=>fn().catch((x: unknown)=>x);

const lost_connection = ()=>Object.assign(new TypeError('fetch failed'),
    {cause: Object.assign(new Error('ECONNRESET'), {code: 'ECONNRESET'})});

// A 404 with no code of Reply's own: how a Reply without the route, or a proxy in front of it, answers.
const BARE_404: [string, ()=>Response][] = [
    ['empty', ()=>new Response(null, {status: 404})],
    ['problem without a code', ()=>json({title: 'Not Found', status: 404}, 404, {'Content-Type': 'application/problem+json'})],
    ['html page', ()=>new Response('<html>Not Found</html>', {status: 404, headers: {'Content-Type': 'text/html'}})],
    ['plain text', ()=>new Response('Not Found', {status: 404, headers: {'Content-Type': 'text/plain'}})],
];

describe('direct-send get', ()=>{
    it('reads one send by its reference and answers Reply\'s model under the CLI\'s names', async()=>{
        answer(json(QUEUED));
        expect(await get('email-1001')).toStrictEqual({
            reference: 'email-1001', channel: 'email', contact_id: 456, state: 'queued', send_after: '2026-11-03T14:00:00Z',
            sent_at: null, message_id: null, failure_reason: null, cancelled_at: null,
        });
        expect(sent()).toEqual([{method: 'GET', url: 'https://api/v3/direct-sends/email-1001', body: undefined}]);
    });

    it('gives what Reply leaves out as null, and Reply\'s state as its own word, one the CLI does not know included', async()=>{
        answer(json({reference: 'linkedin-1042', state: 'held', sentAt: '2026-11-03T14:00:02Z', messageId: 'm-1',
            failureReason: 'notConnected'}));
        expect(await get('linkedin-1042')).toStrictEqual({
            reference: 'linkedin-1042', channel: null, contact_id: null, state: 'held', send_after: null,
            sent_at: '2026-11-03T14:00:02Z', message_id: 'm-1', failure_reason: 'notConnected', cancelled_at: null,
        });
    });

    it('gives what Reply says of a rendered or failed send as given: the failure\'s sentence and its code, the unfilled names', async()=>{
        answer(json({...QUEUED, state: 'failed', failureReason: 'A template variable had no value for this contact.',
            failureCode: 'contact.missingVariables', missingVariables: ['FirstName', 'Company'],
            renderedSubject: 'Quick question, Marta', renderedBody: '<p>Hi Marta</p>'}));
        expect(await get('email-1001')).toMatchObject({
            state: 'failed', failure_reason: 'A template variable had no value for this contact.', failure_code: 'contact.missingVariables',
            missing_variables: ['FirstName', 'Company'], rendered_subject: 'Quick question, Marta', rendered_body: '<p>Hi Marta</p>',
        });
    });

    it('adds the rendered text, the failure\'s code and the unfilled names only when Reply gives them, a null included', async()=>{
        answer(json({...QUEUED, failureCode: null, missingVariables: null, renderedSubject: null, renderedBody: null}));
        expect(await get('email-1001')).toMatchObject({failure_code: null, missing_variables: null, rendered_subject: null, rendered_body: null});
        for (const [from, to] of [['failureCode', 'failure_code'], ['missingVariables', 'missing_variables'],
            ['renderedSubject', 'rendered_subject'], ['renderedBody', 'rendered_body']])
        {
            mock_fetch.mockReset();
            answer(json({...QUEUED, failureCode: 'x', missingVariables: [], renderedSubject: 's', renderedBody: 'b', [from]: undefined}));
            const got = await get('email-1001');
            expect(got, from).not.toHaveProperty(to);
            expect(Object.keys(got), from).toHaveLength(12);
        }
    });

    it('adds estimated_send_at, Reply\'s estimatedSendAt, as text or null and only when Reply gives it, to get and cancel', async()=>{
        const WAITING = {...QUEUED, reference: 'linkedin-scheduled-77', channel: 'linkedin', state: 'waitingForSchedule', sendAfter: null};
        const cases: [unknown, Record<string, unknown>][] = [
            ['2026-11-04T09:00:00Z', {estimated_send_at: '2026-11-04T09:00:00Z'}],
            [null, {estimated_send_at: null}],
        ];
        for (const fn of [get, cancel])
        {
            for (const [estimatedSendAt, added] of cases)
            {
                mock_fetch.mockReset();
                answer(json({...WAITING, estimatedSendAt}));
                expect(await fn('linkedin-scheduled-77'), JSON.stringify(estimatedSendAt)).toStrictEqual({
                    reference: 'linkedin-scheduled-77', channel: 'linkedin', contact_id: 456, state: 'waitingForSchedule', send_after: null,
                    ...added, sent_at: null, message_id: null, failure_reason: null, cancelled_at: null,
                });
            }
            for (const odd of [undefined, 7, ['2026-11-04T09:00:00Z']])
            {
                mock_fetch.mockReset();
                answer(json({...WAITING, estimatedSendAt: odd}));
                expect(await fn('linkedin-scheduled-77'), JSON.stringify(odd)).not.toHaveProperty('estimated_send_at');
            }
        }
    });

    it('reads a LinkedIn send through the states Reply\'s scheduler gives it, and a failure with or without its code', async()=>{
        const LINKEDIN = {...QUEUED, reference: 'linkedin-scheduled-77', channel: 'linkedin'};
        const cases: [Record<string, unknown>, Record<string, unknown>][] = [
            [{state: 'waitingForSchedule', sendAfter: null, estimatedSendAt: null}, {state: 'waitingForSchedule', send_after: null}],
            [{state: 'sending'}, {state: 'sending'}],
            [{state: 'failed', failureReason: 'The send failed.', failureCode: null}, {state: 'failed', failure_code: null}],
            [{state: 'failed', failureCode: 'directSend.dispatchWindowMissed'}, {state: 'failed', failure_code: 'directSend.dispatchWindowMissed'}],
            [{state: 'failed', failureCode: 'directSend.dispatchInterrupted'}, {state: 'failed', failure_code: 'directSend.dispatchInterrupted'}],
            [{state: 'failed', failureCode: 'directLinkedIn.notConnected'}, {state: 'failed', failure_code: 'directLinkedIn.notConnected'}],
            [{state: 'cancelled', cancelledAt: '2026-11-02T09:15:00Z'}, {state: 'cancelled', cancelled_at: '2026-11-02T09:15:00Z'}],
        ];
        for (const [given, read] of cases)
        {
            mock_fetch.mockReset();
            answer(json({...LINKEDIN, ...given}));
            expect(await get('linkedin-scheduled-77'), JSON.stringify(given)).toMatchObject({reference: 'linkedin-scheduled-77', ...read});
        }
    });

    it('gives missing_variables only as a list of names, and the others only as text: anything else is left out', async()=>{
        for (const missing of [[], ['FirstName']])
        {
            mock_fetch.mockReset();
            answer(json({...QUEUED, missingVariables: missing}));
            expect((await get('email-1001')).missing_variables, JSON.stringify(missing)).toEqual(missing);
        }
        for (const odd of ['FirstName', ['FirstName', 7], {name: 'FirstName'}, 7])
        {
            mock_fetch.mockReset();
            answer(json({...QUEUED, missingVariables: odd, failureCode: [odd], renderedSubject: 7, renderedBody: {odd}}));
            expect(Object.keys(await get('email-1001')), JSON.stringify(odd)).toEqual(['reference', 'channel', 'contact_id', 'state',
                'send_after', 'sent_at', 'message_id', 'failure_reason', 'cancelled_at']);
        }
    });

    it('sends a reference of the form Reply\'s route takes as given: email-<n> or linkedin-<n>, n from 1 and at most ten digits', async()=>{
        for (const reference of ['email-1', 'linkedin-42', 'email-9999999999', 'email-1001'])
        {
            for (const [fn, suffix] of [[get, ''], [cancel, '/cancel']] as const)
            {
                mock_fetch.mockReset();
                answer(json({...QUEUED, reference}));
                await fn(reference);
                expect(sent()[0].url, reference).toBe(`https://api/v3/direct-sends/${reference}${suffix}`);
            }
        }
    });

    it('refuses any other reference before any call, so a bare 404 always means the route is absent', async()=>{
        const malformed = ['email-0', 'email-01', 'email-12345678901', 'sms-1', 'email-', 'email-1a', ' email-1', 'email-1 ', 'EMAIL-1',
            'email--1', 'linkedin', '.', '..', 'a.b', '...', '.a', ' ..', 'a/b c?d', 'ds_8F2k', 'email-1/cancel', 'email-1\n'];
        for (const reference of malformed)
        {
            for (const fn of [handle_direct_send_get, handle_direct_send_cancel])
            {
                const e = await failure(()=>fn(reference, ctx(), {}));
                expect(e, `${fn.name} ${JSON.stringify(reference)}`).toMatchObject({code: 'usage.reference', exit_code: 2});
                expect((e as Error).message, JSON.stringify(reference)).toContain('email-<n>, linkedin-<n> or linkedin-scheduled-<n>');
            }
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('sends a deferred LinkedIn send\'s reference, linkedin-scheduled-<n>, as given to get and cancel', async()=>{
        for (const reference of ['linkedin-scheduled-1', 'linkedin-scheduled-1042', 'linkedin-scheduled-9999999999'])
        {
            for (const [fn, suffix] of [[get, ''], [cancel, '/cancel']] as const)
            {
                mock_fetch.mockReset();
                answer(json({...QUEUED, channel: 'linkedin', reference}));
                expect((await fn(reference)).reference, reference).toBe(reference);
                expect(sent()[0].url, reference).toBe(`https://api/v3/direct-sends/${reference}${suffix}`);
            }
        }
    });

    it('refuses a malformed scheduled reference before any call, by the same one-spelling rule', async()=>{
        const malformed = ['linkedin-scheduled-0', 'linkedin-scheduled-01', 'linkedin-scheduled-12345678901', 'linkedin-scheduled-',
            'linkedin-scheduled', 'linkedin-scheduled--1', 'linkedin-scheduled-1a', 'LINKEDIN-SCHEDULED-1', 'email-scheduled-1',
            'scheduled-1', 'linkedin-scheduled-scheduled-1', ' linkedin-scheduled-1', 'linkedin-scheduled-1/cancel'];
        for (const reference of malformed)
        {
            for (const fn of [handle_direct_send_get, handle_direct_send_cancel])
            {
                expect(await failure(()=>fn(reference, ctx(), {})), `${fn.name} ${JSON.stringify(reference)}`)
                    .toMatchObject({code: 'usage.reference', exit_code: 2});
            }
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('refuses a blank reference before any call', async()=>{
        for (const blank of ['', '  '])
        {
            expect(await failure(()=>handle_direct_send_get(blank, ctx(), {})), JSON.stringify(blank))
                .toMatchObject({code: 'usage.reference', exit_code: 2});
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('maps Reply\'s two refusals of a read, each under the status Reply publishes it with', async()=>{
        const cases: [Response, string, string | undefined][] = [
            [json({code: 'directSend.notFound', detail: 'Direct send not found.'}, 404), 'direct_send.not_found', 'directSend.notFound'],
            [json({code: 'directSend.notOwned', detail: 'Not yours.'}, 403), 'direct_send.not_owned', 'directSend.notOwned'],
            [json({code: 'directSend.notOwned'}, 404), 'reply.refused', 'directSend.notOwned'],
            [json({code: 'directSend.forbidden'}, 403), 'access.feature_unavailable', 'directSend.forbidden'],
            [json({code: 'directSend.somethingElse'}, 400), 'reply.refused', 'directSend.somethingElse'],
        ];
        for (const [res, code, reply_code] of cases)
        {
            mock_fetch.mockReset();
            answer(res);
            const e = await failure(()=>handle_direct_send_get('email-1001', ctx(), {}));
            expect(e, code).toMatchObject({code, exit_code: 1});
            expect((e as {reply_code?: string}).reply_code, code).toBe(reply_code);
        }
    });

    it('a 404 with no code of Reply\'s own is reply.refused, status 404 and no reply code', async()=>{
        for (const [label, res] of BARE_404)
        {
            mock_fetch.mockReset();
            answer(res());
            const e = await failure(()=>handle_direct_send_get('email-1001', ctx(), {}));
            expect(e, label).toMatchObject({code: 'reply.refused', status: 404, exit_code: 1});
            expect((e as {reply_code?: string}).reply_code, label).toBeUndefined();
        }
    });

    it('an answer without a reference or a state cannot be read, and the read is safe to make again', async()=>{
        for (const body of [{...QUEUED, reference: undefined}, {...QUEUED, state: ''}, [QUEUED], 'ok'])
        {
            mock_fetch.mockReset();
            answer(json(body));
            expect(await failure(()=>handle_direct_send_get('email-1001', ctx(), {})), JSON.stringify(body))
                .toMatchObject({code: 'reply.unavailable', exit_code: 1});
        }
    });
});

describe('direct-send cancel', ()=>{
    it('cancels one send by its reference and answers the send as Reply now holds it', async()=>{
        answer(json(CANCELLED));
        expect(await cancel('email-1001')).toStrictEqual({
            reference: 'email-1001', channel: 'email', contact_id: 456, state: 'cancelled', send_after: '2026-11-03T14:00:00Z',
            sent_at: null, message_id: null, failure_reason: null, cancelled_at: '2026-11-02T09:15:00Z',
        });
        expect(sent()).toEqual([{method: 'POST', url: 'https://api/v3/direct-sends/email-1001/cancel', body: undefined}]);
    });

    it('a cancel of a send already cancelled is a success again, as Reply answers it', async()=>{
        answer(json(CANCELLED), json(CANCELLED));
        expect(await cancel('email-1001')).toMatchObject({state: 'cancelled'});
        expect(await cancel('email-1001')).toMatchObject({state: 'cancelled'});
        expect(mock_fetch).toHaveBeenCalledTimes(2);
    });

    it('maps Reply\'s four refusals of a cancel, each definite', async()=>{
        const cases: [Response, string][] = [
            [json({code: 'directSend.notFound'}, 404), 'direct_send.not_found'],
            [json({code: 'directSend.notOwned'}, 403), 'direct_send.not_owned'],
            [json({code: 'directSend.alreadySent'}, 409), 'direct_send.already_sent'],
            [json({code: 'directSend.alreadyFailed'}, 409), 'direct_send.already_failed'],
            [json({code: 'directSend.alreadySent'}, 400), 'reply.refused'],
        ];
        for (const [res, code] of cases)
        {
            mock_fetch.mockReset();
            answer(res);
            expect(await failure(()=>handle_direct_send_cancel('email-1001', ctx(), {})), code).toMatchObject({code, exit_code: 1});
            expect(mock_fetch, code).toHaveBeenCalledTimes(1);
        }
    });

    it('a 404 with no code of Reply\'s own is reply.refused, status 404 and no reply code', async()=>{
        for (const [label, res] of BARE_404)
        {
            mock_fetch.mockReset();
            answer(res());
            const e = await failure(()=>handle_direct_send_cancel('email-1001', ctx(), {}));
            expect(e, label).toMatchObject({code: 'reply.refused', status: 404, exit_code: 1});
            expect((e as {reply_code?: string}).reply_code, label).toBeUndefined();
        }
    });

    it('an answer that may hide a cancel is outcome.unknown (exit 3), made once, and says running it again is safe', async()=>{
        const answers: [string, ()=>void][] = [
            ['lost answer', ()=>{ mock_fetch.mockRejectedValueOnce(lost_connection()); }],
            ['503', ()=>answer(json({title: 'Service Unavailable'}, 503))],
            ['unreadable 200', ()=>answer(json('<html>ok</html>', 200))],
        ];
        for (const [label, give] of answers)
        {
            mock_fetch.mockReset();
            give();
            const e = await failure(()=>handle_direct_send_cancel('email-1001', ctx(), {}));
            expect(e, label).toMatchObject({code: 'outcome.unknown', exit_code: 3});
            expect((e as {hint?: string}).hint ?? '', label).toContain('running it again is safe');
            expect(mock_fetch, label).toHaveBeenCalledTimes(1);
        }
    });

    it('refuses a blank reference before any call', async()=>{
        expect(await failure(()=>handle_direct_send_cancel(' ', ctx(), {}))).toMatchObject({code: 'usage.reference', exit_code: 2});
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});
