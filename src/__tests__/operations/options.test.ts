import {describe, it, expect} from 'vitest';
import {parse_id, parse_int_in, parse_iso, parse_choice, parse_idempotency_key} from '../../operations/options';
import {UsageError} from '../../utils/errors';

const usage_code = (fn: () => unknown): string | undefined=>{
    try { fn(); } catch (e) { return e instanceof UsageError ? e.code : 'not-usage'; }
    return undefined;
};

describe('operations/options', ()=>{
    it('parse_id takes a positive 32-bit integer and nothing else', ()=>{
        expect(parse_id('123', 'Sequence id')).toBe(123);
        expect(parse_id(' 2147483647 ', 'Sequence id')).toBe(2147483647);
        for (const bad of ['0', '007', '-1', 'abc', '1.5', '2147483648', ''])
        {
            expect(usage_code(()=>parse_id(bad, 'Sequence id'))).toBe('usage.id');
        }
    });

    it('parse_id never echoes something that looks like an email address', ()=>{
        try { parse_id('ann@acme.com', '--contact-id'); } catch (e) {
            expect(JSON.stringify((e as UsageError).to_json())).not.toContain('ann@acme.com');
            return;
        }
        throw new Error('expected a UsageError');
    });

    it('parse_int_in falls back when absent and refuses outside the range', ()=>{
        expect(parse_int_in(undefined, '--limit', 1, 100, 20)).toBe(20);
        expect(parse_int_in('100', '--limit', 1, 100, 20)).toBe(100);
        expect(parse_int_in('0', '--offset', 0, 1000000, 0)).toBe(0);
        for (const bad of ['0', '101', '-1', 'x', '2.5'])
        {
            expect(usage_code(()=>parse_int_in(bad, '--limit', 1, 100, 20))).toBe('usage.range');
        }
        expect(usage_code(()=>parse_int_in('-1', '--offset', 0, 1000000, 0))).toBe('usage.range');
    });

    it('parse_iso normalizes to ISO 8601 UTC and refuses non-dates', ()=>{
        expect(parse_iso('2026-10-01T03:00:00+03:00', '--since')).toBe('2026-10-01T00:00:00.000Z');
        expect(parse_iso('2026-10-01T03:00:00+0300', '--since')).toBe('2026-10-01T00:00:00.000Z');
        expect(usage_code(()=>parse_iso('yesterday', '--since'))).toBe('usage.date');
    });

    it('parse_iso takes ISO 8601 only, and a time without a zone as UTC, never local time', ()=>{
        expect(parse_iso('2026-10-01T09:30:00', '--since')).toBe('2026-10-01T09:30:00.000Z');
        expect(parse_iso('2026-10-01', '--from')).toBe('2026-10-01T00:00:00.000Z');
        for (const bad of ['1', 'March 7', '2026-13-45', '10/01/2026'])
        {
            expect(usage_code(()=>parse_iso(bad, '--since'))).toBe('usage.date');
        }
    });

    it('parse_choice accepts only the listed values', ()=>{
        expect(parse_choice('sent', '--source', ['inbox', 'sent'] as const)).toBe('sent');
        expect(parse_choice(undefined, '--source', ['inbox'] as const)).toBeUndefined();
        expect(usage_code(()=>parse_choice('all', '--source', ['inbox', 'sent'] as const))).toBe('usage.choice');
    });

    it('parse_idempotency_key takes 1-255 printable characters without spaces', ()=>{
        expect(parse_idempotency_key('wi_01HX:enroll')).toBe('wi_01HX:enroll');
        expect(parse_idempotency_key(undefined)).toBeUndefined();
        for (const bad of ['', 'has space', 'x'.repeat(256), 'tab\there'])
        {
            expect(usage_code(()=>parse_idempotency_key(bad))).toBe('usage.idempotency_key');
        }
    });
});
