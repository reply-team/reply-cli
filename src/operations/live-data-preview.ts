import {Operation_error, UsageError} from '../utils/errors';
import {call_reply, expect_object, is_object, refusal, reply_code_of, unreadable, open_session, type Answer, type Op_session} from './call';
import {parse_int_in, LARGEST_REPLY_ID, type Op_globals} from './options';
import {live_data_error, read_filters} from './live-data';
import {print_result} from './result';
import type {Cli_context} from '../context';

const POLL_MS = 2000;
const DEFAULT_WAIT_SECONDS = 120;
const MAX_WAIT_SECONDS = 600;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAILED = ['Failed', 'Cancelled', 'Expired', 'Unknown'];

type Preview_opts = {filters?: string; jobId?: string; maxPerCompany?: string; waitSeconds?: string};

const sleep = (ms: number): Promise<void>=>new Promise(resolve=>setTimeout(resolve, ms));

const number_or_null = (v: unknown): number | null=>(typeof v === 'number' ? v : null);
const string_or_null = (v: unknown): string | null=>(typeof v === 'string' ? v : null);

// INTERIM (API gap): a preview job's result is a JSON string with PascalCase keys, not an object in v3's casing.
// Needed: jsonDataResult as an object, named as the rest of v3 names its fields.
// Workaround: parse the string and rename the fields a preview answers.
const preview_result = (job: Record<string, unknown>, a: Answer): Record<string, unknown>=>{
    let result: unknown;
    try {
        result = typeof job.jsonDataResult === 'string' ? JSON.parse(job.jsonDataResult) : undefined;
    } catch {
        result = undefined;
    }
    if (!is_object(result))
    {
        throw unreadable(a, 'read');
    }
    const samples = Array.isArray(result.SampleContacts) ? result.SampleContacts.filter(is_object) : [];
    return {
        contacts_count: number_or_null(result.ContactsCount),
        companies_count: number_or_null(result.CompaniesCount),
        sample_contacts: samples.map(c=>({
            first_name: string_or_null(c.FirstName),
            last_name: string_or_null(c.LastName),
            job_title: string_or_null(c.JobTitle),
            location: string_or_null(c.Location),
            linkedin_url: string_or_null(c.LinkedInUrl),
            company_name: string_or_null(c.CompanyName),
            company_domain: string_or_null(c.CompanyDomain),
        })),
    };
};

const start_preview = async(s: Op_session, filters: Record<string, unknown>, max_per_company: number | undefined): Promise<string>=>{
    const body: Record<string, unknown> = {filters};
    if (max_per_company !== undefined)
    {
        body.maxPeoplePerCompany = max_per_company;
    }
    const a = await call_reply(s, 'POST', '/v3/live-data/searches/preview', 'write', body);
    if (a.status !== 202 && a.status !== 200)
    {
        throw live_data_error(a, 'write');
    }
    const job_id = expect_object(a, 'write').jobId;
    if (typeof job_id !== 'string' || !GUID.test(job_id))
    {
        throw unreadable(a, 'write');
    }
    return job_id;
};

const read_job = async(s: Op_session, job_id: string): Promise<{job: Record<string, unknown>; a: Answer}>=>{
    const a = await call_reply(s, 'GET', `/v3/background-jobs/${job_id}`, 'read');
    if (a.status === 404)
    {
        throw new Operation_error('live_data.preview_not_found', 'Reply has no such preview job for this user.', {
            status: 404, reply_code: reply_code_of(a),
        });
    }
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    const job = expect_object(a, 'read');
    if (typeof job.status !== 'string')
    {
        throw unreadable(a, 'read');
    }
    return {job, a};
};

// The wait is the sum of the pauses slept between reads, never the clock: the job is read at once,
// then again every POLL_MS while the next pause still fits in the wait.
const wait_for_job = async(s: Op_session, job_id: string, wait_ms: number, g: Op_globals): Promise<void>=>{
    for (let slept = 0; ; slept += POLL_MS)
    {
        const {job, a} = await read_job(s, job_id);
        if (job.status === 'Done')
        {
            print_result({status: 'done', job_id, ...preview_result(job, a)}, g);
            return;
        }
        if (FAILED.includes(job.status as string))
        {
            throw new Operation_error('live_data.preview_failed', 'The preview ended without a result.', {
                status: 200, details: {job_status: job.status},
            });
        }
        if (slept + POLL_MS > wait_ms)
        {
            print_result({status: 'pending', job_id, progress: number_or_null(job.progress)}, g);
            return;
        }
        await sleep(POLL_MS);
    }
};

const handle_live_data_preview = async(opts: Preview_opts, ctx: Cli_context, g: Op_globals, read_stdin?: () => string): Promise<void>=>{
    if ((opts.filters === undefined) === (opts.jobId === undefined))
    {
        throw new UsageError('Give exactly one of --filters and --job-id.', {code: 'usage.filters'});
    }
    if (opts.jobId !== undefined && !GUID.test(opts.jobId))
    {
        throw new UsageError('--job-id must be the job id a preview answered (a GUID).', {code: 'usage.id', hint: `Got: ${opts.jobId}`});
    }
    const filters = opts.filters === undefined ? undefined : read_filters(opts.filters, read_stdin);
    const max_per_company = opts.maxPerCompany === undefined
        ? undefined : parse_int_in(opts.maxPerCompany, '--max-per-company', 1, LARGEST_REPLY_ID, 1);
    const wait_ms = parse_int_in(opts.waitSeconds, '--wait-seconds', 0, MAX_WAIT_SECONDS, DEFAULT_WAIT_SECONDS) * 1000;
    const s = await open_session(ctx, g);
    const job_id = filters === undefined ? opts.jobId as string : await start_preview(s, filters, max_per_company);
    try {
        await wait_for_job(s, job_id, wait_ms, g);
    } catch (e) {
        if (e instanceof Operation_error)
        {
            e.details = {...e.details, job_id};
        }
        throw e;
    }
};

export {handle_live_data_preview};
