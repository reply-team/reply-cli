// Verifies `reply skills install` end to end, against real and simulated assistants.
//
// Not part of `npm test`: it clones from GitHub, and exercising a native host for
// real needs that assistant installed on the machine. It is safe to run on a
// working machine because:
// - Native hosts (Claude Code, Codex) are pointed at throwaway config directories
//   via CLAUDE_CONFIG_DIR and CODEX_HOME. They are only *genuinely* exercised
//   (real binary resolved from the real PATH) when really installed — otherwise
//   they still appear in the report with status 'skipped'.
// - Flat-directory hosts (Cursor, Gemini CLI, GitHub Copilot) are always
//   *simulated* inside the sandbox below, regardless of what is really on this
//   machine. That is deliberate: it is the only way the flat-directory install
//   path gets exercised at all, on any machine. Do not read a flat host's 'ok'
//   status here as evidence that assistant is really installed.
// - Both rely on HOME/USERPROFILE being redirected to the sandbox. That is not
//   assumed: before anything mutating runs, a child process given the exact same
//   env is asked what os.homedir() resolves to, and the run aborts without
//   making changes if it isn't inside the sandbox (see the pre-flight checks).
//
// The script uses snapshot-based comparison to prove the real home is untouched:
// - Before any CLI invocation — before even that isolation proof — snapshot each
//   flat host's real root config directory and skills leaf directory, plus the
//   real reply config directory.
// - After the smoke test, verify the snapshots are identical.
// - Any filesystem change (new dir, removed entry) fails the script non-zero,
//   and this comparison always runs, even if an earlier assertion already failed.
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
//
// Each host's root config directory is watched alongside its skills leaf
// directory. The root is what `detect_hosts` keys presence on (see
// src/skills/detect.ts) — an empty root with no `skills` subdirectory inside
// it is still a host that the next `reply skills install` will detect and
// write into, so a leaf-only snapshot misses exactly that case.
const snapshot_state = ()=>{
    const real_home = os.homedir();
    const paths_to_check = [
        path.join(real_home, '.copilot'),
        path.join(real_home, '.copilot', 'skills'),
        path.join(real_home, '.cursor'),
        path.join(real_home, '.cursor', 'skills'),
        path.join(real_home, '.gemini'),
        path.join(real_home, '.gemini', 'skills'),
        path.join(real_home, '.codeium'),
        path.join(real_home, '.codeium', 'windsurf', 'skills'),
        path.join(real_home, '.agents'),
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

    // Everything that can fail (an assertion or an unexpected thrown error) is
    // contained here so that, no matter what goes wrong, execution always
    // reaches the post-run comparison below — never via process.exit(), which
    // would skip both that comparison and the sandbox cleanup in `finally`.
    //
    // `can_proceed` gates each stage instead of nested if/else: a failure at
    // any stage stops the remaining mutating stages (matching the original
    // "abort without making changes" intent) without ever exiting early, so
    // control still always reaches the post-run comparison after this block.
    try {
        // Pre-flight assertion #1: prove HOME/USERPROFILE redirection is
        // actually in effect, before anything mutating runs. The empty-journal
        // check below does NOT establish this — reads are gated by
        // REPLY_CONFIG_DIR, which is set unconditionally regardless of whether
        // HOME/USERPROFILE redirection works, so it would report "clean" even
        // with a fully broken redirect. This checks the property every child
        // process actually depends on directly: spawn a child with the exact
        // same env this script uses for the CLI, and ask it what os.homedir()
        // resolves to.
        const homedir_probe = execFileSync(
            process.execPath,
            ['-e', 'process.stdout.write(require("os").homedir())'],
            {env, encoding: 'utf8'},
        );
        const resolved_probe = path.resolve(homedir_probe);
        const resolved_sandbox = path.resolve(sandbox);
        let can_proceed = resolved_probe === resolved_sandbox;
        if (!can_proceed)
        {
            fail(`isolation proof failed: a child process given this script's env resolved os.homedir() to '${resolved_probe}', not the sandbox '${resolved_sandbox}'. Aborting without making changes.`);
        }
        else
        {
            console.log(`✓ pre-flight assertion: os.homedir() in a child process resolves inside the sandbox (${resolved_probe})`);
        }

        // Pre-flight assertion #2: the sandboxed journal reports no packs yet.
        // This is a sanity check for stale state left by a previous interrupted
        // run — not an isolation proof (see above) — since it only reads
        // whatever REPLY_CONFIG_DIR points at.
        if (can_proceed)
        {
            const sandbox_check = JSON.parse(cli('skills', 'list', '--json'));
            const installed_in_sandbox = sandbox_check.hosts.flatMap(h=>(h.packs ?? []).length);
            const has_plugins = installed_in_sandbox.some(count=>count > 0);
            if (has_plugins)
            {
                fail('sandbox isolation check failed: plugins already installed. Aborting without making changes.');
                can_proceed = false;
            }
            else
            {
                console.log('✓ pre-flight assertion: sandbox journal is clean');
            }
        }

        if (can_proceed)
        {
            const installed = JSON.parse(cli('skills', 'install', '--json'));
            console.log(`hosts: ${installed.hosts.map(h=>`${h.host}=${h.status}`).join(' ') || '(none detected)'}`);

            // Flat hosts are always simulated (see header), so `installed.hosts`
            // is never actually empty on any machine with git on PATH — the
            // brief's original "no assistant at all" exit is dead code below.
            // What is real and worth reporting is whether a *native* host (the
            // only kind that is only exercised when genuinely installed) was
            // actually present: status 'skipped' means its config directory
            // marker existed but the real binary could not be resolved from
            // the real PATH, i.e. it is not really installed here.
            const native_ids = new Set(['claude-code', 'codex']);
            const native_present = installed.hosts.some(h=>native_ids.has(h.host) && h.status !== 'skipped');
            console.log(native_present
                ? '✓ at least one native assistant (Claude Code/Codex) is really installed and was exercised for real'
                : 'ℹ no native assistant (Claude Code, Codex) is really installed on this machine — only the always-simulated flat hosts were exercised');

            if (!installed.hosts.length)
            {
                console.log('⚠ no hosts detected at all — nothing to verify on this machine');
                can_proceed = false;
            }

            if (can_proceed)
            {
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
            }
        }
    } catch (e) {
        fail(`smoke run failed unexpectedly: ${e.message}`);
    }

    // Post-run assertion: snapshot the real environment again and verify it is unchanged.
    // This is the critical safety check. Any difference means isolation failed.
    // It runs unconditionally — even if an assertion above already failed — so a
    // failing smoke still tells the user whether their machine was touched.
    const after_snapshot = snapshot_state();
    const diffs = compare_snapshots(before_snapshot, after_snapshot);

    if (diffs.length > 0)
    {
        fail(`post-run assertion failed: real home was modified:\n${diffs.map(d=>`  ${d}`).join('\n')}`);
    }
    else
    {
        console.log('✓ post-run assertion: real home is untouched');
    }

    if (!process.exitCode)
    {
        console.log('✓ smoke passed');
    }
} finally {
    fs.rmSync(sandbox, {recursive: true, force: true});
}
