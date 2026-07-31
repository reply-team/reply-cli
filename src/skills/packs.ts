import {UsageError, RuntimeError} from '../utils/errors';
import type {Pack, Pack_registry} from './types';

// Identity of the knowledge repository. packs.json in that repo is the
// host-neutral source of truth for pack identity and the dependency graph;
// PACKS_FALLBACK is a build-time copy so `install` still works offline.
const REPO = 'reply-team/reply-skills';
const MARKETPLACE = 'reply-skills';
const DEFAULT_REF = 'main';

const ALIASES: Record<string, string> = {
    core: 'ai-sdr-core',
    adapter: 'reply-adapter',
    runtime: 'agentic-runtime',
};

const PACKS_FALLBACK: Pack_registry = {
    marketplace: MARKETPLACE,
    packs: [
        {
            name: 'ai-sdr-core',
            display_name: 'AI SDR Core',
            version: '0.1.0',
            description: 'Vendor-neutral AI SDR expertise: the operation contract, playbooks and guardrails.',
            dependencies: [],
        },
        {
            name: 'reply-adapter',
            display_name: 'Reply.io Adapter',
            version: '0.1.0',
            description: 'Executes the AI SDR Core contract against Reply.io: CLI, API v3, MCP, auth.',
            dependencies: ['ai-sdr-core'],
        },
        {
            name: 'agentic-runtime',
            display_name: 'Agentic Runtime',
            version: '0.1.0',
            description: 'Durable multi-session work: plans, work items, checkpoints, reports, memory.',
            dependencies: ['ai-sdr-core'],
        },
    ],
};

const packs_url = (ref: string = DEFAULT_REF): string=>
    `https://raw.githubusercontent.com/${REPO}/${ref}/packs.json`;

const bad_document = (detail: string): RuntimeError=>
    new RuntimeError('The skills pack registry is malformed.', {code: 'skills.packs_malformed', detail});

const as_string = (value: unknown, field: string): string=>{
    if (typeof value !== 'string' || !value.trim())
    {
        throw bad_document(`missing or non-string field: ${field}`);
    }
    return value;
};

// Parses reply-skills' packs.json. Rejects the document as a whole rather than
// returning a half-parsed registry — a partially understood dependency graph is
// worse than no graph.
const parse_packs = (raw: unknown): Pack_registry=>{
    const doc = (raw ?? {}) as Record<string, unknown>;
    const marketplace = (doc.marketplace ?? {}) as Record<string, unknown>;
    const entries = doc.packs;
    if (!Array.isArray(entries) || !entries.length)
    {
        throw bad_document('packs must be a non-empty array');
    }
    const packs: Pack[] = entries.map((entry, i)=>{
        const e = (entry ?? {}) as Record<string, unknown>;
        const name = as_string(e.name, `packs[${i}].name`);
        const deps = e.dependencies === undefined ? [] : e.dependencies;
        if (!Array.isArray(deps) || deps.some(d=>typeof d !== 'string'))
        {
            throw bad_document(`packs[${i}].dependencies must be an array of strings`);
        }
        return {
            name,
            display_name: typeof e.displayName === 'string' ? e.displayName : name,
            version: as_string(e.version, `packs[${i}].version`),
            description: typeof e.description === 'string' ? e.description : '',
            dependencies: deps as string[],
        };
    });
    const known = new Set(packs.map(p=>p.name));
    for (const pack of packs)
    {
        for (const dep of pack.dependencies)
        {
            if (!known.has(dep))
            {
                throw bad_document(`${pack.name} depends on unknown pack '${dep}'`);
            }
        }
    }
    return {marketplace: as_string(marketplace.name ?? MARKETPLACE, 'marketplace.name'), packs};
};

// Fetches the registry, degrading to the embedded copy on any problem —
// unreachable network, HTTP error, or a document we cannot trust. Installing a
// known-good pack set beats failing because GitHub is having a bad day.
const load_packs = async(opts: {ref?: string; fetch_impl?: typeof fetch} = {}): Promise<Pack_registry>=>{
    const fetch_impl = opts.fetch_impl ?? fetch;
    try {
        const response = await fetch_impl(packs_url(opts.ref));
        if (!response.ok)
        {
            return PACKS_FALLBACK;
        }
        return parse_packs(await response.json());
    } catch {
        return PACKS_FALLBACK;
    }
};

// Requested names (aliases allowed, empty means everything) → the packs to act
// on, dependencies always before their dependents.
//
// `dependencies: false` returns exactly the requested packs, still in registry
// order. Removal uses it: `remove reply-adapter` must not drag `ai-sdr-core`
// along, because other installed packs still need it.
const resolve_packs = (
    requested: string[],
    registry: Pack_registry,
    opts: {dependencies?: boolean} = {},
): Pack[]=>{
    const by_name = new Map(registry.packs.map(p=>[p.name, p]));
    const valid = registry.packs.map(p=>p.name).join(', ');
    const wanted = requested.length
        ? requested.map(raw=>{
            const name = ALIASES[raw] ?? raw;
            if (!by_name.has(name))
            {
                throw new UsageError(`Unknown skills pack '${raw}'.`, {
                    code: 'usage.skills_pack',
                    hint: `Valid packs: ${valid} (aliases: ${Object.keys(ALIASES).join(', ')})`,
                });
            }
            return name;
        })
        : registry.packs.map(p=>p.name);

    if (opts.dependencies === false)
    {
        const chosen = new Set(wanted);
        return registry.packs.filter(p=>chosen.has(p.name));
    }

    const ordered: Pack[] = [];
    const seen = new Set<string>();
    const visit = (name: string): void=>{
        if (seen.has(name))
        {
            return;
        }
        seen.add(name);
        const pack = by_name.get(name) as Pack;
        for (const dep of pack.dependencies)
        {
            visit(dep);
        }
        ordered.push(pack);
    };
    for (const name of wanted)
    {
        visit(name);
    }
    return ordered;
};

export {
    REPO, MARKETPLACE, DEFAULT_REF, ALIASES, PACKS_FALLBACK,
    packs_url, parse_packs, load_packs, resolve_packs,
};
