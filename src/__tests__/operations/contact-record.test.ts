import fs from 'fs';
import os from 'os';
import path from 'path';
import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_contact_find, handle_contact_get} from '../../operations/contact-record';

const EMAIL = 'marta@example.com';
const URL_ = 'https://www.linkedin.com/in/marta-example';
const stdin = (value: unknown)=>()=>(typeof value === 'string' ? value : JSON.stringify(value));

// What a failure shows a caller: none of it may carry the person's address.
const shown = (e: unknown): string=>{
    const err = e as {message?: string; title?: string; hint?: string; detail?: string};
    return [err.message, err.title, err.hint, err.detail].join(' ');
};

const find = (source: string | undefined, input?: unknown)=>
    capture(()=>handle_contact_find({contact: source}, ctx(), {json: true}, input === undefined ? undefined : stdin(input)));

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('contact find', ()=>{
    it('finds a contact by email from stdin with one exact lookup, and answers its id', async()=>{
        answer(json({items: [{id: 456, email: 'Marta@Example.com'}], hasMore: false}));
        const {out} = await find('-', {email: EMAIL});
        expect(JSON.parse(out)).toEqual({contact_id: 456});
        expect(sent()).toEqual([{method: 'GET', url: 'https://api/v3/contacts?email=marta%40example.com&top=100&skip=0', body: undefined}]);
    });

    it('finds a contact by LinkedIn URL', async()=>{
        answer(json({items: [{id: 456, linkedInUrl: `${URL_}/`}], hasMore: false}));
        const {out} = await find('-', {linkedin_url: URL_});
        expect(JSON.parse(out)).toEqual({contact_id: 456});
        expect(sent()[0].url).toBe(`https://api/v3/contacts?linkedIn=${encodeURIComponent(URL_)}&top=100&skip=0`);
    });

    it('answers a null id when Reply holds nobody under the address, and never creates one', async()=>{
        answer(json({items: [], hasMore: false}));
        const {out} = await find('-', {email: EMAIL});
        expect(JSON.parse(out)).toEqual({contact_id: null});
        expect(sent().map(r=>r.method)).toEqual(['GET']);
    });

    it('two contacts under the address is contact.not_unique (exit 1)', async()=>{
        answer(json({items: [{id: 1, email: EMAIL}, {id: 2, email: EMAIL}], hasMore: false}));
        await expect(find('-', {email: EMAIL})).rejects.toMatchObject({code: 'contact.not_unique', exit_code: 1});
    });

    it('takes the contact from stdin only: inline JSON, @file or no flag is usage.contact, with no call and the address not repeated', async()=>{
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-find-'));
        const file = path.join(dir, 'c.json');
        fs.writeFileSync(file, JSON.stringify({email: EMAIL}));
        try {
            for (const source of [JSON.stringify({email: EMAIL}), `@${file}`, undefined])
            {
                const e = await find(source).catch(x=>x);
                expect(e, String(source)).toMatchObject({code: 'usage.contact', exit_code: 2});
                expect(shown(e), String(source)).not.toContain(EMAIL);
            }
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('refuses both addresses, neither, another field, a non-string or a malformed address, with no call', async()=>{
        for (const input of [{email: EMAIL, linkedin_url: URL_}, {}, {email: EMAIL, first_name: 'Marta'}, {email: 42},
            {email: 'marta at example'}, {linkedin_url: 'marta-example'}, '[]', 'not json'])
        {
            const e = await find('-', input).catch(x=>x);
            expect(e, JSON.stringify(input)).toMatchObject({code: 'usage.contact', exit_code: 2});
            expect(shown(e), JSON.stringify(input)).not.toContain('marta at example');
            expect(shown(e), JSON.stringify(input)).not.toContain('marta-example');
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});

describe('contact get', ()=>{
    it('prints the contact as Reply holds it', async()=>{
        const contact = {id: 456, email: EMAIL, firstName: 'Marta', isOptedOut: false, customFields: [{key: 'leadSource', value: 'Event'}]};
        answer(json(contact));
        const {out} = await capture(()=>handle_contact_get('456', ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual(contact);
        expect(sent()).toEqual([{method: 'GET', url: 'https://api/v3/contacts/456', body: undefined}]);
    });

    it('a 404 is contact.not_found', async()=>{
        answer(json({code: 'contact.notFound'}, 404));
        await expect(handle_contact_get('456', ctx(), {})).rejects.toMatchObject({code: 'contact.not_found', reply_code: 'contact.notFound', exit_code: 1});
    });

    it('an id that is not a Reply id is usage.id, with no call', async()=>{
        await expect(handle_contact_get('marta', ctx(), {})).rejects.toMatchObject({code: 'usage.id', exit_code: 2});
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});
