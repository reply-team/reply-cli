import {user_agent} from '../config';
import {RuntimeError} from '../utils/errors';
import {parse_version} from './semver';
import type {Channel, Release} from './types';

// The version of record is the git tag, not a registry: package.json in the
// repository is deliberately 0.0.0-development and semantic-release stamps the
// real version at publish time. Asking GitHub is also one code path for both
// channels, needs no token, and costs no npm subprocess.
//
// Safe for the public channel because the publish workflow flips a Release to
// "latest" only after `npm publish` succeeds — a hit here means npm has it.

const REPO = 'reply-team/reply-cli';
const API = 'https://api.github.com';

// Long enough for a cold TLS handshake, short enough that `reply --version`
// never feels like it hung. A check that cannot answer fast is discarded.
const TIMEOUT_MS = 1500;

type Fetch_response = {
    ok: boolean;
    status: number;
    json: ()=>Promise<unknown>;
};

type Fetch_like = (
    url: string,
    init?: {headers?: Record<string, string>; signal?: AbortSignal},
) => Promise<Fetch_response>;

type Releases_deps = {
    fetch?: Fetch_like;
    timeout_ms?: number;
};

type Release_body = {
    tag_name?: string;
    prerelease?: boolean;
    html_url?: string;
};

const headers = (): Record<string, string>=>({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub rejects API requests that do not identify themselves.
    'User-Agent': user_agent(),
});

// /releases/latest excludes pre-releases by design, which is exactly the
// promoted public build. The internal stream IS the pre-release stream, so it
// has to come off the unfiltered list.
const url_for = (channel: Channel): string=>channel === 'public'
    ? `${API}/repos/${REPO}/releases/latest`
    : `${API}/repos/${REPO}/releases?per_page=1`;

const latest_release = async(channel: Channel, deps: Releases_deps = {}): Promise<Release>=>{
    const call = deps.fetch ?? (globalThis.fetch as unknown as Fetch_like);
    const url = url_for(channel);
    let response: Fetch_response;
    try {
        response = await call(url, {
            headers: headers(),
            signal: AbortSignal.timeout(deps.timeout_ms ?? TIMEOUT_MS),
        });
    } catch (e) {
        throw new RuntimeError('Could not reach GitHub to check for a newer release.', {
            code: 'update.unreachable',
            detail: url,
            hint: (e as Error).message,
        });
    }
    if (!response.ok)
    {
        if (response.status === 403 || response.status === 429)
        {
            throw new RuntimeError('GitHub is rate-limiting the update check.', {
                code: 'update.rate_limited',
                detail: `HTTP ${response.status}`,
                hint: 'Unauthenticated requests are capped at 60 an hour. Try again later.',
            });
        }
        throw new RuntimeError('GitHub did not return the release list.', {
            code: 'update.http',
            detail: `HTTP ${response.status}`,
            hint: url,
        });
    }
    const body = await response.json();
    const found = (channel === 'public'
        ? body
        : (Array.isArray(body) ? body[0] : undefined)) as Release_body | undefined;
    if (!found || typeof found !== 'object')
    {
        throw new RuntimeError('GitHub reported no releases for this channel.', {
            code: 'update.no_release',
            detail: url,
        });
    }
    const tag = typeof found.tag_name === 'string' ? found.tag_name : '';
    if (!parse_version(tag))
    {
        throw new RuntimeError('The newest release is not tagged with a version.', {
            code: 'update.bad_release',
            detail: tag || '(no tag)',
        });
    }
    return {
        version: tag.replace(/^v/, ''),
        tag,
        url: typeof found.html_url === 'string' && found.html_url
            ? found.html_url
            : `https://github.com/${REPO}/releases/tag/${tag}`,
        prerelease: found.prerelease === true,
    };
};

export {latest_release, REPO, TIMEOUT_MS};
export type {Fetch_like, Fetch_response, Releases_deps};
