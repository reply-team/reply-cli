import {Command} from 'commander';
import {PROGRAM_NAME} from '../config';
import {build_context} from '../context';
import {read_op_globals} from './options';
import {add_contact_options, CONTACT_HELP} from './contact-input';
import {handle_sequence_get, handle_sequence_contacts, handle_sequence_stats} from './sequence-read';
import {handle_sequence_add_contact, handle_sequence_remove_contact} from './sequence-membership';
import {handle_sequence_pause, handle_sequence_start} from './sequence-state';
import {
    handle_inbox_list, handle_inbox_get, handle_inbox_categories, handle_inbox_categorize, handle_inbox_mark_read, handle_inbox_mark_unread,
} from './inbox';
import {handle_inbox_reply} from './inbox-reply';
import {handle_contact_list_add_contact} from './contact-list';
import {handle_contact_opt_out} from './contact';

const P = PROGRAM_NAME;
const COMMON_ERRORS = [
    'access.denied', 'access.feature_unavailable', 'rate_limited', 'reply.unavailable', 'reply.refused', 'reply.invalid_request',
];

const SAFE_TO_REPEAT = 'a write may have happened; re-running is safe';

const errors_help = (codes: string[], write: boolean, unknown_outcome: string): string=>
    '\nErrors (with --json, one line on stderr: {"error":{"code":…,"ids":…}}):\n'
    + [...codes, ...COMMON_ERRORS, ...(write ? ['outcome.unknown'] : [])].map(c=>`  ${c}`).join('\n')
    + '\nExit codes: 0 done · 1 failed, main effect not done (partial effects are in "ids") · 2 usage, nothing sent'
    + ` · 3 outcome unknown (${unknown_outcome})`;

const help = (examples: string[], codes: string[], write: boolean, extra = '', unknown_outcome = SAFE_TO_REPEAT): string=>
    `\nExamples:\n${examples.map(e=>`  ${e}`).join('\n')}\n${extra ? `\n${extra}` : ''}${errors_help(codes, write, unknown_outcome)}`;

const ex = (command: string): string=>`${P} ${command}`;

// The contact on stdin: the form that keeps personal data off the argument list, so it leads.
const piped = (command: string, contact = '{"email":"ann@example.com","first_name":"Ann"}'): string=>
    `echo '${contact}' | ${P} ${command} --contact -`;

const ALWAYS_IMPORTED = 'A contact given by email is always imported, so Reply needs a first name, even for one it already holds.\n';

const run = (fn: (cmd: Command) => Promise<void>)=>async function(this: Command): Promise<void>
{
    await fn(this);
};

const ctx_of = (cmd: Command)=>{
    const g = read_op_globals(cmd);
    return {g, ctx: build_context({profile: g.profile})};
};

const sequence_command = new Command('sequence').description('Read a sequence, put contacts in or take them out, pause or start it');

sequence_command.command('get')
    .argument('<sequence-id>', 'Sequence id')
    .description('The sequence as Reply holds it: settings, steps, state')
    .addHelpText('after', help([ex('sequence get 123')], ['sequence.not_found'], false))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_sequence_get(cmd.args[0], ctx, g);
    }));

sequence_command.command('contacts')
    .argument('<sequence-id>', 'Sequence id')
    .option('--limit <n>', 'Contacts per page, 1-1000 (default 100)')
    .option('--offset <n>', 'Contacts to skip (default 0)')
    .description('One page of the contacts in the sequence, newest first, plus the total')
    .addHelpText('after', help([ex('sequence contacts 123 --limit 50')], ['sequence.not_found'], false))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_sequence_contacts(cmd.args[0], cmd.opts(), ctx, g);
    }));

sequence_command.command('stats')
    .argument('<sequence-id>', 'Sequence id')
    .option('--preset <window>', 'last-week | last-month | last-year | all-time')
    .option('--from <iso>', 'Window start (with --to)')
    .option('--to <iso>', 'Window end (with --from)')
    .description('Reply\'s email and LinkedIn counts for the sequence over one window')
    .addHelpText('after', help([ex('sequence stats 123 --preset last-month'), ex('sequence stats 123 --from 2026-09-01 --to 2026-10-01')],
        ['sequence.not_found'], false))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_sequence_stats(cmd.args[0], cmd.opts(), ctx, g);
    }));

