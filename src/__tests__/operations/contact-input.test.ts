import {describe, it, expect} from 'vitest';
import {Command} from 'commander';
import {read_contact_input, add_contact_options} from '../../operations/contact-input';
import {UsageError} from '../../utils/errors';

const usage = (fn: () => unknown): UsageError=>{
    try { fn(); } catch (e) { if (e instanceof UsageError) return e; throw e; }
    throw new Error('expected a UsageError');
};

describe('read_contact_input', ()=>{
    it('takes --contact-id', ()=>{
        expect(read_contact_input({contactId: '456'})).toEqual({kind: 'id', id: 456});
    });

    it('takes --email with name flags, trimmed, empty ones dropped', ()=>{
        expect(read_contact_input({email: '  Ann@Acme.com ', firstName: 'Ann', lastName: ' ', company: 'Acme'}))
            .toEqual({kind: 'person', person: {email: 'Ann@Acme.com', first_name: 'Ann', company: 'Acme'}});
    });

    it('takes --contact JSON from stdin with the same field names', ()=>{
        const ref = read_contact_input({contact: '-'}, ()=>'{"email":"ann@acme.com","first_name":"Ann","title":"CTO"}');
        expect(ref).toEqual({kind: 'person', person: {email: 'ann@acme.com', first_name: 'Ann', title: 'CTO'}});
    });

    it('refuses no contact, and more than one form', ()=>{
        expect(usage(()=>read_contact_input({})).code).toBe('usage.contact');
        expect(usage(()=>read_contact_input({contactId: '1', email: 'a@b.co'})).code).toBe('usage.contact');
        expect(usage(()=>read_contact_input({contact: '{}', firstName: 'Ann'})).code).toBe('usage.contact');
    });

    it('refuses name flags without --email', ()=>{
        expect(usage(()=>read_contact_input({firstName: 'Ann'})).code).toBe('usage.contact');
    });

    it('refuses a --contact that is not an object, has unknown fields, or non-string values', ()=>{
        for (const stdin of ['null', '[]', '"ann@acme.com"', '{"email":"a@b.co","phone":"1"}', '{"email":42}', ''])
        {
            expect(usage(()=>read_contact_input({contact: '-'}, ()=>stdin)).code).toBe('usage.contact');
        }
    });

    it('refuses a missing or malformed email without echoing it', ()=>{
        const e = usage(()=>read_contact_input({email: 'ann at acme'}));
        expect(e.code).toBe('usage.contact');
        expect(e.message).not.toContain('ann at acme');
        expect(usage(()=>read_contact_input({contact: '-'}, ()=>'{"first_name":"Ann"}')).code).toBe('usage.contact');
    });

    it('refuses a bad --contact-id as a usage.id error', ()=>{
        expect(usage(()=>read_contact_input({contactId: 'abc'})).code).toBe('usage.id');
    });
});

describe('add_contact_options', ()=>{
    it('adds the seven contact flags', ()=>{
        const flags = add_contact_options(new Command('x')).options.map(o=>o.long);
        expect(flags).toEqual(['--contact-id', '--email', '--first-name', '--last-name', '--company', '--title', '--contact']);
    });
});
