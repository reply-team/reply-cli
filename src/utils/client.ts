import {PROGRAM_NAME, user_agent} from '../config';
import {REDACTED} from './output';
import {Api_error, RuntimeError, Unknown_outcome_error, type Api_error_body} from './errors';

// The v3 API auto-detects JWT (OAuth) vs API key from the same
// `Authorization: Bearer <credential>` header, so both auth methods share this
// one transport path.

// Whether a call can change something at Reply. It decides what a failure means: a read that
// failed changed nothing and can always be asked again; a write may already have happened.
type Call_kind = 'read' | 'write';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
// The longest Retry-After waited out here. A longer one goes back to the caller as the 429 it
// is: a wait inside one call spends a time budget the caller may not have.
const MAX_WAIT_SECONDS = 3;
// Node's fetch reports every transport failure as TypeError('fetch failed') with the system
// error on `.cause`. These are failures to connect at all, so the request never left: no route,
// no answer to the connect, a URL that can't be parsed, or a TLS handshake that failed.
const NEVER_SENT_CODES = [
    'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'ERR_INVALID_URL',
];
const TLS_FAILURE = /^ERR_(TLS|SSL)_|CERT|SELF_SIGNED|UNABLE_TO_/;

type Request_opts = {
    headers?: Record<string, string>;   // extra request headers (e.g. X-TEAM-ID)
    kind?: Call_kind;                   // default: GET is a read, any other method a write
};

const hint_for = (status: number): string | undefined=>{
    switch (status)
    {
        case 401:
            return `Invalid or expired credential. Re-check your key/token or run \`${PROGRAM_NAME} auth login\`.`;
        case 403:
            return 'Access denied — the credential is missing a required scope.';
        case 404:
            return 'Resource not found.';
        case 429:
            return 'Rate limit exceeded. Wait a moment and try again.';
        default:
            return undefined;
    }
};

const sleep = (ms: number): Promise<void>=>new Promise(resolve=>setTimeout(resolve, ms));

