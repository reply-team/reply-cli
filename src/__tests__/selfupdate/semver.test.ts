import {describe, it, expect} from 'vitest';
import {compare_versions, is_newer, parse_version} from '../../selfupdate/semver';
import {RuntimeError} from '../../utils/errors';

describe('parse_version', ()=>{
    it('accepts a leading v, as release tags carry one', ()=>{
        expect(parse_version('v0.4.0')).toEqual({major: 0, minor: 4, patch: 0, pre: []});
    });

    it('splits a pre-release into identifiers', ()=>{
        expect(parse_version('1.2.3-rc.2')?.pre).toEqual(['rc', '2']);
    });

    it('ignores build metadata, which semver excludes from precedence', ()=>{
        expect(parse_version('1.2.3+build.7')?.pre).toEqual([]);
    });

    it('returns undefined for anything that is not a version', ()=>{
        expect(parse_version('latest')).toBeUndefined();
        expect(parse_version('1.2')).toBeUndefined();
        expect(parse_version('')).toBeUndefined();
    });
});

describe('compare_versions', ()=>{
    it.each([
        ['0.4.0', '0.5.0', -1],
        ['0.5.0', '0.4.0', 1],
        ['0.4.0', 'v0.4.0', 0],
        ['1.0.0', '0.9.9', 1],
        ['1.1.0', '1.0.9', 1],
        ['1.0.0-rc.1', '1.0.0', -1],
        ['1.0.0-rc.2', '1.0.0-rc.10', -1],
        ['1.0.0-alpha', '1.0.0-beta', -1],
        ['1.0.0-rc.1', '1.0.0-rc.1.1', -1],
        ['1.0.0-1', '1.0.0-alpha', -1],
    ])('%s vs %s -> %i', (a, b, expected)=>{
        expect(compare_versions(a as string, b as string)).toBe(expected);
    });

    it('refuses to compare something that is not a version', ()=>{
        expect(()=>compare_versions('0.4.0', 'nightly')).toThrow(RuntimeError);
    });
});

describe('is_newer', ()=>{
    it('treats a development build as older than any release', ()=>{
        expect(is_newer('0.5.0', '0.0.0-development')).toBe(true);
    });

    it('never claims an update when the installed copy is ahead', ()=>{
        expect(is_newer('0.4.0', '0.5.0')).toBe(false);
        expect(is_newer('0.5.0', '0.5.0')).toBe(false);
    });

    it('fails closed when either side is unparseable', ()=>{
        expect(is_newer('0.5.0', 'unknown')).toBe(false);
        expect(is_newer('main', '0.4.0')).toBe(false);
    });
});
