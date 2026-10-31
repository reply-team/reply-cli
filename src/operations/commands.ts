import {Command} from 'commander';
import {PROGRAM_NAME} from '../config';
import {build_context} from '../context';
import {read_op_globals} from './options';
import {add_contact_options, CONTACT_FORMS, CONTACT_HELP} from './contact-input';
import {handle_sequence_get, handle_sequence_contacts, handle_sequence_stats} from './sequence-read';
import {handle_sequence_list, handle_sequence_create} from './sequence-by-name';
import {handle_sequence_add_contact, handle_sequence_remove_contact} from './sequence-membership';
import {handle_sequence_pause, handle_sequence_start} from './sequence-state';
import {
    handle_inbox_list, handle_inbox_changes, handle_inbox_get, handle_inbox_categories, handle_inbox_categorize, handle_inbox_mark_read, handle_inbox_mark_unread,
} from './inbox';
import {handle_inbox_reply} from './inbox-reply';
import {handle_contact_list_add_contact} from './contact-list';
import {handle_contact_opt_out} from './contact';
import {handle_contact_find, handle_contact_get, handle_contact_update, handle_contact_delete} from './contact-record';
import {handle_direct_send, type Direct_send_name} from './direct-send';
import {handle_account_list} from './accounts';
import {handle_schedule_list} from './schedules';
import {handle_direct_send_get, handle_direct_send_cancel} from './direct-sends';

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

const ALWAYS_IMPORTED = 'A contact given by email is always imported, so Reply needs a first name, even for one it already holds.\n'
    + 'One given only by LinkedIn URL is looked up first and imported only when Reply holds nobody under it.\n';

// The codes a command that finds or imports a contact shares with the add commands.
const IMPORT_CODES = ['contact.not_unique', 'contact.invalid_email', 'contact.invalid_linkedin_url', 'account.contact_limit_reached'];

// Both inputs on stdin, the person and the one the command acts with.
const STDIN_PAIR = (input: string): string=>
    `With --contact - and --${input} - both, stdin holds one object: {"contact": {…}, "${input}": {…}}.\n`;

const run = (fn: (cmd: Command) => Promise<void>)=>async function(this: Command): Promise<void>
{
    await fn(this);
};

const ctx_of = (cmd: Command)=>{
    const g = read_op_globals(cmd);
    return {g, ctx: build_context({profile: g.profile})};
};

const sequence_command = new Command('sequence')
    .description('Find or create a sequence by name, read it, put contacts in or take them out, pause or start it');

sequence_command.command('list')
    .option('--name <stdin>', 'Only -: {name} as JSON on stdin')
    .description('Every sequence whose name is this one, ignoring case, archived ones included')
    .addHelpText('after', help([`echo '{"name":"Q4 outreach"}' | ${P} sequence list --name -`], ['sequence.list_incomplete'], false,
        'Result: {"items":[{"id","name","status","is_archived","created_at"}]}, oldest first: Reply\'s status (new, active,\n'
            + 'paused), archive flag and creation time, each null when Reply gives none. The name is read from stdin only, so it\n'
            + 'never sits in the argument list. The list is read to its end; sequence.list_incomplete means it did not end within\n'
            + '20000 sequences whose names contain this one.\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_sequence_list(cmd.opts(), ctx, g);
    }));

