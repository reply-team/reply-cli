import path from 'path';
import {cli_version} from '../config';
import {UsageError} from '../utils/errors';
import type {Operation, Pack} from './types';

// The one pack this CLI ships: Reply's own skills, carried in the package
// beside dist/ and installed at the CLI's own version, so a skill that
// describes a release's commands is released with them.
const PACK_NAME = 'reply-adapter';

const ALIASES: Record<string, string> = {
    adapter: PACK_NAME,
};

// Packs an earlier version of this CLI installed and this one no longer
// offers, under every name it accepted for them. `list` and `remove` still
// reach what was installed under them; `install` and `update` refuse them.
const RETIRED: Record<string, string> = {
    'core': 'ai-sdr-core',
    'ai-sdr-core': 'ai-sdr-core',
    'runtime': 'agentic-runtime',
    'agentic-runtime': 'agentic-runtime',
};
const RETIRED_PACKS = ['ai-sdr-core', 'agentic-runtime'];

// A name's own entry only: a plain object also answers `constructor`,
// `toString` and `__proto__` from its prototype.
const own = (table: Record<string, string>, key: string): string | undefined=>
    Object.hasOwn(table, key) ? table[key] : undefined;

// The plugin marketplace an earlier version registered in Claude Code and
// Codex. Its plugins are named `<pack>@<marketplace>`; this CLI only finds
// and removes them, and never registers the marketplace again.
const OLD_MARKETPLACE = 'reply-skills';

const MOVED = 'The SDR expertise and the runtime skills ship with Jason (github.com/reply-team/jason-ai)'
    + ' and are not installed by this CLI.';

// The pack's directory in the installed package. This module sits one level
// under the package root in both layouts — src/skills from a checkout,
// dist/skills once built — so the same relative path finds it from either.
const pack_dir = (from: string = __dirname): string=>
    path.join(from, '..', '..', 'skills', PACK_NAME);

const plugin_id = (pack: string): string=>`${pack}@${OLD_MARKETPLACE}`;

const the_pack = (): Pack=>({name: PACK_NAME, version: cli_version()});

// Requested names (aliases allowed) → the packs to act on. With no name,
// `install` and `update` mean the one pack, and `list` and `remove` mean
// everything this CLI ever installed, retired packs included.
const resolve_packs = (requested: string[], operation: Operation): Pack[]=>{
    const reaches_retired = operation === 'list' || operation === 'remove';
    if (!requested.length)
    {
        return reaches_retired
            ? [the_pack(), ...RETIRED_PACKS.map(name=>({name, version: '', retired: true}))]
            : [the_pack()];
    }
    const wanted: Pack[] = [];
    for (const raw of requested)
    {
        const retired = own(RETIRED, raw);
        if (retired !== undefined && !reaches_retired)
        {
            throw new UsageError(MOVED, {code: 'usage.skills_pack_moved'});
        }
        const name = retired ?? own(ALIASES, raw) ?? raw;
        if (name !== PACK_NAME && retired === undefined)
        {
            throw new UsageError(`Unknown skills pack '${raw}'.`, {
                code: 'usage.skills_pack',
                hint: `The pack is ${PACK_NAME} (alias: ${Object.keys(ALIASES).join(', ')})`,
            });
        }
        if (!wanted.some(p=>p.name === name))
        {
            wanted.push(retired === undefined ? the_pack() : {name, version: '', retired: true});
        }
    }
    return wanted;
};

export {
    PACK_NAME, ALIASES, RETIRED, RETIRED_PACKS, OLD_MARKETPLACE, MOVED,
    pack_dir, plugin_id, the_pack, resolve_packs,
};
