import {PROGRAM_NAME} from '../config';
import {PUBLIC_PACKAGE} from './detect';
import type {Install_info, Install_kind, Route} from './types';

// What `reply install` may do about each kind of install, and what it tells the
// user when the answer is "nothing". Only a global npm install is ours to
// drive; everything else belongs to a project, a cache, or a checkout, and
// touching it would be the corruption this command exists to avoid.

// The internal package is not on npmjs, and this line is the piece people miss.
const REGISTRY_LINE = '@reply-team:registry=https://npm.pkg.github.com';

const internal_hint = (): string=>
    `The internal package needs "${REGISTRY_LINE}" in your .npmrc and a token with read:packages.`;

const route_for = (install: Install_info): Route=>{
    // An unrecognised copy still gets a useful command: the public package is
    // what a stranger to this layout most likely wants.
    const pkg = install.package_name || PUBLIC_PACKAGE;
    const suffix = install.channel === 'internal' ? ` ${internal_hint()}` : '';
    const routes: Record<Install_kind, Route> = {
        'npm-global': {
            drivable: true,
            command: `npm install -g ${pkg}@latest`,
            note: `Installed globally with npm (${install.module_dir}).${suffix}`,
        },
        'npm-local': {
            drivable: false,
            command: `npm install ${pkg}@latest`,
            note: `Installed inside a project (${install.module_dir}), so it is that project's to update.`
                + ` Run the command there.${suffix}`,
        },
        npx: {
            drivable: false,
            command: `npx ${pkg}@latest`,
            note: 'Running through npx, which resolves the newest published version on each run —'
                + ' there is no installed copy to update.',
        },
        source: {
            drivable: false,
            command: 'git pull && npm ci && npm run build',
            note: `Running from a source checkout (${install.module_dir}).`,
        },
        unknown: {
            drivable: false,
            command: `npm install -g ${pkg}@latest`,
            note: `Could not tell how this copy was installed (${install.module_dir}),`
                + ` so ${PROGRAM_NAME} will not change it.${suffix}`,
        },
    };
    return routes[install.kind];
};

export {route_for, REGISTRY_LINE};
