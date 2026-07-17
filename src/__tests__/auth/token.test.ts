import {describe, it, expect} from 'vitest';
import {
    needs_refresh,
    expires_at_from,
    build_token_exchange_body,
    build_refresh_body,
    to_oauth_record,
    DEFAULT_SKEW_MS,
} from '../../auth/token';

const NOW = 1_700_000_000_000;

describe('auth/token', ()=>{
    describe('needs_refresh', ()=>{
        it('is true once the token has expired', ()=>{
            expect(needs_refresh({expires_at: NOW - 1}, NOW)).toBe(true);
        });

        it('is true within the skew window before expiry', ()=>{
            expect(needs_refresh({expires_at: NOW + DEFAULT_SKEW_MS - 1}, NOW)).toBe(true);
        });

        it('is false well before expiry', ()=>{
            expect(needs_refresh({expires_at: NOW + 3_600_000}, NOW)).toBe(false);
        });

        it('honors a custom skew', ()=>{
            expect(needs_refresh({expires_at: NOW + 5_000}, NOW, 10_000)).toBe(true);
            expect(needs_refresh({expires_at: NOW + 5_000}, NOW, 1_000)).toBe(false);
        });
    });

    describe('expires_at_from', ()=>{
        it('adds expires_in seconds to now', ()=>{
            expect(expires_at_from({access_token: 'a', expires_in: 3600}, NOW)).toBe(NOW + 3_600_000);
        });

        it('defaults to one hour when expires_in is absent', ()=>{
            expect(expires_at_from({access_token: 'a'}, NOW)).toBe(NOW + 3_600_000);
        });
    });

    describe('build_token_exchange_body', ()=>{
        it('builds an authorization_code grant with PKCE verifier', ()=>{
            const body = build_token_exchange_body({
                code: 'c', verifier: 'v', redirect_uri: 'http://127.0.0.1:5000/callback', client_id: 'Reply.Cli',
            });
            expect(body.get('grant_type')).toBe('authorization_code');
            expect(body.get('code')).toBe('c');
            expect(body.get('code_verifier')).toBe('v');
            expect(body.get('redirect_uri')).toBe('http://127.0.0.1:5000/callback');
            expect(body.get('client_id')).toBe('Reply.Cli');
        });
    });

    describe('build_refresh_body', ()=>{
        it('builds a refresh_token grant', ()=>{
            const body = build_refresh_body({refresh_token: 'rt', client_id: 'Reply.Cli'});
            expect(body.get('grant_type')).toBe('refresh_token');
            expect(body.get('refresh_token')).toBe('rt');
            expect(body.get('client_id')).toBe('Reply.Cli');
        });
    });

    describe('to_oauth_record', ()=>{
        it('maps a token response into a stored oauth record', ()=>{
            const rec = to_oauth_record({access_token: 'at', refresh_token: 'rt', expires_in: 3600}, NOW);
            expect(rec).toEqual({type: 'oauth', access_token: 'at', refresh_token: 'rt', expires_at: NOW + 3_600_000});
        });

        it('keeps the previous refresh token when the response omits one (no rotation)', ()=>{
            const rec = to_oauth_record({access_token: 'at2', expires_in: 3600}, NOW, {refresh_token: 'old'});
            expect(rec.refresh_token).toBe('old');
        });

        it('prefers a rotated refresh token from the response', ()=>{
            const rec = to_oauth_record({access_token: 'at2', refresh_token: 'new', expires_in: 3600}, NOW, {refresh_token: 'old'});
            expect(rec.refresh_token).toBe('new');
        });

        it('carries the previous principal forward on refresh (token endpoint returns no user)', ()=>{
            const rec = to_oauth_record(
                {access_token: 'at2', expires_in: 3600}, NOW,
                {refresh_token: 'old', user: {id: 1223, username: 'v@r.io', team_id: 1045}});
            expect(rec.user).toEqual({id: 1223, username: 'v@r.io', team_id: 1045});
        });
    });
});
