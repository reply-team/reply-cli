import {Operation_error, UsageError} from '../utils/errors';
import {warn} from '../utils/output';
import {read_json_arg} from '../utils/json-arg';
import {expect_object, is_object, open_session, type Op_session} from './call';
import {account_call, account_refusal} from './account-call';
import {LINKEDIN_STATUSES, require_channel, type Account_channel, type Account_status} from './accounts';
import {parse_id, parse_int_in, LARGEST_SAFE_ID, type Op_globals} from './options';
import {print_result} from './result';
import type {Cli_context} from '../context';

// limits, pause, resume, unblock and delete: an account's settings and state, by channel.

const email_id = (raw: string): number=>parse_id(raw, 'Email account id', LARGEST_SAFE_ID);
const linkedin_id = (raw: string): number=>parse_id(raw, 'LinkedIn account id');

// The fields of each channel's limits a caller may set, in Reply's names: an email account's safety
// section, and a LinkedIn account's limits update.
const EMAIL_LIMIT_FIELDS = [
    'dailyLimit', 'isEmailsThrottlingEnabled', 'emailsPerInterval', 'emailsThrottlingSecondsInterval', 'isSendingDelayEnabled',
    'maxSendingDelaySeconds', 'minSendingDelaySeconds',
];
const LINKEDIN_LIMIT_FIELDS = ['limitsMode', 'rangeMin', 'rangeMax', 'fixedMax', 'actionDelayMinSeconds', 'actionDelayMaxSeconds'];
const LARGEST_DAILY = 2147483647;

const read_limits_arg = (raw: string, fields: string[]): Record<string, unknown>=>{
    const value = read_json_arg(raw, {flag: '--set', what: 'limits', code: 'usage.limits'});
    if (!is_object(value) || Object.keys(value).length === 0)
    {
        throw new UsageError('--set must be a JSON object naming at least one limit.', {code: 'usage.limits', hint: `Fields: ${fields.join(', ')}.`});
    }
    const unknown_field = Object.keys(value).find(k=>!fields.includes(k));
    if (unknown_field !== undefined)
    {
        throw new UsageError(`--set has an unknown field '${unknown_field}'.`, {code: 'usage.limits', hint: `Fields: ${fields.join(', ')}.`});
    }
    return value;
};

const section_of = (data: Record<string, unknown>, field: string): Record<string, unknown> | null=>
    (is_object(data[field]) ? data[field] as Record<string, unknown> : null);

const email_limits = async(s: Op_session, g: Op_globals, id: number, change: Record<string, unknown> | null): Promise<unknown>=>{
    // PATCH answers the account as it is afterwards, so a change needs no read after it.
    const a = change === null
        ? await account_call(s, g, 'GET', `/v3/email-accounts/${id}`, 'read')
        : await account_call(s, g, 'PATCH', `/v3/email-accounts/${id}`, 'write', {safety: change});
    const kind = change === null ? 'read' : 'write';
    if (a.status !== 200)
    {
        throw account_refusal(a, kind);
    }
    return section_of(expect_object(a, kind), 'safety');
};

const read_linkedin_account = async(s: Op_session, g: Op_globals, id: number): Promise<Record<string, unknown>>=>{
    const a = await account_call(s, g, 'GET', `/v3/linkedin-accounts/${id}`, 'read');
    if (a.status !== 200)
    {
        throw account_refusal(a, 'read');
    }
    return expect_object(a, 'read');
};

const linkedin_limits = async(s: Op_session, g: Op_globals, id: number, change: Record<string, unknown> | null): Promise<unknown>=>{
    if (change !== null)
    {
        const a = await account_call(s, g, 'PUT', `/v3/linkedin-accounts/${id}/limits`, 'write', change);
        if (a.status !== 204 && a.status !== 200)
        {
            throw account_refusal(a, 'write');
        }
        try {
            return section_of(await read_linkedin_account(s, g, id), 'limits');
        } catch (e) {
            if (!(e instanceof Operation_error))
            {
                throw e;
            }
            // The limits are saved; only reading them back failed, and failing the command would say they were not.
            warn(`The limits were saved, but reading them back failed (${e.code}); run the command without --set to read them.`);
            return null;
        }
    }
    return section_of(await read_linkedin_account(s, g, id), 'limits');
};

const handle_account_limits = async(
    id_arg: string, opts: {channel?: string; daily?: string; set?: string}, ctx: Cli_context, g: Op_globals,
): Promise<void>=>{
    const channel = require_channel(opts.channel);
    if (channel === 'linkedin')
    {
        const id = linkedin_id(id_arg);
        if (opts.daily !== undefined)
        {
            throw new UsageError('--daily applies to --channel email only: a LinkedIn account\'s limits are per action.', {
                code: 'usage.limits', hint: `Set them with --set, e.g. --set '{"fixedMax":{"dailySendMessageCount":50}}'.`,
            });
        }
        const change = opts.set === undefined ? null : read_limits_arg(opts.set, LINKEDIN_LIMIT_FIELDS);
        const s = await open_session(ctx, g);
        print_result({channel, id, limits: await linkedin_limits(s, g, id, change)}, g);
        return;
    }
    const id = email_id(id_arg);
    const set = opts.set === undefined ? {} : read_limits_arg(opts.set, EMAIL_LIMIT_FIELDS);
    const daily = opts.daily === undefined ? undefined : parse_int_in(opts.daily, '--daily', 0, LARGEST_DAILY, 0);
    const change = {...set, ...(daily === undefined ? {} : {dailyLimit: daily})};
    const s = await open_session(ctx, g);
    print_result({channel, id, limits: await email_limits(s, g, id, Object.keys(change).length === 0 ? null : change)}, g);
};

