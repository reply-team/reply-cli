import readline from 'readline';
import {Command} from 'commander';
import {
    current_profile_name, list_profiles, set_current_profile, add_profile, set_profile,
    rename_profile_def, delete_profile_def, unset_profile_field, describe_profile,
    type Clearable_field, type Profile_description,
} from '../profile';
import {default_credential_store} from '../credentials/file-store';
import {describe_status, type Auth_status} from '../auth/status';
import {principal_label} from './auth';
import {UsageError} from '../utils/errors';
import {PROGRAM_NAME, get_env, env_var, type Env} from '../config';
import {success, info, print, pc, type Print_opts} from '../utils/output';
import type {CredentialStore, Credential_record} from '../credentials/types';

type Global_opts = {json?: boolean; pretty?: boolean; apiKey?: string};

const read_globals = (cmd: Command): Global_opts=>{
    const o = cmd.optsWithGlobals();
    return {json: o.json, pretty: o.pretty, apiKey: o.apiKey};
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

const parse_url = (v?: string): string | undefined=>{
    if (v === undefined)
    {
        return undefined;
    }
    const s = v.trim();
    let parsed: URL;
    try {
        parsed = new URL(s);
    } catch {
        throw new UsageError('--authority/--api-base must be an http(s) URL.', {
            code: 'usage.profile', hint: `Got: ${v}`,
        });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    {
        throw new UsageError('--authority/--api-base must be an http(s) URL.', {
            code: 'usage.profile', hint: `Got: ${v}`,
        });
    }
    return s;
};

// User-facing field names for `unset` (hyphenated) mapped to config keys.
const CLEARABLE_INPUT: Record<string, Clearable_field> = {
    'authority': 'authority',
    'api_base': 'api_base',
    'api-base': 'api_base',
    'team_id': 'team_id',
    'team-id': 'team_id',
};

const map_clearable = (field: string): Clearable_field=>{
    const mapped = CLEARABLE_INPUT[field.trim().toLowerCase()];
    if (!mapped)
    {
        throw new UsageError(`Can't clear '${field}'.`, {
            code: 'usage.profile', hint: 'Clearable fields: authority, api_base, team-id.',
        });
    }
    return mapped;
};

// Interactive y/N prompt on stderr (so JSON stdout stays clean). Injected in
// tests. Anything not starting with y/yes is treated as "no".
const confirm = (question: string): Promise<boolean>=>{
    const rl = readline.createInterface({input: process.stdin, output: process.stderr});
    return new Promise<boolean>(resolve=>{
        rl.question(`${question} [y/N] `, answer=>{
            rl.close();
            resolve(/^y(es)?$/i.test(answer.trim()));
        });
    });
};

type Rename_deps = {store: CredentialStore; env?: Env};

// Rename orchestration. Ordering (two files, no cross-file transaction — never
// lose or clobber a login): (1) refuse if a credential already lives under the
// target key; (2) read the old credential; (3) rename the config def; (4) move
// the credential. A partial failure orphans the old credential (recoverable by
// re-login), never destroys it.
const handle_rename = async(
    old_name: string, new_name: string, g: Global_opts, deps: Rename_deps,
): Promise<void>=>{
    const env = deps.env ?? process.env;
    if (await deps.store.get(new_name))
    {
        throw new UsageError(`A credential already exists for '${new_name}'.`, {
            code: 'usage.profile', hint: `Log out of '${new_name}' or pick another name.`,
        });
    }
    const cred = await deps.store.get(old_name);
    rename_profile_def(old_name, new_name, env);
    let credential_moved = false;
    if (cred)
    {
        await deps.store.set(new_name, cred);
        await deps.store.remove(old_name);
        credential_moved = true;
    }
    const current_updated = current_profile_name(env) === new_name;
    if (wants_json(g))
    {
        print({renamed: {from: old_name, to: new_name}, current_updated, credential_moved}, print_opts(g));
        return;
    }
    success(`Renamed profile '${old_name}' → '${new_name}'.`);
    if (current_updated)
    {
        info('  (was the current profile)');
    }
};

type Delete_deps = {
    store: CredentialStore;
    env?: Env;
    is_tty?: boolean;
    confirm?: (q: string) => Promise<boolean>;
};

// Delete a profile and its stored credential. Validated before prompting so a
// bad name fails fast. Confirm-by-default: interactive y/N on a TTY, `--yes`
// skips it, and a non-interactive shell without `--yes` is refused.
const handle_delete = async(
    name: string, opts: {yes?: boolean}, g: Global_opts, deps: Delete_deps,
): Promise<void>=>{
    const env = deps.env ?? process.env;
    if (name === 'default')
    {
        throw new UsageError('The built-in default profile can\'t be deleted.', {code: 'usage.profile'});
    }
    if (!list_profiles(env).available.includes(name))
    {
        throw new UsageError(`Unknown profile '${name}'.`, {
            code: 'usage.profile', hint: 'List profiles with `profile list`.',
        });
    }
    if (!opts.yes)
    {
        const is_tty = deps.is_tty ?? Boolean(process.stdin.isTTY);
        if (!is_tty)
        {
            throw new UsageError('Refusing to delete without confirmation.', {
                code: 'usage.profile', hint: 'Pass --yes to confirm in a non-interactive shell.',
            });
        }
        const ask = deps.confirm ?? confirm;
        if (!await ask(`Delete profile '${name}' and its stored credential?`))
        {
            info('Aborted.');
            return;
        }
    }
    const {was_current} = delete_profile_def(name, env);
    const credential_removed = await deps.store.remove(name);
    if (wants_json(g))
    {
        print({deleted: name, credential_removed, current_reset: was_current}, print_opts(g));
        return;
    }
    success(`Deleted profile '${name}'.`);
    if (credential_removed)
    {
        info('  Removed its stored credential.');
    }
    if (was_current)
    {
        info('  Current profile reset to default.');
    }
};

type Show_deps = {store: CredentialStore; env?: Env; api_key_flag?: string};

// Redacted, one-line summary of the stored credential — never a raw secret.
const stored_summary = (status: Auth_status, record?: Credential_record): string=>{
    if (!record)
    {
        return 'none — run `reply auth login`';
    }
    const who = record.user ? principal_label(record.user) : 'unknown';
    if (status.method === 'oauth')
    {
        return `oauth · ${who} · expires ${status.expires_at}${status.expired ? pc.red(' (expired)') : ''}`;
    }
    return `api_key · ${who}`;
};

const show_json = (
    d: Profile_description, status: Auth_status,
    has_flag: boolean, has_env: boolean, record?: Credential_record,
)=>({
    name: d.name,
    current: d.is_current,
    backend: {authority: d.authority, api_base: d.api_base, inherited: d.inherited},
    team_id: d.team_id ?? null,
    authorization: {
        flag: has_flag,
        env: has_env,
        stored: record
            ? {
                present: true,
                method: status.method,
                ...(status.user ? {user: status.user} : {}),
                ...(status.expires_at ? {expires_at: status.expires_at, expired: status.expired} : {}),
            }
            : null,
        effective_source: status.authenticated ? status.source : null,
    },
});

// Show a profile's backend, team, and authorization. Reads the stored credential
// raw (no refresh, no write) and reuses describe_status for a secret-free summary.
const handle_show = async(
    name: string | undefined, g: Global_opts, deps: Show_deps,
): Promise<void>=>{
    const env = deps.env ?? process.env;
    const target = name ?? current_profile_name(env);
    const d = describe_profile(target, env);
    const api_key_env = get_env('API_KEY', env);
    const record = await deps.store.get(target);
    const status = describe_status({
        profile: target, api_key_flag: deps.api_key_flag, api_key_env, record, now: Date.now(),
    });
    if (wants_json(g))
    {
        print(show_json(d, status, Boolean(deps.api_key_flag), Boolean(api_key_env), record), print_opts(g));
        return;
    }
    const inh = (on: boolean): string=>on ? '   (inherited)' : '';
    const lines = [
        `Profile: ${d.name}${d.is_current ? '  (current)' : ''}`,
        '  Backend:',
        `    authority : ${d.authority}${inh(d.inherited.authority)}`,
        `    api_base  : ${d.api_base}${inh(d.inherited.api_base)}`,
        '  Team:',
        `    team_id   : ${d.team_id ?? '—'}`,
        '  Authorization (first available is used):',
        `    1. --api-key flag     : ${deps.api_key_flag ? 'provided' : 'not provided'}`,
        `    2. ${env_var('API_KEY')} env  : ${api_key_env ? 'set' : 'not set'}`,
        `    3. stored credential  : ${stored_summary(status, record)}`,
    ];
    console.log(lines.join('\n'));
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
    .addHelpText('after',
        `\nExamples:\n  ${PROGRAM_NAME} profile add alice@reply.io`
        + `\n  ${PROGRAM_NAME} profile add dev --api-base https://api.dev.reply.io --team-id 1045`)
    .action(function(this: Command, name: string) {
        const g = read_globals(this);
        const opts = this.optsWithGlobals();
        add_profile(name, {
            authority: parse_url(opts.authority), api_base: parse_url(opts.apiBase), team_id: parse_team_id(opts.teamId),
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
    .addHelpText('after',
        `\nExamples:\n  ${PROGRAM_NAME} profile set alice@reply.io --team-id 1045`
        + `\n  ${PROGRAM_NAME} profile set default --team-id 1045   # pin a team globally`)
    .action(function(this: Command, name: string) {
        const g = read_globals(this);
        const opts = this.optsWithGlobals();
        set_profile(name, {
            authority: parse_url(opts.authority), api_base: parse_url(opts.apiBase), team_id: parse_team_id(opts.teamId),
        });
        if (wants_json(g))
        {
            print({updated: name}, print_opts(g));
            return;
        }
        success(`Profile '${name}' updated.`);
    });

profile_command
    .command('rename')
    .argument('<old>', 'Existing profile to rename')
    .argument('<new>', 'New name')
    .description('Rename a profile (also moves its stored credential)')
    .addHelpText('after', `\nExamples:\n  ${PROGRAM_NAME} profile rename alice@reply.io ally`)
    .action(async function(this: Command, old_name: string, new_name: string) {
        const g = read_globals(this);
        await handle_rename(old_name, new_name, g, {store: default_credential_store()});
    });

profile_command
    .command('delete')
    .alias('rm')
    .argument('<name>', 'Profile to delete')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .description('Delete a profile and its stored credential')
    .addHelpText('after',
        `\nExamples:\n  ${PROGRAM_NAME} profile delete ally          # confirm y/N (interactive)`
        + `\n  ${PROGRAM_NAME} profile delete ally --yes    # skip the prompt (required in scripts)`)
    .action(async function(this: Command, name: string) {
        const g = read_globals(this);
        await handle_delete(name, {yes: Boolean(this.opts().yes)}, g, {store: default_credential_store()});
    });

profile_command
    .command('use')
    .argument('<name>', 'Profile to make current (a user-defined profile, or "default" for prod)')
    .description('Set the current profile, used until changed')
    .addHelpText('after',
        `\nExamples:\n  ${PROGRAM_NAME} profile use dev\n  ${PROGRAM_NAME} profile use default`)
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
    .command('unset')
    .argument('<name>', 'Profile to edit (or "default")')
    .argument('<field>', 'Field to clear: authority | api_base | team-id')
    .description('Clear a config field on a profile (reverts to inherited/unset)')
    .addHelpText('after', `\nExamples:\n  ${PROGRAM_NAME} profile unset dev team-id`)
    .action(function(this: Command, name: string, field: string) {
        const g = read_globals(this);
        const mapped = map_clearable(field);
        const {changed} = unset_profile_field(name, mapped, process.env);
        if (wants_json(g))
        {
            print({unset: mapped, profile: name, changed}, print_opts(g));
            return;
        }
        if (changed)
        {
            success(`Cleared ${mapped} on profile '${name}'.`);
            return;
        }
        info(`${mapped} was already not set on '${name}'.`);
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

profile_command
    .command('show')
    .argument('[name]', 'Profile to show (default: current)')
    .description('Show a profile\'s backend, team, and authorization (no secrets)')
    .addHelpText('after',
        `\nExamples:\n  ${PROGRAM_NAME} profile show          # the current profile`
        + `\n  ${PROGRAM_NAME} profile show dev --json`)
    .action(async function(this: Command, name?: string) {
        const g = read_globals(this);
        await handle_show(name, g, {store: default_credential_store(), api_key_flag: g.apiKey});
    });

export {profile_command, handle_rename, handle_delete, handle_show, parse_url};
