import crypto from 'crypto';
import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_account_connect, handle_account_reconnect, handle_account_pending} from '../../operations/account-links';
import {read_shared_page, shared_page_link, SHARED_PAGE_WARNING} from '../../operations/shared-page';
import type {Op_globals} from '../../operations/options';

// Generated for every run: no test holds a real link or token.
const token = (): string=>crypto.randomBytes(24).toString('hex');
const APP = 'https://app.example.test';
const email_link = (t = token())=>`${APP}/email-connect/${t}`;
const linkedin_link = (t = token())=>`${APP}/linkedin-connect/${t}`;
const shared_url = (t: string)=>`${APP}/hosted/eac/index/${t}`;
const missing = ()=>json({type: 'about:blank', title: 'Not Found', status: 404}, 404);

const run = async(fn: (g: Op_globals) => Promise<void>, g: Op_globals = {json: true})=>{
    const {out, err} = await capture(()=>fn(g));
    return {result: JSON.parse(out) as Record<string, unknown>, err};
};
const fails = (fn: () => Promise<void>)=>fn().catch((x: unknown)=>x);

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('the hosted page forms', ()=>{
    it('builds each provider\'s connect from the token of the index Reply answers, and the index without a provider', ()=>{
        const t = token();
        const page = read_shared_page(shared_url(t));
        expect(page).toEqual({index: shared_url(t), token: t, base: APP});
        expect(shared_page_link(page!, 'gmail')).toBe(`${APP}/hosted/eac/ConnectWithGMail?uidToken=${t}`);
        expect(shared_page_link(page!, 'office365')).toBe(`${APP}/hosted/eac/ConnectWithOffice?uidToken=${t}&isExchange=false`);
        expect(shared_page_link(page!, undefined)).toBe(shared_url(t));
    });

    it('keeps a path the app is served under, and reads nothing else as the hosted index', ()=>{
        const t = token();
        expect(read_shared_page(`${APP}/app/hosted/eac/index/${t}/`)).toMatchObject({base: `${APP}/app`, token: t});
        for (const url of ['not a url', `${APP}/hosted/eac/${t}`, `ftp://app.example.test/hosted/eac/index/${t}`, `${APP}/hosted/eac/index/`])
        {
            expect(read_shared_page(url), url).toBeNull();
        }
    });
});

