import {describe, it, expect} from 'vitest';
import {describe_status} from '../../auth/status';
import type {Credential_record} from '../../credentials/types';

const NOW = 1_700_000_000_000;
const base = {profile: 'default', now: NOW};

describe('auth/status — describe_status', ()=>{
    it('reports the --api-key flag as an ephemeral api_key source', ()=>{
        const s = describe_status({...base, api_key_flag: 'k'});
        expect(s).toMatchObject({authenticated: true, source: 'flag', method: 'api_key', profile: 'default'});
    });

    it('reports the env var when no flag is present', ()=>{
        const s = describe_status({...base, api_key_env: 'k'});
        expect(s).toMatchObject({authenticated: true, source: 'env', method: 'api_key'});
    });

    it('prefers the flag over the env var', ()=>{
        const s = describe_status({...base, api_key_flag: 'f', api_key_env: 'e'});
        expect(s.source).toBe('flag');
    });

    it('carries the active profile name', ()=>{
        const s = describe_status({profile: 'dev', now: NOW});
        expect(s.profile).toBe('dev');
    });

    it('reports a stored api_key record with its user', ()=>{
        const record: Credential_record = {type: 'api_key', key: 'k', user: {username: 'u@x'}};
        const s = describe_status({...base, record});
        expect(s).toMatchObject({authenticated: true, source: 'store', method: 'api_key'});
        expect(s.user).toEqual({username: 'u@x'});
    });

    it('reports a fresh stored oauth record with ISO expiry and expired=false', ()=>{
        const record: Credential_record = {type: 'oauth', access_token: 'a', expires_at: NOW + 3_600_000, user: {username: 'u'}};
        const s = describe_status({...base, record});
        expect(s).toMatchObject({authenticated: true, source: 'store', method: 'oauth', expired: false});
        expect(s.expires_at).toBe(new Date(NOW + 3_600_000).toISOString());
    });

    it('marks a past-expiry oauth record as expired', ()=>{
        const record: Credential_record = {type: 'oauth', access_token: 'a', expires_at: NOW - 1};
        const s = describe_status({...base, record});
        expect(s.expired).toBe(true);
    });

    it('reports not-authenticated (still with the profile) when nothing is available', ()=>{
        const s = describe_status({profile: 'default', now: NOW});
        expect(s).toEqual({authenticated: false, profile: 'default'});
    });

    it('never includes a raw secret', ()=>{
        const record: Credential_record = {type: 'api_key', key: 'super_secret_key'};
        const s = describe_status({...base, api_key_flag: 'flag_secret', record});
        expect(JSON.stringify(s)).not.toContain('secret');
    });
});