sequence_command.command('create')
    .option('--name <stdin>', 'Only -: {name} as JSON on stdin')
    .description('Make a draft sequence of this name, holding nobody, with one task step to replace before it is started')
    .addHelpText('after', help([`echo '{"name":"Q4 outreach"}' | ${P} sequence create --name -`], [], true,
        'Result: {"sequence_id","steps_added","status","is_archived"}: status and is_archived are Reply\'s for the new sequence.\n'
            + 'The name is read from stdin only, so it never sits in the argument list. Reply allows two sequences of one name and\n'
            + 'this command does not look first: run `sequence list --name -` before it. The one step is a task for the owner, which\n'
            + 'reaches nobody; Reply gives the draft the account\'s default schedule and mailbox. The draft is never started here.\n',
        'the sequence may have been made; running the command again may make a second one, so look it up by name first'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_sequence_create(cmd.opts(), ctx, g);
    }));

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
    .description('Put a contact into the sequence, creating the contact if Reply has nobody under the address')
    .addHelpText('after', help(
        [piped('sequence add-contact 123'), ex('sequence add-contact 123 --email ann@example.com --first-name Ann'),
            ex('sequence add-contact 123 --contact-id 456 --start-step 2')],
        ['sequence.not_found', 'sequence.archived', 'sequence.has_no_steps', 'sequence.step_not_found', 'contact.not_found',
            'contact.not_unique', 'contact.opted_out', 'contact.invalid_email', 'contact.invalid_linkedin_url',
            'account.contact_limit_reached'],
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
        ['sequence.not_found', 'contact.not_unique'], true,
        'Result: {"status":"removed"|"not_in_sequence","sequence_id","contact_id"}\n'
            + CONTACT_HELP + 'A contact given by email or LinkedIn URL is only looked up, never imported, so no first name is needed.\n'))
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
    .description('Put a contact on the list, creating the contact if Reply has nobody under the address')
    .addHelpText('after', help([piped('contact-list add-contact 77'), ex('contact-list add-contact 77 --contact-id 456 --refuse-opted-out')],
        ['contact-list.not_found', 'contact.not_found', 'contact.not_unique', 'contact.opted_out', 'contact.invalid_email',
            'contact.invalid_linkedin_url', 'account.contact_limit_reached'], true,
        'Result: {"status":"added","list_id","contact_id","contact_created"}\n' + CONTACT_HELP + ALWAYS_IMPORTED))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_contact_list_add_contact(cmd.args[0], cmd.opts(), ctx, g);
    }));

const contact_command = new Command('contact').description('Find a contact, read it, change or delete it, opt it out, or send to it outside a sequence');

contact_command.command('find')
    .option('--contact <stdin>', 'Only -: {email} or {linkedin_url} as JSON on stdin')
    .description('The id of the contact Reply holds under an email or a LinkedIn URL. Never creates a contact')
    .addHelpText('after', help(
        [`echo '{"email":"ann@example.com"}' | ${P} contact find --contact -`,
            `echo '{"linkedin_url":"https://www.linkedin.com/in/ann-example"}' | ${P} contact find --contact -`],
        ['contact.not_unique'], false,
        'Result: {"contact_id"}: null when Reply holds nobody under the address.\n'
            + 'The address is read from stdin only, so it never sits in the argument list. An email matches ignoring case. A\n'
            + 'LinkedIn URL is matched by its lowercased slug: on linkedin.com the path\'s case does not count, nor the scheme\'s or\n'
            + 'host\'s, a default port, one trailing slash or a fragment, while www and the query do; Reply is asked for it in that\n'
            + 'form first, then as given. contact.not_unique means Reply holds more than one contact under the address.\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_contact_find(cmd.opts(), ctx, g);
    }));

contact_command.command('get')
    .argument('<contact-id>', 'Contact id')
    .description('The contact as Reply holds it: fields, owner, opt-out, custom fields')
    .addHelpText('after', help([ex('contact get 456')], ['contact.not_found'], false))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_contact_get(cmd.args[0], ctx, g);
    }));

add_contact_options(contact_command.command('update')
    .argument('[contact-id]', 'Contact id (or give the contact by the flags below)'), true)
    .option('--fields <stdin>', 'Only -: the fields to change as JSON on stdin')
    .description('Change some of a contact\'s fields and custom fields; the rest stay as they are')
    .addHelpText('after', help(
        [`echo '{"title":"CTO","company":"Acme"}' | ${P} contact update 456 --fields -`,
            `echo '{"last_name":null,"custom_fields":[{"name":"leadSource","value":"Event"}]}' | ${P} contact update 456 --fields -`,
            `echo '{"contact":{"email":"ann@example.com","first_name":"Ann"},"fields":{"title":"CTO"}}' | ${P} contact update --contact - --fields -`],
        ['contact.not_found', ...IMPORT_CODES, 'contact.field_not_found'], true,
        'Result: {"status":"updated","contact_id","contact_created"}\n'
            + 'Fields: {first_name, last_name, company, title, linkedin_url, custom_fields: [{name, value}]}; a field left out stays as\n'
            + 'it is, and null clears one. They are read from stdin only, so no value ever sits in the argument list. The CLI stores\n'
            + 'a LinkedIn URL by its lowercased slug, the form contacts are looked up by. A custom field is named as the account\n'
            + 'names it (ignoring case); a name the account has none of is contact.field_not_found, and then nothing is changed.\n'
            + CONTACT_FORMS
            + 'contact update 456 is contact update --contact-id 456. A contact given by its fields is looked up as the add commands\n'
            + 'look one up, by its email, or one with only a LinkedIn URL by that, and imported only when Reply holds nobody under\n'
            + 'it, as they import one; only then does Reply need a first name. A LinkedIn URL is matched by its lowercased slug,\n'
            + 'and the CLI stores it by that slug when it imports the contact. Those fields only find or import the contact: on\n'
            + 'one Reply holds, only what --fields names is changed. contact_created says whether this command created it.\n'
            + STDIN_PAIR('fields')))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_contact_update(cmd.args[0], cmd.opts(), ctx, g);
    }));

