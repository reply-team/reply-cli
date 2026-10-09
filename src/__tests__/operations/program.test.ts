import fs from 'fs';
import os from 'os';
import path from 'path';
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mock_fetch, json, answer, capture} from './helpers';

// The whole program, as `reply` runs it: commander parsing, the top-level error handler and the
// exit code. Importing the entry point runs it against process.argv, so each test sets argv,
// imports a fresh copy, and waits for the exit it makes.
const run_program = async(args: string[]): Promise<{code: number; err: string}>=>{
    let exited!: (code: number) => void;
    const exit = new Promise<number>(resolve=>{ exited = resolve; });
    // Only the first exit counts: the stub returns, so the handler runs on past it.
    let first: number | undefined;
    vi.spyOn(process, 'exit').mockImplementation(((code?: number)=>{
        if (first === undefined)
        {
            first = code ?? 0;
            exited(first);
        }
    }) as typeof process.exit);
    process.argv = ['node', 'reply', ...args];
    vi.resetModules();
    let code = -1;
    const {err} = await capture(async()=>{
        await import('../../index');
        code = await exit;
    });
    return {code, err: err.split('\n')[0]};
};

const argv = process.argv;
let dir: string;
beforeEach(()=>{
    mock_fetch.mockReset();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-program-'));
    process.env.REPLY_CONFIG_DIR = dir;
});
afterEach(()=>{
    vi.restoreAllMocks();
    process.argv = argv;
    delete process.env.REPLY_CONFIG_DIR;
    fs.rmSync(dir, {recursive: true, force: true});
});

const lost_connection = ()=>Object.assign(new TypeError('fetch failed'),
    {cause: Object.assign(new Error('ECONNRESET'), {code: 'ECONNRESET'})});

describe('the program', ()=>{
    it('takes global options before the noun, and a write whose answer was lost exits 3 with the envelope on stderr', async()=>{
        mock_fetch.mockRejectedValue(lost_connection());
        const {code, err} = await run_program(['--json', '-q', '-k', 'key-1', '--team-id', '7', 'sequence', 'pause', '123']);
        expect(code).toBe(3);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'outcome.unknown', ids: {sequence_id: 123}}});
        const [url, init] = mock_fetch.mock.calls[0] as [string, RequestInit];
        expect(url).toMatch(/\/v3\/sequences\/123\/pause$/);
        expect(init.headers).toMatchObject({'Authorization': 'Bearer key-1', 'X-TEAM-ID': '7'});
        expect(mock_fetch).toHaveBeenCalledTimes(1);
    });

    it('a definite refusal exits 1 with its code', async()=>{
        answer(json({code: 'sequenceAction.status', detail: 'current status is New'}, 409));
        const {code, err} = await run_program(['--json', '-k', 'key-1', 'sequence', 'pause', '123']);
        expect(code).toBe(1);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'sequence.not_pausable', reply_code: 'sequenceAction.status'}});
    });

    it('a usage error exits 2 before any request', async()=>{
        const {code, err} = await run_program(['--json', '-k', 'key-1', 'sequence', 'stats', '123', '--from', '2026-10-02', '--to', '2026-10-01']);
        expect(code).toBe(2);
        expect(JSON.parse(err)).toMatchObject({error: {code: 'usage.stats'}});
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});
