import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {clone_repo, copy_dir, run_flat, skills_target} from '../../skills/adapter-flat';
import {host_by_id} from '../../skills/hosts';
import {PACKS_FALLBACK, resolve_packs} from '../../skills/packs';
import {journal_entry, record_pack} from '../../skills/journal';
import type {Detected_host} from '../../skills/detect';
import type {Runner} from '../../skills/types';

const all = resolve_packs([], PACKS_FALLBACK);
const core_only = resolve_packs(['core'], PACKS_FALLBACK);

let root: string;
let home: string;
let clone_dir: string;
const env = ()=>({REPLY_CONFIG_DIR: path.join(root, 'config')});

const cursor = (): Detected_host=>
    ({def: host_by_id('cursor'), config_dir: path.join(home, '.cursor')});

// A second flat host that shares its project-scope directory with cursor
// (both resolve `.agents/skills`), used to exercise the multi-host sharing
// path (see 'run_flat shared project directories across hosts' below).
const gemini = (): Detected_host=>
    ({def: host_by_id('gemini-cli'), config_dir: path.join(home, '.gemini')});

// A native host reachable by run_flat only under --project (it has no
// user_skills_dir), used to exercise the "no directory for this scope" path.
const codex = (): Detected_host=>
    ({def: host_by_id('codex'), config_dir: path.join(home, '.codex')});

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
        const entry = journal_entry('cursor', 'user', 'ai-sdr-core', env());
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
        expect(journal_entry('cursor', 'user', 'ai-sdr-core', env())).toBeUndefined();
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
        expect(journal_entry('cursor', 'user', 'ai-sdr-core', env())).toBeUndefined();
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

// C1: the journal must be consulted per scope, not per host+pack alone — a
// user-scope install and a project-scope install of the same pack on the
// same host must never be able to see, or delete, one another's files.
describe('run_flat scope isolation', ()=>{
    it('keeps a user-scope install and a project-scope install of the same pack independent', async()=>{
        await run_flat(flat_opts('install', core_only));
        const project_outcome = await run_flat({...flat_opts('install', core_only), scope: 'project'});
        const user_target = path.join(home, '.cursor', 'skills');
        const project_target = path.join(root, 'project', '.agents', 'skills');

        // A first install under a different scope must actually copy, not
        // silently report 'current' because the pack is already journaled
        // under the other scope.
        expect(project_outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'installed', version: '0.1.0'}]);
        expect(fs.existsSync(path.join(user_target, 'ai-sdr-core-skill', 'SKILL.md'))).toBe(true);
        expect(fs.existsSync(path.join(project_target, 'ai-sdr-core-skill', 'SKILL.md'))).toBe(true);

        const remove_outcome = await run_flat({...flat_opts('remove', core_only), scope: 'project'});
        expect(remove_outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'removed', version: '0.1.0'}]);
        expect(fs.existsSync(path.join(project_target, 'ai-sdr-core-skill'))).toBe(false);
        // Removing the project-scope install must not touch the user-scope one.
        expect(fs.existsSync(path.join(user_target, 'ai-sdr-core-skill', 'SKILL.md'))).toBe(true);
        expect(journal_entry('cursor', 'user', 'ai-sdr-core', env())?.version).toBe('0.1.0');
    });
});

