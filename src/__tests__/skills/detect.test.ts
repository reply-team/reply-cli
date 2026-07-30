import {describe, it, expect} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {detect_hosts, select_hosts, default_detect_deps, type Detect_deps} from '../../skills/detect';
import {UsageError} from '../../utils/errors';

// A fake home directory: only the listed relative paths exist.
const deps_with = (present: string[], on_path: string[] = [], absolute: string[] = []): Detect_deps=>{
    const home = path.join(os.tmpdir(), 'fake-home');
    const exists_set = new Set(present.map(p=>path.join(home, p)).concat(absolute));
    return {
        home,
        platform: 'linux',
        exists: (p: string)=>exists_set.has(p),
        find_on_path: (name: string)=>on_path.includes(name) ? `/usr/bin/${name}` : undefined,
        glob_first: (pattern: string)=>absolute.find(a=>a.startsWith(pattern.split('*')[0])),
    };
};

describe('detect_hosts', ()=>{
    it('finds nothing on an empty machine', ()=>{
        expect(detect_hosts(deps_with([]))).toEqual([]);
    });

    it('detects a native host whose config dir and binary are both present', ()=>{
        const found = detect_hosts(deps_with(['.claude'], ['claude']));
        expect(found.map(h=>h.def.id)).toEqual(['claude-code']);
        expect(found[0].bin).toBe('/usr/bin/claude');
        const home = path.join(os.tmpdir(), 'fake-home');
        expect(found[0].config_dir).toBe(path.join(home, '.claude'));
    });

    it('detects a native host with no resolvable binary and leaves bin unset', ()=>{
        const found = detect_hosts(deps_with(['.codex']));
        expect(found.map(h=>h.def.id)).toEqual(['codex']);
        expect(found[0].bin).toBeUndefined();
    });

    it('resolves a binary that is off PATH via binary_paths', ()=>{
        const abs = path.join(os.tmpdir(), 'fake-home', 'AppData', 'Local', 'OpenAI', 'Codex', 'bin', 'abc', 'codex.exe');
        const found = detect_hosts(deps_with(['.codex'], [], [abs]));
        expect(found[0].bin).toBe(abs);
    });

    it('detects a flat host from its config dir alone', ()=>{
        expect(detect_hosts(deps_with(['.cursor'])).map(h=>h.def.id)).toEqual(['cursor']);
    });

    it('detects several hosts in registry order', ()=>{
        const found = detect_hosts(deps_with(['.claude', '.codex', '.cursor'], ['claude']));
        expect(found.map(h=>h.def.id)).toEqual(['claude-code', 'codex', 'cursor']);
    });

    it('detects Windsurf through its nested config dir', ()=>{
        expect(detect_hosts(deps_with([path.join('.codeium', 'windsurf')])).map(h=>h.def.id)).toEqual(['windsurf']);
    });
});

describe('select_hosts', ()=>{
    it('returns everything detected when no ids are given', ()=>{
        const {selected, missing} = select_hosts(undefined, deps_with(['.claude'], ['claude']));
        expect(selected.map(h=>h.def.id)).toEqual(['claude-code']);
        expect(missing).toEqual([]);
    });

    it('narrows to the requested ids', ()=>{
        const {selected} = select_hosts(['codex'], deps_with(['.claude', '.codex'], ['claude', 'codex']));
        expect(selected.map(h=>h.def.id)).toEqual(['codex']);
    });

    it('reports a requested host that is not present as missing', ()=>{
        const {selected, missing} = select_hosts(['cursor'], deps_with(['.claude'], ['claude']));
        expect(selected).toEqual([]);
        expect(missing.map(h=>h.id)).toEqual(['cursor']);
    });

    it('rejects an unknown id', ()=>{
        expect(()=>select_hosts(['nope'], deps_with([]))).toThrow(UsageError);
    });
});

describe('default_detect_deps', ()=>{
    it('probes the real filesystem and reports a directory that exists', ()=>{
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-detect-'));
        try {
            const deps = default_detect_deps();
            expect(deps.exists(dir)).toBe(true);
            expect(deps.exists(path.join(dir, 'nope'))).toBe(false);
            expect(deps.home.length).toBeGreaterThan(0);
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });

    it('glob_first expands a wildcard to resolve off-PATH binaries', ()=>{
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-glob-'));
        try {
            // Build: <root>/AppData/Local/OpenAI/Codex/bin/abc123hash/codex.exe
            const binDir = path.join(root, 'AppData', 'Local', 'OpenAI', 'Codex', 'bin', 'abc123hash');
            fs.mkdirSync(binDir, {recursive: true});
            const exePath = path.join(binDir, 'codex.exe');
            fs.writeFileSync(exePath, '');

            const deps = default_detect_deps();
            const pattern = path.join(root, 'AppData', 'Local', 'OpenAI', 'Codex', 'bin', '*', 'codex.exe');
            expect(deps.glob_first(pattern)).toBe(exePath);
        } finally {
            fs.rmSync(root, {recursive: true, force: true});
        }
    });

    it('glob_first returns undefined when no entry in the wildcard directory matches the tail', ()=>{
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-glob-'));
        try {
            // Build: <root>/bin/abc123hash/other.exe (no codex.exe)
            const binDir = path.join(root, 'bin', 'abc123hash');
            fs.mkdirSync(binDir, {recursive: true});
            fs.writeFileSync(path.join(binDir, 'other.exe'), '');

            const deps = default_detect_deps();
            const pattern = path.join(root, 'bin', '*', 'codex.exe');
            expect(deps.glob_first(pattern)).toBeUndefined();
        } finally {
            fs.rmSync(root, {recursive: true, force: true});
        }
    });

    it('glob_first treats a pattern with no wildcard as a plain existence check', ()=>{
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-glob-'));
        try {
            const exePath = path.join(root, 'codex.exe');
            fs.writeFileSync(exePath, '');

            const deps = default_detect_deps();
            expect(deps.glob_first(exePath)).toBe(exePath);
            expect(deps.glob_first(path.join(root, 'nope.exe'))).toBeUndefined();
        } finally {
            fs.rmSync(root, {recursive: true, force: true});
        }
    });
});
