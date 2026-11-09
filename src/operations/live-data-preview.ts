import {Operation_error, Unknown_outcome_error, UsageError} from '../utils/errors';
import {sleep} from '../utils/client';
import {call_reply, expect_object, is_object, refusal, reply_code_of, unreadable, open_session, type Answer, type Op_session} from './call';
import {parse_int_in, LARGEST_REPLY_ID, type Op_globals} from './options';
import {live_data_error, read_filters} from './live-data';
import {print_result} from './result';
import {PROGRAM_NAME} from '../config';
import type {Cli_context} from '../context';

const POLL_MS = 2000;
const DEFAULT_WAIT_SECONDS = 120;
const MAX_WAIT_SECONDS = 600;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// v3's background-job statuses, read without regard to case; any other is not one the CLI can read.
const RUNNING = ['scheduled', 'processing'];
const FAILED = ['failed', 'cancelled', 'expired', 'unknown'];

type Preview_opts = {filters?: string; jobId?: string; maxPerCompany?: string; waitSeconds?: string};

const number_or_null = (v: unknown): number | null=>(typeof v === 'number' ? v : null);
const string_or_null = (v: unknown): string | null=>(typeof v === 'string' ? v : null);

// A field under its PascalCase name or its camelCase one.
const field = (o: Record<string, unknown>, pascal: string): unknown=>
    (pascal in o ? o[pascal] : o[pascal[0].toLowerCase() + pascal.slice(1)]);

// INTERIM (API gap): a preview job's result is a JSON string with PascalCase keys, not an object in v3's casing.
// Needed: jsonDataResult as an object, named as the rest of v3 names its fields.
// Workaround: parse the string and rename the fields a preview answers; an object, in either casing, reads the same.
const preview_result = (job: Record<string, unknown>, a: Answer): Record<string, unknown>=>{
    let result: unknown = job.jsonDataResult;
    if (typeof result === 'string')
    {
        try {
            result = JSON.parse(result);
        } catch {
            result = undefined;
        }
    }
    if (!is_object(result))
    {
        throw unreadable(a, 'read');
    }
    const sample_list = field(result, 'SampleContacts');
    const samples = Array.isArray(sample_list) ? sample_list.filter(is_object) : [];
    return {
        contacts_count: number_or_null(field(result, 'ContactsCount')),
        companies_count: number_or_null(field(result, 'CompaniesCount')),
        sample_contacts: samples.map(c=>({
            first_name: string_or_null(field(c, 'FirstName')),
            last_name: string_or_null(field(c, 'LastName')),
            job_title: string_or_null(field(c, 'JobTitle')),
            location: string_or_null(field(c, 'Location')),
            linkedin_url: string_or_null(field(c, 'LinkedInUrl')),
            company_name: string_or_null(field(c, 'CompanyName')),
            company_domain: string_or_null(field(c, 'CompanyDomain')),
        })),
    };
};

const start_preview = async(s: Op_session, filters: Record<string, unknown>, max_per_company: number | undefined): Promise<string>=>{
    const body: Record<string, unknown> = {filters};
    if (max_per_company !== undefined)
    {
        body.maxPeoplePerCompany = max_per_company;
    }
    try {
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
    } catch (e) {
        if (e instanceof Unknown_outcome_error)
        {
            e.hint = `A preview saves and charges nothing, and a newer one replaces an older one: running \`${PROGRAM_NAME} live-data preview\` again is safe.`;
        }
        throw e;
    }
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
        const status = (job.status as string).toLowerCase();
        if (status === 'done')
        {
            print_result({status: 'done', job_id, ...preview_result(job, a)}, g);
            return;
        }
        if (FAILED.includes(status))
        {
            throw new Operation_error('live_data.preview_failed', 'The preview ended without a result.', {
                details: {job_status: job.status},
            });
        }
        if (!RUNNING.includes(status))
        {
            throw unreadable(a, 'read');
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
    if (opts.jobId !== undefined && opts.maxPerCompany !== undefined)
    {
        throw new UsageError('--max-per-company goes with --filters: a preview already started keeps its own.', {code: 'usage.filters'});
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
