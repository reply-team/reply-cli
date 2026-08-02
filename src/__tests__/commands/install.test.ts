import {describe, it, expect, beforeEach, vi} from 'vitest';
import path from 'path';

const mock_run_install = vi.hoisted(()=>vi.fn());
vi.mock('../../selfupdate/install', ()=>({run_install: mock_run_install}));

import {handle_install, install_command} from '../../commands/install';
import type {Install_report} from '../../selfupdate/install';
import {RuntimeError} from '../../utils/errors';

const MODULE_DIR = path.join(path.parse(process.cwd()).root, 'usr', 'lib', 'node_modules', 'reply-cli');

const report = (over: Partial<Install_report> = {}): Install_report=>({
    current: '0.4.0',
    latest: '0.5.0',
    up_to_date: false,
    channel: 'public',
    install: {kind: 'npm-global', package: 'reply-cli', path: MODULE_DIR},
    action: 'updated',
    command: 'npm install -g reply-cli@latest',
    note: `Installed globally with npm (${MODULE_DIR}).`,
    ...over,
});

const capture = async(fn: ()=>unknown | Promise<unknown>): Promise<{out: string; err: string}>=>{
    const out: string[] = [];
    const err: string[] = [];
    const log = console.log;
    const error = console.error;
    const write = process.stdout.write;
    console.log = (...a: unknown[])=>{ out.push(a.join(' ')); };
    console.error = (...a: unknown[])=>{ err.push(a.join(' ')); };
    process.stdout.write = ((c: unknown): boolean=>{ out.push(String(c)); return true; }) as typeof process.stdout.write;
    try { await fn(); } finally { console.log = log; console.error = error; process.stdout.write = write; }
    const clean = (s: string[]): string=>s.join('\n').replace(/\x1b\[[0-9;]*m/g, '').trim();
    return {out: clean(out), err: clean(err)};
};

beforeEach(()=>{ vi.clearAllMocks(); });

describe('handle_install', ()=>{
    it('keeps stdout clean and reports the update on stderr', async()=>{
        mock_run_install.mockResolvedValue(report());
        const {out, err} = await capture(()=>handle_install({}));
        expect(out).toBe('');
        expect(err).toContain('reply 0.4.0 → 0.5.0 installed');
    });

    it('says so when nothing needs doing, and exits zero', async()=>{
        mock_run_install.mockResolvedValue(report({action: 'current', up_to_date: true, latest: '0.4.0'}));
        const {err} = await capture(()=>handle_install({}));
        expect(err).toContain('reply 0.4.0 is the newest release');
    });

    it('prints the exact command and fails when it cannot update', async()=>{
        mock_run_install.mockResolvedValue(report({
            action: 'manual',
            install: {kind: 'npx', package: 'reply-cli', path: MODULE_DIR},
            command: 'npx reply-cli@latest',
            note: 'Running through npx, which resolves the newest published version on each run.',
        }));
        let thrown: unknown;
        const {err} = await capture(async()=>{
            await handle_install({}).catch((e: unknown)=>{thrown = e;});
        });
        expect(err).toContain('npx reply-cli@latest');
        expect(err).toContain('Running through npx');
        expect(thrown).toBeInstanceOf(RuntimeError);
        expect(thrown).toMatchObject({exit_code: 1, code: 'update.manual'});
    });

    it('reports why npm failed, shows what npm said, and offers the elevated command', async()=>{
        mock_run_install.mockResolvedValue(report({
            action: 'failed',
            detail: 'npm exited with code 243 (permission denied)',
            command: 'sudo npm install -g reply-cli@latest',
            npm_output: 'npm error code EACCES\nnpm error syscall mkdir',
        }));
        let thrown: unknown;
        const {err} = await capture(async()=>{
            await handle_install({}).catch((e: unknown)=>{thrown = e;});
        });
        expect(err).toContain('Could not update automatically: npm exited with code 243 (permission denied).');
        expect(err).toContain('npm error syscall mkdir');
        expect(err).toContain('sudo npm install -g reply-cli@latest');
        expect(thrown).toMatchObject({code: 'update.npm_failed'});
    });

    it('does not narrate progress under --json', async()=>{
        mock_run_install.mockResolvedValue(report());
        await capture(()=>handle_install({json: true}));
        expect(mock_run_install.mock.calls[0][1]).toEqual({progress: undefined});
    });

    it('marks a dry run as having changed nothing, and still exits 1', async()=>{
        mock_run_install.mockResolvedValue(report({action: 'manual'}));
        let thrown: unknown;
        const {err} = await capture(async()=>{
            await handle_install({dryRun: true}).catch((e: unknown)=>{thrown = e;});
        });
        expect(mock_run_install.mock.calls[0][0]).toEqual({dry_run: true});
        expect(err).toContain('--dry-run');
        expect(thrown).toBeInstanceOf(RuntimeError);
    });

    it('puts the report on stdout under --json and no prose anywhere', async()=>{
        mock_run_install.mockResolvedValue(report());
        const {out, err} = await capture(()=>handle_install({json: true}));
        expect(JSON.parse(out)).toMatchObject({action: 'updated', current: '0.4.0', latest: '0.5.0'});
        expect(err).toBe('');
    });

    it('indents the report under --pretty', async()=>{
        mock_run_install.mockResolvedValue(report());
        const {out} = await capture(()=>handle_install({pretty: true}));
        expect(out).toContain('\n  "action": "updated"');
    });
});

describe('the install command surface', ()=>{
    it('answers to update as well, so muscle memory works', ()=>{
        expect(install_command.name()).toBe('install');
        expect(install_command.aliases()).toContain('update');
    });

    it('offers --dry-run', ()=>{
        expect(install_command.options.map(o=>o.long)).toContain('--dry-run');
    });
});
