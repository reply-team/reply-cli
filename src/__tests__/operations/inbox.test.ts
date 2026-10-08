import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_inbox_list, handle_inbox_get} from '../../operations/inbox';

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
});

describe('inbox get', ()=>{
    it('prints Reply\'s thread as it is, inline history included, and the asked-for page of messages', async()=>{
        answer(
            json({id: 9, channel: 'email', messages: [{subject: 'Hi', body: 'whole history'}]}),
            json({items: [{messageId: 'm1'}], hasMore: true}),
        );
        const {out} = await capture(()=>handle_inbox_get('9', {}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({
            thread: {id: 9, channel: 'email', messages: [{subject: 'Hi', body: 'whole history'}]},
            messages: {items: [{messageId: 'm1'}], has_more: true},
        });
        expect(sent().map(r=>r.url)).toEqual([
            'https://api/v3/inbox/threads/9',
            'https://api/v3/inbox/threads/9/messages?top=20&skip=0',
        ]);
    });

    it('a 404 is inbox.thread_not_found', async()=>{
        answer(json({code: 'inboxThread.notFound'}, 404));
        await expect(handle_inbox_get('9', {}, ctx(), {})).rejects.toMatchObject({code: 'inbox.thread_not_found'});
    });

    it('--limit over 20 is a usage error', async()=>{
        await expect(handle_inbox_get('9', {limit: '21'}, ctx(), {})).rejects.toMatchObject({code: 'usage.range'});
    });
});
