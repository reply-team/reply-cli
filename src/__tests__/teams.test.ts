import {describe, it, expect, beforeEach, vi} from 'vitest';

const mock_fetch = vi.fn();
vi.stubGlobal('fetch', mock_fetch);

import {parse_teams, resolve_my_teams, team_error_guidance} from '../teams';
import {RuntimeError} from '../utils/errors';

const res = (data: unknown, status = 200)=>
    new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});

beforeEach(()=>vi.clearAllMocks());

describe('parse_teams', ()=>{
    it('dedupes by id, reads case-insensitive keys, drops malformed', ()=>{
        const teams = parse_teams([
            {teamId: 1, teamName: 'A'},
            {TeamId: 1, TeamName: 'A dup'},
            {teamId: 2, teamName: 'B', userId: 9},
            {teamName: 'no id'},
            'garbage',
        ]);
        expect(teams).toEqual([{team_id: 1, team_name: 'A'}, {team_id: 2, team_name: 'B'}]);
    });

    it('returns [] for non-arrays', ()=>{
        expect(parse_teams(undefined)).toEqual([]);
        expect(parse_teams({})).toEqual([]);
    });
});

describe('resolve_my_teams', ()=>{
    const deps = {api_base: 'https://api/v3', token: 'tok'};

    it('maps a 200 team-users array to distinct teams', async()=>{
        mock_fetch.mockResolvedValue(res([{teamId: 1, teamName: 'A'}, {teamId: 2, teamName: 'B'}]));
        expect(await resolve_my_teams(deps)).toEqual([{team_id: 1, team_name: 'A'}, {team_id: 2, team_name: 'B'}]);
    });

    it('falls back to teams[] from a TEAM_REQUIRED 403', async()=>{
        mock_fetch.mockResolvedValue(res({code: 'TEAM_REQUIRED', teams: [{teamId: 7, teamName: 'G'}]}, 403));
        expect(await resolve_my_teams(deps)).toEqual([{team_id: 7, team_name: 'G'}]);
    });

    it('throws when the list is genuinely unavailable (USER_NOT_FOUND 401)', async()=>{
        mock_fetch.mockResolvedValue(res({code: 'USER_NOT_FOUND'}, 401));
        await expect(resolve_my_teams(deps)).rejects.toThrow(RuntimeError);
    });
});

describe('team_error_guidance', ()=>{
    it('TEAM_REQUIRED → multi-team fix + renders teams', ()=>{
        const g = team_error_guidance(403, {code: 'TEAM_REQUIRED', teams: [{teamId: 1, teamName: 'A'}]});
        expect(g).toMatch(/multiple teams/i);
        expect(g).toMatch(/reply team use/);
        expect(g).toContain('1  A');
    });

    it('TEAM_NOT_ACCESSIBLE → lists your teams', ()=>{
        const g = team_error_guidance(403, {code: 'TEAM_NOT_ACCESSIBLE', teams: [{teamId: 2, teamName: 'B'}]});
        expect(g).toMatch(/act in/i);
        expect(g).toContain('2  B');
    });

    it('USER_REQUIRED → acting-user hint', ()=>{
        expect(team_error_guidance(403, {code: 'USER_REQUIRED'})).toMatch(/--user-id|--user-email/);
    });

    it('USER_NOT_FOUND → no-user hint', ()=>{
        expect(team_error_guidance(401, {code: 'USER_NOT_FOUND'})).toMatch(/No Reply user/i);
    });

    it('returns undefined for unrelated bodies', ()=>{
        expect(team_error_guidance(404, {code: 'contact.notFound'})).toBeUndefined();
        expect(team_error_guidance(500, 'oops')).toBeUndefined();
    });
});
