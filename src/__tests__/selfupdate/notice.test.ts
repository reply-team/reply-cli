import {describe, it, expect} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {read_check_cache, write_check_cache} from '../../selfupdate/cache';
import {update_notice} from '../../selfupdate/notice';
import type {Notice_deps} from '../../selfupdate/notice';
import type {Install_info, Release} from '../../selfupdate/types';

const sandbox = (): Record<string, string>=>
    ({REPLY_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'reply-notice-'))});

const NOW = new Date('2026-08-01T12:00:00.000Z');

const installed = (over: Partial<Install_info> = {}): Install_info=>({
    kind: 'npm-global',
    channel: 'public',
    package_name: 'reply-cli',
    version: '0.4.0',
    module_dir: path.join(path.parse(process.cwd()).root, 'usr', 'lib', 'node_modules', 'reply-cli'),
    ...over,
});

// Any test that expects no request gets this: it fails loudly if reached.
const forbidden = async(): Promise<Release>=>{
    throw new Error('the update check must not run here');
};

const deps = (over: Partial<Notice_deps> = {}): Notice_deps=>({
    tty: true,
    env: sandbox(),
    now: ()=>NOW,
    install: installed(),
    release: async()=>({version: '0.5.0', tag: 'v0.5.0', url: 'https://example.invalid', prerelease: false}),
    ...over,
});

describe('update_notice suppression', ()=>{
    const cases: Array<[string, Partial<Notice_deps>]> = [
        ['--json is in play', {json: true}],
        ['--quiet is in play', {quiet: true}],
        ['stderr is not a terminal', {tty: false}],
        ['CI is set', {env: {...sandbox(), CI: '1'}}],
        ['GITHUB_ACTIONS is set', {env: {...sandbox(), GITHUB_ACTIONS: 'true'}}],
        ['the user switched it off', {env: {...sandbox(), REPLY_NO_UPDATE_CHECK: '1'}}],
        ['this is a source checkout', {install: installed({kind: 'source', version: '0.0.0-development'})}],
    ];

    it.each(cases)('says nothing and makes no request when %s', async(_name, over)=>{
        expect(await update_notice(deps({release: forbidden, ...over}))).toBeUndefined();
    });

    it('is not fooled by CI=false or CI=0', async()=>{
        const env = {...sandbox(), CI: 'false'};
        expect(await update_notice(deps({env}))).toBe('reply 0.4.0 → 0.5.0 available · run `reply install`');
    });
});

describe('update_notice', ()=>{
    it('reports a newer release in one line', async()=>{
        expect(await update_notice(deps()))
            .toBe('reply 0.4.0 → 0.5.0 available · run `reply install`');
    });

    it('says nothing when the installed version is the newest', async()=>{
        expect(await update_notice(deps({
            release: async()=>({version: '0.4.0', tag: 'v0.4.0', url: 'u', prerelease: false}),
        }))).toBeUndefined();
    });

    it('answers from a fresh cache without asking GitHub', async()=>{
        const env = sandbox();
        write_check_cache({version: 1, channel: 'public', latest: '0.6.0', checked_at: NOW.toISOString()}, env);
        expect(await update_notice(deps({env, release: forbidden, now: ()=>new Date('2026-08-01T20:00:00.000Z')})))
            .toBe('reply 0.4.0 → 0.6.0 available · run `reply install`');
    });

    it('asks again once the cache has gone stale, and stores the answer', async()=>{
        const env = sandbox();
        write_check_cache({version: 1, channel: 'public', latest: '0.4.0', checked_at: NOW.toISOString()}, env);
        const hint = await update_notice(deps({env, now: ()=>new Date('2026-08-03T12:00:00.000Z')}));
        expect(hint).toBe('reply 0.4.0 → 0.5.0 available · run `reply install`');
        expect(read_check_cache(env)?.latest).toBe('0.5.0');
    });

    it('ignores a cache written for the other channel', async()=>{
        const env = sandbox();
        write_check_cache({version: 1, channel: 'internal', latest: '9.9.9', checked_at: NOW.toISOString()}, env);
        expect(await update_notice(deps({env}))).toBe('reply 0.4.0 → 0.5.0 available · run `reply install`');
    });

    it('stays silent when the check fails, and records the failure', async()=>{
        const env = sandbox();
        const hint = await update_notice(deps({env, release: async()=>{throw new Error('offline');}}));
        expect(hint).toBeUndefined();
        expect(read_check_cache(env)?.failed_at).toBe(NOW.toISOString());
    });

    it('does not retry inside the failure backoff', async()=>{
        const env = sandbox();
        write_check_cache({version: 1, channel: 'public', failed_at: NOW.toISOString()}, env);
        expect(await update_notice(deps({
            env,
            release: forbidden,
            now: ()=>new Date('2026-08-01T12:30:00.000Z'),
        }))).toBeUndefined();
    });

    it('keeps the last known version when a later check fails', async()=>{
        const env = sandbox();
        write_check_cache({version: 1, channel: 'public', latest: '0.5.0', checked_at: NOW.toISOString()}, env);
        await update_notice(deps({
            env,
            release: async()=>{throw new Error('offline');},
            now: ()=>new Date('2026-08-03T12:00:00.000Z'),
        }));
        expect(read_check_cache(env)).toMatchObject({latest: '0.5.0', failed_at: '2026-08-03T12:00:00.000Z'});
    });

    it('never throws, even when the cache directory cannot be written', async()=>{
        const blocked = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reply-notice-blocked-')), 'in-the-way');
        fs.writeFileSync(blocked, 'not a directory', 'utf8');
        expect(await update_notice(deps({
            env: {REPLY_CONFIG_DIR: blocked},
            release: async()=>{throw new Error('offline');},
        }))).toBeUndefined();
    });
});
