import {Operation_error} from '../utils/errors';
import {call_reply, read_page, refusal, unreadable, is_object, open_session, type Op_session} from './call';
import {parse_choice, type Op_globals} from './options';
import {print_result} from './result';
import type {Cli_context} from '../context';

const ACCOUNT_CHANNELS = ['email', 'linkedin'] as const;
type Account_channel = typeof ACCOUNT_CHANNELS[number];
type Account_status = 'active' | 'inactive' | 'disconnected' | 'other';
type Account = {
    id: number; channel: Account_channel; name: string | null; address: string | null; owner_user_id: number | null;
    status: Account_status; reply_status: string | null;
};

// Reply's words for an account's state, and the CLI's. A word not here is `other`; Reply's own word
// always goes beside it. A LinkedIn account at its daily limit is on and connected, so it is
// active: a send that meets the limit answers linkedin.limit_reached.
const EMAIL_STATUSES: Record<string, Account_status> = {connected: 'active', disconnected: 'disconnected', unknown: 'other'};
const LINKEDIN_STATUSES: Record<string, Account_status> = {
    enabled: 'active', disabled: 'inactive', cookieInvalid: 'disconnected', dailyLimitReached: 'active',
};

const PAGE = 1000;          // the most Reply gives in one page of email accounts
const MAX_PAGES = 20;

const text_or_null = (v: unknown): string | null=>(typeof v === 'string' && v.trim() !== '' ? v : null);

const positive_integer = (v: unknown): number | null=>(typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);

const account_of = (
    entry: unknown, channel: Account_channel, words: Record<string, Account_status>, fields: {name: string; address: string; status: string},
): Account=>{
    // Email account ids are 64-bit at Reply; any whole number a JSON number carries exactly is one.
    if (!is_object(entry) || typeof entry.id !== 'number' || !Number.isSafeInteger(entry.id) || entry.id <= 0)
    {
        throw new Operation_error('reply.unavailable', 'Reply listed an account without a usable id.', {status: 200});
    }
    const word = entry[fields.status];
    return {
        id: entry.id, channel,
        name: text_or_null(entry[fields.name]),
        address: text_or_null(entry[fields.address]),
        // In a team that shares its accounts, Reply lists teammates' accounts too; this says whose each one is.
        owner_user_id: positive_integer(entry.ownerUserId),
        status: typeof word === 'string' && Object.prototype.hasOwnProperty.call(words, word) ? words[word] : 'other',
        reply_status: typeof word === 'string' ? word : null,
    };
};

// Every page, to the end: a list cut short would leave out an account a send could go from.
const email_accounts = async(s: Op_session): Promise<Account[]>=>{
    const accounts: Account[] = [];
    for (let n = 0; n < MAX_PAGES; n++)
    {
        const a = await call_reply(s, 'GET', `/v3/email-accounts?top=${PAGE}&skip=${n * PAGE}`, 'read');
        if (a.status !== 200)
        {
            throw refusal(a, 'read');
        }
        const page = read_page(a);
        accounts.push(...page.items.map(e=>account_of(e, 'email', EMAIL_STATUSES, {name: 'senderName', address: 'email', status: 'connectionStatus'})));
        if (!page.has_more)
        {
            return accounts;
        }
    }
    throw new Operation_error('account.list_incomplete', `Reply's list of email accounts did not end within ${MAX_PAGES * PAGE}.`, {status: 200});
};

// Reply gives every LinkedIn account in one answer, with no paging.
const linkedin_accounts = async(s: Op_session): Promise<Account[]>=>{
    const a = await call_reply(s, 'GET', '/v3/linkedin-accounts', 'read');
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    if (!Array.isArray(a.data))
    {
        throw unreadable(a, 'read');
    }
    return a.data.map(e=>account_of(e, 'linkedin', LINKEDIN_STATUSES, {name: 'name', address: 'profileUrl', status: 'status'}));
};

const handle_account_list = async(opts: {channel?: string}, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const channel = parse_choice(opts.channel, '--channel', ACCOUNT_CHANNELS);
    const s = await open_session(ctx, g);
    const items = [
        ...(channel === 'linkedin' ? [] : await email_accounts(s)),
        ...(channel === 'email' ? [] : await linkedin_accounts(s)),
    ];
    print_result({items}, g);
};

export {handle_account_list};
