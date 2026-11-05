import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {canonical, copy_dir, run_flat, skills_target} from '../../skills/adapter-flat';
import {host_by_id} from '../../skills/hosts';
import {journal_entry, record_pack} from '../../skills/journal';
import type {Detected_host} from '../../skills/detect';
import type {Pack} from '../../skills/types';

// run_flat copies whatever packs it is given from a directory of packs, so
// these tests give it several: the journal an earlier version wrote holds up
// to three per host, and `list` and `remove` still act on all of them.
const pack = (name: string): Pack=>({name, version: '0.1.0'});
const all = [pack('ai-sdr-core'), pack('reply-adapter'), pack('agentic-runtime')];
const core_only = [pack('ai-sdr-core')];
const adapter_and_runtime_only = [pack('reply-adapter'), pack('agentic-runtime')];

let root: string;
let home: string;
let source_dir: string;
const env = ()=>({REPLY_CONFIG_DIR: path.join(root, 'config')});

const cursor = (): Detected_host=>
    ({def: host_by_id('cursor'), config_dir: path.join(home, '.cursor')});

// A second flat host that shares its project-scope directory with cursor
// (both resolve `.agents/skills`), used to exercise the multi-host sharing
// path (see 'run_flat shared project directories across hosts' below).
const copilot = (): Detected_host=>
    ({def: host_by_id('github-copilot'), config_dir: path.join(home, '.copilot')});

// Stands in for the package's `skills` directory: one directory per pack,
// one skill in each.
const make_source = (): void=>{
    for (const p of all)
    {
        const skill = path.join(source_dir, p.name, `${p.name}-skill`);
        fs.mkdirSync(skill, {recursive: true});
        fs.writeFileSync(
            path.join(skill, 'SKILL.md'),
            `---\nname: ${p.name}-skill\ndescription: d\n---\n`,
        );
    }
};

const flat_opts = (operation: 'install' | 'remove' | 'list' | 'update', packs = all)=>({
    operation, host: cursor(), packs, scope: 'user' as const,
    home, cwd: path.join(root, 'project'), env: env(), source: source_dir,
});

