import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_account_list} from '../../operations/accounts';

const mailbox = (over: Record<string, unknown> = {})=>({
    id: 12, ownerUserId: 1, email: 'marta@example.com', senderName: 'Marta Example', emailAccountType: 'gmail',
    isDefault: true, dailyLimit: 500, connectionStatus: 'connected', tags: [], ...over,
});
const linkedin = (over: Record<string, unknown> = {})=>({
    id: 34, name: 'Marta Example', status: 'enabled', profileUrl: 'https://www.linkedin.com/in/marta-example', photoUrl: null,
    ownerUserId: 1, accountType: 'premium', authType: 'cookie', cookieStatus: 'valid', ...over,
});
const page = (items: unknown[], has_more = false)=>json({items, hasMore: has_more});

const list = async(opts: {channel?: string} = {})=>
    JSON.parse((await capture(()=>handle_account_list(opts, ctx(), {json: true}))).out) as {items: Record<string, unknown>[]};
const failure = (opts: {channel?: string} = {})=>handle_account_list(opts, ctx(), {}).catch((x: unknown)=>x);

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('account list', ()=>{
    it('lists the email accounts, every page of them, then the LinkedIn accounts, each in one shape', async()=>{
        answer(
            page([mailbox()], true),
            // A teammate's mailbox, in a team that shares them.
            page([mailbox({id: 4294967296, ownerUserId: 7, email: 'ann@example.com', senderName: 'Ann Example', connectionStatus: 'disconnected'})]),
            json([linkedin()]),
        );
        expect(await list()).toStrictEqual({items: [
            {id: 12, channel: 'email', name: 'Marta Example', address: 'marta@example.com', owner_user_id: 1, status: 'active',
                reply_status: 'connected'},
            {id: 4294967296, channel: 'email', name: 'Ann Example', address: 'ann@example.com', owner_user_id: 7, status: 'disconnected',
                reply_status: 'disconnected'},
            {id: 34, channel: 'linkedin', name: 'Marta Example', address: 'https://www.linkedin.com/in/marta-example', owner_user_id: 1,
                status: 'active', reply_status: 'enabled'},
        ]});
        expect(sent()).toEqual([
            {method: 'GET', url: 'https://api/v3/email-accounts?top=1000&skip=0', body: undefined},
            {method: 'GET', url: 'https://api/v3/email-accounts?top=1000&skip=1000', body: undefined},
            {method: 'GET', url: 'https://api/v3/linkedin-accounts', body: undefined},
        ]);
    });

    it('maps every word Reply uses for an account\'s state, and keeps Reply\'s word beside it', async()=>{
        const email: [unknown, string][] = [
            ['connected', 'active'], ['disconnected', 'disconnected'], ['unknown', 'other'], ['paused', 'other'], [undefined, 'other'],
        ];
        const social: [unknown, string][] = [
            ['enabled', 'active'], ['disabled', 'inactive'], ['cookieInvalid', 'disconnected'], ['dailyLimitReached', 'active'],
            ['suspended', 'other'], [undefined, 'other'],
        ];
        mock_fetch.mockReset();
        answer(page(email.map(([word], i)=>mailbox({id: i + 1, connectionStatus: word}))), json(social.map(([word], i)=>linkedin({id: i + 1, status: word}))));
        const {items} = await list();
        const expected = [
            ...email.map(([word, status])=>['email', word ?? null, status]),
            ...social.map(([word, status])=>['linkedin', word ?? null, status]),
        ];
        expect(items.map(i=>[i.channel, i.reply_status, i.status])).toEqual(expected);
    });

    it('--channel asks only for that channel\'s accounts, and another channel is a usage error before any call', async()=>{
        answer(page([mailbox()]));
        expect((await list({channel: 'email'})).items.map(i=>i.channel)).toEqual(['email']);
        expect(sent().map(r=>r.url)).toEqual(['https://api/v3/email-accounts?top=1000&skip=0']);
        mock_fetch.mockReset();
        answer(json([linkedin()]));
        expect((await list({channel: 'linkedin'})).items.map(i=>i.channel)).toEqual(['linkedin']);
        expect(sent().map(r=>r.url)).toEqual(['https://api/v3/linkedin-accounts']);
        mock_fetch.mockReset();
        await expect(failure({channel: 'sms'})).resolves.toMatchObject({code: 'usage.choice', exit_code: 2});
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('a name, address or owner Reply leaves out, or gives empty or unusable, is null', async()=>{
        answer(
            page([mailbox({senderName: '', email: undefined, ownerUserId: undefined}), mailbox({id: 13, senderName: undefined, email: '  ', ownerUserId: '7'})]),
            json([linkedin({name: undefined, profileUrl: '', ownerUserId: 0}), linkedin({id: 35, name: '', profileUrl: null, ownerUserId: null})]),
        );
        expect((await list()).items.map(i=>[i.name, i.address, i.owner_user_id])).toEqual(
            [[null, null, null], [null, null, null], [null, null, null], [null, null, null]]);
    });

    it('an account without a usable id is reply.unavailable, never a guess', async()=>{
        for (const [mailboxes, accounts] of [
            [[mailbox({id: '12'})], []], [[mailbox({id: undefined})], []], [[], [linkedin({id: 0})]], [['not an account'], []],
        ])
        {
            mock_fetch.mockReset();
            answer(page(mailboxes), json(accounts));
            await expect(failure(), JSON.stringify([mailboxes, accounts])).resolves.toMatchObject({code: 'reply.unavailable', exit_code: 1});
        }
    });

    it('twenty pages of mailboxes without an end is account.list_incomplete, never a partial list', async()=>{
        answer(...Array.from({length: 20}, (_, i)=>page([mailbox({id: i + 1})], true)));
        await expect(failure()).resolves.toMatchObject({code: 'account.list_incomplete', exit_code: 1});
        expect(sent()).toHaveLength(20);
        expect(sent()[19].url).toBe('https://api/v3/email-accounts?top=1000&skip=19000');
    });

    it('a refused or unreadable read is the house refusal', async()=>{
        const cases: [Response[], string][] = [
            [[json({code: 'emailAccount.forbidden'}, 403)], 'access.feature_unavailable'],
            [[page([]), json({code: 'linkedInAccount.forbidden'}, 403)], 'access.feature_unavailable'],
            [[json({items: []})], 'reply.unavailable'],
            [[page([]), json({items: []})], 'reply.unavailable'],
        ];
        for (const [responses, code] of cases)
        {
            mock_fetch.mockReset();
            answer(...responses);
            await expect(failure(), code).resolves.toMatchObject({code, exit_code: 1});
        }
    });
});
