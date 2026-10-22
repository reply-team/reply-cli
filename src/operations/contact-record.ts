import {PROGRAM_NAME} from '../config';
import {Operation_error, Unknown_outcome_error, UsageError, type Ids} from '../utils/errors';
import {call_reply, expect_object, is_object, refusal, unreadable, open_session, type Op_session} from './call';
import {parse_id, type Op_globals} from './options';
import {person_of, linkedin_key, read_contact_input, type Contact_flags, type Contact_ref} from './contact-input';
import {find_contact_by_address, find_or_import, contact_not_found} from './contacts';
import {read_stdin_object, stdin_inputs} from './stdin-input';
import {print_result, with_ids} from './result';
import type {Cli_context} from '../context';

const FIND_FIELDS = ['email', 'linkedin_url'] as const;

// The address is read from stdin only and is never repeated in a message.
const read_find_input = (source: string | undefined, read_stdin?: () => string)=>{
    const raw = read_stdin_object(source, {
        flag: '--contact', what: 'contact', fields: FIND_FIELDS, code: 'usage.contact',
        hint: `Pipe it in: echo '{"email":"…"}' | ${PROGRAM_NAME} contact find --contact -`,
    }, read_stdin);
    const given = FIND_FIELDS.filter(k=>raw[k] !== undefined && raw[k] !== null);
    if (given.length !== 1)
    {
        throw new UsageError('Give exactly one of email and linkedin_url.', {code: 'usage.contact'});
    }
    if (typeof raw[given[0]] !== 'string')
    {
        throw new UsageError(`The contact's ${given[0]} must be a string.`, {code: 'usage.contact'});
    }
    return person_of(raw);
};

// Only looks: a contact Reply does not hold is answered with a null id, never created.
const handle_contact_find = async(
    opts: {contact?: string}, ctx: Cli_context, g: Op_globals, read_stdin?: () => string,
): Promise<void>=>{
    const person = read_find_input(opts.contact, read_stdin);
    const s = await open_session(ctx, g);
    print_result({contact_id: await find_contact_by_address(s, person)}, g);
};

const handle_contact_get = async(id_arg: string, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const id = parse_id(id_arg, 'Contact id');
    const s = await open_session(ctx, g);
    const a = await call_reply(s, 'GET', `/v3/contacts/${id}`, 'read');
    if (a.status === 404)
    {
        throw contact_not_found(id, a);
    }
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    print_result(expect_object(a, 'read'), g);
};

// The CLI's field names and Reply's.
const UPDATE_FIELDS = {first_name: 'firstName', last_name: 'lastName', company: 'company', title: 'title', linkedin_url: 'linkedInUrl'} as const;
type Update_field = keyof typeof UPDATE_FIELDS;
type Custom_value = {name: string; value: string | null};
type Contact_update = {patch: Record<string, string | null>; custom: Custom_value[] | undefined};

const FIELDS_CODE = 'usage.fields';

// A value to set (trimmed, not blank) or null to clear. Never repeated in a message.
const field_value = (raw: unknown, label: string): string | null=>{
    if (raw === null)
    {
        return null;
    }
    if (typeof raw !== 'string' || raw.trim() === '')
    {
        throw new UsageError(`${label} must be a string that is not blank, or null to clear it.`, {code: FIELDS_CODE});
    }
    return raw.trim();
};

const custom_values_of = (raw: unknown): Custom_value[]=>{
    if (!Array.isArray(raw) || raw.length === 0)
    {
        throw new UsageError('custom_fields must be a list of at least one {name, value}.', {code: FIELDS_CODE});
    }
    const seen = new Set<string>();
    return raw.map((entry, index)=>{
        const label = `custom_fields[${index}]`;
        if (!is_object(entry) || Object.keys(entry).some(k=>k !== 'name' && k !== 'value') || !('value' in entry))
        {
            throw new UsageError(`${label} must be {name, value}, with value null to clear the field.`, {code: FIELDS_CODE});
        }
        if (typeof entry.name !== 'string' || entry.name.trim() === '')
        {
            throw new UsageError(`${label}'s name must be a string that is not blank.`, {code: FIELDS_CODE});
        }
        const name = entry.name.trim();
        if (seen.has(name.toLowerCase()))
        {
            throw new UsageError(`${label} names a custom field already given.`, {code: FIELDS_CODE});
        }
        seen.add(name.toLowerCase());
        return {name, value: field_value(entry.value, `${label}'s value`)};
    });
};

// The values are read from stdin only and are never repeated in a message.
const read_contact_update = (source: string | undefined, read_stdin?: () => string): Contact_update=>{
    const fields = [...Object.keys(UPDATE_FIELDS), 'custom_fields'];
    const raw = read_stdin_object(source, {
        flag: '--fields', what: 'fields', fields, code: FIELDS_CODE,
        hint: `Pipe them in: echo '{"title":"…"}' | ${PROGRAM_NAME} contact update <contact-id> --fields -`,
    }, read_stdin);
    if (fields.every(k=>raw[k] === undefined))
    {
        throw new UsageError('The fields name nothing to change.', {code: FIELDS_CODE, hint: `Fields: ${fields.join(', ')}.`});
    }
    const patch: Record<string, string | null> = {};
    for (const field of Object.keys(UPDATE_FIELDS) as Update_field[])
    {
        if (raw[field] === undefined)
        {
            continue;
        }
        let value = field_value(raw[field], field);
        if (field === 'linkedin_url' && value !== null)
        {
            // Written in the form it is looked up by: its lowercased slug.
            value = linkedin_key(value);
            if (value === null)
            {
                throw new UsageError('linkedin_url must be an absolute http or https URL.', {code: FIELDS_CODE});
            }
        }
        patch[UPDATE_FIELDS[field]] = value;
    }
    return {patch, custom: raw.custom_fields === undefined ? undefined : custom_values_of(raw.custom_fields)};
};