contact_command.command('delete')
    .argument('<contact-id>', 'Contact id')
    .description('Delete a contact from the account, with its history at Reply')
    .addHelpText('after', help([ex('contact delete 456')], ['contact.not_found'], true,
        'Result: {"status":"deleted","contact_id"}\n'
            + 'After exit 3 the contact may already be gone: running the command again is safe, and then answers contact.not_found.\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_contact_delete(cmd.args[0], ctx, g);
    }));

add_contact_options(contact_command.command('opt-out'), true)
    .description('Mark the contact as opted out at Reply, creating them only if Reply has nobody under the address')
    .addHelpText('after', help([piped('contact opt-out'), ex('contact opt-out --contact-id 456')],
        ['contact.not_found', 'contact.not_unique', 'contact.invalid_email', 'contact.invalid_linkedin_url', 'account.contact_limit_reached'], true,
        'Result: {"status":"opted_out","contact_id","contact_created"}\n' + CONTACT_HELP
            + 'A contact given by email or LinkedIn URL is imported only when Reply holds nobody under the address; only then does\n'
            + 'Reply need a first name.\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_contact_opt_out(cmd.opts(), ctx, g);
    }));

const SEND_TWICE = (what: string): string=>
    `the ${what} may have been sent; running the command again may send it twice, unless the hint says nothing was sent`;

const LINKEDIN_URL_NEEDED = 'A LinkedIn send needs the contact\'s linkedin_url in --contact (or --contact-id); --email alone is refused '
    + '(usage.contact).\n';

// How a send names its contact: looked up by every address it was given, else imported as an add imports one; and
// it sends only to a contact it created, naming one Reply already holds instead.
const SENT_TO = (by: 'email' | 'linkedin', what: string): string=>CONTACT_FORMS
    + 'A send given a person\'s fields sends only to a contact it creates. The contact is looked up by\n'
    + `${by === 'email' ? 'its email' : 'its LinkedIn URL'}, where the ${what} goes, then by its ${by === 'email' ? 'LinkedIn URL' : 'email'} when it was given one, and imported only when\n`
    + 'Reply holds nobody under any address given, as the add commands import one (matched by its email when it has\n'
    + 'one), so Reply needs a first name. When a lookup finds a contact,\n'
    + 'or the import matches one Reply already holds, nothing is sent: the answer is contact.already_held (exit 1)\n'
    + 'with that contact\'s id in ids.contact_id. Read that contact first (contact get shows it, its opt-out included),\n'
    + 'and send to it with --contact-id if it is the one to reach. A LinkedIn URL is matched by its lowercased slug, and\n'
    + `the CLI stores it by that slug when it imports the contact. contact_id is the contact the ${what} went to, and\n`
    + 'contact_created is kept for consistency with the add commands: given a person\'s fields it is always true, and with\n'
    + '--contact-id it is always false; in both cases a successful answer says the send was made.\n'
    + (by === 'email' ? '' : LINKEDIN_URL_NEEDED) + STDIN_PAIR('message');

// The flags of a send for later, the same on every direct send.
const later_options = (c: Command): Command=>c
    .option('--send-after <moment>', 'Send at or after this moment, given with its offset (e.g. 2026-11-03T14:00:00Z)')
    .option('--schedule-id <id>', 'The sending schedule Reply times the send by (see `schedule list`)')
    .option('--idempotency-key <key>', 'Your own key for this send, sent as the Idempotency-Key header');

