import {describe, it, expect, vi, afterEach} from 'vitest';
import {set_quiet, info, success, warn} from '../utils/output';

describe('output quiet mode', ()=>{
    afterEach(()=>{
        set_quiet(false);
        vi.restoreAllMocks();
    });

    it('suppresses info and success on stderr when quiet', ()=>{
        const spy = vi.spyOn(console, 'error').mockImplementation(()=>{});
        set_quiet(true);
        info('resolving profile');
        success('logged in');
        expect(spy).not.toHaveBeenCalled();
    });

    it('still emits warnings when quiet (they are not progress noise)', ()=>{
        const spy = vi.spyOn(console, 'error').mockImplementation(()=>{});
        set_quiet(true);
        warn('token expires soon');
        expect(spy).toHaveBeenCalledOnce();
    });

    it('emits info and success normally when not quiet', ()=>{
        const spy = vi.spyOn(console, 'error').mockImplementation(()=>{});
        set_quiet(false);
        info('resolving profile');
        success('logged in');
        expect(spy).toHaveBeenCalledTimes(2);
    });
});
