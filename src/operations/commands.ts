import {Command} from 'commander';
import {PROGRAM_NAME} from '../config';
import {build_context} from '../context';
import {read_op_globals, IDEMPOTENCY_KEY_HELP} from './options';
import {add_contact_options, CONTACT_HELP} from './contact-input';
import {handle_sequence_get, handle_sequence_contacts, handle_sequence_stats} from './sequence-read';
import {handle_sequence_add_contact, handle_sequence_remove_contact} from './sequence-membership';
import {handle_sequence_pause, handle_sequence_start} from './sequence-state';
import {handle_inbox_list, handle_inbox_get} from './inbox';
import {handle_contact_list_add_contact} from './contact-list';
import {handle_contact_opt_out} from './contact';

const P = PROGRAM_NAME;
const COMMON_ERRORS = ['access.denied', 'access.feature_unavailable', 'rate_limited', 'reply.unavailable', 'reply.refused'];

const errors_help = (codes: string[], write: boolean): string=>
    '\nErrors (with --json, one line on stderr: {"error":{"code":…,"ids":…}}):\n'
    + [...codes, ...COMMON_ERRORS, ...(write ? ['outcome.unknown'] : [])].map(c=>`  ${c}`).join('\n')
    + '\nExit codes: 0 done · 1 failed, main effect not done (partial effects are in "ids") · 2 usage, nothing sent'
    + ' · 3 outcome unknown (a write may have happened; re-running is safe)';

const help = (examples: string[], codes: string[], write: boolean, extra = ''): string=>
    `\nExamples:\n${examples.map(e=>`  ${P} ${e}`).join('\n')}\n${extra}${errors_help(codes, write)}`;

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
    .addHelpText('after', help(['sequence get 123'], ['sequence.not_found'], false))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_sequence_get(cmd.args[0], ctx, g);
    }));

sequence_command.command('contacts')
    .argument('<sequence-id>', 'Sequence id')
    .option('--limit <n>', 'Contacts per page, 1-1000 (default 100)')
    .option('--offset <n>', 'Contacts to skip (default 0)')
    .description('One page of the contacts in the sequence, newest first, plus the total')
    .addHelpText('after', help(['sequence contacts 123 --limit 50'], ['sequence.not_found'], false))
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
    .addHelpText('after', help(['sequence stats 123 --preset last-month', 'sequence stats 123 --from 2026-09-01 --to 2026-10-01'],
        ['sequence.not_found'], false))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_sequence_stats(cmd.args[0], cmd.opts(), ctx, g);
    }));

add_contact_options(sequence_command.command('add-contact')
    .argument('<sequence-id>', 'Sequence id'))
    .option('--start-step <n>', 'Start at this step of the sequence (1 = first; the steps must form one chain)')
    .option('--ignore-step-delay', 'Skip the delay of the step the contact starts at (Reply still sends within the sequence\'s schedule)')
    .option('--idempotency-key <key>', IDEMPOTENCY_KEY_HELP)
    .description('Put a contact into the sequence, creating the contact if Reply has nobody under the email')
    .addHelpText('after', help(
        ['sequence add-contact 123 --email ann@acme.com --first-name Ann', 'sequence add-contact 123 --contact-id 456 --start-step 2',
            'sequence add-contact 123 --contact -   # JSON on stdin'],
        ['sequence.not_found', 'sequence.archived', 'sequence.has_no_steps', 'sequence.step_not_found', 'contact.not_found',
            'contact.opted_out', 'contact.invalid_email', 'account.contact_limit_reached'],
        true,
        'Result: {"status":"added"|"already_in_sequence","sequence_id","contact_id","contact_created","sequence_active"}\n' + CONTACT_HELP + '\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_sequence_add_contact(cmd.args[0], cmd.opts(), ctx, g);
    }));

add_contact_options(sequence_command.command('remove-contact')
    .argument('<sequence-id>', 'Sequence id'))
    .option('--idempotency-key <key>', IDEMPOTENCY_KEY_HELP)
    .description('Take a contact out of the sequence; their history stays. Never creates a contact')
    .addHelpText('after', help(['sequence remove-contact 123 --contact-id 456', 'sequence remove-contact 123 --email ann@acme.com'],
        ['sequence.not_found', 'contact.not_unique', 'contact.lookup_incomplete'], true,
        'Result: {"status":"removed"|"not_in_sequence","sequence_id","contact_id"}\n' + CONTACT_HELP + '\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_sequence_remove_contact(cmd.args[0], cmd.opts(), ctx, g);
    }));

