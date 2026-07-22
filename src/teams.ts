import {request_raw} from './utils/client';
import {RuntimeError} from './utils/errors';

type Team = {team_id: number; team_name: string};

const TEAM_USERS_ENDPOINT = '/whoami/team-users';
const TEAMS_IN_BODY_CODES = ['TEAM_REQUIRED', 'TEAM_NOT_ACCESSIBLE'];

const read_team = (item: unknown): Team | undefined=>{
    if (typeof item !== 'object' || item === null)
    {
        return undefined;
    }
    const rec = item as Record<string, unknown>;
    const id = rec.teamId ?? rec.TeamId;
    const name = rec.teamName ?? rec.TeamName;
    if (typeof id !== 'number' || !Number.isInteger(id))
    {
        return undefined;
    }
    return {team_id: id, team_name: typeof name === 'string' ? name : ''};
};

// Reduce an array of team-ish objects to distinct teams (by id), dropping malformed.
const parse_teams = (raw: unknown): Team[]=>{
    if (!Array.isArray(raw))
    {
        return [];
    }
    const seen = new Set<number>();
    const out: Team[] = [];
    for (const item of raw)
    {
        const t = read_team(item);
        if (t && !seen.has(t.team_id))
        {
            seen.add(t.team_id);
            out.push(t);
        }
    }
    return out;
};

type Teams_deps = {api_base: string; token: string; headers?: Record<string, string>};

// The teams the caller can act in. Resilient: the list is the same whether
// /whoami/team-users returns 200, or a TEAM_REQUIRED/TEAM_NOT_ACCESSIBLE 403
// (whose body carries the same teams[]). Any other outcome throws — the caller
// decides how to degrade.
const resolve_my_teams = async(deps: Teams_deps): Promise<Team[]>=>{
    const {status, data} = await request_raw(
        deps.api_base, deps.token, 'GET', TEAM_USERS_ENDPOINT, undefined, {headers: deps.headers});
    if (status >= 200 && status < 300)
    {
        return parse_teams(data);
    }
    const body = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
    const code = typeof body.code === 'string' ? body.code : undefined;
    if (status === 403 && code && TEAMS_IN_BODY_CODES.includes(code))
    {
        return parse_teams(body.teams);
    }
    throw new RuntimeError('Could not list your teams.', {
        code: 'teams.unavailable',
        detail: code ? `HTTP ${status}: ${code}` : `HTTP ${status}`,
        hint: 'Make sure you are logged in.',
    });
};

const RESOLUTION_CODES = ['TEAM_REQUIRED', 'TEAM_NOT_ACCESSIBLE', 'USER_REQUIRED', 'USER_NOT_FOUND'];

const render_teams = (teams: Team[]): string=>
    teams.map(t=>`    ${t.team_id}  ${t.team_name}`).join('\n');

// Tailored guidance for a WORKLOAD team/user-resolution conflict (used by `api`).
// Returns undefined when the body is not a recognized resolution error.
const team_error_guidance = (status: number, data: unknown): string | undefined=>{
    const body = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
    const code = typeof body.code === 'string' ? body.code : undefined;
    if (!code || !RESOLUTION_CODES.includes(code))
    {
        return undefined;
    }
    const teams = parse_teams(body.teams);
    const list = teams.length ? `\n${render_teams(teams)}` : '';
    switch (code)
    {
        case 'TEAM_REQUIRED':
            return 'You belong to multiple teams. Choose one:\n'
                + '  reply team use <id>   (or --team-id <id>, REPLY_TEAM_ID, or profile set <name> --team-id <id>)'
                + list;
        case 'TEAM_NOT_ACCESSIBLE':
            return `That team isn't one you can act in. Your teams:${list}`;
        case 'USER_REQUIRED':
            return 'This organization API key needs an acting user — pass --user-id <id> or --user-email <email>.';
        default:   // USER_NOT_FOUND
            return "No Reply user maps to this credential — check you're logged in with the right account.";
    }
};

export {parse_teams, resolve_my_teams, team_error_guidance};
export type {Team, Teams_deps};
