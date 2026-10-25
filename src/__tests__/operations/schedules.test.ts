import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_schedule_list} from '../../operations/schedules';

const day = (weekDay: unknown, isActive: unknown, ...ranges: [number, number, number, number][])=>({
    weekDay, isActive,
    timeRanges: ranges.map(([fh, fm, th, tm])=>({fromTime: {hour: fh, minute: fm}, toTime: {hour: th, minute: tm}})),
});
const schedule = (over: Record<string, unknown> = {})=>({
    id: 41, name: 'Business hours', timezoneId: 'Eastern Standard Time', excludeHolidays: false, useProspectTimezone: false,
    useFollowUpSchedule: false, mainTimings: [day('Monday', true, [9, 0, 17, 0])], followUpTimings: [], isDefault: true,
    status: 'isDefaultForCurrentUser', ...over,
});

const list = async()=>
    JSON.parse((await capture(()=>handle_schedule_list(ctx(), {json: true}))).out) as {items: Record<string, unknown>[]};
const failure = ()=>handle_schedule_list(ctx(), {}).catch((x: unknown)=>x);

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('schedule list', ()=>{
    it('lists every schedule in one read, in Reply\'s order, each with its time zone and its windows by weekday', async()=>{
        answer(json([
            schedule({
                id: 57, name: 'Madrid mornings', timezoneId: 'Romance Standard Time', useProspectTimezone: true, isDefault: false,
                mainTimings: [day('Friday', true, [8, 30, 12, 0], [13, 0, 14, 5])], useFollowUpSchedule: true,
                followUpTimings: [day('Saturday', false)], status: 'inCurrentUserSequence',
            }),
            schedule({excludeHolidays: true}),
        ]));
        expect(await list()).toStrictEqual({items: [
            {id: 57, name: 'Madrid mornings', time_zone_id: 'Romance Standard Time', use_recipient_time_zone: true, exclude_holidays: false,
                is_default: false,
                main_timings: [{week_day: 'friday', active: true, ranges: [{from: '08:30', to: '12:00'}, {from: '13:00', to: '14:05'}]}],
                use_follow_up_schedule: true, follow_up_timings: [{week_day: 'saturday', active: false, ranges: []}],
                reply_status: 'inCurrentUserSequence'},
            {id: 41, name: 'Business hours', time_zone_id: 'Eastern Standard Time', use_recipient_time_zone: false, exclude_holidays: true,
                is_default: true, main_timings: [{week_day: 'monday', active: true, ranges: [{from: '09:00', to: '17:00'}]}],
                use_follow_up_schedule: false, follow_up_timings: [], reply_status: 'isDefaultForCurrentUser'},
        ]});
        expect(sent()).toEqual([{method: 'GET', url: 'https://api/v3/schedules', body: undefined}]);
    });

    it('an account with no schedules is an empty list', async()=>{
        answer(json([]));
        expect(await list()).toStrictEqual({items: []});
    });

    it('a name or time zone Reply leaves out or gives blank, or a state word it leaves out or gives empty, is null, and a flag it does not give as true is false', async()=>{
        answer(json([
            schedule({name: ' ', timezoneId: '', status: '', isDefault: undefined, excludeHolidays: 'true', useProspectTimezone: 1}),
            schedule({id: 42, name: undefined, timezoneId: null, status: undefined, useFollowUpSchedule: null}),
            schedule({id: 43, name: 'Weekends', timezoneId: 'UTC', status: ' ', isDefault: false}),
        ]));
        expect((await list()).items.map(i=>[i.name, i.time_zone_id, i.reply_status, i.is_default, i.exclude_holidays,
            i.use_recipient_time_zone, i.use_follow_up_schedule])).toEqual([
            [null, null, null, false, false, false, false],
            [null, null, null, true, false, false, false],
            ['Weekends', 'UTC', ' ', false, false, false, false],
        ]);
    });

    it('a name or time zone is kept exactly as Reply gives it when it is not blank', async()=>{
        answer(json([schedule({name: ' Late shift ', timezoneId: 'UTC'})]));
        expect((await list()).items.map(i=>[i.name, i.time_zone_id])).toEqual([[' Late shift ', 'UTC']]);
    });

    it('follow-up windows Reply does not give as a list are null, and a day or range it gives unreadably is kept without a guess', async()=>{
        answer(json([schedule({
            followUpTimings: null,
            mainTimings: [
                day('SUNDAY', 'yes'),
                day('Tuesday', true, [18, 0, 24, 0], [23, 0, 24, 30], [-1, 0, 9, 60]),
                {weekDay: 7, isActive: true, timeRanges: 'all day'},
                {isActive: true, timeRanges: [{fromTime: '09:00', toTime: {hour: 25, minute: 0}}, {fromTime: {hour: 9.5, minute: 0}, toTime: null}]},
                'not a day',
            ],
        })]));
        const [item] = (await list()).items;
        expect(item.follow_up_timings).toBeNull();
        expect(item.main_timings).toStrictEqual([
            {week_day: 'sunday', active: false, ranges: []},
            {week_day: 'tuesday', active: true, ranges: [{from: '18:00', to: '24:00'}, {from: '23:00', to: null}, {from: null, to: null}]},
            {week_day: null, active: true, ranges: []},
            {week_day: null, active: true, ranges: [{from: null, to: null}, {from: null, to: null}]},
        ]);
    });

    it('a schedule without a usable id is reply.unavailable, never a guess', async()=>{
        for (const entry of [schedule({id: '41'}), schedule({id: undefined}), schedule({id: 0}), schedule({id: 1.5}), 'not a schedule'])
        {
            mock_fetch.mockReset();
            answer(json([entry]));
            await expect(failure(), JSON.stringify(entry)).resolves.toMatchObject({code: 'reply.unavailable', exit_code: 1});
        }
    });

    it('a refused or unreadable read is the house refusal', async()=>{
        const cases: [Response, string][] = [
            [json({code: 'schedule.forbidden', title: 'Forbidden'}, 403), 'access.feature_unavailable'],
            // v3's own scope check answers a 403 with no code.
            [json({title: 'Forbidden'}, 403), 'access.feature_unavailable'],
            [json({title: 'Unauthorized'}, 401), 'access.denied'],
            [json('', 503), 'reply.unavailable'],
            [json({items: []}), 'reply.unavailable'],
        ];
        for (const [response, code] of cases)
        {
            mock_fetch.mockReset();
            answer(response);
            await expect(failure(), code).resolves.toMatchObject({code, exit_code: 1});
        }
        mock_fetch.mockReset();
        answer(json({code: 'schedule.forbidden'}, 403));
        await expect(failure()).resolves.toMatchObject({status: 403, reply_code: 'schedule.forbidden'});
    });
});
