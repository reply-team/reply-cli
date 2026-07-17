import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {print, success, warn, info, redact, safe_record, REDACTED} from '../../utils/output';
import type {Credential_record} from '../../credentials/types';

let stdout_spy: ReturnType<typeof vi.spyOn>;
let stderr_spy: ReturnType<typeof vi.spyOn>;

beforeEach(()=>{
    stdout_spy = vi.spyOn(process.stdout, 'write').mockImplementation(()=>true);
    stderr_spy = vi.spyOn(console, 'error').mockImplementation(()=>{});
});

afterEach(()=>{
    vi.restoreAllMocks();
});

describe('utils/output — redaction', ()=>{
    it('redact never echoes the secret', ()=>{
        expect(redact('sk_live_supersecret_1234')).toBe(REDACTED);
        expect(redact('sk_live_supersecret_1234')).not.toContain('supersecret');
    });

    it('safe_record masks the api key', ()=>{
        const rec: Credential_record = {type: 'api_key', key: 'sk_live_abc', user: {username: 'u'}};
        const safe = safe_record(rec) as {key: string; user: unknown};
        expect(safe.key).toBe(REDACTED);
        expect(safe.user).toEqual({username: 'u'});
        expect(JSON.stringify(safe)).not.toContain('sk_live_abc');
    });

    it('safe_record masks oauth access and refresh tokens but keeps expiry/user', ()=>{
        const rec: Credential_record = {
            type: 'oauth', access_token: 'AT_secret', refresh_token: 'RT_secret',
            expires_at: 123, user: {username: 'u'},
        };
        const safe = safe_record(rec) as Record<string, unknown>;
        expect(safe.access_token).toBe(REDACTED);
        expect(safe.refresh_token).toBe(REDACTED);
        expect(safe.expires_at).toBe(123);
        expect(JSON.stringify(safe)).not.toContain('secret');
    });

    it('safe_record leaves an oauth record without a refresh token free of a masked field', ()=>{
        const rec: Credential_record = {type: 'oauth', access_token: 'AT', expires_at: 1};
        const safe = safe_record(rec) as Record<string, unknown>;
        expect(safe.refresh_token).toBeUndefined();
    });
});

describe('utils/output — print routing', ()=>{
    it('writes compact JSON to stdout with --json', ()=>{
        print({a: 1, b: 2}, {json: true});
        expect(stdout_spy).toHaveBeenCalledWith('{"a":1,"b":2}\n');
    });

    it('writes indented JSON to stdout with --pretty', ()=>{
        print({a: 1}, {pretty: true});
        expect(stdout_spy).toHaveBeenCalledWith(JSON.stringify({a: 1}, null, 2) + '\n');
    });

    it('pretty-prints objects by default', ()=>{
        print({a: 1});
        expect(stdout_spy).toHaveBeenCalledWith(JSON.stringify({a: 1}, null, 2) + '\n');
    });

    it('emits strings as-is in the default format', ()=>{
        print('hello');
        expect(stdout_spy).toHaveBeenCalledWith('hello\n');
    });
});

describe('utils/output — status goes to stderr', ()=>{
    it('success/warn/info write to stderr, never stdout', ()=>{
        success('ok');
        warn('careful');
        info('fyi');
        expect(stderr_spy).toHaveBeenCalledTimes(3);
        expect(stdout_spy).not.toHaveBeenCalled();
    });
});
