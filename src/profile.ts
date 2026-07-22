import fs from 'fs';
import path from 'path';
import {config_file, get_env, type Env} from './config';
import {UsageError, RuntimeError} from './utils/errors';

// A profile is a named backend bundle. There is NO built-in environment enum:
// the CLI ships only an implicit `default` (prod). Real users typically make
// one profile per account (often the email as the name) — all on prod. A
// profile inherits EVERY field from the embedded default unless it overrides
// it, so an account profile needs no URLs at all.
type Profile = {
    name: string;
    authority: string;   // OAuth authority
    api_base: string;    // Reply v3 API base
    team_id?: number;    // optional team/workspace to pin (sent as X-TEAM-ID)
};

const DEFAULT_NAME = 'default';

// The embedded default profile: prod. Everything inherits from this. The
// api_base is the HOST only — the /v3 version prefix lives in the request path
// (so a raw `api` call's URL matches the docs), not in the profile.
const EMBEDDED = {
    authority: 'https://oauth.reply.io',
    api_base: 'https://api.reply.io',
};
// Back-compat alias for callers/tests referencing the prod target.
const PROD = EMBEDDED;

type Profile_def = {authority?: unknown; api_base?: unknown; team_id?: unknown};
type Config = {profiles?: unknown; current_profile?: unknown};

const strip_trailing_slash = (url: string): string=>url.replace(/\/+$/, '');

// team_id is account-specific and NOT inherited from the embedded default.
// Accept a number, or a numeric string from hand-edited config.
const read_team_id = (v: unknown): number | undefined=>{
    if (typeof v === 'number' && Number.isInteger(v))
    {
        return v;
    }
    if (typeof v === 'string' && /^\d+$/.test(v.trim()))
    {
        return parseInt(v.trim(), 10);
    }
    return undefined;
};

const read_config = (env: Env): Config=>{
    const file = config_file(env);
    let raw: string;
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        {
            return {};
        }
        throw new RuntimeError('Could not read the config file.', {
            code: 'config.read', detail: file, hint: (e as Error).message,
        });
    }
    if (!raw.trim())
    {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new RuntimeError('Config file is corrupt (invalid JSON).', {
            code: 'config.corrupt', detail: file, hint: 'Fix or delete the file.',
        });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    {
        throw new RuntimeError('Config file is corrupt (unexpected shape).', {
            code: 'config.corrupt', detail: file, hint: 'Fix or delete the file.',
        });
    }
    return parsed as Config;
};

const get_profiles = (cfg: Config, env: Env): Record<string, Profile_def>=>{
    const {profiles} = cfg;
    if (profiles === undefined || profiles === null)
    {
        return {};
    }
    if (typeof profiles !== 'object' || Array.isArray(profiles))
    {
        throw new RuntimeError('Config "profiles" must be an object.', {
            code: 'config.corrupt', detail: config_file(env), hint: 'Fix or delete the file.',
        });
    }
    return profiles as Record<string, Profile_def>;
};

const persisted_current = (cfg: Config): string | undefined=>
    typeof cfg.current_profile === 'string' && cfg.current_profile.trim()
        ? cfg.current_profile
        : undefined;

const inherit = (value: unknown, fallback: string): string=>
    typeof value === 'string' && value.trim() ? value : fallback;

// Selection precedence: --profile flag -> REPLY_PROFILE env -> persisted
// current_profile -> built-in default. Each field inherits from the embedded
// default unless the named profile overrides it. An unknown name is a usage
// error (typo-safe) — create profiles with `profile add`.
const resolve_profile = (flag?: string, env: Env = process.env): Profile=>{
    const cfg = read_config(env);
    const profiles = get_profiles(cfg, env);
    const name = flag || get_env('PROFILE', env) || persisted_current(cfg) || DEFAULT_NAME;

    const declared = profiles[name];
    if (!declared && name !== DEFAULT_NAME)
    {
        throw new UsageError(`Unknown profile '${name}'.`, {
            code: 'usage.profile',
            hint: `Create it with \`profile add ${name}\`, or omit --profile for the default.`,
        });
    }
    const over = declared ?? {};
    const team_id = read_team_id(over.team_id);
    return {
        name,
        authority: strip_trailing_slash(inherit(over.authority, EMBEDDED.authority)),
        api_base: strip_trailing_slash(inherit(over.api_base, EMBEDDED.api_base)),
        ...(team_id !== undefined ? {team_id} : {}),
    };
};

