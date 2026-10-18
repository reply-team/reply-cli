import {PROGRAM_NAME} from '../config';
import {Operation_error, Unknown_outcome_error, UsageError} from '../utils/errors';
import {read_all_stdin} from '../utils/json-arg';
import {call_reply, expect_object, refusal, reply_code_of, detail_of, is_object, open_session, type Answer, type Op_session} from './call';
import {parse_id, type Op_globals} from './options';
import {thread_not_found, CHANNELS, type Channel} from './inbox';
import {print_result, with_ids} from './result';
import type {Cli_context} from '../context';

type Reply_message = {body: string; reply_to_message_id?: string};

const CODE = 'usage.message';
const MESSAGE_FIELDS = ['body', 'reply_to_message_id'];
const STDIN_HINT = `Pipe it in: echo '{"body":"…"}' | ${PROGRAM_NAME} inbox reply <thread-id> --message -`;

// The reply's text is read from stdin only, never from the argument list, which may be logged
// where a person's words must not go. No message here repeats any of it.
const read_reply_message = (source: string | undefined, read_stdin?: () => string): Reply_message=>{
    if (source !== '-')
    {
        throw new UsageError(source === undefined ? 'No message was given.' : '--message takes only -: the message is read from stdin.', {
            code: CODE, hint: STDIN_HINT,
        });
    }
    let value: unknown;
    try {
        value = JSON.parse((read_stdin ?? read_all_stdin)());
    } catch {
        throw new UsageError('The message on stdin must be JSON: {body, reply_to_message_id}.', {code: CODE});
    }
    if (!is_object(value))
    {
        throw new UsageError('The message must be a JSON object: {body, reply_to_message_id}.', {code: CODE});
    }
    const unknown_field = Object.keys(value).find(k=>!MESSAGE_FIELDS.includes(k));
    if (unknown_field !== undefined)
    {
        throw new UsageError(`The message has an unknown field '${unknown_field}'.`, {code: CODE, hint: `Fields: ${MESSAGE_FIELDS.join(', ')}.`});
    }
    if (typeof value.body !== 'string' || value.body.trim() === '')
    {
        throw new UsageError('The message needs a body: a string that is not blank.', {code: CODE});
    }
    const reply_to = value.reply_to_message_id;
    if (reply_to !== undefined && reply_to !== null && (typeof reply_to !== 'string' || reply_to === ''))
    {
        throw new UsageError('reply_to_message_id must be a message id: a string that is not empty.', {code: CODE});
    }
    return typeof reply_to === 'string' ? {body: value.body, reply_to_message_id: reply_to} : {body: value.body};
};

const channel_mismatch = (title: string, status: number, thread_channel: string | null, reply_code?: string): Operation_error=>
    new Operation_error('inbox.channel_mismatch', title, {status, reply_code, details: {thread_channel}});

const cli_channel = (reply_channel: unknown): Channel | undefined=>
    (Object.keys(CHANNELS) as Channel[]).find(c=>CHANNELS[c] === reply_channel);

type Outbound = {at: number; status: unknown};

// The thread's outbound messages that carry a date, oldest first. The document says the inline
// history is "in order" without saying which way, so the dates decide, never the positions.
const outbound_of = (thread: Record<string, unknown>): Outbound[]=>
    (Array.isArray(thread.messages) ? thread.messages : [])
        .filter(is_object)
        .filter(m=>m.isOutbound === true && typeof m.date === 'string' && !isNaN(Date.parse(m.date)))
        .map(m=>({at: Date.parse(m.date as string), status: m.status}))
        .sort((x, y)=>x.at - y.at);

// Reply's send takes the thread's channel, and only an email reply may name the message it answers.
// The newest outbound message the thread already holds is kept, so a failure after the send can be
// told from one that was there before it.
const read_thread = async(
    s: Op_session, id: number, message: Reply_message,
): Promise<{channel: Channel; last_outbound_at: number | null}>=>{
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
    const raw = thread.channel;
    const channel = cli_channel(raw);
    if (channel === undefined)
    {
        throw channel_mismatch('Reply takes a reply only in an email or LinkedIn thread, and this thread is neither.', 200,
            typeof raw === 'string' ? raw : null);
    }
    if (channel === 'linkedin' && message.reply_to_message_id !== undefined)
    {
        throw channel_mismatch('reply_to_message_id answers one email message; a LinkedIn thread takes a reply to the thread only.', 200, channel);
    }
    return {channel, last_outbound_at: outbound_of(thread).pop()?.at ?? null};
};

