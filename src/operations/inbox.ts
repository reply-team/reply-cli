import {Operation_error, UsageError} from '../utils/errors';
import {call_reply, expect_object, read_page, refusal, reply_code_of, open_session, type Answer} from './call';
import {parse_id, parse_int_in, parse_iso, parse_choice, type Op_globals} from './options';
import {print_result} from './result';
import type {Cli_context} from '../context';

// Reply's own `source` filter. It has no "all": without --source Reply answers its default, inbox.
const SOURCES = {'inbox': 'inbox', 'sent': 'sent', 'unread': 'unread', 'ai-draft': 'aiDraft'} as const;
type Source = keyof typeof SOURCES;

const thread_not_found = (id: number, a: Answer): Operation_error=>
    new Operation_error('inbox.thread_not_found', `This account has no inbox thread ${id} it can see.`, {
        status: a.status, reply_code: reply_code_of(a),
    });

type Inbox_list_opts = {contactId?: string; sequenceId?: string; source?: string; since?: string; limit?: string; offset?: string};

const handle_inbox_list = async(opts: Inbox_list_opts, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    if ((opts.contactId === undefined) === (opts.sequenceId === undefined))
    {
        throw new UsageError('Give exactly one of --contact-id and --sequence-id.', {code: 'usage.inbox'});
    }
    const filter: Record<string, unknown> = opts.contactId !== undefined
        ? {contactIds: [parse_id(opts.contactId, '--contact-id')]}
        : {sequenceIds: [parse_id(opts.sequenceId as string, '--sequence-id')]};
    const source = parse_choice(opts.source, '--source', Object.keys(SOURCES) as Source[]);
    if (source !== undefined)
    {
        filter.source = SOURCES[source];
    }
    if (opts.since !== undefined)
    {
        // Reply's `from` keeps only threads that moved strictly after it; --since keeps the ones
        // that moved at or after it, so Reply is asked from one millisecond earlier.
        filter.from = new Date(Date.parse(parse_iso(opts.since, '--since')) - 1).toISOString();
    }
    const limit = parse_int_in(opts.limit, '--limit', 1, 100, 20);
    const offset = parse_int_in(opts.offset, '--offset', 0, 1000000, 0);
    const s = await open_session(ctx, g);
    // A POST that changes nothing: the filter travels in the body.
    const a = await call_reply(s, 'POST', `/v3/inbox/threads/filter?top=${limit}&skip=${offset}`, 'read', filter);
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    const page = read_page(a);
    print_result({items: page.items, has_more: page.has_more}, g);
};

const handle_inbox_get = async(
    thread_arg: string, opts: {limit?: string; offset?: string}, ctx: Cli_context, g: Op_globals,
): Promise<void>=>{
    const id = parse_id(thread_arg, 'Thread id');
    const limit = parse_int_in(opts.limit, '--limit', 1, 20, 20);
    const offset = parse_int_in(opts.offset, '--offset', 0, 1000000, 0);
    const s = await open_session(ctx, g);
    const t = await call_reply(s, 'GET', `/v3/inbox/threads/${id}`, 'read');
    if (t.status === 404)
    {
        throw thread_not_found(id, t);
    }
    if (t.status !== 200)
    {
        throw refusal(t, 'read');
    }
    const thread = expect_object(t, 'read');
    const m = await call_reply(s, 'GET', `/v3/inbox/threads/${id}/messages?top=${limit}&skip=${offset}`, 'read');
    if (m.status === 404)
    {
        throw thread_not_found(id, m);
    }
    if (m.status !== 200)
    {
        throw refusal(m, 'read');
    }
    print_result({thread, messages: read_page(m)}, g);
};

export {handle_inbox_list, handle_inbox_get, SOURCES};
