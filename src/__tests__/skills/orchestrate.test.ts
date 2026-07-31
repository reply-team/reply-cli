import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {run_skills} from '../../skills/orchestrate';
import {human_lines} from '../../skills/report';
import type {Detect_deps} from '../../skills/detect';
import type {Runner} from '../../skills/types';
import {UsageError} from '../../utils/errors';

let root: string;
let home: string;

// A machine with Claude Code (native, on PATH) and Cursor (flat).
const detect_deps = (): Detect_deps=>({
    home,
    platform: 'linux',
    exists: (p: string)=>fs.existsSync(p),
    find_on_path: (name: string)=>name === 'claude' ? '/usr/bin/claude' : undefined,
    glob_first: ()=>undefined,
});

const calls: string[][] = [];
const run: Runner = async(bin, args)=>{
    calls.push([bin, ...args]);
    if (args.includes('list'))
    {
        return {code: 0, stdout: JSON.stringify({plugins: []}), stderr: ''};
    }
    return {code: 0, stdout: '', stderr: ''};
};

const fake_clone = async()=>{
    const dir = fs.mkdtempSync(path.join(root, 'clone-'));
    for (const name of ['ai-sdr-core', 'reply-adapter', 'agentic-runtime'])
    {
        const skills = path.join(dir, 'plugins', name, 'skills', `${name}-skill`);
        fs.mkdirSync(skills, {recursive: true});
        fs.writeFileSync(path.join(skills, 'SKILL.md'), `---\nname: ${name}-skill\ndescription: d\n---\n`);
    }
    return {dir, commit: 'cafe123'};
};

const opts = (over: Record<string, unknown> = {})=>({
    operation: 'install' as const,
    requested: [] as string[],
    project: false,
    dry_run: false,
    deps: {
        detect: detect_deps(),
        run,
        clone: fake_clone,
        home,
        cwd: path.join(root, 'project'),
        tmp_root: root,
        env: {REPLY_CONFIG_DIR: path.join(root, 'config')},
        fetch_impl: vi.fn().mockRejectedValue(new TypeError('offline')) as unknown as typeof fetch,
    },
    ...over,
});

beforeEach(()=>{
    calls.length = 0;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-orch-'));
    home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, '.claude'), {recursive: true});
    fs.mkdirSync(path.join(home, '.cursor'), {recursive: true});
});
afterEach(()=>{
    fs.rmSync(root, {recursive: true, force: true});
});

