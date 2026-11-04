// Contracts shared by the skills installer. Types only — no logic, so any
// module can import this without pulling in behaviour.

type Pack = {
    name: string;
    // The CLI's own version for the pack it ships; empty for a retired pack,
    // whose version is whatever an earlier version recorded.
    version: string;
    // A pack this CLI no longer offers: `list` and `remove` still reach it.
    retired?: boolean;
};

type Scope = 'user' | 'project';

// Every host receives the pack as files in its skills directory.
type Host_kind = 'flat-skills-dir';

// Argument vectors for a host's own plugin CLI, minus the resolved binary,
// used only to find and remove plugins an earlier version of this CLI
// installed there. Kept as data so the spelling is a registry entry.
type Plugin_cli = {
    list_json: ()=>string[];
    remove: (id: string, scope: Scope)=>string[];
};

type Host_def = {
    id: string;
    label: string;
    kind: Host_kind;
    // Paths relative to the home directory; the first that exists proves presence.
    config_dirs: string[];
    // Command names to look for on PATH, for a host with a plugin CLI.
    binaries: string[];
    // Absolute-path candidates for hosts that ship off PATH, with {home} expanded.
    binary_paths: string[];
    plugin_cli?: Plugin_cli;
    // Skills directory relative to the home directory.
    user_skills_dir: string;
    // Skills directory relative to the project root.
    project_skills_dir: string;
    // Whether the user must start a new session before the assistant sees newly
    // installed skills. Required, so a new host decides it rather than omits it.
    needs_new_session: boolean;
    verified: boolean;
};

type Pack_action = 'installed' | 'upgraded' | 'current' | 'removed' | 'failed';

type Pack_outcome = {
    // The pack's name, or a plugin's `<pack>@<marketplace>` id for a plugin
    // an earlier version installed through the host's own CLI.
    name: string;
    action: Pack_action;
    version?: string;
    from?: string;
    detail?: string;
    // Set on a `current` pack whose files this run rewrote anyway: the repair
    // of an install that never finished. The version did not move — so the
    // action is `current`, never `upgraded` — but the bytes on disk did, and
    // that is what decides whether the user has to start a new assistant
    // session. Never set by a dry run.
    refreshed?: boolean;
    // A pack this CLI no longer offers, found by `list` or `remove`.
    retired?: boolean;
};

// The reply-adapter plugin an earlier version installed through the host's
// own CLI, which an install or update of the copy takes away.
type Old_plugin = {
    id: string;
    action: 'removed' | 'failed';
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
    // Set by install and update when the host still had the old reply-adapter
    // plugin: whether it was removed once the copy landed. A failure leaves
    // the status alone — the copy is there — and the report says the plugin
    // still loads beside it.
    old_plugin?: Old_plugin;
    // The other plugins of that marketplace still installed, by id. This CLI
    // leaves them, and the report says it no longer offers them.
    retired_plugins?: string[];
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
    // What the pack was copied from: this CLI's own package, at its version.
    source: {version: string};
    requested: string[];
    resolved: string[];
    hosts: Host_outcome[];
    summary: {installed: number; skipped: number; failed: number};
    orphans?: Orphaned_packs[];
};

type Run_result = {code: number; stdout: string; stderr: string};

// Injected process runner: the single seam that lets every plugin-CLI test
// run without an assistant installed.
type Runner = (bin: string, args: string[])=>Promise<Run_result>;

export type {
    Pack, Scope, Host_kind, Plugin_cli, Host_def, Orphaned_packs, Old_plugin,
    Pack_action, Pack_outcome, Host_status, Host_outcome,
    Operation, Report, Run_result, Runner,
};
