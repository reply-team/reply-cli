import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer} from './helpers';
import {open_session} from '../../operations/call';
import {ensure_contact, find_contact, read_opted_out} from '../../operations/contacts';

const ann = {kind: 'person' as const, person: {email: 'ann@example.com', first_name: 'Ann'}};

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
            body: {items: [{email: 'ann@example.com', firstName: 'Ann'}]}}]);
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

    it('a contact with no email is imported keyed by its LinkedIn URL', async()=>{
        const url = 'https://www.linkedin.com/in/marta-example';
        answer(json({items: [{id: 458, status: 'created'}]}));
        const s = await open_session(ctx(), {});
        expect(await ensure_contact(s, {kind: 'person', person: {linkedin_url: url, first_name: 'Marta'}})).toEqual({id: 458, created: true});
        expect(sent()[0].body).toEqual({items: [{linkedInUrl: url, firstName: 'Marta'}], options: {keys: {linkedInUrl: true}}});
    });

    it('a contact with an email and a LinkedIn URL is imported keyed by the email, carrying both', async()=>{
        const url = 'https://www.linkedin.com/in/marta-example';
        answer(json({items: [{id: 458, status: 'updated'}]}));
        const s = await open_session(ctx(), {});
        await ensure_contact(s, {kind: 'person', person: {email: 'marta@example.com', linkedin_url: url, first_name: 'Marta'}});
        expect(sent()[0].body).toEqual({items: [{email: 'marta@example.com', linkedInUrl: url, firstName: 'Marta'}]});
    });

    it('a validation 400 that names the LinkedIn URL is contact.invalid_linkedin_url', async()=>{
        answer(json({status: 400, errors: [{pointer: '/items/0/linkedInUrl', detail: 'bad'}]}, 400));
        const s = await open_session(ctx(), {});
        await expect(ensure_contact(s, {kind: 'person', person: {linkedin_url: 'https://www.linkedin.com/in/x', first_name: 'M'}}))
            .rejects.toMatchObject({code: 'contact.invalid_linkedin_url'});
    });
});

describe('find_contact', ()=>{
    it('asks Reply\'s exact lookup by email, encoded, with no containment search', async()=>{
        answer(json({items: [{id: 456, email: 'ann+q4@example.com'}], hasMore: false}));
        const s = await open_session(ctx(), {});
        expect(await find_contact(s, {kind: 'person', person: {email: 'ann+q4@example.com'}})).toBe(456);
        expect(sent()).toEqual([{method: 'GET', url: 'https://api/v3/contacts?email=ann%2Bq4%40example.com&top=100&skip=0', body: undefined}]);
    });

    it('counts only an entry whose email is the one asked, whatever the case', async()=>{
        answer(json({items: [{id: 1, email: 'joann@example.com'}, {id: 456, email: 'ANN@EXAMPLE.COM'}, {id: 2}], hasMore: false}));
        const s = await open_session(ctx(), {});
        expect(await find_contact(s, {kind: 'person', person: {email: 'ann@example.com'}})).toBe(456);
    });

    it('reads the answer to its end', async()=>{
        answer(
            json({items: [{id: 1, email: 'joann@example.com'}], hasMore: true}),
            json({items: [{id: 456, email: 'ann@example.com'}], hasMore: false}),
        );
        const s = await open_session(ctx(), {});
        expect(await find_contact(s, {kind: 'person', person: {email: 'ann@example.com'}})).toBe(456);
        expect(sent().map(r=>r.url)).toEqual([
            'https://api/v3/contacts?email=ann%40example.com&top=100&skip=0',
            'https://api/v3/contacts?email=ann%40example.com&top=100&skip=100',
        ]);
    });

    it('answers null when Reply holds nobody under the address', async()=>{
        answer(json({items: [], hasMore: false}));
        const s = await open_session(ctx(), {});
        expect(await find_contact(s, {kind: 'person', person: {email: 'ann@example.com'}})).toBeNull();
    });

    it('refuses two contacts under the address as contact.not_unique, on one page or across two', async()=>{
        answer(json({items: [{id: 1, email: 'ann@example.com'}, {id: 2, email: 'Ann@example.com'}], hasMore: true}));
        const s = await open_session(ctx(), {});
        await expect(find_contact(s, {kind: 'person', person: {email: 'ann@example.com'}}))
            .rejects.toMatchObject({code: 'contact.not_unique'});
        expect(mock_fetch).toHaveBeenCalledTimes(1);
        mock_fetch.mockReset();
        answer(json({items: [{id: 1, email: 'ann@example.com'}], hasMore: true}), json({items: [{id: 2, email: 'ann@example.com'}], hasMore: false}));
        await expect(find_contact(s, {kind: 'person', person: {email: 'ann@example.com'}}))
            .rejects.toMatchObject({code: 'contact.not_unique'});
    });

    it('asks by LinkedIn URL when the contact has no email', async()=>{
        const url = 'https://www.linkedin.com/in/marta-example';
        answer(json({items: [{id: 456, linkedInUrl: url}], hasMore: false}));
        const s = await open_session(ctx(), {});
        expect(await find_contact(s, {kind: 'person', person: {linkedin_url: url}})).toBe(456);
        expect(sent().map(r=>r.url)).toEqual([`https://api/v3/contacts?linkedIn=${encodeURIComponent(url)}&top=100&skip=0`]);
    });

    it('matches a LinkedIn URL under the do-not-contact key: scheme and host ignore case, a default port, a trailing slash and a '
        + 'fragment do not count, and the path\'s case, www and the query do', async()=>{
        const asked = 'https://www.linkedin.com/in/Marta-Example/';
        answer(json({items: [
            {id: 2, linkedInUrl: 'https://www.linkedin.com/in/marta-example'},
            {id: 3, linkedInUrl: 'https://linkedin.com/in/Marta-Example'},
            {id: 4, linkedInUrl: 'http://www.linkedin.com/in/Marta-Example'},
            {id: 5, linkedInUrl: 'https://www.linkedin.com/in/Marta-Example?trk=x'},
            {id: 6, linkedInUrl: 'not a url'},
            {id: 456, linkedInUrl: 'HTTPS://WWW.LinkedIn.COM:443/in/Marta-Example#about'},
        ], hasMore: false}));
        const s = await open_session(ctx(), {});
        expect(await find_contact(s, {kind: 'person', person: {linkedin_url: asked}})).toBe(456);
        mock_fetch.mockReset();
        answer(json({items: [{id: 2, linkedInUrl: 'https://www.linkedin.com/in/marta-example'}], hasMore: false}));
        expect(await find_contact(s, {kind: 'person', person: {linkedin_url: asked}})).toBeNull();
    });

    it('ten pages without an end is not an exact lookup\'s answer: reply.unavailable', async()=>{
        for (let i = 0; i < 10; i++)
        {
            answer(json({items: [{id: i + 10, email: `x${i}ann@example.com`}], hasMore: true}));
        }
        const s = await open_session(ctx(), {});
        await expect(find_contact(s, {kind: 'person', person: {email: 'ann@example.com'}}))
            .rejects.toMatchObject({code: 'reply.unavailable'});
        expect(mock_fetch).toHaveBeenCalledTimes(10);
    });

    it('a matching entry without a usable id is reply.unavailable, never a guess', async()=>{
        answer(json({items: [{id: 'x', email: 'ann@example.com'}], hasMore: false}));
        const s = await open_session(ctx(), {});
        await expect(find_contact(s, {kind: 'person', person: {email: 'ann@example.com'}}))
            .rejects.toMatchObject({code: 'reply.unavailable'});
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
