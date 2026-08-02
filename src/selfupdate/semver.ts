import {RuntimeError} from '../utils/errors';

// Just enough semver to answer "is the published version newer than mine".
// A dependency for three comparisons would be the first runtime dependency
// added to this CLI since it shipped.

type Version = {major: number; minor: number; patch: number; pre: string[]};

const PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

// Accepts a leading `v` because release tags carry one, and drops build
// metadata, which semver excludes from precedence.
const parse_version = (raw: string): Version | undefined=>{
    const m = PATTERN.exec(String(raw).trim());
    if (!m)
    {
        return undefined;
    }
    return {
        major: Number(m[1]),
        minor: Number(m[2]),
        patch: Number(m[3]),
        pre: m[4] ? m[4].split('.') : [],
    };
};

const sign = (n: number): number=>(n === 0 ? 0 : n < 0 ? -1 : 1);

// Semver precedence for pre-release identifiers: a release outranks its own
// pre-releases, numeric identifiers compare numerically and rank below
// alphanumeric ones, and when everything else ties the longer list wins.
const compare_pre = (a: string[], b: string[]): number=>{
    if (!a.length || !b.length)
    {
        return a.length === b.length ? 0 : (a.length ? -1 : 1);
    }
    for (let i = 0; i < Math.max(a.length, b.length); i++)
    {
        const x = a[i];
        const y = b[i];
        if (x === undefined)
        {
            return -1;
        }
        if (y === undefined)
        {
            return 1;
        }
        const x_numeric = /^\d+$/.test(x);
        const y_numeric = /^\d+$/.test(y);
        if (x_numeric && y_numeric)
        {
            const d = sign(Number(x) - Number(y));
            if (d)
            {
                return d;
            }
            continue;
        }
        if (x_numeric !== y_numeric)
        {
            return x_numeric ? -1 : 1;
        }
        if (x !== y)
        {
            return x < y ? -1 : 1;
        }
    }
    return 0;
};

const compare_versions = (a: string, b: string): number=>{
    const left = parse_version(a);
    const right = parse_version(b);
    if (!left || !right)
    {
        throw new RuntimeError('Could not compare version strings.', {
            code: 'update.bad_version',
            detail: !left ? a : b,
        });
    }
    return sign(left.major - right.major)
        || sign(left.minor - right.minor)
        || sign(left.patch - right.patch)
        || compare_pre(left.pre, right.pre);
};

// Fails closed: an unparseable version on either side means we say nothing,
// rather than pushing a user toward something we cannot reason about.
const is_newer = (candidate: string, current: string): boolean=>{
    if (!parse_version(candidate) || !parse_version(current))
    {
        return false;
    }
    return compare_versions(candidate, current) > 0;
};

export {parse_version, compare_versions, is_newer};
export type {Version};
