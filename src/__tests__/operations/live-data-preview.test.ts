import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture, instant_timers, real_timers, lost_connection} from './helpers';
import {handle_live_data_preview} from '../../operations/live-data-preview';

const J = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const FILTERS = '{"jobTitles":[{"value":"CTO","type":"include"}]}';
const job = (status: string, extra: Record<string, unknown> = {})=>json({jobId: J, status, ...extra});
const preview = (opts: Record<string, unknown>)=>handle_live_data_preview(opts, ctx(), {json: true});

beforeEach(()=>{
    mock_fetch.mockReset();
    instant_timers();
});
afterEach(()=>{ real_timers(); });

describe('live-data preview', ()=>{
    it('starts, waits for the job and answers the counts and the samples in the CLI\'s names', async()=>{
        answer(json({jobId: J}, 202), job('Processing', {progress: 0.5}), job('Done', {jsonDataResult: JSON.stringify({
            ContactsCount: 1200, CompaniesCount: 300, SampleContacts: [{
                FirstName: 'Ann', LastName: 'Example', JobTitle: 'CTO', Location: 'Berlin',
                LinkedInUrl: 'https://www.linkedin.com/in/ann-example', CompanyName: 'Example GmbH', CompanyDomain: 'example.com',
            }],
        })}));
        const {out} = await capture(()=>preview({filters: FILTERS}));
        expect(JSON.parse(out)).toEqual({status: 'done', job_id: J, contacts_count: 1200, companies_count: 300, sample_contacts: [{
            first_name: 'Ann', last_name: 'Example', job_title: 'CTO', location: 'Berlin',
            linkedin_url: 'https://www.linkedin.com/in/ann-example', company_name: 'Example GmbH', company_domain: 'example.com',
        }]});
        expect(sent()[0]).toEqual({method: 'POST', url: 'https://api/v3/live-data/searches/preview', body: {filters: JSON.parse(FILTERS)}});
        expect(sent()[1]).toMatchObject({method: 'GET', url: `https://api/v3/background-jobs/${J}`});
    });

    it('answers pending with the job id when the wait runs out', async()=>{
        answer(json({jobId: J}, 202), job('Processing', {progress: 0.2}), job('Processing', {progress: 0.2}), job('Processing', {progress: 0.2}));
        const {out} = await capture(()=>preview({filters: FILTERS, waitSeconds: '4'}));
        expect(JSON.parse(out)).toEqual({status: 'pending', job_id: J, progress: 0.2});
        expect(mock_fetch).toHaveBeenCalledTimes(4);
    });

    it('--wait-seconds 0 reads the job once and answers pending', async()=>{
        answer(json({jobId: J}, 202), job('Scheduled'));
        const {out} = await capture(()=>preview({filters: FILTERS, waitSeconds: '0', maxPerCompany: '2'}));
        expect(JSON.parse(out)).toEqual({status: 'pending', job_id: J, progress: null});
        expect(mock_fetch).toHaveBeenCalledTimes(2);
        expect(sent()[0].body).toEqual({filters: JSON.parse(FILTERS), maxPeoplePerCompany: 2});
    });

    it('--job-id goes on waiting for a preview already started, without starting one', async()=>{
        answer(job('Done', {jsonDataResult: '{"ContactsCount":5,"CompaniesCount":2,"SampleContacts":[]}'}));
        const {out} = await capture(()=>preview({jobId: J}));
        expect(JSON.parse(out)).toMatchObject({status: 'done', contacts_count: 5});
        expect(sent().map(r=>r.url)).toEqual([`https://api/v3/background-jobs/${J}`]);
    });

    it('a job Reply does not know is live_data.preview_not_found', async()=>{
        answer(json({code: 'backgroundJob.notFound'}, 404));
        await expect(preview({jobId: J})).rejects.toMatchObject({code: 'live_data.preview_not_found', details: {job_id: J}, exit_code: 1});
    });

    it('a job that settled Failed is live_data.preview_failed with Reply\'s status and the job id', async()=>{
        answer(json({jobId: J}, 202), job('Failed'));
        await expect(preview({filters: FILTERS})).rejects.toMatchObject({
            code: 'live_data.preview_failed', details: {job_status: 'Failed', job_id: J}, exit_code: 1,
        });
    });

    it('a result given as an object in v3\'s casing, under a status in another case, reads the same', async()=>{
        answer(job('done', {jsonDataResult: {contactsCount: 5, companiesCount: 2, sampleContacts: [{firstName: 'Ann', companyDomain: 'example.com'}]}}));
        const {out} = await capture(()=>preview({jobId: J}));
        expect(JSON.parse(out)).toEqual({status: 'done', job_id: J, contacts_count: 5, companies_count: 2, sample_contacts: [{
            first_name: 'Ann', last_name: null, job_title: null, location: null, linkedin_url: null, company_name: null,
            company_domain: 'example.com',
        }]});
    });

    it('a status v3 does not name is reply.unavailable with the job id, read once, not a pending after the whole wait', async()=>{
        answer(job('Paused'));
        await expect(preview({jobId: J})).rejects.toMatchObject({code: 'reply.unavailable', details: {job_id: J}, exit_code: 1});
        expect(mock_fetch).toHaveBeenCalledTimes(1);
    });

    it('counts Reply did not give are null', async()=>{
        answer(job('Done', {jsonDataResult: '{"SampleContacts":[]}'}));
        const {out} = await capture(()=>preview({jobId: J}));
        expect(JSON.parse(out)).toEqual({status: 'done', job_id: J, contacts_count: null, companies_count: null, sample_contacts: []});
    });

    it('a Done job whose result is not JSON is reply.unavailable with the job id', async()=>{
        answer(job('Done', {jsonDataResult: 'not json'}));
        await expect(preview({jobId: J})).rejects.toMatchObject({code: 'reply.unavailable', details: {job_id: J}, exit_code: 1});
    });

    it('a poll refused for the scope is access.feature_unavailable with the job id', async()=>{
        answer(json({jobId: J}, 202), json({}, 403));
        await expect(preview({filters: FILTERS})).rejects.toMatchObject({code: 'access.feature_unavailable', details: {job_id: J}});
    });

    it('a start answered without a job id, or lost, is outcome.unknown whose hint says a repeat is safe', async()=>{
        for (const outcome of [()=>json({}, 202), 'lost'] as const)
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
            const e = await preview({filters: FILTERS}).catch(x=>x);
            expect(e, String(outcome)).toMatchObject({code: 'outcome.unknown', exit_code: 3});
            expect(e.hint, String(outcome)).toContain('again is safe');
            expect(mock_fetch, String(outcome)).toHaveBeenCalledTimes(1);
        }
    });

    it('a --job-id that is not a GUID is a usage error before any call', async()=>{
        await expect(preview({jobId: '123'})).rejects.toMatchObject({exit_code: 2});
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('takes exactly one of --filters and --job-id, and --max-per-company only with --filters', async()=>{
        await expect(preview({filters: FILTERS, jobId: J})).rejects.toMatchObject({exit_code: 2});
        await expect(preview({})).rejects.toMatchObject({exit_code: 2});
        await expect(preview({jobId: J, maxPerCompany: '2'})).rejects.toMatchObject({exit_code: 2});
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});
