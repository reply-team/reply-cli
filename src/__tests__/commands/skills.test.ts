import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mock_run_skills = vi.hoisted(()=>vi.fn());
vi.mock('../../skills/orchestrate', ()=>({run_skills: mock_run_skills}));

import {handle_skills, skills_command} from '../../commands/skills';
import type {Report} from '../../skills/types';

const report = (over: Partial<Report> = {}): Report=>({
    action: 'install',
    source: {repo: 'reply-team/reply-skills', ref: 'main'},
    requested: ['ai-sdr-core'],
    resolved: ['ai-sdr-core'],
    hosts: [{
        host: 'claude-code', label: 'Claude Code', kind: 'native-plugin', scope: 'user', status: 'ok',
        packs: [{name: 'ai-sdr-core', action: 'installed', version: '0.1.0'}],
    }],
    summary: {installed: 1, skipped: 0, failed: 0},
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

let dir: string;
beforeEach(()=>{
    vi.clearAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-skills-cmd-'));
    process.env.REPLY_CONFIG_DIR = dir;
});
afterEach(()=>{
    delete process.env.REPLY_CONFIG_DIR;
    fs.rmSync(dir, {recursive: true, force: true});
});

describe('handle_skills', ()=>{
    it('prints the human summary on stderr and nothing on stdout', async()=>{
        mock_run_skills.mockResolvedValue(report());
        const {out, err} = await capture(()=>handle_skills('install', [], {}));
        expect(err).toContain('detected Claude Code');
        expect(err).toContain('ai-sdr-core installed');
        expect(out).toBe('');
    });

    it('prints the report as JSON on stdout when --json is set', async()=>{
        mock_run_skills.mockResolvedValue(report());
        const {out} = await capture(()=>handle_skills('install', [], {json: true}));
        const parsed = JSON.parse(out);
        expect(parsed.action).toBe('install');
        expect(parsed.resolved).toEqual(['ai-sdr-core']);
        expect(parsed.hosts[0].host).toBe('claude-code');
    });

    it('indents JSON with --pretty', async()=>{
        mock_run_skills.mockResolvedValue(report());
        const {out} = await capture(()=>handle_skills('install', [], {pretty: true}));
        expect(out).toContain('\n  "action"');
    });

    it('passes packs, agents, project and dry-run through to the orchestrator', async()=>{
        mock_run_skills.mockResolvedValue(report());
        await capture(()=>handle_skills('install', ['adapter'], {agent: ['codex'], project: true, dryRun: true}));
        expect(mock_run_skills).toHaveBeenCalledWith(expect.objectContaining({
            operation: 'install', requested: ['adapter'], agents: ['codex'], project: true, dry_run: true,
        }));
    });

    it('throws a RuntimeError so the top-level handler exits 1 when nothing installed', async()=>{
        mock_run_skills.mockResolvedValue(report({
            hosts: [], summary: {installed: 0, skipped: 0, failed: 0},
        }));
        await expect(capture(()=>handle_skills('install', [], {}))).rejects.toMatchObject({exit_code: 1});
    });

    it('still prints the report before failing, so the reason is not lost', async()=>{
        mock_run_skills.mockResolvedValue(report({
            hosts: [{
                host: 'codex', label: 'Codex', kind: 'native-plugin', status: 'failed',
                reason: 'marketplace-add-failed', detail: 'no network',
            }],
            summary: {installed: 0, skipped: 0, failed: 1},
        }));
        const {err} = await capture(()=>handle_skills('install', [], {}).catch(()=>{}));
        expect(err).toContain('no network');
    });

    it('does not fail a list run that found nothing', async()=>{
        mock_run_skills.mockResolvedValue(report({
            action: 'list', hosts: [], summary: {installed: 0, skipped: 0, failed: 0},
        }));
        await expect(capture(()=>handle_skills('list', [], {}))).resolves.toBeTruthy();
    });
});

describe('skills_command', ()=>{
    it('exposes the four subcommands', ()=>{
        expect(skills_command.commands.map(c=>c.name()).sort())
            .toEqual(['install', 'list', 'remove', 'update']);
    });

    it('accepts variadic pack names on install', ()=>{
        const install = skills_command.commands.find(c=>c.name() === 'install');
        expect(install?.usage()).toContain('[packs...]');
    });

    it('declares --agent, --project and --dry-run on install', ()=>{
        const install = skills_command.commands.find(c=>c.name() === 'install');
        const flags = install?.options.map(o=>o.long) ?? [];
        expect(flags).toEqual(expect.arrayContaining(['--agent', '--project', '--dry-run']));
    });
});
