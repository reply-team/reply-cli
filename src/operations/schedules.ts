import {Operation_error} from '../utils/errors';
import {call_reply, refusal, unreadable, is_object, open_session} from './call';
import {print_result} from './result';
import type {Op_globals} from './options';
import type {Cli_context} from '../context';

type Range = {from: string | null; to: string | null};
type Day = {week_day: string | null; active: boolean; ranges: Range[]};
type Schedule = {
    id: number; name: string | null; time_zone_id: string | null; use_recipient_time_zone: boolean; exclude_holidays: boolean;
    is_default: boolean; main_timings: Day[]; use_follow_up_schedule: boolean; follow_up_timings: Day[] | null;
    reply_status: string | null;
};

const text_or_null = (v: unknown): string | null=>(typeof v === 'string' && v.trim() !== '' ? v : null);

const two = (n: number): string=>String(n).padStart(2, '0');

// A time of day as HH:MM, from Reply's {hour, minute}. A range may end at 24:00, the end of the
// day; anything else that is not a time of day is null rather than a guess.
const clock = (v: unknown): string | null=>{
    if (!is_object(v) || !Number.isInteger(v.hour) || !Number.isInteger(v.minute))
    {
        return null;
    }
    const hour = v.hour as number;
    const minute = v.minute as number;
    const valid = minute >= 0 && minute < 60 && hour >= 0 && (hour < 24 || (hour === 24 && minute === 0));
    return valid ? `${two(hour)}:${two(minute)}` : null;
};

// Reply's timings, one entry a weekday, in Reply's order. Reply names the day as .NET does
// (`Monday`); the CLI writes it in lower case.
const timings_of = (v: unknown): Day[]=>
    (Array.isArray(v) ? v : []).filter(is_object).map(day=>({
        week_day: typeof day.weekDay === 'string' && day.weekDay !== '' ? day.weekDay.toLowerCase() : null,
        active: day.isActive === true,
        ranges: (Array.isArray(day.timeRanges) ? day.timeRanges : []).filter(is_object).map(r=>({from: clock(r.fromTime), to: clock(r.toTime)})),
    }));

const schedule_of = (entry: unknown): Schedule=>{
    if (!is_object(entry) || typeof entry.id !== 'number' || !Number.isSafeInteger(entry.id) || entry.id <= 0)
    {
        throw new Operation_error('reply.unavailable', 'Reply listed a schedule without a usable id.', {status: 200});
    }
    return {
        id: entry.id,
        name: text_or_null(entry.name),
        // A Windows time zone identifier (`Eastern Standard Time`), as Reply holds it.
        time_zone_id: text_or_null(entry.timezoneId),
        use_recipient_time_zone: entry.useProspectTimezone === true,
        exclude_holidays: entry.excludeHolidays === true,
        is_default: entry.isDefault === true,
        main_timings: timings_of(entry.mainTimings),
        use_follow_up_schedule: entry.useFollowUpSchedule === true,
        follow_up_timings: Array.isArray(entry.followUpTimings) ? timings_of(entry.followUpTimings) : null,
        // Reply's own word for how the schedule is used (`inCurrentUserSequence`, ...).
        reply_status: typeof entry.status === 'string' && entry.status !== '' ? entry.status : null,
    };
};

// Reply gives every schedule in one answer, with no paging.
const handle_schedule_list = async(ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const s = await open_session(ctx, g);
    const a = await call_reply(s, 'GET', '/v3/schedules', 'read');
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    if (!Array.isArray(a.data))
    {
        throw unreadable(a, 'read');
    }
    print_result({items: a.data.map(schedule_of)}, g);
};

export {handle_schedule_list};
