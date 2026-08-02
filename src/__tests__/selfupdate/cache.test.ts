import {describe, it, expect} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {update_check_file} from '../../config';
import {
    cache_is_fresh,
    read_check_cache,
    write_check_cache,
    type Check_cache,
} from '../../selfupdate/cache';

// Every test gets its own config dir, so nothing reads or writes the real one.
const sandbox = (): Record<string, string>=>
    ({REPLY_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'reply-update-cache-'))});

const at = (iso: string): Date=>new Date(iso);
const NOW = at('2026-08-01T12:00:00.000Z');
const entry = (over: Partial<Check_cache> = {}): Check_cache=>
    ({version: 1, channel: 'public', latest: '0.5.0', checked_at: NOW.toISOString(), ...over});

describe('the update-check cache', ()=>{
    it('returns what was written', ()=>{
        const env = sandbox();
        write_check_cache(entry(), env);
        expect(read_check_cache(env)).toEqual(entry());
    });

    it('reports nothing when the file has never been written', ()=>{
        expect(read_check_cache(sandbox())).toBeUndefined();
    });

    it('treats a corrupt file as never checked instead of throwing', ()=>{
        const env = sandbox();
        fs.writeFileSync(update_check_file(env), '{ not json', 'utf8');
        expect(read_check_cache(env)).toBeUndefined();
    });

    it('treats an unexpected shape as never checked', ()=>{
        const env = sandbox();
        fs.writeFileSync(update_check_file(env), '[]', 'utf8');
        expect(read_check_cache(env)).toBeUndefined();
    });

    it('leaves no temporary file behind', ()=>{
        const env = sandbox();
        write_check_cache(entry(), env);
        const left = fs.readdirSync(env.REPLY_CONFIG_DIR);
        expect(left).toEqual(['update-check.json']);
    });

    it('creates the config directory when it does not exist yet', ()=>{
        const env = {REPLY_CONFIG_DIR: path.join(os.tmpdir(), `reply-cache-new-${process.pid}-${Math.trunc(NOW.getTime())}`)};
        fs.rmSync(env.REPLY_CONFIG_DIR, {recursive: true, force: true});
        write_check_cache(entry(), env);
        expect(read_check_cache(env)?.latest).toBe('0.5.0');
        fs.rmSync(env.REPLY_CONFIG_DIR, {recursive: true, force: true});
    });
});

describe('cache_is_fresh', ()=>{
    it('is fresh inside the success window and stale past it', ()=>{
        expect(cache_is_fresh(entry(), 'public', at('2026-08-02T11:00:00.000Z'))).toBe(true);
        expect(cache_is_fresh(entry(), 'public', at('2026-08-02T13:00:00.000Z'))).toBe(false);
    });

    it('backs off for an hour after a failure, not a day', ()=>{
        const failed = entry({checked_at: undefined, failed_at: NOW.toISOString()});
        expect(cache_is_fresh(failed, 'public', at('2026-08-01T12:30:00.000Z'))).toBe(true);
        expect(cache_is_fresh(failed, 'public', at('2026-08-01T14:00:00.000Z'))).toBe(false);
    });

    it('uses the failure window even when a last known version is kept', ()=>{
        const failed = entry({failed_at: NOW.toISOString()});
        expect(cache_is_fresh(failed, 'public', at('2026-08-01T14:00:00.000Z'))).toBe(false);
    });

    it('is stale when the cached channel is not the one being asked about', ()=>{
        expect(cache_is_fresh(entry(), 'internal', NOW)).toBe(false);
    });

    it('is stale with no entry, no timestamp, or an unparseable one', ()=>{
        expect(cache_is_fresh(undefined, 'public', NOW)).toBe(false);
        expect(cache_is_fresh(entry({checked_at: undefined}), 'public', NOW)).toBe(false);
        expect(cache_is_fresh(entry({checked_at: 'yesterday'}), 'public', NOW)).toBe(false);
    });
});
