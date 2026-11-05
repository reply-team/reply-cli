import path from 'path';
import {UsageError} from '../utils/errors';
import type {Host_def, Plugin_cli} from './types';

// One entry per assistant. Adding a host is a data change plus a verification
// run — never a branch inside an adapter. `verified: false` means the paths come
// from documentation we have not confirmed by installing ourselves.
//
// {home} in binary_paths is expanded by detect.ts; a leading '~/' is not used
// so the strings stay platform-agnostic.

// Claude Code and Codex keep a plugin CLI, which an earlier version of this
// CLI installed through; it is only asked to list and remove those plugins.
// Claude Code's uninstall acts on user scope unless told another one.
const claude_cli: Plugin_cli = {
    list_json: ()=>['plugin', 'list', '--json'],
    remove: (id, scope)=>scope === 'project'
        ? ['plugin', 'uninstall', id, '--scope', 'project']
        : ['plugin', 'uninstall', id],
};

// Codex spells the same operations differently and takes --json on all of them.
const codex_cli: Plugin_cli = {
    list_json: ()=>['plugin', 'list', '--json'],
    remove: (id)=>['plugin', 'remove', id, '--json'],
};

const HOSTS: Host_def[] = [
    {
        id: 'claude-code',
        label: 'Claude Code',
        kind: 'flat-skills-dir',
        config_dirs: ['.claude'],
        binaries: ['claude'],
        binary_paths: [],
        plugin_cli: claude_cli,
        // Its personal and project skills directories, per its skills page.
        user_skills_dir: path.join('.claude', 'skills'),
        project_skills_dir: path.join('.claude', 'skills'),
        needs_new_session: true,
        verified: true,
    },
    {
        id: 'codex',
        label: 'Codex',
        kind: 'flat-skills-dir',
        config_dirs: ['.codex'],
        binaries: ['codex'],
        // Windows ships Codex with the desktop app, off PATH; the hash segment
        // varies, so detect.ts globs one level.
        binary_paths: [path.join('{home}', 'AppData', 'Local', 'OpenAI', 'Codex', 'bin', '*', 'codex.exe')],
        plugin_cli: codex_cli,
        // Its user directory is $HOME/.agents/skills, and in a repository it
        // reads .agents/skills from the working directory up to the root.
        user_skills_dir: path.join('.agents', 'skills'),
        project_skills_dir: path.join('.agents', 'skills'),
        needs_new_session: true,
        verified: true,
    },
    {
        id: 'antigravity',
        label: 'Antigravity',
        kind: 'flat-skills-dir',
        // .gemini/config is this host's global "customization root" and .agents
        // its workspace one; skills under either need no manifest and no plugin.
        // Detection keys on .gemini/antigravity, NOT on .gemini — that belonged
        // to the retired Gemini CLI, so matching it detected that host wherever
        // this one ran. Written on first launch, so it is there before any
        // install. Do not point this at the directory the skills go into.
        config_dirs: [path.join('.gemini', 'antigravity')],
        binaries: [],
        binary_paths: [],
        user_skills_dir: path.join('.gemini', 'config', 'skills'),
        // Its workspace root, found by walking up to the repository root. The
        // host's own GetAllSkills answers for user scope only, so a project
        // install is confirmed by what a session in that repository loads.
        project_skills_dir: path.join('.agents', 'skills'),
        // Alone among the hosts: re-reads its skills every turn, so an install
        // lands in a conversation already open.
        needs_new_session: false,
        verified: true,
    },
    {
        id: 'cursor',
        label: 'Cursor',
        kind: 'flat-skills-dir',
        config_dirs: ['.cursor'],
        binaries: [],
        binary_paths: [],
        user_skills_dir: path.join('.cursor', 'skills'),
        project_skills_dir: path.join('.agents', 'skills'),
        needs_new_session: true,
        verified: true,
    },
    {
        id: 'github-copilot',
        label: 'GitHub Copilot',
        kind: 'flat-skills-dir',
        config_dirs: ['.copilot'],
        binaries: [],
        binary_paths: [],
        user_skills_dir: path.join('.copilot', 'skills'),
        // It also reads .github/skills and .claude/skills for project scope.
        project_skills_dir: path.join('.agents', 'skills'),
        // `/skills reload` picks them up too, without a restart.
        needs_new_session: true,
        verified: true,
    },
    {
        id: 'windsurf',
        // The product ships as Devin, and the label is what the report prints:
        // naming both is what lets someone running Devin recognise the host and
        // still find `windsurf` as the --agent value. The id stays untouched.
        label: 'Windsurf (Devin)',
        kind: 'flat-skills-dir',
        config_dirs: [path.join('.codeium', 'windsurf')],
        binaries: [],
        binary_paths: [],
        user_skills_dir: path.join('.codeium', 'windsurf', 'skills'),
        project_skills_dir: path.join('.windsurf', 'skills'),
        needs_new_session: true,
        verified: true,
    },
];

const host_ids = (): string[]=>HOSTS.map(h=>h.id);

const host_by_id = (id: string): Host_def=>{
    const found = HOSTS.find(h=>h.id === id);
    if (!found)
    {
        throw new UsageError(`Unknown assistant '${id}'.`, {
            code: 'usage.skills_agent',
            hint: `Known assistants: ${host_ids().join(', ')}`,
        });
    }
    return found;
};

export {HOSTS, host_ids, host_by_id};
