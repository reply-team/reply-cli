import type {Oauth_record} from '../credentials/types';

// Refresh this many ms before the real expiry, so a token isn't sent right
// as it lapses mid-flight.
const DEFAULT_SKEW_MS = 60_000;

const DEFAULT_EXPIRES_IN_S = 3600;

type Token_response = {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;   // seconds
    token_type?: string;
    id_token?: string;
};

const needs_refresh = (
    record: {expires_at: number},
    now: number,
    skew_ms: number = DEFAULT_SKEW_MS,
): boolean=>record.expires_at - skew_ms <= now;

const expires_at_from = (resp: Token_response, now: number): number=>
    now + (resp.expires_in ?? DEFAULT_EXPIRES_IN_S) * 1000;

const build_token_exchange_body = (p: {
    code: string;
    verifier: string;
    redirect_uri: string;
    client_id: string;
}): URLSearchParams=>new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: p.redirect_uri,
    client_id: p.client_id,
    code_verifier: p.verifier,
});

const build_refresh_body = (p: {
    refresh_token: string;
    client_id: string;
}): URLSearchParams=>new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: p.refresh_token,
    client_id: p.client_id,
});

// A token endpoint may rotate the refresh token or omit it; when omitted, keep
// the previous one so subsequent refreshes still work.
const to_oauth_record = (
    resp: Token_response,
    now: number,
    prev?: {refresh_token?: string},
): Oauth_record=>({
    type: 'oauth',
    access_token: resp.access_token,
    refresh_token: resp.refresh_token ?? prev?.refresh_token,
    expires_at: expires_at_from(resp, now),
});

export {
    DEFAULT_SKEW_MS,
    needs_refresh,
    expires_at_from,
    build_token_exchange_body,
    build_refresh_body,
    to_oauth_record,
};
export type {Token_response};
