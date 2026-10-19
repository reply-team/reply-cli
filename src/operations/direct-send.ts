import {PROGRAM_NAME} from '../config';
import {Operation_error, Unknown_outcome_error, UsageError, type Ids} from '../utils/errors';
import {parse_retry_after} from '../utils/client';
import {call_reply, expect_object, refusal, reply_code_of, detail_of, open_session, type Answer} from './call';
import {parse_id, LARGEST_SAFE_ID, type Op_globals} from './options';
import {contact_not_found} from './contacts';
import {read_stdin_object} from './stdin-input';
import {print_result, with_ids} from './result';
import type {Cli_context} from '../context';

type Direct_send_name = 'send-email' | 'linkedin-connect' | 'linkedin-message' | 'linkedin-inmail' | 'linkedin-voice';
type Direct_send_opts = {contactId?: string; emailAccountId?: string; linkedinAccountId?: string; message?: string};
type Text = Record<string, string>;

type Direct_send = {
    path: string;                       // Reply's endpoint under /v3/contacts/{id}/
    what: string;                       // what goes out, as the messages name it
    fields: readonly string[];          // the text on stdin, every field required
    longest: Record<string, number>;    // the longest each field may be, where Reply publishes it
    text_optional?: boolean;            // without --message nothing is read (an invitation without a note)
    body: (account_id: number, text: Text | undefined) => Record<string, unknown>;
};

