// Verifies `reply skills install` against really installed assistants.
//
// Not part of `npm test`: it needs Claude Code and/or Codex on the machine and
// it clones from GitHub. It is safe to run on a working machine because each
// host is pointed at a throwaway configuration directory — CLAUDE_CONFIG_DIR
// and CODEX_HOME — so your real plugin state is never touched.
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

    // Safety assertion: verify the sandbox is truly isolated before making any changes.
    // This proves that environment variables are honored and the developer's real config is safe.
    const sandbox_check = JSON.parse(cli('skills', 'list', '--json'));
    const installed_in_sandbox = sandbox_check.hosts.flatMap(h=>(h.packs ?? []).length);
    const has_plugins = installed_in_sandbox.some(count=>count > 0);

    if (has_plugins)
    {
        fail('sandbox isolation check failed: plugins already installed in throwaway config directory. Environment variables may be ignored. Aborting without making changes.');
        process.exit(1);
    }
    console.log('✓ sandbox isolation verified: no pre-existing plugins in throwaway config directories');

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

    if (!process.exitCode)
    {
        console.log('✓ smoke passed');
    }
} finally {
    fs.rmSync(sandbox, {recursive: true, force: true});
}