describe('run_skills', ()=>{
    it('installs all three packs into both host classes', async()=>{
        const report = await run_skills(opts());
        expect(report.hosts.map(h=>h.host)).toEqual(['claude-code', 'cursor']);
        expect(report.resolved).toEqual(['ai-sdr-core', 'reply-adapter', 'agentic-runtime']);
        expect(report.hosts.every(h=>h.status === 'ok')).toBe(true);
        expect(report.summary).toEqual({installed: 2, skipped: 0, failed: 0});
        // Native host went through its own CLI…
        expect(calls[0]).toEqual(['/usr/bin/claude', 'plugin', 'marketplace', 'add', 'reply-team/reply-skills']);
        // …and the flat host got real files.
        expect(fs.existsSync(path.join(home, '.cursor', 'skills', 'ai-sdr-core-skill', 'SKILL.md'))).toBe(true);
    });

    it('records requested separately from resolved on a selective install', async()=>{
        const report = await run_skills(opts({requested: ['adapter']}));
        expect(report.requested).toEqual(['reply-adapter']);
        expect(report.resolved).toEqual(['ai-sdr-core', 'reply-adapter']);
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

    it('keeps a native host on its own CLI under --project when it can express project scope', async()=>{
        const report = await run_skills(opts({agents: ['claude-code'], project: true}));
        expect(report.hosts[0].scope).toBe('project');
        // Claude Code expresses project scope natively, so it stays native.
        expect(calls.some(c=>c.includes('--scope') && c.includes('project'))).toBe(true);
    });

    it('routes Codex through the flat adapter under --project, and reports scope honestly', async()=>{
        // Codex's plugin mechanism is user-scoped only, so a project-scoped run
        // must fall back to the flat adapter (.agents/skills), never run_native,
        // and the outcome must still say 'project' rather than silently
        // dropping the request back to 'user'.
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
        expect(report.hosts[0].kind).toBe('flat-skills-dir');
        expect(report.hosts[0].scope).toBe('project');
        // No native CLI call ever reached the Codex binary.
        expect(calls.some(c=>c[0] === '/usr/bin/codex')).toBe(false);
        expect(fs.existsSync(
            path.join(root, 'project', '.agents', 'skills', 'ai-sdr-core-skill', 'SKILL.md'),
        )).toBe(true);
    });

    it('reports the source ref and the resolved commit for flat installs', async()=>{
        const report = await run_skills(opts({agents: ['cursor']}));
        expect(report.source).toEqual({repo: 'reply-team/reply-skills', ref: 'main', commit: 'cafe123'});
    });

    it('changes nothing on --dry-run', async()=>{
        const report = await run_skills(opts({dry_run: true}));
        expect(fs.existsSync(path.join(home, '.cursor', 'skills', 'ai-sdr-core-skill'))).toBe(false);
        expect(calls.some(c=>c.includes('install'))).toBe(false);
        expect(report.hosts.every(h=>h.status === 'ok')).toBe(true);
    });

    it('refuses to remove a pack that another pack depends on', async()=>{
        await run_skills(opts({agents: ['cursor']}));
        await expect(run_skills(opts({operation: 'remove', requested: ['core'], agents: ['cursor']})))
            .rejects.toThrow(UsageError);
    });

    it('allows removing a pack nothing depends on', async()=>{
        await run_skills(opts({agents: ['cursor']}));
        const report = await run_skills(opts({operation: 'remove', requested: ['runtime'], agents: ['cursor']}));
        expect(report.hosts[0].packs?.map(p=>p.name)).toEqual(['agentic-runtime']);
    });

    it('removes everything when remove is given no pack', async()=>{
        await run_skills(opts({agents: ['cursor']}));
        const report = await run_skills(opts({operation: 'remove', agents: ['cursor']}));
        expect(report.hosts[0].packs?.map(p=>p.action)).toEqual(['removed', 'removed', 'removed']);
        expect(fs.existsSync(path.join(home, '.cursor', 'skills', 'ai-sdr-core-skill'))).toBe(false);
    });

    it('keeps other hosts working when one host throws unexpectedly', async()=>{
        // run_native has no try/catch of its own around its process calls, so
        // an injected Runner that rejects escapes it — exactly the kind of
        // surprise (a journal write racing an antivirus scanner, a flaky
        // network call) the orchestrator itself must contain per host.
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
        // The second host was never touched by the first host's failure.
        expect(report.hosts[1].status).toBe('ok');
        expect(fs.existsSync(path.join(home, '.cursor', 'skills', 'ai-sdr-core-skill', 'SKILL.md'))).toBe(true);
    });

    it('reports no commit when nothing was cloned this run (native-only)', async()=>{
        const report = await run_skills(opts({agents: ['claude-code']}));
        expect(report.source).toEqual({repo: 'reply-team/reply-skills', ref: 'main'});
    });

    // I3 (final review): `update` was never exercised through run_skills at
    // all, which is exactly where the disagreement showed — one native host
    // and one flat host answering "already at the target version" two
    // different ways in a single report.
    it('reports current from both adapters when update finds every pack already at the target version', async()=>{
        // The host reports all three packs installed at the registry version,
        // so neither adapter has anything to move.
        const installed_run: Runner = async(bin, args)=>{
            calls.push([bin, ...args]);
            if (args.includes('list'))
            {
                return {
                    code: 0,
                    stdout: JSON.stringify({plugins: ['ai-sdr-core', 'reply-adapter', 'agentic-runtime']
                        .map(name=>({name, marketplace: 'reply-skills', version: '0.1.0'}))}),
                    stderr: '',
                };
            }
            return {code: 0, stdout: '', stderr: ''};
        };
        const with_run = (): Record<string, unknown>=>({...opts().deps, run: installed_run});

        await run_skills(opts({deps: with_run()}));
        const report = await run_skills(opts({operation: 'update', deps: with_run()}));

        expect(report.hosts.map(h=>h.host)).toEqual(['claude-code', 'cursor']);
        for (const host of report.hosts)
        {
            expect(host.packs?.map(p=>[p.name, p.action])).toEqual([
                ['ai-sdr-core', 'current'],
                ['reply-adapter', 'current'],
                ['agentic-runtime', 'current'],
            ]);
        }
        // Nothing changed, so the "start a new session" advice must not fire.
        expect(human_lines(report).join('\n')).not.toMatch(/new session/i);
    });

    // I5 (final review): four hosts ship with paths taken from documentation
    // rather than a verification run, and nothing surfaced it.
    it('carries each host\'s verified flag into the report', async()=>{
        const report = await run_skills(opts());
        expect(report.hosts.map(h=>[h.host, h.verified])).toEqual([
            ['claude-code', true],
            ['cursor', false],
        ]);
        expect(human_lines(report).join('\n')).toContain('paths not yet verified');
    });

    it('carries the verified flag on a host that was requested but not installed', async()=>{
        const report = await run_skills(opts({agents: ['windsurf']}));
        expect(report.hosts[0].verified).toBe(false);
    });

    it('reports no commit when the clone failed', async()=>{
        const failing_clone = async()=>{
            throw new Error('git not found');
        };
        const report = await run_skills(opts({
            agents: ['cursor'],
            deps: {...opts().deps, clone: failing_clone},
        }));
        expect(report.hosts[0]).toEqual(expect.objectContaining({status: 'failed', reason: 'clone-failed'}));
        expect(report.source).toEqual({repo: 'reply-team/reply-skills', ref: 'main'});
    });
});
