import {resolve_profile} from './profile';
import {default_credential_store} from './credentials/file-store';
import {refresh_stored} from './auth/oauth-flow';
import type {CredentialStore, Oauth_record} from './credentials/types';

// Per-invocation binding: the resolved profile's backend URLs, the credential
// store key (the PROFILE NAME — so multiple accounts on the same backend stay
// isolated), the store, and a bound token-refresh function.
type Cli_context = {
    profile: string;
    authority: string;
    api_base: string;
    key: string;
    team_id?: number;   // the profile's pinned team, if any (sent as X-TEAM-ID)
    store: CredentialStore;
    refresh: (record: Oauth_record) => Promise<Oauth_record>;
};

const build_context = (opts: {profile?: string} = {}): Cli_context=>{
    const p = resolve_profile(opts.profile);
    const store = default_credential_store();
    const refresh = (record: Oauth_record): Promise<Oauth_record>=>
        refresh_stored({authority: p.authority, record});
    return {
        profile: p.name, authority: p.authority, api_base: p.api_base,
        key: p.name, team_id: p.team_id, store, refresh,
    };
};

export {build_context};
export type {Cli_context};
