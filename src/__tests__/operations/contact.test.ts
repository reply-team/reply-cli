import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_contact_opt_out} from '../../operations/contact';

const run = (opts: Record<string, unknown>)=>capture(()=>handle_contact_opt_out(opts, ctx(), {json: true}));

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('contact opt-out', ()=>{
    it('finds the contact by Reply\'s exact lookup and sets the flag, with no read before', async()=>{
        answer(json({items: [{id: 456, email: 'ann@example.com'}], hasMore: false}), json({}));
        const {out} = await run({email: 'ann@example.com'});
        expect(JSON.parse(out)).toEqual({status: 'opted_out', contact_id: 456, contact_created: false});
        expect(sent()).toEqual([
            {method: 'GET', url: 'https://api/v3/contacts?email=ann%40example.com&top=100&skip=0', body: undefined},
            {method: 'POST', url: 'https://api/v3/contacts/set-opted-out', body: {contactIds: [456], isOptedOut: true}},
        ]);
    });

    it('creates the contact only when Reply holds nobody under the address', async()=>{
        answer(json({items: [], hasMore: false}), json({items: [{id: 457, status: 'created'}]}), json({}));
        const {out} = await run({email: 'new@example.com'});
        expect(JSON.parse(out)).toEqual({status: 'opted_out', contact_id: 457, contact_created: true});
    });

    it('a contact given by LinkedIn URL is looked up by it, and imported keyed by it when Reply holds nobody', async()=>{
        const url = 'https://www.linkedin.com/in/marta-example';
        answer(json({items: [], hasMore: false}), json({items: [{id: 458, status: 'created'}]}), json({}));
        const {out} = await capture(()=>handle_contact_opt_out({contact: '-'}, ctx(), {json: true},
            ()=>JSON.stringify({linkedin_url: url, first_name: 'Marta'})));
        expect(JSON.parse(out)).toEqual({status: 'opted_out', contact_id: 458, contact_created: true});
        expect(sent().map(r=>`${r.method} ${r.url}`)).toEqual([
            `GET https://api/v3/contacts?linkedIn=${encodeURIComponent(url)}&top=100&skip=0`,
            'POST https://api/v3/contacts/import',
            'POST https://api/v3/contacts/set-opted-out',
        ]);
        expect(sent()[1].body).toEqual({items: [{linkedInUrl: url, firstName: 'Marta'}], options: {keys: {linkedInUrl: true}}});
    });

    it('a per-item notFound is contact.not_found', async()=>{
        answer(json({'456': {error: 'notFound', errorDetails: 'Contact not found'}}));
        await expect(run({contactId: '456'})).rejects.toMatchObject({code: 'contact.not_found', ids: {contact_id: 456}});
    });

    it('a 503 on the set is outcome.unknown (exit 3)', async()=>{
        answer(json('', 503));
        await expect(run({contactId: '456'})).rejects.toMatchObject({code: 'outcome.unknown', exit_code: 3});
    });
});
