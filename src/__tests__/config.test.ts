import {describe, it, expect} from 'vitest';
import path from 'path';
import {APP_NAME, env_var, default_config_dir, config_dir, cli_version, user_agent} from '../config';

describe('config', ()=>{
    describe('env_var', ()=>{
        it('prefixes with the uppercased APP_NAME', ()=>{
            expect(env_var('API_KEY')).toBe(`${APP_NAME.toUpperCase()}_API_KEY`);
        });

        it('replaces dashes in APP_NAME with underscores', ()=>{
            expect(env_var('ENV', 'my-app')).toBe('MY_APP_ENV');
        });
    });

    describe('default_config_dir', ()=>{
        it('uses XDG_CONFIG_HOME/<app> on linux when set', ()=>{
            const dir = default_config_dir('linux', {XDG_CONFIG_HOME: '/xdg'}, '/home/u');
            expect(dir).toBe(path.join('/xdg', APP_NAME));
        });

        it('falls back to ~/.config/<app> on linux without XDG', ()=>{
            const dir = default_config_dir('linux', {}, '/home/u');
            expect(dir).toBe(path.join('/home/u', '.config', APP_NAME));
        });

        it('ignores a blank XDG_CONFIG_HOME', ()=>{
            const dir = default_config_dir('linux', {XDG_CONFIG_HOME: '   '}, '/home/u');
            expect(dir).toBe(path.join('/home/u', '.config', APP_NAME));
        });

        it('uses APPDATA/<app> on win32 when set', ()=>{
            const dir = default_config_dir('win32', {APPDATA: 'C:\\Users\\u\\AppData\\Roaming'}, 'C:\\Users\\u');
            expect(dir).toBe(path.join('C:\\Users\\u\\AppData\\Roaming', APP_NAME));
        });

        it('falls back to <home>/AppData/Roaming/<app> on win32 without APPDATA', ()=>{
            const dir = default_config_dir('win32', {}, 'C:\\Users\\u');
            expect(dir).toBe(path.join('C:\\Users\\u', 'AppData', 'Roaming', APP_NAME));
        });
    });

    describe('config_dir', ()=>{
        it('honors the <PREFIX>_CONFIG_DIR override', ()=>{
            const override = {[`${APP_NAME.toUpperCase()}_CONFIG_DIR`]: '/custom/dir'};
            expect(config_dir(override)).toBe('/custom/dir');
        });

        it('ignores a blank override and falls through to the default', ()=>{
            const override = {[`${APP_NAME.toUpperCase()}_CONFIG_DIR`]: '  '};
            expect(config_dir(override)).toBe(default_config_dir(process.platform, override, require('os').homedir()));
        });
    });

    describe('cli_version / user_agent', ()=>{
        it('cli_version returns the package.json version', ()=>{
            const pkg = require('../../package.json');
            expect(cli_version()).toBe(pkg.version);
        });

        it('user_agent is <app>-cli/<version> and identifies the CLI', ()=>{
            expect(user_agent()).toBe(`${APP_NAME}-cli/${cli_version()}`);
            expect(user_agent().startsWith('reply-cli/')).toBe(true);
        });
    });
});
