import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {run_flat, skills_target} from '../../skills/adapter-flat';
import {host_by_id} from '../../skills/hosts';
import {PACKS_FALLBACK, resolve_packs} from '../../skills/packs';
import {journal_entry} from '../../skills/journal';
import type {Detected_host} from '../../skills/detect';

const all = resolve_packs([], PACKS_FALLBACK);
const core_only = resolve_packs(['core'], PACKS_FALLBACK);

let root: string;
let home: string;
let clone_dir: string;
const env = ()=>({REPLY_CONFIG_DIR: path.join(root, 'config')});

const cursor = (): Detected_host=>
    ({def: host_by_id('cursor'), config_dir: path.join(home, '.cursor')});

// Stands in for `git clone`: builds the pack layout the real repo has.
const fake_clone = async(): Promise<{dir: string; commit: string}>=>{
    for (const pack of all)
    {
        const skills = path.join(clone_dir, 'plugins', pack.name, 'skills');
        fs.mkdirSync(path.join(skills, `${pack.name}-skill`), {recursive: true});
        fs.writeFileSync(
            path.join(skills, `${pack.name}-skill`, 'SKILL.md'),
            `---\nname: ${pack.name}-skill\ndescription: d\n---\n`,
        );
    }
    return {dir: clone_dir, commit: 'deadbee'};
};

const flat_opts = (operation: 'install' | 'remove' | 'list' | 'update', packs = all)=>({
    operation, host: cursor(), packs, scope: 'user' as const, ref: 'main',
    home, cwd: path.join(root, 'project'), env: env(), clone: fake_clone,
});

beforeEach(()=>{
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-flat-'));
    home = path.join(root, 'home');
    clone_dir = path.join(root, 'clone');
    fs.mkdirSync(path.join(home, '.cursor'), {recursive: true});
});
afterEach(()=>{
    fs.rmSync(root, {recursive: true, force: true});
});

describe('skills_target', ()=>{
    it('uses the host user directory for user scope', ()=>{
        expect(skills_target(host_by_id('cursor'), 'user', home, '/p')).toBe(path.join(home, '.cursor', 'skills'));
    });

    it('uses the project directory for project scope', ()=>{
        expect(skills_target(host_by_id('cursor'), 'project', home, '/p')).toBe(path.join('/p', '.agents', 'skills'));
    });

    it('sends a native host under --project to its project directory', ()=>{
        expect(skills_target(host_by_id('codex'), 'project', home, '/p')).toBe(path.join('/p', '.agents', 'skills'));
    });
});

describe('run_flat install', ()=>{
    it('copies every pack skill into the host skills directory', async()=>{
        const outcome = await run_flat(flat_opts('install'));
        const target = path.join(home, '.cursor', 'skills');
        expect(fs.existsSync(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'))).toBe(true);
        expect(fs.existsSync(path.join(target, 'agentic-runtime-skill', 'SKILL.md'))).toBe(true);
        expect(outcome.status).toBe('ok');
        expect(outcome.packs?.map(p=>p.action)).toEqual(['installed', 'installed', 'installed']);
    });

    it('creates the skills directory when the host has none yet', async()=>{
        fs.rmSync(path.join(home, '.cursor', 'skills'), {recursive: true, force: true});
        await run_flat(flat_opts('install'));
        expect(fs.existsSync(path.join(home, '.cursor', 'skills'))).toBe(true);
    });

    it('copies only the requested pack', async()=>{
        await run_flat(flat_opts('install', core_only));
        const target = path.join(home, '.cursor', 'skills');
        expect(fs.existsSync(path.join(target, 'ai-sdr-core-skill'))).toBe(true);
        expect(fs.existsSync(path.join(target, 'reply-adapter-skill'))).toBe(false);
    });

    it('journals the version, ref, commit and the files it wrote', async()=>{
        await run_flat(flat_opts('install', core_only));
        const entry = journal_entry('cursor', 'ai-sdr-core', env());
        expect(entry?.version).toBe('0.1.0');
        expect(entry?.commit).toBe('deadbee');
        expect(entry?.ref).toBe('main');
        expect(entry?.files.some(f=>f.endsWith('SKILL.md'))).toBe(true);
    });

    it('replaces on re-run instead of duplicating, and reports current', async()=>{
        await run_flat(flat_opts('install', core_only));
        const outcome = await run_flat(flat_opts('install', core_only));
        const target = path.join(home, '.cursor', 'skills');
        expect(fs.readdirSync(target)).toEqual(['ai-sdr-core-skill']);
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'current', version: '0.1.0'}]);
    });

    it('leaves a user-authored skill in the same directory byte-identical', async()=>{
        const target = path.join(home, '.cursor', 'skills');
        fs.mkdirSync(path.join(target, 'my-own-skill'), {recursive: true});
        const mine = path.join(target, 'my-own-skill', 'SKILL.md');
        fs.writeFileSync(mine, '---\nname: my-own-skill\ndescription: mine\n---\nkeep me\n');
        const before = fs.readFileSync(mine);
        await run_flat(flat_opts('install'));
        await run_flat(flat_opts('remove'));
        expect(fs.readFileSync(mine)).toEqual(before);
    });

    it('changes nothing on --dry-run', async()=>{
        const outcome = await run_flat({...flat_opts('install'), dry_run: true});
        expect(fs.existsSync(path.join(home, '.cursor', 'skills', 'ai-sdr-core-skill'))).toBe(false);
        expect(outcome.packs?.map(p=>p.action)).toEqual(['installed', 'installed', 'installed']);
        expect(journal_entry('cursor', 'ai-sdr-core', env())).toBeUndefined();
    });

    it('fails the host with an actionable hint when cloning fails', async()=>{
        const outcome = await run_flat({
            ...flat_opts('install'),
            clone: async()=>{ throw new Error('git not found'); },
        });
        expect(outcome.status).toBe('failed');
        expect(outcome.reason).toBe('clone-failed');
        expect(outcome.detail).toContain('git not found');
        expect(outcome.hint).toContain('git');
    });
});

describe('run_flat remove and list', ()=>{
    it('deletes only journaled files and forgets the pack', async()=>{
        await run_flat(flat_opts('install', core_only));
        const outcome = await run_flat(flat_opts('remove', core_only));
        expect(fs.existsSync(path.join(home, '.cursor', 'skills', 'ai-sdr-core-skill'))).toBe(false);
        expect(journal_entry('cursor', 'ai-sdr-core', env())).toBeUndefined();
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'removed', version: '0.1.0'}]);
    });

    it('ignores a pack that was never installed', async()=>{
        const outcome = await run_flat(flat_opts('remove', core_only));
        expect(outcome.packs).toEqual([]);
    });

    it('lists what the journal says is installed without cloning', async()=>{
        await run_flat(flat_opts('install', core_only));
        const outcome = await run_flat({
            ...flat_opts('list'),
            clone: async()=>{ throw new Error('list must not clone'); },
        });
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'current', version: '0.1.0'}]);
    });

    it('update re-copies an installed pack and leaves an absent one alone', async()=>{
        await run_flat(flat_opts('install', core_only));
        const outcome = await run_flat(flat_opts('update', all));
        expect(outcome.packs?.map(p=>p.name)).toEqual(['ai-sdr-core']);
        expect(fs.existsSync(path.join(home, '.cursor', 'skills', 'reply-adapter-skill'))).toBe(false);
    });
});
