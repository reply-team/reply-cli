import {pc} from '../utils/output';
import type {Host_outcome, Operation, Pack_action, Report} from './types';

// Turns per-host outcomes into what the user reads and what the process
// returns. The report names only what was found: an assistant that is not on
// the machine is never mentioned.

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
    const label = host.label.padEnd(12);
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

// Whether this run put anything new in front of the assistant, and so whether
// the user has to start a new session. The action labels alone cannot answer
// it: an unchanged version reports `current` in every adapter, which is right,
// but a flat host re-copying a newer commit at that same version did rewrite
// the files. `refreshed` carries exactly that, so both facts are consulted.
const changed = (report: Report): boolean=>report.hosts.some(h=>
    (h.packs ?? []).some(p=>
        p.action === 'installed' || p.action === 'upgraded' || p.refreshed === true));

const human_lines = (report: Report): string[]=>{
    const lines: string[] = [];
    if (!report.hosts.length)
    {
        lines.push(pc.yellow('⚠ no supported assistant found on this machine'));
        lines.push(pc.dim('  Install Claude Code or Codex, or pass --agent to name one explicitly.'));
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
    if (changed(report) && report.action !== 'list')
    {
        lines.push(pc.dim('Start a new session in each assistant so the skills load.'));
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
