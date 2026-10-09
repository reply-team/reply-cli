import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_sequence_pause, handle_sequence_start} from '../../operations/sequence-state';

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('sequence pause', ()=>{
    it('pauses with one call', async()=>{
        answer(json({id: 123, status: 'paused'}));
        const {out} = await capture(()=>handle_sequence_pause('123', ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({status: 'paused', sequence_id: 123});
        expect(sent()).toEqual([{method: 'POST', url: 'https://api/v3/sequences/123/pause', body: undefined}]);
    });

    it('a 200 whose body is not a sequence is outcome.unknown, never a false "paused"', async()=>{
        answer(json('<html>gateway</html>', 200));
        await expect(handle_sequence_pause('123', ctx(), {})).rejects.toMatchObject({code: 'outcome.unknown', exit_code: 3});
    });

    it('maps Reply\'s refusals', async()=>{
        const cases: [Response, string][] = [
            [json({code: 'sequenceAction.status', detail: 'current status is New'}, 409), 'sequence.not_pausable'],
            [json({code: 'sequenceAction.archived'}, 409), 'sequence.archived'],
            [json({code: 'sequenceAction.activationInProgress'}, 409), 'sequence.busy'],
            [json({code: 'sequenceAction.notFound'}, 404), 'sequence.not_found'],
            [json('', 502), 'outcome.unknown'],
        ];
        for (const [res, code] of cases)
        {
            mock_fetch.mockReset();
            answer(res);
            await expect(handle_sequence_pause('123', ctx(), {})).rejects.toMatchObject({code, ids: {sequence_id: 123}});
        }
    });
});

describe('sequence start', ()=>{
    it('without --expect-contacts: one call, started', async()=>{
        answer(json({id: 123, status: 'active'}));
        const {out} = await capture(()=>handle_sequence_start('123', {}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({status: 'started', sequence_id: 123, previous_status: null, contacts: null});
        expect(mock_fetch).toHaveBeenCalledTimes(1);
    });

    it('with --expect-contacts matching: read, count, start', async()=>{
        answer(json({id: 123, status: 'paused', isArchived: false}), json({count: 12}), json({id: 123, status: 'active'}));
        const {out} = await capture(()=>handle_sequence_start('123', {expectContacts: '12'}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({status: 'started', sequence_id: 123, previous_status: 'paused', contacts: 12});
        expect(sent().map(r=>`${r.method} ${r.url}`)).toEqual([
            'GET https://api/v3/sequences/123',
            'GET https://api/v3/sequences/123/contacts/count',
            'POST https://api/v3/sequences/123/start',
        ]);
    });

    it('with --expect-contacts, a first start reports that the sequence was new', async()=>{
        answer(json({id: 123, status: 'new', isArchived: false}), json({count: 3}), json({id: 123, status: 'active'}));
        const {out} = await capture(()=>handle_sequence_start('123', {expectContacts: '3'}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({status: 'started', sequence_id: 123, previous_status: 'new', contacts: 3});
    });

    it('a sequence read without a status reports previous_status null', async()=>{
        answer(json({id: 123, isArchived: false}), json({count: 3}), json({id: 123, status: 'active'}));
        const {out} = await capture(()=>handle_sequence_start('123', {expectContacts: '3'}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({status: 'started', sequence_id: 123, previous_status: null, contacts: 3});
    });

    it('a count that moved refuses, and starts nothing', async()=>{
        answer(json({id: 123, status: 'new', isArchived: false}), json({count: 14}));
        await expect(handle_sequence_start('123', {expectContacts: '12'}, ctx(), {})).rejects.toMatchObject({
            code: 'sequence.contact_count_changed', details: {expected: 12, actual: 14},
        });
        expect(mock_fetch).toHaveBeenCalledTimes(2);
    });

    it('already active with --expect-contacts: already_active, no count check, no start', async()=>{
        answer(json({id: 123, status: 'active', isArchived: false}), json({count: 99}));
        const {out} = await capture(()=>handle_sequence_start('123', {expectContacts: '12'}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({status: 'already_active', sequence_id: 123, previous_status: 'active', contacts: 99});
        expect(sent().map(r=>r.method)).toEqual(['GET', 'GET']);
    });

    it('a 200 start whose body is not a sequence is outcome.unknown, never a false "started"', async()=>{
        answer(json('<html>gateway</html>', 200));
        await expect(handle_sequence_start('123', {}, ctx(), {})).rejects.toMatchObject({code: 'outcome.unknown', exit_code: 3});
    });

    it('already active: already_active even when the count can\'t be read', async()=>{
        answer(json({id: 123, status: 'active', isArchived: false}), json({code: 'sequenceContact.forbidden'}, 403));
        const {out} = await capture(()=>handle_sequence_start('123', {expectContacts: '12'}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({status: 'already_active', sequence_id: 123, previous_status: 'active', contacts: null});
    });

    it('a count the guard needs but Reply rate-limits is rate_limited with retry_after, and nothing starts', async()=>{
        answer(json({id: 123, status: 'paused', isArchived: false}), json({title: 'Too Many Requests'}, 429, {'Retry-After': '30'}));
        await expect(handle_sequence_start('123', {expectContacts: '12'}, ctx(), {})).rejects.toMatchObject({
            code: 'rate_limited', retry_after: 30, status: 429,
        });
        expect(mock_fetch).toHaveBeenCalledTimes(2);
    });

    it('maps the start\'s refusals, with Reply\'s detail', async()=>{
        answer(json({code: 'sequenceAction.unknown', detail: 'Cannot start a sequence without selected email account'}, 400));
        await expect(handle_sequence_start('123', {}, ctx(), {})).rejects.toMatchObject({
            code: 'sequence.not_startable', detail: 'Cannot start a sequence without selected email account',
        });
    });

    it('an archived sequence is sequence.archived', async()=>{
        answer(json({id: 123, status: 'paused', isArchived: true}));
        await expect(handle_sequence_start('123', {expectContacts: '1'}, ctx(), {})).rejects.toMatchObject({code: 'sequence.archived'});
    });
});
