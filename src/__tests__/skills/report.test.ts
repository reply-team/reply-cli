import {describe, it, expect} from 'vitest';
import {human_lines, exit_code_for, summarize, dependency_note} from '../../skills/report';
import type {Host_outcome, Report} from '../../skills/types';

const strip = (s: string): string=>s.replace(/\x1b\[[0-9;]*m/g, '');
const text = (report: Report): string=>human_lines(report).map(strip).join('\n');

const host = (over: Partial<Host_outcome> = {}): Host_outcome=>({
    host: 'claude-code', label: 'Claude Code', kind: 'native-plugin', scope: 'user', status: 'ok',
    packs: [
        {name: 'ai-sdr-core', action: 'installed', version: '0.1.0'},
        {name: 'reply-adapter', action: 'installed', version: '0.1.0'},
    ],
    ...over,
});

const report = (hosts: Host_outcome[], over: Partial<Report> = {}): Report=>{
    const action = over.action ?? 'install';
    return {
        action,
        source: {repo: 'reply-team/reply-skills', ref: 'main'},
        requested: ['ai-sdr-core', 'reply-adapter'],
        resolved: ['ai-sdr-core', 'reply-adapter'],
        hosts,
        summary: summarize(hosts, action),
        ...over,
    };
};

describe('summarize', ()=>{
    it('counts hosts by outcome, not packs', ()=>{
        expect(summarize([host(), host({host: 'codex', status: 'skipped'}), host({host: 'x', status: 'failed'})], 'install'))
            .toEqual({installed: 1, skipped: 1, failed: 1});
    });

    it('counts a partial host as installed, because something landed', ()=>{
        expect(summarize([host({status: 'partial'})], 'install')).toEqual({installed: 1, skipped: 0, failed: 0});
    });

    it('for list, installed means a pack is actually present, not merely that the host answered', ()=>{
        const empty_hosts = [host({packs: []}), host({host: 'codex', packs: []}), host({host: 'x', packs: []})];
        expect(summarize(empty_hosts, 'list')).toEqual({installed: 0, skipped: 0, failed: 0});
    });

    it('for list, counts only the host that actually has a pack present', ()=>{
        const hosts = [
            host({packs: [{name: 'ai-sdr-core', action: 'current', version: '0.1.0'}]}),
            host({host: 'codex', packs: []}),
            host({host: 'x', packs: []}),
        ];
        expect(summarize(hosts, 'list')).toEqual({installed: 1, skipped: 0, failed: 0});
    });

    it('for install, the same empty-packs host shapes still count by status, unchanged', ()=>{
        const empty_hosts = [host({packs: []}), host({host: 'codex', packs: []}), host({host: 'x', packs: []})];
        expect(summarize(empty_hosts, 'install')).toEqual({installed: 3, skipped: 0, failed: 0});
    });
});

describe('human_lines', ()=>{
    it('names the detected hosts and no count', ()=>{
        const out = text(report([host(), host({host: 'codex', label: 'Codex'})]));
        expect(out).toContain('detected Claude Code, Codex');
        expect(out).not.toMatch(/supported/i);
    });

    it('omits the detected line when nothing was found', ()=>{
        const out = text(report([]));
        expect(out).not.toContain('detected');
        expect(out).toMatch(/no supported assistant/i);
    });

    it('lists the packs per host', ()=>{
        expect(text(report([host()]))).toContain('Claude Code · ai-sdr-core, reply-adapter installed');
    });

    it('says current rather than installed when nothing changed', ()=>{
        const out = text(report([host({packs: [{name: 'ai-sdr-core', action: 'current', version: '0.1.0'}]})]));
        expect(out).toContain('already current');
    });

    it('shows the reason and hint for a skipped host', ()=>{
        const out = text(report([host({
            status: 'skipped', packs: undefined,
            reason: 'cli-not-resolved', detail: 'no binary', hint: 'add codex to PATH',
        })]));
        expect(out).toContain('skipped — no binary');
        expect(out).toContain('add codex to PATH');
    });

    it('surfaces a pack-level detail when the pack action is failed', ()=>{
        const lines = human_lines(report([host({
            packs: [
                {name: 'ai-sdr-core', action: 'installed', version: '0.1.0'},
                {name: 'reply-adapter', action: 'failed', version: '0.1.0', detail: 'installation incomplete; run `reply skills install` to repair'},
            ],
        })])).map(strip);
        expect(lines).toContain('  reply-adapter: installation incomplete; run `reply skills install` to repair');
        expect(lines.filter(l=>l.startsWith('  ') && l.includes('installation incomplete')).length).toBe(1);
    });

    it('distinguishes multiple failed packs with their own detail lines', ()=>{
        const lines = human_lines(report([host({
            packs: [
                {name: 'ai-sdr-core', action: 'failed', version: '0.1.0', detail: 'network timeout'},
                {name: 'reply-adapter', action: 'failed', version: '0.1.0', detail: 'disk full'},
            ],
        })])).map(strip);
        expect(lines).toContain('  ai-sdr-core: network timeout');
        expect(lines).toContain('  reply-adapter: disk full');
        expect(lines.filter(l=>l.match(/^  (ai-sdr-core|reply-adapter):/)).length).toBe(2);
    });

    // I5: a green tick on a host whose skills directory we have never
    // confirmed the assistant reads from claims more than we know.
    it('marks a host whose paths are not yet verified, and only that host', ()=>{
        const out = text(report([
            host({verified: true}),
            host({host: 'cursor', label: 'Cursor', verified: false}),
        ]));
        expect(out).toMatch(/Cursor .*paths not yet verified/);
        expect(out.split('\n').filter(l=>l.includes('paths not yet verified'))).toHaveLength(1);
    });

    it('says nothing about verification for a host that reported no packs', ()=>{
        const out = text(report([host({
            host: 'cursor', label: 'Cursor', verified: false, status: 'skipped', packs: undefined,
            reason: 'not-detected', detail: 'Cursor is not installed on this machine',
        })]));
        expect(out).not.toContain('paths not yet verified');
    });

    it('reports a pulled dependency once', ()=>{
        expect(dependency_note(['reply-adapter'], ['ai-sdr-core', 'reply-adapter']))
            .toBe('ai-sdr-core added — required by reply-adapter');
        expect(dependency_note(['ai-sdr-core'], ['ai-sdr-core'])).toBeUndefined();
    });

    it('tells the user a new session is needed after a successful install', ()=>{
        expect(text(report([host()]))).toMatch(/new session/i);
    });

    it('does not ask for a new session when nothing changed', ()=>{
        const out = text(report([host({packs: [{name: 'ai-sdr-core', action: 'current', version: '0.1.0'}]})]));
        expect(out).not.toMatch(/new session/i);
    });

    // An unchanged version reports `current` in every adapter, which is right —
    // but a flat host that re-copied a newer commit at that same version did
    // rewrite the files, and the user has to reload to pick them up.
    it('asks for a new session when files were rewritten at an unchanged version', ()=>{
        const out = text(report([host({
            packs: [{name: 'ai-sdr-core', action: 'current', version: '0.1.0', refreshed: true}],
        })]));
        expect(out).toContain('already current');
        expect(out).toMatch(/new session/i);
    });

    it('marks an outdated pack as an available update on list, not as updated', ()=>{
        const out = text(report([host({
            packs: [{name: 'ai-sdr-core', action: 'upgraded', version: '0.2.0', from: '0.1.0'}],
        })], {action: 'list'}));
        expect(out).toContain('update available');
        expect(out).not.toContain('updated');
    });

    it('still says updated for an upgraded pack on install', ()=>{
        const out = text(report([host({
            packs: [{name: 'ai-sdr-core', action: 'upgraded', version: '0.2.0', from: '0.1.0'}],
        })], {action: 'install'}));
        expect(out).toContain('ai-sdr-core updated');
    });
});

describe('exit_code_for', ()=>{
    it('is 0 when at least one host succeeded', ()=>{
        expect(exit_code_for(report([host(), host({host: 'codex', status: 'failed'})]))).toBe(0);
    });

    it('is 0 for a partial host', ()=>{
        expect(exit_code_for(report([host({status: 'partial'})]))).toBe(0);
    });

    it('is 1 when nothing installed anywhere', ()=>{
        expect(exit_code_for(report([host({status: 'failed'}), host({host: 'codex', status: 'skipped'})]))).toBe(1);
    });

    it('is 1 when no host was found at all', ()=>{
        expect(exit_code_for(report([]))).toBe(1);
    });

    it('is 0 for a list run that found nothing to report', ()=>{
        expect(exit_code_for(report([], {action: 'list'}))).toBe(0);
    });
});