// Reply has no pause for a mailbox; what it has clears a block the provider put on sending.
const linkedin_only = (channel: Account_channel, verb: 'pause' | 'resume'): void=>{
    if (channel === 'email')
    {
        throw new UsageError(`Reply has no way to ${verb} a mailbox through its API.`, {
            code: 'usage.unsupported',
            hint: verb === 'resume' ? 'A mailbox its provider stopped from sending is unblocked with `account unblock <id>`.' : undefined,
        });
    }
};

const status_word = (v: unknown): Account_status=>
    (typeof v === 'string' && Object.prototype.hasOwnProperty.call(LINKEDIN_STATUSES, v) ? LINKEDIN_STATUSES[v] : 'other');

// Reply's only call flips the state, so the state is read first and the call made only when it is not
// already the one asked for.
const set_linkedin_state = async(id_arg: string, opts: {channel?: string}, verb: 'pause' | 'resume', ctx: Cli_context, g: Op_globals)=>{
    const channel = require_channel(opts.channel);
    linkedin_only(channel, verb);
    const id = linkedin_id(id_arg);
    const wanted: Account_status = verb === 'pause' ? 'inactive' : 'active';
    const s = await open_session(ctx, g);
    const account = await read_linkedin_account(s, g, id);
    const before = status_word(account.status);
    if (account.status === 'cookieInvalid')
    {
        throw new Operation_error('linkedInAccount.cookieInvalid', `The LinkedIn account is disconnected, so it cannot be ${verb}d.`, {
            status: 200, hint: `Reconnect it first: account reconnect ${id} --channel linkedin.`,
        });
    }
    if (before === wanted)
    {
        print_result({channel, id, status: before, reply_status: account.status, changed: false}, g);
        return;
    }
    if (before !== 'active' && before !== 'inactive')
    {
        throw new Operation_error('account.status_unknown', 'Reply gave the LinkedIn account a state the CLI does not know, so nothing was changed.', {
            status: 200, details: {reply_status: typeof account.status === 'string' ? account.status : null},
        });
    }
    const a = await account_call(s, g, 'POST', `/v3/linkedin-accounts/${id}/toggle-status`, 'write');
    if (a.status !== 200)
    {
        throw account_refusal(a, 'write');
    }
    const after = expect_object(a, 'write').status;
    if (status_word(after) !== wanted)
    {
        // Someone else changed it between the read and the call, and the flip undid theirs.
        throw new Operation_error('account.status_changed', `The account's state changed while it was being ${verb}d; read it and try again.`, {
            status: 200, details: {reply_status: typeof after === 'string' ? after : null},
        });
    }
    print_result({channel, id, status: wanted, reply_status: after, changed: true}, g);
};

const handle_account_pause = (id_arg: string, opts: {channel?: string}, ctx: Cli_context, g: Op_globals): Promise<void>=>
    set_linkedin_state(id_arg, opts, 'pause', ctx, g);

const handle_account_resume = (id_arg: string, opts: {channel?: string}, ctx: Cli_context, g: Op_globals): Promise<void>=>
    set_linkedin_state(id_arg, opts, 'resume', ctx, g);

const handle_account_unblock = async(id_arg: string, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const id = email_id(id_arg);
    const s = await open_session(ctx, g);
    const a = await account_call(s, g, 'POST', `/v3/email-accounts/${id}/resume-sending`, 'write');
    if (a.status !== 204 && a.status !== 200)
    {
        throw account_refusal(a, 'write');
    }
    print_result({channel: 'email', id, unblocked: true}, g);
};

const handle_account_delete = async(
    id_arg: string, opts: {channel?: string; yes?: boolean; force?: boolean}, ctx: Cli_context, g: Op_globals,
): Promise<void>=>{
    const channel = require_channel(opts.channel);
    const id = channel === 'email' ? email_id(id_arg) : linkedin_id(id_arg);
    if (opts.force === true && channel === 'email')
    {
        throw new UsageError('--force applies to --channel linkedin only.', {code: 'usage.force'});
    }
    if (opts.yes !== true)
    {
        throw new UsageError('Deleting an account cannot be undone: pass --yes to delete it.', {code: 'usage.confirm'});
    }
    const path = channel === 'email' ? `/v3/email-accounts/${id}` : `/v3/linkedin-accounts/${id}${opts.force === true ? '?force=true' : ''}`;
    const s = await open_session(ctx, g);
    const a = await account_call(s, g, 'DELETE', path, 'write');
    if (a.status !== 204 && a.status !== 200)
    {
        throw account_refusal(a, 'write');
    }
    print_result({channel, id, deleted: true}, g);
};

export {handle_account_limits, handle_account_pause, handle_account_resume, handle_account_unblock, handle_account_delete};