const current_profile_name = (env: Env = process.env): string=>
    persisted_current(read_config(env)) || DEFAULT_NAME;

type Profile_description = {
    name: string;
    authority: string;
    api_base: string;
    team_id?: number;
    is_current: boolean;
    inherited: {authority: boolean; api_base: boolean};
};

// Resolved view of a profile for `profile show`: resolved values plus flags for
// which URLs are inherited (not explicitly set) and whether it's current. No
// credentials/secrets — the command layer adds a redacted credential summary.
const describe_profile = (name: string, env: Env = process.env): Profile_description=>{
    const resolved = resolve_profile(name, env);   // throws UsageError if unknown
    const cfg = read_config(env);
    const raw = get_profiles(cfg, env)[name] ?? {};
    const explicit = (v: unknown): boolean=>typeof v === 'string' && v.trim().length > 0;
    return {
        name: resolved.name,
        authority: resolved.authority,
        api_base: resolved.api_base,
        ...(resolved.team_id !== undefined ? {team_id: resolved.team_id} : {}),
        is_current: (persisted_current(cfg) || DEFAULT_NAME) === name,
        inherited: {authority: !explicit(raw.authority), api_base: !explicit(raw.api_base)},
    };
};

const list_profiles = (env: Env = process.env): {current: string; available: string[]}=>{
    const cfg = read_config(env);
    const names = new Set<string>([DEFAULT_NAME, ...Object.keys(get_profiles(cfg, env))]);
    return {current: persisted_current(cfg) || DEFAULT_NAME, available: [...names]};
};

const write_config = (cfg: Record<string, unknown>, env: Env): void=>{
    const file = config_file(env);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
};

type Profile_fields = {authority?: string; api_base?: string; team_id?: number};

type Clearable_field = 'authority' | 'api_base' | 'team_id';
const CLEARABLE_FIELDS: readonly Clearable_field[] = ['authority', 'api_base', 'team_id'];

// Apply the given fields onto a profile def, in place (only fields actually
// provided are written, so merges are non-destructive).
const apply_fields = (def: Profile_def, fields: Profile_fields): void=>{
    if (fields.authority && fields.authority.trim())
    {
        def.authority = fields.authority;
    }
    if (fields.api_base && fields.api_base.trim())
    {
        def.api_base = fields.api_base;
    }
    if (fields.team_id !== undefined)
    {
        def.team_id = fields.team_id;
    }
};

// Create a profile. URLs are optional — anything omitted is inherited from the
// embedded default (prod). team_id is optional and account-specific.
const add_profile = (
    name: string,
    fields: Profile_fields,
    env: Env = process.env,
): void=>{
    if (!name.trim())
    {
        throw new UsageError('A profile name is required.', {code: 'usage.profile'});
    }
    if (name === DEFAULT_NAME)
    {
        throw new UsageError('`default` is the built-in profile and cannot be added.', {
            code: 'usage.profile',
            hint: 'Pick another name, e.g. your account email.',
        });
    }
    const cfg = read_config(env) as Record<string, unknown>;
    const profiles = get_profiles(cfg as Config, env);
    const def: Profile_def = {};
    apply_fields(def, fields);
    profiles[name] = def;
    cfg.profiles = profiles;
    write_config(cfg, env);
};

// Edit an existing profile in place (merge-safe). Unlike add, `default` is
// allowed — it's the natural way for a no-profile user to pin a team without
// creating a named profile. A named profile must already exist.
const set_profile = (
    name: string,
    fields: Profile_fields,
    env: Env = process.env,
): void=>{
    if (!name.trim())
    {
        throw new UsageError('A profile name is required.', {code: 'usage.profile'});
    }
    const cfg = read_config(env) as Record<string, unknown>;
    const profiles = get_profiles(cfg as Config, env);
    if (name !== DEFAULT_NAME && !profiles[name])
    {
        throw new UsageError(`Unknown profile '${name}'.`, {
            code: 'usage.profile',
            hint: `Create it first with \`profile add ${name}\`.`,
        });
    }
    const def: Profile_def = {...(profiles[name] ?? {})};
    apply_fields(def, fields);
    profiles[name] = def;
    cfg.profiles = profiles;
    write_config(cfg, env);
};