const LATER = 'With --send-after Reply holds the send until that moment, given with its offset and sent to Reply in UTC; a moment\n'
    + 'without an offset is refused (usage.date). --schedule-id names the sending schedule Reply times the send by. The\n'
    + 'answer then adds Reply\'s reference, send_after and state, each only when Reply gives it: status "sent" means Reply\n'
    + 'took the send; state, when Reply gives it, says whether it has gone out: queued, waitingForSchedule or sending is not\n'
    + 'yet, then sent, failed or cancelled. direct-send get <reference> reads it later, and direct-send cancel <reference>\n'
    + 'stops one not yet sent. An answer without state comes from a Reply that does not know --send-after and --schedule-id:\n'
    + 'it sent at once, as without them. --idempotency-key goes as the Idempotency-Key header, never in the body. A Reply\n'
    + 'that knows the header answers a repeat with the same key with the send the key first made; while that one is still\n'
    + 'being made the answer is idempotency_key.in_use, and the same key on a different send is idempotency_key.reused.\n'
    + 'Neither sends anything. A repeat of a send given a person\'s fields answers contact.already_held first, since the first\n'
    + 'one created the contact: that is safe too, as nothing is sent twice. idempotency_key.reused names the send the key was\n'
    + 'first taken for in details: reference, state and send_after, each only when Reply gives it. Any other refusal of a\n'
    + 'send Reply already holds names that send the same way, beside the refusal\'s own details; its code is the refusal\'s\n'
    + 'own. A 400 to the send with neither a code nor errors[] is Reply failing while it made the send: like a 5xx or a lost\n'
    + 'answer, it is outcome.unknown (exit 3). So is a 400 directLinkedIn.unknown to a LinkedIn send, Reply\'s answer when it\n'
    + 'failed while making the send or could not map the provider\'s answer; Reply\'s code is kept in reply_code. A 400 with\n'
    + 'errors[] is reply.invalid_request, and nothing was sent.\n';

// The refusals of a send's key, the same on every direct send, after each send's own.
const KEY_CODES = ['idempotency_key.in_use', 'idempotency_key.reused'];

// One send's example with the person and the text both on stdin.
const piped_send = (command: string, contact: string, message: string, flags: string): string=>
    `echo '{"contact":${contact},"message":${message}}' | ${P} contact ${command} --contact - ${flags} --message -`;
const ANN_EMAIL = '{"email":"ann@example.com","first_name":"Ann"}';
const ANN_PROFILE = '{"linkedin_url":"https://www.linkedin.com/in/ann-example","first_name":"Ann"}';

// The time zone a send timed by a schedule is read in, which every send takes. Without either flag nothing is sent, so
// the schedule's own setting holds.
const time_zone_options = (c: Command): Command=>c
    .option('--use-contact-time-zone', 'Read the schedule\'s windows in the contact\'s time zone (with --schedule-id)')
    .option('--no-use-contact-time-zone', 'Read the schedule\'s windows in the schedule\'s own time zone (with --schedule-id)');

// The flags Reply's LinkedIn sends take for a send made later: the time zone, and the retry window only they take.
const scheduler_options = (c: Command): Command=>time_zone_options(c)
    .option('--retry-window-minutes <n>', 'How long Reply keeps trying once the send is due, 1 to 4320 (Reply\'s default: 90)');

// What a send timed by a schedule answers while it waits for the schedule's next opening, the time zone it is read in, and
// the refusals of one Reply cannot time.
const SCHEDULED = 'A send timed by --schedule-id may answer state waitingForSchedule, held for the schedule\'s next opening: send_after is\n'
    + 'then left out, and estimated_send_at is when Reply expects to send it. Reply sets estimated_send_at in\n'
    + 'waitingForSchedule only and gives it null in every other state; it is null in waitingForSchedule too when the schedule\n'
    + 'does not open within 30 days of the moment the send waits from: its --send-after, or when Reply took it. It is added\n'
    + 'only when Reply gives it. --use-contact-time-zone sends useContactTimeZone true: the schedule\'s windows are read in\n'
    + 'the contact\'s time zone; --no-use-contact-time-zone sends false, the schedule\'s own zone; with neither, the schedule\'s\n'
    + 'own setting holds. Reply takes it only with --schedule-id, and answers it otherwise with errors[]\n'
    + '(reply.invalid_request). schedule.not_found is a --schedule-id naming no schedule this account can read,\n'
    + 'schedule.no_slot a schedule with no active day that has a time range, so it never opens, and contact.time_zone_missing\n'
    + 'a contact without the time zone --use-contact-time-zone reads it in; none sends anything.\n';

// The codes of a send Reply cannot time, the same on every route.
const SCHEDULE_CODES = ['schedule.not_found', 'schedule.no_slot', 'contact.time_zone_missing'];

