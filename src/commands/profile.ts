import {Command} from 'commander';
import {current_profile_name, list_profiles, set_current_profile, add_profile, set_profile} from '../profile';
import {UsageError} from '../utils/errors';
import {success, print, pc, type Print_opts} from '../utils/output';

type Global_opts = {json?: boolean; pretty?: boolean};

const read_globals = (cmd: Command): Global_opts=>{
    const o = cmd.optsWithGlobals();
    return {json: o.json, pretty: o.pretty};
};

const wants_json = (g: Global_opts): boolean=>Boolean(g.json || g.pretty);
const print_opts = (g: Global_opts): Print_opts=>({json: g.json, pretty: g.pretty});

const parse_team_id = (v?: string): number | undefined=>{
    if (v === undefined)
    {
        return undefined;
    }
    if (!/^\d+$/.test(v.trim()))
    {
        throw new UsageError('--team-id must be a positive integer.', {code: 'usage.profile', hint: `Got: ${v}`});
    }
    return parseInt(v.trim(), 10);
};

const profile_command = new Command('profile')
    .description('Manage profiles — optional; most users never need one (default = prod)');

profile_command
    .command('add')
    .argument('<name>', 'Profile name (e.g. your account email)')
    .option('--team-id <id>', 'Pin a team/workspace for this profile (sent as X-TEAM-ID)')
    .option('--authority <url>', 'Override the OAuth authority (advanced; defaults to prod)')
    .option('--api-base <url>', 'Override the API base (advanced; defaults to prod)')
    .description('Create a profile (URLs optional — omitted fields inherit the default/prod)')
    .action(function(this: Command, name: string) {
        const g = read_globals(this);
        const opts = this.optsWithGlobals();
        add_profile(name, {
            authority: opts.authority, api_base: opts.apiBase, team_id: parse_team_id(opts.teamId),
        });
        if (wants_json(g))
        {
            print({added: name}, print_opts(g));
            return;
        }
        success(`Profile '${name}' created. Make it current with: profile use ${name}`);
    });

profile_command
    .command('set')
    .argument('<name>', 'Profile to edit (a user profile, or "default" to pin a team globally)')
    .option('--team-id <id>', 'Pin a team/workspace (sent as X-TEAM-ID)')
    .option('--authority <url>', 'Override the OAuth authority (advanced)')
    .option('--api-base <url>', 'Override the API base (advanced)')
    .description('Edit an existing profile in place — only the fields you pass change')
    .action(function(this: Command, name: string) {
        const g = read_globals(this);
        const opts = this.optsWithGlobals();
        set_profile(name, {
            authority: opts.authority, api_base: opts.apiBase, team_id: parse_team_id(opts.teamId),
        });
        if (wants_json(g))
        {
            print({updated: name}, print_opts(g));
            return;
        }
        success(`Profile '${name}' updated.`);
    });

profile_command
    .command('use')
    .argument('<name>', 'Profile to make current (a user-defined profile, or "default" for prod)')
    .description('Set the current profile, used until changed')
    .action(function(this: Command, name: string) {
        const g = read_globals(this);
        set_current_profile(name);
        if (wants_json(g))
        {
            print({current: name}, print_opts(g));
            return;
        }
        success(`Current profile set to ${name}.`);
    });

profile_command
    .command('list')
    .description('List available profiles and show which is current')
    .action(function(this: Command) {
        const g = read_globals(this);
        const {current, available} = list_profiles();
        if (wants_json(g))
        {
            print({current, available}, print_opts(g));
            return;
        }
        for (const name of available)
        {
            const marker = name === current ? pc.green('*') : ' ';
            console.log(`${marker} ${name}`);
        }
    });

profile_command
    .command('current')
    .description('Print the current profile name')
    .action(function(this: Command) {
        const g = read_globals(this);
        const current = current_profile_name();
        print(wants_json(g) ? {current} : current, print_opts(g));
    });

export {profile_command};
