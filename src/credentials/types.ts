// The authenticated principal, mirroring the v3 /whoami contract
// (WhoamiResponse: UserId, Username, TeamId). Fields are optional so older
// stored records and malformed responses degrade gracefully.
type Principal = {
    id?: number;
    username?: string;
    team_id?: number;
};

type Oauth_record = {
    type: 'oauth';
    access_token: string;
    refresh_token?: string;
    expires_at: number;   // epoch milliseconds
    user?: Principal;
};

type Api_key_record = {
    type: 'api_key';
    key: string;
    user?: Principal;
};

type Credential_record = Oauth_record | Api_key_record;

// Storage abstraction, keyed by profile name (so multiple accounts on the same
// backend stay isolated — the aws model). v1 backend is a 0600 JSON file; the
// deferred OS-keychain backend fits behind this same interface — hence the
// async signatures (keychain access is inherently async).
interface CredentialStore {
    get(key: string): Promise<Credential_record | undefined>;
    set(key: string, record: Credential_record): Promise<void>;
    // With only_if, the record is removed only while only_if holds for it, decided on the same read
    // the removal rewrites.
    remove(key: string, only_if?: (record: Credential_record) => boolean): Promise<boolean>;
    keys(): Promise<string[]>;
    // Runs fn while no other process writes the store; set and remove inside it don't wait again.
    with_lock<T>(fn: () => Promise<T>): Promise<T>;
}

export type {Principal, Oauth_record, Api_key_record, Credential_record, CredentialStore};
