import {Operation_error} from '../utils/errors';
import {
    call_reply, expect_object, read_page, is_object, is_reply_id, reply_code_of, detail_of, invalid_fields, refusal, unreadable,
    type Answer, type Op_session,
} from './call';
import {linkedin_key, type Contact_ref, type Person} from './contact-input';

type Ensured = {id: number; created: boolean};

const LOOKUP_PAGE = 100;
const LOOKUP_PAGES = 10;

const import_item = (p: Person): Record<string, string>=>{
    const item: Record<string, string> = {};
    if (p.email !== undefined)
    {
        item.email = p.email;
    }
    if (p.linkedin_url !== undefined)
    {
        item.linkedInUrl = p.linkedin_url;
    }
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

const names_field = (a: Answer, name: string): boolean=>
    invalid_fields(a)?.some(field=>field.toLowerCase() === name.toLowerCase()) === true;

// v3's import matches an existing contact by email or creates one, and says which, in one call; on
// a match it fills only the contact's empty fields. A contact with no email is matched by its
// LinkedIn URL instead: the import's keys add to the email rather than replace it, so that key is
// asked for only when there is no email to match. Reply requires a first name here, even for a
// contact it already holds, and refuses an item without one as "Invalid data", which is passed on as
// reply.refused. POST /v3/contacts is not used: it also requires a first name, and for an email Reply
// already holds it overwrites that contact and blanks every field the request did not send.
const import_contact = async(s: Op_session, person: Person): Promise<Ensured>=>{
    const body: Record<string, unknown> = {items: [import_item(person)]};
    if (person.email === undefined)
    {
        body.options = {keys: {linkedInUrl: true}};
    }
    const a = await call_reply(s, 'POST', '/v3/contacts/import', 'write', body);
    if (a.status === 400 && names_field(a, 'email'))
    {
        throw new Operation_error('contact.invalid_email', 'Reply did not accept the contact\'s email address.', {
            status: 400, reply_code: reply_code_of(a),
        });
    }
    if (a.status === 400 && names_field(a, 'linkedInUrl'))
    {
        throw new Operation_error('contact.invalid_linkedin_url', 'Reply did not accept the contact\'s LinkedIn URL.', {
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
    const answer = expect_object(a, 'write');
    const item = Array.isArray(answer.items) ? answer.items[0] : undefined;
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

type Lookup = {param: 'email' | 'linkedIn'; value: string; holds: (entry: Record<string, unknown>) => boolean};

// What a person is looked up by: the email when there is one, else the LinkedIn URL. An entry
// counts only when it carries the same address: an email equal ignoring case, a LinkedIn URL equal
// under linkedin_key.
const lookup_of = (p: Person): Lookup=>{
    if (p.email !== undefined)
    {
        const wanted = p.email.toLowerCase();
        return {param: 'email', value: p.email, holds: entry=>typeof entry.email === 'string' && entry.email.toLowerCase() === wanted};
    }
    const url = p.linkedin_url as string;
    const wanted = linkedin_key(url);
    return {param: 'linkedIn', value: url, holds: entry=>typeof entry.linkedInUrl === 'string' && linkedin_key(entry.linkedInUrl) === wanted};
};

// GET /v3/contacts looks a contact up by exact email or LinkedIn URL. The answer is read to its end,
// and only entries carrying the asked address count. Two contacts under one address is refused
// rather than guessed between. An exact lookup never runs to pages of entries without an end, so
// ten such pages are an answer that can't be read, not a reason to guess.
const find_contact_by_address = async(s: Op_session, person: Person): Promise<number | null>=>{
    const lookup = lookup_of(person);
    let found: number | null = null;
    for (let page = 0; page < LOOKUP_PAGES; page++)
    {
        const a = await call_reply(s, 'GET',
            `/v3/contacts?${lookup.param}=${encodeURIComponent(lookup.value)}&top=${LOOKUP_PAGE}&skip=${page * LOOKUP_PAGE}`, 'read');
        if (a.status !== 200)
        {
            throw refusal(a, 'read');
        }
        const body = read_page(a);
        for (const entry of body.items)
        {
            if (!is_object(entry) || !lookup.holds(entry))
            {
                continue;
            }
            if (!is_reply_id(entry.id))
            {
                throw unreadable(a, 'read');
            }
            if (found !== null && found !== entry.id)
            {
                throw new Operation_error('contact.not_unique', 'Reply holds more than one contact under this address.', {status: 200});
            }
            found = entry.id;
        }
        if (!body.has_more)
        {
            return found;
        }
    }
    throw new Operation_error('reply.unavailable', 'Reply answered the exact lookup with more pages than one address can fill.', {status: 200});
};

const find_contact = async(s: Op_session, ref: Contact_ref): Promise<number | null>=>
    ref.kind === 'id' ? ref.id : find_contact_by_address(s, ref.person);

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

export {ensure_contact, find_contact, find_contact_by_address, read_opted_out};
export type {Ensured};
