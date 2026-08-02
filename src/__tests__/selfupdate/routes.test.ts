import {describe, it, expect} from 'vitest';
import path from 'path';
import {REGISTRY_LINE, route_for} from '../../selfupdate/routes';
import type {Install_info, Install_kind} from '../../selfupdate/types';

const DIR = path.join(path.parse(process.cwd()).root, 'usr', 'lib', 'node_modules', 'reply-cli');

const install = (over: Partial<Install_info> = {}): Install_info=>({
    kind: 'npm-global',
    channel: 'public',
    package_name: 'reply-cli',
    version: '0.4.0',
    module_dir: DIR,
    ...over,
});

describe('route_for', ()=>{
    it('drives only a global npm install', ()=>{
        const route = route_for(install());
        expect(route.drivable).toBe(true);
        expect(route.command).toBe('npm install -g reply-cli@latest');
    });

    it('names the scoped package on the internal channel', ()=>{
        const route = route_for(install({channel: 'internal', package_name: '@reply-team/reply-cli'}));
        expect(route.command).toBe('npm install -g @reply-team/reply-cli@latest');
        expect(route.note).toContain(REGISTRY_LINE);
        expect(route.note).toContain('read:packages');
    });

    it('leaves a project-local copy to its project', ()=>{
        const route = route_for(install({kind: 'npm-local'}));
        expect(route.drivable).toBe(false);
        expect(route.command).toBe('npm install reply-cli@latest');
        expect(route.note).toContain(DIR);
    });

    it('explains that npx has nothing installed to update', ()=>{
        const route = route_for(install({kind: 'npx'}));
        expect(route.drivable).toBe(false);
        expect(route.command).toBe('npx reply-cli@latest');
        expect(route.note).toMatch(/newest published version on each run/);
    });

    it('sends a source checkout to git', ()=>{
        const route = route_for(install({kind: 'source', channel: 'internal', package_name: '@reply-team/reply-cli'}));
        expect(route.drivable).toBe(false);
        expect(route.command).toBe('git pull && npm ci && npm run build');
    });

    it('falls back to the public package when the name is unknown', ()=>{
        const route = route_for(install({kind: 'unknown', package_name: ''}));
        expect(route.drivable).toBe(false);
        expect(route.command).toBe('npm install -g reply-cli@latest');
        expect(route.note).toContain(DIR);
    });

    it('gives every kind a command and a note', ()=>{
        const kinds: Install_kind[] = ['npm-global', 'npm-local', 'npx', 'source', 'unknown'];
        for (const kind of kinds)
        {
            const route = route_for(install({kind}));
            expect(route.command, kind).toBeTruthy();
            expect(route.note, kind).toBeTruthy();
        }
    });
});
