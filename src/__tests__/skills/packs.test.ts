import {describe, it, expect} from 'vitest';
import {cli_version} from '../../config';
import {MOVED, plugin_id, resolve_packs} from '../../skills/packs';
import {UsageError} from '../../utils/errors';

const names = (packs: {name: string}[]): string[]=>packs.map(p=>p.name);

describe('resolve_packs', ()=>{
    it('means the one pack for install and update when nothing is requested', ()=>{
        for (const operation of ['install', 'update'] as const)
        {
            expect(resolve_packs([], operation)).toEqual([{name: 'reply-adapter', version: cli_version()}]);
        }
    });

    it('means everything an earlier version installed for list and remove when nothing is requested', ()=>{
        for (const operation of ['list', 'remove'] as const)
        {
            expect(resolve_packs([], operation)).toEqual([
                {name: 'reply-adapter', version: cli_version()},
                {name: 'ai-sdr-core', version: '', retired: true},
                {name: 'agentic-runtime', version: '', retired: true},
            ]);
        }
    });

    it('accepts the canonical name and the alias, once', ()=>{
        expect(names(resolve_packs(['adapter', 'reply-adapter'], 'install'))).toEqual(['reply-adapter']);
    });

    it('reaches the retired packs by their old names for list and remove', ()=>{
        expect(resolve_packs(['core'], 'remove')).toEqual([{name: 'ai-sdr-core', version: '', retired: true}]);
        expect(resolve_packs(['runtime', 'agentic-runtime'], 'list'))
            .toEqual([{name: 'agentic-runtime', version: '', retired: true}]);
    });

    it('refuses a retired name for install with the one sentence', ()=>{
        let caught: unknown;
        try {
            resolve_packs(['adapter', 'core'], 'install');
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(UsageError);
        expect((caught as UsageError).message).toBe(MOVED);
        expect((caught as UsageError).code).toBe('usage.skills_pack_moved');
    });

    it('rejects an unknown name with a usage error naming the pack', ()=>{
        let caught: unknown;
        try {
            resolve_packs(['nope'], 'install');
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(UsageError);
        expect((caught as UsageError).message).toContain('nope');
        expect((caught as UsageError).hint).toContain('reply-adapter');
        expect((caught as UsageError).hint).toContain('adapter');
    });

    it('takes nothing from the object prototype for a pack name', ()=>{
        for (const raw of ['constructor', 'toString', '__proto__'])
        {
            for (const operation of ['install', 'list'] as const)
            {
                let caught: unknown;
                try {
                    resolve_packs([raw], operation);
                } catch (error) {
                    caught = error;
                }
                expect(caught, `${raw} on ${operation}`).toBeInstanceOf(UsageError);
                expect((caught as UsageError).code, `${raw} on ${operation}`).toBe('usage.skills_pack');
            }
        }
    });
});

describe('plugin_id', ()=>{
    it('names a plugin of the marketplace an earlier version registered', ()=>{
        expect(plugin_id('reply-adapter')).toBe('reply-adapter@reply-skills');
    });
});
