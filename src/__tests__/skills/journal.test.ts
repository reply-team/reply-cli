import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {read_journal, record_pack, forget_pack, journal_entry, type Journal_entry} from '../../skills/journal';
import {skills_file} from '../../config';
import {RuntimeError} from '../../utils/errors';

let dir: string;
const env = ()=>({REPLY_CONFIG_DIR: dir});

const entry = (version = '0.1.0', files: string[] = ['a/SKILL.md']): Journal_entry=>({
    version, ref: 'main', commit: 'abc1234', scope: 'user', files, installed_at: '2026-07-30T00:00:00.000Z',
});

beforeEach(()=>{
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-journal-'));
});
afterEach(()=>{
    fs.rmSync(dir, {recursive: true, force: true});
});

describe('skills journal', ()=>{
    it('reads an empty journal before anything is written', ()=>{
        expect(read_journal(env())).toEqual({version: 1, hosts: {}});
        expect(journal_entry('cursor', 'ai-sdr-core', env())).toBeUndefined();
    });

    it('records and reads back an entry', ()=>{
        record_pack('cursor', 'ai-sdr-core', entry(), env());
        expect(journal_entry('cursor', 'ai-sdr-core', env())).toEqual(entry());
    });

    it('writes the journal next to the other config files', ()=>{
        record_pack('cursor', 'ai-sdr-core', entry(), env());
        expect(fs.existsSync(skills_file(env()))).toBe(true);
        expect(skills_file(env())).toBe(path.join(dir, 'skills.json'));
    });

    it('replaces an entry on re-record instead of duplicating it', ()=>{
        record_pack('cursor', 'ai-sdr-core', entry('0.1.0'), env());
        record_pack('cursor', 'ai-sdr-core', entry('0.2.0'), env());
        expect(journal_entry('cursor', 'ai-sdr-core', env())?.version).toBe('0.2.0');
        expect(Object.keys(read_journal(env()).hosts.cursor)).toEqual(['ai-sdr-core']);
    });

    it('keeps hosts isolated', ()=>{
        record_pack('cursor', 'ai-sdr-core', entry(), env());
        record_pack('gemini-cli', 'ai-sdr-core', entry('0.9.0'), env());
        expect(journal_entry('cursor', 'ai-sdr-core', env())?.version).toBe('0.1.0');
        expect(journal_entry('gemini-cli', 'ai-sdr-core', env())?.version).toBe('0.9.0');
    });

    it('forget_pack returns the entry it removed and is idempotent', ()=>{
        record_pack('cursor', 'ai-sdr-core', entry(), env());
        expect(forget_pack('cursor', 'ai-sdr-core', env())?.files).toEqual(['a/SKILL.md']);
        expect(forget_pack('cursor', 'ai-sdr-core', env())).toBeUndefined();
    });

    it('drops the host key once its last pack is forgotten', ()=>{
        record_pack('cursor', 'ai-sdr-core', entry(), env());
        forget_pack('cursor', 'ai-sdr-core', env());
        expect(read_journal(env()).hosts.cursor).toBeUndefined();
    });

    it('treats an empty file as an empty journal', ()=>{
        fs.writeFileSync(path.join(dir, 'skills.json'), '');
        expect(read_journal(env())).toEqual({version: 1, hosts: {}});
    });

    it('throws a RuntimeError on a corrupt journal', ()=>{
        fs.writeFileSync(path.join(dir, 'skills.json'), '{ not json');
        expect(()=>read_journal(env())).toThrow(RuntimeError);
    });
});
