import {HOSTS} from './hosts';
import {pc} from '../utils/output';
import type {Host_outcome, Operation, Pack_action, Report} from './types';

// Turns per-host outcomes into what the user reads and what the process
// returns. The report names only what was found: an assistant that is not on
// the machine is never mentioned.

// Widest label in the registry plus one, so a host's `·` lands in the same
// column no matter which hosts were detected, and even the longest label keeps a
// space before it. A fixed 12 used to be enough and is not: 'GitHub Copilot' and
// 'Windsurf (Devin)' both overrun it and ran their text into the separator.
const LABEL_WIDTH = Math.max(...HOSTS.map(h=>h.label.length)) + 1;

// "a, b or c" — no trailing comma, and safe at one or zero items.
const or_list = (items: string[]): string=>
    items.length < 2 ? items[0] ?? '' : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;

// `list` is a query: a host answering "ok" says nothing about whether any pack
// is actually there. For every other operation, "installed" is the outcome
// status (something landed, or didn't); for `list`, it is whether a pack was
// actually found — skipped/failed keep their host-oriented meaning either way.
const summarize = (hosts: Host_outcome[], action: Operation): Report['summary']=>({
    installed: action === 'list'
        ? hosts.filter(h=>(h.packs?.length ?? 0) > 0).length
        : hosts.filter(h=>h.status === 'ok' || h.status === 'partial').length,
    skipped: hosts.filter(h=>h.status === 'skipped').length,
    failed: hosts.filter(h=>h.status === 'failed').length,
});

const dependency_note = (requested: string[], resolved: string[]): string | undefined=>{
    const added = resolved.filter(name=>!requested.includes(name));
    if (!added.length || !requested.length)
    {
        return undefined;
    }
    return `${added.join(', ')} added — required by ${requested.join(', ')}`;
};

const verb = {
    installed: 'installed', upgraded: 'updated', removed: 'removed',
    current: 'already current', failed: 'failed',
} as const;

// `list` never changes anything: an 'upgraded' pack there means a newer
// version is available, not that an update already happened underfoot.
const pack_verb = (report_action: Operation, pack_action: Pack_action): string=>
    report_action === 'list' && pack_action === 'upgraded' ? 'update available' : verb[pack_action];

// Groups a host's packs by what happened, so one host is one line.
const host_line = (host: Host_outcome, report_action: Operation): string=>{
    const label = host.label.padEnd(LABEL_WIDTH);
    if (host.status === 'skipped')
    {
        return pc.yellow(`⚠ ${label}· skipped — ${host.detail ?? host.reason ?? 'not usable'}`);
    }
    if (host.status === 'failed' && !host.packs?.length)
    {
        return pc.yellow(`⚠ ${label}· failed — ${host.detail ?? host.reason ?? 'unknown error'}`);
    }
    const groups = new Map<string, string[]>();
    for (const pack of host.packs ?? [])
    {
        const key = pack_verb(report_action, pack.action);
        groups.set(key, [...(groups.get(key) ?? []), pack.name]);
    }
    if (!groups.size)
    {
        return pc.dim(`· ${label}· nothing to do`);
    }
    const parts = [...groups.entries()].map(([action, names])=>`${names.join(', ')} ${action}`);
    const mark = host.status === 'ok' ? pc.green('✓') : pc.yellow('⚠');
    // A confident tick on a host whose skills directory we have never
    // confirmed the assistant reads from would overstate what we know
    // Only said where a claim is actually being made.
    const note = host.verified === false ? pc.dim(' (paths not yet verified)') : '';
    return `${mark} ${label}· ${parts.join('; ')}${note}`;
};

// Hosts this run put something new in front of. The action labels alone cannot
// answer it: an unchanged version reports `current` in every adapter, which is
// right, but a flat host re-copying a newer commit at that same version did
// rewrite the files. `refreshed` carries exactly that, so both facts are
// consulted.
const changed_hosts = (report: Report): Host_outcome[]=>report.hosts.filter(h=>
    (h.packs ?? []).some(p=>
        p.action === 'installed' || p.action === 'upgraded' || p.refreshed === true));

const human_lines = (report: Report): string[]=>{
    const lines: string[] = [];
    if (!report.hosts.length)
    {
        lines.push(pc.yellow('⚠ no supported assistant found on this machine'));
        // Named from the registry rather than written out, because this line has
        // gone stale twice: it still said "Claude Code or Codex" after Cursor was
        // verified, and omitted Windsurf after that. Labels, so someone running
        // Devin sees the name on their own machine.
        const installable = or_list(HOSTS.filter(h=>h.verified).map(h=>h.label));
        lines.push(pc.dim(`  Install ${installable}, or pass --agent to name one explicitly.`));
        return lines;
    }
    lines.push(pc.green(`✓ detected ${report.hosts.map(h=>h.label).join(', ')}`));
    const note = dependency_note(report.requested, report.resolved);
    if (note && report.action === 'install')
    {
        lines.push(pc.dim(`  ${note}`));
    }
    for (const host of report.hosts)
    {
        lines.push(host_line(host, report.action));
        if (host.hint)
        {
            lines.push(pc.dim(`  fix: ${host.hint}`));
        }
        // Surface pack-level details for failed packs
        const failed_packs = (host.packs ?? []).filter(p=>p.action === 'failed' && p.detail);
        for (const pack of failed_packs)
        {
            lines.push(pc.dim(`  ${pack.name}: ${pack.detail}`));
        }
    }
    // Only the hosts that actually need it. Asking someone to restart an
    // assistant that re-reads its skills every turn tells them to do something
    // the host does not require, and naming the hosts is the honest form when a
    // run touched both kinds. `needs_new_session` is registry data the
    // orchestrator stamps, so this never has to know which host is which.
    const restart = changed_hosts(report).filter(h=>h.needs_new_session !== false);
    if (restart.length && report.action !== 'list')
    {
        lines.push(pc.dim(restart.length === changed_hosts(report).length
            ? 'Start a new session in each assistant so the skills load.'
            : `Start a new session in ${or_list(restart.map(h=>h.label))} so the skills load.`));
    }
    for (const orphan of report.orphans ?? [])
    {
        lines.push(pc.yellow(`⚠ ${orphan.packs.join(', ')} recorded for '${orphan.host}'`
            + ', an assistant this version no longer supports'));
        lines.push(pc.dim(`  ${orphan.files} file(s) left on disk`
            + `${orphan.sample ? `, starting with ${orphan.sample}` : ''}`
            + ' — delete them by hand; no --agent value reaches them now'));
    }
    return lines;
};

// Best-effort across hosts: one host failing does not fail the command, but
// installing nowhere does. `list` is a query, so it is never a failure.
const exit_code_for = (report: Report): number=>{
    if (report.action === 'list')
    {
        return 0;
    }
    return report.summary.installed > 0 ? 0 : 1;
};

export {summarize, dependency_note, host_line, human_lines, exit_code_for};
