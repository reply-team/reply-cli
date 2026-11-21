import {REDACTED} from '../utils/output';
import {Operation_error} from '../utils/errors';
import {call_reply, detail_of, is_object, refusal, reply_code_of, type Answer, type Op_session} from './call';
import type {Call_kind} from '../utils/client';
import type {Op_globals} from './options';

// The calls of the account commands, and what they write to stderr under --verbose. A connection link
// and any token in it are handed over once, in the stdout field `link`: in a trace each is replaced by
// LINK_REDACTED, wherever it appears.

const LINK_REDACTED = '<link redacted>';

// The field Reply hands a link in: v3's connectionLink.
const LINK_FIELDS = ['connectionlink'];

// Too short to be a token, and short enough to be an ordinary word of a URL.
const SHORTEST_TOKEN = 8;
const SHORTEST_INNER_TOKEN = 16;

const safe_decode = (part: string): string=>{
    try {
        return decodeURIComponent(part);
    } catch {
        return part;
    }
};

// A link, and every token it carries: its last path segment, every query value, and any inner path
// segment that looks generated (long, with a digit in it), each as written and decoded.
const add_link = (link: string, found: Set<string>): void=>{
    found.add(link);
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return;
    }
    const segments = url.pathname.split('/').filter(Boolean);
    const parts = [
        ...segments.slice(0, -1).filter(p=>p.length >= SHORTEST_INNER_TOKEN && /[0-9]/.test(p)),
        ...segments.slice(-1),
        ...[...url.searchParams.values()],
    ];
    for (const part of parts)
    {
        for (const form of [part, safe_decode(part), encodeURIComponent(safe_decode(part))])
        {
            if (form.length >= SHORTEST_TOKEN)
            {
                found.add(form);
            }
        }
    }
};

const is_address = (text: string): boolean=>/^https?:\/\//i.test(text.trim());

// Every link in an answer's body, with its tokens: in a link field at any depth, or the body itself when
// it is nothing but an address.
const links_in = (data: unknown, found: Set<string> = new Set()): Set<string>=>{
    if (typeof data === 'string' && is_address(data))
    {
        add_link(data.trim(), found);
    }
    else if (Array.isArray(data))
    {
        data.forEach(d=>links_in(d, found));
    }
    else if (is_object(data))
    {
        for (const [k, v] of Object.entries(data))
        {
            if (typeof v === 'string' && LINK_FIELDS.includes(k.toLowerCase()))
            {
                add_link(v, found);
            }
            else
            {
                links_in(v, found);
            }
        }
    }
    return found;
};

const redact_links = (text: string, secrets: Iterable<string>): string=>
    [...secrets].sort((a, b)=>b.length - a.length).reduce((t, s)=>t.split(s).join(LINK_REDACTED), text);

// curl -v style, as `reply api --verbose` writes it, with the answer's body after its headers.
const trace_lines = (a: Answer): string[]=>{
    const lines: string[] = [];
    if (a.request)
    {
        lines.push(`> ${a.request.method} ${a.request.url}`);
        for (const [k, v] of Object.entries(a.request.headers))
        {
            lines.push(`> ${k}: ${v}`);
        }
        if (a.request.body)
        {
            lines.push('>', `> ${a.request.body}`);
        }
    }
    lines.push(`< ${a.status}`);
    for (const [k, v] of Object.entries(a.headers))
    {
        lines.push(`< ${k}: ${/cookie/i.test(k) ? REDACTED : v}`);
    }
    if (a.data !== null && a.data !== '')
    {
        const shown = typeof a.data === 'string' ? a.data : JSON.stringify(a.data);
        lines.push('<', `< ${shown}`);
    }
    return lines;
};

// One call of an account command. The links in its answer never reach the trace.
const account_call = async(
    s: Op_session, g: Op_globals, method: string, path: string, kind: Call_kind, body?: unknown,
): Promise<Answer>=>{
    const a = await call_reply(s, method, path, kind, body);
    if (g.verbose)
    {
        console.error(redact_links(trace_lines(a).join('\n'), links_in(a.data)));
    }
    return a;
};

// Reply's refusals of the account routes, each at the status Reply answers it with, under the CLI's
// code. Reply's own code always travels in reply_code; any other answer reads as every operation reads it.
const ACCOUNT_REFUSALS: Record<string, {status: number; code: string; title: string}> = {
    'emailAccount.notFound': {
        status: 404, code: 'email_account.not_found', title: 'Reply has no email account by that id that this user can act on.',
    },
    'emailAccount.limitReached': {
        status: 409, code: 'email_account.limit_reached', title: 'The plan\'s email account limit is reached, so no link was made.',
    },
    'emailAccount.noFreeMailboxSlots': {
        status: 409, code: 'email_account.no_free_mailbox_slots', title: 'One more email account would need a paid seat, so no link was made.',
    },
    'emailAccount.reconnectNotSupported': {
        status: 400, code: 'email_account.reconnect_not_supported',
        title: 'Only a Gmail or Office 365 single-click mailbox can be reconnected by link, so no link was made.',
    },
    'linkedInAccount.notFound': {
        status: 404, code: 'linkedin.account_not_found', title: 'Reply has no LinkedIn account by that id that this user can act on.',
    },
    'linkedInAccount.limitReached': {
        status: 409, code: 'linkedin.account_limit_reached', title: 'The plan has no room for another LinkedIn account, so no link was made.',
    },
    'linkedInAccount.accountInUse': {
        status: 409, code: 'linkedin.account_in_use', title: 'Sequences use the LinkedIn account, so it was not deleted; --force deletes it anyway.',
    },
    'linkedInAccount.cookieInvalid': {
        status: 400, code: 'linkedin.invalid_cookie', title: 'The LinkedIn account\'s session is no longer valid; reconnect the account.',
    },
};

const account_refusal = (a: Answer, kind: Call_kind): Operation_error=>{
    const reply_code = reply_code_of(a);
    const known = reply_code === undefined ? undefined : ACCOUNT_REFUSALS[reply_code];
    if (known === undefined || known.status !== a.status)
    {
        return refusal(a, kind);
    }
    return new Operation_error(known.code, known.title, {status: a.status, reply_code, detail: detail_of(a)});
};

// A route this Reply does not have answers 404 with no code of Reply's; one it has answers its own.
const route_missing = (a: Answer): boolean=>a.status === 404 && reply_code_of(a) === undefined;

export {LINK_REDACTED, ACCOUNT_REFUSALS, account_call, account_refusal, route_missing, links_in, redact_links, add_link};
