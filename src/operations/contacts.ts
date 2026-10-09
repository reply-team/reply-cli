import {Operation_error} from '../utils/errors';
import {
    call_reply, expect_object, read_page, is_object, is_reply_id, reply_code_of, detail_of, invalid_fields, refusal, unreadable,
    type Answer, type Op_session,
} from './call';
import type {Contact_ref, Person} from './contact-input';

type Ensured = {id: number; created: boolean};

const LOOKUP_PAGE = 100;
const LOOKUP_PAGES = 5;

const import_item = (p: Person): Record<string, string>=>{
    const item: Record<string, string> = {email: p.email};
    if (p.first_name !== undefined)
    {
        item.firstName = p.first_name;
    }
    if (p.last_name !== undefined)
    {
        item.lastName = p.last_name;
    }
    if (p.company !== undefined)
    {
        item.company = p.company;
    }
    if (p.title !== undefined)
    {
        item.title = p.title;
    }
    return item;
};

const names_email = (a: Answer): boolean=>
    invalid_fields(a)?.some(field=>field.toLowerCase() === 'email') === true;

// v3's import matches an existing contact by email or creates one, and says which, in one call; on
// a match it fills only the contact's empty fields. Reply requires a first name here, even for an
// email it already holds, and refuses an item without one as "Invalid data", which is passed on as
// reply.refused. POST /v3/contacts is not used: it also requires a first name, and for an email Reply
// already holds it overwrites that contact and blanks every field the request did not send.
const import_contact = async(s: Op_session, person: Person): Promise<Ensured>=>{
    const a = await call_reply(s, 'POST', '/v3/contacts/import', 'write', {items: [import_item(person)]});
    if (a.status === 400 && names_email(a))
    {
        throw new Operation_error('contact.invalid_email', 'Reply did not accept the contact\'s email address.', {
            status: 400, reply_code: reply_code_of(a),
        });
    }
    if (a.status === 400 && reply_code_of(a) === 'contact.limitExceeded')
    {
        throw new Operation_error('account.contact_limit_reached', 'The account holds as many contacts as its plan allows.', {
            status: 400, reply_code: 'contact.limitExceeded', detail: detail_of(a),
        });
    }
    if (a.status !== 200)
    {
        throw refusal(a, 'write');
    }
    const body = expect_object(a, 'write');
    const item = Array.isArray(body.items) ? body.items[0] : undefined;
    if (!is_object(item))
    {
        throw unreadable(a, 'write');
    }
    // A skipped item still names the contact Reply holds under the address (a teammate's, say),
    // except a deleted one, which can't be worked with.
    if (!is_reply_id(item.id) || item.status === 'failed' || item.skipReason === 'contactDeleted')
    {
        throw new Operation_error('reply.refused', 'Reply did not import the contact.', {
            status: 200,
            reply_code: typeof item.skipReason === 'string' ? item.skipReason : undefined,
            detail: typeof item.error === 'string' ? item.error : undefined,
        });
    }
    return {id: item.id, created: item.status === 'created'};
};

const ensure_contact = async(s: Op_session, ref: Contact_ref): Promise<Ensured>=>
    ref.kind === 'id' ? {id: ref.id, created: false} : import_contact(s, ref.person);

// INTERIM (API gap): POST /v3/contacts/filter has no exact-email filter. Its `rules` take a
// property/condition vocabulary that v3 publishes nowhere, and its `searchTerm` matches by
// containment, so "ann@example.com" also finds "joann@example.com".
// Needed: an exact email lookup, or a documented `rules` vocabulary.
// Workaround: page through the searchTerm matches (5 pages of 100) and compare addresses exactly,
// ignoring case. Refuse rather than guess when two match or the end isn't reached.
const find_contact_by_exact_email = async(s: Op_session, email: string): Promise<number | null>=>{
    const wanted = email.toLowerCase();
    let found: number | null = null;
    for (let page = 0; page < LOOKUP_PAGES; page++)
    {
        const a = await call_reply(s, 'POST', `/v3/contacts/filter?top=${LOOKUP_PAGE}&skip=${page * LOOKUP_PAGE}`, 'read', {searchTerm: email});
        if (a.status !== 200)
        {
            throw refusal(a, 'read');
        }
        const body = read_page(a);
        for (const entry of body.items)
        {
            if (!is_object(entry) || typeof entry.email !== 'string' || entry.email.toLowerCase() !== wanted)
            {
                continue;
            }
            if (!is_reply_id(entry.id))
            {
                throw unreadable(a, 'read');
            }
            if (found !== null && found !== entry.id)
            {
                throw new Operation_error('contact.not_unique', 'Reply holds more than one contact with this email address.', {status: 200});
            }
            found = entry.id;
        }
        if (!body.has_more)
        {
            return found;
        }
    }
    throw new Operation_error('contact.lookup_incomplete', `More than ${LOOKUP_PAGE * LOOKUP_PAGES} contacts contain this address, so it could not be decided which one is meant.`, {status: 200});
};

const find_contact = async(s: Op_session, ref: Contact_ref): Promise<number | null>=>
    ref.kind === 'id' ? ref.id : find_contact_by_exact_email(s, ref.person.email);

const read_opted_out = async(s: Op_session, contact_id: number): Promise<boolean>=>{
    const a = await call_reply(s, 'GET', `/v3/contacts/${contact_id}/statuses`, 'read');
    if (a.status === 404)
    {
        throw new Operation_error('contact.not_found', `This account has no contact ${contact_id}.`, {
            status: 404, reply_code: reply_code_of(a),
        });
    }
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    const body = expect_object(a, 'read');
    if (typeof body.isOptedOut !== 'boolean')
    {
        throw unreadable(a, 'read');
    }
    return body.isOptedOut;
};

export {ensure_contact, find_contact, read_opted_out};
export type {Ensured};
