import {PROGRAM_NAME} from '../config';
import {Api_error, RuntimeError, type Api_error_body} from './errors';

// The v3 API auto-detects JWT (OAuth) vs API key from the same
// `Authorization: Bearer <credential>` header, so both auth methods share this
// one transport path.
const TRANSIENT_STATUSES = [429, 500, 502, 503, 504];
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const RETRY_AFTER_CAP_MS = 30_000;

type Request_opts = {
    timing?: boolean;
    headers?: Record<string, string>;   // extra request headers (e.g. X-TEAM-ID)
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

const retry_delay_ms = (res: Response, attempt: number): number=>{
    const retry_after = res.headers.get('Retry-After');
    if (retry_after)
    {
        const seconds = parseInt(retry_after, 10);
        if (!isNaN(seconds) && seconds >= 0)
        {
            return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
        }
    }
    return RETRY_BASE_MS * 2 ** attempt;
};

const request = async<T = unknown>(
    base_url: string,
    token: string,
    method: string,
    endpoint: string,
    body?: unknown,
    opts: Request_opts = {},
): Promise<T>=>{
    const url = `${base_url}${endpoint}`;
    const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(opts.headers ?? {}),
    };
    const init: RequestInit = {method, headers};
    if (body !== undefined)
    {
        init.body = JSON.stringify(body);
    }
    let attempt = 0;
    const start = opts.timing ? Date.now() : 0;
    while (attempt <= MAX_RETRIES)
    {
        let res: Response;
        try {
            res = await fetch(url, init);
        } catch (e) {
            if (attempt < MAX_RETRIES)
            {
                await sleep(RETRY_BASE_MS * 2 ** attempt);
                attempt++;
                continue;
            }
            throw new RuntimeError('Network request failed.', {
                code: 'network',
                detail: (e as Error).message,
                hint: 'Check your connection and try again.',
            });
        }
        if (opts.timing)
        {
            console.error(`Timing: ${Date.now() - start}ms (attempt ${attempt + 1})`);
        }
        if (res.ok)
        {
            const text = await res.text();
            if (!text)
            {
                return null as T;
            }
            const parsed = parse_body(text);
            return parsed as T;
        }
        if (TRANSIENT_STATUSES.includes(res.status) && attempt < MAX_RETRIES)
        {
            await sleep(retry_delay_ms(res, attempt));
            attempt++;
            continue;
        }
        const err_text = await res.text().catch(()=>'');
        throw new Api_error(res.status, parse_body(err_text), {hint: hint_for(res.status)});
    }
    throw new RuntimeError('Max retries exceeded.', {code: 'network'});
};

const get = <T = unknown>(
    base_url: string, token: string, endpoint: string, opts?: Request_opts,
): Promise<T>=>request<T>(base_url, token, 'GET', endpoint, undefined, opts);

type Client = {
    get<T = unknown>(endpoint: string, opts?: Request_opts): Promise<T>;
};

const create_client = (
    base_url: string, token: string, headers?: Record<string, string>,
): Client=>({
    get: <T = unknown>(endpoint: string, opts?: Request_opts)=>
        get<T>(base_url, token, endpoint, {...opts, headers: {...headers, ...opts?.headers}}),
});

export {request, get, create_client};
export type {Request_opts, Client};
