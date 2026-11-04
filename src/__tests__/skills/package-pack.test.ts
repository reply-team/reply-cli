import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {execSync} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {cli_version} from '../../config';
import {read_journal, record_pack} from '../../skills/journal';
import {MOVED, pack_dir, resolve_packs} from '../../skills/packs';
import {run_skills} from '../../skills/orchestrate';
import {human_lines} from '../../skills/report';
import type {Detect_deps} from '../../skills/detect';
import type {Runner, Run_result} from '../../skills/types';
import {UsageError} from '../../utils/errors';

// The pack the package carries, and how every operation reaches it: from the
// package's own files, at the CLI's own version, with no network and no git.

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SKILLS = ['reply-api', 'reply-auth', 'reply-cli', 'reply-mcp', 'reply-operations-mapping'];

const files_under = (dir: string): string[]=>fs.readdirSync(dir, {withFileTypes: true}).flatMap(e=>
    e.isDirectory()
        ? files_under(path.join(dir, e.name)).map(f=>path.join(e.name, f))
        : [e.name]);

let root: string;
let home: string;
let env: Record<string, string>;

const ok = (stdout = ''): Run_result=>({code: 0, stdout, stderr: ''});

// `claude plugin list --json` in the direct-array shape, rows of the
// marketplace an earlier version registered, plus one foreign row.
const claude_listing = (ids: string[]): string=>JSON.stringify([
    ...ids.map(id=>({id, version: '0.3.0', scope: 'user', enabled: true})),
    {id: 'elastic-elasticsearch@elastic-agent-skills', version: '0.2.4', scope: 'user', enabled: true},
]);

// A runner that answers the plugin CLI and refuses everything else, git
// included: an install that reaches for anything but the host's plugin
// listing and uninstall fails the test.
const plugin_runner = (opts: {listed?: string[]; uninstall_fails?: boolean} = {})=>{
    const calls: string[][] = [];
    const run: Runner = async(bin, args)=>{
        calls.push([bin, ...args]);
        if (bin !== '/usr/bin/claude')
        {
            throw new Error(`unexpected process: ${bin} ${args.join(' ')}`);
        }
        if (args.join(' ') === 'plugin list --json')
        {
            return ok(claude_listing(opts.listed ?? []));
        }
        if (args[0] === 'plugin' && args[1] === 'uninstall')
        {
            return opts.uninstall_fails
                ? {code: 1, stdout: '', stderr: 'Plugin is locked by another process'}
                : ok();
        }
        throw new Error(`unexpected command: ${bin} ${args.join(' ')}`);
    };
    return {run, calls};
};

const detect = (bins: Record<string, string> = {claude: '/usr/bin/claude'}): Detect_deps=>({
    home,
    platform: 'linux',
    exists: (p: string)=>fs.existsSync(p),
    find_on_path: (name: string)=>bins[name],
    glob_first: ()=>undefined,
});

const opts = (over: Record<string, unknown> = {}, run?: Runner)=>({
    operation: 'install' as const,
    requested: [] as string[],
    project: false,
    dry_run: false,
    deps: {detect: detect(), run: run ?? plugin_runner().run, home, cwd: path.join(root, 'project'), env},
    ...over,
});

beforeEach(()=>{
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-pack-'));
    home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, '.claude'), {recursive: true});
    env = {REPLY_CONFIG_DIR: path.join(root, 'config')};
    // Any network read fails the test that makes it.
    vi.stubGlobal('fetch', ()=>{
        throw new Error('network read');
    });
});
afterEach(()=>{
    vi.unstubAllGlobals();
    fs.rmSync(root, {recursive: true, force: true});
});

describe('the pack in the package', ()=>{
    it('is found from the source layout: the five skills, each with its SKILL.md', ()=>{
        const dir = pack_dir();
        expect(path.resolve(dir)).toBe(path.join(REPO_ROOT, 'skills', 'reply-adapter'));
        expect(fs.readdirSync(dir).sort()).toEqual(SKILLS);
        for (const skill of SKILLS)
        {
            expect(fs.existsSync(path.join(dir, skill, 'SKILL.md'))).toBe(true);
        }
    });

    it('is found from the built layout, which sits at the same depth under dist', ()=>{
        expect(path.resolve(pack_dir(path.join(REPO_ROOT, 'dist', 'skills'))))
            .toBe(path.join(REPO_ROOT, 'skills', 'reply-adapter'));
        // The build itself, where one exists (CI builds before it tests).
        const built = path.join(REPO_ROOT, 'dist', 'skills', 'packs.js');
        if (fs.existsSync(built))
        {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require(built) as {pack_dir: ()=>string};
            expect(path.resolve(mod.pack_dir())).toBe(path.join(REPO_ROOT, 'skills', 'reply-adapter'));
        }
    });

    it('is in what npm publishes, every file of it', ()=>{
        const out = execSync('npm pack --dry-run --json --ignore-scripts', {
            cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        });
        const published = new Set((JSON.parse(out)[0].files as {path: string}[]).map(f=>f.path));
        const expected = files_under(pack_dir()).map(f=>`skills/reply-adapter/${f.split(path.sep).join('/')}`);
        expect(expected.length).toBeGreaterThan(SKILLS.length);
        for (const file of expected)
        {
            expect(published.has(file), file).toBe(true);
        }
    }, 120_000);

    it('is installed at the CLI\'s own version', ()=>{
        expect(resolve_packs([], 'install')).toEqual([{name: 'reply-adapter', version: cli_version()}]);
        expect(resolve_packs(['adapter'], 'update')).toEqual([{name: 'reply-adapter', version: cli_version()}]);
    });
});

