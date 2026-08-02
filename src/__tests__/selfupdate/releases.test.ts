import {describe, it, expect} from 'vitest';
import {latest_release} from '../../selfupdate/releases';
import type {Fetch_response} from '../../selfupdate/releases';

const ok = (body: unknown): Fetch_response=>({ok: true, status: 200, json: async()=>body});
const fail = (status: number): Fetch_response=>({ok: false, status, json: async()=>({})});
const release = (tag: string, prerelease = false)=>({
    tag_name: tag,
    prerelease,
    html_url: `https://github.com/reply-team/reply-cli/releases/tag/${tag}`,
});

describe('latest_release', ()=>{
    it('asks for the promoted release on the public channel', async()=>{
        const seen: string[] = [];
        const found = await latest_release('public', {
            fetch: async(url)=>{seen.push(url); return ok(release('v0.4.0'));},
        });
        expect(seen).toEqual(['https://api.github.com/repos/reply-team/reply-cli/releases/latest']);
        expect(found).toEqual({
            version: '0.4.0',
            tag: 'v0.4.0',
            url: 'https://github.com/reply-team/reply-cli/releases/tag/v0.4.0',
            prerelease: false,
        });
    });

    it('takes the newest release of any kind on the internal channel', async()=>{
        const seen: string[] = [];
        const found = await latest_release('internal', {
            fetch: async(url)=>{seen.push(url); return ok([release('v0.5.0', true), release('v0.4.0')]);},
        });
        expect(seen).toEqual(['https://api.github.com/repos/reply-team/reply-cli/releases?per_page=1']);
        expect(found.version).toBe('0.5.0');
        expect(found.prerelease).toBe(true);
    });

    it('identifies itself, because GitHub rejects anonymous clients', async()=>{
        let sent: Record<string, string> = {};
        await latest_release('public', {
            fetch: async(_url, init)=>{sent = init?.headers ?? {}; return ok(release('v0.4.0'));},
        });
        expect(sent['User-Agent']).toMatch(/^reply-cli\//);
        expect(sent.Accept).toBe('application/vnd.github+json');
        expect(sent['X-GitHub-Api-Version']).toBe('2022-11-28');
    });

    it('aborts rather than hanging a command', async()=>{
        let signal: AbortSignal | undefined;
        await latest_release('public', {
            timeout_ms: 50,
            fetch: async(_url, init)=>{signal = init?.signal; return ok(release('v0.4.0'));},
        });
        expect(signal).toBeInstanceOf(AbortSignal);
    });

    it('explains a rate limit rather than reporting a bare 403', async()=>{
        await expect(latest_release('public', {fetch: async()=>fail(403)}))
            .rejects.toMatchObject({code: 'update.rate_limited', exit_code: 1});
    });

    it('reports any other HTTP failure with its status', async()=>{
        await expect(latest_release('public', {fetch: async()=>fail(500)}))
            .rejects.toMatchObject({code: 'update.http', detail: 'HTTP 500'});
    });

    it('turns a transport failure into a runtime error', async()=>{
        await expect(latest_release('public', {
            fetch: async()=>{throw new Error('getaddrinfo ENOTFOUND');},
        })).rejects.toMatchObject({code: 'update.unreachable', hint: 'getaddrinfo ENOTFOUND'});
    });

    it('reports an empty release list instead of crashing on undefined', async()=>{
        await expect(latest_release('internal', {fetch: async()=>ok([])}))
            .rejects.toMatchObject({code: 'update.no_release'});
    });

    it('rejects a release whose tag is not a version', async()=>{
        await expect(latest_release('public', {
            fetch: async()=>ok({tag_name: 'nightly', prerelease: false}),
        })).rejects.toMatchObject({code: 'update.bad_release', detail: 'nightly'});
    });

    it('falls back to the tag page when the release carries no url', async()=>{
        const found = await latest_release('public', {
            fetch: async()=>ok({tag_name: 'v1.2.3', prerelease: false}),
        });
        expect(found.url).toBe('https://github.com/reply-team/reply-cli/releases/tag/v1.2.3');
    });
});
