import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
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
// reply-adapter and agentic-runtime, requested directly with no dependency
// expansion, so ai-sdr-core is absent from the set — used to put two packs
// that do not depend on each other in the same run without either blocking
// the other via ai-sdr-core (see 'run_flat abort status' below).
const adapter_and_runtime_only = resolve_packs(['adapter', 'runtime'], PACKS_FALLBACK, {dependencies: false});

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
    it('refuses a journaled path outside the skills directory and says so instead of claiming removed', async()=>{
        const outside = path.join(root, 'outside.txt');
        fs.writeFileSync(outside, 'do not touch');
        record_pack('cursor', 'user', 'ai-sdr-core', {
            version: '0.1.0', ref: 'main', commit: 'deadbee', scope: 'user',
            files: [outside], complete: true, installed_at: '2026-07-30T00:00:00.000Z',
        }, env());
        const outcome = await run_flat(flat_opts('remove', core_only));
        expect(fs.existsSync(outside)).toBe(true);
        // Nothing was deleted, so nothing may be reported as removed — and the
        // entry stays, because forgetting it would strand the recorded files
        // with nothing left tracking them.
        expect(outcome.status).toBe('failed');
        expect(outcome.packs?.map(p=>[p.name, p.action])).toEqual([['ai-sdr-core', 'failed']]);
        expect(outcome.packs?.[0].detail).toContain(outside);
        expect(journal_entry('cursor', 'user', 'ai-sdr-core', env())?.version).toBe('0.1.0');
    });

    // Deferred minor promoted to must-fix: `fs.rmSync(file, {force: true})`
    // does not clear the read-only attribute on Windows and throws EPERM.
    // Swallowing that left the file on disk and the pack reported `removed`.
    it('reports a file it could not delete instead of a false success', async()=>{
        await run_flat(flat_opts('install', core_only));
        const rm_spy = vi.spyOn(fs, 'rmSync').mockImplementationOnce(()=>{
            throw Object.assign(new Error('EPERM: operation not permitted, unlink'), {code: 'EPERM'});
        });
        try {
            const outcome = await run_flat(flat_opts('remove', core_only));
            expect(outcome.status).toBe('failed');
            expect(outcome.packs?.map(p=>[p.name, p.action])).toEqual([['ai-sdr-core', 'failed']]);
            expect(outcome.packs?.[0].detail).toContain('EPERM');
        } finally {
            rm_spy.mockRestore();
        }
        // Still tracked, so a later `remove` can retry it.
        expect(journal_entry('cursor', 'user', 'ai-sdr-core', env())?.version).toBe('0.1.0');
    });

    it('deletes a journaled file directly under the skills root without pruning the root itself', async()=>{
        const target = path.join(home, '.cursor', 'skills');
        fs.mkdirSync(target, {recursive: true});
        const direct = path.join(target, 'direct.txt');
        fs.writeFileSync(direct, 'x');
        record_pack('cursor', 'user', 'ai-sdr-core', {
            version: '0.1.0', ref: 'main', commit: 'deadbee', scope: 'user',
            files: [direct], complete: true, installed_at: '2026-07-30T00:00:00.000Z',
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
        expect(outcome.status).toBe('failed');
        expect(fs.readFileSync(mine)).toEqual(before);
        expect(journal_entry('cursor', 'user', 'ai-sdr-core', env())).toBeUndefined();
        // Nothing else depends on ai-sdr-core in this run, so nothing was
        // blocked — the hint is specifically for blocked dependents, not for
        // the failure itself.
        expect(outcome.hint).toBeUndefined();
    });
});

// Required fix, raised by the controller from a concern in the original
// self-review: adapter-native.ts never lets a dependent install while its
// dependency failed (failed_names/blocked_names). run_flat must enforce the
// same invariant — a pack that fails on a collision (I3) or a copy error (I1)
// must block anything depending on it, exactly like the native adapter.
describe('run_flat dependency blocking', ()=>{
    it('blocks every pack that depends on one that failed on a collision, and never copies them', async()=>{
        const target = path.join(home, '.cursor', 'skills');
        fs.mkdirSync(path.join(target, 'ai-sdr-core-skill'), {recursive: true});
        fs.writeFileSync(
            path.join(target, 'ai-sdr-core-skill', 'SKILL.md'),
            '---\nname: mine\ndescription: not the pack\n---\nkeep me\n',
        );

        const outcome = await run_flat(flat_opts('install', all));

        // reply-adapter and agentic-runtime both depend on ai-sdr-core, so
        // neither is attempted — blocked packs get no outcome entry at all,
        // matching adapter-native.ts's blocked_names behavior.
        expect(outcome.packs).toEqual([{
            name: 'ai-sdr-core', action: 'failed', detail: 'conflicts with an existing skill: ai-sdr-core-skill',
        }]);
        expect(outcome.status).toBe('failed');
        expect(outcome.hint).toContain('reply-adapter');
        expect(outcome.hint).toContain('agentic-runtime');
        expect(fs.existsSync(path.join(target, 'reply-adapter-skill'))).toBe(false);
        expect(fs.existsSync(path.join(target, 'agentic-runtime-skill'))).toBe(false);
        expect(journal_entry('cursor', 'user', 'reply-adapter', env())).toBeUndefined();
        expect(journal_entry('cursor', 'user', 'agentic-runtime', env())).toBeUndefined();
    });
});

