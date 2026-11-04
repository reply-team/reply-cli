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

// What exiting 1 means, per operation. `exit_code_for` already branches on the
// action; telling a failed `remove` that "no assistant received the skills"
// and pointing it at `install --dry-run` misdirects the one user who most
// needs the right command. `list` never exits 1 (it is a query), but the map
// stays total so a new operation cannot silently inherit the wrong wording.
const NOTHING_HAPPENED: Record<Operation, {title: string; code: string; probe: string}> = {
    install: {
        title: 'No assistant received the skills.',
        code: 'skills.nothing_installed',
        probe: 'install --dry-run',
    },
    update: {
        title: 'No assistant was updated.',
        code: 'skills.nothing_updated',
        probe: 'update --dry-run',
    },
    remove: {
        title: 'No assistant had the skills removed.',
        code: 'skills.nothing_removed',
        probe: 'remove --dry-run',
    },
    list: {
        title: 'No assistant could be queried.',
        code: 'skills.nothing_listed',
        probe: 'list --json',
    },
};

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
        // `list` is a data command, so its table is what the user redirects —
        // it goes to stdout. Every other operation prints progress, which is
        // status and belongs on stderr (see utils/output.ts).
        const write = report.action === 'list' ? console.log : console.error;
        for (const line of human_lines(report))
        {
            write(line);
        }
    }

    // The report is printed either way: exiting non-zero without it would hide
    // why each host failed.
    if (exit_code_for(report) !== 0)
    {
        const failure = NOTHING_HAPPENED[operation];
        throw new RuntimeError(failure.title, {
            code: failure.code,
            hint: `run \`${PROGRAM_NAME} skills ${failure.probe}\` to see what was attempted`,
        });
    }
};

const skills_command = new Command('skills')
    .description('Install and manage the Reply skills in your AI assistants');

const with_flags = (cmd: Command): Command=>cmd
    .option('-a, --agent <id...>', 'Target these assistants instead of auto-detecting')
    .option('--project', 'Install into the current repository instead of your user directory')
    .option('--dry-run', 'Show what would happen and change nothing');

const packs_help = `
Pack: reply-adapter (alias adapter), the skills this CLI ships, at its own version.
No pack means it.`;

with_flags(skills_command
    .command('install')
    .argument('[packs...]', 'Pack to install (default: reply-adapter)')
    .description('Copy the Reply skills from this package into every detected assistant'))
    .addHelpText('after', `${packs_help}

Examples:
  ${PROGRAM_NAME} skills install
  ${PROGRAM_NAME} skills install --project
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
    .argument('[packs...]', 'Pack to update (default: reply-adapter, where installed)')
    .description('Bring the installed skills to the version of this CLI'))
    .addHelpText('after', `${packs_help}

Examples:
  ${PROGRAM_NAME} skills update
  ${PROGRAM_NAME} skills update --dry-run`)
    .action(async function(this: Command, packs: string[]) {
        await handle_skills('update', packs, read_globals(this));
    });

with_flags(skills_command
    .command('remove')
    .argument('[packs...]', 'Packs to remove (default: everything this CLI installed)')
    .description('Remove the Reply skills from your assistants'))
    .addHelpText('after', `${packs_help}
Remove also takes the names of packs an earlier version installed, and with no
pack removes everything this CLI ever installed.

Examples:
  ${PROGRAM_NAME} skills remove
  ${PROGRAM_NAME} skills remove adapter --project`)
    .action(async function(this: Command, packs: string[]) {
        await handle_skills('remove', packs, read_globals(this));
    });

export {skills_command, handle_skills};
