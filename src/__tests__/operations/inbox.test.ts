import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {
    handle_inbox_list, handle_inbox_get, handle_inbox_categories, handle_inbox_categorize, handle_inbox_mark_read, handle_inbox_mark_unread,
} from '../../operations/inbox';

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('inbox list', ()=>{
    it('lists one contact\'s threads, Reply\'s rows as they are', async()=>{
        answer(json({items: [{id: 9, subject: 'Hi'}], hasMore: false}));
        const {out} = await capture(()=>handle_inbox_list({contactId: '456'}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({items: [{id: 9, subject: 'Hi'}], has_more: false});
        expect(sent()[0]).toEqual({method: 'POST', url: 'https://api/v3/inbox/threads/filter?top=20&skip=0',
            body: {contactIds: [456]}});
    });

    it('lists a sequence\'s threads with source and an inclusive --since', async()=>{
        answer(json({items: [], hasMore: false}));
        await capture(()=>handle_inbox_list({sequenceId: '123', source: 'ai-draft', since: '2026-10-01T00:00:00Z', limit: '50'}, ctx(), {}));
        expect(sent()[0].url).toBe('https://api/v3/inbox/threads/filter?top=50&skip=0');
        expect(sent()[0].body).toEqual({sequenceIds: [123], source: 'aiDraft', from: '2026-09-30T23:59:59.999Z'});
    });

    it('needs exactly one of --contact-id and --sequence-id', async()=>{
        for (const opts of [{}, {contactId: '1', sequenceId: '2'}])
        {
            await expect(handle_inbox_list(opts, ctx(), {})).rejects.toMatchObject({code: 'usage.inbox'});
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('refuses a --source Reply has no word for', async()=>{
        await expect(handle_inbox_list({contactId: '1', source: 'all'}, ctx(), {})).rejects.toMatchObject({code: 'usage.choice'});
    });

    it('filters by channel, in Reply\'s spelling, and by category', async()=>{
        answer(json({items: [], hasMore: false}), json({items: [], hasMore: false}));
        await capture(()=>handle_inbox_list({sequenceId: '123', channel: 'linkedin', categoryId: '7'}, ctx(), {}));
        await capture(()=>handle_inbox_list({contactId: '456', channel: 'email'}, ctx(), {}));
        expect(sent().map(r=>r.body)).toEqual([
            {sequenceIds: [123], channels: ['linkedIn'], categoryIds: [7]},
            {contactIds: [456], channels: ['email']},
        ]);
    });

    it('refuses a --channel Reply has no word for, and a --category-id that is not an id', async()=>{
        await expect(handle_inbox_list({contactId: '1', channel: 'sms'}, ctx(), {})).rejects.toMatchObject({code: 'usage.choice'});
        await expect(handle_inbox_list({contactId: '1', categoryId: '0'}, ctx(), {})).rejects.toMatchObject({code: 'usage.id'});
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});

describe('inbox get', ()=>{
    it('prints the thread without its inline history, with the latest email subject, and the asked-for page', async()=>{
        answer(
            json({id: 9, channel: 'email', isRead: false, messages: [
                {channel: 'email', subject: 'Hi', body: 'first'},
                {channel: 'email', subject: 'Re: Hi', body: 'second'},
                {channel: 'linkedIn', body: 'third'},
            ]}),
            json({items: [{messageId: 'm1'}], hasMore: true}),
        );
        const {out} = await capture(()=>handle_inbox_get('9', {}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({
            thread: {id: 9, channel: 'email', isRead: false, subject: 'Re: Hi'},
            messages: {items: [{messageId: 'm1'}], has_more: true},
        });
        expect(sent().map(r=>r.url)).toEqual([
            'https://api/v3/inbox/threads/9',
            'https://api/v3/inbox/threads/9/messages?top=20&skip=0',
        ]);
    });

    it('a thread without email messages has a null subject', async()=>{
        answer(json({id: 9, channel: 'linkedIn', messages: [{channel: 'linkedIn', body: 'hello'}]}), json({items: [], hasMore: false}));
        const {out} = await capture(()=>handle_inbox_get('9', {}, ctx(), {json: true}));
        expect(JSON.parse(out).thread).toEqual({id: 9, channel: 'linkedIn', subject: null});
    });

    it('a 404 is inbox.thread_not_found', async()=>{
        answer(json({code: 'inboxThread.notFound'}, 404));
        await expect(handle_inbox_get('9', {}, ctx(), {})).rejects.toMatchObject({code: 'inbox.thread_not_found'});
    });

    it('--limit over 20 is a usage error', async()=>{
        await expect(handle_inbox_get('9', {limit: '21'}, ctx(), {})).rejects.toMatchObject({code: 'usage.range'});
    });
});

describe('inbox categories', ()=>{
    it('passes Reply\'s categories through, the reserved ones included', async()=>{
        const rows = [
            {id: 1, name: 'Meeting', color: 'green', isReserved: true, unreadThreadsCount: 3},
            {id: 7, name: 'Hot Leads', color: 'red', isReserved: false, unreadThreadsCount: 0},
        ];
        answer(json(rows));
        const {out} = await capture(()=>handle_inbox_categories(ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({items: rows});
        expect(sent()).toEqual([{method: 'GET', url: 'https://api/v3/inbox/threads/categories', body: undefined}]);
    });

    it('an answer that is not a list is reply.unavailable', async()=>{
        answer(json({items: []}));
        await expect(handle_inbox_categories(ctx(), {})).rejects.toMatchObject({code: 'reply.unavailable', exit_code: 1});
    });
});

describe('inbox categorize', ()=>{
    it('files the thread under a category with one absolute PUT', async()=>{
        answer(json(null, 204));
        const {out} = await capture(()=>handle_inbox_categorize('9', {categoryId: '7'}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({status: 'categorized', thread_id: 9, category_id: 7});
        expect(sent()).toEqual([{method: 'PUT', url: 'https://api/v3/inbox/threads/9/category', body: {categoryId: 7}}]);
    });

    it('--clear sends categoryId null, which is how Reply clears it', async()=>{
        answer(json(null, 204));
        const {out} = await capture(()=>handle_inbox_categorize('9', {clear: true}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({status: 'cleared', thread_id: 9, category_id: null});
        const body = sent()[0].body;
        expect(body, `sent ${JSON.stringify(body)}`).toStrictEqual({categoryId: null});
    });

    it('needs exactly one of --category-id and --clear', async()=>{
        for (const opts of [{}, {categoryId: '7', clear: true}])
        {
            await expect(handle_inbox_categorize('9', opts, ctx(), {})).rejects.toMatchObject({code: 'usage.inbox', exit_code: 2});
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('tells a missing thread from a missing category by Reply\'s code', async()=>{
        const cases: [Response, string][] = [
            [json({code: 'inboxThread.notFound'}, 404), 'inbox.thread_not_found'],
            [json({code: 'inboxCategory.notFound'}, 404), 'inbox.category_not_found'],
            [json({title: 'Not Found'}, 404), 'reply.refused'],
        ];
        for (const [res, code] of cases)
        {
            mock_fetch.mockReset();
            answer(res);
            await expect(handle_inbox_categorize('9', {categoryId: '7'}, ctx(), {})).rejects.toMatchObject({code, ids: {thread_id: 9}});
        }
    });

    it('a 503 is outcome.unknown (exit 3), and the PUT is not resent', async()=>{
        answer(json('', 503));
        await expect(handle_inbox_categorize('9', {clear: true}, ctx(), {})).rejects.toMatchObject({code: 'outcome.unknown', exit_code: 3});
        expect(mock_fetch).toHaveBeenCalledTimes(1);
    });
});

describe('inbox mark-read and mark-unread', ()=>{
    it('marks one thread with Reply\'s bulk call; an empty failure dictionary means done', async()=>{
        answer(json({}), json({}));
        const read = await capture(()=>handle_inbox_mark_read('9', ctx(), {json: true}));
        const unread = await capture(()=>handle_inbox_mark_unread('9', ctx(), {json: true}));
        expect(JSON.parse(read.out)).toEqual({status: 'read', thread_id: 9});
        expect(JSON.parse(unread.out)).toEqual({status: 'unread', thread_id: 9});
        expect(sent()).toEqual([
            {method: 'POST', url: 'https://api/v3/inbox/threads/mark-as-read', body: {threadIds: [9]}},
            {method: 'POST', url: 'https://api/v3/inbox/threads/mark-as-unread', body: {threadIds: [9]}},
        ]);
    });

    it('a per-item notFound is inbox.thread_not_found; any other item error is reply.refused with Reply\'s word', async()=>{
        answer(json({'9': {error: 'notFound', errorDetails: 'Inbox thread not found.'}}));
        await expect(handle_inbox_mark_read('9', ctx(), {})).rejects.toMatchObject({code: 'inbox.thread_not_found', ids: {thread_id: 9}});
        answer(json({'9': {error: 'forbidden', errorDetails: null}}));
        await expect(handle_inbox_mark_unread('9', ctx(), {})).rejects.toMatchObject({code: 'reply.refused', reply_code: 'forbidden'});
    });

    it('a 200 that is not a dictionary is outcome.unknown', async()=>{
        answer(json('<html>gateway</html>', 200));
        await expect(handle_inbox_mark_read('9', ctx(), {})).rejects.toMatchObject({code: 'outcome.unknown', exit_code: 3});
    });
});
