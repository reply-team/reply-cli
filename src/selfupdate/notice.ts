import {PROGRAM_NAME} from '../config';
import {cache_is_fresh, read_check_cache, write_check_cache} from './cache';
import {how_installed} from './detect';
import {latest_release} from './releases';
import {is_newer} from './semver';
import type {Env} from '../config';
import type {Channel, Install_info, Release} from './types';

// The one place in the CLI that may touch the network without being asked, so
// it is also the one place with a hard rule: never throw, never run unless a
// human is looking at a terminal, and never cost more than the client's own
// timeout. Everything else in the CLI stays offline.

type Notice_deps = {
    json?: boolean;
    quiet?: boolean;
    tty?: boolean;
    env?: Env;
    now?: ()=>Date;
    install?: Install_info;
    release?: (channel: Channel)=>Promise<Release>;
};

const truthy = (value: string | undefined): boolean=>
    value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';

const suppressed = (deps: Notice_deps, install: Install_info): boolean=>{
    const env = deps.env ?? process.env;
    // A checkout sits on 0.0.0-development and belongs to whoever cuts the
    // releases; telling them about one is noise.
    return Boolean(deps.json)
        || Boolean(deps.quiet)
        || (deps.tty ?? process.stderr.isTTY) !== true
        || truthy(env.CI)
        || truthy(env.GITHUB_ACTIONS)
        || truthy(env.REPLY_NO_UPDATE_CHECK)
        || install.kind === 'source';
};

const hint_for = (current: string, latest: string): string=>
    `${PROGRAM_NAME} ${current} → ${latest} available · run \`${PROGRAM_NAME} install\``;

const update_notice = async(deps: Notice_deps = {}): Promise<string | undefined>=>{
    const install = deps.install ?? how_installed();
    if (suppressed(deps, install))
    {
        return undefined;
    }
    const now = (deps.now ?? (()=>new Date()))();
    const cached = read_check_cache(deps.env);
    if (cache_is_fresh(cached, install.channel, now))
    {
        const latest = cached?.latest;
        return latest && is_newer(latest, install.version)
            ? hint_for(install.version, latest)
            : undefined;
    }
    try {
        const release = await (deps.release ?? latest_release)(install.channel);
        write_check_cache({
            version: 1,
            channel: install.channel,
            latest: release.version,
            checked_at: now.toISOString(),
        }, deps.env);
        return is_newer(release.version, install.version)
            ? hint_for(install.version, release.version)
            : undefined;
    } catch {
        // Offline, rate-limited, or slow: record the attempt so we back off,
        // and say nothing. A hint is never worth a delay or an error.
        try {
            write_check_cache({
                version: 1,
                channel: install.channel,
                latest: cached?.latest,
                failed_at: now.toISOString(),
            }, deps.env);
        } catch {
            // Nothing left to do — a cache we cannot write only costs a retry.
        }
        return undefined;
    }
};

export {update_notice, hint_for};
export type {Notice_deps};
