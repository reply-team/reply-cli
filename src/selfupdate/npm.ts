import {execFile} from 'child_process';
import {INTERNAL_PACKAGE, PUBLIC_PACKAGE} from './detect';
import {UsageError} from '../utils/errors';

// Runs npm on the user's behalf so they never have to recall the command.
// Only ever invoked for a global npm install of a package we publish — see
// route_for() — which is also why passing the argument vector through a shell
// on Windows is safe: nothing here comes from user input.

type Npm_result = {code: number; stdout: string; stderr: string};

// The single seam that keeps every test in this suite from spawning npm.
type Npm_runner = (args: string[])=>Promise<Npm_result>;

type Npm_outcome = {
    ok: boolean;
    code: number;
    // Last 8 KB of npm's combined output — enough to classify the failure and
    // to show the user why it failed, without holding a whole install log.
    output_tail: string;
    permission_denied: boolean;
    npm_missing: boolean;
};

const TAIL_BYTES = 8000;

// npm is a .cmd on Windows, which Node refuses to spawn directly since the
// CVE-2024-27980 fix — hence the shell there, and only there.
const default_npm_runner: Npm_runner = args=>new Promise<Npm_result>(resolve=>{
    execFile('npm', args, {
        encoding: 'utf8',
        windowsHide: true,
        shell: process.platform === 'win32',
        maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr)=>{
        const code = error && typeof (error as {code?: unknown}).code === 'number'
            ? (error as unknown as {code: number}).code
            : (error ? 1 : 0);
        const message = error ? `${error.message}\n` : '';
        resolve({code, stdout: stdout ?? '', stderr: `${message}${stderr ?? ''}`});
    });
});

const tail_of = (result: Npm_result): string=>
    `${result.stdout}\n${result.stderr}`.trim().slice(-TAIL_BYTES);

const run_npm_install = async(
    package_name: string,
    deps: {run?: Npm_runner} = {},
): Promise<Npm_outcome>=>{
    if (package_name !== PUBLIC_PACKAGE && package_name !== INTERNAL_PACKAGE)
    {
        // Refusing here rather than in the caller keeps the guarantee local to
        // the one function that can spawn a process.
        throw new UsageError(`Refusing to run npm for an unrecognised package: ${package_name || '(none)'}`, {
            code: 'update.unknown_package',
        });
    }
    const run = deps.run ?? default_npm_runner;
    const result = await run(['install', '-g', `${package_name}@latest`]);
    const output_tail = tail_of(result);
    return {
        ok: result.code === 0,
        code: result.code,
        output_tail,
        permission_denied: /EACCES|EPERM|permission denied/i.test(output_tail),
        npm_missing: /ENOENT|not recognized as an internal|command not found/i.test(output_tail),
    };
};

export {run_npm_install, default_npm_runner, TAIL_BYTES};
export type {Npm_runner, Npm_result, Npm_outcome};
