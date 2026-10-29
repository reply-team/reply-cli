import {Operation_error, UsageError} from '../utils/errors';
import {
    call_reply, expect_object, read_page, refusal, reply_code_of, detail_of, invalid_fields, is_object, item_failure, unreadable,
    open_session, type Answer, type Op_session,
} from './call';
import {parse_id, parse_int_in, parse_iso, parse_moment, parse_choice, type Op_globals} from './options';
import {print_result, with_ids} from './result';
import type {Cli_context} from '../context';

// Reply's own `source` filter. It has no "all": without --source Reply answers its default, inbox.
const SOURCES = {'inbox': 'inbox', 'sent': 'sent', 'unread': 'unread', 'ai-draft': 'aiDraft'} as const;
type Source = keyof typeof SOURCES;

// The CLI's channel words and Reply's.
const CHANNELS = {'email': 'email', 'linkedin': 'linkedIn'} as const;
type Channel = keyof typeof CHANNELS;

const thread_not_found = (id: number, a: Answer): Operation_error=>
    new Operation_error('inbox.thread_not_found', `This account has no inbox thread ${id} it can see.`, {
        status: a.status, reply_code: reply_code_of(a),
    });

type Inbox_list_opts = {
    contactId?: string; sequenceId?: string; source?: string; channel?: string; categoryId?: string;
    since?: string; limit?: string; offset?: string;
};

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
    const channel = parse_choice(opts.channel, '--channel', Object.keys(CHANNELS) as Channel[]);
    if (channel !== undefined)
    {
        filter.channels = [CHANNELS[channel]];
    }
    if (opts.categoryId !== undefined)
    {
        filter.categoryIds = [parse_id(opts.categoryId, '--category-id')];
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

type Inbox_events_opts = {cursor?: string; since?: string; top?: string};

const START_AGAIN = 'Start again with --since (at most 30 days ago), or with neither flag to read the last 30 days.';

// The feed keeps 30 days. Reply refuses a cursor or a since older than that under a code of its own.
const window_expired = (a: Answer): Operation_error | undefined=>
    a.status === 400 && reply_code_of(a) === 'inboxThread.eventWindowExpired'
        ? new Operation_error('inbox.cursor_expired', 'Reply keeps the feed for 30 days, and the cursor or --since reaches further back.', {
            status: a.status, reply_code: reply_code_of(a), detail: detail_of(a), hint: START_AGAIN,
        })
        : undefined;

// Any other cursor Reply will not read (unreadable, or ahead of its clock) is a validation problem
// with no code that points at /cursor; they differ only in their text.
const cursor_refused = (a: Answer, fields: string[]): Operation_error=>
    new Operation_error('inbox.cursor_refused', 'Reply would not read the cursor: unreadable, older than 30 days or ahead of its clock.', {
        status: a.status, detail: detail_of(a), details: {fields}, hint: START_AGAIN,
    });

const handle_inbox_events = async(opts: Inbox_events_opts, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    if (opts.cursor !== undefined && opts.since !== undefined)
    {
        throw new UsageError('Give --cursor or --since, not both.', {code: 'usage.inbox'});
    }
    const query = new URLSearchParams();
    if (opts.cursor !== undefined)
    {
        // Reply's cursor is opaque: it goes back as given, never read.
        if (opts.cursor.trim() === '')
        {
            throw new UsageError('--cursor is empty.', {code: 'usage.inbox', hint: 'Pass the cursor a previous page answered, unchanged.'});
        }
        query.set('cursor', opts.cursor);
    }
    if (opts.since !== undefined)
    {
        // Reply's since is inclusive already, so the moment goes as given, in UTC.
        query.set('since', parse_moment(opts.since, '--since'));
    }
    if (opts.top !== undefined)
    {
        query.set('top', String(parse_int_in(opts.top, '--top', 1, 1000, 0)));
    }
    const s = await open_session(ctx, g);
    const q = query.toString();
    const a = await call_reply(s, 'GET', q === '' ? '/v3/inbox/events' : `/v3/inbox/events?${q}`, 'read');
    if (a.status !== 200)
    {
        const fields = opts.cursor !== undefined && a.status === 400 && reply_code_of(a) === undefined ? invalid_fields(a) : undefined;
        throw window_expired(a) ?? (fields?.includes('cursor') ? cursor_refused(a, fields) : refusal(a, 'read'));
    }
    const body = expect_object(a, 'read');
    if (!Array.isArray(body.items) || typeof body.hasMore !== 'boolean' || typeof body.cursor !== 'string')
    {
        throw unreadable(a, 'read');
    }
    print_result({items: body.items, has_more: body.hasMore, cursor: body.cursor}, g);
};

// INTERIM (API gap): GET /v3/inbox/threads/{id} carries the thread's whole history inline, every
// body included and with no limit, and the thread has no subject of its own.
// Needed: a thread without its history inline, and a subject field.
// Workaround: drop the history (the paged messages are the history) and take the subject from the
// latest email message.
const thread_header = (thread: Record<string, unknown>): Record<string, unknown>=>{
    const {messages, ...header} = thread;
    const history = Array.isArray(messages) ? messages.filter(is_object) : [];
    const latest_email = history.filter(m=>m.channel === 'email').pop();
    return {...header, subject: typeof latest_email?.subject === 'string' ? latest_email.subject : null};
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
    print_result({thread: thread_header(thread), messages: read_page(m)}, g);
};

const handle_inbox_categories = async(ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const s = await open_session(ctx, g);
    const a = await call_reply(s, 'GET', '/v3/inbox/threads/categories', 'read');
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    if (!Array.isArray(a.data))
    {
        throw unreadable(a, 'read');
    }
    print_result({items: a.data}, g);
};

const category_not_found = (category_id: number | null, a: Answer): Operation_error=>
    new Operation_error('inbox.category_not_found', `This account has no inbox category ${category_id}.`, {
        status: a.status, reply_code: reply_code_of(a),
    });

// INTERIM (API gap): PUT /v3/inbox/threads/{id}/category answers a category the account does not
// have with the same 404 and inboxThread.notFound as a thread it does not have, so on its own the
// answer would report an existing thread as missing.
// Needed: a code of its own for a missing category; the document gives inboxCategory.notFound only to
// the category endpoints themselves.
// Workaround: after that 404 on a categorize that names a category, read the thread once. When it is
// there, the category is what is missing. The read is best-effort: when it fails, Reply's own word
// stands.
const thread_exists = async(s: Op_session, id: number): Promise<boolean>=>{
    try {
        return (await call_reply(s, 'GET', `/v3/inbox/threads/${id}`, 'read')).status === 200;
    } catch (e) {
        if (e instanceof Operation_error)
        {
            return false;
        }
        throw e;
    }
};

// One absolute PUT, so a repeat lands on the same state. Reply clears the category on a null id.
const handle_inbox_categorize = async(
    thread_arg: string, opts: {categoryId?: string; clear?: boolean}, ctx: Cli_context, g: Op_globals,
): Promise<void>=>{
    const id = parse_id(thread_arg, 'Thread id');
    if ((opts.categoryId === undefined) === (opts.clear !== true))
    {
        throw new UsageError('Give exactly one of --category-id and --clear.', {code: 'usage.inbox'});
    }
    const category_id = opts.categoryId === undefined ? null : parse_id(opts.categoryId, '--category-id');
    const s = await open_session(ctx, g);
    try {
        const a = await call_reply(s, 'PUT', `/v3/inbox/threads/${id}/category`, 'write', {categoryId: category_id});
        // Without a category named (--clear), the 404 can only be the thread's. inboxCategory.notFound is
        // read too, should Reply ever answer this call with it; a 404 with neither code is reply.refused.
        if (a.status === 404 && reply_code_of(a) === 'inboxThread.notFound')
        {
            throw category_id !== null && await thread_exists(s, id) ? category_not_found(category_id, a) : thread_not_found(id, a);
        }
        if (a.status === 404 && reply_code_of(a) === 'inboxCategory.notFound')
        {
            throw category_not_found(category_id, a);
        }
        if (a.status !== 204 && a.status !== 200)
        {
            throw refusal(a, 'write');
        }
        print_result({status: category_id === null ? 'cleared' : 'categorized', thread_id: id, category_id}, g);
    } catch (e) {
        throw with_ids(e, {thread_id: id});
    }
};

// Reply marks threads only in bulk and answers with the ones it did not mark, so a thread missing
// from the answer is marked. No read first: a thread that is already so is answered the same way.
const mark_thread = async(thread_arg: string, read: boolean, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const id = parse_id(thread_arg, 'Thread id');
    const s = await open_session(ctx, g);
    try {
        const a = await call_reply(s, 'POST', `/v3/inbox/threads/${read ? 'mark-as-read' : 'mark-as-unread'}`, 'write', {threadIds: [id]});
        if (a.status !== 200)
        {
            throw refusal(a, 'write');
        }
        const failed = item_failure(expect_object(a, 'write'), id);
        if (failed?.error === 'notFound')
        {
            throw new Operation_error('inbox.thread_not_found', `This account has no inbox thread ${id} it can see.`, {
                status: 200, reply_code: 'notFound',
            });
        }
        if (failed !== undefined)
        {
            throw new Operation_error('reply.refused', `Reply did not mark the thread as ${read ? 'read' : 'unread'}.`, {
                status: 200, reply_code: failed.error ?? undefined, detail: failed.details ?? undefined,
            });
        }
        print_result({status: read ? 'read' : 'unread', thread_id: id}, g);
    } catch (e) {
        throw with_ids(e, {thread_id: id});
    }
};

const handle_inbox_mark_read = (thread_arg: string, ctx: Cli_context, g: Op_globals): Promise<void>=>
    mark_thread(thread_arg, true, ctx, g);

const handle_inbox_mark_unread = (thread_arg: string, ctx: Cli_context, g: Op_globals): Promise<void>=>
    mark_thread(thread_arg, false, ctx, g);

export {
    handle_inbox_list, handle_inbox_events, handle_inbox_get, handle_inbox_categories, handle_inbox_categorize,
    handle_inbox_mark_read, handle_inbox_mark_unread, thread_not_found, SOURCES, CHANNELS,
};
export type {Channel};
