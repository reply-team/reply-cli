import {describe, it, expect, beforeEach, vi} from 'vitest';
import fs from 'fs';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {
    handle_account_limits, handle_account_pause, handle_account_resume, handle_account_unblock, handle_account_delete,
} from '../../operations/account-manage';
import type {Op_globals} from '../../operations/options';

const SAFETY = {dailyLimit: 500, isEmailsThrottlingEnabled: false, emailsPerInterval: null, emailsThrottlingSecondsInterval: null,
    isSendingDelayEnabled: true, maxSendingDelaySeconds: 120, minSendingDelaySeconds: 60};
const mailbox = (safety: Record<string, unknown> = SAFETY)=>({id: 12, ownerUserId: 1, emailAccountType: 'gmail', connectionStatus: 'connected', safety});
const LIMITS = {limitsMode: 'fixed', fixedMax: {dailySendMessageCount: 50}, rangeMin: null, rangeMax: null, actionDelayMinSeconds: 60,
    actionDelayMaxSeconds: 120};
const linkedin = (over: Record<string, unknown> = {})=>({id: 34, name: 'Dana Example', status: 'enabled', limits: LIMITS, ...over});

const run = async(fn: (g: Op_globals) => Promise<void>)=>{
    const {out, err} = await capture(()=>fn({json: true}));
    return {result: JSON.parse(out) as Record<string, unknown>, err};
};
const fails = (fn: () => Promise<void>)=>fn().catch((x: unknown)=>x);

beforeEach(()=>{ mock_fetch.mockReset(); vi.restoreAllMocks(); });

