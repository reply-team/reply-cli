import {Command} from 'commander';
import {PROGRAM_NAME} from '../config';
import {run_install} from '../selfupdate/install';
import {RuntimeError} from '../utils/errors';
import {info, print, success, warn, type Print_opts} from '../utils/output';
import type {Install_report} from '../selfupdate/install';

type Install_cli_opts = {
    dryRun?: boolean;
    json?: boolean;
    pretty?: boolean;
};

const wants_json = (o: Install_cli_opts): boolean=>Boolean(o.json || o.pretty);
const print_opts = (o: Install_cli_opts): Print_opts=>({json: o.json, pretty: o.pretty});

// npm's own output would be status, not data, so nothing here writes to stdout
// unless --json was asked for.
const human_report = (report: Install_report, dry_run: boolean): void=>{
    if (report.action === 'current')
    {
        success(`${PROGRAM_NAME} ${report.current} is the newest release`);
        return;
    }
    if (report.action === 'updated')
    {
        success(`${PROGRAM_NAME} ${report.current} → ${report.latest} installed`);
        return;
    }
    if (report.action === 'failed')
    {
        warn(`Could not update automatically: ${report.detail}.`);
        if (report.npm_output)
        {
            info('  npm said:');
            for (const line of report.npm_output.split('\n'))
            {
                info(`    ${line}`);
            }
        }
    }
    else
    {
        warn(`${PROGRAM_NAME} ${report.current} → ${report.latest} available`
            + `${dry_run ? ' (nothing changed: --dry-run)' : ''}`);
        info(`  ${report.note}`);
    }
    info('  Run this instead:');
    info('');
    info(`      ${report.command}`);
};

const handle_install = async(opts: Install_cli_opts): Promise<void>=>{
    const dry_run = opts.dryRun === true;
    if (!wants_json(opts))
    {
        info(`Checking for a newer ${PROGRAM_NAME} release…`);
    }
    const report = await run_install({dry_run}, {
        // Silent under --json, where the only output allowed is the report.
        progress: wants_json(opts) ? undefined : (message: string)=>info(`  ${message}`),
    });

    if (wants_json(opts))
    {
        print(report, print_opts(opts));
    }
    else
    {
        human_report(report, dry_run);
    }

    // The user asked to be up to date and is not, so the exit code has to say
    // so — a script that runs `install` must be able to tell.
    if (report.action === 'manual' || report.action === 'failed')
    {
        throw new RuntimeError(`${PROGRAM_NAME} was not updated.`, {
            code: report.action === 'failed' ? 'update.npm_failed' : 'update.manual',
            detail: report.detail,
            hint: report.command,
        });
    }
};

const install_command = new Command('install')
    // Accepted for muscle memory from other CLIs; `install` is the documented
    // name, so users have one command to learn rather than two.
    .alias('update')
    .description('Update the CLI to the newest release, or say exactly how')
    .option('--dry-run', 'Report what would happen and change nothing')
    .addHelpText('after', `
Runs npm for you when the CLI was installed globally with npm. Anything else —
a project-local copy, npx, a source checkout — is left untouched and reported
with the command that fits it.

Exits 1 when an update exists and was not applied, so --dry-run works as a check.

Examples:
  ${PROGRAM_NAME} install
  ${PROGRAM_NAME} install --dry-run
  ${PROGRAM_NAME} install --json`)
    .action(async function(this: Command) {
        const o = this.optsWithGlobals();
        await handle_install({dryRun: o.dryRun, json: o.json, pretty: o.pretty});
    });

export {install_command, handle_install};