// C1 (final review): reverse removal order is necessary but not sufficient.
// Once delete_files can report a file it could not remove, a failed removal
// must stop its dependency being removed too, or the host is left holding an
// adapter with no core — the one state this installer exists to prevent.
describe('run_flat remove dependency guard', ()=>{
    it('keeps a dependency installed when removing a pack that depends on it failed', async()=>{
        await run_flat(flat_opts('install', all));
        const target = path.join(home, '.cursor', 'skills');

        // Removal walks [agentic-runtime, reply-adapter, ai-sdr-core]; the
        // first rmSync is agentic-runtime's only file.
        const rm_spy = vi.spyOn(fs, 'rmSync').mockImplementationOnce(()=>{
            throw Object.assign(new Error('EPERM: operation not permitted, unlink'), {code: 'EPERM'});
        });
        let outcome;
        try {
            outcome = await run_flat(flat_opts('remove', all));
        } finally {
            rm_spy.mockRestore();
        }

        expect(outcome.packs?.map(p=>[p.name, p.action])).toEqual([
            ['agentic-runtime', 'failed'],
            ['reply-adapter', 'removed'],
        ]);
        expect(outcome.status).toBe('partial');
        expect(outcome.hint).toContain('ai-sdr-core');
        // The core survives on disk and in the journal, because a pack that
        // depends on it is still installed.
        expect(fs.existsSync(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'))).toBe(true);
        expect(journal_entry('cursor', 'user', 'ai-sdr-core', env())?.version).toBe('0.1.0');
        expect(journal_entry('cursor', 'user', 'agentic-runtime', env())?.version).toBe('0.1.0');
        expect(journal_entry('cursor', 'user', 'reply-adapter', env())).toBeUndefined();
    });

    it('removes everything, in reverse order, when nothing fails', async()=>{
        await run_flat(flat_opts('install', all));
        const outcome = await run_flat(flat_opts('remove', all));
        expect(outcome.packs?.map(p=>[p.name, p.action])).toEqual([
            ['agentic-runtime', 'removed'],
            ['reply-adapter', 'removed'],
            ['ai-sdr-core', 'removed'],
        ]);
        expect(outcome.status).toBe('ok');
        expect(outcome.hint).toBeUndefined();
        expect(fs.readdirSync(path.join(home, '.cursor', 'skills'))).toEqual([]);
    });
});

// I2 (final review): a project-scope entry is keyed host -> 'project' -> pack,
// which cannot tell two checkouts apart. Without the project root on the
// entry, `remove --project` from a second repository deletes nothing (the
// containment check refuses every path) and still reports `removed`.
describe('run_flat project-scope entries belong to one repository', ()=>{
    const other_project = ()=>path.join(root, 'other-project');

    it('leaves another repository\'s install alone and does not claim to have removed it', async()=>{
        await run_flat({...flat_opts('install', core_only), scope: 'project'});
        const installed_file = path.join(root, 'project', '.agents', 'skills', 'ai-sdr-core-skill', 'SKILL.md');
        expect(fs.existsSync(installed_file)).toBe(true);
        expect(journal_entry('cursor', 'project', 'ai-sdr-core', env())?.project_root)
            .toBe(path.resolve(path.join(root, 'project')));

        // Same machine, same host, same journal — a different repository.
        const outcome = await run_flat({
            ...flat_opts('remove', core_only), scope: 'project', cwd: other_project(),
        });

        expect(outcome.packs).toEqual([]);
        expect(fs.existsSync(installed_file)).toBe(true);
        // The first repository's entry is not this run's to forget.
        expect(journal_entry('cursor', 'project', 'ai-sdr-core', env())?.version).toBe('0.1.0');
    });

    it('does not report another repository\'s install in a project-scope list', async()=>{
        await run_flat({...flat_opts('install', core_only), scope: 'project'});
        const outcome = await run_flat({
            ...flat_opts('list', core_only), scope: 'project', cwd: other_project(),
            clone: async()=>{ throw new Error('list must not clone'); },
        });
        expect(outcome.packs).toEqual([]);
    });

    it('still removes a project install run from the repository that owns it', async()=>{
        await run_flat({...flat_opts('install', core_only), scope: 'project'});
        const outcome = await run_flat({...flat_opts('remove', core_only), scope: 'project'});
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'removed', version: '0.1.0'}]);
        expect(journal_entry('cursor', 'project', 'ai-sdr-core', env())).toBeUndefined();
    });

    it('leaves user-scope entries unkeyed and removable exactly as before', async()=>{
        await run_flat(flat_opts('install', core_only));
        expect(journal_entry('cursor', 'user', 'ai-sdr-core', env())?.project_root).toBeUndefined();
        // A different cwd is irrelevant to a user-scope install.
        const outcome = await run_flat({...flat_opts('remove', core_only), cwd: other_project()});
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'removed', version: '0.1.0'}]);
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