// INTERIM (API gap): PATCH /v3/contacts/{id} publishes no refusal for a custom field name the team
// does not have, so such a field may be dropped or refused without a code while the rest is written.
// Needed: a coded refusal for an unknown custom field, with nothing written.
// Workaround: when an update names custom fields, read the account's contact fields once and refuse
// a name none of them carries before anything is written. A name matches ignoring case, and is sent
// as the account spells it.
const resolve_custom_fields = async(s: Op_session, custom: Custom_value[]): Promise<Custom_value[]>=>{
    const a = await call_reply(s, 'GET', '/v3/custom-fields?entityType=contact', 'read');
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    if (!Array.isArray(a.data))
    {
        throw unreadable(a, 'read');
    }
    const titles = a.data.filter(is_object).map(f=>f.title).filter((t): t is string=>typeof t === 'string');
    const title_of = (name: string): string | undefined=>
        titles.includes(name) ? name : titles.find(t=>t.toLowerCase() === name.toLowerCase());
    const missing = custom.map(c=>c.name).filter(name=>title_of(name) === undefined);
    if (missing.length > 0)
    {
        throw new Operation_error('contact.field_not_found', 'The account has no contact custom field by a name given, so nothing was changed.', {
            status: 200, details: {fields: missing},
        });
    }
    return custom.map(c=>({name: title_of(c.name) as string, value: c.value}));
};

type Update_opts = Contact_flags & {fields?: string};

// The contact id as the argument, as it always was, or the contact flags; never both.
const contact_to_update = (id_arg: string | undefined, opts: Update_opts, read_stdin: () => string): Contact_ref=>{
    if (id_arg === undefined)
    {
        return read_contact_input(opts, read_stdin);
    }
    if ([opts.contactId, opts.email, opts.firstName, opts.lastName, opts.company, opts.title, opts.contact].some(v=>v !== undefined))
    {
        throw new UsageError('The contact was given more than one way.', {
            code: 'usage.contact', hint: 'Give the contact id as the argument, or the contact by its flags, not both.',
        });
    }
    return {kind: 'id', id: parse_id(id_arg, 'Contact id')};
};

const handle_contact_update = async(
    id_arg: string | undefined, opts: Update_opts, ctx: Cli_context, g: Op_globals, read_stdin?: () => string,
): Promise<void>=>{
    const stdin = stdin_inputs({contact: opts.contact, fields: opts.fields}, {
        code: 'usage.stdin', hint: `Pipe both in one object: echo '{"contact":{…},"fields":{…}}' | ${PROGRAM_NAME} contact update --contact - --fields -`,
    }, read_stdin);
    const contact = contact_to_update(id_arg, opts, stdin.contact);
    const {patch, custom} = read_contact_update(opts.fields, stdin.fields);
    const s = await open_session(ctx, g);
    const ids: Ids = contact.kind === 'id' ? {contact_id: contact.id} : {};
    try {
        // Custom fields go by name, read before the contact is found or imported, so a name the account
        // lacks changes nothing at all.
        const custom_fields = custom === undefined ? undefined : await resolve_custom_fields(s, custom);
        // The contact's fields only find the contact, or import it as an add would; the change is the
        // --fields alone, so a contact Reply holds keeps the address it was found by.
        const ensured = await find_or_import(s, contact);
        ids.contact_id = ensured.id;
        // Absent fields stay as they are; a null clears one.
        const body = custom_fields === undefined ? patch : {...patch, customFields: custom_fields};
        const a = await call_reply(s, 'PATCH', `/v3/contacts/${ensured.id}`, 'write', body);
        if (a.status === 404)
        {
            throw contact_not_found(ensured.id, a);
        }
        if (a.status !== 200 && a.status !== 204)
        {
            throw refusal(a, 'write');
        }
        print_result({status: 'updated', contact_id: ensured.id, contact_created: ensured.created}, g);
    } catch (e) {
        throw with_ids(e, ids);
    }
};

const handle_contact_delete = async(id_arg: string, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const id = parse_id(id_arg, 'Contact id');
    const s = await open_session(ctx, g);
    try {
        const a = await call_reply(s, 'DELETE', `/v3/contacts/${id}`, 'write');
        if (a.status === 404)
        {
            throw contact_not_found(id, a);
        }
        if (a.status !== 204 && a.status !== 200)
        {
            throw refusal(a, 'write');
        }
        print_result({status: 'deleted', contact_id: id}, g);
    } catch (e) {
        // Safe to repeat, but not with the same answer: once the contact is gone, a repeat is told it is missing.
        if (e instanceof Unknown_outcome_error)
        {
            e.hint = 'The contact may have been deleted. Running the command again is safe; it answers contact.not_found if it was.';
        }
        throw with_ids(e, {contact_id: id});
    }
};

export {handle_contact_find, handle_contact_get, handle_contact_update, handle_contact_delete};
export type {Update_opts};
