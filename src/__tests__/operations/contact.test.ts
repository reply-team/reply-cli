import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_contact_opt_out} from '../../operations/contact';

const run = (opts: Record<string, unknown>)=>capture(()=>handle_contact_opt_out(opts, ctx(), {json: true}));

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('contact opt-out', ()=>{
    it('finds the contact by email and sets the flag, with no read before', async()=>{
        answer(json({items: [{id: 456, email: 'ann@acme.com'}], hasMore: false}), json({}));
        const {out} = await run({email: 'ann@acme.com'});
        expect(JSON.parse(out)).toEqual({status: 'opted_out', contact_id: 456, contact_created: false});
        expect(sent()[1]).toEqual({method: 'POST', url: 'https://api/v3/contacts/set-opted-out',
            body: {contactIds: [456], isOptedOut: true}});
    });

    it('creates the contact only when Reply holds nobody under the address', async()=>{
        answer(json({items: [], hasMore: false}), json({items: [{id: 457, status: 'created'}]}), json({}));
        const {out} = await run({email: 'new@acme.com'});
        expect(JSON.parse(out)).toEqual({status: 'opted_out', contact_id: 457, contact_created: true});
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
