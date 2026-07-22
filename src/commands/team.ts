import {Command} from 'commander';
import {PROGRAM_NAME} from '../config';
import {build_context, type Cli_context} from '../context';
import {create_client} from '../utils/client';
import {resolve_my_teams} from '../teams';
import {set_profile, unset_profile_field} from '../profile';
import {normalize_principal} from './auth';
import {authed} from './authed';
import {UsageError} from '../utils/errors';
import {success, info, print, pc, type Print_opts} from '../utils/output';

type Global_opts = {
    apiKey?: string;
    profile?: string;
    teamId?: string;
    userId?: string;
    userEmail?: string;
    json?: boolean;
    pretty?: boolean;
};

const read_globals = (cmd: Command): Global_opts=>{
    const o = cmd.optsWithGlobals();
    return {
        apiKey: o.apiKey, profile: o.profile,
        teamId: o.teamId, userId: o.userId, userEmail: o.userEmail,
        json: o.json, pretty: o.pretty,
    };
};

const wants_json = (g: Global_opts): boolean=>Boolean(g.json || g.pretty);
const print_opts = (g: Global_opts): Print_opts=>({json: g.json, pretty: g.pretty});
const profile_note = (name: string): string=>name === 'default' ? '' : ` (profile: ${name})`;

const parse_positive_int = (v: string, label: string): number=>{
    if (!/^\d+$/.test(v.trim()))
    {
        throw new UsageError(`${label} must be a positive integer.`, {code: 'usage.team', hint: `Got: ${v}`});
    }
    return parseInt(v.trim(), 10);
};

const handle_team_list = async(ctx: Cli_context, g: Global_opts): Promise<void>=>{
    const {token, headers} = await authed(ctx, g);
    const teams = await resolve_my_teams({api_base: ctx.api_base, token, headers});
    if (wants_json(g))
    {
        print({current_team_id: ctx.team_id ?? null, teams}, print_opts(g));
        return;
    }
    console.log(`Teams you can act in${profile_note(ctx.profile)}`);
    if (!teams.length)
    {
        info('  (none returned)');
        return;
    }
    for (const t of teams)
    {
        const marker = t.team_id === ctx.team_id ? pc.green('*') : ' ';
        console.log(`  ${marker} ${t.team_id}${t.team_name ? '  ' + t.team_name : ''}`);
    }
};

// Pinned team is the profile's team_id (offline). Effective team is what the
// server actually resolves — read from /whoami, best-effort: any failure becomes
// a "failed to retrieve" note rather than an error.
const handle_team_current = async(ctx: Cli_context, g: Global_opts): Promise<void>=>{
    const pinned = ctx.team_id ?? null;
    let effective: {team_id?: number; error?: string};
    try {
        const {token, headers} = await authed(ctx, g);
        const raw = await create_client(ctx.api_base, token, headers).get<Record<string, unknown>>('/v3/whoami');
        effective = {team_id: normalize_principal(raw ?? {}).team_id};
    } catch (e) {
        effective = {error: (e as Error).message};
    }
    if (wants_json(g))
    {
        print({profile: ctx.profile, pinned_team_id: pinned, effective}, print_opts(g));
        return;
    }
    const effective_str = effective.error
        ? `failed to retrieve (${effective.error})`
        : (effective.team_id ?? '(none)');
    console.log(`Profile '${ctx.profile}'`);
    console.log(`  pinned team    : ${pinned ?? '(none)'}`);
    console.log(`  effective team : ${effective_str}`);
};

const handle_team_use = async(id_arg: string, ctx: Cli_context, g: Global_opts): Promise<void>=>{
    const id = parse_positive_int(id_arg, 'Team id');
    const {token, headers} = await authed(ctx, g);
    const teams = await resolve_my_teams({api_base: ctx.api_base, token, headers});
    const match = teams.find(t=>t.team_id === id);
    if (!match)
    {
        throw new UsageError(`Team ${id} isn't one you can act in.`, {
            code: 'usage.team',
            hint: teams.length
                ? `Your teams: ${teams.map(t=>`${t.team_id} (${t.team_name})`).join(', ')}`
                : 'Run `reply team list` to see your teams.',
        });
    }
    set_profile(ctx.profile, {team_id: id});
    if (wants_json(g))
    {
        print({profile: ctx.profile, team_id: id, team_name: match.team_name}, print_opts(g));
        return;
    }
    const label = match.team_name ? ` (${match.team_name})` : '';
    success(`Profile '${ctx.profile}' team set to ${id}${label}.`);
};

const handle_team_clear = (ctx: Cli_context, g: Global_opts): void=>{
    const {changed} = unset_profile_field(ctx.profile, 'team_id');
    if (wants_json(g))
    {
        print({profile: ctx.profile, cleared: changed}, print_opts(g));
        return;
    }
    if (changed)
    {
        success(`Cleared team on profile '${ctx.profile}'.`);
        return;
    }
    info(`No team was set on '${ctx.profile}'.`);
};

const team_command = new Command('team')
    .description('See and set the current profile\'s team');

team_command
    .command('list')
    .description('List the teams you can act in')
    .addHelpText('after',
        `\nExamples:\n  ${PROGRAM_NAME} team list\n\nCalls the API (needs a stored login or --api-key).`)
    .action(async function(this: Command) {
        const g = read_globals(this);
        await handle_team_list(build_context({profile: g.profile}), g);
    });

team_command
    .command('current')
    .description('Show the current profile\'s pinned and effective team')
    .addHelpText('after',
        `\nExamples:\n  ${PROGRAM_NAME} team current\n\n`
        + 'Pinned team is read from the profile (offline); the effective team is fetched from the API.')
    .action(async function(this: Command) {
        const g = read_globals(this);
        await handle_team_current(build_context({profile: g.profile}), g);
    });

team_command
    .command('use')
    .argument('<id>', 'Team id to pin on the current profile')
    .description('Pin a team on the current profile (verified against your teams)')
    .addHelpText('after', `\nExamples:\n  ${PROGRAM_NAME} team use 1045`)
    .action(async function(this: Command, id: string) {
        const g = read_globals(this);
        await handle_team_use(id, build_context({profile: g.profile}), g);
    });

team_command
    .command('clear')
    .description('Remove the current profile\'s team pin')
    .action(function(this: Command) {
        const g = read_globals(this);
        handle_team_clear(build_context({profile: g.profile}), g);
    });

export {team_command, handle_team_list, handle_team_current, handle_team_use, handle_team_clear};
