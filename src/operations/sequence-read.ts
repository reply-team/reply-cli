import {Operation_error, UsageError} from '../utils/errors';
import {
    call_reply, expect_object, read_page, is_object, refusal, reply_code_of, unreadable, open_session,
    type Answer, type Op_session,
} from './call';
import {parse_id, parse_int_in, parse_iso, parse_choice, type Op_globals} from './options';
import {print_result} from './result';
import type {Cli_context} from '../context';

const PRESETS = {
    'last-week': 'lastWeek',
    'last-month': 'lastMonth',
    'last-year': 'lastYear',
    'all-time': 'allTime',
} as const;
type Preset = keyof typeof PRESETS;

const sequence_not_found = (id: number, a: Answer): Operation_error=>
    new Operation_error('sequence.not_found', `This account has no sequence ${id}.`, {status: a.status, reply_code: reply_code_of(a)});

const sequence_archived = (id: number, a?: Answer): Operation_error=>
    new Operation_error('sequence.archived', `Sequence ${id} is archived.`, {
        status: a?.status ?? 200, reply_code: a === undefined ? undefined : reply_code_of(a),
    });

const read_sequence = async(s: Op_session, id: number): Promise<Record<string, unknown>>=>{
    const a = await call_reply(s, 'GET', `/v3/sequences/${id}`, 'read');
    if (a.status === 404)
    {
        throw sequence_not_found(id, a);
    }
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    return expect_object(a, 'read');
};

// Reply's own count of the people in the sequence, or null when it would not count them. The
// page of contacts answers an empty 200 for a sequence that doesn't exist; the count answers 404,
// so it is also what tells the two apart.
const count_contacts = async(s: Op_session, id: number): Promise<number | null>=>{
    const a = await call_reply(s, 'GET', `/v3/sequences/${id}/contacts/count`, 'read');
    if (a.status === 404)
    {
        throw sequence_not_found(id, a);
    }
    if (a.status !== 200 || !is_object(a.data))
    {
        return null;
    }
    const count = a.data.count;
    return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null;
};

// The count where a decision depends on it: anything but a number is that call's own failure.
const require_count = async(s: Op_session, id: number): Promise<number>=>{
    const a = await call_reply(s, 'GET', `/v3/sequences/${id}/contacts/count`, 'read');
    if (a.status === 404)
    {
        throw sequence_not_found(id, a);
    }
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    const count = expect_object(a, 'read').count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0)
    {
        throw unreadable(a, 'read');
    }
    return count;
};

const handle_sequence_get = async(id_arg: string, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const id = parse_id(id_arg, 'Sequence id');
    const s = await open_session(ctx, g);
    print_result(await read_sequence(s, id), g);
};

const handle_sequence_contacts = async(
    id_arg: string, opts: {limit?: string; offset?: string}, ctx: Cli_context, g: Op_globals,
): Promise<void>=>{
    const id = parse_id(id_arg, 'Sequence id');
    const limit = parse_int_in(opts.limit, '--limit', 1, 1000, 100);
    const offset = parse_int_in(opts.offset, '--offset', 0, 1000000, 0);
    const s = await open_session(ctx, g);
    const a = await call_reply(s, 'GET', `/v3/sequences/${id}/contacts?top=${limit}&skip=${offset}`, 'read');
    if (a.status === 404)
    {
        throw sequence_not_found(id, a);
    }
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    const page = read_page(a);
    print_result({items: page.items, has_more: page.has_more, total: await count_contacts(s, id)}, g);
};

// Reply answers a span that doesn't end after it starts with a 500, which would read as Reply
// being down and be asked again, so it is refused here.
const stats_span = (raw_from: string, raw_to: string): {from: string; to: string}=>{
    const from = parse_iso(raw_from, '--from');
    const to = parse_iso(raw_to, '--to');
    if (Date.parse(from) >= Date.parse(to))
    {
        throw new UsageError('--to must be later than --from.', {code: 'usage.stats'});
    }
    return {from, to};
};

const handle_sequence_stats = async(
    id_arg: string, opts: {preset?: string; from?: string; to?: string}, ctx: Cli_context, g: Op_globals,
): Promise<void>=>{
    const id = parse_id(id_arg, 'Sequence id');
    const preset = parse_choice(opts.preset, '--preset', Object.keys(PRESETS) as Preset[]);
    const by_preset = preset !== undefined;
    const by_span = opts.from !== undefined && opts.to !== undefined;
    const partial_span = (opts.from !== undefined) !== (opts.to !== undefined);
    if (by_preset === by_span || partial_span)
    {
        throw new UsageError('Give the window as --preset, or as both --from and --to.', {code: 'usage.stats'});
    }
    const filters = preset !== undefined
        ? {dateRangePreset: PRESETS[preset]}
        : stats_span(opts.from as string, opts.to as string);
    const s = await open_session(ctx, g);
    // A POST that changes nothing: the window travels in the body.
    const a = await call_reply(s, 'POST', `/v3/sequences/${id}/stats`, 'read', {filters});
    if (a.status === 404)
    {
        throw sequence_not_found(id, a);
    }
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    print_result(expect_object(a, 'read'), g);
};

export {
    read_sequence, count_contacts, require_count, sequence_not_found, sequence_archived,
    handle_sequence_get, handle_sequence_contacts, handle_sequence_stats, PRESETS,
};
