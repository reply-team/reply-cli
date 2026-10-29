import {describe, it, expect} from 'vitest';
import {
    parse_id, parse_int_in, parse_iso, parse_moment, parse_idempotency_key, parse_choice, LARGEST_SAFE_ID,
} from '../../operations/options';
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

    it('parse_id takes a larger bound for the ids Reply numbers in 64 bits, up to what a JSON number carries exactly', ()=>{
        expect(parse_id('2147483648', 'Email account id', LARGEST_SAFE_ID)).toBe(2147483648);
        expect(parse_id('9007199254740991', 'Email account id', LARGEST_SAFE_ID)).toBe(9007199254740991);
        for (const bad of ['0', '-1', '9007199254740992', '9007199254740993', '99999999999999999999', '1e3'])
        {
            expect(usage_code(()=>parse_id(bad, 'Email account id', LARGEST_SAFE_ID)), bad).toBe('usage.id');
        }
    });

    it('parse_id never echoes something that looks like an email address', ()=>{
        try { parse_id('ann@example.com', '--contact-id'); } catch (e) {
            expect(JSON.stringify((e as UsageError).to_json())).not.toContain('ann@example.com');
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

    it('parse_moment takes a date and time with its offset, as the same instant in UTC', ()=>{
        expect(parse_moment('2026-11-03T14:00:00Z', '--send-after')).toBe('2026-11-03T14:00:00.000Z');
        expect(parse_moment('2026-11-03T16:00:00+02:00', '--send-after')).toBe('2026-11-03T14:00:00.000Z');
        expect(parse_moment('2026-11-03T09:00-0500', '--since')).toBe('2026-11-03T14:00:00.000Z');
        expect(parse_moment('2026-11-03t14:00:00.25z', '--since')).toBe('2026-11-03T14:00:00.250Z');
    });

    it('parse_moment refuses a date alone and a time without its offset, which the CLI would have to place in a zone of its own', ()=>{
        for (const bad of ['2026-11-03', '2026-11-03T14:00:00', '2026-11-03 14:00:00Z', 'tomorrow', '1', '2026-13-45T00:00:00Z'])
        {
            expect(usage_code(()=>parse_moment(bad, '--send-after')), bad).toBe('usage.date');
        }
        expect(()=>parse_moment('2026-11-03T14:00:00', '--send-after'))
            .toThrow('--send-after must be a date and time with its offset, e.g. 2026-11-03T14:00:00Z.');
    });

    it('parse_idempotency_key takes 1 to 255 characters from space to tilde, spaces inside, as given', ()=>{
        expect(parse_idempotency_key('send-456-step-2')).toBe('send-456-step-2');
        for (const good of ['a b', 'send 456  step 2', '~!"#', 'k'.repeat(255), `a${' '.repeat(253)}b`])
        {
            expect(parse_idempotency_key(good), JSON.stringify(good)).toBe(good);
        }
        // A header value loses a space at either end on its way out, so such a key would reach Reply as another key.
        for (const bad of ['', ' ', ' a', 'a ', 'k'.repeat(256), 'café', 'a\nb', 'a\tb', 'a\u007fb'])
        {
            expect(usage_code(()=>parse_idempotency_key(bad)), JSON.stringify(bad)).toBe('usage.idempotency_key');
        }
    });

    it('parse_choice accepts only the listed values', ()=>{
        expect(parse_choice('sent', '--source', ['inbox', 'sent'] as const)).toBe('sent');
        expect(parse_choice(undefined, '--source', ['inbox'] as const)).toBeUndefined();
        expect(usage_code(()=>parse_choice('all', '--source', ['inbox', 'sent'] as const))).toBe('usage.choice');
    });
});