add_contact_options(sequence_command.command('add-contact')
    .argument('<sequence-id>', 'Sequence id'))
    .option('--start-step <n>', 'Start at this step of the sequence (1 = first; the steps must form one chain)')
    .option('--ignore-step-delay', 'Skip the delay of the step the contact starts at (Reply still sends within the sequence\'s schedule)')
    .description('Put a contact into the sequence, creating the contact if Reply has nobody under the email')
    .addHelpText('after', help(
        [piped('sequence add-contact 123'), ex('sequence add-contact 123 --email ann@example.com --first-name Ann'),
            ex('sequence add-contact 123 --contact-id 456 --start-step 2')],
        ['sequence.not_found', 'sequence.archived', 'sequence.has_no_steps', 'sequence.step_not_found', 'contact.not_found',
            'contact.opted_out', 'contact.invalid_email', 'account.contact_limit_reached'],
        true,
        'Result: {"status":"added"|"already_in_sequence","sequence_id","contact_id","contact_created","sequence_active"}\n'
            + CONTACT_HELP + ALWAYS_IMPORTED))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_sequence_add_contact(cmd.args[0], cmd.opts(), ctx, g);
    }));

add_contact_options(sequence_command.command('remove-contact')
    .argument('<sequence-id>', 'Sequence id'))
    .description('Take a contact out of the sequence; their history stays. Never creates a contact')
    .addHelpText('after', help([piped('sequence remove-contact 123', '{"email":"ann@example.com"}'), ex('sequence remove-contact 123 --contact-id 456')],
        ['sequence.not_found', 'contact.not_unique', 'contact.lookup_incomplete'], true,
        'Result: {"status":"removed"|"not_in_sequence","sequence_id","contact_id"}\n'
            + CONTACT_HELP + 'A contact given by email is only looked up, never imported, so no first name is needed.\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_sequence_remove_contact(cmd.args[0], cmd.opts(), ctx, g);
    }));

sequence_command.command('pause')
    .argument('<sequence-id>', 'Sequence id')
    .description('Pause the sequence (a paused one stays paused; one never started is refused)')
    .addHelpText('after', help([ex('sequence pause 123')], ['sequence.not_found', 'sequence.archived', 'sequence.not_pausable', 'sequence.busy'], true,
        'Result: {"status":"paused","sequence_id"}\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_sequence_pause(cmd.args[0], ctx, g);
    }));

sequence_command.command('start')
    .argument('<sequence-id>', 'Sequence id')
    .option('--expect-contacts <n>', 'Start only if the sequence holds exactly this many contacts')
    .description('Start (or resume) the sequence: step 1 goes to everyone in it')
    .addHelpText('after', help([ex('sequence start 123'), ex('sequence start 123 --expect-contacts 40')],
        ['sequence.not_found', 'sequence.archived', 'sequence.not_startable', 'sequence.busy', 'sequence.contact_count_changed'], true,
        'Result: {"status":"started"|"already_active","sequence_id","previous_status","contacts"}. already_active, contacts and\n'
            + 'previous_status come only with --expect-contacts; previous_status is the sequence\'s state before the start: new, paused or active.\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_sequence_start(cmd.args[0], cmd.opts(), ctx, g);
    }));

const contact_list_command = new Command('contact-list').description('Put contacts on a contact list');

add_contact_options(contact_list_command.command('add-contact')
    .argument('<list-id>', 'Contact list id'))
    .option('--refuse-opted-out', 'Refuse a contact Reply holds as opted out (a list may otherwise hold them)')
    .description('Put a contact on the list, creating the contact if Reply has nobody under the email')
    .addHelpText('after', help([piped('contact-list add-contact 77'), ex('contact-list add-contact 77 --contact-id 456 --refuse-opted-out')],
        ['contact-list.not_found', 'contact.not_found', 'contact.opted_out', 'contact.invalid_email', 'account.contact_limit_reached'], true,
        'Result: {"status":"added","list_id","contact_id","contact_created"}\n' + CONTACT_HELP + ALWAYS_IMPORTED))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_contact_list_add_contact(cmd.args[0], cmd.opts(), ctx, g);
    }));

const contact_command = new Command('contact').description('Act on a contact');

add_contact_options(contact_command.command('opt-out'))
    .description('Mark the contact as opted out at Reply, creating them only if Reply has nobody under the email')
    .addHelpText('after', help([piped('contact opt-out'), ex('contact opt-out --contact-id 456')],
        ['contact.not_found', 'contact.not_unique', 'contact.lookup_incomplete', 'contact.invalid_email', 'account.contact_limit_reached'], true,
        'Result: {"status":"opted_out","contact_id","contact_created"}\n' + CONTACT_HELP
            + 'A contact given by email is imported only when Reply holds nobody under the address; only then does Reply need a first name.\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_contact_opt_out(cmd.opts(), ctx, g);
    }));

const inbox_command = new Command('inbox').description('Read inbox threads, reply in them, file them under a category, mark them read or unread');

