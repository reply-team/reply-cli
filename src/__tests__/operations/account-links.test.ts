import crypto from 'crypto';
import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_account_connect, handle_account_reconnect, handle_account_pending} from '../../operations/account-links';
import type {Op_globals} from '../../operations/options';

// Generated for every run: no test holds a real link or token.
const token = (): string=>crypto.randomBytes(24).toString('hex');
const APP = 'https://app.example.test';
const email_link = (t = token())=>`${APP}/email-connect/${t}`;
const linkedin_link = (t = token())=>`${APP}/linkedin-connect/${t}`;
const missing = ()=>json({type: 'about:blank', title: 'Not Found', status: 404}, 404);

const run = async(fn: (g: Op_globals) => Promise<void>, g: Op_globals = {json: true})=>{
    const {out, err} = await capture(()=>fn(g));
    return {result: JSON.parse(out) as Record<string, unknown>, err};
};
const fails = (fn: () => Promise<void>)=>fn().catch((x: unknown)=>x);

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('account connect', ()=>{
    it('email: asks Reply for a one-mailbox link and prints it with its expiry and pending entry', async()=>{
        const link = email_link();
        answer(json({connectionLink: link, pendingAccountId: 50, provider: 'gmail', expiresAtUtc: '2026-11-18T12:00:00Z'}, 201));
        const {result} = await run(g=>handle_account_connect({channel: 'email', provider: 'gmail', name: ' Sales '}, ctx(), g));
        expect(result).toStrictEqual({channel: 'email', link, expires_at: '2026-11-18T12:00:00Z', pending_id: 50, kind: 'connect',
            link_kind: 'connection_link'});
        expect(sent()).toEqual([{method: 'POST', url: 'https://api/v3/email-accounts/connection-link', body: {provider: 'gmail', name: 'Sales'}}]);
    });

    it('email: a Reply without the route is email_link.not_available, offering nothing, with or without --allow-shared-page', async()=>{
        for (const allowSharedPage of [undefined, true])
        {
            mock_fetch.mockReset();
            answer(missing());
            const e = await fails(()=>handle_account_connect({channel: 'email', provider: 'office365', allowSharedPage}, ctx(), {}));
            expect(e, String(allowSharedPage)).toMatchObject({code: 'email_link.not_available', status: 404, exit_code: 1, title: 'This Reply does not issue one-mailbox email connection links, so no link was made.'});
            expect((e as {hint?: string}).hint, String(allowSharedPage)).toBeUndefined();
            expect(sent().map(r=>r.url), String(allowSharedPage)).toEqual(['https://api/v3/email-accounts/connection-link']);
        }
    });

    it('email: a 404 Reply gives a code to is Reply\'s refusal, never a missing route', async()=>{
        answer(json({code: 'emailAccount.notFound', title: 'Not Found', status: 404}, 404));
        expect(await fails(()=>handle_account_connect({channel: 'email', provider: 'gmail'}, ctx(), {})))
            .toMatchObject({code: 'email_account.not_found', reply_code: 'emailAccount.notFound', status: 404, exit_code: 1});
        expect(sent()).toHaveLength(1);
    });

    it('email --allow-shared-page is accepted and ignored: the one-mailbox link is made as without it', async()=>{
        const link = email_link();
        answer(json({connectionLink: link, pendingAccountId: 50, provider: 'gmail', expiresAtUtc: '2026-11-18T12:00:00Z'}, 201));
        const {result} = await run(g=>handle_account_connect({channel: 'email', provider: 'gmail', allowSharedPage: true}, ctx(), g));
        expect(result).toStrictEqual({channel: 'email', link, expires_at: '2026-11-18T12:00:00Z', pending_id: 50, kind: 'connect',
            link_kind: 'connection_link'});
        expect(sent().map(r=>[r.method, r.url])).toEqual([['POST', 'https://api/v3/email-accounts/connection-link']]);
    });

    it('email: Reply\'s refusal comes under the CLI\'s code, with Reply\'s in reply_code', async()=>{
        answer(json({code: 'emailAccount.noFreeMailboxSlots', title: 'Conflict', status: 409, detail: 'One more email account would need a paid seat'}, 409));
        expect(await fails(()=>handle_account_connect({channel: 'email', provider: 'gmail'}, ctx(), {})))
            .toMatchObject({code: 'email_account.no_free_mailbox_slots', reply_code: 'emailAccount.noFreeMailboxSlots', status: 409, detail: 'One more email account would need a paid seat', exit_code: 1});
    });

    it('email: without --provider, --allow-shared-page or not, or with a provider it does not know, is a usage error before any call', async()=>{
        expect(await fails(()=>handle_account_connect({channel: 'email'}, ctx(), {}))).toMatchObject({code: 'usage.provider', exit_code: 2});
        expect(await fails(()=>handle_account_connect({channel: 'email', allowSharedPage: true}, ctx(), {})))
            .toMatchObject({code: 'usage.provider', exit_code: 2});
        expect(await fails(()=>handle_account_connect({channel: 'email', provider: 'yahoo'}, ctx(), {}))).toMatchObject({code: 'usage.choice', exit_code: 2});
        expect(await fails(()=>handle_account_connect({channel: 'email', provider: 'gmail', name: 'x'.repeat(101)}, ctx(), {})))
            .toMatchObject({code: 'usage.name', exit_code: 2});
        expect(await fails(()=>handle_account_connect({provider: 'gmail'}, ctx(), {}))).toMatchObject({code: 'usage.channel', exit_code: 2});
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('linkedin: asks for a connection link under the name, and prints it with its pending entry', async()=>{
        const link = linkedin_link();
        answer(json({connectionLink: link, pendingAccountId: 51}, 201));
        const {result} = await run(g=>handle_account_connect({channel: 'linkedin', name: 'Dana Example'}, ctx(), g));
        expect(result).toStrictEqual({channel: 'linkedin', link, expires_at: null, pending_id: 51, kind: 'connect', link_kind: 'connection_link'});
        expect(sent()).toEqual([{method: 'POST', url: 'https://api/v3/linkedin-accounts/connection-link', body: {name: 'Dana Example'}}]);
    });

    it('linkedin: needs --name, and takes no --provider; --allow-shared-page is ignored there too', async()=>{
        expect(await fails(()=>handle_account_connect({channel: 'linkedin'}, ctx(), {}))).toMatchObject({code: 'usage.name', exit_code: 2});
        expect(await fails(()=>handle_account_connect({channel: 'linkedin', name: 'D', provider: 'gmail'}, ctx(), {})))
            .toMatchObject({code: 'usage.channel', exit_code: 2});
        expect(mock_fetch).not.toHaveBeenCalled();
        const link = linkedin_link();
        answer(json({connectionLink: link, pendingAccountId: 51}, 201));
        const {result} = await run(g=>handle_account_connect({channel: 'linkedin', name: 'D', allowSharedPage: true}, ctx(), g));
        expect(result).toMatchObject({channel: 'linkedin', link, link_kind: 'connection_link'});
    });

    it('linkedin: Reply\'s limit comes under the CLI\'s code; an answer without the link is outcome.unknown, since a link may exist', async()=>{
        answer(json({code: 'linkedInAccount.limitReached', status: 409}, 409));
        expect(await fails(()=>handle_account_connect({channel: 'linkedin', name: 'D'}, ctx(), {})))
            .toMatchObject({code: 'linkedin.account_limit_reached', reply_code: 'linkedInAccount.limitReached', exit_code: 1});
        mock_fetch.mockReset();
        answer(json({pendingAccountId: 51}, 201));
        expect(await fails(()=>handle_account_connect({channel: 'linkedin', name: 'D'}, ctx(), {})))
            .toMatchObject({code: 'outcome.unknown', exit_code: 3});
    });
});

describe('account reconnect', ()=>{
    it('email: asks Reply for a reconnect link for the mailbox, and prints it', async()=>{
        const link = email_link();
        answer(json({connectionLink: link, pendingAccountId: 52, provider: 'office365', expiresAtUtc: '2026-11-18T12:00:00Z'}));
        const {result} = await run(g=>handle_account_reconnect('4294967296', {channel: 'email'}, ctx(), g));
        expect(result).toStrictEqual({channel: 'email', id: 4294967296, link, expires_at: '2026-11-18T12:00:00Z', pending_id: 52,
            kind: 'reconnect', link_kind: 'connection_link'});
        expect(sent()).toEqual([{method: 'POST', url: 'https://api/v3/email-accounts/4294967296/reconnect', body: undefined}]);
    });

    it('email: a Reply without the route is email_link.not_available, offering nothing; --allow-shared-page and --provider are ignored', async()=>{
        for (const opts of [{channel: 'email'}, {channel: 'email', allowSharedPage: true}, {channel: 'email', provider: 'gmail', allowSharedPage: true}])
        {
            mock_fetch.mockReset();
            answer(missing());
            const e = await fails(()=>handle_account_reconnect('12', opts, ctx(), {}));
            expect(e, JSON.stringify(opts)).toMatchObject({code: 'email_link.not_available', status: 404, exit_code: 1, title: 'This Reply does not issue one-mailbox email connection links, so no link was made.'});
            expect((e as {hint?: string}).hint, JSON.stringify(opts)).toBeUndefined();
            expect(sent().map(r=>r.url), JSON.stringify(opts)).toEqual(['https://api/v3/email-accounts/12/reconnect']);
        }
    });

    it('email: a mailbox Reply cannot reconnect by link, or not the user\'s, is Reply\'s refusal, under the CLI\'s code', async()=>{
        for (const [status, reply_code, code] of [[400, 'emailAccount.reconnectNotSupported', 'email_account.reconnect_not_supported'],
            [404, 'emailAccount.notFound', 'email_account.not_found']] as const)
        {
            mock_fetch.mockReset();
            answer(json({code: reply_code, status}, status));
            expect(await fails(()=>handle_account_reconnect('12', {channel: 'email', allowSharedPage: true}, ctx(), {})))
                .toMatchObject({code, reply_code, status, exit_code: 1});
            expect(sent()).toHaveLength(1);
        }
    });

    it('linkedin: asks Reply for a reconnect link; it has no pending entry and no expiry', async()=>{
        const link = linkedin_link();
        answer(json({connectionLink: link}));
        const {result} = await run(g=>handle_account_reconnect('34', {channel: 'linkedin'}, ctx(), g));
        expect(result).toStrictEqual({channel: 'linkedin', id: 34, link, expires_at: null, pending_id: null, kind: 'reconnect',
            link_kind: 'connection_link'});
        expect(sent()).toEqual([{method: 'POST', url: 'https://api/v3/linkedin-accounts/34/reconnect', body: undefined}]);
    });

    it('a bad id, a missing channel or --name is a usage error before any call', async()=>{
        expect(await fails(()=>handle_account_reconnect('0', {channel: 'email'}, ctx(), {}))).toMatchObject({code: 'usage.id', exit_code: 2});
        expect(await fails(()=>handle_account_reconnect('4294967296', {channel: 'linkedin'}, ctx(), {}))).toMatchObject({code: 'usage.id'});
        expect(await fails(()=>handle_account_reconnect('12', {}, ctx(), {}))).toMatchObject({code: 'usage.channel'});
        expect(await fails(()=>handle_account_reconnect('12', {channel: 'email', name: 'x'}, ctx(), {}))).toMatchObject({code: 'usage.name'});
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});

describe('account pending', ()=>{
    it('lists both channels\' entries in one shape, and never a LinkedIn entry\'s link', async()=>{
        const link = linkedin_link();
        answer(
            json([{id: 50, name: 'Sales', provider: 'gmail', kind: 'connect', emailAccountId: null, expiresAtUtc: '2026-11-18T12:00:00Z', isExpired: false},
                {id: 52, name: null, provider: 'office365', kind: 'reconnect', emailAccountId: 4294967296, expiresAtUtc: '2026-11-01T12:00:00Z',
                    isExpired: true}]),
            json([{id: 7, name: 'Dana Example', connectionLink: link, expiresAtUtc: '2026-11-19T00:00:00Z', isExpired: false}]),
        );
        const {result} = await run(g=>handle_account_pending({}, ctx(), g));
        expect(result).toStrictEqual({items: [
            {channel: 'email', id: 50, name: 'Sales', kind: 'connect', account_id: null, expires_at: '2026-11-18T12:00:00Z', expired: false},
            {channel: 'email', id: 52, name: null, kind: 'reconnect', account_id: 4294967296, expires_at: '2026-11-01T12:00:00Z', expired: true},
            {channel: 'linkedin', id: 7, name: 'Dana Example', kind: 'connect', account_id: null, expires_at: '2026-11-19T00:00:00Z', expired: false},
        ], supported: true, unsupported_channels: []});
        expect(JSON.stringify(result)).not.toContain(link);
        expect(sent().map(r=>r.url)).toEqual(['https://api/v3/email-accounts/pending', 'https://api/v3/linkedin-accounts/pending']);
    });

    it('a Reply without one-mailbox email links is email_link.not_available, offering nothing, with or without --channel email', async()=>{
        for (const opts of [{channel: 'email'}, {}])
        {
            mock_fetch.mockReset();
            answer(missing(), json([]));
            const e = await fails(()=>handle_account_pending(opts, ctx(), {}));
            expect(e, JSON.stringify(opts)).toMatchObject({code: 'email_link.not_available', status: 404, exit_code: 1, title: 'This Reply does not issue one-mailbox email connection links, so no link was made.'});
            expect((e as {hint?: string}).hint, JSON.stringify(opts)).toBeUndefined();
            expect(sent().map(r=>r.url), JSON.stringify(opts)).toEqual(['https://api/v3/email-accounts/pending']);
        }
    });

    it('--channel linkedin reads only LinkedIn; a refusal comes under the CLI\'s code', async()=>{
        answer(json([]));
        expect((await run(g=>handle_account_pending({channel: 'linkedin'}, ctx(), g))).result).toStrictEqual({items: [], supported: true,
            unsupported_channels: []});
        expect(sent().map(r=>r.url)).toEqual(['https://api/v3/linkedin-accounts/pending']);
        mock_fetch.mockReset();
        answer(json({code: 'linkedInAccount.forbidden', status: 403}, 403));
        expect(await fails(()=>handle_account_pending({channel: 'linkedin'}, ctx(), {}))).toMatchObject({code: 'access.feature_unavailable', reply_code: 'linkedInAccount.forbidden'});
    });
});
