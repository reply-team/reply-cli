import {PROGRAM_NAME} from '../config';
import {UsageError} from '../utils/errors';
import {call_reply, expect_object, refusal, open_session} from './call';
import {parse_id, type Op_globals} from './options';
import {person_of} from './contact-input';
import {find_contact_by_address, contact_not_found} from './contacts';
import {read_stdin_object} from './stdin-input';
import {print_result} from './result';
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

export {handle_contact_find, handle_contact_get};