// The retry window only a LinkedIn send takes.
const LINKEDIN_SCHEDULED = '--retry-window-minutes <n> is how long Reply keeps trying to send it once it is due, 1 to 4320\n'
    + 'minutes (Reply\'s default is 90); one outside that is refused before any call (usage.range). Reply takes it only with\n'
    + '--schedule-id or --send-after, and answers it otherwise with errors[] (reply.invalid_request).\n';

time_zone_options(later_options(add_contact_options(contact_command.command('send-email'), true)
    .option('--email-account-id <id>', 'The mailbox to send from (see `account list`)')
    .option('--message <stdin>', 'Only -: the email {subject, body} as JSON on stdin')
    .option('--track-links', 'Track the links in the email (off unless given)')
    .option('--track-opens', 'Track the opens of the email (off unless given)')))
    .description('Send one email to a contact now, outside any sequence, from the mailbox you name')
    .addHelpText('after', help(
        [`echo '{"subject":"Quick question","body":"<p>Hi Ann, does Tuesday work?</p>"}' | ${P} contact send-email --contact-id 456 --email-account-id 12 --message -`,
            piped_send('send-email', ANN_EMAIL, '{"subject":"Quick question","body":"<p>Hi Ann</p>"}', '--email-account-id 12')],
        ['contact.not_found', ...IMPORT_CODES, 'contact.already_held', 'email_account.not_found', 'contact.blacklisted',
            'contact.missing_variables', 'contact.rendering_failed', ...SCHEDULE_CODES, ...KEY_CODES], true,
        'Result: {"status":"sent","contact_id","contact_created","message_id","sent_at","reply_status"}: sent means Reply\n'
            + 'accepted the email, and reply_status is Reply\'s own word for it (new or sent). message_id is Reply\'s messageId,\n'
            + 'null when it gives none. Reply\'s answer carries no time, so sent_at is always null; the CLI adds none of its own.\n'
            + 'The email is read from stdin only, so its text never sits in the argument list. The body is HTML. Without\n'
            + '--send-after, Reply sends a direct email at once, outside the mailbox\'s daily limit and sending delay.\n'
            + 'Reply tracks neither links nor opens unless --track-links or --track-opens asks it to. An email sent within the\n'
            + 'request adds rendered_subject and rendered_body, the subject and body as Reply filled them in, when Reply gives\n'
            + 'them; a send held for later has neither. contact.missing_variables names the variables Reply could not fill in\n'
            + 'details.missing_variables when Reply lists them, and contact.rendering_failed is a template Reply could not\n'
            + 'render, its message in detail. Neither sends anything.\n'
            + LATER + SCHEDULED + SENT_TO('email', 'email'),
        SEND_TWICE('email')))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_direct_send('send-email', cmd.opts(), ctx, g);
    }));

// The four LinkedIn sends share their flags, their first codes and the shape of their result.
const LINKEDIN_SEND_CODES = [
    'contact.not_found', ...IMPORT_CODES, 'contact.already_held', 'contact.no_linkedin_profile', 'linkedin.account_not_found',
    'linkedin.feature_disabled', 'linkedin.account_inactive', 'linkedin.invalid_cookie', ...SCHEDULE_CODES,
];
const LINKEDIN_SENT = '"contact_id","contact_created","activity_id","sent_at"}:\n'
    + 'activity_id and sent_at are Reply\'s linkedInActivityId and sentAtUtc as Reply gives them, each null when it gives\n'
    + 'none; the CLI adds no time of its own.\n';
const VARIABLES = (where: string): string=>
    `Reply reads {{…}} in the ${where} as its template variables; one it cannot fill is linkedin.missing_variables.\n`;
const LINKEDIN_EXAMPLE = '--contact-id 456 --linkedin-account-id 34';

const linkedin_send = (
    name: Exclude<Direct_send_name, 'send-email'>, description: string, message: string, examples: string[], codes: string[],
    extra: string, what: string,
): void=>{
    scheduler_options(later_options(add_contact_options(contact_command.command(name), true)
        .option('--linkedin-account-id <id>', 'The LinkedIn account to send from (see `account list`)')
        .option('--message <stdin>', `Only -: the ${message} as JSON on stdin`)))
        .description(description)
        .addHelpText('after', help(examples, [...LINKEDIN_SEND_CODES, ...codes, ...KEY_CODES], true, extra + LATER + SCHEDULED + LINKEDIN_SCHEDULED + SENT_TO('linkedin', what),
            SEND_TWICE(what)))
        .action(run(async(cmd)=>{
            const {g, ctx} = ctx_of(cmd);
            await handle_direct_send(name, cmd.opts(), ctx, g);
        }));
};