// New Important from the re-review: a failed copy journaled under the target
// version reads as installed, so the hint's own suggested fix ("re-run
// install") silently does nothing. Journal_entry.complete distinguishes a
// finished copy from a partial one; `pending` and `list` must both treat an
// incomplete entry as work still to do, never as current.
describe('run_flat incomplete installs', ()=>{
    it('really re-copies a pack whose entry is marked incomplete, even at the target version', async()=>{
        record_pack('cursor', 'user', 'ai-sdr-core', {
            version: '0.1.0', ref: 'main', commit: 'deadbee', scope: 'user',
            files: [], complete: false, installed_at: '2026-07-30T00:00:00.000Z',
        }, env());

        const outcome = await run_flat(flat_opts('install', core_only));

        // The repair landed at the same version, so the action is `current`
        // (I3: an unchanged version is never `upgraded`). What proves the copy
        // actually ran — rather than the entry short-circuiting to `current`
        // as it did before Journal_entry.complete existed — is the filesystem
        // and the journal below, not the action.
        expect(outcome.packs?.map(p=>({name: p.name, action: p.action}))).toEqual([
            {name: 'ai-sdr-core', action: 'current'},
        ]);
        const target = path.join(home, '.cursor', 'skills');
        expect(fs.existsSync(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'))).toBe(true);
        const entry = journal_entry('cursor', 'user', 'ai-sdr-core', env());
        expect(entry?.complete).toBe(true);
        expect(entry?.files.length).toBeGreaterThan(0);
        // The version did not move, but a broken install became a working one:
        // the files in front of the assistant are new, so the outcome has to
        // say so or the reporter cannot advise a new session.
        expect(outcome.packs?.[0].refreshed).toBe(true);
    });

    it('journals a copy failure as incomplete with only the files that actually landed, never the stale complete entry', async()=>{
        // A normal, fully successful install first.
        await run_flat(flat_opts('install', core_only));
        const target = path.join(home, '.cursor', 'skills');
        expect(journal_entry('cursor', 'user', 'ai-sdr-core', env())?.complete).toBe(true);

        // Force the very next file copy to throw before anything for this
        // re-attempt lands (written.length === 0 at the point of failure) —
        // portable and deterministic, unlike relying on a real permissions
        // failure, and precedented in this codebase (see output.test.ts).
        const copy_spy = vi.spyOn(fs, 'copyFileSync').mockImplementationOnce(()=>{
            throw new Error('simulated disk failure');
        });
        try {
            const outcome = await run_flat(flat_opts('update', core_only));
            expect(outcome.status).toBe('failed');
            expect(outcome.reason).toBe('copy-failed');
        } finally {
            copy_spy.mockRestore();
        }

        // The old entry (a different version's worth of files, all of which
        // delete_files already removed) must not survive as if nothing
        // happened: the pack must read as incomplete, not as the old,
        // now-nonexistent install.
        const entry = journal_entry('cursor', 'user', 'ai-sdr-core', env());
        expect(entry?.complete).toBe(false);
        expect(entry?.files).toEqual([]);
        // The old file is gone (delete_files already ran); the empty shell
        // directory copy_dir recreated before the throw is not "the pack" —
        // what matters is that no old content survives under the old entry.
        expect(fs.existsSync(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'))).toBe(false);
    });

    it('does not report an incomplete pack as current in `list`', async()=>{
        record_pack('cursor', 'user', 'ai-sdr-core', {
            version: '0.1.0', ref: 'main', commit: 'deadbee', scope: 'user',
            files: [], complete: false, installed_at: '2026-07-30T00:00:00.000Z',
        }, env());

        const outcome = await run_flat({
            ...flat_opts('list', core_only),
            clone: async()=>{ throw new Error('list must not clone'); },
        });

        expect(outcome.packs?.map(p=>p.action)).not.toContain('current');
        expect(outcome.status).not.toBe('ok');
    });
});

// This adapter clones a *ref*, so a new commit on `main` can rewrite every
// file while the version stays 0.1.0. Reporting `current` for that is right —
// the version really did not move — but the outcome must still record that the
// bytes did, or a run that rewrote the user's files reads as a no-op.
describe('run_flat re-copy at an unchanged version', ()=>{
    // Same layout as fake_clone, different commit — as a second `update` a day
    // later would see after the ref moved.
    const clone_at = (commit: string)=>async()=>{
        await fake_clone();
        return {dir: clone_dir, commit};
    };

    it('marks the pack refreshed when the ref moved but the version did not', async()=>{
        await run_flat({...flat_opts('install', core_only), clone: clone_at('aaaaaaa')});
        const outcome = await run_flat({...flat_opts('update', core_only), clone: clone_at('bbbbbbb')});

        expect(outcome.packs).toEqual([{
            name: 'ai-sdr-core', action: 'current', version: '0.1.0', refreshed: true,
        }]);
        expect(journal_entry('cursor', 'user', 'ai-sdr-core', env())?.commit).toBe('bbbbbbb');
    });

    it('does not mark it refreshed when the same commit is re-copied', async()=>{
        await run_flat({...flat_opts('install', core_only), clone: clone_at('aaaaaaa')});
        const outcome = await run_flat({...flat_opts('update', core_only), clone: clone_at('aaaaaaa')});

        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'current', version: '0.1.0'}]);
    });

    it('never guesses on --dry-run, which does not clone', async()=>{
        await run_flat({...flat_opts('install', core_only), clone: clone_at('aaaaaaa')});
        const outcome = await run_flat({
            ...flat_opts('update', core_only), dry_run: true,
            clone: async()=>{ throw new Error('a dry run must not clone'); },
        });
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'current', version: '0.1.0'}]);
    });
});

