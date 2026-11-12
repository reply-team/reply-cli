import {REDACTED} from '../utils/output';
import {Operation_error} from '../utils/errors';
import {call_reply, detail_of, is_object, refusal, reply_code_of, type Answer, type Op_session} from './call';
import type {Call_kind} from '../utils/client';
import type {Op_globals} from './options';

// The calls of the account commands, and what they write to stderr under --verbose. A connection link,
// the shared page's address and any token in them are handed over once, in the stdout field `link`: in a
// trace each is replaced by LINK_REDACTED, wherever it appears.

const LINK_REDACTED = '<link redacted>';

// The fields Reply hands a link in: v3's connectionLink and the v1 shared page's url.
const LINK_FIELDS = ['connectionlink', 'url'];

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

// Every link in an answer's body, at any depth, with its tokens.
const links_in = (data: unknown, found: Set<string> = new Set()): Set<string>=>{
    if (Array.isArray(data))
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
        lines.push('<', `< ${typeof a.data === 'string' ? a.data : JSON.stringify(a.data)}`);
    }
    return lines;
};

const print_trace = (a: Answer, secrets: Iterable<string>): void=>{
    console.error(redact_links(trace_lines(a).join('\n'), secrets));
};

// One call of an account command. `secrets` names what the caller already holds that the trace must not
// show; the links in the answer itself are found here.
const account_call = async(
    s: Op_session, g: Op_globals, method: string, path: string, kind: Call_kind, body?: unknown, secrets: Iterable<string> = [],
): Promise<Answer>=>{
    const a = await call_reply(s, method, path, kind, body);
    if (g.verbose)
    {
        print_trace(a, [...secrets, ...links_in(a.data)]);
    }
    return a;
};

// A refusal of an account command. Reply's own code is the error's code, as Reply gave it; an answer
// without one, a credential refused, a pace and a failure of Reply's are read as every operation reads them.
const account_refusal = (a: Answer, kind: Call_kind): Operation_error=>{
    const code = reply_code_of(a);
    if (code !== undefined && a.status >= 400 && a.status < 500 && a.status !== 401 && a.status !== 429)
    {
        return new Operation_error(code, 'Reply refused the call.', {status: a.status, reply_code: code, detail: detail_of(a)});
    }
    return refusal(a, kind);
};

// A route this Reply does not have answers 404 with no code of Reply's; one it has answers its own.
const route_missing = (a: Answer): boolean=>a.status === 404 && reply_code_of(a) === undefined;

export {LINK_REDACTED, account_call, account_refusal, route_missing, links_in, redact_links, add_link};