linkedin_send('linkedin-connect', 'Invite a contact to connect on LinkedIn, with or without a note', 'note {note}',
    [`echo '{"note":"Hi Ann, we met at the meetup."}' | ${P} contact linkedin-connect ${LINKEDIN_EXAMPLE} --message -`,
        ex(`contact linkedin-connect ${LINKEDIN_EXAMPLE}`),
        piped_send('linkedin-connect', ANN_PROFILE, '{"note":"Hi Ann, we met at the meetup."}', '--linkedin-account-id 34'),
        `echo '${ANN_PROFILE}' | ${P} contact linkedin-connect --contact - --linkedin-account-id 34`],
    ['linkedin.not_connected', 'linkedin.limit_reached', 'linkedin.message_too_long', 'linkedin.missing_variables'],
    'Result: {"status":"sent"|"already_connected",' + LINKEDIN_SENT
        + 'already_connected means the contact is already a connection: nothing is sent, and activity_id and sent_at are null.\n'
        + 'The note is read from stdin only, so its text never sits in the argument list; without --message the invitation\n'
        + 'carries no note, and stdin holds the contact alone. Reply publishes no limit for a note, and one it finds too long\n'
        + 'is linkedin.message_too_long.\n'
        + VARIABLES('note'),
    'invitation');

linkedin_send('linkedin-message', 'Send a LinkedIn message to a contact the account is connected with', 'message {body}',
    [`echo '{"body":"Thanks for connecting, Ann."}' | ${P} contact linkedin-message ${LINKEDIN_EXAMPLE} --message -`,
        piped_send('linkedin-message', ANN_PROFILE, '{"body":"Thanks for connecting, Ann."}', '--linkedin-account-id 34')],
    ['linkedin.not_connected', 'linkedin.limit_reached', 'linkedin.message_too_long', 'linkedin.missing_variables'],
    'Result: {"status":"sent",' + LINKEDIN_SENT
        + 'The message is read from stdin only, so its text never sits in the argument list. Reply takes a body of at most\n'
        + '8000 characters.\n' + VARIABLES('body'),
    'message');

linkedin_send('linkedin-inmail', 'Send a LinkedIn InMail, which reaches a contact the account is not connected with (needs Sales Navigator and InMail credits)',
    'InMail {subject, body}',
    [`echo '{"subject":"Quick question","body":"Hi Ann, does Tuesday work?"}' | ${P} contact linkedin-inmail ${LINKEDIN_EXAMPLE} --message -`,
        piped_send('linkedin-inmail', ANN_PROFILE, '{"subject":"Quick question","body":"Hi Ann, does Tuesday work?"}', '--linkedin-account-id 34')],
    ['linkedin.limit_reached', 'linkedin.message_too_long', 'linkedin.missing_variables', 'linkedin.sales_navigator_required',
        'linkedin.sales_navigator_disconnected', 'linkedin.no_inmail_credits'],
    'Result: {"status":"sent",' + LINKEDIN_SENT
        + 'The InMail is read from stdin only, so its text never sits in the argument list. Reply takes a subject of at most\n'
        + '200 characters and a body of at most 1900.\n' + VARIABLES('text'),
    'InMail');

linkedin_send('linkedin-voice', 'Send a LinkedIn voice message that Reply speaks from a script in the account\'s voice', 'script {script}',
    [`echo '{"script":"Hi Ann, a quick hello about Tuesday."}' | ${P} contact linkedin-voice ${LINKEDIN_EXAMPLE} --message -`,
        piped_send('linkedin-voice', ANN_PROFILE, '{"script":"Hi Ann, a quick hello about Tuesday."}', '--linkedin-account-id 34')],
    ['linkedin.not_connected', 'linkedin.limit_reached', 'linkedin.missing_variables', 'linkedin.voice_profile_missing',
        'linkedin.voice_too_long'],
    'Result: {"status":"sent",' + LINKEDIN_SENT
        + 'The script is read from stdin only, so its text never sits in the argument list. Reply takes at most 1000 characters\n'
        + 'and speaks them with the LinkedIn account\'s voice profile; a recorded message cannot be sent here.\n' + VARIABLES('script'),
    'voice message');

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

