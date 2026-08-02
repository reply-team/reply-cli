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
};

type Install_deps = {
    install?: Install_info;
    release?: (channel: Channel)=>Promise<Release>;
    run_npm?: (package_name: string)=>Promise<Npm_outcome>;
    env?: Env;
    now?: ()=>Date;
    platform?: NodeJS.Platform;
};

// Elevation differs per platform and is never done for the user: we print what
// they would have to run, and leave the decision with them.
const elevated = (command: string, platform: NodeJS.Platform): string=>
    platform === 'win32' ? command : `sudo ${command}`;

const failure_detail = (outcome: Npm_outcome): string=>{
    if (outcome.npm_missing)
    {
        return 'npm is not on PATH';
    }
    if (outcome.permission_denied)
    {
        return `npm exited with code ${outcome.code} (permission denied)`;
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
    const base = {
        current: install.version,
        latest: release.version,
        channel: install.channel,
        install: {kind: install.kind, package: install.package_name, path: install.module_dir},
        note: route.note,
    };

    if (!is_newer(release.version, install.version))
    {
        return {...base, up_to_date: true, action: 'current', command: route.command};
    }
    if (opts.dry_run || !route.drivable)
    {
        return {...base, up_to_date: false, action: 'manual', command: route.command};
    }

    const outcome = await (deps.run_npm ?? (pkg=>run_npm_install(pkg)))(install.package_name);
    if (outcome.ok)
    {
        return {...base, up_to_date: false, action: 'updated', command: route.command};
    }
    return {
        ...base,
        up_to_date: false,
        action: 'failed',
        command: outcome.permission_denied ? elevated(route.command, platform) : route.command,
        detail: failure_detail(outcome),
    };
};

export {run_install};
export type {Install_report, Install_action, Install_deps};
