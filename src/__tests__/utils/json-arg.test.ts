import {describe, it, expect} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {read_json_arg} from '../../utils/json-arg';
import {UsageError} from '../../utils/errors';

const OPTS = {flag: '--contact', what: 'contact', code: 'usage.contact'};

describe('read_json_arg', ()=>{
    it('reads inline JSON', ()=>{
        expect(read_json_arg('{"a":1}', OPTS)).toEqual({a: 1});
    });

    it('reads @file', ()=>{
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-json-'));
        const f = path.join(dir, 'c.json');
        fs.writeFileSync(f, '{"b":2}');
        expect(read_json_arg(`@${f}`, OPTS)).toEqual({b: 2});
        fs.rmSync(dir, {recursive: true, force: true});
    });

    it('reads - from stdin', ()=>{
        expect(read_json_arg('-', {...OPTS, read_stdin: ()=>'{"c":3}'})).toEqual({c: 3});
    });

    it('refuses invalid JSON with the flag named and the given code', ()=>{
        const err = (()=>{
            try { read_json_arg('{bad', OPTS); } catch (e) { return e as UsageError; }
            throw new Error('expected a UsageError');
        })();
        expect(err).toBeInstanceOf(UsageError);
        expect(err.code).toBe('usage.contact');
        expect(err.message).toContain('--contact must be valid JSON');
    });

    it('refuses an empty stdin as invalid JSON', ()=>{
        expect(()=>read_json_arg('-', {...OPTS, read_stdin: ()=>''})).toThrow(UsageError);
    });
});