inbox_command.command('changes')
    .option('--cursor <cursor>', 'Go on from the cursor a previous page answered, passed back unchanged')
    .option('--since <moment>', 'Start at this moment, inclusive, given with its offset; at most 30 days ago')
    .option('--top <n>', 'Items per page, 1-1000 (default: Reply\'s)')
    .description('One page of the inbox feed: each thread whose latest message changed, oldest first, read forward by cursor')
    .addHelpText('after', help([ex('inbox changes --since 2026-11-01T00:00:00Z'), ex('inbox changes --cursor AQjfObhYHZgAAADjVg --top 200')],
        ['inbox.cursor_expired', 'inbox.cursor_refused'], false,
        'Result: {"items","has_more","cursor"}, the items as Reply gives them, one per thread whose latest message, inbound\n'
            + 'or outbound, changed: threadId, contactId, channel, lastActivityDate, flags (hasReply, hasBounce, hasAutoReply,\n'
            + 'hasOutOfOffice) and lastMessage among them. Give --cursor or --since, not both; with neither, Reply reads the last\n'
            + '30 days. Call again with the answered cursor while has_more is true, and loop on has_more, not on the number of\n'
            + 'items: an empty page still carries a cursor, and when has_more is false that cursor is where the next read starts.\n'
            + '--since goes to Reply in UTC; a moment without its offset is refused (usage.date). A cursor or a --since older\n'
            + 'than 30 days is inbox.cursor_expired: start again with --since. A cursor Reply will not read otherwise,\n'
            + 'unreadable or ahead of its clock, is inbox.cursor_refused, with cursor in details.fields; start again the same way.\n'
            + 'A Reply without the feed answers reply.refused with status 404 and no reply_code.\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_inbox_changes(cmd.opts(), ctx, g);
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
        'Result: {"status":"sent","thread_id","channel":"email"|"linkedin","message_id","sent_at"}: Reply\'s messageId and date,\n'
            + 'each null when Reply gives none.\n'
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

const account_command = new Command('account').description('List the email and LinkedIn accounts a send can go from');

account_command.command('list')
    .option('--channel <channel>', 'email | linkedin: only the accounts of this channel')
    .description('The email and LinkedIn accounts a send can go from, and the state of each')
    .addHelpText('after', help([ex('account list'), ex('account list --channel linkedin')], ['account.list_incomplete'], false,
        'Result: {"items":[{"id","channel","name","address","owner_user_id","status","reply_status"}]}, the email accounts\n'
            + 'first: status is active, inactive, disconnected or other, and reply_status is Reply\'s own word for it. name is the\n'
            + 'sender name or the LinkedIn name, and address the mailbox\'s email or the LinkedIn profile URL. In a team that shares\n'
            + 'its accounts the list holds teammates\' accounts too, and owner_user_id is the Reply user whose each one is. Each is\n'
            + 'null when Reply gives none. A LinkedIn account at its daily limit is active: a send that meets the limit answers\n'
            + 'linkedin.limit_reached. Every page is read; account.list_incomplete means the email accounts did not end within 20000.\n'
            + 'Without --channel both lists are read, and one the account\'s plan or role does not include fails the whole command\n'
            + '(its reply_code says which); --channel reads one channel alone.\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_account_list(cmd.opts(), ctx, g);
    }));

const schedule_command = new Command('schedule').description('List the sending schedules a sequence can send within');

schedule_command.command('list')
    .description('Every sending schedule the account can use, with its time zone and its sending windows by weekday')
    .addHelpText('after', help([ex('schedule list')], [], false,
        'Result: {"items":[{"id","name","time_zone_id","use_recipient_time_zone","exclude_holidays","is_default","main_timings",\n'
            + '"use_follow_up_schedule","follow_up_timings","reply_status"}]}, in the order Reply gives them, all in one answer.\n'
            + 'time_zone_id is a Windows time zone identifier (e.g. "Eastern Standard Time"), as Reply holds it. main_timings has\n'
            + 'one entry for each day Reply holds, in Reply\'s order: {"week_day","active","ranges":[{"from","to"}]}, the weekday\n'
            + 'in lower case and each time of day as HH:MM; a range may end at 24:00, the end of the day. follow_up_timings are\n'
            + 'the windows of the later steps, which Reply uses when use_follow_up_schedule is true. is_default says whether the\n'
            + 'schedule is your default. reply_status is Reply\'s own word for how the schedule is used: unknown,\n'
            + 'inCampaignTemplate, inCurrentUserSequence, inTeamMemberSequence, isDefaultForCurrentUser or isDefaultForTeamMember,\n'
            + 'only the first of them that holds. A name, time zone, weekday, time or reply_status Reply gives none of is null;\n'
            + 'follow_up_timings is null when Reply gives no list. A key without Reply\'s sequences read scope is\n'
            + 'access.feature_unavailable.\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_schedule_list(ctx, g);
    }));

