import type {Command} from 'commander';
import {UsageError} from '../utils/errors';
import {read_json_arg} from '../utils/json-arg';
import {parse_id} from './options';

// At least one of email and linkedin_url.
type Person = {email?: string; linkedin_url?: string; first_name?: string; last_name?: string; company?: string; title?: string};
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

const PERSON_FIELDS = ['email', 'linkedin_url', 'first_name', 'last_name', 'company', 'title'] as const;
const CODE = 'usage.contact';
const ONE_WAY_HINT = 'Use exactly one of --contact-id, --email (with its name flags), or --contact (which also takes linkedin_url).';

// `found_first`: the command looks the contact up before it imports one, so the names only matter for a contact
// Reply doesn't hold yet and are otherwise unused.
const add_contact_options = (cmd: Command, found_first = false): Command=>cmd
    .option('--contact-id <id>', 'The contact by its Reply id')
    .option('--email <address>', 'The contact by email; with --first-name, --last-name, --company, --title')
    .option('--first-name <name>', `First name (with --email; Reply refuses to import a contact without one)`)
    .option('--last-name <name>', `Last name (with --email${found_first ? '; used only if the contact is imported' : ''})`)
    .option('--company <name>', `Company (with --email${found_first ? '; used only if the contact is imported' : ''})`)
    .option('--title <title>', `Job title (with --email${found_first ? '; used only if the contact is imported' : ''})`)
    .option('--contact <json>', 'The contact as JSON {email, linkedin_url, first_name, last_name, company, title}: inline, @file, or - for stdin');

const CONTACT_FORMS = `
A contact is given exactly one way:
  --contact <json>|@file|-           {email, linkedin_url, first_name, last_name, company, title},
                                     with an email, a LinkedIn URL or both; '-' reads stdin, which
                                     keeps personal data out of the argument list
  --email <address> [--first-name <name>] [--last-name <name>] [--company <name>] [--title <title>]
  --contact-id <id>                  a contact Reply already holds
`;

const CONTACT_HELP = `${CONTACT_FORMS}Reply is asked about a contact by its email; one with only a LinkedIn URL, by that. A LinkedIn URL is
matched by its lowercased slug, and the CLI stores it by that slug when it imports the contact.

`;

const clean = (v: unknown): string | undefined=>{
    const text = typeof v === 'string' ? v.trim() : '';
    return text ? text : undefined;
};

const is_email = (text: string): boolean=>/^[^\s@]+@[^\s@]+$/.test(text);

const is_linkedin_host = (host: string): boolean=>host === 'linkedin.com' || host.endsWith('.linkedin.com');

// The form a profile URL is compared and written in, or null when the text is not an absolute
// http(s) URL. On linkedin.com and its subdomains a URL names a person by its slug whatever its case,
// so the path is lowercased there; on any other host it keeps its case. The case of the scheme and
// the host, a default port, one trailing slash and a fragment never count; www and the query do. The
// CLI stores and matches a LinkedIn URL by this form, so what it writes is what it later finds.
const linkedin_key = (text: string): string | null=>{
    let url: URL;
    try {
        url = new URL(text.trim());
    } catch {
        return null;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '')
    {
        return null;
    }
    const trimmed = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
    const path = is_linkedin_host(url.hostname) ? trimmed.toLowerCase() : trimmed;
    return `${url.protocol}//${url.host}${path}${url.search}`;
};

// The person as Reply will be asked about them: trimmed, empty fields dropped, an email or a
// LinkedIn URL required. Messages never echo either: a caller may log stderr where personal data
// must not go.
const person_of = (raw: Record<string, unknown>): Person=>{
    const email = clean(raw.email);
    const linkedin_url = clean(raw.linkedin_url);
    if (email === undefined && linkedin_url === undefined)
    {
        throw new UsageError('The contact needs an email or a LinkedIn URL.', {code: CODE, hint: ONE_WAY_HINT});
    }
    if (email !== undefined && !is_email(email))
    {
        throw new UsageError('The contact\'s email is not an email address.', {code: CODE});
    }
    if (linkedin_url !== undefined && linkedin_key(linkedin_url) === null)
    {
        throw new UsageError('The contact\'s linkedin_url is not an absolute http or https URL.', {code: CODE});
    }
    const person: Person = {};
    if (email !== undefined)
    {
        person.email = email;
    }
    if (linkedin_url !== undefined)
    {
        person.linkedin_url = linkedin_url;
    }
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

export {read_contact_input, add_contact_options, person_of, CONTACT_FORMS, CONTACT_HELP, linkedin_key, is_email};
export type {Person, Contact_ref, Contact_flags};
