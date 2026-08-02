import fs from 'fs';
import os from 'os';
import path from 'path';

// Single identity. The bin name, config dir, and env-var prefix all derive
// from APP_NAME. There is one build (`reply`); channels are handled by the
// registry/dist-tags, not by a second identity.
const APP_NAME = 'reply';
const PROGRAM_NAME = APP_NAME;

type Env = Record<string, string | undefined>;

const env_prefix = (app: string = APP_NAME): string=>
    app.toUpperCase().replace(/-/g, '_');

// Build a full env var name, e.g. env_var('API_KEY') -> 'REPLY_API_KEY'.
const env_var = (suffix: string, app: string = APP_NAME): string=>
    `${env_prefix(app)}_${suffix}`;

const get_env = (suffix: string, env: Env = process.env): string | undefined=>
    env[env_var(suffix)];

let cached_version: string | undefined;

// The CLI version, read once from package.json (same file for src and dist —
// ../package.json resolves to the repo root either way). Falls back to '0.0.0'
// if the file is missing or malformed.
const cli_version = (): string=>{
    if (cached_version !== undefined)
    {
        return cached_version;
    }
    let version = '0.0.0';
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
        if (typeof pkg.version === 'string' && pkg.version)
        {
            version = pkg.version;
        }
    } catch {
        // Unreadable/malformed package.json — keep the '0.0.0' fallback.
    }
    cached_version = version;
    return version;
};

// Identifies CLI requests for telemetry (not security). Product token derives
// from APP_NAME to keep the single build identity, e.g. 'reply-cli/0.1.0'.
const user_agent = (): string=>`${APP_NAME}-cli/${cli_version()}`;

// Default per-user config dir, mirroring gh/aws/az conventions.
//   linux/mac: $XDG_CONFIG_HOME/<app>  (fallback ~/.config/<app>)
//   windows:   %APPDATA%\<app>          (fallback <home>\AppData\Roaming\<app>)
const default_config_dir = (
    platform: NodeJS.Platform,
    env: Env,
    homedir: string,
): string=>{
    if (platform === 'win32')
    {
        const appdata = env.APPDATA && env.APPDATA.trim()
            ? env.APPDATA
            : path.join(homedir, 'AppData', 'Roaming');
        return path.join(appdata, APP_NAME);
    }
    const xdg = env.XDG_CONFIG_HOME;
    const base = xdg && xdg.trim() ? xdg : path.join(homedir, '.config');
    return path.join(base, APP_NAME);
};

// The active config dir. A <PREFIX>_CONFIG_DIR override wins outright.
const config_dir = (env: Env = process.env): string=>{
    const override = get_env('CONFIG_DIR', env);
    if (override && override.trim())
    {
        return override;
    }
    return default_config_dir(process.platform, env, os.homedir());
};

// Stored credentials, keyed by profile name (see credentials/file-store.ts).
const credentials_file = (env: Env = process.env): string=>
    path.join(config_dir(env), 'credentials.json');

// User profile definitions live here (see profile.ts).
const config_file = (env: Env = process.env): string=>
    path.join(config_dir(env), 'config.json');

// What the installer wrote into flat-directory hosts (see skills/journal.ts).
const skills_file = (env: Env = process.env): string=>
    path.join(config_dir(env), 'skills.json');

// When we last asked whether a newer release exists (see selfupdate/cache.ts).
const update_check_file = (env: Env = process.env): string=>
    path.join(config_dir(env), 'update-check.json');

export {
    PROGRAM_NAME, APP_NAME,
    env_prefix, env_var, get_env, cli_version, user_agent,
    default_config_dir, config_dir, credentials_file, config_file, skills_file,
    update_check_file,
};
export type {Env};