const direct_send_command = new Command('direct-send').description('Read or cancel a direct send Reply holds to send later');

const DIRECT_SEND = 'Result: {"reference","channel","contact_id","state","send_after","sent_at","message_id","failure_reason",\n'
    + '"cancelled_at"}, Reply\'s fields under these names, each null when Reply gives none. The reference is Reply\'s, from the\n'
    + 'answer of a send made with --send-after: email-<n>, linkedin-<n> or linkedin-scheduled-<n>, the form Reply\'s route\n'
    + 'takes. A reference of any other form is refused before any call (usage.reference, exit 2), and nothing else is read\n'
    + 'from it. state is Reply\'s own word: queued, waitingForSchedule or sending is not yet sent, then sent, failed or\n'
    + 'cancelled. failure_code, missing_variables, rendered_subject and rendered_body are added only when Reply gives them:\n'
    + 'failure_reason is a sentence for a person, never parsed; failure_code is Reply\'s code for the failure, the one to\n'
    + 'branch on. A failed send may carry no failure_code: it is then null, and failure_reason is all Reply says of it.\n'
    + 'missing_variables lists the template variables Reply could not fill, and rendered_subject and rendered_body are the\n'
    + 'text as Reply filled it in. estimated_send_at is added only when Reply gives it, and is when Reply expects a send\n'
    + 'waiting for its schedule\'s next opening to go out. Reply sets estimated_send_at in waitingForSchedule only and gives\n'
    + 'it null in every other state; it is null in waitingForSchedule too when the schedule does not open within 30 days of\n'
    + 'the moment the send waits from: its --send-after, or now once that has passed. A Reply without this route answers\n'
    + 'reply.refused with status 404 and no reply_code; a reference of any other form never leaves the CLI, so that 404 means\n'
    + 'this Reply has no such route.\n'
    + 'direct_send.not_found is a reference that Reply has no send for, a send of another team included.\n'
    + 'direct_send.not_owned is an email send made by a teammate this user may not act for.\n';

direct_send_command.command('get')
    .argument('<reference>', 'The send\'s reference, email-<n>, linkedin-<n> or linkedin-scheduled-<n>, as a send made with --send-after answered it')
    .description('One direct send as Reply holds it: whether it has gone out, when, and why it failed')
    .addHelpText('after', help([ex('direct-send get email-1001')], ['direct_send.not_found', 'direct_send.not_owned'], false, DIRECT_SEND))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_direct_send_get(cmd.args[0], ctx, g);
    }));

direct_send_command.command('cancel')
    .argument('<reference>', 'The send\'s reference, email-<n>, linkedin-<n> or linkedin-scheduled-<n>, as a send made with --send-after answered it')
    .description('Stop a direct send that has not gone out yet')
    .addHelpText('after', help([ex('direct-send cancel email-1001')],
        ['direct_send.not_found', 'direct_send.not_owned', 'direct_send.already_sent', 'direct_send.already_failed',
            'direct_send.already_sending', 'direct_send.cancel_not_confirmed'], true,
        DIRECT_SEND + 'The answer is the send as Reply now holds it, state cancelled. Cancelling a send already cancelled answers it again,\n'
            + 'so running it again is safe. direct_send.already_sent, direct_send.already_failed and direct_send.already_sending mean\n'
            + 'the send was past cancelling; nothing changed. direct_send.already_sending is a LinkedIn send made for later that\n'
            + 'Reply is handing to the account\'s queue or that waits or runs there, even while direct-send get still reads it queued.\n'
            + 'direct_send.cancel_not_confirmed is a 503 from Reply that could not confirm the cancel: the send is still queued or\n'
            + 'waiting for its schedule, so run the cancel again, as Reply asks; retry_after carries Reply\'s Retry-After when it\n'
            + 'sends one. Any other 5xx is outcome.unknown (exit 3).\n'))
    .action(run(async(cmd)=>{
        const {g, ctx} = ctx_of(cmd);
        await handle_direct_send_cancel(cmd.args[0], ctx, g);
    }));

export {sequence_command, contact_list_command, contact_command, inbox_command, account_command, schedule_command, direct_send_command};
