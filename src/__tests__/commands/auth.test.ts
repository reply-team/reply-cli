import {describe, it, expect} from 'vitest';
import {normalize_principal, principal_label} from '../../commands/auth';

// The v3 /whoami contract is authoritative:
//   record WhoamiResponse(int UserId, string Username, int TeamId)
// serialized camelCase as {userId, username, teamId}. No email, no team name.
describe('normalize_principal — maps the real v3 /whoami contract', ()=>{
    it('maps userId/username/teamId to id/username/team_id', ()=>{
        expect(normalize_principal({userId: 1223, username: 'vitaliy@reply.io', teamId: 1045}))
            .toEqual({id: 1223, username: 'vitaliy@reply.io', team_id: 1045});
    });

    it('yields an empty principal when fields are absent', ()=>{
        expect(normalize_principal({})).toEqual({});
    });

    it('ignores keys that are not part of the contract', ()=>{
        expect(normalize_principal({email: 'x@y.z', teamName: 'Acme', accountId: 7}))
            .toEqual({});
    });

    it('guards against wrong types (ids must be numbers, username a string)', ()=>{
        expect(normalize_principal({userId: '1223', username: 42, teamId: '1045'}))
            .toEqual({});
    });
});

describe('principal_label — surfaces the ids that /whoami actually returns', ()=>{
    it('shows the username plus user and team ids', ()=>{
        expect(principal_label({id: 1223, username: 'vitaliy@reply.io', team_id: 1045}))
            .toBe('vitaliy@reply.io (user 1223, team 1045)');
    });

    it('shows just the username when no ids are present', ()=>{
        expect(principal_label({username: 'vitaliy@reply.io'})).toBe('vitaliy@reply.io');
    });

    it('shows the team id even when the username is present but user id is not', ()=>{
        expect(principal_label({username: 'vitaliy@reply.io', team_id: 1045}))
            .toBe('vitaliy@reply.io (team 1045)');
    });

    it('falls back to #id (without a redundant "user" bit) when username is missing', ()=>{
        expect(principal_label({id: 1223, team_id: 1045})).toBe('#1223 (team 1045)');
    });

    it('reports unknown when nothing identifies the principal', ()=>{
        expect(principal_label({})).toBe('unknown');
    });
});
