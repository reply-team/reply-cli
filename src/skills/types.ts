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
    // Whether the user must start a new session before the assistant sees newly
    // installed skills. Required, so a new host decides it rather than omits it.
    needs_new_session: boolean;
    verified: boolean;
};

type Pack_action = 'installed' | 'upgraded' | 'current' | 'removed' | 'failed';

type Pack_outcome = {
    name: string;
    action: Pack_action;
    version?: string;
    from?: string;
    detail?: string;
    // Set by the flat adapter on a `current` pack whose files this run
    // rewrote anyway: a newer commit on the same ref, or a repair of an
    // install that never finished. The version did not move — so the action
    // is `current`, never `upgraded` — but the bytes on disk did, and that is
    // what decides whether the user has to start a new assistant session.
    // Never set by a native host, which cannot see below its own plugin CLI,
    // and never by a dry run, which does not clone and so cannot know.
    refreshed?: boolean;
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
    // The commit a flat host actually cloned in this run — set only when this
    // run cloned the skills repository (never on a native host, and never
    // when nothing was pending, a dry run skipped the clone, or the clone
    // itself failed). This is what lets the orchestrator report the source
    // commit without ever attributing a stale or foreign one to a run that
    // did not produce it.
    commit?: string;
    // Mirrors Host_def.verified: false means this assistant's paths come from
    // its documentation and have not been confirmed by a verification run of
    // our own. Stamped by the orchestrator for every host it
    // reports, so no adapter can forget it and a --json consumer can tell a
    // confirmed success from an unconfirmed one.
    verified?: boolean;
    // Mirrors Host_def.needs_new_session, stamped by the orchestrator like
    // `verified`: the reporter needs to know which hosts that line applies to.
    needs_new_session?: boolean;
};

type Operation = 'install' | 'list' | 'update' | 'remove';

// Packs the journal records for a host no longer in the registry: a retirement
// leaves our files on disk with nothing able to reach them, since iteration
// covers registry hosts and a retired `--agent` id is a usage error.
type Orphaned_packs = {
    host: string;
    scope: Scope;
    packs: string[];
    files: number;
    // One recorded path, so the message points at a real directory.
    sample?: string;
};

type Report = {
    action: Operation;
    source: {repo: string; ref: string; commit?: string};
    requested: string[];
    resolved: string[];
    hosts: Host_outcome[];
    summary: {installed: number; skipped: number; failed: number};
    orphans?: Orphaned_packs[];
};

type Run_result = {code: number; stdout: string; stderr: string};

// Injected process runner: the single seam that lets every adapter test run
// without an assistant installed.
type Runner = (bin: string, args: string[])=>Promise<Run_result>;

export type {
    Pack, Pack_registry, Scope, Host_kind, Host_cli, Host_def, Orphaned_packs,
    Pack_action, Pack_outcome, Host_status, Host_outcome,
    Operation, Report, Run_result, Runner,
};
