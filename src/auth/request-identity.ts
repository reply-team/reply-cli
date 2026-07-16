import {env_var, get_env, type Env} from '../config';
import {UsageError} from '../utils/errors';
import {HEADER_TEAM_ID, HEADER_USER_ID, HEADER_USER_EMAIL} from '../api/headers';

// Extra headers to attach to an authenticated API call, plus any non-fatal
// notes for the user. Kept a pure value so it is unit-testable — printing the
// warnings is the command's job.
type Request_identity = {
    headers: Record<string, string>;
    warnings: string[];
};

type Resolve_identity_input = {
    team_id_flag?: string;
    user_id_flag?: string;
    user_email_flag?: string;
    env?: Env;
    profile_team_id?: number;
    credential_type: 'oauth' | 'api_key';
};

const present = (v?: string): v is string=>v !== undefined && v.trim() !== '';

const parse_int_field = (value: string, label: string): number=>{
    if (!/^\d+$/.test(value.trim()))
    {
        throw new UsageError(`${label} must be a positive integer.`, {
            code: 'usage.identity', hint: `Got: ${value}`,
        });
    }
    return parseInt(value.trim(), 10);
};

// Resolve the team/acting-user headers for a request.
//   team id: --team-id  >  REPLY_TEAM_ID  >  profile team_id
//   user id / user email: flag only (never env, never persisted)
// The header is emitted only when its value resolves; there is no gating on the
// credential type (harmless where the server ignores it, required for org keys).
const resolve_request_identity = (input: Resolve_identity_input): Request_identity=>{
    const env = input.env ?? process.env;

    const has_user_id = present(input.user_id_flag);
    const has_user_email = present(input.user_email_flag);
    if (has_user_id && has_user_email)
    {
        throw new UsageError('Pass only one of --user-id or --user-email.', {
            code: 'usage.identity',
            hint: 'Both identify the acting user for an organization API key — use one.',
        });
    }

    let team_id: number | undefined;
    const env_team = get_env('TEAM_ID', env);
    if (present(input.team_id_flag))
    {
        team_id = parse_int_field(input.team_id_flag, 'Team id (--team-id)');
    }
    else if (present(env_team))
    {
        team_id = parse_int_field(env_team, `Team id (${env_var('TEAM_ID')})`);
    }
    else if (input.profile_team_id !== undefined)
    {
        team_id = input.profile_team_id;
    }

    const user_id = has_user_id ? parse_int_field(input.user_id_flag as string, 'User id (--user-id)') : undefined;
    const user_email = has_user_email ? (input.user_email_flag as string).trim() : undefined;

    if (user_email !== undefined && team_id === undefined)
    {
        throw new UsageError('--user-email requires a team id.', {
            code: 'usage.identity',
            hint: `Supply it via --team-id, ${env_var('TEAM_ID')}, or the profile's team_id.`,
        });
    }

    const headers: Record<string, string> = {};
    if (team_id !== undefined)
    {
        headers[HEADER_TEAM_ID] = String(team_id);
    }
    if (user_id !== undefined)
    {
        headers[HEADER_USER_ID] = String(user_id);
    }
    if (user_email !== undefined)
    {
        headers[HEADER_USER_EMAIL] = user_email;
    }

    const warnings: string[] = [];
    if (input.credential_type === 'oauth' && (has_user_id || has_user_email))
    {
        warnings.push(
            '--user-id/--user-email have no effect with an OAuth login; they apply to organization API keys.');
    }

    return {headers, warnings};
};

export {resolve_request_identity};
export type {Request_identity, Resolve_identity_input};
