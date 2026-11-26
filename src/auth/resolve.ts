import {PROGRAM_NAME, env_var, get_env, type Env} from '../config';
import {Lock_timeout_error} from '../credentials/lock';
import {Operation_error, UsageError} from '../utils/errors';
import {Token_request_error, type Token_failure} from './oauth-flow';
import {needs_refresh} from './token';
import type {Credential_record, CredentialStore, Oauth_record} from '../credentials/types';

type Resolved_source = 'flag' | 'env' | 'store';

type Resolved_credential = {
    token: string;                 // bearer value to send (api key or oauth access token)
    type: 'api_key' | 'oauth';
    source: Resolved_source;
    ephemeral: boolean;            // flag/env creds are ephemeral — never persist them
    record?: Credential_record;    // present only for stored creds
};

type Resolve_opts = {
    api_key?: string;
};

type Resolve_deps = {
    key: string;
    store: CredentialStore;
    env?: Env;
    now?: number;
    // Refresh an expired oauth record against the token endpoint. Injected so
    // resolution stays unit-testable without network.
    refresh?: (record: Oauth_record) => Promise<Oauth_record>;
};

const LOGIN_HINT = `Run \`${PROGRAM_NAME} auth login\` to sign in again.`;
const KEPT_HINT = 'The stored sign-in is kept. Run the command again.';

const not_authenticated = (): UsageError=>new UsageError('Not authenticated.', {
    code: 'auth.required',
    hint: `Run \`${PROGRAM_NAME} auth login\` or set ${env_var('API_KEY')}.`,
});

const session_expired = (): UsageError=>new UsageError('Session expired.', {code: 'auth.expired', hint: LOGIN_HINT});

const usable = (record: Credential_record, now: number): boolean=>
    record.type === 'api_key' || !needs_refresh(record, now);

const from_store = (record: Credential_record): Resolved_credential=>({
    token: record.type === 'api_key' ? record.key : record.access_token,
    type: record.type,
    source: 'store',
    ephemeral: false,
    record,
});

const same_record = (a: Credential_record, b: Credential_record): boolean=>
    a.type === 'oauth' && b.type === 'oauth' && a.access_token === b.access_token && a.refresh_token === b.refresh_token;

// A token request's failure, or a wait for the lock that ran out before any request was sent.
type Refresh_failure = Omit<Token_failure, 'reason'> & {reason?: Token_failure['reason'] | 'lock_wait'};

// The failed refresh as the printed error carries it, under `details.refresh`: the token endpoint's
// HTTP status and OAuth `error` code when it answered, and why no usable answer came otherwise. The
// top-level `status` stays unset, since a caller reads it as Reply's answer to the command itself.
const refresh_details = (f: Refresh_failure): Record<string, unknown>=>{
    const refresh: Record<string, unknown> = {};
    if (f.status !== undefined)
    {
        refresh.status = f.status;
    }
    if (f.error !== undefined)
    {
        refresh.error = f.error;
    }
    if (f.reason !== undefined)
    {
        refresh.reason = f.reason;
    }
    return {refresh};
};

const answered = (f: Refresh_failure): string=>`HTTP ${f.status}${f.error ? ` ${f.error}` : ''}`;

// A definite refusal is an OAuth error answer (RFC 6749 §5.2): a 400 or a 401 that names its error.
// Anything else, a maintenance page's 405 or a proxy's 404 among them, says nothing of the grant.
const refused = (f: Token_failure): boolean=>
    (f.status === 400 || f.status === 401) && f.error !== undefined;

const UNAVAILABLE_TITLES: Record<NonNullable<Refresh_failure['reason']>, string> = {
    timeout: 'The sign-in server did not answer the session refresh in time.',
    network: 'The sign-in server could not be reached to refresh the session.',
    unreadable: 'The sign-in server\'s answer to the session refresh could not be read.',
    lock_wait: 'Another reply process kept the session refresh locked for too long.',
};

