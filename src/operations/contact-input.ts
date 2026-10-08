import type {Command} from 'commander';
import {UsageError} from '../utils/errors';
import {read_json_arg} from '../utils/json-arg';
import {parse_id} from './options';

type Person = {email: string; first_name?: string; last_name?: string; company?: string; title?: string};
type Contact_ref = {kind: 'id'; id: number} | {kind: 'person'; person: Person};
type Contact_flags = {
    contactId?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    title?: string;
    contact?: string;
};

const PERSON_FIELDS = ['email', 'first_name', 'last_name', 'company', 'title'] as const;
const CODE = 'usage.contact';
const ONE_WAY_HINT = 'Use exactly one of --contact-id, --email (with its name flags), or --contact.';

const add_contact_options = (cmd: Command): Command=>cmd
    .option('--contact-id <id>', 'The contact by its Reply id')
    .option('--email <address>', 'The contact by email; with --first-name, --last-name, --company, --title')
    .option('--first-name <name>', 'First name (with --email; Reply requires one to add or match a contact by email)')
    .option('--last-name <name>', 'Last name (with --email)')
    .option('--company <name>', 'Company (with --email)')
    .option('--title <title>', 'Job title (with --email)')
    .option('--contact <json>', 'The contact as JSON {email, first_name, last_name, company, title}: inline, @file, or - for stdin');

const CONTACT_HELP = `
A contact is given exactly one way:
  --contact-id <id>                  a contact Reply already holds
  --email <address> --first-name <name> [--last-name <name>] [--company <name>] [--title <title>]
                                     (Reply requires the first name to add or match by email)
  --contact <json>|@file|-           the same fields as JSON; '-' reads stdin, which keeps
                                     personal data out of the argument list`;

const clean = (v: unknown): string | undefined=>{
    const text = typeof v === 'string' ? v.trim() : '';
    return text ? text : undefined;
};

// The person as Reply will be asked about them: trimmed, empty fields dropped, an email required.
// Messages never echo the address: a caller may log stderr where personal data must not go.
const person_of = (raw: Record<string, unknown>): Person=>{
    const email = clean(raw.email);
    if (email === undefined)
    {
        throw new UsageError('The contact needs an email.', {code: CODE, hint: ONE_WAY_HINT});
    }
    if (!/^[^\s@]+@[^\s@]+$/.test(email))
    {
        throw new UsageError('The contact\'s email is not an email address.', {code: CODE});
    }
    const person: Person = {email};
    for (const field of ['first_name', 'last_name', 'company', 'title'] as const)
    {
        const value = clean(raw[field]);
        if (value !== undefined)
        {
            person[field] = value;
        }
    }
    return person;
};

const person_from_json = (value: unknown): Person=>{
    if (typeof value !== 'object' || value === null || Array.isArray(value))
    {
        throw new UsageError('--contact must be a JSON object.', {code: CODE, hint: `Fields: ${PERSON_FIELDS.join(', ')}.`});
    }
    const fields = value as Record<string, unknown>;
    const unknown_field = Object.keys(fields).find(k=>!(PERSON_FIELDS as readonly string[]).includes(k));
    if (unknown_field !== undefined)
    {
        throw new UsageError(`--contact has an unknown field '${unknown_field}'.`, {code: CODE, hint: `Fields: ${PERSON_FIELDS.join(', ')}.`});
    }
    for (const field of PERSON_FIELDS)
    {
        if (fields[field] !== undefined && fields[field] !== null && typeof fields[field] !== 'string')
        {
            throw new UsageError(`--contact field '${field}' must be a string.`, {code: CODE});
        }
    }
    return person_of(fields);
};

const read_contact_input = (f: Contact_flags, read_stdin?: () => string): Contact_ref=>{
    const by_flags = [f.email, f.firstName, f.lastName, f.company, f.title].some(v=>v !== undefined);
    const forms = [f.contactId !== undefined, by_flags, f.contact !== undefined].filter(Boolean).length;
    if (forms !== 1)
    {
        throw new UsageError(forms === 0 ? 'No contact was given.' : 'The contact was given more than one way.', {code: CODE, hint: ONE_WAY_HINT});
    }
    if (f.contactId !== undefined)
    {
        return {kind: 'id', id: parse_id(f.contactId, '--contact-id')};
    }
    if (f.contact !== undefined)
    {
        return {kind: 'person', person: person_from_json(read_json_arg(f.contact, {flag: '--contact', what: 'contact', code: CODE, read_stdin}))};
    }
    return {kind: 'person', person: person_of({
        email: f.email, first_name: f.firstName, last_name: f.lastName, company: f.company, title: f.title,
    })};
};

export {read_contact_input, add_contact_options, CONTACT_HELP};
export type {Person, Contact_ref, Contact_flags};
