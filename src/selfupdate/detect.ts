import fs from 'fs';
import path from 'path';
import type {Channel, Install_info, Install_kind} from './types';

// Which package this build is published as. The public one is unscoped on
// npmjs; the internal one lives on GitHub Packages and needs a token.
const PUBLIC_PACKAGE = 'reply-cli';
const INTERNAL_PACKAGE = '@reply-team/reply-cli';

type Package_json = {name?: string; version?: string};

type Detect_deps = {
    module_dir?: string;
    cwd?: string;
    read_package?: (dir: string)=>Package_json | undefined;
};

const read_package_json = (dir: string): Package_json | undefined=>{
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as Package_json;
    } catch {
        // Missing or malformed: the caller treats an unnamed package as an
        // install layout we do not recognise, which is the safe answer.
        return undefined;
    }
};

// The directory holding dist/, resolved through symlinks: an npm global bin
// entry is a link, and the link's own path says nothing about the install.
// From dist/selfupdate/detect.js the package root is two levels up.
const default_module_dir = (): string=>{
    const dir = path.join(__dirname, '..', '..');
    try {
        return fs.realpathSync(dir);
    } catch {
        return dir;
    }
};

// Case sensitivity follows the platform, which is what path.relative already
// does — the same reason the skills journal compares paths this way.
const inside = (parent: string, child: string): boolean=>{
    const rel = path.relative(parent, child);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// The directory whose node_modules holds this package — its first one, so a
// transitive copy under a nested node_modules is still attributed to the
// project that owns the tree.
const owning_project = (module_dir: string, first_node_modules: number): string=>{
    const depth = module_dir.split(/[\\/]+/).length - first_node_modules;
    return path.resolve(module_dir, ...Array<string>(depth).fill('..'));
};

const classify = (module_dir: string, cwd: string): Install_kind=>{
    const parts = module_dir.split(/[\\/]+/);
    // Checked before node_modules on purpose: an npx cache contains both.
    if (parts.includes('_npx'))
    {
        return 'npx';
    }
    const at = parts.indexOf('node_modules');
    if (at === -1)
    {
        return 'source';
    }
    // Local means node resolves it by walking up from the working directory,
    // so the owning project must BE the working directory or an ancestor of
    // it. Asking only whether module_dir sits under cwd gets this backwards
    // for a version-manager install — ~/.nvm/.../node_modules is under $HOME,
    // and a user standing in $HOME would see their global install called
    // project-local, with the update refused for a project that isn't there.
    const project = owning_project(module_dir, at);
    return project === cwd || inside(project, cwd) ? 'npm-local' : 'npm-global';
};

const how_installed = (deps: Detect_deps = {}): Install_info=>{
    const module_dir = deps.module_dir ?? default_module_dir();
    const cwd = deps.cwd ?? process.cwd();
    const pkg = (deps.read_package ?? read_package_json)(module_dir);
    const package_name = typeof pkg?.name === 'string' ? pkg.name : '';
    const version = typeof pkg?.version === 'string' && pkg.version ? pkg.version : '0.0.0';
    // An unrecognised package name outranks whatever the path suggests: a fork
    // or a vendored copy is not something we should offer to replace.
    const known = package_name === PUBLIC_PACKAGE || package_name === INTERNAL_PACKAGE;
    const channel: Channel = package_name === INTERNAL_PACKAGE ? 'internal' : 'public';
    return {
        kind: known ? classify(module_dir, cwd) : 'unknown',
        channel,
        package_name,
        version,
        module_dir,
    };
};

export {how_installed, PUBLIC_PACKAGE, INTERNAL_PACKAGE};
export type {Detect_deps, Package_json};
