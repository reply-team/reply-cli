import {describe, it, expect} from 'vitest';
import type {Command} from 'commander';
import {sequence_command, contact_list_command, contact_command, inbox_command, account_command, schedule_command,
    direct_send_command} from '../../operations/commands';

const sub = (parent: Command, name: string): Command=>{
    const found = parent.commands.find(c=>c.name() === name);
    if (!found) throw new Error(`no ${parent.name()} ${name}`);
    return found;
};
const flags = (c: Command): string[]=>c.options.map(o=>o.long as string);
// The help as `--help` prints it, the text added after the options included.
const help_of = (c: Command): string=>{
    let text = '';
    c.configureOutput({writeOut: (s: string)=>{ text += s; }});
    c.outputHelp();
    return text;
};

describe('operations/commands', ()=>{
    it('names the commands in Reply\'s words', ()=>{
        expect(sequence_command.commands.map(c=>c.name())).toEqual(
            ['list', 'create', 'get', 'contacts', 'stats', 'add-contact', 'remove-contact', 'pause', 'start']);
        expect(contact_list_command.commands.map(c=>c.name())).toEqual(['add-contact']);
        expect(contact_command.commands.map(c=>c.name())).toEqual(['find', 'get', 'update', 'delete', 'opt-out',
            'send-email', 'linkedin-connect', 'linkedin-message', 'linkedin-inmail', 'linkedin-voice']);
        expect(inbox_command.commands.map(c=>c.name())).toEqual(['list', 'changes', 'get', 'reply', 'categories', 'categorize', 'mark-read', 'mark-unread']);
        expect(account_command.commands.map(c=>c.name())).toEqual(['list']);
        expect(schedule_command.commands.map(c=>c.name())).toEqual(['list']);
        expect(direct_send_command.commands.map(c=>c.name())).toEqual(['get', 'cancel']);
    });

    it('direct-send get and cancel each take one reference and no flag, and list the refusals Reply gives each', ()=>{
        const expected: [string, string[], boolean][] = [
            ['get', ['direct_send.not_found', 'direct_send.not_owned'], false],
            ['cancel', ['direct_send.not_found', 'direct_send.not_owned', 'direct_send.already_sent', 'direct_send.already_failed',
                'direct_send.already_sending', 'direct_send.cancel_not_confirmed'], true],
        ];
        for (const [name, codes, write] of expected)
        {
            const c = sub(direct_send_command, name);
            expect(flags(c), name).toEqual([]);
            expect(c.registeredArguments.map(a=>a.name()), name).toEqual(['reference']);
            const text = help_of(c);
            const flat = text.replace(/\s+/g, ' ');
            expect(text, name).toContain(codes.map(code=>`  ${code}\n`).join(''));
            expect(text.includes('outcome.unknown'), name).toBe(write);
            expect(flat, name).toContain('The reference is Reply\'s, from the answer of a send made with --send-after');
            expect(flat, name).toContain('state is Reply\'s own word: queued, waitingForSchedule or sending is not yet sent, then sent, failed or cancelled');
            expect(flat, name).toContain('A failed send may carry no failure_code: it is then null');
            expect(flat, name).toContain('A Reply without this route answers reply.refused with status 404 and no reply_code');
            expect(flat, name).toContain('email-<n>, linkedin-<n> or linkedin-scheduled-<n>, the form Reply\'s route takes');
            expect(flat, name).toContain('any other form is refused before any call (usage.reference, exit 2), and nothing else is read from it');
            expect(flat, name).toContain('a reference of any other form never leaves the CLI, so that 404 means this Reply has no such route');
            expect(flat, name).toContain('direct_send.not_found is a reference that Reply has no send for, a send of another team '
                + 'included. direct_send.not_owned is an email send made by a teammate this user may not act for');
            expect(flat, name).not.toContain('step up');
            expect(c.registeredArguments[0].description, name).toContain('email-<n>, linkedin-<n> or linkedin-scheduled-<n>');
            expect(flat, name).toContain('failure_code, missing_variables, rendered_subject and rendered_body are added only when Reply gives them');
            expect(flat, name).toContain('failure_reason is a sentence for a person, never parsed; failure_code is Reply\'s code for the failure');
            expect(flat, name).toContain('estimated_send_at is added only when Reply gives it: when Reply expects a send waiting for its '
                + 'schedule\'s next opening to go out, or null when the schedule does not open within 30 days of the moment the send '
                + 'waits from: its --send-after, or now once that has passed');
            expect(flat, name).toContain('estimated_send_at means something only with state waitingForSchedule, where null says the '
                + 'schedule does not open within those 30 days; Reply gives it null on any other state, and that null says nothing');
        }
        const cancel = help_of(sub(direct_send_command, 'cancel')).replace(/\s+/g, ' ');
        expect(cancel).toContain('Cancelling a send already cancelled answers it again, so running it again is safe');
        expect(cancel).toContain('direct_send.already_sent, direct_send.already_failed and direct_send.already_sending mean the send '
            + 'was past cancelling; nothing changed');
        expect(cancel).toContain('direct_send.already_sending is a LinkedIn send made for later that Reply is handing to the '
            + 'account\'s queue or that waits or runs there, even while direct-send get still reads it queued');
        expect(cancel).toContain('direct_send.cancel_not_confirmed is a 503 from Reply that could not confirm the cancel: the send '
            + 'is still queued or waiting for its schedule, so run the cancel again, as Reply asks; retry_after carries Reply\'s Retry-After when it sends one. Any other 5xx '
            + 'is outcome.unknown (exit 3)');
    });

    it('schedule list takes no flag and no id, and says how a time zone, a weekday, a time and a state are written', ()=>{
        const c = sub(schedule_command, 'list');
        expect(flags(c)).toEqual([]);
        expect(c.registeredArguments).toEqual([]);
        const text = help_of(c);
        const flat = text.replace(/\s+/g, ' ');
        expect(flat, text).toContain('time_zone_id is a Windows time zone identifier');
        expect(flat, text).toContain('the weekday in lower case and each time of day as HH:MM');
        expect(flat, text).toContain('follow_up_timings are the windows of the later steps');
        expect(flat, text).toContain('all in one answer');
        expect(flat, text).toContain('one entry for each day Reply holds, in Reply\'s order');
        expect(flat, text).toContain('whether the schedule is your default');
        expect(flat, text).toContain('unknown, inCampaignTemplate, inCurrentUserSequence, inTeamMemberSequence, '
            + 'isDefaultForCurrentUser or isDefaultForTeamMember, only the first of them that holds');
        expect(flat, text).toContain('A key without Reply\'s sequences read scope is access.feature_unavailable');
        expect(flat, text).not.toContain('plan or role');
        expect(text, text).toContain('  access.feature_unavailable\n');
        expect(text, text).not.toContain('outcome.unknown');
    });

    it('account list takes only --channel, and says what each status means and that every page is read', ()=>{
        const c = sub(account_command, 'list');
        expect(flags(c)).toEqual(['--channel']);
        const text = help_of(c);
        const flat = text.replace(/\s+/g, ' ');
        expect(flat, text).toContain('status is active, inactive, disconnected or other');
        expect(flat, text).toContain('reply_status is Reply\'s own word');
        expect(flat, text).toContain('A LinkedIn account at its daily limit is active');
        expect(flat, text).toContain('the list holds teammates\' accounts too, and owner_user_id is the Reply user whose each one is');
        expect(flat, text).toContain('one the account\'s plan or role does not include fails the whole command');
        expect(flat, text).toContain('--channel reads one channel alone');
        expect(text, text).toContain('  account.list_incomplete\n');
        expect(text, text).not.toContain('outcome.unknown');
    });

    // The sends and contact update find or import the person as the add commands do.
    const SENDS_AND_UPDATE = ['update', 'send-email', 'linkedin-connect', 'linkedin-message', 'linkedin-inmail', 'linkedin-voice'];
    const CONTACT_FLAGS = ['--contact-id', '--email', '--first-name', '--last-name', '--company', '--title', '--contact'];

    it('the commands about a person take the contact flags', ()=>{
        for (const c of [sub(sequence_command, 'add-contact'), sub(sequence_command, 'remove-contact'),
            sub(contact_list_command, 'add-contact'), sub(contact_command, 'opt-out'), ...SENDS_AND_UPDATE.map(n=>sub(contact_command, n))])
        {
            expect(flags(c), c.name()).toEqual(expect.arrayContaining(CONTACT_FLAGS));
        }
    });

    it('the commands about a person say their JSON takes linkedin_url, and a lookup is never left incomplete', ()=>{
        for (const c of [sub(sequence_command, 'add-contact'), sub(sequence_command, 'remove-contact'),
            sub(contact_list_command, 'add-contact'), sub(contact_command, 'opt-out'), ...SENDS_AND_UPDATE.map(n=>sub(contact_command, n))])
        {
            const text = help_of(c);
            expect(text, text).toContain('linkedin_url');
            expect(text.replace(/\s+/g, ' '), text).toContain('stores it by that slug');
            expect(text, text).not.toContain('lookup_incomplete');
            // Each of them looks a contact up by address, and two contacts under one address is refused.
            expect(text, text).toContain('  contact.not_unique\n');
        }
        for (const c of [sub(sequence_command, 'add-contact'), sub(contact_list_command, 'add-contact'), sub(contact_command, 'opt-out'),
            ...SENDS_AND_UPDATE.map(n=>sub(contact_command, n))])
        {
            const text = help_of(c);
            for (const code of ['contact.invalid_email', 'contact.invalid_linkedin_url', 'account.contact_limit_reached'])
            {
                expect(text, `${c.name()} ${code}`).toContain(`  ${code}\n`);
            }
        }
    });

    it('the sends and contact update say a contact is imported only when Reply holds nobody, and how stdin holds both inputs', ()=>{
        for (const name of SENDS_AND_UPDATE)
        {
            const text = help_of(sub(contact_command, name));
            const flat = text.replace(/\s+/g, ' ');
            const input = name === 'update' ? 'fields' : 'message';
            expect(flat, text).toContain('imported only when Reply holds nobody under');
            expect(flat, text).toContain(name === 'update' ? 'contact_created says whether this command created'
                : 'contact_created is kept for consistency with the add commands: given a person\'s fields it is always true, and with --contact-id it is always false; in both cases a successful answer says the send was made');
            expect(flat, text).toContain(`With --contact - and --${input} - both, stdin holds one object: {"contact": {…}, "${input}": {…}}`);
            expect(text, text).toContain(`--contact - `);
        }
        const email = help_of(sub(contact_command, 'send-email')).replace(/\s+/g, ' ');
        expect(email, email).toContain('looked up by its email');
        for (const name of ['linkedin-connect', 'linkedin-message', 'linkedin-inmail', 'linkedin-voice'])
        {
            const text = help_of(sub(contact_command, name)).replace(/\s+/g, ' ');
            expect(text, text).toContain('looked up by its LinkedIn URL');
        }
        const update = help_of(sub(contact_command, 'update')).replace(/\s+/g, ' ');
        expect(update, update).toContain('looked up as the add commands look one up');
        // An update acts on a contact it finds, so only an import needs a first name.
        expect(update, update).toContain('only then does Reply need a first name');
        expect(update, update).toContain('only what --fields names is changed');
        expect(update, update).toContain('contact update 456 is contact update --contact-id 456');
    });

    it('carries each command\'s own flags', ()=>{
        expect(flags(sub(sequence_command, 'add-contact'))).toEqual(expect.arrayContaining(['--start-step', '--ignore-step-delay']));
        expect(flags(sub(sequence_command, 'start'))).toContain('--expect-contacts');
        expect(flags(sub(contact_list_command, 'add-contact'))).toContain('--refuse-opted-out');
        expect(flags(sub(inbox_command, 'list'))).toEqual(expect.arrayContaining(
            ['--contact-id', '--sequence-id', '--source', '--channel', '--category-id', '--since', '--limit', '--offset']));
        expect(flags(sub(sequence_command, 'stats'))).toEqual(expect.arrayContaining(['--preset', '--from', '--to']));
        expect(flags(sub(inbox_command, 'categorize'))).toEqual(['--category-id', '--clear']);
        for (const name of ['categories', 'mark-read', 'mark-unread'])
        {
            expect(flags(sub(inbox_command, name)), name).toEqual([]);
        }
        expect(flags(sub(contact_command, 'get'))).toEqual([]);
        expect(flags(sub(contact_command, 'delete'))).toEqual([]);
    });

    it('inbox changes takes --cursor, --since and --top, and says how the feed is read forward', ()=>{
        const c = sub(inbox_command, 'changes');
        expect(flags(c)).toEqual(['--cursor', '--since', '--top']);
        expect(c.registeredArguments).toEqual([]);
        const text = help_of(c);
        const flat = text.replace(/\s+/g, ' ');
        expect(flat, text).toContain('Result: {"items","has_more","cursor"}');
        expect(flat, text).toContain('the items as Reply gives them');
        expect(flat, text).toContain('Give --cursor or --since, not both; with neither, Reply reads the last 30 days');
        expect(flat, text).toContain('loop on has_more, not on the number of items');
        expect(flat, text).toContain('an empty page still carries a cursor');
        expect(flat, text).toContain('A cursor or a --since older than 30 days is inbox.cursor_expired: start again with --since');
        expect(flat, text).toContain('A cursor Reply will not read otherwise, unreadable or ahead of its clock, is inbox.cursor_refused');
        expect(text, text).toContain('  inbox.cursor_expired\n  inbox.cursor_refused\n');
        expect(text, text).not.toContain('outcome.unknown');
        // The feed names the threads that changed, and its examples use the command's own name.
        expect(text, text).toContain('inbox changes --since 2026-11-01T00:00:00Z');
        expect(text, text).not.toContain('events');
    });

    it('sequence list and create take the name only through --name -, and create says a repeat may make a second one', ()=>{
        expect(flags(sub(sequence_command, 'list'))).toEqual(['--name']);
        const create = sub(sequence_command, 'create');
        expect(flags(create)).toEqual(['--name']);
        const text = help_of(create);
        expect(text, text).toContain('--name -');
        expect(text, text).toContain('may make a second one');
        expect(text, text).not.toContain('re-running is safe');
        const listed = help_of(sub(sequence_command, 'list'));
        expect(listed, listed).toContain('sequence.list_incomplete');
    });

    it('contact update takes its values only through --fields -, and contact delete says what a re-run answers', ()=>{
        const update = sub(contact_command, 'update');
        expect(flags(update)).toEqual([...CONTACT_FLAGS, '--fields']);
        const text = help_of(update);
        expect(text, text).toContain('--fields -');
        expect(text, text).toContain('contact.field_not_found');
        expect(text.replace(/\s+/g, ' '), text).toContain('stores a LinkedIn URL by its lowercased slug');
        const del = help_of(sub(contact_command, 'delete'));
        expect(del.replace(/\s+/g, ' '), del).toContain('answers contact.not_found');
    });

    it('contact find takes the address only through --contact -, and never creates a contact', ()=>{
        const find = sub(contact_command, 'find');
        expect(flags(find)).toEqual(['--contact']);
        const text = help_of(find);
        expect(text, text).toContain('--contact -');
        expect(text.replace(/\s+/g, ' '), text).toContain('Never creates a contact');
        expect(text, text).toContain('contact.not_unique');
        expect(text.replace(/\s+/g, ' '), text).toContain('matched by its lowercased slug');
    });

    it('the commands that look a contact up first say the name flags are used only if it is imported; the add commands do not', ()=>{
        const described = (c: Command, flag: string)=>c.options.find(o=>o.long === flag)?.description as string;
        const lookups = ['update', 'opt-out', 'send-email', 'linkedin-connect', 'linkedin-message', 'linkedin-inmail', 'linkedin-voice'];
        for (const name of lookups)
        {
            for (const flag of ['--last-name', '--company', '--title'])
            {
                expect(described(sub(contact_command, name), flag), `${name} ${flag}`).toContain('used only if the contact is imported');
            }
        }
        for (const flag of ['--last-name', '--company', '--title'])
        {
            expect(described(sub(sequence_command, 'add-contact'), flag), flag).not.toContain('used only if');
        }
    });

    // Each direct send: the flag naming the account it goes from, the codes its endpoint publishes, and what its help
    // says sent_at is.
    const IMPORT = ['contact.not_unique', 'contact.invalid_email', 'contact.invalid_linkedin_url', 'account.contact_limit_reached'];
    const LINKEDIN = ['contact.not_found', ...IMPORT, 'contact.already_held', 'contact.no_linkedin_profile', 'linkedin.account_not_found',
        'linkedin.feature_disabled', 'linkedin.account_inactive', 'linkedin.invalid_cookie', 'schedule.not_found', 'schedule.no_slot',
        'contact.time_zone_missing'];
    const SENT_AT_AS_GIVEN = 'sentAtUtc as Reply gives them, each null when it gives none; the CLI adds no time of its own';
    const DIRECT_SENDS: [string, string, string[], string][] = [
        ['send-email', '--email-account-id', ['contact.not_found', ...IMPORT, 'contact.already_held', 'email_account.not_found', 'contact.blacklisted',
            'contact.missing_variables', 'contact.rendering_failed'],
            'sent_at is always null; the CLI adds none of its own'],
        ['linkedin-connect', '--linkedin-account-id', [...LINKEDIN, 'linkedin.not_connected', 'linkedin.limit_reached',
            'linkedin.message_too_long', 'linkedin.missing_variables'], SENT_AT_AS_GIVEN],
        ['linkedin-message', '--linkedin-account-id', [...LINKEDIN, 'linkedin.not_connected', 'linkedin.limit_reached',
            'linkedin.message_too_long', 'linkedin.missing_variables'], SENT_AT_AS_GIVEN],
        ['linkedin-inmail', '--linkedin-account-id', [...LINKEDIN, 'linkedin.limit_reached', 'linkedin.message_too_long',
            'linkedin.missing_variables', 'linkedin.sales_navigator_required', 'linkedin.sales_navigator_disconnected',
            'linkedin.no_inmail_credits'], SENT_AT_AS_GIVEN],
        ['linkedin-voice', '--linkedin-account-id', [...LINKEDIN, 'linkedin.not_connected', 'linkedin.limit_reached',
            'linkedin.missing_variables', 'linkedin.voice_profile_missing', 'linkedin.voice_too_long'], SENT_AT_AS_GIVEN],
    ];

    it('the InMail help claims only what Reply says of an InMail: it reaches a contact the account is not connected with', ()=>{
        const c = sub(contact_command, 'linkedin-inmail');
        const text = help_of(c).replace(/\s+/g, ' ');
        expect(c.description(), c.description()).toContain('a contact the account is not connected with');
        expect(text, text).not.toContain('connected or not');
    });

    it('each direct send takes the contact flags, the account by flag and its text only through --message -, and says a '
        + 'repeat may send it twice', ()=>{
        for (const [name, account_flag, codes, sent_at] of DIRECT_SENDS)
        {
            const c = sub(contact_command, name);
            expect(flags(c), name).toEqual([...CONTACT_FLAGS, account_flag, '--message',
                ...(name === 'send-email' ? ['--track-links', '--track-opens'] : []), '--send-after', '--schedule-id', '--idempotency-key',
                '--use-contact-time-zone', '--no-use-contact-time-zone', ...(name === 'send-email' ? [] : ['--retry-window-minutes'])]);
            const text = help_of(c);
            const flat = text.replace(/\s+/g, ' ');
            expect(text, text).toContain('--message -');
            expect(flat, text).toContain('may send it twice, unless the hint says nothing was sent');
            expect(text, text).not.toContain('re-running is safe');
            // A send given a person's fields sends only to a contact it creates, and names one Reply already holds.
            expect(flat, text).toContain('A send given a person\'s fields sends only to a contact it creates');
            expect(flat, text).toContain('a lookup finds a contact, or the import matches one Reply already holds, nothing is sent');
            expect(flat, text).toContain(`then by its ${name === 'send-email' ? 'LinkedIn URL' : 'email'} when it was given one`);
            expect(flat, text).toContain('imported only when Reply holds nobody under any address given');
            expect(flat, text).toContain('the answer is contact.already_held (exit 1) with that contact\'s id in ids.contact_id');
            expect(flat, text).toContain('send to it with --contact-id');
            expect(flat.includes('--email alone is refused (usage.contact)'), text).toBe(name !== 'send-email');
            expect(flat, text).toContain(sent_at);
            expect(flat, text).toContain('read from stdin only');
            // A send for later: what status and state each say, and what an older Reply does with the flags.
            expect(flat, text).toContain('status "sent" means Reply took the send; state, when Reply gives it, says whether it has gone '
                + 'out: queued, waitingForSchedule or sending is not yet, then sent, failed or cancelled');
            expect(flat, text).toContain('direct-send get <reference> reads it later, and direct-send cancel <reference> stops one not yet sent');
            // Every send takes a schedule and its time zone; only the LinkedIn sends take a retry window and map the refusals.
            const linkedin = name !== 'send-email';
            expect(flat, text).toContain('A send timed by --schedule-id may answer state waitingForSchedule');
            expect(flat, text).toContain('estimated_send_at is when Reply expects to send it, or null when the schedule does not open within '
                + '30 days of the moment the send waits from: its --send-after, or when Reply took it');
            expect(flat, text).toContain('estimated_send_at means something only with state waitingForSchedule, where null says the '
                + 'schedule does not open within those 30 days; Reply gives it null on any other state, and that null says nothing');
            expect(flat, text).toContain('--use-contact-time-zone sends useContactTimeZone true: the schedule\'s windows are read in the '
                + 'contact\'s time zone; --no-use-contact-time-zone sends false, the schedule\'s own zone; with neither, the schedule\'s '
                + 'own setting holds. Reply takes it only with --schedule-id, and answers it otherwise with errors[] (reply.invalid_request)');
            expect(flat.includes('--retry-window-minutes <n> is how long Reply keeps trying to send it once it is due, 1 to 4320 '
                + 'minutes (Reply\'s default is 90); one outside that is refused before any call (usage.range)'), text).toBe(linkedin);
            expect(flat.includes('Reply takes it only with --schedule-id or --send-after'), text).toBe(linkedin);
            expect(flat.includes('schedule.not_found is a --schedule-id naming no schedule this account can read, schedule.no_slot a '
                + 'schedule with no active day that has a time range, so it never opens, and contact.time_zone_missing a contact without the time zone '
                + '--use-contact-time-zone reads it in; none sends anything'), text).toBe(linkedin);
            expect(flat.includes('Reply refuses an email it cannot time when it takes it, and nothing is sent: a --schedule-id naming no '
                + 'schedule this account can read, a schedule with no active day that has a time range, and a contact without the time zone '
                + '--use-contact-time-zone reads it in are reply.refused, with Reply\'s contact.scheduleNotFound, contact.scheduleHasNoSlot '
                + 'or contact.contactTimeZoneMissing as reply_code'), text).toBe(!linkedin);
            expect(flat, text).toContain('An answer without state comes from a Reply that does not know --send-after and --schedule-id');
            expect(flat, text).toContain('--idempotency-key goes as the Idempotency-Key header');
            expect(flat, text).toContain('A Reply that knows the header answers a repeat with the same key with the send the key first made; while that one is still '
                + 'being made the answer is idempotency_key.in_use, and the same key on a different send is idempotency_key.reused');
            // Given a person's fields, a repeat finds the contact the first one created before it reaches the key.
            expect(flat, text).toContain('A repeat of a send given a person\'s fields answers contact.already_held first, since the '
                + 'first one created the contact: that is safe too, as nothing is sent twice');
            expect(flat, text).toContain('idempotency_key.reused names the send the key was first taken for in details: reference, '
                + 'state and send_after, each only when Reply gives it');
            expect(flat, text).toContain('Any other refusal of a send Reply already holds names that send the same way, beside the '
                + 'refusal\'s own details; its code is the refusal\'s own');
            expect(flat, text).toContain('A 400 to the send with neither a code nor errors[] is Reply failing while it made the send: '
                + 'like a 5xx or a lost answer, it is outcome.unknown (exit 3)');
            expect(flat, text).toContain('So is a 400 directLinkedIn.unknown to a LinkedIn send, Reply\'s answer when it failed while '
                + 'making the send or could not map the provider\'s answer; Reply\'s code is kept in reply_code');
            // Exactly the codes its endpoint publishes, then the shared ones, as the help lists them.
            const listed = text.split('\nErrors')[1].split('\nExit codes')[0].split('\n').slice(1).map(l=>l.trim());
            expect(listed, name).toEqual([...codes, 'idempotency_key.in_use', 'idempotency_key.reused', 'access.denied', 'access.feature_unavailable', 'rate_limited', 'reply.unavailable',
                'reply.refused', 'reply.invalid_request', 'outcome.unknown']);
        }
    });

    it('send-email says tracking is off unless asked, where the unfilled variables go, and what a rendered answer adds', ()=>{
        const c = sub(contact_command, 'send-email');
        const flat = help_of(c).replace(/\s+/g, ' ');
        const described = (flag: string)=>c.options.find(o=>o.long === flag)?.description;
        expect(described('--track-links'), '--track-links').toContain('Track the links');
        expect(described('--track-opens'), '--track-opens').toContain('Track the opens');
        expect(flat, flat).toContain('Reply tracks neither links nor opens unless --track-links or --track-opens asks it to');
        expect(flat, flat).toContain('contact.missing_variables names the variables Reply could not fill in details.missing_variables');
        expect(flat, flat).toContain('contact.rendering_failed is a template Reply could not render, its message in detail');
        expect(flat, flat).toContain('An email sent within the request adds rendered_subject and rendered_body');
    });

    it('inbox reply takes its text only through --message, and says a repeat may send it twice', ()=>{
        const reply = sub(inbox_command, 'reply');
        expect(flags(reply)).toEqual(['--message']);
        const text = help_of(reply);
        expect(text, text).toContain('--message -');
        expect(text, text).toContain('may send it twice');
        expect(text, text).not.toContain('re-running is safe');
        const mark = help_of(sub(inbox_command, 'mark-read'));
        expect(mark, mark).toContain('re-running is safe');
    });
});
