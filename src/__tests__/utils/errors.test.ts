import {describe, it, expect} from 'vitest';
import {CliError, UsageError, RuntimeError, Api_error} from '../../utils/errors';

describe('utils/errors', ()=>{
    describe('UsageError', ()=>{
        it('has exit code 2', ()=>{
            expect(new UsageError('bad flag').exit_code).toBe(2);
        });

        it('is a CliError', ()=>{
            expect(new UsageError('x')).toBeInstanceOf(CliError);
        });

        it('to_json wraps message as title with optional code/hint', ()=>{
            const e = new UsageError('Unknown environment', {code: 'usage.env', hint: 'dev|stage|prod'});
            expect(e.to_json()).toEqual({error: {code: 'usage.env', title: 'Unknown environment', hint: 'dev|stage|prod'}});
        });
    });

    describe('RuntimeError', ()=>{
        it('has exit code 1 and is a CliError', ()=>{
            const e = new RuntimeError('disk gone');
            expect(e.exit_code).toBe(1);
            expect(e).toBeInstanceOf(CliError);
        });

        it('to_json carries title, code, detail and hint', ()=>{
            const e = new RuntimeError('Credential store is corrupt', {
                code: 'store.corrupt', detail: '/p/credentials.json', hint: 'delete it and log in again',
            });
            expect(e.to_json()).toEqual({error: {
                code: 'store.corrupt',
                title: 'Credential store is corrupt',
                detail: '/p/credentials.json',
                hint: 'delete it and log in again',
            }});
        });
    });

    describe('Api_error', ()=>{
        it('has exit code 1 and carries the HTTP status', ()=>{
            const e = new Api_error(401, {title: 'Unauthorized', code: 'auth.invalid'});
            expect(e.exit_code).toBe(1);
            expect(e.status).toBe(401);
        });

        it('to_json includes present fields and drops undefined ones', ()=>{
            const e = new Api_error(404, {title: 'Not found', code: 'x.notFound', detail: 'gone'});
            const json = e.to_json();
            expect(json).toEqual({error: {status: 404, code: 'x.notFound', title: 'Not found', detail: 'gone'}});
            expect(JSON.stringify(json)).not.toContain('hint');
        });

        it('accepts a string body as the detail', ()=>{
            const e = new Api_error(500, 'boom');
            expect(e.detail).toBe('boom');
        });

        it('builds a human-readable message from title/detail', ()=>{
            const e = new Api_error(404, {title: 'Not found', detail: 'gone'});
            expect(e.message).toContain('Not found');
            expect(e.message).toContain('gone');
        });

        it('carries an optional hint into message and json', ()=>{
            const e = new Api_error(401, {title: 'Unauthorized'}, {hint: 'run login'});
            expect(e.hint).toBe('run login');
            expect(e.message).toContain('run login');
            expect(e.to_json().error.hint).toBe('run login');
        });
    });
});