// I1: a per-host filesystem failure during copy must become a Host_outcome,
// never a rejected promise, and packs that already landed before the failure
// must still be reported and journaled rather than orphaned.
describe('run_flat copy failures', ()=>{
    it('reports a failed status instead of rejecting when a per-pack copy throws, keeping earlier successes', async()=>{
        const broken_clone = async(): Promise<{dir: string; commit: string}>=>{
            const core_skills = path.join(clone_dir, 'plugins', 'ai-sdr-core', 'skills');
            fs.mkdirSync(path.join(core_skills, 'ai-sdr-core-skill'), {recursive: true});
            fs.writeFileSync(path.join(core_skills, 'ai-sdr-core-skill', 'SKILL.md'), '---\nname: x\n---\n');
            // Deliberately no plugins/reply-adapter/skills directory, so its
            // readdirSync throws mid-loop.
            return {dir: clone_dir, commit: 'deadbee'};
        };
        const outcome = await run_flat({...flat_opts('install', all), clone: broken_clone});
        expect(outcome.status).toBe('partial');
        expect(outcome.reason).toBe('copy-failed');
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'installed', version: '0.1.0'}]);
        expect(fs.existsSync(path.join(home, '.cursor', 'skills', 'ai-sdr-core-skill', 'SKILL.md'))).toBe(true);
        expect(journal_entry('cursor', 'user', 'ai-sdr-core', env())?.version).toBe('0.1.0');
    });

    it('copy_dir preserves files already written across a later failure, instead of discarding them', ()=>{
        // A directory-listing-order-independent way to pin the same contract
        // the install loop relies on: copy_dir mutates the array it is given,
        // so a throw from a second, unrelated call still leaves the first
        // call's file visible to the caller rather than orphaned off-journal.
        const good_from = path.join(root, 'good-src');
        fs.mkdirSync(good_from, {recursive: true});
        fs.writeFileSync(path.join(good_from, 'SKILL.md'), 'content');
        const to = path.join(root, 'dest');
        const written: string[] = [];

        copy_dir(good_from, path.join(to, 'skill-a'), written);
        expect(written).toEqual([path.join(to, 'skill-a', 'SKILL.md')]);

        const missing_from = path.join(root, 'does-not-exist');
        expect(()=>copy_dir(missing_from, path.join(to, 'skill-b'), written)).toThrow();
        // The first call's entry must still be there after the second throws.
        expect(written).toEqual([path.join(to, 'skill-a', 'SKILL.md')]);
    });
});

// I2: delete_files must only ever touch paths under the host's own skills
// directory, and must never remove the skills directory itself, even when
// the journal entry driving it is hand-edited or stale.
describe('run_flat deletion containment', ()=>{
    it('does not delete a journaled path outside the skills directory', async()=>{
        const outside = path.join(root, 'outside.txt');
        fs.writeFileSync(outside, 'do not touch');
        record_pack('cursor', 'user', 'ai-sdr-core', {
            version: '0.1.0', ref: 'main', commit: 'deadbee', scope: 'user',
            files: [outside], installed_at: '2026-07-30T00:00:00.000Z',
        }, env());
        const outcome = await run_flat(flat_opts('remove', core_only));
        expect(fs.existsSync(outside)).toBe(true);
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'removed', version: '0.1.0'}]);
    });

    it('deletes a journaled file directly under the skills root without pruning the root itself', async()=>{
        const target = path.join(home, '.cursor', 'skills');
        fs.mkdirSync(target, {recursive: true});
        const direct = path.join(target, 'direct.txt');
        fs.writeFileSync(direct, 'x');
        record_pack('cursor', 'user', 'ai-sdr-core', {
            version: '0.1.0', ref: 'main', commit: 'deadbee', scope: 'user',
            files: [direct], installed_at: '2026-07-30T00:00:00.000Z',
        }, env());
        await run_flat(flat_opts('remove', core_only));
        expect(fs.existsSync(direct)).toBe(false);
        expect(fs.existsSync(target)).toBe(true);
    });
});

// I3: the byte-identical guarantee also has to hold when the user's skill
// happens to share its name with one we ship, not just when the names differ.
describe('run_flat name collisions', ()=>{
    it('fails a pack instead of overwriting a user-authored skill with a colliding name', async()=>{
        const target = path.join(home, '.cursor', 'skills');
        fs.mkdirSync(path.join(target, 'ai-sdr-core-skill'), {recursive: true});
        const mine = path.join(target, 'ai-sdr-core-skill', 'SKILL.md');
        fs.writeFileSync(mine, '---\nname: mine\ndescription: not the pack\n---\nkeep me\n');
        const before = fs.readFileSync(mine);

        const outcome = await run_flat(flat_opts('install', core_only));

        expect(outcome.packs).toEqual([{
            name: 'ai-sdr-core', action: 'failed', detail: 'conflicts with an existing skill: ai-sdr-core-skill',
        }]);
        expect(fs.readFileSync(mine)).toEqual(before);
        expect(journal_entry('cursor', 'user', 'ai-sdr-core', env())).toBeUndefined();
    });
});

