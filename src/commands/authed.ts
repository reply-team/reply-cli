import {resolve_credential} from '../auth/resolve';
import {resolve_request_identity} from '../auth/request-identity';
import {warn} from '../utils/output';
import type {Cli_context} from '../context';

type Identity_opts = {apiKey?: string; teamId?: string; userId?: string; userEmail?: string};

// Resolve the credential + team/acting-user headers for an authenticated call,
// surfacing identity warnings to stderr. Shared by the team and api commands
// (mirrors how the auth commands resolve the same pair).
const authed = async(
    ctx: Cli_context, g: Identity_opts,
): Promise<{token: string; headers: Record<string, string>}>=>{
    const resolved = await resolve_credential(
        {api_key: g.apiKey}, {key: ctx.key, store: ctx.store, env: process.env, refresh: ctx.refresh});
    const identity = resolve_request_identity({
        team_id_flag: g.teamId, user_id_flag: g.userId, user_email_flag: g.userEmail,
        env: process.env, profile_team_id: ctx.team_id, credential_type: resolved.type,
    });
    identity.warnings.forEach(w=>warn(w));
    return {token: resolved.token, headers: identity.headers};
};

export {authed};
export type {Identity_opts};
