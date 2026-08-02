import {describe, it, expect} from 'vitest';
import {run_npm_install, TAIL_BYTES} from '../../selfupdate/npm';
import type {Npm_result, Npm_runner} from '../../selfupdate/npm';
import {UsageError} from '../../utils/errors';

const runner = (result: Partial<Npm_result>, seen?: string[][]): Npm_runner=>async args=>{
    seen?.push(args);
    return {code: 0, stdout: '', stderr: '', ...result};
};

describe('run_npm_install', ()=>{
    it('installs the latest of the given package globally', async()=>{
        const seen: string[][] = [];
        const outcome = await run_npm_install('reply-cli', {run: runner({stdout: 'added 1 package'}, seen)});
        expect(seen).toEqual([['install', '-g', 'reply-cli@latest']]);
        expect(outcome.ok).toBe(true);
        expect(outcome.code).toBe(0);
    });

    it('quotes nothing and passes the scoped name through as one argument', async()=>{
        const seen: string[][] = [];
        await run_npm_install('@reply-team/reply-cli', {run: runner({}, seen)});
        expect(seen[0][2]).toBe('@reply-team/reply-cli@latest');
    });

    it('refuses to run npm for a package we do not publish', async()=>{
        await expect(run_npm_install('evil-package', {run: runner({})})).rejects.toThrow(UsageError);
        await expect(run_npm_install('', {run: runner({})})).rejects.toMatchObject({exit_code: 2});
    });

    it('reports a non-zero exit as a failure and keeps the output', async()=>{
        const outcome = await run_npm_install('reply-cli', {
            run: runner({code: 1, stderr: 'npm error code E404'}),
        });
        expect(outcome.ok).toBe(false);
        expect(outcome.output_tail).toContain('E404');
    });

    it('recognises a permission failure, which needs a different command', async()=>{
        const outcome = await run_npm_install('reply-cli', {
            run: runner({code: 243, stderr: 'npm error code EACCES\nnpm error syscall mkdir'}),
        });
        expect(outcome.permission_denied).toBe(true);
        expect(outcome.npm_missing).toBe(false);
    });

    it('recognises npm not being on PATH', async()=>{
        const outcome = await run_npm_install('reply-cli', {
            run: runner({code: 1, stderr: 'spawn npm ENOENT'}),
        });
        expect(outcome.npm_missing).toBe(true);
    });

    it('keeps only the tail of a very long log', async()=>{
        const outcome = await run_npm_install('reply-cli', {
            run: runner({code: 1, stdout: 'x'.repeat(TAIL_BYTES * 2), stderr: 'EACCES'}),
        });
        expect(outcome.output_tail.length).toBe(TAIL_BYTES);
        expect(outcome.output_tail.endsWith('EACCES')).toBe(true);
    });
});