// One entry per send: Reply has one endpoint for each, and each takes its text under its own names.
// The lengths are the maxLength Reply's document gives each field; where it gives none, none is set.
const DIRECT_SENDS: Record<Direct_send_name, Direct_send> = {
    'send-email': {
        path: 'send-direct-email', what: 'email', fields: ['subject', 'body'], longest: {},
        body: (id, t)=>({emailAccountId: id, subject: t?.subject, body: t?.body}),
    },
    'linkedin-connect': {
        path: 'send-direct-linkedin-connect', what: 'invitation', fields: ['note'], longest: {}, text_optional: true,
        body: (id, t)=>(t === undefined ? {linkedInAccountId: id} : {linkedInAccountId: id, message: t.note}),
    },
    'linkedin-message': {
        path: 'send-direct-linkedin-message', what: 'message', fields: ['body'], longest: {body: 8000},
        body: (id, t)=>({linkedInAccountId: id, message: t?.body}),
    },
    'linkedin-inmail': {
        path: 'send-direct-linkedin-inmail', what: 'InMail', fields: ['subject', 'body'], longest: {subject: 200, body: 1900},
        body: (id, t)=>({linkedInAccountId: id, subject: t?.subject, body: t?.body}),
    },
    'linkedin-voice': {
        path: 'send-direct-linkedin-ai-voice', what: 'voice message', fields: ['script'], longest: {script: 1000},
        body: (id, t)=>({linkedInAccountId: id, script: t?.script}),
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
// person's words must not go. No message here repeats any of it. A length is counted in characters,
// as the document's maxLength counts them, so one outside the basic plane counts once.
const read_text = (name: Direct_send_name, send: Direct_send, source: string | undefined, read_stdin?: () => string): Text | undefined=>{
    if (send.text_optional === true && source === undefined)
    {
        return undefined;
    }
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
        const longest = send.longest[field];
        if (longest !== undefined && [...value].length > longest)
        {
            throw new UsageError(`The ${field} is longer than Reply takes: at most ${longest} characters.`, {code: CODE});
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
    'directLinkedIn.featureDisabled': {
        status: 403, code: 'linkedin.feature_disabled', title: 'Direct LinkedIn sends are not enabled for this account, so nothing was sent.',
    },
    'directLinkedIn.noLinkedInProfile': {
        status: 404, code: 'contact.no_linkedin_profile', title: 'Reply holds no LinkedIn profile URL for the contact, so nothing was sent.',
    },
    'directLinkedIn.linkedInAccountNotFound': {
        status: 404, code: 'linkedin.account_not_found', title: 'Reply has no LinkedIn account by that id that this account can send from, so nothing was sent.',
    },
    'directLinkedIn.linkedInAccountInactive': {
        status: 409, code: 'linkedin.account_inactive', title: 'The LinkedIn account is inactive, so nothing was sent.',
    },
    'directLinkedIn.invalidCookie': {
        status: 409, code: 'linkedin.invalid_cookie', title: 'The LinkedIn account\'s session is no longer valid, so nothing was sent; reconnect the account.',
    },
    'directLinkedIn.notConnected': {
        status: 409, code: 'linkedin.not_connected', title: 'The LinkedIn account is not connected with the contact, so nothing was sent.',
    },
    'directLinkedIn.messageTooLong': {
        status: 400, code: 'linkedin.message_too_long', title: 'Reply found the text too long, so nothing was sent.',
    },
    'directLinkedIn.invitesNotesLimit': {
        status: 400, code: 'linkedin.message_too_long', title: 'Reply found the note too long, so nothing was sent.',
    },
    'directLinkedIn.missingVariables': {
        status: 400, code: 'linkedin.missing_variables', title: 'The text holds a template variable Reply could not fill, so nothing was sent.',
    },
    'directLinkedIn.salesNavRequired': {
        status: 400, code: 'linkedin.sales_navigator_required', title: 'An InMail needs Sales Navigator on the LinkedIn account, so nothing was sent.',
    },
    'directLinkedIn.salesNavDisconnected': {
        status: 400, code: 'linkedin.sales_navigator_disconnected', title: 'The LinkedIn account\'s Sales Navigator is disconnected, so nothing was sent.',
    },
    'directLinkedIn.noInMailCredits': {
        status: 400, code: 'linkedin.no_inmail_credits', title: 'The LinkedIn account has no InMail credits left, so nothing was sent.',
    },
    'directLinkedIn.voiceProfileMissing': {
        status: 400, code: 'linkedin.voice_profile_missing', title: 'The LinkedIn account has no voice profile, so nothing was sent.',
    },
    'directLinkedIn.voiceTooLong': {
        status: 400, code: 'linkedin.voice_too_long', title: 'The voice message would be longer than Reply allows, so nothing was sent.',
    },
};

const LIMITS: Record<string, string> = {'directLinkedIn.dailyLimitReached': 'daily', 'directLinkedIn.weeklyLimitReached': 'weekly'};

const send_refusal = (a: Answer, contact_id: number): Operation_error=>{
    const reply_code = reply_code_of(a);
    if (a.status === 404 && (reply_code === 'contact.notFound' || reply_code === 'directLinkedIn.contactNotFound'))
    {
        return contact_not_found(contact_id, a);
    }
    if (a.status === 429 && reply_code !== undefined && LIMITS[reply_code] !== undefined)
    {
        return new Operation_error('linkedin.limit_reached', `The LinkedIn account reached its ${LIMITS[reply_code]} limit, so nothing was sent.`, {
            status: a.status, reply_code, detail: detail_of(a),
            retry_after: parse_retry_after(a.headers['retry-after']) ?? undefined, details: {limit: LIMITS[reply_code]},
        });
    }
    const known = reply_code === undefined ? undefined : REFUSALS[reply_code];
    if (known !== undefined && known.status === a.status)
    {
        return new Operation_error(known.code, known.title, {status: a.status, reply_code, detail: detail_of(a)});
    }
    return refusal(a, 'write');
};

const positive_integer = (v: unknown): number | null=>
    typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;

// What the CLI answers for a send Reply took. Neither adds a time of its own: Reply's answer to a
// direct email carries none, and a LinkedIn send's sentAtUtc is given as Reply gives it.
const result_of = (name: Direct_send_name, contact_id: number, sent: Record<string, unknown>): Record<string, unknown>=>
    name === 'send-email'
        ? {
            status: 'sent', contact_id,
            message_id: typeof sent.messageId === 'string' ? sent.messageId : null,
            sent_at: null,
            reply_status: typeof sent.status === 'string' ? sent.status : null,
        }
        : {
            status: 'sent', contact_id,
            activity_id: positive_integer(sent.linkedInActivityId),
            sent_at: typeof sent.sentAtUtc === 'string' ? sent.sentAtUtc : null,
        };

const handle_direct_send = async(
    name: Direct_send_name, opts: Direct_send_opts, ctx: Cli_context, g: Op_globals, read_stdin?: () => string,
): Promise<void>=>{
    const send = DIRECT_SENDS[name];
    const contact_id = required_id(opts.contactId, '--contact-id');
    // A send always names the account it goes from: Reply would send an email from the default mailbox.
    const by_email = name === 'send-email';
    const account_id = by_email
        ? required_id(opts.emailAccountId, '--email-account-id', LARGEST_SAFE_ID)
        : required_id(opts.linkedinAccountId, '--linkedin-account-id');
    const ids: Ids = by_email ? {contact_id, email_account_id: account_id} : {contact_id, linkedin_account_id: account_id};
    const text = read_text(name, send, opts.message, read_stdin);
    const s = await open_session(ctx, g);
    try {
        const a = await call_reply(s, 'POST', `/v3/contacts/${contact_id}/${send.path}`, 'write', send.body(account_id, text));
        if (name === 'linkedin-connect' && a.status === 409 && reply_code_of(a) === 'directLinkedIn.alreadyConnected')
        {
            // Nothing was sent, and nothing needs to be: the contact is already a connection.
            print_result({status: 'already_connected', contact_id, activity_id: null, sent_at: null}, g);
            return;
        }
        if (a.status !== 200)
        {
            throw send_refusal(a, contact_id);
        }
        print_result(result_of(name, contact_id, expect_object(a, 'write')), g);
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