// Minor, folded in because it sits in the code already being edited: the
// copy-error abort path used `outcomes.length` as a proxy for "something
// landed", which is wrong whenever every outcome recorded before the abort
// was itself a failure — it must check the outcomes' actions, not their count.
describe('run_flat abort status', ()=>{
    it('reports failed, not partial, when every outcome recorded before an abort had already failed', async()=>{
        const target = path.join(home, '.cursor', 'skills');
        // reply-adapter collides with a user-authored directory...
        fs.mkdirSync(path.join(target, 'reply-adapter-skill'), {recursive: true});
        fs.writeFileSync(
            path.join(target, 'reply-adapter-skill', 'SKILL.md'),
            '---\nname: mine\ndescription: not the pack\n---\nkeep me\n',
        );
        // ...and agentic-runtime (independent of reply-adapter, so not
        // blocked by its failure) throws on its own copy.
        const copy_spy = vi.spyOn(fs, 'copyFileSync').mockImplementationOnce(()=>{
            throw new Error('simulated disk failure');
        });
        try {
            const outcome = await run_flat(flat_opts('install', adapter_and_runtime_only));
            expect(outcome.status).toBe('failed');
            expect(outcome.packs).toEqual([{
                name: 'reply-adapter', action: 'failed', detail: 'conflicts with an existing skill: reply-adapter-skill',
            }]);
        } finally {
            copy_spy.mockRestore();
        }
    });
});

// Minor, folded in for the same reason: owns_dir/protected_files compared
// paths case-sensitively while is_within does not, so a differently-cased
// path — routine on Windows, which CI runs — was recognised by one and not
// the other. Both must agree.
describe('run_flat case-insensitive path comparisons', ()=>{
    it('recognises a differently-cased journaled path as already ours, not a foreign collision', async()=>{
        const target = path.join(home, '.cursor', 'skills');
        // Same physical file as fake_clone will produce, but recorded with
        // different case — as a differently-cased-but-equivalent path from a
        // prior run might be, on a case-insensitive filesystem.
        const differently_cased = path.join(target, 'AI-SDR-CORE-SKILL', 'SKILL.MD');
        record_pack('cursor', 'user', 'ai-sdr-core', {
            version: '0.1.0', ref: 'main', commit: 'deadbee', scope: 'user',
            files: [differently_cased], complete: true, installed_at: '2026-07-30T00:00:00.000Z',
        }, env());
        fs.mkdirSync(path.join(target, 'ai-sdr-core-skill'), {recursive: true});
        fs.writeFileSync(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'), 'old content');

        // `update`, not `install`: the entry is already complete at the
        // target version, so `install` would skip the copy entirely without
        // ever reaching the collision/ownership check this test exercises.
        const outcome = await run_flat(flat_opts('update', core_only));

        // Re-copied from a fresh clone, but at the same version — so `current`
        // (I3), and the file is proof the copy itself was not skipped.
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'current', version: '0.1.0'}]);
        expect(fs.existsSync(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'))).toBe(true);
        expect(fs.readFileSync(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'), 'utf8'))
            .not.toBe('old content');
    });
});
