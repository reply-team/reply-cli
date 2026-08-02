import {describe, it, expect} from 'vitest';
import path from 'path';
import {how_installed} from '../../selfupdate/detect';

// Absolute paths built for the platform the test is running on: a literal with
// separators would classify differently on Windows than on Linux.
const ROOT = path.parse(process.cwd()).root;
const at = (...parts: string[]): string=>path.join(ROOT, ...parts);
const pkg = (name: string, version = '0.4.0')=>()=>({name, version});

describe('how_installed', ()=>{
    it('calls an install outside the working directory global', ()=>{
        const info = how_installed({
            module_dir: at('usr', 'lib', 'node_modules', 'reply-cli'),
            cwd: at('home', 'artem', 'work'),
            read_package: pkg('reply-cli'),
        });
        expect(info.kind).toBe('npm-global');
        expect(info.channel).toBe('public');
        expect(info.version).toBe('0.4.0');
    });

    it('calls an install under the working directory local', ()=>{
        const cwd = at('home', 'artem', 'app');
        const info = how_installed({
            module_dir: path.join(cwd, 'node_modules', 'reply-cli'),
            cwd,
            read_package: pkg('reply-cli'),
        });
        expect(info.kind).toBe('npm-local');
    });

    it('calls it local when the owning project is an ancestor of the working directory', ()=>{
        // node resolves upward, so a copy in /home/artem/app/node_modules is
        // this project's whether you stand in app or in app/src.
        const project = at('home', 'artem', 'app');
        const info = how_installed({
            module_dir: path.join(project, 'node_modules', 'reply-cli'),
            cwd: path.join(project, 'src', 'deep'),
            read_package: pkg('reply-cli'),
        });
        expect(info.kind).toBe('npm-local');
    });

    it('still calls a version-manager install global from the home directory', ()=>{
        // The regression that matters: ~/.nvm/... is under $HOME, so asking
        // whether the module sits under cwd would call this project-local and
        // refuse to update the one install we can actually drive.
        const home = at('home', 'artem');
        const info = how_installed({
            module_dir: path.join(home, '.nvm', 'versions', 'node', 'v22.17.1', 'lib', 'node_modules', 'reply-cli'),
            cwd: home,
            read_package: pkg('reply-cli'),
        });
        expect(info.kind).toBe('npm-global');
    });

    it('attributes a nested copy to the project that owns the tree', ()=>{
        const project = at('home', 'artem', 'app');
        const info = how_installed({
            module_dir: path.join(project, 'node_modules', 'some-tool', 'node_modules', 'reply-cli'),
            cwd: project,
            read_package: pkg('reply-cli'),
        });
        expect(info.kind).toBe('npm-local');
    });

    it('recognises npx before node_modules, since an npx cache has both', ()=>{
        const info = how_installed({
            module_dir: at('home', 'artem', '.npm', '_npx', 'a1b2', 'node_modules', 'reply-cli'),
            cwd: at('home', 'artem'),
            read_package: pkg('reply-cli'),
        });
        expect(info.kind).toBe('npx');
    });

    it('reads the internal channel off the scoped package name', ()=>{
        const info = how_installed({
            module_dir: at('src', 'reply-cli'),
            cwd: at('src'),
            read_package: pkg('@reply-team/reply-cli', '0.0.0-development'),
        });
        expect(info.kind).toBe('source');
        expect(info.channel).toBe('internal');
        expect(info.version).toBe('0.0.0-development');
    });

    it('refuses to classify a package it does not recognise', ()=>{
        const info = how_installed({
            module_dir: at('usr', 'lib', 'node_modules', 'some-fork'),
            cwd: at('home'),
            read_package: pkg('some-fork-of-reply'),
        });
        expect(info.kind).toBe('unknown');
        expect(info.package_name).toBe('some-fork-of-reply');
    });

    it('survives an unreadable package.json', ()=>{
        const info = how_installed({
            module_dir: at('opt', 'somewhere'),
            cwd: at('opt'),
            read_package: ()=>undefined,
        });
        expect(info).toMatchObject({kind: 'unknown', package_name: '', version: '0.0.0'});
    });

    it('reports the module directory it judged', ()=>{
        const dir = at('usr', 'lib', 'node_modules', 'reply-cli');
        expect(how_installed({module_dir: dir, cwd: at('home'), read_package: pkg('reply-cli')}).module_dir)
            .toBe(dir);
    });

    it('reads this very checkout when given no directory', ()=>{
        const info = how_installed();
        expect(info.package_name).toBe('@reply-team/reply-cli');
        expect(info.module_dir).toBe(path.resolve(__dirname, '..', '..', '..'));
    });
});
