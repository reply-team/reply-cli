import {describe, it, expect} from 'vitest';
import type {Command} from 'commander';
import {sequence_command, contact_list_command, contact_command, inbox_command} from '../../operations/commands';

const sub = (parent: Command, name: string): Command=>{
    const found = parent.commands.find(c=>c.name() === name);
    if (!found) throw new Error(`no ${parent.name()} ${name}`);
    return found;
};
const flags = (c: Command): string[]=>c.options.map(o=>o.long as string);

describe('operations/commands', ()=>{
    it('names the commands in Reply\'s words', ()=>{
        expect(sequence_command.commands.map(c=>c.name())).toEqual(['get', 'contacts', 'stats', 'add-contact', 'remove-contact', 'pause', 'start']);
        expect(contact_list_command.commands.map(c=>c.name())).toEqual(['add-contact']);
        expect(contact_command.commands.map(c=>c.name())).toEqual(['opt-out']);
        expect(inbox_command.commands.map(c=>c.name())).toEqual(['list', 'get']);
    });

    it('every write takes --idempotency-key', ()=>{
        for (const c of [sub(sequence_command, 'add-contact'), sub(sequence_command, 'remove-contact'),
            sub(sequence_command, 'pause'), sub(sequence_command, 'start'),
            sub(contact_list_command, 'add-contact'), sub(contact_command, 'opt-out')])
        {
            expect(flags(c)).toContain('--idempotency-key');
        }
    });

    it('the commands about a person take the contact flags', ()=>{
        for (const c of [sub(sequence_command, 'add-contact'), sub(sequence_command, 'remove-contact'),
            sub(contact_list_command, 'add-contact'), sub(contact_command, 'opt-out')])
        {
            expect(flags(c)).toEqual(expect.arrayContaining(['--contact-id', '--email', '--contact']));
        }
    });

    it('carries each command\'s own flags', ()=>{
        expect(flags(sub(sequence_command, 'add-contact'))).toEqual(expect.arrayContaining(['--start-step', '--ignore-step-delay']));
        expect(flags(sub(sequence_command, 'start'))).toContain('--expect-contacts');
        expect(flags(sub(contact_list_command, 'add-contact'))).toContain('--refuse-opted-out');
        expect(flags(sub(inbox_command, 'list'))).toEqual(expect.arrayContaining(['--contact-id', '--sequence-id', '--source', '--since', '--limit', '--offset']));
        expect(flags(sub(sequence_command, 'stats'))).toEqual(expect.arrayContaining(['--preset', '--from', '--to']));
    });
});
