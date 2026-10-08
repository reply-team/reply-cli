import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture, instant_timers, real_timers} from './helpers';
import {handle_sequence_get, handle_sequence_contacts, handle_sequence_stats} from '../../operations/sequence-read';

beforeEach(()=>{ mock_fetch.mockReset(); });
afterEach(()=>{ real_timers(); });

describe('sequence get', ()=>{
    it('prints Reply\'s sequence as it is', async()=>{
        const seq = {id: 123, name: 'Q4', status: 'active', isArchived: false, steps: []};
        answer(json(seq));
        const {out} = await capture(()=>handle_sequence_get('123', ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual(seq);
        expect(sent()[0]).toMatchObject({method: 'GET', url: 'https://api/v3/sequences/123'});
    });

    it('a 404 is sequence.not_found with Reply\'s code', async()=>{
        answer(json({code: 'sequence.notFound'}, 404));
        await expect(handle_sequence_get('123', ctx(), {})).rejects.toMatchObject({
            code: 'sequence.not_found', reply_code: 'sequence.notFound', exit_code: 1,
        });
    });

    it('a bad id is a usage error before any call', async()=>{
        await expect(handle_sequence_get('12x', ctx(), {})).rejects.toMatchObject({code: 'usage.id', exit_code: 2});
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});

describe('sequence contacts', ()=>{
    it('prints one page plus the total, with Reply\'s rows as they are', async()=>{
        answer(json({items: [{contactId: 7, statusInSequence: 'active'}], hasMore: true}), json({count: 57}));
        const {out} = await capture(()=>handle_sequence_contacts('123', {}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({items: [{contactId: 7, statusInSequence: 'active'}], has_more: true, total: 57});
        expect(sent().map(r=>r.url)).toEqual([
            'https://api/v3/sequences/123/contacts?top=100&skip=0',
            'https://api/v3/sequences/123/contacts/count',
        ]);
    });

    it('a sequence the count can\'t find is sequence.not_found, even after an empty page', async()=>{
        answer(json({items: [], hasMore: false}), json({code: 'sequenceContact.sequenceNotFound'}, 404));
        await expect(handle_sequence_contacts('123', {}, ctx(), {})).rejects.toMatchObject({code: 'sequence.not_found'});
    });

    it('a count refused for another reason leaves total null', async()=>{
        answer(json({items: [], hasMore: false}), json({code: 'sequenceContact.forbidden'}, 403));
        const {out} = await capture(()=>handle_sequence_contacts('123', {limit: '5', offset: '10'}, ctx(), {json: true}));
        expect(JSON.parse(out).total).toBeNull();
        expect(sent()[0].url).toBe('https://api/v3/sequences/123/contacts?top=5&skip=10');
    });
});

describe('sequence stats', ()=>{
    it('asks with a preset in Reply\'s words and prints Reply\'s object', async()=>{
        answer(json({emailOverview: {contacted: 3}, linkedInOverview: {}}));
        const {out} = await capture(()=>handle_sequence_stats('123', {preset: 'last-month'}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({emailOverview: {contacted: 3}, linkedInOverview: {}});
        expect(sent()[0]).toEqual({method: 'POST', url: 'https://api/v3/sequences/123/stats',
            body: {filters: {dateRangePreset: 'lastMonth'}}});
    });

    it('asks with a span as ISO dates', async()=>{
        answer(json({emailOverview: {}}));
        await capture(()=>handle_sequence_stats('123', {from: '2026-09-01', to: '2026-10-01'}, ctx(), {}));
        expect(sent()[0].body).toEqual({filters: {from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z'}});
    });

    it('needs a preset or both ends of a span, not both and not neither', async()=>{
        for (const opts of [{}, {preset: 'last-week', from: '2026-09-01'}, {from: '2026-09-01'}])
        {
            await expect(handle_sequence_stats('123', opts, ctx(), {})).rejects.toMatchObject({code: 'usage.stats'});
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('is a read: a 503 is asked again', async()=>{
        instant_timers();
        answer(json('', 503), json({emailOverview: {}}));
        await capture(()=>handle_sequence_stats('123', {preset: 'all-time'}, ctx(), {}));
        expect(mock_fetch).toHaveBeenCalledTimes(2);
    });
});
