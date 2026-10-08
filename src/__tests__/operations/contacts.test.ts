import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer} from './helpers';
import {open_session} from '../../operations/call';
import {ensure_contact, find_contact, read_opted_out} from '../../operations/contacts';

const ann = {kind: 'person' as const, person: {email: 'ann@acme.com', first_name: 'Ann'}};

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('ensure_contact', ()=>{
    it('uses a --contact-id as given, with no call', async()=>{
        const s = await open_session(ctx(), {});
        expect(await ensure_contact(s, {kind: 'id', id: 456})).toEqual({id: 456, created: false});
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('imports by email and says whether the contact was created', async()=>{
        answer(json({items: [{id: 456, status: 'created'}], added: 1, updated: 0, skipped: 0, failed: 0}));
        const s = await open_session(ctx(), {});
        expect(await ensure_contact(s, ann)).toEqual({id: 456, created: true});
        expect(sent()).toEqual([{method: 'POST', url: 'https://api/v3/contacts/import',
            body: {items: [{email: 'ann@acme.com', firstName: 'Ann'}]}}]);
    });

    it('a matched contact is not created', async()=>{
        answer(json({items: [{id: 456, status: 'updated'}]}));
        const s = await open_session(ctx(), {});
        expect(await ensure_contact(s, ann)).toEqual({id: 456, created: false});
    });

    it('a skipped item that names the contact Reply holds (a teammate\'s, say) is used, not refused', async()=>{
        answer(json({items: [{id: 456, status: 'skipped', skipReason: 'noEditPermission'}]}));
        const s = await open_session(ctx(), {});
        expect(await ensure_contact(s, ann)).toEqual({id: 456, created: false});
    });

    it('a deleted contact is refused, not worked with', async()=>{
        answer(json({items: [{id: 456, status: 'skipped', skipReason: 'contactDeleted'}]}));
        const s = await open_session(ctx(), {});
        await expect(ensure_contact(s, ann)).rejects.toMatchObject({code: 'reply.refused', reply_code: 'contactDeleted'});
    });

    it('an item the import failed is reply.refused with Reply\'s own words', async()=>{
        answer(json({items: [{id: null, status: 'failed', error: 'Email is not valid'}]}));
        const s = await open_session(ctx(), {});
        await expect(ensure_contact(s, ann)).rejects.toMatchObject({code: 'reply.refused', detail: 'Email is not valid'});
    });

    it('a validation 400 that names the email is contact.invalid_email', async()=>{
        answer(json({status: 400, errors: [{pointer: '/items/0/email', detail: 'bad'}]}, 400));
        const s = await open_session(ctx(), {});
        await expect(ensure_contact(s, ann)).rejects.toMatchObject({code: 'contact.invalid_email'});
    });

    it('the account contact limit is account.contact_limit_reached', async()=>{
        answer(json({code: 'contact.limitExceeded', detail: 'Limit'}, 400));
        const s = await open_session(ctx(), {});
        await expect(ensure_contact(s, ann)).rejects.toMatchObject({code: 'account.contact_limit_reached'});
    });

    it('a 503 on the import is outcome.unknown (exit 3)', async()=>{
        answer(json('', 503));
        const s = await open_session(ctx(), {});
        await expect(ensure_contact(s, ann)).rejects.toMatchObject({code: 'outcome.unknown', exit_code: 3});
    });
});

describe('find_contact', ()=>{
    it('finds the one exact match among containment matches, across pages, whatever the case', async()=>{
        answer(
            json({items: [{id: 1, email: 'joann@acme.com'}], hasMore: true}),
            json({items: [{id: 456, email: 'ANN@ACME.COM'}], hasMore: false}),
        );
        const s = await open_session(ctx(), {});
        expect(await find_contact(s, {kind: 'person', person: {email: 'ann@acme.com'}})).toBe(456);
        expect(sent().map(r=>r.url)).toEqual([
            'https://api/v3/contacts/filter?top=100&skip=0',
            'https://api/v3/contacts/filter?top=100&skip=100',
        ]);
        expect(sent()[0].body).toEqual({searchTerm: 'ann@acme.com'});
    });

    it('answers null when Reply holds nobody under the address', async()=>{
        answer(json({items: [], hasMore: false}));
        const s = await open_session(ctx(), {});
        expect(await find_contact(s, {kind: 'person', person: {email: 'ann@acme.com'}})).toBeNull();
    });

    it('refuses two exact matches as contact.not_unique', async()=>{
        answer(json({items: [{id: 1, email: 'ann@acme.com'}, {id: 2, email: 'Ann@acme.com'}], hasMore: false}));
        const s = await open_session(ctx(), {});
        await expect(find_contact(s, {kind: 'person', person: {email: 'ann@acme.com'}}))
            .rejects.toMatchObject({code: 'contact.not_unique'});
    });

    it('refuses an unfinished lookup as contact.lookup_incomplete', async()=>{
        for (let i = 0; i < 5; i++)
        {
            answer(json({items: [{id: i + 10, email: `x${i}ann@acme.com`}], hasMore: true}));
        }
        const s = await open_session(ctx(), {});
        await expect(find_contact(s, {kind: 'person', person: {email: 'ann@acme.com'}}))
            .rejects.toMatchObject({code: 'contact.lookup_incomplete'});
        expect(mock_fetch).toHaveBeenCalledTimes(5);
    });

    it('uses a --contact-id as given', async()=>{
        const s = await open_session(ctx(), {});
        expect(await find_contact(s, {kind: 'id', id: 7})).toBe(7);
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});

describe('read_opted_out', ()=>{
    it('reads isOptedOut from the statuses', async()=>{
        answer(json({contactId: 456, isOptedOut: true, sequences: []}));
        const s = await open_session(ctx(), {});
        expect(await read_opted_out(s, 456)).toBe(true);
        expect(sent()[0]).toMatchObject({method: 'GET', url: 'https://api/v3/contacts/456/statuses'});
    });

    it('a 404 is contact.not_found', async()=>{
        answer(json({code: 'contact.notFound'}, 404));
        const s = await open_session(ctx(), {});
        await expect(read_opted_out(s, 456)).rejects.toMatchObject({code: 'contact.not_found', reply_code: 'contact.notFound'});
    });
});
