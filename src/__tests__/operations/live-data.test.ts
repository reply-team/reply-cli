import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture, lost_connection} from './helpers';
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

    it('a 404 names no search, so it is Reply\'s refusal and not live_data.not_found', async()=>{
        answer(json({code: 'liveDataSearch.notFound'}, 404));
        await expect(handle_live_data_list({}, ctx(), {})).rejects.toMatchObject({code: 'reply.refused', status: 404});
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

    it('Reply\'s 502 upstreamFailure is live_data.service_failed, exit 1, not an unknown outcome; a Live Data code at a '
        + 'status Reply does not answer it with is read by its status', async()=>{
        answer(json({code: 'liveDataSearch.upstreamFailure'}, 502), json({code: 'liveDataSearch.searchInProgress'}, 500));
        await expect(start({})).rejects.toMatchObject({code: 'live_data.service_failed', exit_code: 1});
        await expect(start({})).rejects.toMatchObject({code: 'outcome.unknown', exit_code: 3});
    });

    it('a 404 is contact-list.not_found with Reply\'s detail naming the list, not a search that does not exist', async()=>{
        answer(json({code: 'liveDataSearch.notFound', detail: 'List(s) not found or not accessible: 78.'}, 404));
        await expect(start({listId: ['77', '78']})).rejects.toMatchObject({
            code: 'contact-list.not_found', detail: 'List(s) not found or not accessible: 78.', exit_code: 1,
        });
    });

    it('a 5xx without Reply\'s code, a lost answer, or a 2xx without a searchId is outcome.unknown (exit 3), posted once, and the '
        + 'hint sends the reader to live-data list instead of saying a repeat is safe', async()=>{
        for (const outcome of [()=>json('bad gateway', 502), ()=>json({}), 'lost'] as const)
        {
            mock_fetch.mockReset();
            if (outcome === 'lost')
            {
                mock_fetch.mockRejectedValueOnce(lost_connection());
            }
            else
            {
                answer(outcome());
            }
            const e = await start({}).catch(x=>x);
            expect(e, String(outcome)).toMatchObject({code: 'outcome.unknown', exit_code: 3});
            expect(e.hint, String(outcome)).toContain('live-data list');
            expect(e.hint, String(outcome)).not.toContain('safe to re-run');
            expect(mock_fetch, String(outcome)).toHaveBeenCalledTimes(1);
        }
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
    it('answers resumed for a running search, finished with Reply\'s status for an ended one, and any other status is '
        + 'outcome.unknown', async()=>{
        answer(json({id: 901, status: 'inProgress'}), json({id: 902, status: 'finished'}), json({id: 903, status: 'noMoreContacts'}),
            json({id: 904, status: 'manuallyPaused'}));
        const resumed = await capture(()=>handle_live_data_resume('901', ctx(), {json: true}));
        const finished = await capture(()=>handle_live_data_resume('902', ctx(), {json: true}));
        const ran_out = await capture(()=>handle_live_data_resume('903', ctx(), {json: true}));
        expect(JSON.parse(resumed.out)).toEqual({status: 'resumed', search_id: 901});
        expect(JSON.parse(finished.out)).toEqual({status: 'finished', search_id: 902, search_status: 'finished'});
        expect(JSON.parse(ran_out.out)).toEqual({status: 'finished', search_id: 903, search_status: 'noMoreContacts'});
        await expect(handle_live_data_resume('904', ctx(), {})).rejects.toMatchObject({
            code: 'outcome.unknown', exit_code: 3, ids: {search_id: 904},
        });
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
