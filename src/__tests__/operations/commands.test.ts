import {describe, it, expect} from 'vitest';
import type {Command} from 'commander';
import {sequence_command, contact_list_command, contact_command, inbox_command, account_command} from '../../operations/commands';

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
        expect(inbox_command.commands.map(c=>c.name())).toEqual(['list', 'get', 'reply', 'categories', 'categorize', 'mark-read', 'mark-unread']);
        expect(account_command.commands.map(c=>c.name())).toEqual(['list']);
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
            expect(flat, text).toContain('only then does Reply need a first name');
            expect(flat, text).toContain('contact_created says whether this command created');
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
    const LINKEDIN = ['contact.not_found', ...IMPORT, 'contact.channel_conflict', 'contact.no_linkedin_profile', 'linkedin.account_not_found', 'linkedin.feature_disabled',
        'linkedin.account_inactive', 'linkedin.invalid_cookie'];
    const SENT_AT_AS_GIVEN = 'sentAtUtc as Reply gives them, each null when it gives none; the CLI adds no time of its own';
    const DIRECT_SENDS: [string, string, string[], string][] = [
        ['send-email', '--email-account-id', ['contact.not_found', ...IMPORT, 'email_account.not_found', 'contact.blacklisted'],
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
            expect(flags(c), name).toEqual([...CONTACT_FLAGS, account_flag, '--message']);
            const text = help_of(c);
            const flat = text.replace(/\s+/g, ' ');
            expect(text, text).toContain('--message -');
            expect(flat, text).toContain('may send it twice, unless the hint says nothing was sent');
            expect(text, text).not.toContain('re-running is safe');
            // A LinkedIn send says what happens to a contact the import matched; an email send has no such step.
            const says_conflict = flat.includes('another LinkedIn profile than the one given, nothing is sent and its LinkedIn profile is not changed, and the answer');
            expect(says_conflict, text).toBe(name !== 'send-email');
            if (name !== 'send-email')
            {
                expect(flat, text).toContain('contact.channel_conflict (exit 1, with ids.contact_id)');
                expect(flat, text).toContain('only the given profile is set on it before the send, never an email or any other field');
                expect(flat, text).toContain('--email alone is refused (usage.contact)');
            }
            expect(flat, text).toContain(sent_at);
            expect(flat, text).toContain('read from stdin only');
            // Exactly the codes its endpoint publishes, then the shared ones, as the help lists them.
            const listed = text.split('\nErrors')[1].split('\nExit codes')[0].split('\n').slice(1).map(l=>l.trim());
            expect(listed, name).toEqual([...codes, 'access.denied', 'access.feature_unavailable', 'rate_limited', 'reply.unavailable',
                'reply.refused', 'reply.invalid_request', 'outcome.unknown']);
        }
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