inbox_command.command('list')
    .option('--contact-id <id>', 'Threads with this contact')
    .option('--sequence-id <id>', 'Threads of this sequence')
    .option('--source <source>', 'inbox | sent | unread | ai-draft (Reply\'s default: inbox)')
    .option('--channel <channel>', 'email | linkedin: only threads on this channel')
    .option('--category-id <id>', 'Only threads filed under this inbox category (see `inbox categories`)')
    .option('--since <iso>', 'Only threads that moved at or after this moment')
    .option('--limit <n>', 'Threads per page, 1-100 (default 20)')
    .option('--offset <n>', 'Threads to skip (default 0)')
    .description('One page of inbox threads, by contact or by sequence')
    .addHelpText('after', help([ex('inbox list --contact-id 456'), ex('inbox list --sequence-id 123 --source unread --since 2026-10-01T00:00:00Z'),
        ex('inbox list --sequence-id 123 --channel linkedin --category-id 7')], [], false))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_inbox_list(cmd.opts(), ctx, g);
    }));

inbox_command.command('get')
    .argument('<thread-id>', 'Inbox thread id')
    .option('--limit <n>', 'Messages per page, 1-20 (default 20)')
    .option('--offset <n>', 'Messages to skip (default 0)')
    .description('One inbox thread and one page of its messages, oldest first')
    .addHelpText('after', help([ex('inbox get 9876'), ex('inbox get 9876 --offset 20')], ['inbox.thread_not_found'], false,
        'Result: {"thread","messages":{"items","has_more"}}. The thread is Reply\'s without its inline history, which has no limit;\n'
        + 'its "subject" is the latest email message\'s (null when there is none).\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_inbox_get(cmd.args[0], cmd.opts(), ctx, g);
    }));

inbox_command.command('reply')
    .argument('<thread-id>', 'Inbox thread id')
    .option('--message <stdin>', 'Only -: the message {body, reply_to_message_id} as JSON on stdin')
    .description('Reply to the contact in an existing thread, on the thread\'s own channel')
    .addHelpText('after', help(
        [`echo '{"body":"Thanks, Tuesday works."}' | ${P} inbox reply 9876 --message -`,
            `echo '{"body":"Thanks!","reply_to_message_id":"<abc@example.com>"}' | ${P} inbox reply 9876 --message -`],
        ['inbox.thread_not_found', 'inbox.channel_mismatch', 'contact.opted_out', 'inbox.send_failed'], true,
        'Result: {"status":"sent","thread_id","channel":"email"|"linkedin","message_id","sent_at"}; message_id is null on LinkedIn.\n'
            + 'The message is read from stdin only, so its text never sits in the argument list. The reply goes to the thread\'s\n'
            + 'contact from the account that owns the thread; no other recipient can be named. reply_to_message_id (email only)\n'
            + 'answers one message of the thread; without it Reply answers the latest. inbox.send_failed means Reply could not\n'
            + 'deliver it: "details.status_code" is Reply\'s reason (e.g. linkedInSendingLimitExceeded), null when it gave none.\n',
        'the reply may have been sent; running the command again may send it twice, so read the thread first'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_inbox_reply(cmd.args[0], cmd.opts(), ctx, g);
    }));

inbox_command.command('categories')
    .description('The inbox categories a thread can be filed under, Reply\'s reserved ones included')
    .addHelpText('after', help([ex('inbox categories')], [], false,
        'Result: {"items"}: Reply\'s categories as it gives them (id, name, color, isReserved, unreadThreadsCount).\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_inbox_categories(ctx, g);
    }));

inbox_command.command('categorize')
    .argument('<thread-id>', 'Inbox thread id')
    .option('--category-id <id>', 'File the thread under this category (see `inbox categories`)')
    .option('--clear', 'Take the thread out of its category')
    .description('File a thread under one inbox category, or clear its category (a thread is in at most one)')
    .addHelpText('after', help([ex('inbox categorize 9876 --category-id 7'), ex('inbox categorize 9876 --clear')],
        ['inbox.thread_not_found', 'inbox.category_not_found'], true,
        'Result: {"status":"categorized"|"cleared","thread_id","category_id"}; category_id is null after --clear.\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_inbox_categorize(cmd.args[0], cmd.opts(), ctx, g);
    }));

inbox_command.command('mark-read')
    .argument('<thread-id>', 'Inbox thread id')
    .description('Mark a thread as read (one that is already read stays read)')
    .addHelpText('after', help([ex('inbox mark-read 9876')], ['inbox.thread_not_found'], true, 'Result: {"status":"read","thread_id"}\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_inbox_mark_read(cmd.args[0], ctx, g);
    }));

inbox_command.command('mark-unread')
    .argument('<thread-id>', 'Inbox thread id')
    .description('Mark a thread as unread, so it needs attention again')
    .addHelpText('after', help([ex('inbox mark-unread 9876')], ['inbox.thread_not_found'], true, 'Result: {"status":"unread","thread_id"}\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_inbox_mark_unread(cmd.args[0], ctx, g);
    }));

export {sequence_command, contact_list_command, contact_command, inbox_command};
