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
        // Written in the form it is looked up by.
        item.linkedInUrl = linkedin_key(p.linkedin_url) ?? p.linkedin_url;
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

type Lookup = {param: 'email' | 'linkedIn'; values: string[]; holds: (entry: Record<string, unknown>) => boolean};
type Channel = 'email' | 'linkedin';

// What a person is looked up by: the channel named, which the person carries, or else the email when
// there is one, else the LinkedIn URL. An entry counts only when it carries the same address: an email
// equal ignoring case, a LinkedIn URL equal under linkedin_key.
// INTERIM (API gap): the document does not say whether the exact lookup by LinkedIn URL ignores case.
// Needed: a lookup that matches a LinkedIn URL by its slug whatever its case, or a word that it does.
// Workaround: ask with the URL in the form it is written in (its lowercased slug) first, then as
// given, and count the matches of both together, so one slug held under two spellings is refused
// rather than half seen.
const lookup_of = (p: Person, by?: Channel): Lookup=>{
    if (p.email !== undefined && by !== 'linkedin')
    {
        const wanted = p.email.toLowerCase();
        return {param: 'email', values: [p.email], holds: entry=>typeof entry.email === 'string' && entry.email.toLowerCase() === wanted};
    }
    const given = p.linkedin_url as string;
    const wanted = linkedin_key(given) as string;
    return {
        param: 'linkedIn', values: wanted === given ? [wanted] : [wanted, given],
        holds: entry=>typeof entry.linkedInUrl === 'string' && linkedin_key(entry.linkedInUrl) === wanted,
    };
};

// GET /v3/contacts looks a contact up by exact email or LinkedIn URL. Each answer is read to its end,
// and only entries carrying the asked address count; the contact found so far, if any, is carried in.
// Two contacts under one address is refused rather than guessed between. An exact lookup never runs
// to pages of entries without an end, so ten such pages are an answer that can't be read, not a
// reason to guess.
const read_lookup = async(s: Op_session, lookup: Lookup, value: string, found_before: number | null): Promise<number | null>=>{
    let found = found_before;
    for (let page = 0; page < LOOKUP_PAGES; page++)
    {
        const a = await call_reply(s, 'GET',
            `/v3/contacts?${lookup.param}=${encodeURIComponent(value)}&top=${LOOKUP_PAGE}&skip=${page * LOOKUP_PAGE}`, 'read');
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

const find_contact_by_address = async(s: Op_session, person: Person, by?: Channel): Promise<number | null>=>{
    const lookup = lookup_of(person, by);
    let found: number | null = null;
    for (const value of lookup.values)
    {
        found = await read_lookup(s, lookup, value, found);
    }
    return found;
};

// INTERIM (API gap): the document does not say how the import compares a LinkedIn URL when it is the
// key, so a contact Reply holds under the same slug in another case might be imported a second time.
// Needed: an import that matches a LinkedIn URL by its slug whatever its case, or a word on how it
// compares.
// Workaround: a contact with no email is looked up first, as `contact find` does, and imported only
// when Reply holds nobody under the URL. A contact with an email is imported straight away: the
// import matches it by the email.
const ensure_contact = async(s: Op_session, ref: Contact_ref): Promise<Ensured>=>{
    if (ref.kind === 'id')
    {
        return {id: ref.id, created: false};
    }
    if (ref.person.email === undefined)
    {
        const found = await find_contact_by_address(s, ref.person);
        if (found !== null)
        {
            return {id: found, created: false};
        }
    }
    return import_contact(s, ref.person);
};

// The contact a command acts on: the id given; else the one Reply holds under the address the command
// reaches the person by (by default the one a lookup uses); else the person imported as an add imports
// them. Looking first means that a person Reply already holds needs no first name.
const find_or_import = async(s: Op_session, ref: Contact_ref, by?: Channel): Promise<Ensured>=>{
    if (ref.kind === 'id')
    {
        return {id: ref.id, created: false};
    }
    const found = await find_contact_by_address(s, ref.person, by);
    return found === null ? import_contact(s, ref.person) : {id: found, created: false};
};

const find_contact = async(s: Op_session, ref: Contact_ref): Promise<number | null>=>
    ref.kind === 'id' ? ref.id : find_contact_by_address(s, ref.person);

const contact_not_found = (contact_id: number, a: Answer): Operation_error=>
    new Operation_error('contact.not_found', `This account has no contact ${contact_id}.`, {status: a.status, reply_code: reply_code_of(a)});

const read_opted_out = async(s: Op_session, contact_id: number): Promise<boolean>=>{
    const a = await call_reply(s, 'GET', `/v3/contacts/${contact_id}/statuses`, 'read');
    if (a.status === 404)
    {
        throw contact_not_found(contact_id, a);
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

export {ensure_contact, find_or_import, import_contact, find_contact, find_contact_by_address, read_opted_out, contact_not_found};
export type {Ensured, Channel};
