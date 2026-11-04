import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {cli_version} from '../../config';
import {HOSTS} from '../../skills/hosts';
import {record_pack} from '../../skills/journal';
import {run_skills} from '../../skills/orchestrate';
import {exit_code_for, human_lines} from '../../skills/report';
import type {Detect_deps} from '../../skills/detect';
import type {Runner} from '../../skills/types';
import {UsageError} from '../../utils/errors';

let root: string;
let home: string;

// A machine with Claude Code (its CLI on PATH) and Cursor.
const detect_deps = (): Detect_deps=>({
    home,
    platform: 'linux',
    exists: (p: string)=>fs.existsSync(p),
    find_on_path: (name: string)=>name === 'claude' ? '/usr/bin/claude' : undefined,
    glob_first: ()=>undefined,
});

// Plugin rows for `claude plugin list --json`, in its direct-array shape.
let listed: {id: string; version: string; scope: string}[] = [];
const calls: string[][] = [];
const run: Runner = async(bin, args)=>{
    calls.push([bin, ...args]);
    if (args.includes('list'))
    {
        return {code: 0, stdout: JSON.stringify(listed), stderr: ''};
    }
    return {code: 0, stdout: '', stderr: ''};
};

const env = ()=>({REPLY_CONFIG_DIR: path.join(root, 'config')});

const opts = (over: Record<string, unknown> = {})=>({
    operation: 'install' as const,
    requested: [] as string[],
    project: false,
    dry_run: false,
    deps: {
        detect: detect_deps(),
        run,
        home,
        cwd: path.join(root, 'project'),
        env: env(),
    },
    ...over,
});

const skill_file = (...dir: string[])=>path.join(...dir, 'reply-api', 'SKILL.md');

beforeEach(()=>{
    calls.length = 0;
    listed = [];
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-orch-'));
    home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, '.claude'), {recursive: true});
    fs.mkdirSync(path.join(home, '.cursor'), {recursive: true});
});
afterEach(()=>{
    fs.rmSync(root, {recursive: true, force: true});
});