describe('account connect', ()=>{
    it('email: asks Reply for a one-mailbox link and prints it with its expiry and pending entry', async()=>{
        const link = email_link();
        answer(json({connectionLink: link, pendingAccountId: 50, provider: 'gmail', expiresAtUtc: '2026-11-18T12:00:00Z'}, 201));
        const {result} = await run(g=>handle_account_connect({channel: 'email', provider: 'gmail', name: ' Sales '}, ctx(), g));
        expect(result).toStrictEqual({channel: 'email', link, expires_at: '2026-11-18T12:00:00Z', pending_id: 50, kind: 'connect',
            link_kind: 'connection_link'});
        expect(sent()).toEqual([{method: 'POST', url: 'https://api/v3/email-accounts/connection-link', body: {provider: 'gmail', name: 'Sales'}}]);
    });

    it('email: a Reply without the route is refused, email_link.not_available, and the shared page is never asked for', async()=>{
        answer(missing());
        expect(await fails(()=>handle_account_connect({channel: 'email', provider: 'office365'}, ctx(), {})))
            .toMatchObject({code: 'email_link.not_available', exit_code: 1});
        expect(sent().map(r=>r.url)).toEqual(['https://api/v3/email-accounts/connection-link']);
    });

    it('email: a 404 Reply gives a code to is Reply\'s refusal, never a missing route', async()=>{
        answer(json({code: 'emailAccount.notFound', title: 'Not Found', status: 404}, 404));
        expect(await fails(()=>handle_account_connect({channel: 'email', provider: 'gmail', allowSharedPage: true}, ctx(), {})))
            .toMatchObject({code: 'email_account.not_found', reply_code: 'emailAccount.notFound', status: 404, exit_code: 1});
        expect(sent()).toHaveLength(1);
    });

    it('email --allow-shared-page: on a Reply without the route, prints the provider\'s hosted connect, with no expiry and the warning', async()=>{
        for (const [provider, path] of [['gmail', 'ConnectWithGMail?uidToken='], ['office365', 'ConnectWithOffice?uidToken=']] as const)
        {
            mock_fetch.mockReset();
            const t = token();
            answer(missing(), json({url: shared_url(t)}));
            const {result} = await run(g=>handle_account_connect({channel: 'email', provider, allowSharedPage: true}, ctx(), g));
            expect(result).toStrictEqual({channel: 'email', link: `${APP}/hosted/eac/${path}${t}${provider === 'office365' ? '&isExchange=false' : ''}`,
                expires_at: null, pending_id: null, kind: 'connect', link_kind: 'shared_page', warning: SHARED_PAGE_WARNING});
            expect(sent().map(r=>[r.method, r.url])).toEqual([
                ['POST', 'https://api/v3/email-accounts/connection-link'], ['GET', 'https://api/v1/SharedPageUrl'],
            ]);
        }
    });

    it('email --allow-shared-page without --provider: a Reply without one-mailbox links gives the hosted index', async()=>{
        const t = token();
        answer(missing(), json({url: shared_url(t)}));
        const {result} = await run(g=>handle_account_connect({channel: 'email', allowSharedPage: true}, ctx(), g));
        expect(result).toMatchObject({link: shared_url(t), link_kind: 'shared_page'});
        expect(sent().map(r=>[r.method, r.url])).toEqual([['GET', 'https://api/v3/email-accounts/pending'], ['GET', 'https://api/v1/SharedPageUrl']]);
    });

    it('email --allow-shared-page without --provider: a Reply with them is refused, and no shared page is asked for', async()=>{
        answer(json([]));
        expect(await fails(()=>handle_account_connect({channel: 'email', allowSharedPage: true}, ctx(), {})))
            .toMatchObject({code: 'email_link.provider_required', exit_code: 1});
        expect(sent()).toHaveLength(1);
    });

    it('email: the plan without hosted pages is sharedPage.notEnabled; any other v1 refusal reads as every refusal does', async()=>{
        answer(missing(), json('Shared page is not enabled for your account', 403));
        expect(await fails(()=>handle_account_connect({channel: 'email', provider: 'gmail', allowSharedPage: true}, ctx(), {})))
            .toMatchObject({code: 'shared_page.not_enabled', status: 403, exit_code: 1});
        mock_fetch.mockReset();
        answer(missing(), json({message: 'denied due to the organization permissions / payment plan settings'}, 403));
        expect(await fails(()=>handle_account_connect({channel: 'email', provider: 'gmail', allowSharedPage: true}, ctx(), {})))
            .toMatchObject({code: 'access.feature_unavailable', exit_code: 1});
    });

    it('email: a shared page in a form the CLI cannot read is reply.unavailable', async()=>{
        answer(missing(), json({url: `${APP}/somewhere/else/${token()}`}));
        expect(await fails(()=>handle_account_connect({channel: 'email', provider: 'gmail', allowSharedPage: true}, ctx(), {})))
            .toMatchObject({code: 'reply.unavailable', exit_code: 1});
    });

    it('email: a shared page Reply answers as a bare string is read as the address', async()=>{
        const t = token();
        answer(missing(), json(shared_url(t)));
        const {result} = await run(g=>handle_account_connect({channel: 'email', provider: 'gmail', allowSharedPage: true}, ctx(), g));
        expect(result).toMatchObject({link: `${APP}/hosted/eac/ConnectWithGMail?uidToken=${t}`, link_kind: 'shared_page'});
    });

    it('email: Reply\'s refusal comes under the CLI\'s code, with Reply\'s in reply_code', async()=>{
        answer(json({code: 'emailAccount.noFreeMailboxSlots', title: 'Conflict', status: 409, detail: 'One more email account would need a paid seat'}, 409));
        expect(await fails(()=>handle_account_connect({channel: 'email', provider: 'gmail'}, ctx(), {})))
            .toMatchObject({code: 'email_account.no_free_mailbox_slots', reply_code: 'emailAccount.noFreeMailboxSlots', status: 409, detail: 'One more email account would need a paid seat', exit_code: 1});
    });

    it('email: without --provider and without --allow-shared-page, or with a provider it does not know, is a usage error before any call', async()=>{
        expect(await fails(()=>handle_account_connect({channel: 'email'}, ctx(), {}))).toMatchObject({code: 'usage.provider', exit_code: 2});
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

    it('linkedin: needs --name, and takes neither --provider nor --allow-shared-page', async()=>{
        expect(await fails(()=>handle_account_connect({channel: 'linkedin'}, ctx(), {}))).toMatchObject({code: 'usage.name', exit_code: 2});
        expect(await fails(()=>handle_account_connect({channel: 'linkedin', name: 'D', provider: 'gmail'}, ctx(), {})))
            .toMatchObject({code: 'usage.channel', exit_code: 2});
        expect(await fails(()=>handle_account_connect({channel: 'linkedin', name: 'D', allowSharedPage: true}, ctx(), {})))
            .toMatchObject({code: 'usage.channel', exit_code: 2});
        expect(mock_fetch).not.toHaveBeenCalled();
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

    it('email: a Reply without the route is refused, and --allow-shared-page gives the hosted page for --provider', async()=>{
        answer(missing());
        expect(await fails(()=>handle_account_reconnect('12', {channel: 'email'}, ctx(), {}))).toMatchObject({code: 'email_link.not_available'});
        mock_fetch.mockReset();
        const t = token();
        answer(missing(), json({url: shared_url(t)}));
        const {result} = await run(g=>handle_account_reconnect('12', {channel: 'email', provider: 'gmail', allowSharedPage: true}, ctx(), g));
        expect(result).toStrictEqual({channel: 'email', id: 12, link: `${APP}/hosted/eac/ConnectWithGMail?uidToken=${t}`, expires_at: null,
            pending_id: null, kind: 'reconnect', link_kind: 'shared_page', warning: SHARED_PAGE_WARNING});
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

    it('a Reply without one-mailbox email links: email lists nothing and says it is not supported', async()=>{
        answer(missing());
        expect((await run(g=>handle_account_pending({channel: 'email'}, ctx(), g))).result)
            .toStrictEqual({items: [], supported: false, unsupported_channels: ['email']});
        mock_fetch.mockReset();
        answer(missing(), json([]));
        expect((await run(g=>handle_account_pending({}, ctx(), g))).result).toStrictEqual({items: [], supported: false, unsupported_channels: ['email']});
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
