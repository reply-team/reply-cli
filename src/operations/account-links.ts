import {Operation_error, UsageError} from '../utils/errors';
import {is_object, open_session, refusal, unreadable, type Answer, type Op_session} from './call';
import {account_call, account_refusal, route_missing, without_secrets} from './account-call';
import {HOSTED_PROVIDERS, SHARED_PAGE_WARNING, read_shared_page, shared_page_link, type Hosted_provider} from './shared-page';
import {ACCOUNT_CHANNELS, require_channel, type Account_channel} from './accounts';
import {parse_choice, parse_id, LARGEST_SAFE_ID, type Op_globals} from './options';
import {print_result} from './result';
import type {Cli_context} from '../context';

// connect, reconnect and pending. A link is a credential for whoever opens it: it is printed once, in the
// stdout field `link`, and nowhere else (see account-call.ts for the trace).

type Link_kind = 'connection_link' | 'shared_page';
type Link_result = {
    channel: Account_channel; id?: number; link: string; expires_at: string | null; pending_id: number | null;
    kind: 'connect' | 'reconnect'; link_kind: Link_kind; warning?: string;
};
type Link_opts = {channel?: string; provider?: string; name?: string; allowSharedPage?: boolean};

const EMAIL_NAME_MAX = 100;     // Reply's limit on a connection link's label

const email_link_not_available = (): Operation_error=>new Operation_error('email_link.not_available',
    'This Reply does not issue one-mailbox email connection links yet, so no link was made.', {
        status: 404,
        hint: 'With --allow-shared-page the account\'s hosted mailbox page is printed instead; '
            + `${SHARED_PAGE_WARNING}.`,
    });

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

// The account user's hosted mailbox page, from Reply's v1 route: the provider's connect when one is named,
// else the index. Reply's v1 gives no code, so the plan's refusal is named here.
const shared_page = async(
    s: Op_session, g: Op_globals, kind: 'connect' | 'reconnect', provider: Hosted_provider | undefined, id?: number,
): Promise<Link_result>=>{
    // Its answer is the address, in whatever shape Reply gives it, so the whole body is a secret.
    const a = await account_call(s, g, 'GET', '/v1/SharedPageUrl', 'read', undefined, {secret_body: true});
    if (a.status === 403 && /shared page is not enabled/i.test(JSON.stringify(a.data ?? '')))
    {
        throw new Operation_error('shared_page.not_enabled', 'The account\'s plan does not include hosted pages, so there is no shared page.', {
            status: 403,
        });
    }
    if (a.status !== 200)
    {
        throw refusal(without_secrets(a), 'read');
    }
    // {"url": …} as Reply's v1 answers it; a bare string is read as the address too.
    const url = typeof a.data === 'string' ? a.data.trim() : is_object(a.data) ? a.data.url ?? a.data.Url : undefined;
    const page = typeof url === 'string' ? read_shared_page(url) : null;
    if (page === null)
    {
        throw unreadable(a, 'read');
    }
    return {
        channel: 'email', ...(id === undefined ? {} : {id}), link: shared_page_link(page, provider, kind),
        expires_at: null, pending_id: null, kind, link_kind: 'shared_page', warning: SHARED_PAGE_WARNING,
    };
};

const parse_provider = (raw: string | undefined): Hosted_provider | undefined=>parse_choice(raw, '--provider', HOSTED_PROVIDERS);

const email_only = (opts: Link_opts): void=>{
    for (const [value, flag] of [[opts.provider, '--provider'], [opts.allowSharedPage, '--allow-shared-page']] as const)
    {
        if (value !== undefined && value !== false)
        {
            throw new UsageError(`${flag} applies to --channel email only.`, {code: 'usage.channel'});
        }
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

const connect_email = async(
    s: Op_session, g: Op_globals, provider: Hosted_provider | undefined, name: string | undefined, allow_shared_page: boolean,
): Promise<Link_result>=>{
    if (provider === undefined)
    {
        // Reply's one-mailbox link is made for one provider. The shared page's index needs none, and is
        // given only by a Reply without those links: a read of their list says which Reply this is.
        const probe = await account_call(s, g, 'GET', '/v3/email-accounts/pending', 'read');
        if (!route_missing(probe))
        {
            if (probe.status === 401 || probe.status === 429 || probe.status >= 500)
            {
                throw refusal(probe, 'read');
            }
            throw new Operation_error('email_link.provider_required',
                'This Reply issues one-mailbox connection links, and each is made for one provider, so none was made.', {
                    status: probe.status, hint: 'Name the mailbox\'s provider: --provider gmail or --provider office365.',
                });
        }
        return shared_page(s, g, 'connect', undefined);
    }
    const a = await account_call(s, g, 'POST', '/v3/email-accounts/connection-link', 'write', {provider, ...(name === undefined ? {} : {name})});
    if (a.status === 201 || a.status === 200)
    {
        return connection_link('email', 'connect', a);
    }
    if (!route_missing(a))
    {
        throw account_refusal(a, 'write');
    }
    if (!allow_shared_page)
    {
        throw email_link_not_available();
    }
    return shared_page(s, g, 'connect', provider);
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
    if (provider === undefined && opts.allowSharedPage !== true)
    {
        throw new UsageError('--provider is required for an email connection link: gmail or office365.', {
            code: 'usage.provider',
            hint: 'Only with --allow-shared-page, and only on a Reply without one-mailbox links, does the CLI print the hosted '
                + 'mailbox page without a provider.',
        });
    }
    const s = await open_session(ctx, g);
    print_result(await connect_email(s, g, provider, name, opts.allowSharedPage === true), g);
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
    const provider = parse_provider(opts.provider);
    const s = await open_session(ctx, g);
    // Reply takes the provider from the mailbox itself; --provider picks only the shared page's address.
    const a = await account_call(s, g, 'POST', `/v3/email-accounts/${id}/reconnect`, 'write');
    if (a.status === 200 || a.status === 201)
    {
        print_result(connection_link('email', 'reconnect', a, id), g);
        return;
    }
    if (!route_missing(a))
    {
        throw account_refusal(a, 'write');
    }
    if (opts.allowSharedPage !== true)
    {
        throw email_link_not_available();
    }
    print_result(await shared_page(s, g, 'reconnect', provider, id), g);
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
    const unsupported: Account_channel[] = [];
    if (only !== 'linkedin')
    {
        const a = await account_call(s, g, 'GET', '/v3/email-accounts/pending', 'read');
        if (route_missing(a))
        {
            unsupported.push('email');
        }
        else if (a.status === 200)
        {
            items.push(...pending_items(a, 'email'));
        }
        else
        {
            throw account_refusal(a, 'read');
        }
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
    print_result({items, supported: unsupported.length === 0, unsupported_channels: unsupported}, g);
};

export {handle_account_connect, handle_account_reconnect, handle_account_pending};
