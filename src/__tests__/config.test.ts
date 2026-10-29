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
            expect(user_agent({})).toBe(`${APP_NAME}-cli/${cli_version()}`);
            expect(user_agent({}).startsWith('reply-cli/')).toBe(true);
        });

        it('a well-formed REPLY_CLIENT names the program running the CLI before it, the CLI\'s own token kept last', ()=>{
            const own = `reply-cli/${cli_version()}`;
            for (const client of ['jason-harness/0.22.0', 'a/1', 'x9/1.0.0-rc.1+build.7', `${'a'.repeat(32)}/${'9'.repeat(32)}`, 'my-tool/V2'])
            {
                expect(user_agent({REPLY_CLIENT: client}), client).toBe(`${client} ${own}`);
            }
        });

        it('leaves the User-Agent exactly as it is when REPLY_CLIENT is unset or not one product token and its version', ()=>{
            const own = `reply-cli/${cli_version()}`;
            const malformed = [
                '', ' ', 'jason harness/0.22.0', 'jason-harness/0.22 0', 'jason-harness', 'jason-harness/', '/0.22.0',
                `${'a'.repeat(33)}/1`, `a/${'9'.repeat(33)}`, 'Jason-harness/0.22.0', 'JASON/1', '9jason/1', '-jason/1',
                'jason_harness/1', 'jason/harness/1', 'jason/1 (Windows)', ' jason/1', 'jason/1 ', 'jason/1\n', 'jason/1\r\nX-Evil: 1',
                'jason/1;', 'jasön/1', 'jason/1é',
            ];
            expect(user_agent({}), 'unset').toBe(own);
            for (const client of malformed)
            {
                expect(user_agent({REPLY_CLIENT: client}), JSON.stringify(client)).toBe(own);
            }
        });

        it('reads REPLY_CLIENT from the process environment by default', ()=>{
            const before = process.env.REPLY_CLIENT;
            try {
                process.env.REPLY_CLIENT = 'jason-harness/0.22.0';
                expect(user_agent()).toBe(`jason-harness/0.22.0 reply-cli/${cli_version()}`);
                delete process.env.REPLY_CLIENT;
                expect(user_agent()).toBe(`reply-cli/${cli_version()}`);
            } finally {
                if (before === undefined) { delete process.env.REPLY_CLIENT; } else { process.env.REPLY_CLIENT = before; }
            }
        });
    });
});
