import path from 'path';
import {UsageError} from '../utils/errors';
import type {Host_cli, Host_def} from './types';

// One entry per assistant. Adding a host is a data change plus a verification
// run — never a branch inside an adapter. `verified: false` means the paths come
// from documentation we have not confirmed by installing ourselves.
//
// {home} in binary_paths is expanded by detect.ts; a leading '~/' is not used
// so the strings stay platform-agnostic.

const claude_cli: Host_cli = {
    marketplace_add: (repo)=>['plugin', 'marketplace', 'add', repo],
    list_json: ()=>['plugin', 'list', '--json'],
    install: (pack, marketplace, scope)=>['plugin', 'install', `${pack}@${marketplace}`, '--scope', scope],
    update: (pack, marketplace)=>['plugin', 'update', `${pack}@${marketplace}`],
    remove: (pack, marketplace)=>['plugin', 'uninstall', `${pack}@${marketplace}`],
    update_scope: 'pack',
};

// Codex spells the same operations differently and takes --json on all of them.
const codex_cli: Host_cli = {
    marketplace_add: (repo)=>['plugin', 'marketplace', 'add', repo, '--json'],
    list_json: ()=>['plugin', 'list', '--json'],
    install: (pack, marketplace)=>['plugin', 'add', `${pack}@${marketplace}`, '--json'],
    update: (_pack, marketplace)=>['plugin', 'marketplace', 'upgrade', marketplace, '--json'],
    remove: (pack, marketplace)=>['plugin', 'remove', `${pack}@${marketplace}`, '--json'],
    update_scope: 'marketplace',
};

const HOSTS: Host_def[] = [
    {
        id: 'claude-code',
        label: 'Claude Code',
        kind: 'native-plugin',
        config_dirs: ['.claude'],
        binaries: ['claude'],
        binary_paths: [],
        cli: claude_cli,
        project_skills_dir: path.join('.claude', 'skills'),
        needs_new_session: true,
        verified: true,
    },
    {
        id: 'codex',
        label: 'Codex',
        kind: 'native-plugin',
        config_dirs: ['.codex'],
        binaries: ['codex'],
        // Windows ships Codex with the desktop app, off PATH; the hash segment
        // varies, so detect.ts globs one level.
        binary_paths: [path.join('{home}', 'AppData', 'Local', 'OpenAI', 'Codex', 'bin', '*', 'codex.exe')],
        cli: codex_cli,
        // Codex's plugin mechanism is user-scoped, so --project falls back to
        // copying into the repository's .agents/skills.
        project_skills_dir: path.join('.agents', 'skills'),
        needs_new_session: true,
        verified: true,
    },
    {
        id: 'antigravity',
        label: 'Antigravity',
        kind: 'flat-skills-dir',
        // .gemini/config is this host's global "customization root" and
        // .agents its workspace one; skills under either are found with no
        // manifest and no plugin, as its own bundled agy-customizations skill
        // documents. Not .gemini/skills one level up, which it does not read.
        //
        // Detection keys on .gemini/antigravity and deliberately NOT on .gemini,
        // which this app also creates: .gemini alone was Google's Gemini CLI's
        // config directory, so matching it detected that host on every machine
        // running this one, and a plain install then wrote a full set of skills
        // into a directory nothing reads. Do not "simplify" this to the root the
        // skills go into. The app writes .gemini/antigravity/installation_id on
        // first launch, before anything skills-related, so this is present on a
        // machine that has the host and has never run `reply skills install`.
        config_dirs: [path.join('.gemini', 'antigravity')],
        binaries: [],
        binary_paths: [],
        user_skills_dir: path.join('.gemini', 'config', 'skills'),
        // Its workspace customization root, found by walking up from the open
        // folder to the repository root. Not reported by the host's own
        // GetAllSkills, which only answers for user scope — a project install is
        // confirmed by what a session in that repository loads.
        project_skills_dir: path.join('.agents', 'skills'),
        // Alone among the hosts: it re-reads its skills every turn, so an
        // install lands in a conversation that is already open. Verified — a
        // session that began listing 46 skills picked ours up mid-conversation
        // with no restart.
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
        project_skills_dir: path.join('.agents', 'skills'),
        needs_new_session: true,
        verified: false,
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
