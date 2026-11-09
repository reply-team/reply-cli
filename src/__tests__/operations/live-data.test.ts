import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {
    handle_live_data_get, handle_live_data_list, handle_live_data_start, handle_live_data_pause, handle_live_data_resume, handle_live_data_delete,
    handle_live_data_filter_values,
} from '../../operations/live-data';

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('live-data get', ()=>{
    it('prints Reply\'s search as it is', async()=>{
        const search = {id: 901, status: 'inProgress', contactsFound: 3, lists: [{id: 77, name: 'L'}], filters: {}};
        answer(json(search));
        const {out} = await capture(()=>handle_live_data_get('901', ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual(search);
        expect(sent()[0]).toMatchObject({method: 'GET', url: 'https://api/v3/live-data/searches/901'});
    });

    it('a 404 is live_data.not_found', async()=>{
        answer(json({code: 'liveDataSearch.notFound'}, 404));
        await expect(handle_live_data_get('901', ctx(), {})).rejects.toMatchObject({
            code: 'live_data.not_found', reply_code: 'liveDataSearch.notFound', exit_code: 1,
        });
    });
});

describe('live-data list', ()=>{
    it('prints one page newest first as Reply gives it', async()=>{
        answer(json({items: [{id: 2}, {id: 1}], hasMore: true}));
        const {out} = await capture(()=>handle_live_data_list({limit: '50', offset: '100'}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({items: [{id: 2}, {id: 1}], has_more: true});
        expect(sent()[0].url).toBe('https://api/v3/live-data/searches?top=50&skip=100');
    });

    it('defaults to 100 from the start', async()=>{
        answer(json({items: [], hasMore: false}));
        await capture(()=>handle_live_data_list({}, ctx(), {json: true}));
        expect(sent()[0].url).toBe('https://api/v3/live-data/searches?top=100&skip=0');
    });
});

describe('live-data start', ()=>{
    const FILTERS = '{"jobTitles":[{"value":"CTO","type":"include"}],"accountKeywords":{"values":[],"type":"or"}}';
    const start = (opts: Record<string, unknown>)=>handle_live_data_start({filters: FILTERS, count: '25', ...opts}, ctx(), {json: true});

    it('sends the filters untouched with the count, lists, people per company and phones, and answers started', async()=>{
        answer(json({searchId: 901}));
        const {out} = await capture(()=>start({listId: ['77', '78'], maxPerCompany: '2', withPhones: true}));
        expect(JSON.parse(out)).toEqual({status: 'started', search_id: 901});
        expect(sent()[0]).toEqual({method: 'POST', url: 'https://api/v3/live-data/searches', body: {
            filters: JSON.parse(FILTERS), contactsCountToAdd: 25, listIds: [77, 78], maxPeoplePerCompany: 2, searchContactPhones: true,
        }});
    });

    it('leaves out what was not given', async()=>{
        answer(json({searchId: 901}));
        await capture(()=>start({}));
        expect(sent()[0].body).toEqual({filters: JSON.parse(FILTERS), contactsCountToAdd: 25});
    });

    it('a 409 is live_data.search_in_progress with Reply\'s words', async()=>{
        answer(json({code: 'liveDataSearch.searchInProgress', detail: 'A live data search is already in progress.'}, 409));
        await expect(start({})).rejects.toMatchObject({
            code: 'live_data.search_in_progress', detail: 'A live data search is already in progress.', exit_code: 1,
        });
    });

    it('a 422 is live_data.insufficient_credits', async()=>{
        answer(json({code: 'liveDataSearch.insufficientCredits'}, 422));
        await expect(start({})).rejects.toMatchObject({code: 'live_data.insufficient_credits', exit_code: 1});
    });

    it('a 400 invalidParameter is live_data.invalid_filters', async()=>{
        answer(json({code: 'liveDataSearch.invalidParameter', detail: 'Filters are invalid.'}, 400));
        await expect(start({})).rejects.toMatchObject({code: 'live_data.invalid_filters', detail: 'Filters are invalid.'});
    });

    it('Reply\'s 502 upstreamFailure is live_data.service_failed, exit 1, not an unknown outcome', async()=>{
        answer(json({code: 'liveDataSearch.upstreamFailure'}, 502));
        await expect(start({})).rejects.toMatchObject({code: 'live_data.service_failed', exit_code: 1});
    });

    it('a 502 without Reply\'s code is outcome.unknown', async()=>{
        answer(json('bad gateway', 502));
        await expect(start({})).rejects.toMatchObject({code: 'outcome.unknown', exit_code: 3});
    });

    it('a 200 without a searchId is outcome.unknown', async()=>{
        answer(json({}));
        await expect(start({})).rejects.toMatchObject({code: 'outcome.unknown', exit_code: 3});
    });

    it('filters that are not a JSON object are usage.filters before any call', async()=>{
        await expect(start({filters: '[]'})).rejects.toMatchObject({code: 'usage.filters', exit_code: 2});
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('a missing or bad --count is a usage error before any call', async()=>{
        await expect(start({count: '0'})).rejects.toMatchObject({exit_code: 2});
        await expect(start({count: undefined})).rejects.toMatchObject({exit_code: 2});
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});

describe('live-data pause', ()=>{
    it('answers paused', async()=>{
        answer(json({id: 901, status: 'manuallyPaused'}));
        const {out} = await capture(()=>handle_live_data_pause('901', ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({status: 'paused', search_id: 901});
        expect(sent()[0]).toMatchObject({method: 'POST', url: 'https://api/v3/live-data/searches/901/pause'});
    });

    it('a 409 passes Reply\'s words on as live_data.invalid_status', async()=>{
        const detail = 'The search is pausedDueToInsufficientCredits; pause applies to inProgress searches only.';
        answer(json({code: 'liveDataSearch.invalidStatus', detail}, 409));
        await expect(handle_live_data_pause('901', ctx(), {})).rejects.toMatchObject({
            code: 'live_data.invalid_status', detail, ids: {search_id: 901}, exit_code: 1,
        });
        expect(mock_fetch).toHaveBeenCalledTimes(1);
    });
});

describe('live-data resume', ()=>{
    it('answers resumed, or finished when Reply finished it', async()=>{
        answer(json({id: 901, status: 'inProgress'}), json({id: 902, status: 'finished'}));
        const resumed = await capture(()=>handle_live_data_resume('901', ctx(), {json: true}));
        const finished = await capture(()=>handle_live_data_resume('902', ctx(), {json: true}));
        expect(JSON.parse(resumed.out)).toEqual({status: 'resumed', search_id: 901});
        expect(JSON.parse(finished.out)).toEqual({status: 'finished', search_id: 902});
        expect(sent()[0]).toMatchObject({method: 'POST', url: 'https://api/v3/live-data/searches/901/resume'});
    });

    it('a 422 is live_data.insufficient_credits or live_data.contact_limit_reached by Reply\'s code; Reply\'s 502 upstreamFailure is live_data.service_failed', async()=>{
        answer(json({code: 'liveDataSearch.insufficientCredits'}, 422), json({code: 'liveDataSearch.contactLimitReached'}, 422),
            json({code: 'liveDataSearch.upstreamFailure'}, 502));
        await expect(handle_live_data_resume('901', ctx(), {})).rejects.toMatchObject({code: 'live_data.insufficient_credits', ids: {search_id: 901}});
        await expect(handle_live_data_resume('901', ctx(), {})).rejects.toMatchObject({code: 'live_data.contact_limit_reached', exit_code: 1});
        await expect(handle_live_data_resume('901', ctx(), {})).rejects.toMatchObject({code: 'live_data.service_failed', exit_code: 1});
    });
});

describe('live-data delete', ()=>{
    it('answers deleted', async()=>{
        answer(json(null, 204));
        const {out} = await capture(()=>handle_live_data_delete('901', ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({status: 'deleted', search_id: 901});
        expect(sent()[0]).toMatchObject({method: 'DELETE', url: 'https://api/v3/live-data/searches/901'});
    });

    it('a 404 is live_data.not_found', async()=>{
        answer(json({code: 'liveDataSearch.notFound'}, 404));
        await expect(handle_live_data_delete('901', ctx(), {})).rejects.toMatchObject({code: 'live_data.not_found', ids: {search_id: 901}});
    });

    it('a lost answer is outcome.unknown whose hint says a repeat answers live_data.not_found if it went through', async()=>{
        answer(json('bad gateway', 502));
        await expect(handle_live_data_delete('901', ctx(), {})).rejects.toMatchObject({
            code: 'outcome.unknown', exit_code: 3, ids: {search_id: 901}, hint: expect.stringContaining('live_data.not_found'),
        });
    });
});

describe('live-data filter-values', ()=>{
    it('reads one page of a kind with the search text', async()=>{
        answer(json({items: ['CTO'], hasMore: false}));
        const {out} = await capture(()=>handle_live_data_filter_values('job-titles', {search: 'chief tech', limit: '20'}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({items: ['CTO'], has_more: false});
        expect(sent()[0]).toMatchObject({method: 'GET', url: 'https://api/v3/live-data/filter-values/job-titles?search=chief%20tech&top=20&skip=0'});
    });

    it('an unknown kind is usage.choice before any call', async()=>{
        await expect(handle_live_data_filter_values('titles', {}, ctx(), {})).rejects.toMatchObject({code: 'usage.choice', exit_code: 2});
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});
