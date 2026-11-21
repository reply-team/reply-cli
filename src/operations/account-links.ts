import {Operation_error, UsageError} from '../utils/errors';
import {is_object, open_session, unreadable, type Answer, type Op_session} from './call';
import {account_call, account_refusal, route_missing} from './account-call';
import {ACCOUNT_CHANNELS, require_channel, type Account_channel} from './accounts';
import {parse_choice, parse_id, LARGEST_SAFE_ID, type Op_globals} from './options';
import {print_result} from './result';
import type {Cli_context} from '../context';

// connect, reconnect and pending. A link is a credential for whoever opens it: it is printed once, in the
// stdout field `link`, and nowhere else (see account-call.ts for the trace).

// The providers a one-mailbox email link is made for.
const EMAIL_PROVIDERS = ['gmail', 'office365'] as const;
type Email_provider = typeof EMAIL_PROVIDERS[number];

// link_kind is always connection_link: the field is kept so a caller that reads it reads what it always read.
type Link_result = {
    channel: Account_channel; id?: number; link: string; expires_at: string | null; pending_id: number | null;
    kind: 'connect' | 'reconnect'; link_kind: 'connection_link';
};
// allowSharedPage is accepted and ignored: the hosted mailbox page is no longer printed, and a caller that still passes
// the flag is not refused for it. Deprecated, to be removed in a later release. provider on a reconnect is ignored the
// same way: Reply takes the provider from the mailbox.
type Link_opts = {channel?: string; provider?: string; name?: string; allowSharedPage?: boolean};

const EMAIL_NAME_MAX = 100;     // Reply's limit on a connection link's label

// A Reply without one-mailbox email links: its route answers 404 with no code of Reply's own. Nothing else is offered.
const email_link_not_available = (): Operation_error=>new Operation_error('email_link.not_available',
    'This Reply does not issue one-mailbox email connection links, so no link was made.', {status: 404});

const text_or_null = (v: unknown): string | null=>(typeof v === 'string' && v.trim() !== '' ? v : null);
const positive_or_null = (v: unknown): number | null=>(typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);

// The link of a v3 answer, or an unreadable answer: the write was made, so a link Reply did not give back
// means one may exist that nobody holds.
const link_of = (a: Answer): {link: string; body: Record<string, unknown>}=>{
    if (!is_object(a.data) || typeof a.data.connectionLink !== 'string' || a.data.connectionLink === '')
    {
        throw unreadable(a, 'write');
    }
    return {link: a.data.connectionLink, body: a.data};
};

const connection_link = (channel: Account_channel, kind: 'connect' | 'reconnect', a: Answer, id?: number): Link_result=>{
    const {link, body} = link_of(a);
    return {
        channel, ...(id === undefined ? {} : {id}), link,
        expires_at: text_or_null(body.expiresAtUtc), pending_id: positive_or_null(body.pendingAccountId),
        kind, link_kind: 'connection_link',
    };
};

const parse_provider = (raw: string | undefined): Email_provider | undefined=>parse_choice(raw, '--provider', EMAIL_PROVIDERS);

const email_only = (opts: Link_opts): void=>{
    if (opts.provider !== undefined)
    {
        throw new UsageError('--provider applies to --channel email only.', {code: 'usage.channel'});
    }
};

const connect_linkedin = async(s: Op_session, g: Op_globals, name: string): Promise<Link_result>=>{
    // connection-link, not connect: it makes a pending entry, so the attempt can be listed and revoked.
    const a = await account_call(s, g, 'POST', '/v3/linkedin-accounts/connection-link', 'write', {name});
    if (a.status !== 201 && a.status !== 200)
    {
        throw account_refusal(a, 'write');
    }
    return connection_link('linkedin', 'connect', a);
};

const connect_email = async(s: Op_session, g: Op_globals, provider: Email_provider, name: string | undefined): Promise<Link_result>=>{
    const a = await account_call(s, g, 'POST', '/v3/email-accounts/connection-link', 'write', {provider, ...(name === undefined ? {} : {name})});
    if (a.status === 201 || a.status === 200)
    {
        return connection_link('email', 'connect', a);
    }
    throw route_missing(a) ? email_link_not_available() : account_refusal(a, 'write');
};