// The error for a refresh that failed for a reason a later attempt can get past. The stored
// sign-in is kept, and the codes are the ones a caller retries.
const passing_failure = (f: Refresh_failure, detail: string): Operation_error=>{
    const details = refresh_details(f);
    if (f.status === 429)
    {
        return new Operation_error('rate_limited', 'The sign-in server asked for the session refresh to be made later.', {
            detail, retry_after: f.retry_after, details,
            hint: f.retry_after === undefined ? KEPT_HINT : `The stored sign-in is kept. Run the command again in ${f.retry_after} s.`,
        });
    }
    const title = f.reason ? UNAVAILABLE_TITLES[f.reason] : 'The sign-in server failed to refresh the session.';
    return new Operation_error('reply.unavailable', title, {detail, details, hint: KEPT_HINT});
};

const STORED_AFTER = {
    removed: 'the stored sign-in was removed',
    kept: 'the stored sign-in is kept',
    gone: 'another process had already signed this profile out',
};

const refresh_failed = (f: Token_failure, stored: keyof typeof STORED_AFTER): UsageError=>new UsageError('Session refresh failed.', {
    code: 'auth.refresh_failed',
    detail: `The sign-in server refused the refresh (${answered(f)}); ${STORED_AFTER[stored]}.`,
    details: refresh_details(f),
    hint: LOGIN_HINT,
});

// Under the lock: read the record again, since another process may have refreshed it while this
// one waited, and refresh only if it still needs it. The new record is stored the moment it is
// read. A record is removed only while the file still holds it, decided on the read the removal
// rewrites: a refused grant can mean another process spent the same one-time refresh token, and
// then the file holds what it stored.
const refresh_under_lock = async(
    deps: Resolve_deps & {refresh: NonNullable<Resolve_deps['refresh']>}, now: number,
): Promise<Resolved_credential>=>{
    const current = await deps.store.get(deps.key);
    if (!current)
    {
        throw not_authenticated();
    }
    if (usable(current, now))
    {
        return from_store(current);
    }
    if (current.type !== 'oauth' || !current.refresh_token)
    {
        await deps.store.remove(deps.key, r=>same_record(r, current));
        throw session_expired();
    }

    let refreshed: Oauth_record;
    try {
        refreshed = await deps.refresh(current);
    } catch (e) {
        if (!(e instanceof Token_request_error))
        {
            throw e;
        }
        const f = e.failure;
        if (f.status === 400 && f.error === 'invalid_grant')
        {
            if (await deps.store.remove(deps.key, r=>same_record(r, current)))
            {
                throw refresh_failed(f, 'removed');
            }
            const latest = await deps.store.get(deps.key);
            if (latest)
            {
                return from_store(latest);
            }
            throw refresh_failed(f, 'gone');
        }
        if (refused(f))
        {
            throw refresh_failed(f, 'kept');
        }
        // A server's own error text can be a whole HTML page; its status says enough.
        throw passing_failure(f, f.reason ? e.detail ?? '' : answered(f));
    }
    await deps.store.set(deps.key, refreshed);
    return from_store(refreshed);
};

// STRICT precedence: 1) --api-key flag  2) <PREFIX>_API_KEY env  3) stored
// credential. Flag/env are ephemeral and are never written to disk. A stored
// oauth record is refreshed when expired, one process at a time. It is removed
// only when the server refuses the grant or it has no refresh token; any other
// failure keeps it.
const resolve_credential = async(
    opts: Resolve_opts,
    deps: Resolve_deps,
): Promise<Resolved_credential>=>{
    if (opts.api_key)
    {
        return {token: opts.api_key, type: 'api_key', source: 'flag', ephemeral: true};
    }

    const env_key = get_env('API_KEY', deps.env);
    if (env_key)
    {
        return {token: env_key, type: 'api_key', source: 'env', ephemeral: true};
    }

    const record = await deps.store.get(deps.key);
    if (!record)
    {
        throw not_authenticated();
    }

    const now = deps.now ?? Date.now();
    if (usable(record, now))
    {
        return from_store(record);
    }

    const refresh = deps.refresh;
    if (!refresh)
    {
        throw session_expired();
    }

    try {
        return await deps.store.with_lock(()=>refresh_under_lock({...deps, refresh}, now));
    } catch (e) {
        if (e instanceof Lock_timeout_error)
        {
            throw passing_failure({reason: 'lock_wait'}, `${e.detail} stayed locked by another reply process.`);
        }
        throw e;
    }
};

export {resolve_credential};
export type {Resolved_credential, Resolved_source, Resolve_opts, Resolve_deps};
