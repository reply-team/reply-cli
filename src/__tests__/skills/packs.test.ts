import {describe, it, expect, vi} from 'vitest';
import {parse_packs, load_packs, resolve_packs, packs_url, PACKS_FALLBACK, DEFAULT_REF} from '../../skills/packs';
import {UsageError, RuntimeError} from '../../utils/errors';

const registry = PACKS_FALLBACK;
const names = (packs: {name: string}[]): string[]=>packs.map(p=>p.name);

describe('resolve_packs', ()=>{
    it('returns every pack, core first, when nothing is requested', ()=>{
        expect(names(resolve_packs([], registry))).toEqual(['ai-sdr-core', 'reply-adapter', 'agentic-runtime']);
    });

    it('expands the short aliases', ()=>{
        expect(names(resolve_packs(['core'], registry))).toEqual(['ai-sdr-core']);
        expect(names(resolve_packs(['runtime'], registry))).toEqual(['ai-sdr-core', 'agentic-runtime']);
    });

    it('accepts canonical names too', ()=>{
        expect(names(resolve_packs(['ai-sdr-core'], registry))).toEqual(['ai-sdr-core']);
    });

    it('pulls the dependency and keeps it first', ()=>{
        expect(names(resolve_packs(['adapter'], registry))).toEqual(['ai-sdr-core', 'reply-adapter']);
    });

    it('de-duplicates a pack requested twice or pulled twice', ()=>{
        expect(names(resolve_packs(['adapter', 'runtime', 'core'], registry)))
            .toEqual(['ai-sdr-core', 'reply-adapter', 'agentic-runtime']);
    });

    it('rejects an unknown name with a usage error listing the valid ones', ()=>{
        expect(()=>resolve_packs(['nope'], registry)).toThrow(UsageError);
        try { resolve_packs(['nope'], registry); }
        catch (e) { expect((e as UsageError).hint).toContain('ai-sdr-core'); }
    });

    // Removal must not expand the graph: `remove runtime` means that pack and
    // nothing else. Expanding would drag the core out from under the adapter.
    it('does not pull dependencies when dependencies are switched off', ()=>{
        expect(names(resolve_packs(['runtime'], registry, {dependencies: false}))).toEqual(['agentic-runtime']);
        expect(names(resolve_packs(['adapter'], registry, {dependencies: false}))).toEqual(['reply-adapter']);
    });

    it('still returns everything, dependency-ordered, when nothing is requested', ()=>{
        expect(names(resolve_packs([], registry, {dependencies: false})))
            .toEqual(['ai-sdr-core', 'reply-adapter', 'agentic-runtime']);
    });

    it('keeps registry order when dependencies are off, so reversing gives dependents first', ()=>{
        expect(names(resolve_packs(['runtime', 'core'], registry, {dependencies: false})))
            .toEqual(['ai-sdr-core', 'agentic-runtime']);
    });
});

describe('parse_packs', ()=>{
    it('reads marketplace name and packs', ()=>{
        const parsed = parse_packs({
            marketplace: {name: 'reply-skills'},
            packs: [{name: 'a', displayName: 'A', version: '1.0.0', description: 'd', dependencies: []}],
        });
        expect(parsed.marketplace).toBe('reply-skills');
        expect(parsed.packs[0]).toEqual({name: 'a', display_name: 'A', version: '1.0.0', description: 'd', dependencies: []});
    });

    it('defaults a missing dependencies array to empty', ()=>{
        const parsed = parse_packs({
            marketplace: {name: 'm'},
            packs: [{name: 'a', version: '1.0.0'}],
        });
        expect(parsed.packs[0].dependencies).toEqual([]);
    });

    it('rejects the whole document when a pack has no name', ()=>{
        expect(()=>parse_packs({marketplace: {name: 'm'}, packs: [{version: '1.0.0'}]})).toThrow(RuntimeError);
    });

    it('rejects a document with no packs array', ()=>{
        expect(()=>parse_packs({marketplace: {name: 'm'}})).toThrow(RuntimeError);
    });

    it('rejects a dependency that names a pack not in the document', ()=>{
        expect(()=>parse_packs({
            marketplace: {name: 'm'},
            packs: [{name: 'a', version: '1.0.0', dependencies: ['ghost']}],
        })).toThrow(RuntimeError);
    });
});

describe('load_packs', ()=>{
    it('builds the raw URL from the ref', ()=>{
        expect(packs_url('v1.2.3')).toBe(
            'https://raw.githubusercontent.com/reply-team/reply-skills/v1.2.3/packs.json');
        expect(packs_url(DEFAULT_REF)).toContain('/main/packs.json');
    });

    it('uses the fetched document when the request succeeds', async()=>{
        const body = {marketplace: {name: 'reply-skills'}, packs: [{name: 'solo', version: '9.9.9'}]};
        const fetch_impl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {status: 200}));
        const parsed = await load_packs({fetch_impl: fetch_impl as unknown as typeof fetch});
        expect(names(parsed.packs)).toEqual(['solo']);
    });

    it('falls back to the embedded copy when the network fails', async()=>{
        const fetch_impl = vi.fn().mockRejectedValue(new TypeError('offline'));
        const parsed = await load_packs({fetch_impl: fetch_impl as unknown as typeof fetch});
        expect(names(parsed.packs)).toEqual(names(PACKS_FALLBACK.packs));
    });

    it('falls back on a non-200 response', async()=>{
        const fetch_impl = vi.fn().mockResolvedValue(new Response('nope', {status: 404}));
        const parsed = await load_packs({fetch_impl: fetch_impl as unknown as typeof fetch});
        expect(names(parsed.packs)).toEqual(names(PACKS_FALLBACK.packs));
    });

    it('falls back when the fetched document is malformed rather than throwing', async()=>{
        const fetch_impl = vi.fn().mockResolvedValue(new Response('{"packs":[{"no":"name"}]}', {status: 200}));
        const parsed = await load_packs({fetch_impl: fetch_impl as unknown as typeof fetch});
        expect(names(parsed.packs)).toEqual(names(PACKS_FALLBACK.packs));
    });
});
