import path from 'path';
import {describe, it, expect} from 'vitest';
import {HOSTS, host_by_id, host_ids} from '../../skills/hosts';
import {UsageError} from '../../utils/errors';

describe('host registry', ()=>{
    it('has unique ids', ()=>{
        expect(new Set(host_ids()).size).toBe(HOSTS.length);
    });

    it('covers the hosts v1 promises', ()=>{
        expect(host_ids()).toEqual(expect.arrayContaining([
            'claude-code', 'codex', 'cursor', 'github-copilot', 'windsurf',
        ]));
    });

    it('marks only the hosts we actually verified', ()=>{
        expect(HOSTS.filter(h=>h.verified).map(h=>h.id))
            .toEqual(['claude-code', 'codex', 'antigravity', 'cursor', 'windsurf']);
    });

    it('gives every native host a CLI and every flat host a skills directory', ()=>{
        for (const host of HOSTS)
        {
            if (host.kind === 'native-plugin')
            {
                expect(host.cli, host.id).toBeDefined();
                expect(host.binaries.length, host.id).toBeGreaterThan(0);
            }
            else
            {
                expect(host.user_skills_dir, host.id).toBeDefined();
            }
            // Every host needs a project target: flat hosts use theirs directly,
            // native hosts fall back to it when --project cannot be expressed.
            expect(host.project_skills_dir, host.id).toBeDefined();
        }
    });
    
    it('never lets one host\'s config directory contain another\'s', ()=>{
        const dirs = HOSTS.flatMap(h=>h.config_dirs.map(dir=>({id: h.id, dir})));
        for (const a of dirs)
        {
            for (const b of dirs.filter(other=>other.id !== a.id))
            {
                expect(a.dir === b.dir || a.dir.startsWith(`${b.dir}${path.sep}`), `${a.id} inside ${b.id}`)
                    .toBe(false);
            }
        }
    });

    it('builds Claude Code argument vectors', ()=>{
        const cli = host_by_id('claude-code').cli!;
        expect(cli.marketplace_add('reply-team/reply-skills'))
            .toEqual(['plugin', 'marketplace', 'add', 'reply-team/reply-skills']);
        expect(cli.install('ai-sdr-core', 'reply-skills', 'user'))
            .toEqual(['plugin', 'install', 'ai-sdr-core@reply-skills', '--scope', 'user']);
        expect(cli.remove('ai-sdr-core', 'reply-skills')).toEqual(['plugin', 'uninstall', 'ai-sdr-core@reply-skills']);
        expect(cli.list_json()).toEqual(['plugin', 'list', '--json']);
    });

    it('builds Codex argument vectors, which spell the verbs differently', ()=>{
        const cli = host_by_id('codex').cli!;
        expect(cli.marketplace_add('reply-team/reply-skills'))
            .toEqual(['plugin', 'marketplace', 'add', 'reply-team/reply-skills', '--json']);
        expect(cli.install('ai-sdr-core', 'reply-skills', 'user'))
            .toEqual(['plugin', 'add', 'ai-sdr-core@reply-skills', '--json']);
        expect(cli.remove('ai-sdr-core', 'reply-skills')).toEqual(['plugin', 'remove', 'ai-sdr-core@reply-skills', '--json']);
    });

    it('knows Codex ships off PATH on Windows', ()=>{
        expect(host_by_id('codex').binary_paths.join(' ')).toContain('OpenAI');
    });

    it('rejects an unknown host id with a usage error listing the known ones', ()=>{
        expect(()=>host_by_id('nope')).toThrow(UsageError);
        try { host_by_id('nope'); }
        catch (e) { expect((e as UsageError).hint).toContain('claude-code'); }
    });
});
