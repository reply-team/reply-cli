// Verifies `reply skills install` against really installed assistants.
//
// Not part of `npm test`: it needs Claude Code and/or Codex on the machine and
// it clones from GitHub. It is safe to run on a working machine because:
// - Native hosts (Claude Code, Codex) use CLAUDE_CONFIG_DIR and CODEX_HOME
// - Flat hosts (Cursor, Gemini, Copilot) use HOME/USERPROFILE redirected to sandbox
//
// The script uses snapshot-based comparison to prove the real home is untouched:
// - Before any CLI invocation, snapshot all real flat-host skills directories
// - After the smoke test, verify the snapshots are identical
// - Any filesystem change (new dir, removed entry) fails the script non-zero
//
// This design catches isolation failures: if HOME/USERPROFILE redirection fails,
// the CLI would write to the real home, changing its snapshot.
//
// Usage: npm run build && npm run smoke:hosts

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-smoke-'));
const env = {
    ...process.env,
    HOME: sandbox,
    USERPROFILE: sandbox,
    CLAUDE_CONFIG_DIR: path.join(sandbox, 'claude'),
    CODEX_HOME: path.join(sandbox, 'codex'),
    REPLY_CONFIG_DIR: path.join(sandbox, 'reply'),
};
// Create marker directories in sandbox so detection works (otherwise would find nothing)
const config_dirs = [
    env.CLAUDE_CONFIG_DIR,
    env.CODEX_HOME,
    env.REPLY_CONFIG_DIR,
    path.join(sandbox, '.claude'),
    path.join(sandbox, '.codex'),
    path.join(sandbox, '.copilot'),
    path.join(sandbox, '.cursor'),
    path.join(sandbox, '.gemini'),
    path.join(sandbox, '.codeium'),
];
for (const dir of config_dirs)
{
    fs.mkdirSync(dir, {recursive: true});
}

const cli = (...args)=>execFileSync(process.execPath, ['dist/index.js', ...args], {env, encoding: 'utf8'});

const fail = (message)=>{
    console.error(`✗ ${message}`);
    process.exitCode = 1;
};

// Resolve the real reply config directory: same logic as the CLI.
// On Windows: %APPDATA%/reply; on Unix: $XDG_CONFIG_HOME/reply or ~/.config/reply
const real_reply_config_dir = ()=>{
    if (process.platform === 'win32')
    {
        const appdata = process.env.APPDATA;
        if (appdata)
        {
            return path.join(appdata, 'reply');
        }
    }
    const xdg = process.env.XDG_CONFIG_HOME;
    if (xdg)
    {
        return path.join(xdg, 'reply');
    }
    return path.join(os.homedir(), '.config', 'reply');
};

// Take a snapshot of all real flat-host directories before making any changes.
// We snapshot the filesystem state (directory listing sorted) or "does not exist" for each path.
const snapshot_state = ()=>{
    const real_home = os.homedir();
    const paths_to_check = [
        path.join(real_home, '.copilot', 'skills'),
        path.join(real_home, '.cursor', 'skills'),
        path.join(real_home, '.gemini', 'skills'),
        path.join(real_home, '.codeium', 'windsurf', 'skills'),
        path.join(real_home, '.agents', 'skills'),
        real_reply_config_dir(),
    ];

    const snapshot = {};
    for (const dir of paths_to_check)
    {
        if (!fs.existsSync(dir))
        {
            snapshot[dir] = 'DOES_NOT_EXIST';
            continue;
        }
        try {
            const contents = fs.readdirSync(dir).sort();
            snapshot[dir] = contents;
        } catch (e) {
            snapshot[dir] = `ERROR: ${e.message}`;
        }
    }
    return snapshot;
};

