import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mock_fetch, json, ctx, answer, capture, instant_timers, real_timers} from './helpers';
import {
    open_session, call_reply, expect_object, read_page, item_failure, refusal, unreadable, type Answer,
} from '../../operations/call';
import {print_result, with_ids} from '../../operations/result';
import {Operation_error, Unknown_outcome_error} from '../../utils/errors';

const a = (status: number, data: unknown, headers: Record<string, string> = {}): Answer=>({status, data, headers});

beforeEach(()=>{ mock_fetch.mockReset(); });
afterEach(()=>{ real_timers(); });

describe('operations/call', ()=>{
    it('call_reply returns any HTTP status as an Answer', async()=>{
        answer(json({code: 'x.notFound'}, 404));
        const s = await open_session(ctx(), {});
        expect(await call_reply(s, 'GET', '/v3/x', 'read')).toMatchObject({status: 404, data: {code: 'x.notFound'}});
    });

    it('call_reply turns an unreachable Reply into reply.unavailable (nothing happened)', async()=>{
        instant_timers();
        mock_fetch.mockRejectedValue(new TypeError('fetch failed'));
        const s = await open_session(ctx(), {});
        await expect(call_reply(s, 'GET', '/v3/x', 'read')).rejects.toMatchObject({code: 'reply.unavailable', exit_code: 1});
    });

    it('call_reply lets a write\'s lost answer through as outcome.unknown', async()=>{
        mock_fetch.mockRejectedValue(Object.assign(new TypeError('fetch failed'),
            {cause: Object.assign(new Error('ECONNRESET'), {code: 'ECONNRESET'})}));
        const s = await open_session(ctx(), {});
        await expect(call_reply(s, 'POST', '/v3/x', 'write', {})).rejects.toBeInstanceOf(Unknown_outcome_error);
    });

    it('expect_object: a body that is not an object is unreadable, which on a write means outcome.unknown', ()=>{
        expect(()=>expect_object(a(200, '<html>proxy</html>'), 'write')).toThrow(Unknown_outcome_error);
        expect(()=>expect_object(a(200, null), 'write')).toThrow(Unknown_outcome_error);
        let read_error: unknown;
        try { expect_object(a(200, [1]), 'read'); } catch (e) { read_error = e; }
        expect(read_error).toMatchObject({code: 'reply.unavailable'});
        expect(unreadable(a(200, null), 'read')).not.toBeInstanceOf(Unknown_outcome_error);
    });

    it('read_page reads {items, hasMore} and refuses anything else', ()=>{
        expect(read_page(a(200, {items: [1], hasMore: true}))).toEqual({items: [1], has_more: true});
        expect(()=>read_page(a(200, {items: [1]}))).toThrow(Operation_error);
    });

    it('item_failure finds one contact in a per-item failure dictionary', ()=>{
        const dict = {'456': {error: 'invalidInput', errorDetails: 'Contact could not be added to sequence'}};
        expect(item_failure(dict, 456)).toEqual({error: 'invalidInput', details: 'Contact could not be added to sequence'});
        expect(item_failure(dict, 457)).toBeUndefined();
        expect(item_failure({}, 456)).toBeUndefined();
    });

    it('refusal maps the statuses every operation shares', ()=>{
        expect(refusal(a(401, ''), 'read').code).toBe('access.denied');
        expect(refusal(a(403, {status: 403, title: 'Forbidden', reasons: []}), 'read').code).toBe('access.feature_unavailable');
        expect(refusal(a(403, {code: 'sequenceStats.forbidden'}), 'read').code).toBe('access.feature_unavailable');
        expect(refusal(a(403, {code: 'TEAM_REQUIRED', teams: []}), 'read').code).toBe('access.denied');
        const limited = refusal(a(429, {title: 'Too Many Requests'}, {'retry-after': '42'}), 'write');
        expect(limited).toMatchObject({code: 'rate_limited', retry_after: 42, exit_code: 1});
        expect(refusal(a(502, ''), 'read')).toMatchObject({code: 'reply.unavailable', exit_code: 1});
        expect(refusal(a(502, ''), 'write')).toMatchObject({code: 'outcome.unknown', exit_code: 3});
        expect(refusal(a(400, {code: 'x.bad', detail: 'nope'}), 'write'))
            .toMatchObject({code: 'reply.refused', status: 400, reply_code: 'x.bad', detail: 'nope'});
    });

    it('refusal tells a validation problem from a business refusal, naming the fields but never their values', ()=>{
        const problem = {
            title: 'Validation failed', detail: 'The request body contains validation errors.',
            errors: [
                {pointer: '/items/0/firstName', detail: 'too long'},
                {pointer: '/items/0/company', detail: 'too long'},
                {pointer: '/items/1/firstName', detail: 'too long'},
            ],
        };
        expect(refusal(a(400, problem), 'write')).toMatchObject({
            code: 'reply.invalid_request', status: 400, exit_code: 1, details: {fields: ['firstName', 'company']},
        });
        expect(refusal(a(400, {code: 'x.bad', errors: []}), 'write').code).toBe('reply.refused');
    });

    it('refusal never calls a 2xx a definite failure: on a write it is outcome.unknown', ()=>{
        expect(refusal(a(204, null), 'write')).toMatchObject({code: 'outcome.unknown', exit_code: 3});
        expect(refusal(a(202, null), 'read')).toMatchObject({code: 'reply.unavailable', exit_code: 1});
    });

    it('print_result prints indented JSON by default and compact JSON with --json', async()=>{
        const indented = await capture(async()=>{ print_result({a: 1}, {}); });
        expect(indented.out).toBe('{\n  "a": 1\n}');
        const compact = await capture(async()=>{ print_result({a: 1}, {json: true}); });
        expect(compact.out).toBe('{"a":1}');
    });

    it('with_ids adds what was learned without overwriting what the error already says', ()=>{
        const e = new Operation_error('x', 'y', {ids: {contact_id: 9}});
        with_ids(e, {sequence_id: 1, contact_id: 2});
        expect(e.ids).toEqual({sequence_id: 1, contact_id: 9});
    });
});
