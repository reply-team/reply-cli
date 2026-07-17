import {PROGRAM_NAME, env_var, get_env, type Env} from '../config';
import {UsageError} from '../utils/errors';
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

// STRICT precedence: 1) --api-key flag  2) <PREFIX>_API_KEY env  3) stored
// credential. Flag/env are ephemeral and are never written to disk. A stored
// oauth record is refreshed when expired; if that fails it is cleared and the
// user is told to log in again.
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
        throw new UsageError('Not authenticated.', {
            code: 'auth.required',
            hint: `Run \`${PROGRAM_NAME} auth login\` or set ${env_var('API_KEY')}.`,
        });
    }

    if (record.type === 'api_key')
    {
        return {token: record.key, type: 'api_key', source: 'store', ephemeral: false, record};
    }

    const now = deps.now ?? Date.now();
    if (!needs_refresh(record, now))
    {
        return {token: record.access_token, type: 'oauth', source: 'store', ephemeral: false, record};
    }

    if (!record.refresh_token || !deps.refresh)
    {
        await deps.store.remove(deps.key);
        throw new UsageError('Session expired.', {
            code: 'auth.expired',
            hint: `Run \`${PROGRAM_NAME} auth login\` to sign in again.`,
        });
    }

    let refreshed: Oauth_record;
    try {
        refreshed = await deps.refresh(record);
    } catch {
        await deps.store.remove(deps.key);
        throw new UsageError('Session refresh failed.', {
            code: 'auth.refresh_failed',
            hint: `Run \`${PROGRAM_NAME} auth login\` to sign in again.`,
        });
    }
    await deps.store.set(deps.key, refreshed);
    return {token: refreshed.access_token, type: 'oauth', source: 'store', ephemeral: false, record: refreshed};
};

export {resolve_credential};
export type {Resolved_credential, Resolved_source, Resolve_opts, Resolve_deps};