// Compare two snapshots and report any differences.
const compare_snapshots = (before, after)=>{
    const diffs = [];
    const all_paths = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const p of all_paths)
    {
        const before_state = before[p];
        const after_state = after[p];

        if (JSON.stringify(before_state) !== JSON.stringify(after_state))
        {
            if (before_state === 'DOES_NOT_EXIST' && after_state !== 'DOES_NOT_EXIST')
            {
                diffs.push(`CREATED: ${p}`);
            }
            else if (before_state !== 'DOES_NOT_EXIST' && after_state === 'DOES_NOT_EXIST')
            {
                diffs.push(`DELETED: ${p}`);
            }
            else if (typeof before_state === 'object' && typeof after_state === 'object')
            {
                const before_set = new Set(before_state);
                const after_set = new Set(after_state);
                const added = [...after_set].filter(x=>!before_set.has(x));
                const removed = [...before_set].filter(x=>!after_set.has(x));
                if (added.length > 0)
                {
                    diffs.push(`ADDED to ${p}: ${added.join(', ')}`);
                }
                if (removed.length > 0)
                {
                    diffs.push(`REMOVED from ${p}: ${removed.join(', ')}`);
                }
            }
            else
            {
                diffs.push(`CHANGED ${p}: ${JSON.stringify(before_state)} → ${JSON.stringify(after_state)}`);
            }
        }
    }
    return diffs;
};

try {
    console.log(`sandbox: ${sandbox}`);

    // Take snapshot of real environment BEFORE any CLI invocation.
    // This catches even read-only operations that unexpectedly write.
    const before_snapshot = snapshot_state();

    // Safety assertion: verify sandbox is truly isolated BEFORE making any changes.
    const sandbox_check = JSON.parse(cli('skills', 'list', '--json'));
    const installed_in_sandbox = sandbox_check.hosts.flatMap(h=>(h.packs ?? []).length);
    const has_plugins = installed_in_sandbox.some(count=>count > 0);
    if (has_plugins)
    {
        fail('sandbox isolation check failed: plugins already installed. Aborting without making changes.');
        process.exit(1);
    }
    console.log('✓ pre-flight assertion: sandbox is clean');

    const installed = JSON.parse(cli('skills', 'install', '--json'));
    console.log(`hosts: ${installed.hosts.map(h=>`${h.host}=${h.status}`).join(' ') || '(none detected)'}`);
    if (!installed.hosts.length)
    {
        console.log('⚠ no assistant detected — nothing to verify on this machine');
        process.exit(0);
    }
    if (!installed.hosts.some(h=>h.status === 'ok'))
    {
        fail('no host reported ok');
    }
    if (installed.resolved.join(',') !== 'ai-sdr-core,reply-adapter,agentic-runtime')
    {
        fail(`unexpected resolve order: ${installed.resolved.join(',')}`);
    }

    // Idempotency: the second run must change nothing.
    const again = JSON.parse(cli('skills', 'install', '--json'));
    const actions = again.hosts.flatMap(h=>(h.packs ?? []).map(p=>p.action));
    if (actions.some(a=>a !== 'current'))
    {
        fail(`re-install was not idempotent: ${actions.join(',')}`);
    }

    // Selective install pulls the core.
    cli('skills', 'remove', '--json');
    const selective = JSON.parse(cli('skills', 'install', 'adapter', '--json'));
    if (selective.resolved.join(',') !== 'ai-sdr-core,reply-adapter')
    {
        fail(`selective install did not pull the core: ${selective.resolved.join(',')}`);
    }

    // Removing the core alone must be refused.
    try {
        cli('skills', 'remove', 'core', '--json');
        fail('removing the core while the adapter is installed was allowed');
    } catch {
        console.log('✓ removing a needed dependency is refused');
    }

    // Post-run assertion: snapshot the real environment again and verify it is unchanged.
    // This is the critical safety check. Any difference means isolation failed.
    const after_snapshot = snapshot_state();
    const diffs = compare_snapshots(before_snapshot, after_snapshot);

    if (diffs.length > 0)
    {
        fail(`post-run assertion failed: real home was modified:\n${diffs.map(d=>`  ${d}`).join('\n')}`);
        process.exit(1);
    }
    console.log('✓ post-run assertion: real home is untouched');

    if (!process.exitCode)
    {
        console.log('✓ smoke passed');
    }
} finally {
    fs.rmSync(sandbox, {recursive: true, force: true});
}
