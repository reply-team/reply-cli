import {PROGRAM_NAME} from '../config';
import {Operation_error, Unknown_outcome_error, UsageError} from '../utils/errors';
import type {Call_kind} from '../utils/client';
import {read_json_arg} from '../utils/json-arg';
import {
    call_reply, detail_of, expect_object, is_object, is_reply_id, read_page, refusal, reply_code_of, unreadable, open_session,
    type Answer,
} from './call';
import {parse_id, parse_int_in, parse_choice, LARGEST_REPLY_ID, type Op_globals} from './options';
import {print_result, with_ids} from './result';
import type {Cli_context} from '../context';

const LIVE_DATA_CODES: Record<string, string> = {
    'liveDataSearch.searchInProgress': 'live_data.search_in_progress',
    'liveDataSearch.invalidStatus': 'live_data.invalid_status',
    'liveDataSearch.insufficientCredits': 'live_data.insufficient_credits',
    'liveDataSearch.contactLimitReached': 'live_data.contact_limit_reached',
    'liveDataSearch.invalidParameter': 'live_data.invalid_filters',
};

const LIVE_DATA_TITLES: Record<string, string> = {
    'live_data.not_found': 'This team has no such Live Data search.',
    'live_data.search_in_progress': 'An unfinished search of this team with the same filters blocks the start.',
    'live_data.invalid_status': 'The search is not in a status this applies to.',
    'live_data.insufficient_credits': 'The team does not have the credits for a single contact.',
    'live_data.contact_limit_reached': 'The search owner\'s plan has no room for another contact.',
    'live_data.invalid_filters': 'Reply did not accept the filters.',
    'live_data.service_failed': 'Reply\'s search service failed; nothing changed, and the call can be made again.',
};

// Live Data's own refusals; any other answer reads as every operation reads it. Reply's 502 with its
// own upstreamFailure code is definite, even on a write: Reply saved nothing, or kept the search as it was.
const live_data_error = (a: Answer, kind: Call_kind, search_id?: number): Operation_error=>{
    const reply_code = reply_code_of(a);
    const by_code = reply_code === undefined ? undefined : LIVE_DATA_CODES[reply_code];
    const code = a.status === 404 ? 'live_data.not_found'
        : a.status === 502 && reply_code?.endsWith('.upstreamFailure') ? 'live_data.service_failed'
            : by_code;
    if (code === undefined)
    {
        return refusal(a, kind);
    }
    return new Operation_error(code, LIVE_DATA_TITLES[code], {
        status: a.status, reply_code, detail: detail_of(a), ids: search_id === undefined ? undefined : {search_id},
    });
};

const handle_live_data_get = async(id_arg: string, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const id = parse_id(id_arg, 'Search id');
    const s = await open_session(ctx, g);
    const a = await call_reply(s, 'GET', `/v3/live-data/searches/${id}`, 'read');
    if (a.status !== 200)
    {
        throw live_data_error(a, 'read', id);
    }
    print_result(expect_object(a, 'read'), g);
};

const handle_live_data_list = async(opts: {limit?: string; offset?: string}, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const limit = parse_int_in(opts.limit, '--limit', 1, 1000, 100);
    const offset = parse_int_in(opts.offset, '--offset', 0, 1000000, 0);
    const s = await open_session(ctx, g);
    const a = await call_reply(s, 'GET', `/v3/live-data/searches?top=${limit}&skip=${offset}`, 'read');
    if (a.status !== 200)
    {
        throw live_data_error(a, 'read');
    }
    const page = read_page(a);
    print_result({items: page.items, has_more: page.has_more}, g);
};

// Reply's own filter shape, passed on untouched: the CLI neither translates nor checks Reply's vocabulary.
const read_filters = (raw: string | undefined, read_stdin?: () => string): Record<string, unknown>=>{
    if (raw === undefined)
    {
        throw new UsageError('No --filters was given.', {code: 'usage.filters', hint: 'Give the filters in Reply\'s shape: <json>, @file or - for stdin.'});
    }
    const value = read_json_arg(raw, {flag: '--filters', what: 'filters', code: 'usage.filters', read_stdin});
    if (!is_object(value))
    {
        throw new UsageError('--filters must be a JSON object in Reply\'s filter shape.', {code: 'usage.filters'});
    }
    return value;
};

type Start_opts = {filters?: string; count?: string; listId?: string[]; maxPerCompany?: string; withPhones?: boolean};

