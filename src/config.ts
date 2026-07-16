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

export {
    PROGRAM_NAME, APP_NAME,
    env_prefix, env_var, get_env,
    default_config_dir, config_dir, credentials_file, config_file,
};
export type {Env};
