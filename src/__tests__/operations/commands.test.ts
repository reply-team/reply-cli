import {describe, it, expect} from 'vitest';
import type {Command} from 'commander';
import {sequence_command, contact_list_command, contact_command, inbox_command} from '../../operations/commands';

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
        expect(contact_command.commands.map(c=>c.name())).toEqual(['find', 'get', 'update', 'delete', 'opt-out']);
        expect(inbox_command.commands.map(c=>c.name())).toEqual(['list', 'get', 'reply', 'categories', 'categorize', 'mark-read', 'mark-unread']);
    });

    it('the commands about a person take the contact flags', ()=>{
        for (const c of [sub(sequence_command, 'add-contact'), sub(sequence_command, 'remove-contact'),
            sub(contact_list_command, 'add-contact'), sub(contact_command, 'opt-out')])
        {
            expect(flags(c)).toEqual(expect.arrayContaining(['--contact-id', '--email', '--contact']));
        }
    });

    it('the commands about a person say their JSON takes linkedin_url, and a lookup is never left incomplete', ()=>{
        for (const c of [sub(sequence_command, 'add-contact'), sub(sequence_command, 'remove-contact'),
            sub(contact_list_command, 'add-contact'), sub(contact_command, 'opt-out')])
        {
            const text = help_of(c);
            expect(text, text).toContain('linkedin_url');
            expect(text, text).toContain('lowercased slug');
            expect(text, text).not.toContain('lookup_incomplete');
        }
        for (const c of [sub(sequence_command, 'add-contact'), sub(contact_list_command, 'add-contact'), sub(contact_command, 'opt-out')])
        {
            const text = help_of(c);
            expect(text, text).toContain('contact.invalid_linkedin_url');
        }
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
        expect(flags(update)).toEqual(['--fields']);
        const text = help_of(update);
        expect(text, text).toContain('--fields -');
        expect(text, text).toContain('contact.field_not_found');
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
