import type {Credential_record, Principal} from '../credentials/types';

type Auth_status = {
    authenticated: boolean;
    profile: string;
    source?: 'flag' | 'env' | 'store';
    method?: 'api_key' | 'oauth';
    user?: Principal;
    expires_at?: string;   // ISO 8601
    expired?: boolean;
};

// Pure, non-destructive view of the current auth state — never triggers a
// refresh or a store write, and never carries a raw secret.
const describe_status = (p: {
    profile: string;
    api_key_flag?: string;
    api_key_env?: string;
    record?: Credential_record;
    now: number;
}): Auth_status=>{
    if (p.api_key_flag)
    {
        return {authenticated: true, profile: p.profile, source: 'flag', method: 'api_key'};
    }
    if (p.api_key_env)
    {
        return {authenticated: true, profile: p.profile, source: 'env', method: 'api_key'};
    }
    if (!p.record)
    {
        return {authenticated: false, profile: p.profile};
    }
    if (p.record.type === 'api_key')
    {
        return {authenticated: true, profile: p.profile, source: 'store', method: 'api_key', user: p.record.user};
    }
    return {
        authenticated: true, profile: p.profile, source: 'store', method: 'oauth',
        user: p.record.user,
        expires_at: new Date(p.record.expires_at).toISOString(),
        expired: p.record.expires_at <= p.now,
    };
};

export {describe_status};
export type {Auth_status};
