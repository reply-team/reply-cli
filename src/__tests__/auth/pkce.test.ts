import {describe, it, expect} from 'vitest';
import crypto from 'crypto';
import {create_pkce, create_state} from '../../auth/pkce';

const URL_SAFE = /^[A-Za-z0-9\-_]+$/;

describe('auth/pkce', ()=>{
    describe('create_pkce', ()=>{
        it('produces a URL-safe verifier of RFC 7636 length (43-128)', ()=>{
            const {verifier} = create_pkce();
            expect(verifier).toMatch(URL_SAFE);
            expect(verifier.length).toBeGreaterThanOrEqual(43);
            expect(verifier.length).toBeLessThanOrEqual(128);
        });

        it('uses the S256 method', ()=>{
            expect(create_pkce().method).toBe('S256');
        });

        it('challenge is base64url(sha256(verifier))', ()=>{
            const {verifier, challenge} = create_pkce();
            const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
            expect(challenge).toBe(expected);
            expect(challenge).toMatch(URL_SAFE);
        });

        it('generates a fresh verifier each call', ()=>{
            expect(create_pkce().verifier).not.toBe(create_pkce().verifier);
        });
    });

    describe('create_state', ()=>{
        it('is a non-empty URL-safe string, distinct per call', ()=>{
            const a = create_state();
            const b = create_state();
            expect(a).toMatch(URL_SAFE);
            expect(a.length).toBeGreaterThanOrEqual(16);
            expect(a).not.toBe(b);
        });
    });
});
