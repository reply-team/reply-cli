import {PROGRAM_NAME} from '../config';
import {Operation_error, Unknown_outcome_error, UsageError} from '../utils/errors';
import {call_reply, expect_object, refusal, reply_code_of, detail_of, open_session, type Answer} from './call';
import {parse_id, LARGEST_SAFE_ID, type Op_globals} from './options';
import {contact_not_found} from './contacts';
import {read_stdin_object} from './stdin-input';
import {print_result, with_ids} from './result';
import type {Cli_context} from '../context';

type Direct_send_name = 'send-email';
type Direct_send_opts = {contactId?: string; emailAccountId?: string; linkedinAccountId?: string; message?: string};
type Text = Record<string, string>;

type Direct_send = {
    path: string;                       // Reply's endpoint under /v3/contacts/{id}/
    what: string;                       // what goes out, as the messages name it
    fields: readonly string[];          // the text on stdin, every field required
    body: (account_id: number, text: Text) => Record<string, unknown>;
};

// One entry per send: Reply has one endpoint for each, and each takes its text under its own names.
const DIRECT_SENDS: Record<Direct_send_name, Direct_send> = {
    'send-email': {
        path: 'send-direct-email', what: 'email', fields: ['subject', 'body'],
        body: (id, t)=>({emailAccountId: id, subject: t.subject, body: t.body}),
    },
};

const CODE = 'usage.message';

const required_id = (raw: string | undefined, flag: string, largest?: number): number=>{
    if (raw === undefined)
    {
        throw new UsageError(`No ${flag} was given.`, {code: 'usage.id'});
    }
    return parse_id(raw, flag, largest);
};

// The text is read from stdin only, never from the argument list, which may be logged where a
// person's words must not go. No message here repeats any of it.
const read_text = (name: Direct_send_name, send: Direct_send, source: string | undefined, read_stdin?: () => string): Text=>{
    const shape = `{${send.fields.map(f=>`"${f}":"…"`).join(',')}}`;
    const raw = read_stdin_object(source, {
        flag: '--message', what: 'message', fields: send.fields, code: CODE,
        hint: `Pipe it in: echo '${shape}' | ${PROGRAM_NAME} contact ${name} … --message -`,
    }, read_stdin);
    const text: Text = {};
    for (const field of send.fields)
    {
        const value = raw[field];
        if (typeof value !== 'string' || value.trim() === '')
        {
            throw new UsageError(`The message needs a ${field}: a string that is not blank.`, {code: CODE});
        }
        text[field] = value;
    }
    return text;
};

// Reply's refusals of a direct send, by status and code. Each one is definite: nothing was sent.
const REFUSALS: Record<string, {status: number; code: string; title: string}> = {
    'contact.emailAccountNotFound': {
        status: 400, code: 'email_account.not_found', title: 'Reply has no mailbox by that id that this account can send from, so nothing was sent.',
    },
    'contact.contactInBlackList': {
        status: 400, code: 'contact.blacklisted', title: 'The contact is on the account\'s blacklist, so nothing was sent.',
    },
};

const send_refusal = (a: Answer, contact_id: number): Operation_error=>{
    const reply_code = reply_code_of(a);
    if (a.status === 404 && reply_code === 'contact.notFound')
    {
        return contact_not_found(contact_id, a);
    }
    const known = reply_code === undefined ? undefined : REFUSALS[reply_code];
    if (known !== undefined && known.status === a.status)
    {
        return new Operation_error(known.code, known.title, {status: a.status, reply_code, detail: detail_of(a)});
    }
    return refusal(a, 'write');
};

const handle_direct_send = async(
    name: Direct_send_name, opts: Direct_send_opts, ctx: Cli_context, g: Op_globals, read_stdin?: () => string,
): Promise<void>=>{
    const send = DIRECT_SENDS[name];
    const contact_id = required_id(opts.contactId, '--contact-id');
    // A send always names the mailbox it goes from: Reply would otherwise pick the default one.
    const account_id = required_id(opts.emailAccountId, '--email-account-id', LARGEST_SAFE_ID);
    const ids = {contact_id, email_account_id: account_id};
    const text = read_text(name, send, opts.message, read_stdin);
    const s = await open_session(ctx, g);
    try {
        const a = await call_reply(s, 'POST', `/v3/contacts/${contact_id}/${send.path}`, 'write', send.body(account_id, text));
        if (a.status !== 200)
        {
            throw send_refusal(a, contact_id);
        }
        const sent = expect_object(a, 'write');
        // Reply's answer to a direct email carries no time, and the CLI adds none of its own.
        print_result({
            status: 'sent', contact_id,
            message_id: typeof sent.messageId === 'string' ? sent.messageId : null,
            sent_at: null,
            reply_status: typeof sent.status === 'string' ? sent.status : null,
        }, g);
    } catch (e) {
        // Unlike most work commands, a send is not safe to repeat: the same text would go twice.
        if (e instanceof Unknown_outcome_error)
        {
            e.hint = `The ${send.what} may have been sent; running the command again may send it twice.`;
        }
        throw with_ids(e, ids);
    }
};

export {handle_direct_send};
export type {Direct_send_name, Direct_send_opts};
