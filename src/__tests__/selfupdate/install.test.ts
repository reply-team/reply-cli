import {describe, it, expect} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {read_check_cache} from '../../selfupdate/cache';
import {run_install} from '../../selfupdate/install';
import type {Install_deps} from '../../selfupdate/install';
import type {Npm_outcome} from '../../selfupdate/npm';
import type {Install_info, Release} from '../../selfupdate/types';

const sandbox = (): Record<string, string>=>
    ({REPLY_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'reply-install-'))});

const MODULE_DIR = path.join(path.parse(process.cwd()).root, 'usr', 'lib', 'node_modules', 'reply-cli');

const installed = (over: Partial<Install_info> = {}): Install_info=>({
    kind: 'npm-global',
    channel: 'public',
    package_name: 'reply-cli',
    version: '0.4.0',
    module_dir: MODULE_DIR,
    ...over,
});

const released = (version: string): Release=>
    ({version, tag: `v${version}`, url: 'https://example.invalid', prerelease: false});

const npm_outcome = (over: Partial<Npm_outcome> = {}): Npm_outcome=>
    ({ok: true, code: 0, output_tail: '', permission_denied: false, npm_missing: false, ...over});

const deps = (over: Partial<Install_deps> = {}): Install_deps=>({
    install: installed(),
    release: async()=>released('0.5.0'),
    run_npm: async()=>npm_outcome(),
    env: sandbox(),
    now: ()=>new Date('2026-08-01T12:00:00.000Z'),
    platform: 'linux',
    ...over,
});

describe('run_install', ()=>{
    it('updates a global npm install and reports old -> new', async()=>{
        const asked: string[] = [];
        const report = await run_install({}, deps({run_npm: async(pkg)=>{asked.push(pkg); return npm_outcome();}}));
        expect(asked).toEqual(['reply-cli']);
        expect(report).toMatchObject({
            action: 'updated',
            current: '0.4.0',
            latest: '0.5.0',
            up_to_date: false,
            command: 'npm install -g reply-cli@latest',
        });
    });

    it('does nothing when the newest release is already installed', async()=>{
        let spawned = false;
        const report = await run_install({}, deps({
            release: async()=>released('0.4.0'),
            run_npm: async()=>{spawned = true; return npm_outcome();},
        }));
        expect(report.action).toBe('current');
        expect(report.up_to_date).toBe(true);
        expect(spawned).toBe(false);
    });

    it('never suggests a downgrade when the installed build is ahead', async()=>{
        const report = await run_install({}, deps({
            install: installed({version: '0.6.0'}),
            release: async()=>released('0.5.0'),
        }));
        expect(report.action).toBe('current');
    });

    it('asks the channel the installed package belongs to', async()=>{
        const asked: string[] = [];
        await run_install({}, deps({
            install: installed({channel: 'internal', package_name: '@reply-team/reply-cli'}),
            release: async(channel)=>{asked.push(channel); return released('0.5.0');},
        }));
        expect(asked).toEqual(['internal']);
    });

    it('reports without spawning anything under --dry-run', async()=>{
        let spawned = false;
        const report = await run_install({dry_run: true}, deps({
            run_npm: async()=>{spawned = true; return npm_outcome();},
        }));
        expect(report.action).toBe('manual');
        expect(spawned).toBe(false);
        expect(report.command).toBe('npm install -g reply-cli@latest');
    });

    it.each(['npm-local', 'npx', 'source', 'unknown'] as const)(
        'never spawns npm for a %s install', async kind=>{
            let spawned = false;
            const report = await run_install({}, deps({
                install: installed({kind}),
                run_npm: async()=>{spawned = true; return npm_outcome();},
            }));
            expect(spawned).toBe(false);
            expect(report.action).toBe('manual');
            expect(report.command).toBeTruthy();
        });

    it('reports a failed npm run and keeps the reason', async()=>{
        const report = await run_install({}, deps({
            run_npm: async()=>npm_outcome({ok: false, code: 1, output_tail: 'npm error code E404'}),
        }));
        expect(report.action).toBe('failed');
        expect(report.detail).toBe('npm exited with code 1');
        expect(report.command).toBe('npm install -g reply-cli@latest');
        expect(report.npm_output).toBe('npm error code E404');
    });

    it('carries npm output only when npm failed', async()=>{
        const ok = await run_install({}, deps({
            run_npm: async()=>npm_outcome({output_tail: 'added 1 package'}),
        }));
        expect(ok.npm_output).toBeUndefined();
    });

    it('announces the npm run, which buffers for as long as it takes', async()=>{
        const said: string[] = [];
        await run_install({}, deps({progress: m=>said.push(m)}));
        expect(said).toEqual(['0.4.0 → 0.5.0, updating with npm…']);
    });

    it('says nothing before a run it will not make', async()=>{
        const said: string[] = [];
        await run_install({dry_run: true}, deps({progress: m=>said.push(m)}));
        await run_install({}, deps({install: installed({kind: 'npx'}), progress: m=>said.push(m)}));
        await run_install({}, deps({release: async()=>released('0.4.0'), progress: m=>said.push(m)}));
        expect(said).toEqual([]);
    });

    it('escalates to sudo on a permission failure, but not on Windows', async()=>{
        const denied = npm_outcome({ok: false, code: 243, permission_denied: true, output_tail: 'EACCES'});
        const posix = await run_install({}, deps({run_npm: async()=>denied}));
        expect(posix.command).toBe('sudo npm install -g reply-cli@latest');
        expect(posix.detail).toContain('permission denied');

        // No sudo to prepend on Windows, so the remedy has to be in the words.
        const windows = await run_install({}, deps({platform: 'win32', run_npm: async()=>denied}));
        expect(windows.command).toBe('npm install -g reply-cli@latest');
        expect(windows.detail).toContain('elevated terminal');
        expect(posix.detail).not.toContain('elevated terminal');
    });

    it('says plainly when npm itself is missing', async()=>{
        const report = await run_install({}, deps({
            run_npm: async()=>npm_outcome({ok: false, code: 1, npm_missing: true, output_tail: 'spawn npm ENOENT'}),
        }));
        expect(report.detail).toBe('npm is not on PATH');
    });

    it('caches the result so the version hint need not ask again', async()=>{
        const env = sandbox();
        await run_install({}, deps({env}));
        expect(read_check_cache(env)).toEqual({
            version: 1,
            channel: 'public',
            latest: '0.5.0',
            checked_at: '2026-08-01T12:00:00.000Z',
        });
    });

    it('still updates when the cache cannot be written', async()=>{
        // A regular file where the config directory should be: mkdir fails,
        // and the update must not fail with it.
        const blocked = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reply-install-blocked-')), 'in-the-way');
        fs.writeFileSync(blocked, 'not a directory', 'utf8');
        const env = {REPLY_CONFIG_DIR: blocked};
        expect(()=>fs.mkdirSync(path.join(blocked, 'x'), {recursive: true})).toThrow();

        const report = await run_install({}, deps({env}));
        expect(report.action).toBe('updated');
        expect(read_check_cache(env)).toBeUndefined();
    });

    it('lets a lookup failure surface: an explicit command must not fail silently', async()=>{
        await expect(run_install({}, deps({
            release: async()=>{throw new Error('offline');},
        }))).rejects.toThrow('offline');
    });

    it('carries the install it judged, for --json consumers', async()=>{
        const report = await run_install({}, deps());
        expect(report.install).toEqual({kind: 'npm-global', package: 'reply-cli', path: MODULE_DIR});
        expect(report.note).toContain(MODULE_DIR);
    });
});
