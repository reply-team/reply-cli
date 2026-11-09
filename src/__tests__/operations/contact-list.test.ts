import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {
    handle_contact_list_add_contact, handle_contact_list_create, handle_contact_list_get, handle_contact_list_delete,
    handle_contact_list_contacts,
} from '../../operations/contact-list';

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

describe('contact-list create', ()=>{
    const create = (opts: Record<string, unknown>)=>
        handle_contact_list_create({name: '-', ...opts}, ctx(), {json: true}, ()=>'{"name":"Audience 12"}');

    it('makes a private list by default and answers created', async()=>{
        answer(json({id: 77, name: 'Audience 12', isShared: false}, 201));
        const {out} = await capture(()=>create({}));
        expect(JSON.parse(out)).toEqual({status: 'created', list_id: 77, name: 'Audience 12', is_shared: false});
        expect(sent()[0]).toEqual({method: 'POST', url: 'https://api/v3/contact-lists', body: {name: 'Audience 12', isShared: false}});
    });

    it('--shared asks for a shared list', async()=>{
        answer(json({id: 77, name: 'Audience 12', isShared: true}, 201));
        await capture(()=>create({shared: true}));
        expect(sent()[0].body).toEqual({name: 'Audience 12', isShared: true});
    });

    it('a name in use is contact-list.name_taken', async()=>{
        answer(json({code: 'contactsList.duplicateName'}, 409));
        await expect(create({})).rejects.toMatchObject({code: 'contact-list.name_taken', reply_code: 'contactsList.duplicateName', exit_code: 1});
        expect(mock_fetch).toHaveBeenCalledTimes(1);
    });
});

describe('contact-list get', ()=>{
    it('prints Reply\'s list as it is', async()=>{
        answer(json({id: 77, name: 'Audience 12', isShared: false}));
        const {out} = await capture(()=>handle_contact_list_get('77', ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({id: 77, name: 'Audience 12', isShared: false});
        expect(sent()[0]).toMatchObject({method: 'GET', url: 'https://api/v3/contact-lists/77'});
    });

    it('a 404 is contact-list.not_found', async()=>{
        answer(json({code: 'contactsList.notFound'}, 404));
        await expect(handle_contact_list_get('77', ctx(), {})).rejects.toMatchObject({code: 'contact-list.not_found', exit_code: 1});
    });
});

describe('contact-list delete', ()=>{
    it('answers deleted', async()=>{
        answer(json(null, 204));
        const {out} = await capture(()=>handle_contact_list_delete('77', ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({status: 'deleted', list_id: 77});
        expect(sent()[0]).toMatchObject({method: 'DELETE', url: 'https://api/v3/contact-lists/77'});
    });

    it('a 404 is contact-list.not_found', async()=>{
        answer(json({code: 'contactsList.notFound'}, 404));
        await expect(handle_contact_list_delete('77', ctx(), {})).rejects.toMatchObject({code: 'contact-list.not_found', ids: {list_id: 77}});
    });
});

describe('contact-list contacts', ()=>{
    const ORDER = {listId: 77, sortBy: 'addedOn', sortDirection: 'asc'};

    it('reads the list oldest first and passes Reply\'s contacts through', async()=>{
        const contact = {id: 5, email: 'ann@example.com', addingDate: '2026-11-06T10:00:01.20+00:00'};
        answer(json({items: [contact], hasMore: false}));
        const {out} = await capture(()=>handle_contact_list_contacts('77', {limit: '1000', offset: '25'}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({items: [contact], has_more: false});
        expect(sent()[0]).toEqual({method: 'POST', url: 'https://api/v3/contacts/filter?top=1000&skip=25', body: ORDER});
    });

    it('--live-data-only adds the creation-source condition', async()=>{
        answer(json({items: [], hasMore: false}));
        await capture(()=>handle_contact_list_contacts('77', {liveDataOnly: true}, ctx(), {json: true}));
        expect(sent()[0]).toEqual({method: 'POST', url: 'https://api/v3/contacts/filter?top=100&skip=0', body: {
            ...ORDER, conditions: [{field: 'creationSource', operator: 'equals', value: 'liveData'}],
        }});
    });

    it('an offset past the end is an empty last page', async()=>{
        answer(json({items: [], hasMore: false}));
        const {out} = await capture(()=>handle_contact_list_contacts('77', {offset: '500'}, ctx(), {json: true}));
        expect(JSON.parse(out)).toEqual({items: [], has_more: false});
    });
});