beforeEach(()=>{
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-flat-'));
    home = path.join(root, 'home');
    source_dir = path.join(root, 'source');
    make_source();
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

    it('sends Codex to .agents/skills in both scopes', ()=>{
        expect(skills_target(host_by_id('codex'), 'user', home, '/p')).toBe(path.join(home, '.agents', 'skills'));
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

    it('journals the version and the files it wrote, and no ref or commit', async()=>{
        await run_flat(flat_opts('install', core_only));
        const entry = journal_entry('cursor', 'user', 'ai-sdr-core', env());
        expect(entry?.version).toBe('0.1.0');
        expect(entry).not.toHaveProperty('commit');
        expect(entry).not.toHaveProperty('ref');
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

    it('fails the host, rather than rejecting, when the pack cannot be read', async()=>{
        const outcome = await run_flat({...flat_opts('install', core_only), source: path.join(root, 'nowhere')});
        expect(outcome.status).toBe('failed');
        expect(outcome.reason).toBe('copy-failed');
        expect(outcome.detail).toContain('nowhere');
        expect(outcome.hint).toBeDefined();
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

    it('lists what the journal says is installed', async()=>{
        await run_flat(flat_opts('install', core_only));
        const outcome = await run_flat(flat_opts('list'));
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
        // No reply-adapter directory in the source, so its readdirSync
        // throws mid-loop.
        fs.rmSync(path.join(source_dir, 'reply-adapter'), {recursive: true, force: true});
        const outcome = await run_flat(flat_opts('install', all));
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
            version: '0.1.0', scope: 'user',
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
            version: '0.1.0', scope: 'user',
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
        expect(outcome.hint).toBeUndefined();
    });
});

// A failed removal keeps its entry, and the packs around it are removed:
// nothing depends on anything any more, so one failure blocks nothing.
describe('run_flat remove', ()=>{
    it('keeps the entry of a pack it could not remove and removes the others', async()=>{
        await run_flat(flat_opts('install', all));
        const target = path.join(home, '.cursor', 'skills');

        // The first rmSync is ai-sdr-core's only file.
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
            ['ai-sdr-core', 'failed'],
            ['reply-adapter', 'removed'],
            ['agentic-runtime', 'removed'],
        ]);
        expect(outcome.status).toBe('partial');
        expect(fs.existsSync(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'))).toBe(true);
        expect(journal_entry('cursor', 'user', 'ai-sdr-core', env())?.version).toBe('0.1.0');
        expect(journal_entry('cursor', 'user', 'reply-adapter', env())).toBeUndefined();
    });

    it('removes everything when nothing fails', async()=>{
        await run_flat(flat_opts('install', all));
        const outcome = await run_flat(flat_opts('remove', all));
        expect(outcome.packs?.map(p=>[p.name, p.action])).toEqual([
            ['ai-sdr-core', 'removed'],
            ['reply-adapter', 'removed'],
            ['agentic-runtime', 'removed'],
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
        fs.mkdirSync(path.join(home, '.copilot'), {recursive: true});
        await run_flat({...flat_opts('install', core_only), scope: 'project'});
        await run_flat({...flat_opts('install', core_only), scope: 'project', host: copilot()});

        const shared = path.join(root, 'project', '.agents', 'skills', 'ai-sdr-core-skill', 'SKILL.md');
        expect(fs.existsSync(shared)).toBe(true);

        const outcome = await run_flat({...flat_opts('remove', core_only), scope: 'project'});
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'removed', version: '0.1.0'}]);
        expect(journal_entry('cursor', 'project', 'ai-sdr-core', env())).toBeUndefined();
        // github-copilot's install still claims the shared file, so it survives.
        expect(fs.existsSync(shared)).toBe(true);
        expect(journal_entry('github-copilot', 'project', 'ai-sdr-core', env())?.version).toBe('0.1.0');

        const list_outcome = await run_flat({
            ...flat_opts('list', core_only), scope: 'project', host: copilot(),
        });
        expect(list_outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'current', version: '0.1.0'}]);
    });
});

// The journal records what we wrote; it is not evidence the files are still
// there. A directory deleted by hand, moved by a host upgrade, or eaten by a
// sync tool leaves the entry untouched, and every command used to believe it:
// `install` reported `current` and copied nothing, exit 0, with `list` agreeing,
// so the one command a user reaches for to fix a broken install was the one that
// could never fix it.
describe('run_flat when the journal outlives the files', ()=>{
    it('reports the pack as needing repair, and repairs it, rather than calling it current', async()=>{
        await run_flat(flat_opts('install', core_only));
        const target = path.join(home, '.cursor', 'skills');
        fs.rmSync(target, {recursive: true, force: true});

        const listed = await run_flat(flat_opts('list', core_only));
        expect(listed.packs?.[0].action).toBe('failed');
        expect(listed.packs?.[0].detail).toContain('run `reply skills install` to repair');

        // And the command that hint names actually fixes it — `installed`, not
        // `current`: at an unchanged version the files were still missing.
        const outcome = await run_flat(flat_opts('install', core_only));
        expect(outcome.packs?.map(p=>p.action)).toEqual(['installed']);
        expect(fs.existsSync(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'))).toBe(true);
    });

    // The deadlock. A host's skills directory moving between releases leaves
    // entries pointing outside the new target root; `remove` refuses to delete
    // outside it, which is right, but must not keep an entry for files that are
    // not there — `install` reads that entry as `current`, and the only way out
    // was editing the journal by hand.
    it('forgets an entry whose recorded files are outside the target root and already gone', async()=>{
        const moved_away = path.join(root, 'old-location', 'ai-sdr-core-skill', 'SKILL.md');
        record_pack('cursor', 'user', 'ai-sdr-core', {
            version: '0.1.0', scope: 'user',
            files: [moved_away], complete: true, installed_at: '2026-07-30T00:00:00.000Z',
        }, env());

        const removed = await run_flat(flat_opts('remove', core_only));

        expect(removed.packs?.map(p=>p.action)).toEqual(['removed']);
        expect(journal_entry('cursor', 'user', 'ai-sdr-core', env())).toBeUndefined();
        // And the pack installs again with no hand-editing.
        const outcome = await run_flat(flat_opts('install', core_only));
        expect(outcome.packs?.map(p=>p.action)).toEqual(['installed']);
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
            version: '0.1.0', scope: 'user',
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
            // A newer version, so the update copies.
            const outcome = await run_flat(flat_opts('update', [{name: 'ai-sdr-core', version: '0.2.0'}]));
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
            version: '0.1.0', scope: 'user',
            files: [], complete: false, installed_at: '2026-07-30T00:00:00.000Z',
        }, env());

        const outcome = await run_flat({
            ...flat_opts('list', core_only),
        });

        expect(outcome.packs?.map(p=>p.action)).not.toContain('current');
        expect(outcome.status).not.toBe('ok');
    });
});

// The version names the bytes: the package carries one copy of the pack per
// version, so a copy already at the version is current and not re-copied.
describe('run_flat at an unchanged version', ()=>{
    it('re-copies nothing on update when the copy is complete and at the version', async()=>{
        await run_flat(flat_opts('install', core_only));
        const file = path.join(home, '.cursor', 'skills', 'ai-sdr-core-skill', 'SKILL.md');
        fs.writeFileSync(file, 'edited');
        const outcome = await run_flat(flat_opts('update', core_only));
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'current', version: '0.1.0'}]);
        expect(fs.readFileSync(file, 'utf8')).toBe('edited');
    });

    it('reports an upgrade on --dry-run and writes nothing', async()=>{
        record_pack('cursor', 'user', 'ai-sdr-core', {
            version: '0.0.9', scope: 'user', files: [], complete: true, installed_at: '2026-07-30T00:00:00.000Z',
        }, env());
        const outcome = await run_flat({...flat_opts('update', core_only), dry_run: true});
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'upgraded', version: '0.1.0', from: '0.0.9'}]);
        expect(fs.existsSync(path.join(home, '.cursor', 'skills', 'ai-sdr-core-skill'))).toBe(false);
    });

    it('counts from the version of the plugin it adopts, on update with no copy of its own', async()=>{
        const outcome = await run_flat({...flat_opts('update', core_only), adopt: {'ai-sdr-core': '0.0.5'}});
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'upgraded', version: '0.1.0', from: '0.0.5'}]);
        expect(fs.existsSync(path.join(home, '.cursor', 'skills', 'ai-sdr-core-skill', 'SKILL.md'))).toBe(true);
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

