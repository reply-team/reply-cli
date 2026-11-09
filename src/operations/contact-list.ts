import {Operation_error, Unknown_outcome_error, type Ids} from '../utils/errors';
import {
    call_reply, expect_object, is_reply_id, item_failure, read_page, refusal, reply_code_of, unreadable, open_session, type Answer,
    type Op_session,
} from './call';
import {parse_id, parse_int_in, type Op_globals} from './options';
import {read_contact_input, type Contact_flags} from './contact-input';
import {ensure_contact, read_opted_out} from './contacts';
import {read_stdin_name} from './stdin-input';
import {print_result, with_ids} from './result';
import {PROGRAM_NAME} from '../config';
import type {Cli_context} from '../context';

type List_add_opts = Contact_flags & {refuseOptedOut?: boolean};

const list_not_found = (list_id: number, a: Answer): Operation_error=>
    new Operation_error('contact-list.not_found', `This account has no contact list ${list_id}.`, {status: a.status, reply_code: reply_code_of(a)});

const add_to_list = async(s: Op_session, list_id: number, contact_id: number): Promise<void>=>{
    const a = await call_reply(s, 'POST', `/v3/contact-lists/${list_id}/add-contacts`, 'write', {contactIds: [contact_id]});
    if (a.status === 404)
    {
        throw list_not_found(list_id, a);
    }
    if (a.status !== 200)
    {
        throw refusal(a, 'write');
    }
    // The answer is a failures-only dictionary: a contact missing from it was added, or already
    // on the list.
    const failed = item_failure(expect_object(a, 'write'), contact_id);
    if (failed !== undefined)
    {
        throw new Operation_error('reply.refused', 'Reply did not add the contact to the list.', {
            status: 200, reply_code: failed.error ?? undefined, detail: failed.details ?? undefined,
        });
    }
};

const handle_contact_list_add_contact = async(
    list_arg: string, opts: List_add_opts, ctx: Cli_context, g: Op_globals, read_stdin?: () => string,
): Promise<void>=>{
    const list_id = parse_id(list_arg, 'List id');
    const contact = read_contact_input(opts, read_stdin);
    const s = await open_session(ctx, g);
    const ids: Ids = {list_id};
    try {
        const ensured = await ensure_contact(s, contact);
        ids.contact_id = ensured.id;
        // The caller's policy, not an API gap: a Reply list may hold opted-out contacts, but a
        // caller that keeps opted-out people off its outreach lists asks for the check.
        if (opts.refuseOptedOut === true && await read_opted_out(s, ensured.id))
        {
            throw new Operation_error('contact.opted_out', `Contact ${ensured.id} is opted out, so it was not added to the list.`, {status: 200});
        }
        await add_to_list(s, list_id, ensured.id);
        print_result({status: 'added', list_id, contact_id: ensured.id, contact_created: ensured.created}, g);
    } catch (e) {
        throw with_ids(e, ids);
    }
};

// Reply refuses a second list of one name; the caller picks another name, nothing is looked up here.
const handle_contact_list_create = async(
    opts: {name?: string; shared?: boolean}, ctx: Cli_context, g: Op_globals, read_stdin?: () => string,
): Promise<void>=>{
    const name = read_stdin_name(opts.name, 'contact-list create', read_stdin);
    const s = await open_session(ctx, g);
    let made: Record<string, unknown>;
    try {
        const a = await call_reply(s, 'POST', '/v3/contact-lists', 'write', {name, isShared: opts.shared === true});
        if (a.status === 409 && reply_code_of(a) === 'contactsList.duplicateName')
        {
            throw new Operation_error('contact-list.name_taken', 'This account already has a contact list of that name.', {
                status: 409, reply_code: reply_code_of(a),
            });
        }
        if (a.status !== 201 && a.status !== 200)
        {
            throw refusal(a, 'write');
        }
        made = expect_object(a, 'write');
        if (!is_reply_id(made.id))
        {
            throw unreadable(a, 'write');
        }
    } catch (e) {
        if (e instanceof Unknown_outcome_error)
        {
            e.hint = 'The list may have been made, and a repeat under the same name answers contact-list.name_taken. '
                + `\`${PROGRAM_NAME} api '/v3/contact-lists?search=<name>'\` finds it by its name.`;
        }
        throw e;
    }
    print_result({
        status: 'created', list_id: made.id,
        name: typeof made.name === 'string' ? made.name : null,
        is_shared: typeof made.isShared === 'boolean' ? made.isShared : null,
    }, g);
};

const handle_contact_list_get = async(list_arg: string, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const list_id = parse_id(list_arg, 'List id');
    const s = await open_session(ctx, g);
    const a = await call_reply(s, 'GET', `/v3/contact-lists/${list_id}`, 'read');
    if (a.status === 404)
    {
        throw list_not_found(list_id, a);
    }
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    print_result(expect_object(a, 'read'), g);
};

const handle_contact_list_delete = async(list_arg: string, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const list_id = parse_id(list_arg, 'List id');
    const s = await open_session(ctx, g);
    try {
        const a = await call_reply(s, 'DELETE', `/v3/contact-lists/${list_id}`, 'write');
        if (a.status === 404)
        {
            throw list_not_found(list_id, a);
        }
        if (a.status !== 204 && a.status !== 200)
        {
            throw refusal(a, 'write');
        }
        print_result({status: 'deleted', list_id}, g);
    } catch (e) {
        if (e instanceof Unknown_outcome_error)
        {
            e.hint = 'The list may have been deleted. Running the command again is safe; it answers contact-list.not_found if it was.';
        }
        throw with_ids(e, {list_id});
    }
};

// Oldest first. Reply sorts by date added, equal dates by contact id, highest first, so the order holds from page to
// page; for a list one search fills, each batch lands at its end. A POST that changes nothing: the filter is the body.
const handle_contact_list_contacts = async(
    list_arg: string, opts: {liveDataOnly?: boolean; limit?: string; offset?: string}, ctx: Cli_context, g: Op_globals,
): Promise<void>=>{
    const list_id = parse_id(list_arg, 'List id');
    const limit = parse_int_in(opts.limit, '--limit', 1, 1000, 100);
    const offset = parse_int_in(opts.offset, '--offset', 0, 1000000, 0);
    const filter: Record<string, unknown> = {listId: list_id, sortBy: 'addedOn', sortDirection: 'asc'};
    if (opts.liveDataOnly === true)
    {
        filter.conditions = [{field: 'creationSource', operator: 'equals', value: 'liveData'}];
    }
    const s = await open_session(ctx, g);
    const a = await call_reply(s, 'POST', `/v3/contacts/filter?top=${limit}&skip=${offset}`, 'read', filter);
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    const page = read_page(a);
    print_result({items: page.items, has_more: page.has_more}, g);
};

export {
    handle_contact_list_add_contact, handle_contact_list_create, handle_contact_list_get, handle_contact_list_delete, handle_contact_list_contacts,
};
export type {List_add_opts};