const handle_account_connect = async(opts: Link_opts, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const channel = require_channel(opts.channel);
    const name = opts.name?.trim() === '' ? undefined : opts.name?.trim();
    if (channel === 'linkedin')
    {
        email_only(opts);
        if (name === undefined)
        {
            throw new UsageError('--name is required for a LinkedIn connection link: Reply lists the pending account under it.', {
                code: 'usage.name',
            });
        }
        const s = await open_session(ctx, g);
        print_result(await connect_linkedin(s, g, name), g);
        return;
    }
    const provider = parse_provider(opts.provider);
    if (name !== undefined && name.length > EMAIL_NAME_MAX)
    {
        throw new UsageError(`--name must be at most ${EMAIL_NAME_MAX} characters.`, {code: 'usage.name'});
    }
    if (provider === undefined)
    {
        throw new UsageError('--provider is required for an email connection link: gmail or office365.', {code: 'usage.provider'});
    }
    const s = await open_session(ctx, g);
    print_result(await connect_email(s, g, provider, name), g);
};

const handle_account_reconnect = async(id_arg: string, opts: Link_opts, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const channel = require_channel(opts.channel);
    if (opts.name !== undefined)
    {
        throw new UsageError('--name applies to account connect only.', {code: 'usage.name'});
    }
    if (channel === 'linkedin')
    {
        email_only(opts);
        const id = parse_id(id_arg, 'LinkedIn account id');
        const s = await open_session(ctx, g);
        const a = await account_call(s, g, 'POST', `/v3/linkedin-accounts/${id}/reconnect`, 'write');
        if (a.status !== 200)
        {
            throw account_refusal(a, 'write');
        }
        print_result(connection_link('linkedin', 'reconnect', a, id), g);
        return;
    }
    const id = parse_id(id_arg, 'Email account id', LARGEST_SAFE_ID);
    const s = await open_session(ctx, g);
    // Reply takes the provider from the mailbox itself.
    const a = await account_call(s, g, 'POST', `/v3/email-accounts/${id}/reconnect`, 'write');
    if (a.status === 200 || a.status === 201)
    {
        print_result(connection_link('email', 'reconnect', a, id), g);
        return;
    }
    throw route_missing(a) ? email_link_not_available() : account_refusal(a, 'write');
};

type Pending_item = {
    channel: Account_channel; id: number; name: string | null; kind: 'connect' | 'reconnect' | null; account_id: number | null;
    expires_at: string | null; expired: boolean | null;
};

const pending_items = (a: Answer, channel: Account_channel): Pending_item[]=>{
    if (!Array.isArray(a.data))
    {
        throw unreadable(a, 'read');
    }
    return a.data.map(entry=>{
        if (!is_object(entry) || positive_or_null(entry.id) === null)
        {
            throw new Operation_error('reply.unavailable', 'Reply listed a pending account without a usable id.', {status: a.status});
        }
        // A pending LinkedIn account is always a connect, and its link is not kept: it is a credential.
        const kind = channel === 'linkedin' ? 'connect' : (entry.kind === 'connect' || entry.kind === 'reconnect' ? entry.kind : null);
        return {
            channel, id: entry.id as number, name: text_or_null(entry.name), kind,
            account_id: channel === 'email' ? positive_or_null(entry.emailAccountId) : null,
            expires_at: text_or_null(entry.expiresAtUtc), expired: typeof entry.isExpired === 'boolean' ? entry.isExpired : null,
        };
    });
};

const handle_account_pending = async(opts: {channel?: string}, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const only = parse_choice(opts.channel, '--channel', ACCOUNT_CHANNELS);
    const s = await open_session(ctx, g);
    const items: Pending_item[] = [];
    if (only !== 'linkedin')
    {
        const a = await account_call(s, g, 'GET', '/v3/email-accounts/pending', 'read');
        if (a.status !== 200)
        {
            throw route_missing(a) ? email_link_not_available() : account_refusal(a, 'read');
        }
        items.push(...pending_items(a, 'email'));
    }
    if (only !== 'email')
    {
        const a = await account_call(s, g, 'GET', '/v3/linkedin-accounts/pending', 'read');
        if (a.status !== 200)
        {
            throw account_refusal(a, 'read');
        }
        items.push(...pending_items(a, 'linkedin'));
    }
    // supported and unsupported_channels are kept so a caller that reads them reads what it always read; a Reply
    // without one-mailbox email links is refused above, so every channel listed is supported.
    print_result({items, supported: true, unsupported_channels: []}, g);
};

export {handle_account_connect, handle_account_reconnect, handle_account_pending};