describe('run_skills', ()=>{
    it('copies the pack into every detected host and asks Claude Code only for its plugin list', async()=>{
        const report = await run_skills(opts());
        expect(report.hosts.map(h=>h.host)).toEqual(['claude-code', 'cursor']);
        expect(report.resolved).toEqual(['reply-adapter']);
        expect(report.hosts.every(h=>h.status === 'ok')).toBe(true);
        expect(report.summary).toEqual({installed: 2, skipped: 0, failed: 0});
        expect(calls).toEqual([['/usr/bin/claude', 'plugin', 'list', '--json']]);
        expect(fs.existsSync(skill_file(home, '.claude', 'skills'))).toBe(true);
        expect(fs.existsSync(skill_file(home, '.cursor', 'skills'))).toBe(true);
    });

    it('reports the pack under its canonical name when asked for by its alias', async()=>{
        const report = await run_skills(opts({requested: ['adapter']}));
        expect(report.requested).toEqual(['reply-adapter']);
        expect(report.resolved).toEqual(['reply-adapter']);
    });

    it('narrows to one host with --agent', async()=>{
        const report = await run_skills(opts({agents: ['cursor']}));
        expect(report.hosts.map(h=>h.host)).toEqual(['cursor']);
    });

    it('includes a requested host that is not present, as skipped', async()=>{
        const report = await run_skills(opts({agents: ['windsurf']}));
        expect(report.hosts).toEqual([expect.objectContaining({
            host: 'windsurf', status: 'skipped', reason: 'not-detected',
        })]);
        expect(report.summary).toEqual({installed: 0, skipped: 1, failed: 0});
    });

    it('rejects an unknown --agent id', async()=>{
        await expect(run_skills(opts({agents: ['nope']}))).rejects.toThrow(UsageError);
    });

    it('rejects an unknown pack name', async()=>{
        await expect(run_skills(opts({requested: ['ghost']}))).rejects.toThrow(UsageError);
    });

    it('copies into the repository under --project, and removes an old project-scope plugin in that scope', async()=>{
        listed = [
            {id: 'reply-adapter@reply-skills', version: '0.3.0', scope: 'project'},
            {id: 'reply-adapter@reply-skills', version: '0.3.0', scope: 'user'},
        ];
        const report = await run_skills(opts({agents: ['claude-code'], project: true}));
        expect(report.hosts[0].scope).toBe('project');
        expect(fs.existsSync(skill_file(root, 'project', '.claude', 'skills'))).toBe(true);
        expect(calls.filter(c=>c[2] === 'uninstall')).toEqual([
            ['/usr/bin/claude', 'plugin', 'uninstall', 'reply-adapter@reply-skills', '--scope', 'project'],
        ]);
    });

    it('copies Codex into .agents/skills under --project and never asks its user-scoped plugin CLI', async()=>{
        fs.mkdirSync(path.join(home, '.codex'), {recursive: true});
        const base_deps = opts().deps;
        const report = await run_skills(opts({
            agents: ['codex'],
            project: true,
            deps: {
                ...base_deps,
                detect: {
                    home,
                    platform: 'linux',
                    exists: (p: string)=>fs.existsSync(p),
                    find_on_path: (name: string)=>name === 'codex' ? '/usr/bin/codex' : undefined,
                    glob_first: ()=>undefined,
                },
            },
        }));
        expect(report.hosts.map(h=>h.host)).toEqual(['codex']);
        expect(report.hosts[0].scope).toBe('project');
        expect(calls.some(c=>c[0] === '/usr/bin/codex')).toBe(false);
        expect(fs.existsSync(skill_file(root, 'project', '.agents', 'skills'))).toBe(true);
    });

    it('reports the version it copied as the source', async()=>{
        const report = await run_skills(opts({agents: ['cursor']}));
        expect(report.source).toEqual({version: cli_version()});
    });

    it('changes nothing on --dry-run, the old plugin included', async()=>{
        listed = [{id: 'reply-adapter@reply-skills', version: '0.3.0', scope: 'user'}];
        const report = await run_skills(opts({dry_run: true}));
        expect(fs.existsSync(path.join(home, '.cursor', 'skills', 'reply-api'))).toBe(false);
        expect(fs.existsSync(path.join(home, '.claude', 'skills', 'reply-api'))).toBe(false);
        expect(calls.some(c=>c.includes('uninstall'))).toBe(false);
        expect(report.hosts.every(h=>h.status === 'ok')).toBe(true);
        expect(report.hosts[0].old_plugin).toEqual({id: 'reply-adapter@reply-skills', action: 'removed'});
    });

    it('removes the copy when remove is given no pack', async()=>{
        await run_skills(opts({agents: ['cursor']}));
        const report = await run_skills(opts({operation: 'remove', agents: ['cursor']}));
        expect(report.hosts[0].packs).toEqual([{name: 'reply-adapter', action: 'removed', version: cli_version()}]);
        expect(fs.existsSync(path.join(home, '.cursor', 'skills', 'reply-api'))).toBe(false);
    });

    it('copies anyway, and says so, when the host cannot list its plugins', async()=>{
        const failing_list: Runner = async(bin, args)=>{
            calls.push([bin, ...args]);
            return {code: 1, stdout: '', stderr: 'not signed in'};
        };
        const report = await run_skills(opts({agents: ['claude-code'], deps: {...opts().deps, run: failing_list}}));
        expect(report.hosts[0].status).toBe('ok');
        expect(fs.existsSync(skill_file(home, '.claude', 'skills'))).toBe(true);
        expect(report.hosts[0].hint).toContain('not signed in');
        expect(calls.some(c=>c.includes('uninstall'))).toBe(false);
    });

    it('keeps other hosts working when one host throws unexpectedly', async()=>{
        // An injected Runner that rejects escapes the plugin listing — the kind
        // of surprise run_skills itself must contain per host.
        const flaky_run: Runner = async(bin, args)=>{
            if (bin === '/usr/bin/claude')
            {
                throw new Error('ECONNRESET');
            }
            return run(bin, args);
        };
        const report = await run_skills(opts({
            agents: ['claude-code', 'cursor'],
            deps: {...opts().deps, run: flaky_run},
        }));
        expect(report.hosts.map(h=>h.host)).toEqual(['claude-code', 'cursor']);
        expect(report.hosts[0]).toEqual(expect.objectContaining({
            host: 'claude-code', status: 'failed', reason: 'host-error', detail: 'ECONNRESET',
        }));
        expect(report.hosts[1].status).toBe('ok');
        expect(fs.existsSync(skill_file(home, '.cursor', 'skills'))).toBe(true);
    });

    it('does nothing on update for a host with neither a copy nor the old plugin, and exits 0', async()=>{
        const report = await run_skills(opts({operation: 'update', agents: ['cursor']}));
        expect(report.hosts[0]).toMatchObject({host: 'cursor', status: 'ok', packs: []});
        expect(human_lines(report).join('\n')).toMatch(/Cursor +· nothing to do/);
        expect(exit_code_for(report)).toBe(0);
        expect(fs.existsSync(path.join(home, '.cursor', 'skills'))).toBe(false);
    });

    it('reports current on every host when update finds the copy already at this version', async()=>{
        await run_skills(opts());
        const report = await run_skills(opts({operation: 'update'}));

        expect(report.hosts.map(h=>h.host)).toEqual(['claude-code', 'cursor']);
        for (const host of report.hosts)
        {
            expect(host.packs?.map(p=>[p.name, p.action])).toEqual([['reply-adapter', 'current']]);
        }
        // Nothing changed, so the "start a new session" advice must not fire.
        expect(human_lines(report).join('\n')).not.toMatch(/new session/i);
    });

    // A copy that never finished is repaired at an unchanged version: still
    // `current`, but the files moved and the user must reload.
    it('still advises a new session when update repaired a copy at an unchanged version', async()=>{
        record_pack('cursor', 'user', 'reply-adapter', {
            version: cli_version(), scope: 'user', files: [], complete: false,
            installed_at: '2026-07-30T00:00:00.000Z',
        }, env());
        const report = await run_skills(opts({operation: 'update', agents: ['cursor']}));

        expect(report.hosts[0].packs).toEqual([
            {name: 'reply-adapter', action: 'current', version: cli_version(), refreshed: true},
        ]);
        expect(human_lines(report).join('\n')).toMatch(/new session/i);
    });

    // Asserted with `verified` because it is the only mixed flag now that every
    // host is verified, so a hardcoded stamp still fails.
    const in_session = HOSTS.find(h=>!h.needs_new_session);
    const flags_guard = 'every host needs a new session — decide what this should assert now';
    // Derived from which directories exist rather than from a list of ids, in
    // registry order, because creating one host's config directory can reveal
    // another whose own directory is an ancestor of it — a fixed list silently
    // missed the second host and asserted a report the detector would never
    // produce. Nested config directories are legitimate (Antigravity's is
    // `.gemini/antigravity`), so containment, not equality, decides.
    const detected_defs = (made: string[]): typeof HOSTS=>
        HOSTS.filter(h=>h.config_dirs.some(dir=>
            made.some(m=>m === dir || m.startsWith(`${dir}${path.sep}`))));

    it('carries each host\'s registry flags into the report', async()=>{
        expect(in_session, flags_guard).toBeDefined();
        const made = ['.claude', '.cursor', in_session!.config_dirs[0]];
        fs.mkdirSync(path.join(home, in_session!.config_dirs[0]), {recursive: true});
        const report = await run_skills(opts());
        expect(report.hosts.map(h=>[h.host, h.verified, h.needs_new_session])).toEqual(
            detected_defs(made).map(h=>[h.id, h.verified, h.needs_new_session]),
        );
    });

    it('carries the registry flags on a host that was requested but not installed', async()=>{
        expect(in_session, flags_guard).toBeDefined();
        const report = await run_skills(opts({agents: [in_session!.id]}));
        expect([report.hosts[0].verified, report.hosts[0].needs_new_session])
            .toEqual([in_session!.verified, in_session!.needs_new_session]);
    });

    // Retiring a host leaves its journal branch behind, and nothing else in this
    // file can reach it: every other path iterates the registry, and `--agent
    // <retired id>` is a usage error. Without this, `remove` quietly stops being
    // able to take those packs out and no command ever says so — which is what
    // happened when gemini-cli was retired with packs installed under it.
    it('reports packs recorded for a host the registry no longer has', async()=>{
        const orphan_file = path.join(home, '.gemini', 'skills', 'ai-sdr-core-skill', 'SKILL.md');
        record_pack('gemini-cli', 'user', 'ai-sdr-core', {
            version: '0.3.0', scope: 'user',
            files: [orphan_file], complete: true, installed_at: '2026-07-30T00:00:00.000Z',
        }, {REPLY_CONFIG_DIR: path.join(root, 'config')});

        const report = await run_skills(opts({operation: 'list'}));

        expect(report.orphans).toEqual([{
            host: 'gemini-cli', scope: 'user', packs: ['ai-sdr-core'], files: 1, sample: orphan_file,
        }]);
        const out = human_lines(report).join('\n');
        expect(out).toContain('no longer supports');
        expect(out).toContain('delete them by hand');
    });

    it('says nothing about orphans when every journal branch is a known host', async()=>{
        await run_skills(opts({agents: ['cursor']}));
        const report = await run_skills(opts({operation: 'list'}));
        expect(report.orphans).toBeUndefined();
        expect(human_lines(report).join('\n')).not.toContain('no longer supports');
    });
});
