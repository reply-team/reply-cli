import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_contact_list_add_contact} from '../../operations/contact-list';

const run = (opts: Record<string, unknown>)=>capture(()=>handle_contact_list_add_contact('77', opts, ctx(), {json: true}));

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('contact-list add-contact', ()=>{
    it('imports and adds; someone already on the list is a plain success', async()=>{
        answer(json({items: [{id: 456, status: 'created'}]}), json({}));
        const {out} = await run({email: 'ann@example.com'});
        expect(JSON.parse(out)).toEqual({status: 'added', list_id: 77, contact_id: 456, contact_created: true});
        expect(sent()[1]).toEqual({method: 'POST', url: 'https://api/v3/contact-lists/77/add-contacts', body: {contactIds: [456]}});
    });

    it('without --refuse-opted-out the opt-out status is not read', async()=>{
        answer(json({}));
        await run({contactId: '456'});
        expect(sent().map(r=>r.url)).toEqual(['https://api/v3/contact-lists/77/add-contacts']);
    });

    it('--refuse-opted-out refuses an opted-out contact and adds nothing', async()=>{
        answer(json({contactId: 456, isOptedOut: true}));
        await expect(run({contactId: '456', refuseOptedOut: true})).rejects.toMatchObject({
            code: 'contact.opted_out', ids: {list_id: 77, contact_id: 456},
        });
        expect(mock_fetch).toHaveBeenCalledTimes(1);
    });

    it('a list Reply doesn\'t hold is contact-list.not_found', async()=>{
        answer(json({code: 'contactsList.notFound'}, 404));
        await expect(run({contactId: '456'})).rejects.toMatchObject({code: 'contact-list.not_found'});
    });

    it('a contact Reply did not add is reply.refused with its words', async()=>{
        answer(json({'456': {error: 'contactNotProcessed', errorDetails: 'Contact was not added to the list'}}));
        await expect(run({contactId: '456'})).rejects.toMatchObject({
            code: 'reply.refused', reply_code: 'contactNotProcessed', detail: 'Contact was not added to the list',
        });
    });
});
