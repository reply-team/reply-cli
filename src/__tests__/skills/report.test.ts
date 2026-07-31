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

const report = (hosts: Host_outcome[], over: Partial<Report> = {}): Report=>({
    action: 'install',
    source: {repo: 'reply-team/reply-skills', ref: 'main'},
    requested: ['ai-sdr-core', 'reply-adapter'],
    resolved: ['ai-sdr-core', 'reply-adapter'],
    hosts,
    summary: summarize(hosts),
    ...over,
});

describe('summarize', ()=>{
    it('counts hosts by outcome, not packs', ()=>{
        expect(summarize([host(), host({host: 'codex', status: 'skipped'}), host({host: 'x', status: 'failed'})]))
            .toEqual({installed: 1, skipped: 1, failed: 1});
    });

    it('counts a partial host as installed, because something landed', ()=>{
        expect(summarize([host({status: 'partial'})])).toEqual({installed: 1, skipped: 0, failed: 0});
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
        const out = text(report([host({
            packs: [
                {name: 'ai-sdr-core', action: 'installed', version: '0.1.0'},
                {name: 'reply-adapter', action: 'failed', version: '0.1.0', detail: 'installation incomplete; run `reply skills install` to repair'},
            ],
        })]));
        expect(out).toContain('installation incomplete; run `reply skills install` to repair');
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