const handle_live_data_start = async(opts: Start_opts, ctx: Cli_context, g: Op_globals, read_stdin?: () => string): Promise<void>=>{
    const filters = read_filters(opts.filters, read_stdin);
    if (opts.count === undefined)
    {
        throw new UsageError('No --count was given.', {code: 'usage.range', hint: 'The most people the search may add, e.g. --count 25.'});
    }
    const body: Record<string, unknown> = {filters, contactsCountToAdd: parse_int_in(opts.count, '--count', 1, LARGEST_REPLY_ID, 0)};
    if (opts.listId !== undefined && opts.listId.length > 0)
    {
        body.listIds = opts.listId.map(id=>parse_id(id, '--list-id'));
    }
    if (opts.maxPerCompany !== undefined)
    {
        body.maxPeoplePerCompany = parse_int_in(opts.maxPerCompany, '--max-per-company', 1, LARGEST_REPLY_ID, 1);
    }
    if (opts.withPhones === true)
    {
        body.searchContactPhones = true;
    }
    const s = await open_session(ctx, g);
    try {
        const a = await call_reply(s, 'POST', '/v3/live-data/searches', 'write', body);
        if (a.status !== 200 && a.status !== 201)
        {
            throw live_data_error(a, 'write');
        }
        const started = expect_object(a, 'write');
        if (!is_reply_id(started.searchId))
        {
            throw unreadable(a, 'write');
        }
        print_result({status: 'started', search_id: started.searchId}, g);
    } catch (e) {
        if (e instanceof Unknown_outcome_error)
        {
            e.hint = `The search may have started. \`${PROGRAM_NAME} live-data list\` shows the team's searches with their lists.`;
        }
        throw e;
    }
};

// One act on one search. Whatever it fails with names the search; a lost answer gets the hint given.
const act_on_search = async<T>(
    id_arg: string, method: 'POST' | 'DELETE', suffix: string, ctx: Cli_context, g: Op_globals,
    answered: (a: Answer) => T, unknown_hint?: string,
): Promise<{id: number; result: T}>=>{
    const id = parse_id(id_arg, 'Search id');
    const s = await open_session(ctx, g);
    try {
        const a = await call_reply(s, method, `/v3/live-data/searches/${id}${suffix}`, 'write');
        if (a.status !== 200 && a.status !== 204)
        {
            throw live_data_error(a, 'write', id);
        }
        return {id, result: answered(a)};
    } catch (e) {
        if (e instanceof Unknown_outcome_error && unknown_hint !== undefined)
        {
            e.hint = unknown_hint;
        }
        throw with_ids(e, {search_id: id});
    }
};

const handle_live_data_pause = async(id_arg: string, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const {id} = await act_on_search(id_arg, 'POST', '/pause', ctx, g, ()=>undefined);
    print_result({status: 'paused', search_id: id}, g);
};

// Reply answers the search as it now holds it: running again, or finished when nothing was left to find.
const handle_live_data_resume = async(id_arg: string, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const {id, result} = await act_on_search(id_arg, 'POST', '/resume', ctx, g, a=>{
        const status = expect_object(a, 'write').status;
        if (typeof status !== 'string')
        {
            throw unreadable(a, 'write');
        }
        return status;
    });
    print_result({status: result === 'finished' ? 'finished' : 'resumed', search_id: id}, g);
};

const handle_live_data_delete = async(id_arg: string, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const {id} = await act_on_search(id_arg, 'DELETE', '', ctx, g, ()=>undefined,
        'The search may have been deleted. Running the command again is safe; it answers live_data.not_found if it was.');
    print_result({status: 'deleted', search_id: id}, g);
};

const FILTER_VALUE_KINDS = ['industries', 'departments', 'seniorities', 'locations', 'job-titles'] as const;

const handle_live_data_filter_values = async(
    kind_arg: string, opts: {search?: string; limit?: string; offset?: string}, ctx: Cli_context, g: Op_globals,
): Promise<void>=>{
    const kind = parse_choice(kind_arg, 'The kind', FILTER_VALUE_KINDS) as string;
    const limit = parse_int_in(opts.limit, '--limit', 1, 1000, 100);
    const offset = parse_int_in(opts.offset, '--offset', 0, 1000000, 0);
    const search = opts.search === undefined ? '' : `search=${encodeURIComponent(opts.search)}&`;
    const s = await open_session(ctx, g);
    const a = await call_reply(s, 'GET', `/v3/live-data/filter-values/${kind}?${search}top=${limit}&skip=${offset}`, 'read');
    if (a.status !== 200)
    {
        throw live_data_error(a, 'read');
    }
    const page = read_page(a);
    print_result({items: page.items, has_more: page.has_more}, g);
};

export {
    live_data_error, read_filters, handle_live_data_get, handle_live_data_list, handle_live_data_start,
    handle_live_data_pause, handle_live_data_resume, handle_live_data_delete, handle_live_data_filter_values, FILTER_VALUE_KINDS,
};
