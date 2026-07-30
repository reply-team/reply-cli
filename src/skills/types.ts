// Contracts shared by the skills installer. Types only — no logic, so any
// module can import this without pulling in behaviour.

type Pack = {
    name: string;
    display_name: string;
    version: string;
    description: string;
    dependencies: string[];
};

type Pack_registry = {
    marketplace: string;
    packs: Pack[];
};

type Scope = 'user' | 'project';

type Host_kind = 'native-plugin' | 'flat-skills-dir';

// Argument vectors for a host's own plugin CLI, minus the resolved binary.
// Kept as data so a new host is a registry entry, not a branch in the adapter.
type Host_cli = {
    marketplace_add: (repo: string)=>string[];
    list_json: ()=>string[];
    install: (pack: string, marketplace: string, scope: Scope)=>string[];
    update: (pack: string, marketplace: string)=>string[];
    remove: (pack: string, marketplace: string)=>string[];
    // Scope of the update operation: 'pack' for per-pack updates (Claude Code),
    // 'marketplace' for whole-marketplace updates (Codex).
    update_scope: 'pack' | 'marketplace';
};

type Host_def = {
    id: string;
    label: string;
    kind: Host_kind;
    // Paths relative to the home directory; the first that exists proves presence.
    config_dirs: string[];
    // Command names to look for on PATH (native hosts).
    binaries: string[];
    // Absolute-path candidates for hosts that ship off PATH, with {home} expanded.
    binary_paths: string[];
    cli?: Host_cli;
    // Skills directory relative to the home directory (flat hosts).
    user_skills_dir?: string;
    // Skills directory relative to the project root (flat hosts, and native
    // hosts whose plugin mechanism cannot express a project install).
    project_skills_dir?: string;
    verified: boolean;
};

type Pack_action = 'installed' | 'upgraded' | 'current' | 'removed' | 'failed';

type Pack_outcome = {
    name: string;
    action: Pack_action;
    version?: string;
    from?: string;
    detail?: string;
};

type Host_status = 'ok' | 'partial' | 'failed' | 'skipped';

type Host_outcome = {
    host: string;
    label: string;
    kind: Host_kind;
    scope?: Scope;
    status: Host_status;
    packs?: Pack_outcome[];
    reason?: string;
    detail?: string;
    hint?: string;
};

type Operation = 'install' | 'list' | 'update' | 'remove';

type Report = {
    action: Operation;
    source: {repo: string; ref: string; commit?: string};
    requested: string[];
    resolved: string[];
    hosts: Host_outcome[];
    summary: {installed: number; skipped: number; failed: number};
};

type Run_result = {code: number; stdout: string; stderr: string};

// Injected process runner: the single seam that lets every adapter test run
// without an assistant installed.
type Runner = (bin: string, args: string[])=>Promise<Run_result>;

export type {
    Pack, Pack_registry, Scope, Host_kind, Host_cli, Host_def,
    Pack_action, Pack_outcome, Host_status, Host_outcome,
    Operation, Report, Run_result, Runner,
};