describe('the names this CLI no longer offers', ()=>{
    for (const name of ['core', 'ai-sdr-core', 'runtime', 'agentic-runtime'])
    {
        for (const operation of ['install', 'update'] as const)
        {
            it(`refuses ${name} on ${operation} with the one sentence and exit code 2`, async()=>{
                const attempt = run_skills(opts({operation, requested: [name]}));
                await expect(attempt).rejects.toThrow(UsageError);
                await expect(attempt).rejects.toMatchObject({message: MOVED, exit_code: 2});
            });
        }
    }

    it('says it in one sentence that names Jason', ()=>{
        expect(MOVED.split(/(?<=\.)\s/)).toHaveLength(1);
        expect(MOVED).toContain('github.com/reply-team/jason-ai');
    });
});

describe('install from the package', ()=>{
    it('copies every file of the pack into Claude Code\'s user skills directory, byte for byte, with no network and no git', async()=>{
        const report = await run_skills(opts());
        const target = path.join(home, '.claude', 'skills');
        for (const file of files_under(pack_dir()))
        {
            expect(fs.readFileSync(path.join(target, file)).equals(fs.readFileSync(path.join(pack_dir(), file))), file)
                .toBe(true);
        }
        expect(report.hosts[0]).toMatchObject({
            host: 'claude-code', scope: 'user', status: 'ok',
            packs: [{name: 'reply-adapter', action: 'installed', version: cli_version()}],
        });
    });

    it('copies into Codex\'s user directory, .agents/skills', async()=>{
        fs.mkdirSync(path.join(home, '.codex'), {recursive: true});
        const report = await run_skills(opts({agents: ['codex']}));
        expect(report.hosts[0]).toMatchObject({host: 'codex', status: 'ok'});
        expect(fs.existsSync(path.join(home, '.agents', 'skills', 'reply-cli', 'SKILL.md'))).toBe(true);
    });

    it('journals the version and no repository ref or commit, and reports neither', async()=>{
        const report = await run_skills(opts());
        const entry = read_journal(env).hosts['claude-code'].user['reply-adapter'];
        expect(entry.version).toBe(cli_version());
        expect(entry).not.toHaveProperty('ref');
        expect(entry).not.toHaveProperty('commit');
        expect(report.source).toEqual({version: cli_version()});
        expect(report.hosts[0]).not.toHaveProperty('commit');
    });

    it('removes the old reply-adapter plugin through the host CLI, that plugin alone', async()=>{
        const {run, calls} = plugin_runner({listed: [
            'ai-sdr-core@reply-skills', 'reply-adapter@reply-skills', 'agentic-runtime@reply-skills',
        ]});
        const report = await run_skills(opts({}, run));
        const uninstalls = calls.filter(c=>c[2] === 'uninstall');
        expect(uninstalls).toEqual([['/usr/bin/claude', 'plugin', 'uninstall', 'reply-adapter@reply-skills']]);
        expect(calls.some(c=>c.includes('marketplace'))).toBe(false);
        expect(report.hosts[0]).toMatchObject({
            status: 'ok',
            packs: [{name: 'reply-adapter', action: 'upgraded', from: '0.3.0', version: cli_version()}],
            old_plugin: {id: 'reply-adapter@reply-skills', action: 'removed'},
        });
    });

    it('says in one line that the other two old plugins stay and are no longer offered', async()=>{
        const {run} = plugin_runner({listed: [
            'ai-sdr-core@reply-skills', 'reply-adapter@reply-skills', 'agentic-runtime@reply-skills',
        ]});
        const report = await run_skills(opts({}, run));
        expect(report.hosts[0].retired_plugins).toEqual(['ai-sdr-core@reply-skills', 'agentic-runtime@reply-skills']);
        const lines = human_lines(report).filter(l=>l.includes('no longer offers'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('ai-sdr-core@reply-skills');
        expect(lines[0]).toContain('agentic-runtime@reply-skills');
    });

    it('names in that line the retired packs an earlier version copied into a host, on install and on update', async()=>{
        fs.mkdirSync(path.join(home, '.cursor'), {recursive: true});
        for (const [pack, skill] of [['ai-sdr-core', 'sdr-operations'], ['agentic-runtime', 'durable-work']])
        {
            const file = path.join(home, '.cursor', 'skills', skill, 'SKILL.md');
            fs.mkdirSync(path.dirname(file), {recursive: true});
            fs.writeFileSync(file, `${skill}\n`);
            record_pack('cursor', 'user', pack, {
                version: '0.1.0', ref: 'main', commit: 'cafe123', scope: 'user',
                files: [file], complete: true, installed_at: '2026-10-01T00:00:00.000Z',
            }, env);
        }
        for (const operation of ['install', 'update'] as const)
        {
            const report = await run_skills(opts({operation, agents: ['cursor']}));
            expect(report.hosts[0].retired_packs, operation).toEqual(['ai-sdr-core', 'agentic-runtime']);
            const lines = human_lines(report).filter(l=>l.includes('no longer offers'));
            expect(lines, operation).toHaveLength(1);
            expect(lines[0], operation).toContain(
                'ai-sdr-core, agentic-runtime stay installed in Cursor; this CLI no longer offers them.');
        }
        // Only what this run's scope recorded: the user-scope copies are not a project's.
        const project = await run_skills(opts({agents: ['cursor'], project: true}));
        expect(project.hosts[0].retired_packs).toBeUndefined();
    });

    it('proceeds when the old plugin cannot be removed, and says it is still there beside the copy', async()=>{
        const {run} = plugin_runner({listed: ['reply-adapter@reply-skills'], uninstall_fails: true});
        const report = await run_skills(opts({}, run));
        expect(fs.existsSync(path.join(home, '.claude', 'skills', 'reply-api', 'SKILL.md'))).toBe(true);
        expect(report.hosts[0]).toMatchObject({
            status: 'ok',
            old_plugin: {id: 'reply-adapter@reply-skills', action: 'failed', detail: 'Plugin is locked by another process'},
        });
        expect(report.summary.installed).toBe(1);
        expect(human_lines(report).join('\n')).toMatch(/reply-adapter@reply-skills plugin is still installed/);
    });

    it('refuses a personal skill of the same name in Claude Code\'s user directory and leaves the old plugin alone', async()=>{
        const mine = path.join(home, '.claude', 'skills', 'reply-api', 'SKILL.md');
        fs.mkdirSync(path.dirname(mine), {recursive: true});
        fs.writeFileSync(mine, 'my own skill\n');
        const {run, calls} = plugin_runner({listed: ['reply-adapter@reply-skills']});
        const report = await run_skills(opts({}, run));
        expect(fs.readFileSync(mine, 'utf8')).toBe('my own skill\n');
        expect(fs.existsSync(path.join(home, '.claude', 'skills', 'reply-cli'))).toBe(false);
        expect(report.hosts[0]).toMatchObject({
            status: 'failed',
            packs: [{name: 'reply-adapter', action: 'failed', detail: 'conflicts with an existing skill: reply-api'}],
        });
        expect(calls.some(c=>c[2] === 'uninstall')).toBe(false);
    });
});

describe('update from the package', ()=>{
    it('replaces the old plugin with the copy on a host that has only the plugin', async()=>{
        const {run, calls} = plugin_runner({listed: ['reply-adapter@reply-skills']});
        const report = await run_skills(opts({operation: 'update'}, run));
        expect(fs.existsSync(path.join(home, '.claude', 'skills', 'reply-mcp', 'SKILL.md'))).toBe(true);
        expect(calls.filter(c=>c[2] === 'uninstall')).toEqual([
            ['/usr/bin/claude', 'plugin', 'uninstall', 'reply-adapter@reply-skills'],
        ]);
        expect(report.hosts[0]).toMatchObject({
            packs: [{name: 'reply-adapter', action: 'upgraded', from: '0.3.0'}],
            old_plugin: {action: 'removed'},
        });
    });

    it('brings a copy an earlier version made from a repository to this version', async()=>{
        fs.mkdirSync(path.join(home, '.cursor'), {recursive: true});
        const old = path.join(home, '.cursor', 'skills', 'reply-api', 'SKILL.md');
        fs.mkdirSync(path.dirname(old), {recursive: true});
        fs.writeFileSync(old, 'old text\n');
        record_pack('cursor', 'user', 'reply-adapter', {
            version: '0.1.0', ref: 'main', commit: 'cafe123', scope: 'user',
            files: [old], complete: true, installed_at: '2026-10-01T00:00:00.000Z',
        }, env);
        const report = await run_skills(opts({operation: 'update', agents: ['cursor']}));
        expect(report.hosts[0].packs).toEqual([
            {name: 'reply-adapter', action: 'upgraded', from: '0.1.0', version: cli_version()},
        ]);
        expect(fs.readFileSync(old).equals(fs.readFileSync(path.join(pack_dir(), 'reply-api', 'SKILL.md')))).toBe(true);
    });
});

describe('list and remove over what an earlier version installed', ()=>{
    // The shape 0.18.0 journaled: a copy of the three packs, from a ref and a commit.
    const seed_old_copy = ()=>{
        fs.mkdirSync(path.join(home, '.cursor'), {recursive: true});
        const files: Record<string, string> = {};
        for (const [pack, skill] of [['ai-sdr-core', 'sdr-operations'], ['reply-adapter', 'reply-api'], ['agentic-runtime', 'durable-work']])
        {
            const file = path.join(home, '.cursor', 'skills', skill, 'SKILL.md');
            fs.mkdirSync(path.dirname(file), {recursive: true});
            fs.writeFileSync(file, `${skill}\n`);
            files[pack] = file;
            record_pack('cursor', 'user', pack, {
                version: '0.1.0', ref: 'main', commit: 'cafe123', scope: 'user',
                files: [file], complete: true, installed_at: '2026-10-01T00:00:00.000Z',
            }, env);
        }
        return files;
    };

    it('lists a journal entry of the earlier shape, the retired packs marked as no longer offered', async()=>{
        seed_old_copy();
        const report = await run_skills(opts({operation: 'list', agents: ['cursor']}));
        expect(report.hosts[0].packs).toEqual([
            {name: 'reply-adapter', action: 'upgraded', version: cli_version(), from: '0.1.0'},
            {name: 'ai-sdr-core', action: 'current', version: '0.1.0', retired: true},
            {name: 'agentic-runtime', action: 'current', version: '0.1.0', retired: true},
        ]);
        expect(human_lines(report).join('\n')).toContain('reply-adapter 0.1.0 update available; ai-sdr-core 0.1.0, agentic-runtime 0.1.0 installed, no longer offered');
    });

    it('removes a journal entry of the earlier shape under its old name, and everything with no name', async()=>{
        const files = seed_old_copy();
        const one = await run_skills(opts({operation: 'remove', requested: ['core'], agents: ['cursor']}));
        expect(one.hosts[0].packs).toEqual([{name: 'ai-sdr-core', action: 'removed', version: '0.1.0'}]);
        expect(fs.existsSync(files['ai-sdr-core'])).toBe(false);
        expect(fs.existsSync(files['reply-adapter'])).toBe(true);

        const all = await run_skills(opts({operation: 'remove', agents: ['cursor']}));
        expect(all.hosts[0].packs?.map(p=>p.name).sort()).toEqual(['agentic-runtime', 'reply-adapter']);
        expect(read_journal(env).hosts).toEqual({});
    });

    it('lists the <pack>@reply-skills plugins an earlier version installed', async()=>{
        const {run} = plugin_runner({listed: ['ai-sdr-core@reply-skills', 'reply-adapter@reply-skills']});
        const report = await run_skills(opts({operation: 'list'}, run));
        expect(report.hosts[0].packs).toEqual([
            {name: 'reply-adapter@reply-skills', action: 'upgraded', version: cli_version(), from: '0.3.0'},
            {name: 'ai-sdr-core@reply-skills', action: 'current', version: '0.3.0', retired: true},
        ]);
    });

    it('removes the <pack>@reply-skills plugins through the host CLI, under any old name', async()=>{
        const {run, calls} = plugin_runner({listed: [
            'ai-sdr-core@reply-skills', 'reply-adapter@reply-skills', 'agentic-runtime@reply-skills',
        ]});
        const one = await run_skills(opts({operation: 'remove', requested: ['runtime']}, run));
        expect(one.hosts[0].packs).toEqual([{name: 'agentic-runtime@reply-skills', action: 'removed', version: '0.3.0'}]);
        expect(calls.filter(c=>c[2] === 'uninstall').map(c=>c[3])).toEqual(['agentic-runtime@reply-skills']);

        calls.length = 0;
        await run_skills(opts({operation: 'remove'}, run));
        expect(calls.filter(c=>c[2] === 'uninstall').map(c=>c[3]).sort()).toEqual([
            'agentic-runtime@reply-skills', 'ai-sdr-core@reply-skills', 'reply-adapter@reply-skills',
        ]);
        expect(calls.some(c=>c.includes('marketplace'))).toBe(false);
    });
});
