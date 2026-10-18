import {PROGRAM_NAME} from '../config';
import {Operation_error, Unknown_outcome_error, UsageError} from '../utils/errors';
import {call_reply, expect_object, read_page, is_object, is_reply_id, refusal, unreadable, open_session} from './call';
import type {Op_globals} from './options';
import {read_stdin_object} from './stdin-input';
import {print_result} from './result';
import type {Cli_context} from '../context';

const PAGE = 1000;
const PAGES = 20;

// The one step a sequence needs to exist: Reply refuses a sequence with none. A task is its owner's
// to-do and reaches nobody, even once the sequence runs; it says what it is, so whoever opens the
// sequence replaces it.
const PLACEHOLDER = {
    type: 'task',
    actionType: 'toDo',
    delayInMinutes: 0,
    description: 'Added because a sequence needs one step to exist; replace it before this sequence is ever started.',
};

// A sequence's name is a person's text: read from stdin only, sent as given, never repeated in a message.
const read_name = (source: string | undefined, command: string, read_stdin?: () => string): string=>{
    const raw = read_stdin_object(source, {
        flag: '--name', what: 'name', fields: ['name'], code: 'usage.name',
        hint: `Pipe it in: echo '{"name":"…"}' | ${PROGRAM_NAME} sequence ${command} --name -`,
    }, read_stdin);
    if (typeof raw.name !== 'string' || raw.name.trim() === '')
    {
        throw new UsageError('The name must be a string that is not blank.', {code: 'usage.name'});
    }
    return raw.name;
};

const words_of = (seq: Record<string, unknown>)=>({
    status: typeof seq.status === 'string' ? seq.status : null,
    is_archived: typeof seq.isArchived === 'boolean' ? seq.isArchived : null,
});

// Every sequence whose name is this one, exactly and ignoring case, archived ones included. Reply's
// own name filter matches part of a name, ignoring case, so it narrows the list and the names are
// compared here. Oldest first, so a sequence made while the pages are read lands after them rather
// than shifting one out of view. A name is free only once the end of the list is reached, so a list
// that does not end within twenty pages is refused rather than answered in part.
const handle_sequence_list = async(
    opts: {name?: string}, ctx: Cli_context, g: Op_globals, read_stdin?: () => string,
): Promise<void>=>{
    const name = read_name(opts.name, 'list', read_stdin);
    const wanted = name.toLowerCase();
    const s = await open_session(ctx, g);
    const items: Record<string, unknown>[] = [];
    for (let page = 0; page < PAGES; page++)
    {
        const a = await call_reply(s, 'GET',
            `/v3/sequences?name=${encodeURIComponent(name)}&sortBy=created&sortDirection=asc&top=${PAGE}&skip=${page * PAGE}`, 'read');
        if (a.status !== 200)
        {
            throw refusal(a, 'read');
        }
        const body = read_page(a);
        for (const entry of body.items)
        {
            if (!is_object(entry) || typeof entry.name !== 'string' || entry.name.toLowerCase() !== wanted)
            {
                continue;
            }
            if (!is_reply_id(entry.id))
            {
                throw unreadable(a, 'read');
            }
            items.push({id: entry.id, name: entry.name, ...words_of(entry), created_at: typeof entry.created === 'string' ? entry.created : null});
        }
        if (!body.has_more)
        {
            print_result({items}, g);
            return;
        }
    }
    throw new Operation_error('sequence.list_incomplete',
        `Read ${PAGE * PAGES} sequences whose names contain this one and Reply said there were more, so it could not be decided which carry it.`,
        {status: 200});
};

// The draft: the name and the one step, nothing else. Reply attaches the account's default schedule
// and mailbox on its own; the draft sends nothing, because it holds nobody and is never started here.
// Reply allows two sequences of one name, and a sequence keeps no key, so a repeat after a lost
// answer may make a second one.
const handle_sequence_create = async(
    opts: {name?: string}, ctx: Cli_context, g: Op_globals, read_stdin?: () => string,
): Promise<void>=>{
    const name = read_name(opts.name, 'create', read_stdin);
    const s = await open_session(ctx, g);
    try {
        const a = await call_reply(s, 'POST', '/v3/sequences', 'write', {name, steps: [PLACEHOLDER]});
        if (a.status !== 201 && a.status !== 200)
        {
            throw refusal(a, 'write');
        }
        const made = expect_object(a, 'write');
        if (!is_reply_id(made.id))
        {
            // Reply said it made something and did not say what.
            throw unreadable(a, 'write');
        }
        print_result({sequence_id: made.id, steps_added: 1, ...words_of(made)}, g);
    } catch (e) {
        if (e instanceof Unknown_outcome_error)
        {
            e.hint = 'The sequence may have been made; running the command again may make a second one. Look for it with '
                + `\`${PROGRAM_NAME} sequence list --name -\` first.`;
        }
        throw e;
    }
};

export {handle_sequence_list, handle_sequence_create};
