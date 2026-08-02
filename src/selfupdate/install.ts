import {write_check_cache} from './cache';
import {how_installed} from './detect';
import {latest_release} from './releases';
import {run_npm_install} from './npm';
import {route_for} from './routes';
import {is_newer} from './semver';
import type {Env} from '../config';
import type {Npm_outcome} from './npm';
import type {Channel, Install_info, Install_kind, Release} from './types';

// `reply install` is the one command a user has to remember: make sure what I
// have is current. It resolves the newest release of the channel this copy
// belongs to, updates when the install is ours to drive, and otherwise says
// exactly what to run — never touching an install it does not manage.

type Install_action = 'updated' | 'current' | 'manual' | 'failed';

type Install_report = {
    current: string;
    latest: string;
    up_to_date: boolean;
    channel: Channel;
    install: {kind: Install_kind; package: string; path: string};
    action: Install_action;
    command: string;
    note: string;
    detail?: string;
    // Present only on a failed run: the tail of what npm printed.
    npm_output?: string;
};

type Install_deps = {
    install?: Install_info;
    release?: (channel: Channel)=>Promise<Release>;
    run_npm?: (package_name: string)=>Promise<Npm_outcome>;
    env?: Env;
    now?: ()=>Date;
    platform?: NodeJS.Platform;
    // Called once, just before npm is spawned. npm buffers for as long as it
    // takes, and a silent half-minute reads as a hung command.
    progress?: (message: string)=>void;
};

// Elevation differs per platform and is never done for the user: we print what
// they would have to run, and leave the decision with them.
const elevated = (command: string, platform: NodeJS.Platform): string=>
    platform === 'win32' ? command : `sudo ${command}`;

const failure_detail = (outcome: Npm_outcome, platform: NodeJS.Platform): string=>{
    if (outcome.npm_missing)
    {
        return 'npm is not on PATH';
    }
    if (outcome.permission_denied)
    {
        // Windows has no sudo to prepend, so the command alone would leave the
        // user with nothing to change on a second attempt.
        const remedy = platform === 'win32' ? '; try an elevated terminal' : '';
        return `npm exited with code ${outcome.code} (permission denied${remedy})`;
    }
    return `npm exited with code ${outcome.code}`;
};

const run_install = async(
    opts: {dry_run?: boolean} = {},
    deps: Install_deps = {},
): Promise<Install_report>=>{
    const install = deps.install ?? how_installed();
    const platform = deps.platform ?? process.platform;
    const release = await (deps.release ?? latest_release)(install.channel);
    const now = (deps.now ?? (()=>new Date()))();
    try {
        write_check_cache({
            version: 1,
            channel: install.channel,
            latest: release.version,
            checked_at: now.toISOString(),
        }, deps.env);
    } catch {
        // A cache we could not write costs one HTTP request later. It is never
        // a reason to fail an update the user asked for.
    }

    const route = route_for(install);
    // Field order is part of what `--json` readers see, so it is built in one
    // place rather than spread differently per branch.
    const report = (
        action: Install_action,
        command: string,
        detail?: string,
        npm_output?: string,
    ): Install_report=>({
        current: install.version,
        latest: release.version,
        up_to_date: action === 'current',
        action,
        channel: install.channel,
        install: {kind: install.kind, package: install.package_name, path: install.module_dir},
        command,
        note: route.note,
        ...(detail ? {detail} : {}),
        ...(npm_output ? {npm_output} : {}),
    });

    if (!is_newer(release.version, install.version))
    {
        return report('current', route.command);
    }
    if (opts.dry_run || !route.drivable)
    {
        return report('manual', route.command);
    }

    deps.progress?.(`${install.version} → ${release.version}, updating with npm…`);
    const outcome = await (deps.run_npm ?? (pkg=>run_npm_install(pkg)))(install.package_name);
    if (outcome.ok)
    {
        return report('updated', route.command);
    }
    return report(
        'failed',
        outcome.permission_denied ? elevated(route.command, platform) : route.command,
        failure_detail(outcome, platform),
        // npm's own words are what makes an unexpected failure diagnosable;
        // carried only when it failed, so a normal run stays quiet.
        outcome.output_tail || undefined,
    );
};

export {run_install};
export type {Install_report, Install_action, Install_deps};