// Join base + endpoint with exactly one slash, tolerating a trailing slash on
// the base or a missing leading slash on the endpoint (a query string rides along).
const join_url = (base: string, endpoint: string): string=>
    `${base.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;

const headers_to_object = (h: Headers): Record<string, string>=>{
    const o: Record<string, string> = {};
    h.forEach((v, k)=>{ o[k] = v; });
    return o;
};

const parse_body = (text: string): Api_error_body | string=>{
    if (!text)
    {
        return '';
    }
    try {
        return JSON.parse(text) as Api_error_body;
    } catch {
        return text;
    }
};

const kind_of = (method: string, opts: Request_opts): Call_kind=>
    opts.kind ?? (method.toUpperCase() === 'GET' ? 'read' : 'write');

const cause_of = (e: unknown): {code?: unknown; message?: unknown} | undefined=>
    (e as {cause?: {code?: unknown; message?: unknown}} | undefined)?.cause;

const never_sent = (e: unknown): boolean=>{
    const code = cause_of(e)?.code;
    return typeof code === 'string' && (NEVER_SENT_CODES.includes(code) || TLS_FAILURE.test(code));
};

// "fetch failed" alone says nothing; the system error under it is what someone can act on.
const failure_detail = (e: unknown): string=>{
    const cause = cause_of(e);
    const parts = [(e as Error).message];
    if (typeof cause?.code === 'string')
    {
        parts.push(cause.code);
    }
    if (typeof cause?.message === 'string' && cause.message !== cause.code)
    {
        parts.push(cause.message);
    }
    return parts.join(': ');
};

const HTTP_DATE = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

// Seconds a Retry-After asks to wait, given as delta-seconds or as an HTTP date; null when it
// names no wait at all.
const parse_retry_after = (raw: string | null | undefined): number | null=>{
    const value = raw?.trim();
    if (!value)
    {
        return null;
    }
    if (/^\d+$/.test(value))
    {
        return parseInt(value, 10);
    }
    if (!HTTP_DATE.test(value))
    {
        return null;
    }
    const at = Date.parse(value);
    return isNaN(at) ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
};

const backoff_ms = (attempt: number): number=>RETRY_BASE_MS * 2 ** attempt;

// One request under the retry policy, body included: an answer that breaks off mid-body is a
// failure after sending like any other. It returns the final Response and its text for any HTTP
// status. It throws RuntimeError('network') when Reply could not be reached and nothing was sent,
// and Unknown_outcome_error when a write's connection broke after it may have been sent.
const send = async(url: string, init: RequestInit, kind: Call_kind): Promise<{res: Response; text: string}>=>{
    for (let attempt = 0; ; attempt++)
    {
        const can_retry = attempt < MAX_RETRIES;
        let res: Response;
        let text: string;
        try {
            res = await fetch(url, init);
            text = await res.text();
        } catch (e) {
            if (kind === 'write' && !never_sent(e))
            {
                throw new Unknown_outcome_error('The request may have reached Reply, but no answer came back.', {
                    detail: failure_detail(e),
                    hint: 'It may or may not have taken effect. A reply work command is safe to re-run as it is; '
                        + 'check before repeating a raw reply api write.',
                });
            }
            if (!can_retry)
            {
                throw new RuntimeError('Network request failed.', {
                    code: 'network',
                    detail: failure_detail(e),
                    hint: 'Check your connection and try again.',
                });
            }
            await sleep(backoff_ms(attempt));
            continue;
        }
        if (res.status === 429 && can_retry)
        {
            const wait = parse_retry_after(res.headers.get('Retry-After'));
            if (wait !== null && wait > MAX_WAIT_SECONDS)
            {
                return {res, text};
            }
            await sleep(wait === null ? backoff_ms(attempt) : wait * 1000);
            continue;
        }
        if (res.status >= 500 && kind === 'read' && can_retry)
        {
            await sleep(backoff_ms(attempt));
            continue;
        }
        return {res, text};
    }
};

const request = async<T = unknown>(
    base_url: string,
    token: string,
    method: string,
    endpoint: string,
    body?: unknown,
    opts: Request_opts = {},
): Promise<T>=>{
    const url = join_url(base_url, endpoint);
    const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': user_agent(),   // identifies CLI traffic for telemetry
        ...(opts.headers ?? {}),
    };
    const init: RequestInit = {method, headers};
    if (body !== undefined)
    {
        init.body = JSON.stringify(body);
    }
    const {res, text} = await send(url, init, kind_of(method, opts));
    if (res.ok)
    {
        if (!text)
        {
            return null as T;
        }
        return parse_body(text) as T;
    }
    throw new Api_error(res.status, parse_body(text), {hint: hint_for(res.status)});
};

const get = <T = unknown>(
    base_url: string, token: string, endpoint: string, opts?: Request_opts,
): Promise<T>=>request<T>(base_url, token, 'GET', endpoint, undefined, opts);

type Raw_response = {
    status: number;
    data: unknown;
    response_headers: Record<string, string>;
    // The request as sent — Authorization pre-redacted so the raw token never
    // leaves this function (used by `api --verbose`).
    request: {method: string; url: string; headers: Record<string, string>; body?: string};
};

// Like `request`, but returns {status, data, …} for ANY final HTTP status instead
// of throwing on non-2xx — the workload `api` command needs the raw response.
// Retries only what `send` allows; see there for what it throws.
const request_raw = async(
    base_url: string,
    token: string,
    method: string,
    endpoint: string,
    body?: unknown,
    opts: Request_opts = {},
): Promise<Raw_response>=>{
    const url = join_url(base_url, endpoint);
    const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': user_agent(),
        ...(opts.headers ?? {}),
    };
    const body_str = body !== undefined ? JSON.stringify(body) : undefined;
    const init: RequestInit = {method, headers};
    if (body_str !== undefined)
    {
        init.body = body_str;
    }
    const request_view = {
        method, url,
        headers: {...headers, Authorization: `Bearer ${REDACTED}`},
        ...(body_str !== undefined ? {body: body_str} : {}),
    };
    const {res, text} = await send(url, init, kind_of(method, opts));
    return {
        status: res.status,
        data: text ? parse_body(text) : null,
        response_headers: headers_to_object(res.headers),
        request: request_view,
    };
};

type Client = {
    get<T = unknown>(endpoint: string, opts?: Request_opts): Promise<T>;
};

const create_client = (
    base_url: string, token: string, headers?: Record<string, string>,
): Client=>({
    get: <T = unknown>(endpoint: string, opts?: Request_opts)=>
        get<T>(base_url, token, endpoint, {...opts, headers: {...headers, ...opts?.headers}}),
});

export {request, get, request_raw, create_client, parse_retry_after};
export type {Request_opts, Client, Raw_response, Call_kind};
