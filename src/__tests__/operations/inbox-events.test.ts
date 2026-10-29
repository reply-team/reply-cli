import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_inbox_events} from '../../operations/inbox';

beforeEach(()=>{ mock_fetch.mockReset(); });

const EVENT = {
    threadId: 9876, contactId: 456, channel: 'email', lastActivityDate: '2026-11-03T14:02:11Z', sequenceId: 12,
    category: 'interested', hasMeetingIntent: false, newFieldReplyAdds: 'kept',
    flags: {hasReply: true, hasBounce: false, hasAutoReply: false, hasOutOfOffice: false},
    lastMessage: {messageId: '<m-1@example.com>', isOutbound: false, date: '2026-11-03T14:02:11Z'},
};

type Opts = {cursor?: string; since?: string; top?: string};
const events = async(opts: Opts = {})=>JSON.parse((await capture(()=>handle_inbox_events(opts, ctx(), {json: true}))).out);
const failure = (opts: Opts)=>handle_inbox_events(opts, ctx(), {}).catch((x: unknown)=>x);

// How Reply's API document publishes a cursor it will not read: a validation problem with no code, pointing at /cursor.
const CURSOR_TOO_OLD = {
    title: 'Validation failed', status: 400, detail: 'The request body contains validation errors.',
    errors: [{pointer: '/cursor', detail: '\'cursor\' is older than 30 days. Start again with \'since\' (at most 30 days ago) or with no parameters, which reads the last 30 days.'}],
};
const problem = (body: unknown, status: number)=>json(body, status, {'Content-Type': 'application/problem+json'});

describe('inbox events', ()=>{
    it('reads one page of the feed and passes the items on as Reply gives them, under has_more and cursor', async()=>{
        answer(json({items: [EVENT], hasMore: true, cursor: 'AQjfObhYHZgAAADjVg'}));
        expect(await events()).toStrictEqual({items: [EVENT], has_more: true, cursor: 'AQjfObhYHZgAAADjVg'});
        expect(sent()).toEqual([{method: 'GET', url: 'https://api/v3/inbox/events', body: undefined}]);
    });

    it('an empty page keeps the cursor Reply gives with it, so the next read goes on from there', async()=>{
        answer(json({items: [], hasMore: false, cursor: 'AQjfObkJcH4Af____w'}));
        expect(await events({cursor: 'AQjfObhYHZgAAADjVg'})).toStrictEqual({items: [], has_more: false, cursor: 'AQjfObkJcH4Af____w'});
    });

    it('sends the cursor as given and encoded, --since in UTC and not shifted, and --top only when given', async()=>{
        const cases: [Opts, string][] = [
            [{cursor: 'AQjf+b/Y=='}, 'cursor=AQjf%2Bb%2FY%3D%3D'],
            [{since: '2026-11-03T16:00:00+02:00'}, 'since=2026-11-03T14%3A00%3A00.000Z'],
            [{since: '2026-11-03T14:00:00Z', top: '1000'}, 'since=2026-11-03T14%3A00%3A00.000Z&top=1000'],
            [{top: '1'}, 'top=1'],
        ];
        for (const [opts, query] of cases)
        {
            mock_fetch.mockReset();
            answer(json({items: [], hasMore: false, cursor: 'c'}));
            await events(opts);
            expect(sent()[0].url, query).toBe(`https://api/v3/inbox/events?${query}`);
        }
    });

    it('refuses --cursor with --since, a blank cursor, a moment without its offset and a --top out of range, before any call', async()=>{
        const cases: [Opts, string][] = [
            [{cursor: 'AQjfObhYHZgAAADjVg', since: '2026-11-03T14:00:00Z'}, 'usage.inbox'],
            [{cursor: ' '}, 'usage.inbox'],
            [{since: '2026-11-03T14:00:00'}, 'usage.date'],
            [{since: '2026-11-03'}, 'usage.date'],
            [{top: '0'}, 'usage.range'],
            [{top: '1001'}, 'usage.range'],
        ];
        for (const [opts, code] of cases)
        {
            expect(await failure(opts), JSON.stringify(opts)).toMatchObject({code, exit_code: 2});
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('a cursor Reply will not read is inbox.cursor_refused, which says to start again with --since', async()=>{
        answer(problem(CURSOR_TOO_OLD, 400));
        const e = await failure({cursor: 'AQjfObhYHZgAAADjVg'});
        expect(e).toMatchObject({code: 'inbox.cursor_refused', status: 400, exit_code: 1, details: {fields: ['cursor']}});
        expect((e as {reply_code?: string}).reply_code).toBeUndefined();
        expect((e as {hint?: string}).hint).toContain('--since');
    });

    it('any other refusal maps as everywhere else', async()=>{
        const cases: [Opts, Response, string][] = [
            // The same pointer when no cursor was sent is not about one the caller holds.
            [{since: '2026-11-03T14:00:00Z'}, problem(CURSOR_TOO_OLD, 400), 'reply.invalid_request'],
            [{since: '2026-09-01T00:00:00Z'}, problem({title: 'Validation failed', status: 400, errors: [{pointer: '/since', detail: 'too old'}]}, 400),
                'reply.invalid_request'],
            [{cursor: 'c'}, problem({code: 'inboxThread.invalidPagination', status: 400}, 400), 'reply.refused'],
            [{}, problem({code: 'inboxThread.forbidden', status: 403}, 403), 'access.feature_unavailable'],
            [{}, new Response(null, {status: 404}), 'reply.refused'],
            [{}, problem({title: 'Not Found', status: 404}, 404), 'reply.refused'],
        ];
        for (const [opts, res, code] of cases)
        {
            mock_fetch.mockReset();
            answer(res);
            expect(await failure(opts), `${JSON.stringify(opts)} ${code}`).toMatchObject({code, exit_code: 1});
        }
    });

    it('a 404 with no code of Reply\'s own, from a Reply without the feed, is reply.refused with status 404 and no reply code', async()=>{
        answer(new Response(null, {status: 404}));
        const e = await failure({});
        expect(e).toMatchObject({code: 'reply.refused', status: 404});
        expect((e as {reply_code?: string}).reply_code).toBeUndefined();
    });

    it('a page without its items, has_more or cursor cannot be read, and the read is safe to make again', async()=>{
        for (const body of [{items: [], hasMore: false}, {items: [], cursor: 'c'}, {items: {}, hasMore: false, cursor: 'c'},
            {items: [], hasMore: 'no', cursor: 'c'}, {items: [], hasMore: false, cursor: 7}, [EVENT]])
        {
            mock_fetch.mockReset();
            answer(json(body));
            expect(await failure({}), JSON.stringify(body)).toMatchObject({code: 'reply.unavailable', exit_code: 1});
        }
    });
});