// INTERIM (API gap): the 502 Reply answers when it could not deliver a reply says only that, not why.
// Needed: the failed message's status code in the 502 itself.
// Workaround: read the thread once and take the code from the newest failed outbound message that is
// newer than anything outbound the thread held before the send, so an earlier failure is never
// given as this one's reason; when Reply recorded none, the code is null. The code decides what the
// caller does next (wait out a limit, or reconnect the account), so without it every failed delivery
// would be the same answer. The read is best-effort: when it fails, the refusal stands without the code.
const failed_message_code = async(s: Op_session, id: number, last_outbound_at: number | null): Promise<string | null>=>{
    let t: Answer;
    try {
        t = await call_reply(s, 'GET', `/v3/inbox/threads/${id}`, 'read');
    } catch (e) {
        if (e instanceof Operation_error)
        {
            return null;
        }
        throw e;
    }
    if (t.status !== 200 || !is_object(t.data))
    {
        return null;
    }
    const failed = outbound_of(t.data)
        .filter(m=>last_outbound_at === null || m.at > last_outbound_at)
        .map(m=>m.status)
        .filter(is_object)
        .filter(status=>status.state === 'needsAttention' && typeof status.code === 'string')
        .pop();
    return failed === undefined ? null : failed.code as string;
};

// What a send answered when it did not send.
const send_refusal = async(s: Op_session, id: number, a: Answer, last_outbound_at: number | null): Promise<Operation_error>=>{
    const code = reply_code_of(a);
    if (a.status === 502 && code === 'inboxThread.threadSendFailed')
    {
        // Reply tried and could not deliver: a definite refusal, never an unknown outcome.
        return new Operation_error('inbox.send_failed', 'Reply could not deliver the reply, so it was not sent.', {
            status: a.status, reply_code: code, detail: detail_of(a),
            details: {status_code: await failed_message_code(s, id, last_outbound_at)},
        });
    }
    if (a.status === 404)
    {
        return thread_not_found(id, a);
    }
    if (a.status === 400 && code === 'inboxThread.channelMismatch')
    {
        return channel_mismatch('Reply says the reply\'s channel is not the thread\'s.', a.status, null, code);
    }
    if (a.status === 400 && code === 'inboxThread.contactOptedOut')
    {
        return new Operation_error('contact.opted_out', 'The thread\'s contact is opted out, so the reply was not sent.', {
            status: a.status, reply_code: code, detail: detail_of(a),
        });
    }
    return refusal(a, 'write');
};

const handle_inbox_reply = async(
    thread_arg: string, opts: {message?: string}, ctx: Cli_context, g: Op_globals, read_stdin?: () => string,
): Promise<void>=>{
    const id = parse_id(thread_arg, 'Thread id');
    const message = read_reply_message(opts.message, read_stdin);
    const s = await open_session(ctx, g);
    try {
        const {channel, last_outbound_at} = await read_thread(s, id, message);
        // The reply goes to the thread's contact from the account that owns the thread: no other
        // recipient can be named.
        const body = channel === 'email'
            ? {channel: 'email', message: message.body,
                ...(message.reply_to_message_id === undefined ? {} : {replyToMessageId: message.reply_to_message_id})}
            : {channel: CHANNELS.linkedin, message: message.body};
        const a = await call_reply(s, 'POST', `/v3/inbox/threads/${id}/messages`, 'write', body);
        if (a.status !== 200)
        {
            throw await send_refusal(s, id, a, last_outbound_at);
        }
        const sent = expect_object(a, 'write');
        print_result({
            status: 'sent', thread_id: id, channel,
            message_id: typeof sent.messageId === 'string' ? sent.messageId : null,
            sent_at: typeof sent.date === 'string' ? sent.date : null,
        }, g);
    } catch (e) {
        // Unlike every other work command, a send is not safe to repeat: the same reply would go twice.
        if (e instanceof Unknown_outcome_error)
        {
            e.hint = `The reply may have been sent; running the command again may send it twice. Read the thread with \`${PROGRAM_NAME} inbox get ${id}\` first.`;
        }
        throw with_ids(e, {thread_id: id});
    }
};

export {handle_inbox_reply};
export type {Reply_message};
