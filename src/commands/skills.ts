import {Command} from 'commander';
import {PROGRAM_NAME} from '../config';
import {run_skills} from '../skills/orchestrate';
import {exit_code_for, human_lines} from '../skills/report';
import {RuntimeError} from '../utils/errors';
import {print, type Print_opts} from '../utils/output';
import type {Operation} from '../skills/types';

type Skills_cli_opts = {
    agent?: string[];
    project?: boolean;
    dryRun?: boolean;
    json?: boolean;
    pretty?: boolean;
};

const read_globals = (cmd: Command): Skills_cli_opts=>{
    const o = cmd.optsWithGlobals();
    return {agent: o.agent, project: o.project, dryRun: o.dryRun, json: o.json, pretty: o.pretty};
};

const wants_json = (o: Skills_cli_opts): boolean=>Boolean(o.json || o.pretty);
const print_opts = (o: Skills_cli_opts): Print_opts=>({json: o.json, pretty: o.pretty});

// One handler for all four operations: they differ only in the operation name,
// so the reporting and exit-code contract stays in exactly one place.
const handle_skills = async(
    operation: Operation,
    packs: string[],
    opts: Skills_cli_opts,
): Promise<void>=>{
    const report = await run_skills({
        operation,
        requested: packs,
        agents: opts.agent,
        project: opts.project === true,
        dry_run: opts.dryRun === true,
    });

    if (wants_json(opts))
    {
        print(report, print_opts(opts));
    }
    else
    {
        for (const line of human_lines(report))
        {
            console.error(line);
        }
    }

    // The report is printed either way: exiting non-zero without it would hide
    // why each host failed.
    if (exit_code_for(report) !== 0)
    {
        throw new RuntimeError('No assistant received the skills.', {
            code: 'skills.nothing_installed',
            hint: `run \`${PROGRAM_NAME} skills install --dry-run\` to see what was attempted`,
        });
    }
};

const skills_command = new Command('skills')
    .description('Install and manage Reply skill packs in your AI assistants');

const with_flags = (cmd: Command): Command=>cmd
    .option('-a, --agent <id...>', 'Target these assistants instead of auto-detecting')
    .option('--project', 'Install into the current repository instead of your user directory')
    .option('--dry-run', 'Show what would happen and change nothing');

const packs_help = `
Packs: ai-sdr-core (alias core) · reply-adapter (adapter) · agentic-runtime (runtime).
No pack means all three; dependencies are resolved for you.`;

with_flags(skills_command
    .command('install')
    .argument('[packs...]', 'Packs to install (default: all three)')
    .description('Install Reply skill packs into every detected assistant'))
    .addHelpText('after', `${packs_help}

Examples:
  ${PROGRAM_NAME} skills install
  ${PROGRAM_NAME} skills install core
  ${PROGRAM_NAME} skills install adapter runtime
  ${PROGRAM_NAME} skills install --agent codex --json`)
    .action(async function(this: Command, packs: string[]) {
        await handle_skills('install', packs, read_globals(this));
    });

with_flags(skills_command
    .command('list')
    .argument('[packs...]', 'Limit the listing to these packs')
    .description('Show which packs are installed in which assistant'))
    .addHelpText('after', `${packs_help}

Examples:
  ${PROGRAM_NAME} skills list
  ${PROGRAM_NAME} skills list --json`)
    .action(async function(this: Command, packs: string[]) {
        await handle_skills('list', packs, read_globals(this));
    });

with_flags(skills_command
    .command('update')
    .argument('[packs...]', 'Packs to update (default: all installed)')
    .description('Update installed packs to the latest published version'))
    .addHelpText('after', `${packs_help}

Examples:
  ${PROGRAM_NAME} skills update
  ${PROGRAM_NAME} skills update --dry-run`)
    .action(async function(this: Command, packs: string[]) {
        await handle_skills('update', packs, read_globals(this));
    });

with_flags(skills_command
    .command('remove')
    .argument('[packs...]', 'Packs to remove (default: all of them)')
    .description('Remove Reply skill packs from your assistants'))
    .addHelpText('after', `${packs_help}
Removing a pack that another installed pack depends on is refused — remove both,
or run \`${PROGRAM_NAME} skills remove\` with no pack to remove everything.

Examples:
  ${PROGRAM_NAME} skills remove
  ${PROGRAM_NAME} skills remove runtime`)
    .action(async function(this: Command, packs: string[]) {
        await handle_skills('remove', packs, read_globals(this));
    });

export {skills_command, handle_skills};
