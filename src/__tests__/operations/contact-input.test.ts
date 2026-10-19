import {describe, it, expect} from 'vitest';
import {Command} from 'commander';
import {read_contact_input, add_contact_options, linkedin_key} from '../../operations/contact-input';
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
        expect(read_contact_input({email: '  Ann@Example.com ', firstName: 'Ann', lastName: ' ', company: 'Acme'}))
            .toEqual({kind: 'person', person: {email: 'Ann@Example.com', first_name: 'Ann', company: 'Acme'}});
    });

    it('takes --contact JSON from stdin with the same field names', ()=>{
        const ref = read_contact_input({contact: '-'}, ()=>'{"email":"ann@example.com","first_name":"Ann","title":"CTO"}');
        expect(ref).toEqual({kind: 'person', person: {email: 'ann@example.com', first_name: 'Ann', title: 'CTO'}});
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
        for (const stdin of ['null', '[]', '"ann@example.com"', '{"email":"a@b.co","phone":"1"}', '{"email":42}', '{"linkedin_url":42}', ''])
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

    it('takes linkedin_url in the --contact JSON, with or without an email', ()=>{
        const url = 'https://www.linkedin.com/in/marta-example';
        expect(read_contact_input({contact: '-'}, ()=>JSON.stringify({linkedin_url: ` ${url} `, first_name: 'Marta'})))
            .toEqual({kind: 'person', person: {linkedin_url: url, first_name: 'Marta'}});
        expect(read_contact_input({contact: '-'}, ()=>JSON.stringify({email: 'marta@example.com', linkedin_url: url})))
            .toEqual({kind: 'person', person: {email: 'marta@example.com', linkedin_url: url}});
    });

    it('refuses a contact with neither an email nor a LinkedIn URL', ()=>{
        const e = usage(()=>read_contact_input({contact: '-'}, ()=>'{"first_name":"Marta","linkedin_url":" "}'));
        expect(e.code).toBe('usage.contact');
        expect(e.message).toContain('LinkedIn URL');
    });

    it('refuses a linkedin_url that is not an absolute http(s) URL, without echoing it', ()=>{
        for (const bad of ['linkedin.com/in/marta-example', 'ftp://linkedin.com/in/marta-example', 'marta-example', 'https://'])
        {
            const e = usage(()=>read_contact_input({contact: '-'}, ()=>JSON.stringify({linkedin_url: bad})));
            expect(e.code, bad).toBe('usage.contact');
            expect(`${e.message} ${e.hint ?? ''}`, bad).not.toContain('marta-example');
        }
    });

    it('keys a LinkedIn URL by its lowercased slug: on linkedin.com and its subdomains the path\'s case does not count, '
        + 'elsewhere it does; the scheme\'s and host\'s case, a default port, one trailing slash and a fragment never count; '
        + 'www and the query do', ()=>{
        expect(linkedin_key('HTTPS://WWW.LinkedIn.COM:443/in/Marta-Example/#about')).toBe('https://www.linkedin.com/in/marta-example');
        expect(linkedin_key('https://uk.linkedin.com/in/Marta-Example')).toBe('https://uk.linkedin.com/in/marta-example');
        expect(linkedin_key('https://www.linkedin.com/in/Marta-Example?trk=AbC')).toBe('https://www.linkedin.com/in/marta-example?trk=AbC');
        expect(linkedin_key('https://www.linkedin.com/in/marta-example//')).toBe('https://www.linkedin.com/in/marta-example/');
        expect(linkedin_key('https://www.linkedin.com:8443/in/Marta-Example')).toBe('https://www.linkedin.com:8443/in/marta-example');
        expect(linkedin_key('https://linkedin.com/in/marta-example')).not.toBe(linkedin_key('https://www.linkedin.com/in/marta-example'));
        expect(linkedin_key('http://www.linkedin.com/in/marta-example')).not.toBe(linkedin_key('https://www.linkedin.com/in/marta-example'));
        expect(linkedin_key('https://www.example.com/in/Marta-Example/')).toBe('https://www.example.com/in/Marta-Example');
        expect(linkedin_key('https://notlinkedin.com/in/Marta-Example')).toBe('https://notlinkedin.com/in/Marta-Example');
        expect(linkedin_key('linkedin.com/in/marta-example')).toBeNull();
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
