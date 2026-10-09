import {Operation_error, type Ids} from '../utils/errors';
import {call_reply, expect_object, item_failure, refusal, open_session, type Op_session} from './call';
import type {Op_globals} from './options';
import {read_contact_input, type Contact_flags} from './contact-input';
import {ensure_contact, find_contact} from './contacts';
import {print_result, with_ids} from './result';
import type {Cli_context} from '../context';

type Opt_out_opts = Contact_flags;

// Sets the flag; there is no read before it, because Reply answers a contact who is already opted
// out with the same success.
const set_opted_out = async(s: Op_session, contact_id: number): Promise<void>=>{
    const a = await call_reply(s, 'POST', '/v3/contacts/set-opted-out', 'write', {contactIds: [contact_id], isOptedOut: true});
    if (a.status !== 200)
    {
        throw refusal(a, 'write');
    }
    const failed = item_failure(expect_object(a, 'write'), contact_id);
    if (failed?.error === 'notFound')
    {
        throw new Operation_error('contact.not_found', `This account has no contact ${contact_id}.`, {status: 200, reply_code: 'notFound'});
    }
    if (failed !== undefined)
    {
        throw new Operation_error('reply.refused', 'Reply did not opt the contact out.', {
            status: 200, reply_code: failed.error ?? undefined, detail: failed.details ?? undefined,
        });
    }
};

const handle_contact_opt_out = async(opts: Opt_out_opts, ctx: Cli_context, g: Op_globals, read_stdin?: () => string): Promise<void>=>{
    const contact = read_contact_input(opts, read_stdin);
    const s = await open_session(ctx, g);
    const ids: Ids = {};
    try {
        // The person Reply already holds, so the opt-out lands on them. A contact is created only
        // when Reply holds nobody under the address.
        let contact_id = await find_contact(s, contact);
        let created = false;
        if (contact_id === null)
        {
            const ensured = await ensure_contact(s, contact);
            contact_id = ensured.id;
            created = ensured.created;
        }
        ids.contact_id = contact_id;
        await set_opted_out(s, contact_id);
        print_result({status: 'opted_out', contact_id, contact_created: created}, g);
    } catch (e) {
        throw with_ids(e, ids);
    }
};

export {handle_contact_opt_out};
export type {Opt_out_opts};