sequence_command.command('pause')
    .argument('<sequence-id>', 'Sequence id')
    .option('--idempotency-key <key>', IDEMPOTENCY_KEY_HELP)
    .description('Pause the sequence (a paused one stays paused)')
    .addHelpText('after', help(['sequence pause 123'], ['sequence.not_found', 'sequence.archived', 'sequence.not_pausable', 'sequence.busy'], true,
        'Result: {"status":"paused","sequence_id"}\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_sequence_pause(cmd.args[0], cmd.opts(), ctx, g);
    }));

sequence_command.command('start')
    .argument('<sequence-id>', 'Sequence id')
    .option('--expect-contacts <n>', 'Start only if the sequence holds exactly this many contacts')
    .option('--idempotency-key <key>', IDEMPOTENCY_KEY_HELP)
    .description('Start (or resume) the sequence: step 1 goes to everyone in it')
    .addHelpText('after', help(['sequence start 123', 'sequence start 123 --expect-contacts 40'],
        ['sequence.not_found', 'sequence.archived', 'sequence.not_startable', 'sequence.busy', 'sequence.contact_count_changed'], true,
        'Result: {"status":"started"|"already_active","sequence_id","contacts"} (already_active and contacts only with --expect-contacts)\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_sequence_start(cmd.args[0], cmd.opts(), ctx, g);
    }));

const contact_list_command = new Command('contact-list').description('Put contacts on a contact list');

add_contact_options(contact_list_command.command('add-contact')
    .argument('<list-id>', 'Contact list id'))
    .option('--refuse-opted-out', 'Refuse a contact Reply holds as opted out (a list may otherwise hold them)')
    .option('--idempotency-key <key>', IDEMPOTENCY_KEY_HELP)
    .description('Put a contact on the list, creating the contact if Reply has nobody under the email')
    .addHelpText('after', help(['contact-list add-contact 77 --email ann@acme.com --first-name Ann', 'contact-list add-contact 77 --contact-id 456 --refuse-opted-out'],
        ['contact-list.not_found', 'contact.not_found', 'contact.opted_out', 'contact.invalid_email', 'account.contact_limit_reached'], true,
        'Result: {"status":"added","list_id","contact_id","contact_created"}\n' + CONTACT_HELP + '\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_contact_list_add_contact(cmd.args[0], cmd.opts(), ctx, g);
    }));

const contact_command = new Command('contact').description('Act on a contact');

add_contact_options(contact_command.command('opt-out'))
    .option('--idempotency-key <key>', IDEMPOTENCY_KEY_HELP)
    .description('Mark the contact as opted out at Reply, creating them only if Reply has nobody under the email')
    .addHelpText('after', help(['contact opt-out --email ann@acme.com', 'contact opt-out --contact-id 456'],
        ['contact.not_found', 'contact.not_unique', 'contact.lookup_incomplete', 'contact.invalid_email', 'account.contact_limit_reached'], true,
        'Result: {"status":"opted_out","contact_id","contact_created"}\n' + CONTACT_HELP + '\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_contact_opt_out(cmd.opts(), ctx, g);
    }));

const inbox_command = new Command('inbox').description('Read inbox threads');

inbox_command.command('list')
    .option('--contact-id <id>', 'Threads with this contact')
    .option('--sequence-id <id>', 'Threads of this sequence')
    .option('--source <source>', 'inbox | sent | unread | ai-draft (Reply\'s default: inbox)')
    .option('--since <iso>', 'Only threads that moved at or after this moment')
    .option('--limit <n>', 'Threads per page, 1-100 (default 20)')
    .option('--offset <n>', 'Threads to skip (default 0)')
    .description('One page of inbox threads, by contact or by sequence')
    .addHelpText('after', help(['inbox list --contact-id 456', 'inbox list --sequence-id 123 --source unread --since 2026-10-01T00:00:00Z'], [], false))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_inbox_list(cmd.opts(), ctx, g);
    }));

inbox_command.command('get')
    .argument('<thread-id>', 'Inbox thread id')
    .option('--limit <n>', 'Messages per page, 1-20 (default 20)')
    .option('--offset <n>', 'Messages to skip (default 0)')
    .description('One inbox thread and one page of its messages, oldest first')
    .addHelpText('after', help(['inbox get 9876', 'inbox get 9876 --offset 20'], ['inbox.thread_not_found'], false))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_inbox_get(cmd.args[0], cmd.opts(), ctx, g);
    }));

export {sequence_command, contact_list_command, contact_command, inbox_command};
