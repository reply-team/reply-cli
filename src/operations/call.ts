import {request_raw, parse_retry_after, type Call_kind} from '../utils/client';
import {Operation_error, RuntimeError, Unknown_outcome_error} from '../utils/errors';
import {team_error_guidance} from '../teams';
import {authed} from '../commands/authed';
import {LARGEST_REPLY_ID, type Op_globals} from './options';
import type {Cli_context} from '../context';

type Op_session = {api_base: string; token: string; headers: Record<string, string>};
type Answer = {status: number; data: unknown; headers: Record<string, string>};
type Item_failure = {error: string | null; details: string | null};

const open_session = async(ctx: Cli_context, g: Op_globals): Promise<Op_session>=>{
    const {token, headers} = await authed(ctx, g);
    return {api_base: ctx.api_base, token, headers};
};

const is_object = (v: unknown): v is Record<string, unknown>=>
    typeof v === 'object' && v !== null && !Array.isArray(v);

const is_reply_id = (v: unknown): v is number=>
    typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= LARGEST_REPLY_ID;

const reply_code_of = (a: Answer): string | undefined=>
    is_object(a.data) && typeof a.data.code === 'string' ? a.data.code : undefined;

const detail_of = (a: Answer): string | undefined=>{
    if (is_object(a.data))
    {
        if (typeof a.data.detail === 'string')
        {
            return a.data.detail;
        }
        return typeof a.data.title === 'string' ? a.data.title : undefined;
    }
    return typeof a.data === 'string' && a.data ? a.data.slice(0, 500) : undefined;
};

// One call to Reply for an operation. Every HTTP status comes back as an Answer for the command
// to read. If Reply can't be reached, nothing happened, so that becomes reply.unavailable. A
// write whose answer was lost passes through as outcome.unknown.
const call_reply = async(s: Op_session, method: string, path: string, kind: Call_kind, body?: unknown): Promise<Answer>=>{
    try {
        const r = await request_raw(s.api_base, s.token, method, path, body, {headers: s.headers, kind});
        return {status: r.status, data: r.data, headers: r.response_headers};
    } catch (e) {
        if (e instanceof RuntimeError)
        {
            throw new Operation_error('reply.unavailable', 'Reply could not be reached.', {detail: e.detail, hint: e.hint});
        }
        throw e;
    }
};

// An answer that can't be read: on a read nothing happened and it can be asked again; on a
// write, the write may have happened.
const unreadable = (a: Answer, kind: Call_kind): Operation_error=>
    kind === 'write'
        ? new Unknown_outcome_error('Reply answered the write, but the answer could not be read.', {status: a.status})
        : new Operation_error('reply.unavailable', 'Reply answered with something that could not be read.', {status: a.status});

const expect_object = (a: Answer, kind: Call_kind): Record<string, unknown>=>{
    if (!is_object(a.data))
    {
        throw unreadable(a, kind);
    }
    return a.data;
};

const read_page = (a: Answer): {items: unknown[]; has_more: boolean}=>{
    const body = expect_object(a, 'read');
    if (!Array.isArray(body.items) || typeof body.hasMore !== 'boolean')
    {
        throw unreadable(a, 'read');
    }
    return {items: body.items, has_more: body.hasMore};
};

// One contact's entry in a v3 per-item failure dictionary ({"<id>": {error, errorDetails}}), or
// undefined when the contact is not in it, which is how v3 says that contact succeeded.
const item_failure = (dict: unknown, id: number): Item_failure | undefined=>{
    if (!is_object(dict) || !Object.prototype.hasOwnProperty.call(dict, String(id)))
    {
        return undefined;
    }
    const entry = dict[String(id)];
    return {
        error: is_object(entry) && typeof entry.error === 'string' ? entry.error : null,
        details: is_object(entry) && typeof entry.errorDetails === 'string' ? entry.errorDetails : null,
    };
};

// The answers every operation reads the same way. Each command reads its own statuses and codes
// first and falls back to this.
const refusal = (a: Answer, kind: Call_kind): Operation_error=>{
    const reply_code = reply_code_of(a);
    const base = {status: a.status, reply_code, detail: detail_of(a)};
    if (a.status < 400)
    {
        // An answer the command didn't expect, but not a refusal: on a write it may have happened.
        return unreadable(a, kind);
    }
    if (a.status === 401)
    {
        return new Operation_error('access.denied', 'Reply refused the credential.', {
            ...base, hint: 'Sign in again with `reply auth login`, or check the API key.',
        });
    }
    if (a.status === 403)
    {
        // v3's feature-scope check answers a 403 with no code at all; the endpoints' own refusals
        // end in `.forbidden`. Both mean the plan or role lacks the feature, not a bad credential.
        if (reply_code === undefined || reply_code.endsWith('.forbidden'))
        {
            return new Operation_error('access.feature_unavailable', 'The account\'s plan or role does not include this.', base);
        }
        return new Operation_error('access.denied', 'Reply refused access.', {...base, hint: team_error_guidance(a.status, a.data)});
    }
    if (a.status === 429)
    {
        return new Operation_error('rate_limited', 'Reply asked for this call to be made later.', {
            ...base, retry_after: parse_retry_after(a.headers['retry-after']) ?? undefined,
        });
    }
    if (a.status >= 500)
    {
        return kind === 'write'
            ? new Unknown_outcome_error('Reply failed while handling the write; it may or may not have taken effect.', base)
            : new Operation_error('reply.unavailable', 'Reply failed to answer.', base);
    }
    return new Operation_error('reply.refused', 'Reply refused the call.', base);
};

export {
    open_session, call_reply, is_object, is_reply_id, reply_code_of, detail_of,
    unreadable, expect_object, read_page, item_failure, refusal,
};
export type {Op_session, Answer, Item_failure};