// I4: several flat hosts resolve the same physical directory under --project
// (`.agents/skills`). Removing one host's install must not delete files a
// sibling host's install still claims, and must not silently invalidate that
// sibling's journal entry.
describe('run_flat shared project directories across hosts', ()=>{
    it('does not delete a sibling host\'s install of the same pack from a shared project directory', async()=>{
        fs.mkdirSync(path.join(home, '.gemini'), {recursive: true});
        await run_flat({...flat_opts('install', core_only), scope: 'project'});
        await run_flat({...flat_opts('install', core_only), scope: 'project', host: gemini()});

        const shared = path.join(root, 'project', '.agents', 'skills', 'ai-sdr-core-skill', 'SKILL.md');
        expect(fs.existsSync(shared)).toBe(true);

        const outcome = await run_flat({...flat_opts('remove', core_only), scope: 'project'});
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'removed', version: '0.1.0'}]);
        expect(journal_entry('cursor', 'project', 'ai-sdr-core', env())).toBeUndefined();
        // gemini-cli's install still claims the shared file, so it survives.
        expect(fs.existsSync(shared)).toBe(true);
        expect(journal_entry('gemini-cli', 'project', 'ai-sdr-core', env())?.version).toBe('0.1.0');

        const list_outcome = await run_flat({
            ...flat_opts('list', core_only), scope: 'project', host: gemini(),
            clone: async()=>{ throw new Error('list must not clone'); },
        });
        expect(list_outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'current', version: '0.1.0'}]);
    });
});

// I5: a host with no directory configured for the requested scope (a native
// host under `user` scope) must be skipped, not crashed on with a TypeError
// from joining `undefined` into a path.
describe('run_flat with no skills directory for the scope', ()=>{
    it('reports skipped instead of crashing', async()=>{
        const outcome = await run_flat({...flat_opts('install', core_only), host: codex(), scope: 'user'});
        expect(outcome.status).toBe('skipped');
        expect(outcome.reason).toBe('no-skills-dir');
    });
});

// Minor, requested alongside the fixes above: clone_repo must not leave its
// temp directory behind on either failure path, and must check the exit code
// of `git rev-parse HEAD` rather than journaling an empty commit.
describe('clone_repo', ()=>{
    it('throws and removes its temp directory when `git clone` fails', async()=>{
        let captured_dir = '';
        const run: Runner = async(_bin, args)=>{
            if (args[0] === 'clone')
            {
                captured_dir = args[args.length - 1];
                return {code: 128, stdout: '', stderr: 'fatal: repository not found'};
            }
            return {code: 0, stdout: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n', stderr: ''};
        };
        await expect(clone_repo({ref: 'main', run, tmp_root: root})).rejects.toThrow('repository not found');
        expect(captured_dir).not.toBe('');
        expect(fs.existsSync(captured_dir)).toBe(false);
    });

    it('throws and removes its temp directory when `git rev-parse HEAD` fails', async()=>{
        let captured_dir = '';
        const run: Runner = async(_bin, args)=>{
            if (args[0] === 'clone')
            {
                captured_dir = args[args.length - 1];
                return {code: 0, stdout: '', stderr: ''};
            }
            return {code: 1, stdout: '', stderr: 'fatal: not a git repository'};
        };
        await expect(clone_repo({ref: 'main', run, tmp_root: root})).rejects.toThrow('not a git repository');
        expect(captured_dir).not.toBe('');
        expect(fs.existsSync(captured_dir)).toBe(false);
    });
});
