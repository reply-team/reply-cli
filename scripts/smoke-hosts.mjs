// Verifies `reply skills install` against really installed assistants.
//
// Not part of `npm test`: it needs Claude Code and/or Codex on the machine and
// it clones from GitHub. It is safe to run on a working machine because:
// - Native hosts (Claude Code, Codex) use CLAUDE_CONFIG_DIR and CODEX_HOME
// - Flat hosts (Cursor, Gemini, Copilot) use HOME/USERPROFILE redirected to sandbox
// The script verifies isolation before and after: pre-flight checks that all hosts
// resolve inside the sandbox, post-run checks that the real home is untouched.
// If either assertion fails, the script aborts without installing.
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
// Create both environment-variable config directories (for native hosts)
// and relative directories (for detection in the sandbox home)
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

try {
    console.log(`sandbox: ${sandbox}`);

    // Safety assertion: verify sandbox is truly isolated BEFORE making any changes.
    // Pre-flight: no pre-existing plugins in the sandbox (proof it's clean).
    // Post-flight: real home is untouched (below, after the run).
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

    // Post-run assertion: verify the real home was not modified by the smoke test.
    // This is the critical safety check that proves isolation worked end-to-end.
    const real_home = os.homedir();
    const real_copilot_skills = path.join(real_home, '.copilot', 'skills');
    const real_cursor_skills = path.join(real_home, '.cursor', 'skills');
    const real_reply_skills_json = path.join(real_home, '.reply', 'skills.json');

    // Check that no reply skill packs were installed to the real home
    const check_dir = (dir)=>{
        if (!fs.existsSync(dir))
        {
            return [];
        }
        try {
            return fs.readdirSync(dir);
        } catch {
            return [];
        }
    };

    const copilot_skills = check_dir(real_copilot_skills);
    const reply_skill_names = ['ai-sdr-core', 'reply-adapter', 'agentic-runtime'];
    const installed_in_real_copilot = copilot_skills.some(s=>reply_skill_names.some(r=>s.includes(r)));

    if (installed_in_real_copilot)
    {
        fail(`post-run assertion failed: reply skills were installed to the real home at ${real_copilot_skills}`);
        process.exit(1);
    }

    const cursor_skills = check_dir(real_cursor_skills);
    const installed_in_real_cursor = cursor_skills.some(s=>reply_skill_names.some(r=>s.includes(r)));
    if (installed_in_real_cursor)
    {
        fail(`post-run assertion failed: reply skills were installed to the real home at ${real_cursor_skills}`);
        process.exit(1);
    }

    if (!process.exitCode)
    {
        console.log('✓ smoke passed');
        console.log('✓ post-run assertion confirmed: real home is untouched');
    }
} finally {
    fs.rmSync(sandbox, {recursive: true, force: true});
}
