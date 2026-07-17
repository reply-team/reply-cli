import {describe, it, expect} from 'vitest';
import {resolve_request_identity} from '../../auth/request-identity';
import {UsageError} from '../../utils/errors';

const base = {credential_type: 'api_key' as const, env: {} as NodeJS.ProcessEnv};

describe('resolve_request_identity — team id precedence (flag > env > profile)', ()=>{
    it('uses --team-id over env and profile', ()=>{
        const r = resolve_request_identity({
            ...base, team_id_flag: '10', profile_team_id: 30,
            env: {REPLY_TEAM_ID: '20'} as NodeJS.ProcessEnv,
        });
        expect(r.headers['X-TEAM-ID']).toBe('10');
    });

    it('uses REPLY_TEAM_ID over profile when no flag', ()=>{
        const r = resolve_request_identity({
            ...base, profile_team_id: 30, env: {REPLY_TEAM_ID: '20'} as NodeJS.ProcessEnv,
        });
        expect(r.headers['X-TEAM-ID']).toBe('20');
    });

    it('falls back to the profile team_id', ()=>{
        const r = resolve_request_identity({...base, profile_team_id: 30});
        expect(r.headers['X-TEAM-ID']).toBe('30');
    });

    it('emits no X-TEAM-ID when nothing is set', ()=>{
        const r = resolve_request_identity({...base});
        expect(r.headers['X-TEAM-ID']).toBeUndefined();
        expect(r.headers).toEqual({});
    });
});

describe('resolve_request_identity — acting user (flag only)', ()=>{
    it('maps --user-id to X-USER-ID', ()=>{
        const r = resolve_request_identity({...base, user_id_flag: '1223'});
        expect(r.headers['X-USER-ID']).toBe('1223');
        expect(r.headers['X-User-Email']).toBeUndefined();
    });

    it('maps --user-email to X-User-Email (with a team id)', ()=>{
        const r = resolve_request_identity({...base, user_email_flag: 'a@b.co', team_id_flag: '7'});
        expect(r.headers['X-User-Email']).toBe('a@b.co');
        expect(r.headers['X-TEAM-ID']).toBe('7');
    });
});

describe('resolve_request_identity — validation (UsageError)', ()=>{
    it('rejects both --user-id and --user-email', ()=>{
        expect(()=>resolve_request_identity({...base, user_id_flag: '1', user_email_flag: 'a@b.co', team_id_flag: '2'}))
            .toThrow(UsageError);
    });

    it('rejects --user-email without a team id', ()=>{
        expect(()=>resolve_request_identity({...base, user_email_flag: 'a@b.co'})).toThrow(UsageError);
    });

    it('rejects a non-integer --team-id', ()=>{
        expect(()=>resolve_request_identity({...base, team_id_flag: 'abc'})).toThrow(UsageError);
    });

    it('rejects a non-integer --user-id', ()=>{
        expect(()=>resolve_request_identity({...base, user_id_flag: '1.5'})).toThrow(UsageError);
    });

    it('rejects a non-integer REPLY_TEAM_ID', ()=>{
        expect(()=>resolve_request_identity({...base, env: {REPLY_TEAM_ID: 'x'} as NodeJS.ProcessEnv}))
            .toThrow(UsageError);
    });
});

describe('resolve_request_identity — OAuth note', ()=>{
    it('warns (but still sends) when an identity flag is used with OAuth', ()=>{
        const r = resolve_request_identity({...base, credential_type: 'oauth', user_id_flag: '5'});
        expect(r.warnings).toHaveLength(1);
        expect(r.warnings[0]).toMatch(/OAuth/i);
        expect(r.headers['X-USER-ID']).toBe('5');
    });

    it('does not warn for an identity flag with an API key', ()=>{
        const r = resolve_request_identity({...base, credential_type: 'api_key', user_id_flag: '5'});
        expect(r.warnings).toEqual([]);
    });

    it('does not warn for a team id alone under OAuth', ()=>{
        const r = resolve_request_identity({...base, credential_type: 'oauth', team_id_flag: '9'});
        expect(r.warnings).toEqual([]);
        expect(r.headers['X-TEAM-ID']).toBe('9');
    });
});