describe('account limits', ()=>{
    it('email: without a change reads the account and prints its safety section', async()=>{
        answer(json(mailbox()));
        expect((await run(g=>handle_account_limits('12', {channel: 'email'}, ctx(), g))).result).toStrictEqual({channel: 'email', id: 12, limits: SAFETY});
        expect(sent()).toEqual([{method: 'GET', url: 'https://api/v3/email-accounts/12', body: undefined}]);
    });

    it('email: --daily and --set go into one PATCH of the safety section, and the answer is printed', async()=>{
        const after = {...SAFETY, dailyLimit: 200, minSendingDelaySeconds: 90};
        answer(json(mailbox(after)));
        const {result} = await run(g=>handle_account_limits('12', {channel: 'email', daily: '200', set: '{"minSendingDelaySeconds":90}'}, ctx(), g));
        expect(result).toStrictEqual({channel: 'email', id: 12, limits: after});
        expect(sent()).toEqual([{method: 'PATCH', url: 'https://api/v3/email-accounts/12', body: {safety: {minSendingDelaySeconds: 90, dailyLimit: 200}}}]);
    });

    it('email: --set from stdin, and a field Reply\'s safety section does not have is a usage error before any call', async()=>{
        vi.spyOn(fs, 'readFileSync').mockReturnValueOnce('{"dailyLimit":300}');
        answer(json(mailbox({...SAFETY, dailyLimit: 300})));
        await run(g=>handle_account_limits('12', {channel: 'email', set: '-'}, ctx(), g));
        expect(sent()[0].body).toEqual({safety: {dailyLimit: 300}});
        mock_fetch.mockReset();
        expect(await fails(()=>handle_account_limits('12', {channel: 'email', set: '{"signature":"x"}'}, ctx(), {})))
            .toMatchObject({code: 'usage.limits', exit_code: 2});
        expect(await fails(()=>handle_account_limits('12', {channel: 'email', set: '{}'}, ctx(), {}))).toMatchObject({code: 'usage.limits'});
        expect(await fails(()=>handle_account_limits('12', {channel: 'email', daily: '-1'}, ctx(), {}))).toMatchObject({code: 'usage.range'});
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('linkedin: --set is Reply\'s limits update, then the account is read for the limits as they are', async()=>{
        const after = {...LIMITS, fixedMax: {dailySendMessageCount: 40}};
        answer(json(null, 204), json(linkedin({limits: after})));
        const {result} = await run(g=>handle_account_limits('34', {channel: 'linkedin', set: '{"fixedMax":{"dailySendMessageCount":40}}'}, ctx(), g));
        expect(result).toStrictEqual({channel: 'linkedin', id: 34, limits: after});
        expect(sent()).toEqual([
            {method: 'PUT', url: 'https://api/v3/linkedin-accounts/34/limits', body: {fixedMax: {dailySendMessageCount: 40}}},
            {method: 'GET', url: 'https://api/v3/linkedin-accounts/34', body: undefined},
        ]);
    });

    it('linkedin: a saved change whose read-back fails prints null and says so on stderr, not a failure', async()=>{
        answer(json(null, 204), json({code: 'linkedInAccount.notFound', status: 404}, 404));
        const {result, err} = await run(g=>handle_account_limits('34', {channel: 'linkedin', set: '{"limitsMode":"ranged"}'}, ctx(), g));
        expect(result).toStrictEqual({channel: 'linkedin', id: 34, limits: null});
        expect(err).toContain('The limits were saved, but reading them back failed (linkedin.account_not_found)');
    });

    it('linkedin: --daily is a usage error; a refusal with no CLI code of its own is reply.refused, Reply\'s code in reply_code', async()=>{
        expect(await fails(()=>handle_account_limits('34', {channel: 'linkedin', daily: '10'}, ctx(), {}))).toMatchObject({code: 'usage.limits'});
        expect(mock_fetch).not.toHaveBeenCalled();
        answer(json({code: 'linkedInAccount.invalidInput', status: 400, detail: 'actionDelayMaxSeconds must be at least 60 higher'}, 400));
        expect(await fails(()=>handle_account_limits('34', {channel: 'linkedin', set: '{"actionDelayMinSeconds":90}'}, ctx(), {})))
            .toMatchObject({code: 'reply.refused', reply_code: 'linkedInAccount.invalidInput', detail: 'actionDelayMaxSeconds must be at least 60 higher', status: 400, exit_code: 1});
    });
});

describe('account pause and resume', ()=>{
    it('read the state first and toggle only when it is not the one asked for', async()=>{
        answer(json(linkedin({status: 'enabled'})), json({status: 'disabled'}));
        expect((await run(g=>handle_account_pause('34', {channel: 'linkedin'}, ctx(), g))).result)
            .toStrictEqual({channel: 'linkedin', id: 34, status: 'inactive', reply_status: 'disabled', changed: true});
        expect(sent().map(r=>[r.method, r.url])).toEqual([['GET', 'https://api/v3/linkedin-accounts/34'],
            ['POST', 'https://api/v3/linkedin-accounts/34/toggle-status']]);

        mock_fetch.mockReset();
        answer(json(linkedin({status: 'disabled'})));
        expect((await run(g=>handle_account_pause('34', {channel: 'linkedin'}, ctx(), g))).result)
            .toStrictEqual({channel: 'linkedin', id: 34, status: 'inactive', reply_status: 'disabled', changed: false});
        expect(sent()).toHaveLength(1);

        mock_fetch.mockReset();
        answer(json(linkedin({status: 'disabled'})), json({status: 'enabled'}));
        expect((await run(g=>handle_account_resume('34', {channel: 'linkedin'}, ctx(), g))).result)
            .toStrictEqual({channel: 'linkedin', id: 34, status: 'active', reply_status: 'enabled', changed: true});

        // At its daily limit an account is on: resuming it changes nothing.
        mock_fetch.mockReset();
        answer(json(linkedin({status: 'dailyLimitReached'})));
        expect((await run(g=>handle_account_resume('34', {channel: 'linkedin'}, ctx(), g))).result)
            .toMatchObject({status: 'active', reply_status: 'dailyLimitReached', changed: false});
        expect(sent()).toHaveLength(1);
    });

    it('refuse a disconnected account, a state the CLI does not know, and a flip that went the other way', async()=>{
        answer(json(linkedin({status: 'cookieInvalid'})));
        expect(await fails(()=>handle_account_resume('34', {channel: 'linkedin'}, ctx(), {})))
            .toMatchObject({code: 'linkedin.invalid_cookie', exit_code: 1});
        mock_fetch.mockReset();
        answer(json(linkedin({status: 'suspended'})));
        expect(await fails(()=>handle_account_pause('34', {channel: 'linkedin'}, ctx(), {}))).toMatchObject({code: 'account.status_unknown'});
        expect(sent()).toHaveLength(1);
        mock_fetch.mockReset();
        answer(json(linkedin({status: 'enabled'})), json({status: 'enabled'}));
        expect(await fails(()=>handle_account_pause('34', {channel: 'linkedin'}, ctx(), {}))).toMatchObject({code: 'account.status_changed'});
    });

    it('email has no pause or resume: a usage error before any call; Reply\'s refusal of the toggle comes under the CLI\'s code', async()=>{
        expect(await fails(()=>handle_account_pause('12', {channel: 'email'}, ctx(), {}))).toMatchObject({code: 'usage.unsupported', exit_code: 2});
        expect(await fails(()=>handle_account_resume('12', {channel: 'email'}, ctx(), {})))
            .toMatchObject({code: 'usage.unsupported', hint: expect.stringContaining('account unblock')});
        expect(await fails(()=>handle_account_pause('12', {}, ctx(), {}))).toMatchObject({code: 'usage.channel'});
        expect(mock_fetch).not.toHaveBeenCalled();
        answer(json(linkedin({status: 'enabled'})), json({code: 'linkedInAccount.cookieInvalid', status: 400}, 400));
        expect(await fails(()=>handle_account_pause('34', {channel: 'linkedin'}, ctx(), {})))
            .toMatchObject({code: 'linkedin.invalid_cookie', reply_code: 'linkedInAccount.cookieInvalid', status: 400});
    });
});

describe('account unblock', ()=>{
    it('clears the provider\'s block on a mailbox', async()=>{
        answer(json(null, 204));
        expect((await run(g=>handle_account_unblock('4294967296', ctx(), g))).result).toStrictEqual({channel: 'email', id: 4294967296, unblocked: true});
        expect(sent()).toEqual([{method: 'POST', url: 'https://api/v3/email-accounts/4294967296/resume-sending', body: undefined}]);
        mock_fetch.mockReset();
        answer(json({code: 'emailAccount.notFound', status: 404}, 404));
        expect(await fails(()=>handle_account_unblock('12', ctx(), {}))).toMatchObject({code: 'email_account.not_found', reply_code: 'emailAccount.notFound', exit_code: 1});
    });
});

describe('account delete', ()=>{
    it('needs --yes: without it, a usage error before any call', async()=>{
        expect(await fails(()=>handle_account_delete('12', {channel: 'email'}, ctx(), {}))).toMatchObject({code: 'usage.confirm', exit_code: 2});
        expect(await fails(()=>handle_account_delete('34', {channel: 'linkedin', force: true}, ctx(), {}))).toMatchObject({code: 'usage.confirm'});
        expect(await fails(()=>handle_account_delete('12', {channel: 'email', yes: true, force: true}, ctx(), {})))
            .toMatchObject({code: 'usage.force', exit_code: 2});
        expect(await fails(()=>handle_account_delete('12', {yes: true}, ctx(), {}))).toMatchObject({code: 'usage.channel'});
        expect(mock_fetch).not.toHaveBeenCalled();
    });

    it('deletes by channel; --force adds Reply\'s force for LinkedIn only', async()=>{
        answer(json(null, 204), json(null, 204), json(null, 204));
        expect((await run(g=>handle_account_delete('12', {channel: 'email', yes: true}, ctx(), g))).result)
            .toStrictEqual({channel: 'email', id: 12, deleted: true});
        await run(g=>handle_account_delete('34', {channel: 'linkedin', yes: true}, ctx(), g));
        await run(g=>handle_account_delete('34', {channel: 'linkedin', yes: true, force: true}, ctx(), g));
        expect(sent().map(r=>[r.method, r.url])).toEqual([
            ['DELETE', 'https://api/v3/email-accounts/12'], ['DELETE', 'https://api/v3/linkedin-accounts/34'],
            ['DELETE', 'https://api/v3/linkedin-accounts/34?force=true'],
        ]);
    });

    it('an account sequences use is Reply\'s refusal, under the CLI\'s code; a failure of Reply\'s is outcome.unknown', async()=>{
        answer(json({code: 'linkedInAccount.accountInUse', status: 409}, 409));
        expect(await fails(()=>handle_account_delete('34', {channel: 'linkedin', yes: true}, ctx(), {})))
            .toMatchObject({code: 'linkedin.account_in_use', reply_code: 'linkedInAccount.accountInUse', exit_code: 1});
        mock_fetch.mockReset();
        answer(json('', 503));
        expect(await fails(()=>handle_account_delete('12', {channel: 'email', yes: true}, ctx(), {}))).toMatchObject({code: 'outcome.unknown', exit_code: 3});
    });
});
