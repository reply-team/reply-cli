import fs from 'fs';
import os from 'os';
import path from 'path';
import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture, instant_timers, real_timers} from './helpers';
import {handle_contact_find, handle_contact_get, handle_contact_update, handle_contact_delete} from '../../operations/contact-record';

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

describe('malformed JSON on stdin', ()=>{
    // A parser's message quotes some ten characters around the bad token, so a refusal that passed it on would carry
    // part of the text.
    it('is refused without repeating any of its text, for contact find and contact update', async()=>{
        const cases: [() => Promise<unknown>, string][] = [
            [()=>find('-', '{"email": Marta Example}'), 'usage.contact'],
            [()=>find('-', '{"linkedin_url": "https://www.linkedin.com/in/marta-example" Marta}'), 'usage.contact'],
            [()=>update('-', '{"first_name": Marta Example}'), 'usage.fields'],
            [()=>update('-', '{"custom_fields": [{"name": "leadSource", "value": Marta Example}]}'), 'usage.fields'],
        ];
        for (const [run, code] of cases)
        {
            const e = await run().catch(x=>x);
            expect(e, code).toMatchObject({code, exit_code: 2});
            expect(shown(e), code).not.toContain('Marta');
            expect(shown(e), code).not.toContain('marta');
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

const FIELDS_URL = 'https://api/v3/custom-fields?entityType=contact';
const SECRET = 'Marta Example Secret';
const update = (source: string | undefined, input?: unknown)=>
    capture(()=>handle_contact_update('456', {fields: source}, ctx(), {json: true}, input === undefined ? undefined : stdin(input)));

describe('contact update', ()=>{
    it('changes the fields from stdin with one PATCH: Reply\'s names, a null kept to clear, custom fields by the names the '
        + 'account gives them after one read of its fields', async()=>{
        answer(json([{id: 1, title: 'leadSource', fieldType: 'text'}, {id: 2, title: 'budget', fieldType: 'text'}]), json({id: 456}));
        const {out} = await update('-', {first_name: ' Marta ', title: null, linkedin_url: URL_,
            custom_fields: [{name: 'leadSource', value: 'Event'}, {name: 'Budget', value: null}]});
        expect(JSON.parse(out)).toEqual({status: 'updated', contact_id: 456, contact_created: false});
        expect(sent()).toEqual([
            {method: 'GET', url: FIELDS_URL, body: undefined},
            {method: 'PATCH', url: 'https://api/v3/contacts/456', body: {firstName: 'Marta', title: null, linkedInUrl: URL_,
                customFields: [{name: 'leadSource', value: 'Event'}, {name: 'budget', value: null}]}},
        ]);
    });

    it('writes a LinkedIn URL in the form it is looked up by: its lowercased slug', async()=>{
        answer(json({id: 456}));
        await update('-', {linkedin_url: 'https://www.linkedin.com/in/Marta-Example/'});
        expect(sent()[0].body).toEqual({linkedInUrl: 'https://www.linkedin.com/in/marta-example'});
    });

    it('without custom fields there is no read before the PATCH', async()=>{
        answer(json({id: 456}));
        const {out} = await update('-', {company: 'Acme', last_name: null});
        expect(JSON.parse(out)).toEqual({status: 'updated', contact_id: 456, contact_created: false});
        expect(sent()).toEqual([{method: 'PATCH', url: 'https://api/v3/contacts/456', body: {company: 'Acme', lastName: null}}]);
    });

    it('a custom field the account does not have is contact.field_not_found, named, and nothing is written', async()=>{
        answer(json([{id: 1, title: 'leadSource', fieldType: 'text'}]));
        const e = await update('-', {first_name: 'Marta', custom_fields: [{name: 'LEADSOURCE', value: 'x'}, {name: 'Tier', value: SECRET}]})
            .catch(x=>x);
        expect(e).toMatchObject({code: 'contact.field_not_found', exit_code: 1, details: {fields: ['Tier']}, ids: {contact_id: 456}});
        expect(shown(e)).not.toContain(SECRET);
        expect(sent().map(r=>r.method)).toEqual(['GET']);
    });

    it('a custom-field read that fails is reply.unavailable, and no PATCH goes out', async()=>{
        instant_timers();
        try {
            mock_fetch.mockImplementation(()=>Promise.resolve(json('', 503)));
            const e = await update('-', {title: 'CTO', custom_fields: [{name: 'leadSource', value: 'Event'}]}).catch(x=>x);
            expect(e).toMatchObject({code: 'reply.unavailable', exit_code: 1, ids: {contact_id: 456}});
            expect(sent().map(r=>r.method), JSON.stringify(sent())).not.toContain('PATCH');
            expect(sent().length).toBeGreaterThan(0);
        } finally {
            real_timers();
            mock_fetch.mockReset();
        }
    });

    it('a 404 is contact.not_found', async()=>{
        answer(json({code: 'contact.notFound'}, 404));
        await expect(update('-', {company: 'Acme'})).rejects.toMatchObject({code: 'contact.not_found', exit_code: 1, ids: {contact_id: 456}});
    });

    it('a 400 that names fields is reply.invalid_request with their names only', async()=>{
        answer(json({status: 400, errors: [{pointer: '/linkedInUrl', detail: `'${URL_}' is not valid`}]}, 400));
        const e = await update('-', {linkedin_url: URL_}).catch(x=>x);
        expect(e).toMatchObject({code: 'reply.invalid_request', details: {fields: ['linkedInUrl']}});
        expect(JSON.stringify(e.details)).not.toContain('marta-example');
    });

    it('a 503 on the PATCH is outcome.unknown (exit 3), and it was sent once', async()=>{
        answer(json('', 503));
        await expect(update('-', {company: 'Acme'})).rejects.toMatchObject({code: 'outcome.unknown', exit_code: 3, ids: {contact_id: 456}});
        expect(mock_fetch).toHaveBeenCalledTimes(1);
    });

    it('takes the fields from stdin only: inline JSON, @file or no flag is usage.fields, with no call and no value repeated', async()=>{
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-update-'));
        const file = path.join(dir, 'f.json');
        fs.writeFileSync(file, JSON.stringify({first_name: SECRET}));
        try {
            for (const source of [JSON.stringify({first_name: SECRET}), `@${file}`, undefined])
            {
                const e = await update(source).catch(x=>x);
                expect(e, String(source)).toMatchObject({code: 'usage.fields', exit_code: 2});
                expect(shown(e), String(source)).not.toContain(SECRET);
            }
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('refuses fields that change nothing, an unknown field, a blank or non-string value, a bad LinkedIn URL, a malformed '
        + 'custom field and a name given twice, with no call and no value repeated', async()=>{
        for (const input of [{}, {email: EMAIL}, {first_name: '  '}, {first_name: 42}, {linkedin_url: SECRET},
            {custom_fields: []}, {custom_fields: 'x'}, {custom_fields: [{name: 'Tier'}]}, {custom_fields: [{name: ' ', value: SECRET}]},
            {custom_fields: [{name: 'Tier', value: 7}]}, {custom_fields: [{name: 'Tier', value: SECRET, id: 1}]}, {custom_fields: [SECRET]},
            {custom_fields: [{name: 'Tier', value: SECRET}, {name: 'tier', value: '2'}]}, '[]', 'not json'])
        {
            const e = await update('-', input).catch(x=>x);
            expect(e, JSON.stringify(input)).toMatchObject({code: 'usage.fields', exit_code: 2});
            expect(shown(e), JSON.stringify(input)).not.toContain(SECRET);
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});

describe('contact update of a person given by their fields', ()=>{
    const OTHER_PROFILE = 'https://www.linkedin.com/in/marta-other';
    const EMAIL_LOOKUP = 'GET https://api/v3/contacts?email=marta%40example.com&top=100&skip=0';
    const PROFILE_LOOKUP = `GET https://api/v3/contacts?linkedIn=${encodeURIComponent(URL_)}&top=100&skip=0`;
    const IMPORT = 'POST https://api/v3/contacts/import';
    const nobody = ()=>json({items: [], hasMore: false});
    const held = (entry: Record<string, unknown>)=>json({items: [entry], hasMore: false});
    const lines = ()=>sent().map(r=>`${r.method} ${r.url}`);
    type Update_opts = Parameters<typeof handle_contact_update>[1];

    // The person and the fields both come on stdin, so the argument list carries neither: it is checked on every run.
    const PERSONAL = /marta|example\.com|cto|acme|secret/i;
    const update_by_fields = (input: unknown, opts: Update_opts = {contact: '-', fields: '-'}, id?: string)=>{
        expect(JSON.stringify([id, opts]), JSON.stringify(opts)).not.toMatch(PERSONAL);
        return capture(()=>handle_contact_update(id, opts, ctx(), {json: true}, stdin(input)));
    };
    const fail_by_fields = (input: unknown, opts?: Update_opts, id?: string)=>update_by_fields(input, opts, id).catch((x: unknown)=>x);

    it('a person Reply holds is found as the add commands find one and changed only by --fields: never their email or '
        + 'LinkedIn URL from the fields that found them', async()=>{
        answer(held({id: 456, email: 'marta@example.com'}), json({id: 456}));
        const contact = {email: EMAIL, linkedin_url: OTHER_PROFILE, first_name: 'Marta', last_name: 'Example', company: 'Old Co', title: 'Old'};
        const {out} = await update_by_fields({contact, fields: {title: 'CTO'}});
        expect(JSON.parse(out)).toStrictEqual({status: 'updated', contact_id: 456, contact_created: false});
        expect(lines()).toEqual([EMAIL_LOOKUP, 'PATCH https://api/v3/contacts/456']);
        expect(sent()[1].body).toStrictEqual({title: 'CTO'});
    });

    it('a person given only by LinkedIn URL is found by it, and only a linkedin_url in --fields changes it', async()=>{
        answer(held({id: 456, linkedInUrl: URL_}), json({id: 456}));
        await update_by_fields({contact: {linkedin_url: URL_}, fields: {company: 'Acme'}});
        expect(lines()).toEqual([PROFILE_LOOKUP, 'PATCH https://api/v3/contacts/456']);
        expect(sent()[1].body).toStrictEqual({company: 'Acme'});
        mock_fetch.mockReset();
        answer(held({id: 456, linkedInUrl: URL_}), json({id: 456}));
        await update_by_fields({contact: {linkedin_url: URL_}, fields: {linkedin_url: OTHER_PROFILE}});
        expect(sent()[1].body).toStrictEqual({linkedInUrl: OTHER_PROFILE});
    });

    it('a person Reply holds nobody under is imported with their names as an add imports them, then changed', async()=>{
        answer(nobody(), json({items: [{id: 457, status: 'created'}]}), json({id: 457}));
        const {out} = await update_by_fields({contact: {email: EMAIL, first_name: 'Marta'}, fields: {title: 'CTO'}});
        expect(JSON.parse(out)).toStrictEqual({status: 'updated', contact_id: 457, contact_created: true});
        expect(lines()).toEqual([EMAIL_LOOKUP, IMPORT, 'PATCH https://api/v3/contacts/457']);
        expect(sent()[1].body).toStrictEqual({items: [{email: EMAIL, firstName: 'Marta'}]});
        expect(sent()[2].body).toStrictEqual({title: 'CTO'});
        mock_fetch.mockReset();
        answer(nobody(), json({items: [{id: 458, status: 'created'}]}), json({id: 458}));
        await update_by_fields({contact: {linkedin_url: URL_, first_name: 'Marta'}, fields: {title: 'CTO'}});
        expect(lines()).toEqual([PROFILE_LOOKUP, IMPORT, 'PATCH https://api/v3/contacts/458']);
        expect(sent()[1].body).toStrictEqual({items: [{linkedInUrl: URL_, firstName: 'Marta'}], options: {keys: {linkedInUrl: true}}});
    });

    it('custom fields are read before the person is found or imported, so a name the account lacks imports nobody', async()=>{
        answer(json([{id: 1, title: 'leadSource', fieldType: 'text'}]));
        const e = await fail_by_fields({contact: {email: EMAIL, first_name: 'Marta'}, fields: {custom_fields: [{name: 'Tier', value: SECRET}]}});
        expect(e).toMatchObject({code: 'contact.field_not_found', exit_code: 1});
        expect(lines()).toEqual([`GET ${FIELDS_URL}`]);
    });

    it('refuses as the add commands do, and changes nothing: two contacts held, the plan\'s limit, an item the import failed', async()=>{
        const two = json({items: [{id: 1, email: EMAIL}, {id: 2, email: EMAIL}], hasMore: false});
        const cases: [Response[], string][] = [
            [[two], 'contact.not_unique'],
            [[nobody(), json({code: 'contact.limitExceeded', detail: 'Contact limit reached.'}, 400)], 'account.contact_limit_reached'],
            [[nobody(), json({items: [{id: null, status: 'failed', error: 'Invalid data'}]})], 'reply.refused'],
        ];
        for (const [answers, code] of cases)
        {
            mock_fetch.mockReset();
            answer(...answers);
            const e = await fail_by_fields({contact: {email: EMAIL}, fields: {title: 'CTO'}});
            expect(e, code).toMatchObject({code, exit_code: 1});
            expect(shown(e), shown(e)).not.toMatch(PERSONAL);
            expect(lines().filter(l=>l.startsWith('PATCH')), code).toEqual([]);
        }
    });

    it('a lost answer to the import is outcome.unknown (exit 3), and nothing is changed; a lost PATCH names the contact', async()=>{
        const lost = Object.assign(new TypeError('fetch failed'), {cause: Object.assign(new Error('ECONNRESET'), {code: 'ECONNRESET'})});
        mock_fetch.mockResolvedValueOnce(nobody()).mockRejectedValueOnce(lost);
        const before = await fail_by_fields({contact: {email: EMAIL, first_name: 'Marta'}, fields: {title: 'CTO'}});
        expect(before).toMatchObject({code: 'outcome.unknown', exit_code: 3});
        expect(lines()).toEqual([EMAIL_LOOKUP, IMPORT]);
        mock_fetch.mockReset();
        answer(nobody(), json({items: [{id: 457, status: 'created'}]}), json('', 503));
        const after = await fail_by_fields({contact: {email: EMAIL, first_name: 'Marta'}, fields: {title: 'CTO'}});
        expect(after).toMatchObject({code: 'outcome.unknown', exit_code: 3, ids: {contact_id: 457}});
    });

    it('the contact is given one way only: the id argument with a contact flag, or none at all, is refused before any call', async()=>{
        const cases: [Update_opts, string | undefined][] = [
            [{contactId: '457', fields: '-'}, '456'], [{contact: '-', fields: '-'}, '456'], [{fields: '-'}, undefined],
        ];
        for (const [opts, id] of cases)
        {
            const e = await fail_by_fields({contact: {email: EMAIL}, fields: {title: 'CTO'}}, opts, id);
            expect(e, JSON.stringify([id, opts])).toMatchObject({code: 'usage.contact', exit_code: 2});
        }
        expect(mock_fetch).not.toHaveBeenCalled();
        answer(json({id: 457}));
        const {out} = await update_by_fields({title: 'CTO'}, {contactId: '457', fields: '-'});
        expect(JSON.parse(out)).toStrictEqual({status: 'updated', contact_id: 457, contact_created: false});
        expect(lines()).toEqual(['PATCH https://api/v3/contacts/457']);
    });

    it('with --contact - and --fields - both, stdin must be one object holding each; nothing is repeated or called otherwise', async()=>{
        const cases: [unknown, string][] = [
            ['not json, Marta', 'usage.stdin'], [{contact: {email: EMAIL}}, 'usage.stdin'], [{fields: {title: 'CTO'}}, 'usage.stdin'],
            [{contact: {email: EMAIL}, fields: {title: 'CTO'}, message: {body: SECRET}}, 'usage.stdin'],
            [{contact: {email: EMAIL}, fields: {email: 'marta@example.org'}}, 'usage.fields'],
            [{contact: {first_name: 'Marta'}, fields: {title: 'CTO'}}, 'usage.contact'],
        ];
        for (const [input, code] of cases)
        {
            const e = await fail_by_fields(input);
            expect(e, JSON.stringify(input)).toMatchObject({code, exit_code: 2});
            expect(shown(e), shown(e)).not.toMatch(PERSONAL);
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});

describe('contact delete', ()=>{
    it('deletes the contact with one DELETE', async()=>{
        answer(json(undefined, 204));
        const {out} = await capture(()=>handle_contact_delete('456', ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({status: 'deleted', contact_id: 456});
        expect(sent()).toEqual([{method: 'DELETE', url: 'https://api/v3/contacts/456', body: undefined}]);
    });

    it('a 404 is contact.not_found', async()=>{
        answer(json({code: 'contact.notFound'}, 404));
        await expect(handle_contact_delete('456', ctx(), {})).rejects.toMatchObject({code: 'contact.not_found', exit_code: 1, ids: {contact_id: 456}});
    });

    it('a 503 or a lost answer is outcome.unknown (exit 3), sent once, and the hint says a re-run answers contact.not_found '
        + 'if it was deleted', async()=>{
        const lost = Object.assign(new TypeError('fetch failed'), {cause: Object.assign(new Error('ECONNRESET'), {code: 'ECONNRESET'})});
        for (const outcome of ['503', 'lost'])
        {
            mock_fetch.mockReset();
            if (outcome === 'lost')
            {
                mock_fetch.mockRejectedValueOnce(lost);
            }
            else
            {
                answer(json('', 503));
            }
            const e = await handle_contact_delete('456', ctx(), {}).catch(x=>x);
            expect(e, outcome).toMatchObject({code: 'outcome.unknown', exit_code: 3, ids: {contact_id: 456}});
            expect(e.hint, outcome).toContain('contact.not_found');
            expect(mock_fetch, outcome).toHaveBeenCalledTimes(1);
        }
    });

    it('an id that is not a Reply id is usage.id, with no call', async()=>{
        await expect(handle_contact_delete('0', ctx(), {})).rejects.toMatchObject({code: 'usage.id', exit_code: 2});
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});
