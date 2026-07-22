#!/usr/bin/env node
import {Command, CommanderError} from 'commander';
import {PROGRAM_NAME, cli_version} from './config';
import {auth_command} from './commands/auth';
import {profile_command} from './commands/profile';
import {CliError} from './utils/errors';

// Route every command through commander's throwing mode so usage errors reach
// our handler and map to exit code 2 (vs 1 for runtime/API failures).
const set_exit_override = (cmd: Command): void=>{
    cmd.exitOverride();
    for (const sub of cmd.commands)
    {
        set_exit_override(sub);
    }
};

const build_program = (): Command=>{
    const program = new Command();
    const PREFIX = PROGRAM_NAME.toUpperCase();
    program
        .name(PROGRAM_NAME)
        .description('Command-line interface for Reply.io — authentication and identity (v1).')
        .version(cli_version(), '-v, --version')
        .option('-k, --api-key <key>', 'API key (overrides env var and stored credential)')
        .option('-p, --profile <name>', 'Named backend profile (default: prod)')
        .option('--team-id <id>', `Team/workspace to act in (X-TEAM-ID); else ${PREFIX}_TEAM_ID or the profile`)
        .option('--user-id <id>', 'Act as this user id — organization API keys only (X-USER-ID)')
        .option('--user-email <email>', 'Act as this user email — organization API keys only (needs a team id)')
        .option('--json', 'Output compact JSON to stdout')
        .option('--pretty', 'Output indented JSON to stdout')
        .showHelpAfterError();

    program.addCommand(auth_command);
    program.addCommand(profile_command);

    program.addHelpText('after', `
Credential precedence:
  1. --api-key <key>   2. ${PREFIX}_API_KEY env   3. stored credential

Profiles (which backend to talk to):
  Precedence: --profile <name>  >  ${PREFIX}_PROFILE  >  current profile  >  default (prod).
  Define your own profiles under "profiles" in the config file, e.g.:
    { "profiles": { "dev": { "authority": "https://…", "api_base": "https://…/v3" } } }
  Then set one as current so you don't repeat --profile:
    ${PROGRAM_NAME} profile use dev        # used until you change it
    ${PROGRAM_NAME} profile list           # see all, * marks current
    ${PROGRAM_NAME} profile current
    ${PROGRAM_NAME} profile show [name]    # backend, team, auth (no secrets)
    ${PROGRAM_NAME} profile rename <old> <new>
    ${PROGRAM_NAME} profile delete <name>  # also removes its stored credential
    ${PROGRAM_NAME} profile unset <name> <field>   # clear authority|api_base|team-id

Team & acting user (headers):
  --team-id <id>    Team/workspace to act in. Precedence: --team-id > ${PREFIX}_TEAM_ID > profile team_id.
                    Pin one on a profile: ${PROGRAM_NAME} profile set <name> --team-id <id>
  --user-id <id> / --user-email <email>   Identify the acting user for an ORGANIZATION API key.
                    Flag-only (never env, never stored); pass exactly one; --user-email also needs a team id.

Configuration (env vars):
  ${PREFIX}_API_KEY      API key used as the bearer credential
  ${PREFIX}_PROFILE      Profile to use (same as --profile)
  ${PREFIX}_TEAM_ID      Team/workspace id (same as --team-id)
  ${PREFIX}_CONFIG_DIR   Override the per-user config directory

Examples:
  ${PROGRAM_NAME} auth login
  echo <key> | ${PROGRAM_NAME} auth login --with-token
  ${PROGRAM_NAME} --profile dev auth whoami --json
  ${PROGRAM_NAME} auth status
`);

    return program;
};

const wants_json = (): boolean=>
    process.argv.includes('--json') || process.argv.includes('--pretty');

const main = async(): Promise<void>=>{
    const program = build_program();
    set_exit_override(program);
    await program.parseAsync(process.argv);
};

void main().catch((error: unknown)=>{
    if (error instanceof CommanderError)
    {
        // commander has already written help/usage text; help & version exit 0,
        // any other usage problem exits 2.
        const ok = error.code === 'commander.helpDisplayed'
            || error.code === 'commander.version'
            || error.code === 'commander.help';
        process.exit(ok ? 0 : 2);
    }
    if (error instanceof CliError)
    {
        if (wants_json())
        {
            console.error(JSON.stringify(error.to_json()));
        }
        else
        {
            console.error(error.message);
        }
        process.exit(error.exit_code);
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

export {build_program};