// owns_dir/protected_files once compared paths case-sensitively while
// is_within did not, so the two disagreed about a differently-cased path.
// They now share `path.relative`, whose case sensitivity deliberately follows
// the platform's filesystem: on Windows the two spellings are one file, on
// Linux they are two. Both readings are correct, so the expectation differs
// per platform rather than one of them being a bug — asserting a single
// answer here is what turned CI red on Linux while passing on Windows.
const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';

describe('run_flat differently-cased journaled paths', ()=>{
    // An earlier version's entry, so the run reaches the collision and
    // ownership check these tests exercise: a complete copy at the target
    // version would be current and skip the copy entirely.
    const seed_differently_cased_entry = (): string=>{
        const target = path.join(home, '.cursor', 'skills');
        const differently_cased = path.join(target, 'AI-SDR-CORE-SKILL', 'SKILL.MD');
        record_pack('cursor', 'user', 'ai-sdr-core', {
            version: '0.0.9', scope: 'user',
            files: [differently_cased], complete: true, installed_at: '2026-07-30T00:00:00.000Z',
        }, env());
        fs.mkdirSync(path.join(target, 'ai-sdr-core-skill'), {recursive: true});
        fs.writeFileSync(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'), 'old content');
        return target;
    };

    it.skipIf(!CASE_INSENSITIVE_FS)('treats it as already ours where the filesystem ignores case', async()=>{
        const target = seed_differently_cased_entry();

        const outcome = await run_flat(flat_opts('update', core_only));

        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'upgraded', version: '0.1.0', from: '0.0.9'}]);
        expect(fs.readFileSync(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'), 'utf8'))
            .not.toBe('old content');
    });

    it.skipIf(CASE_INSENSITIVE_FS)('treats it as a foreign file where case distinguishes paths', async()=>{
        const target = seed_differently_cased_entry();

        const outcome = await run_flat(flat_opts('update', core_only));

        // On a case-sensitive filesystem the journaled path names a different
        // file, so the one on disk is not ours and must not be overwritten.
        expect(outcome.packs).toEqual([{
            name: 'ai-sdr-core', action: 'failed', detail: 'conflicts with an existing skill: ai-sdr-core-skill',
        }]);
        expect(fs.readFileSync(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'), 'utf8'))
            .toBe('old content');
    });

    // The two above are each skipped on half the platforms, so on any single
    // runner neither covers the canonicalisation itself: replacing
    // `fs.realpathSync.native` with `path.resolve` keeps the whole suite green.
    // Injecting the canonicaliser — the seam detect.ts already uses for `exists`
    // — puts the filesystem's opinion under the test's control, so what gets
    // asserted is the logic: ownership recognised through a case difference,
    // everywhere, and a foreign file still refused.
    // Stands in for a case-insensitive filesystem by resolving each segment
    // against what is on disk, case-blind. Lower-casing the whole path instead
    // names a file that exists nowhere — `SKILL.MD` becomes `skill.md`, not the
    // `SKILL.md` that is there — which passed on macOS only because the raw
    // existence check answered first, and failed on Linux.
    const ignoring_case = (target_path: string): string=>{
        const [root, ...segments] = target_path.split(path.sep);
        let resolved = root || path.sep;
        for (const segment of segments.filter(Boolean))
        {
            const listed = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
                ? fs.readdirSync(resolved).find(entry=>entry.toLowerCase() === segment.toLowerCase())
                : undefined;
            resolved = path.join(resolved, listed ?? segment);
        }
        return resolved;
    };

    it('recognises our own file through a case difference on any platform', async()=>{
        const target = seed_differently_cased_entry();
        // The stub answers with the spelling on disk, so the assertion below is
        // about the adapter rather than about the runner's filesystem.
        expect(ignoring_case(path.join(target, 'AI-SDR-CORE-SKILL', 'SKILL.MD')))
            .toBe(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'));

        const outcome = await run_flat({...flat_opts('update', core_only), canonicalise: ignoring_case});

        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'upgraded', version: '0.1.0', from: '0.0.9'}]);
        expect(fs.readFileSync(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'), 'utf8'))
            .not.toBe('old content');
    });

    // Pins the branch only a case-sensitive runner reached, on every platform:
    // the recorded path does not exist as written anywhere, and the canonicaliser
    // is the only thing that maps it to the file that does. Without it, `install`
    // and `list` disagree with owns_dir about whether the pack is present, and a
    // re-copy reports `installed` on Linux and `current` on macOS for the same
    // inputs — which is exactly how CI caught this.
    it('counts a recorded file as present when only its canonical form exists', async()=>{
        const target = path.join(home, '.cursor', 'skills');
        const real = path.join(target, 'ai-sdr-core-skill', 'SKILL.md');
        fs.mkdirSync(path.dirname(real), {recursive: true});
        fs.writeFileSync(real, 'old content');
        const recorded = path.join(target, 'recorded-under-another-name', 'SKILL.md');
        record_pack('cursor', 'user', 'ai-sdr-core', {
            version: '0.1.0', scope: 'user',
            files: [recorded], complete: true, installed_at: '2026-07-30T00:00:00.000Z',
        }, env());

        const outcome = await run_flat({
            ...flat_opts('install', core_only),
            canonicalise: (target_path)=>target_path === recorded ? real : target_path,
        });

        // Complete, at the target version, and its file is there — so nothing to
        // do. Judging presence on the raw path alone would call this a repair.
        expect(outcome.packs).toEqual([{name: 'ai-sdr-core', action: 'current', version: '0.1.0'}]);
        expect(fs.readFileSync(real, 'utf8')).toBe('old content');
    });

    it('still refuses a file no journal entry claims, whatever the canonical form', async()=>{
        const target = path.join(home, '.cursor', 'skills');
        fs.mkdirSync(path.join(target, 'ai-sdr-core-skill'), {recursive: true});
        fs.writeFileSync(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'), 'someone else wrote this');

        const outcome = await run_flat({...flat_opts('install', core_only), canonicalise: ignoring_case});

        expect(outcome.packs).toEqual([{
            name: 'ai-sdr-core', action: 'failed', detail: 'conflicts with an existing skill: ai-sdr-core-skill',
        }]);
        expect(fs.readFileSync(path.join(target, 'ai-sdr-core-skill', 'SKILL.md'), 'utf8'))
            .toBe('someone else wrote this');
    });
});

// The injected-canonicaliser tests above cover how owns_dir uses canonicalisation,
// but not the default's own behaviour: swapping `fs.realpathSync.native` for
// `path.resolve` leaves them all green. Two cases separate the pair, because
// neither runs everywhere — a symlink where the filesystem is case-sensitive, a
// differently-cased path where it is not.
describe('canonical', ()=>{
    // Skipped on Windows, where fs.symlinkSync needs Developer Mode or an
    // elevated shell and otherwise throws EPERM — the case test below pins the
    // same default there, since Windows folds case.
    it.skipIf(process.platform === 'win32')('answers with the path the filesystem really uses, following a symlink', ()=>{
        const real = path.join(root, 'real-skills');
        fs.mkdirSync(real, {recursive: true});
        const link = path.join(root, 'linked-skills');
        fs.symlinkSync(real, link);

        expect(canonical(link)).toBe(fs.realpathSync.native(real));
        expect(canonical(link)).not.toBe(link);
    });

    // Keeps the default pinned where the symlink case cannot run — Windows
    // refuses symlinks to an unprivileged account, and folds case.
    it.skipIf(!CASE_INSENSITIVE_FS)('answers with the spelling on disk, not the one asked for', ()=>{
        const on_disk = path.join(root, 'Real-Skills');
        fs.mkdirSync(on_disk, {recursive: true});
        const asked_for = path.join(root, 'real-skills');

        expect(canonical(asked_for)).toBe(fs.realpathSync.native(on_disk));
        expect(canonical(asked_for)).not.toBe(path.resolve(asked_for));
    });

    it('falls back to a resolved path when the target does not exist', ()=>{
        const missing = path.join(root, 'nowhere', 'SKILL.md');
        expect(canonical(missing)).toBe(path.resolve(missing));
    });
});
