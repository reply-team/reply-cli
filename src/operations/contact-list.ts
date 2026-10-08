import {Operation_error, type Ids} from '../utils/errors';
import {call_reply, expect_object, item_failure, refusal, reply_code_of, open_session, type Op_session} from './call';
import {parse_id, parse_idempotency_key, type Op_globals} from './options';
import {read_contact_input, type Contact_flags} from './contact-input';
import {ensure_contact, read_opted_out} from './contacts';
import {print_result, with_ids} from './result';
import type {Cli_context} from '../context';

type List_add_opts = Contact_flags & {refuseOptedOut?: boolean; idempotencyKey?: string};

const add_to_list = async(s: Op_session, list_id: number, contact_id: number): Promise<void>=>{
    const a = await call_reply(s, 'POST', `/v3/contact-lists/${list_id}/add-contacts`, 'write', {contactIds: [contact_id]});
    if (a.status === 404)
    {
        throw new Operation_error('contact-list.not_found', `This account has no contact list ${list_id}.`, {
            status: 404, reply_code: reply_code_of(a),
        });
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
    parse_idempotency_key(opts.idempotencyKey);
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

export {handle_contact_list_add_contact};
export type {List_add_opts};