// Rename a profile's config entry. Config-only — the credential move is done by
// the command layer (see commands/profile.ts handle_rename), which also guards
// against clobbering a login. `default` is the built-in slot: neither source nor
// target. Validation order matches the spec.
const rename_profile_def = (
    old_name: string,
    new_name: string,
    env: Env = process.env,
): void=>{
    if (old_name === DEFAULT_NAME)
    {
        throw new UsageError('The built-in default profile can\'t be renamed.', {code: 'usage.profile'});
    }
    const cfg = read_config(env) as Record<string, unknown>;
    const profiles = get_profiles(cfg as Config, env);
    if (!profiles[old_name])
    {
        throw new UsageError(`Unknown profile '${old_name}'.`, {
            code: 'usage.profile', hint: 'List profiles with `profile list`.',
        });
    }
    if (!new_name.trim())
    {
        throw new UsageError('A profile name is required.', {code: 'usage.profile'});
    }
    if (new_name === DEFAULT_NAME)
    {
        throw new UsageError('Can\'t rename to the built-in default.', {code: 'usage.profile'});
    }
    if (new_name === old_name)
    {
        throw new UsageError('New name is the same as the old name.', {code: 'usage.profile'});
    }
    if (profiles[new_name])
    {
        throw new UsageError(`Profile '${new_name}' already exists.`, {
            code: 'usage.profile', hint: 'Delete or rename it first, or pick another name.',
        });
    }
    profiles[new_name] = profiles[old_name];
    delete profiles[old_name];
    cfg.profiles = profiles;
    if (persisted_current(cfg as Config) === old_name)
    {
        cfg.current_profile = new_name;
    }
    write_config(cfg, env);
};

// Remove a profile's config entry. Config-only — the credential removal is done
// by the command layer (handle_delete). Returns whether the deleted profile was
// current so the caller can report the reset to default.
const delete_profile_def = (name: string, env: Env = process.env): {was_current: boolean}=>{
    if (name === DEFAULT_NAME)
    {
        throw new UsageError('The built-in default profile can\'t be deleted.', {code: 'usage.profile'});
    }
    const cfg = read_config(env) as Record<string, unknown>;
    const profiles = get_profiles(cfg as Config, env);
    if (!profiles[name])
    {
        throw new UsageError(`Unknown profile '${name}'.`, {
            code: 'usage.profile', hint: 'List profiles with `profile list`.',
        });
    }
    delete profiles[name];
    cfg.profiles = profiles;
    const was_current = persisted_current(cfg as Config) === name;
    if (was_current)
    {
        delete cfg.current_profile;   // revert to the built-in default
    }
    write_config(cfg, env);
    return {was_current};
};

// Clear one config field on a profile, reverting it to inherited (URLs) or unset
// (team_id). `default` is allowed (to clear an override / team pin). Never touches
// the profile name or credentials. Idempotent — a no-op returns {changed:false}.
const unset_profile_field = (
    name: string,
    field: Clearable_field,
    env: Env = process.env,
): {changed: boolean}=>{
    if (!CLEARABLE_FIELDS.includes(field))
    {
        throw new UsageError(`Can't clear '${field}'.`, {
            code: 'usage.profile', hint: `Clearable fields: ${CLEARABLE_FIELDS.join(', ')}.`,
        });
    }
    const cfg = read_config(env) as Record<string, unknown>;
    const profiles = get_profiles(cfg as Config, env);
    if (name !== DEFAULT_NAME && !profiles[name])
    {
        throw new UsageError(`Unknown profile '${name}'.`, {
            code: 'usage.profile', hint: 'List profiles with `profile list`.',
        });
    }
    const def: Profile_def = {...(profiles[name] ?? {})};
    if (!(field in def))
    {
        return {changed: false};
    }
    delete (def as Record<string, unknown>)[field];
    profiles[name] = def;
    cfg.profiles = profiles;
    write_config(cfg, env);
    return {changed: true};
};

// Persist the current profile. Validates the name resolves first (so you can't
// set current to an unknown profile), then writes current_profile.
const set_current_profile = (name: string, env: Env = process.env): void=>{
    resolve_profile(name, env);   // throws UsageError if the name is not valid
    const cfg = read_config(env) as Record<string, unknown>;
    cfg.current_profile = name;
    write_config(cfg, env);
};

export {resolve_profile, current_profile_name, list_profiles, set_current_profile, add_profile, set_profile, rename_profile_def, delete_profile_def, unset_profile_field, describe_profile, EMBEDDED, PROD};
export type {Profile, Profile_fields, Clearable_field, Profile_description};
