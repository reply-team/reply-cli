import fs from 'fs';
import os from 'os';
import path from 'path';
import {execFileSync} from 'child_process';
import {HOSTS, host_by_id} from './hosts';
import type {Host_def} from './types';

type Detected_host = {
    def: Host_def;
    // Resolved binary for a native host; undefined means "present but not
    // runnable", which the adapter turns into an actionable skip.
    bin?: string;
    config_dir: string;
};

type Detect_deps = {
    home: string;
    platform: NodeJS.Platform;
    exists: (p: string)=>boolean;
    find_on_path: (name: string)=>string | undefined;
    glob_first: (pattern: string)=>string | undefined;
};

// Expands one '*' segment by listing its parent — enough for Codex's
// hash-named bin directory, and no dependency on a glob library.
const glob_first_real = (pattern: string): string | undefined=>{
    const star = pattern.indexOf('*');
    if (star < 0)
    {
        return fs.existsSync(pattern) ? pattern : undefined;
    }
    const parent = pattern.slice(0, star).replace(/[\\/]+$/, '');
    const tail = pattern.slice(pattern.indexOf(path.sep, star) + 1);
    let entries: string[];
    try {
        entries = fs.readdirSync(parent);
    } catch {
        return undefined;
    }
    for (const entry of entries)
    {
        const candidate = path.join(parent, entry, tail);
        if (fs.existsSync(candidate))
        {
            return candidate;
        }
    }
    return undefined;
};

const find_on_path_real = (name: string): string | undefined=>{
    const probe = process.platform === 'win32' ? 'where' : 'which';
    try {
        const out = execFileSync(probe, [name], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
        const first = out.split(/\r?\n/).map(l=>l.trim()).filter(Boolean)[0];
        return first || undefined;
    } catch {
        return undefined;
    }
};

const default_detect_deps = (): Detect_deps=>({
    home: os.homedir(),
    platform: process.platform,
    exists: (p)=>fs.existsSync(p),
    find_on_path: find_on_path_real,
    glob_first: glob_first_real,
});

const resolve_bin = (def: Host_def, deps: Detect_deps): string | undefined=>{
    for (const name of def.binaries)
    {
        const found = deps.find_on_path(name);
        if (found)
        {
            return found;
        }
    }
    // PATH is not enough: Codex on Windows ships with the desktop app and is
    // absent from PATH on a machine that clearly has it.
    for (const pattern of def.binary_paths)
    {
        const found = deps.glob_first(pattern.replace('{home}', deps.home));
        if (found)
        {
            return found;
        }
    }
    return undefined;
};

// Presence is decided by the host's configuration directory. A native host
// whose binary cannot be resolved is still detected — that is a fixable
// situation the user needs to hear about, not an absence.
const detect_hosts = (deps: Detect_deps = default_detect_deps()): Detected_host[]=>{
    const found: Detected_host[] = [];
    for (const def of HOSTS)
    {
        const dir = def.config_dirs
            .map(rel=>path.join(deps.home, rel))
            .find(full=>deps.exists(full));
        if (!dir)
        {
            continue;
        }
        found.push({def, config_dir: dir, bin: resolve_bin(def, deps)});
    }
    return found;
};

// `--agent` overrides detection. Unknown ids are a usage error; known ids that
// are not present are returned separately so the report can say so.
const select_hosts = (
    ids: string[] | undefined,
    deps: Detect_deps = default_detect_deps(),
): {selected: Detected_host[]; missing: Host_def[]}=>{
    const detected = detect_hosts(deps);
    if (!ids || !ids.length)
    {
        return {selected: detected, missing: []};
    }
    const wanted = ids.map(host_by_id);
    const selected = detected.filter(d=>wanted.some(w=>w.id === d.def.id));
    const missing = wanted.filter(w=>!detected.some(d=>d.def.id === w.id));
    return {selected, missing};
};

export {default_detect_deps, detect_hosts, select_hosts};
export type {Detected_host, Detect_deps};
