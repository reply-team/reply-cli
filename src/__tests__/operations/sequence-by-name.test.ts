import fs from 'fs';
import os from 'os';
import path from 'path';
import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_sequence_list, handle_sequence_create} from '../../operations/sequence-by-name';

const NAME = 'Q4 Outreach';
const stdin = (value: unknown)=>()=>(typeof value === 'string' ? value : JSON.stringify(value));
const shown = (e: unknown): string=>{
    const err = e as {message?: string; title?: string; hint?: string; detail?: string};
    return [err.message, err.title, err.hint, err.detail].join(' ');
};
const list = (source: string | undefined, input?: unknown)=>
    capture(()=>handle_sequence_list({name: source}, ctx(), {json: true}, input === undefined ? undefined : stdin(input)));
const create = (source: string | undefined, input?: unknown)=>
    capture(()=>handle_sequence_create({name: source}, ctx(), {json: true}, input === undefined ? undefined : stdin(input)));
const page_url = (skip: number)=>
    `https://api/v3/sequences?name=Q4%20Outreach&sortBy=created&sortDirection=asc&top=1000&skip=${skip}`;
const sequence = (id: number, name: string, more: Record<string, unknown> = {})=>
    ({id, ownerUserId: 42, name, created: '2026-10-01T10:00:00+00:00', status: 'new', isArchived: false, health: 'healthy', ...more});
const lost_connection = ()=>Object.assign(new TypeError('fetch failed'),
    {cause: Object.assign(new Error('ECONNRESET'), {code: 'ECONNRESET'})});

// Refuses a name given any way but stdin, with no call and the name never repeated.
const refuses_argv = async(run: (source: string | undefined) => Promise<unknown>, code: string)=>{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-seq-'));
    const file = path.join(dir, 'n.json');
    fs.writeFileSync(file, JSON.stringify({name: NAME}));
    try {
        for (const source of [JSON.stringify({name: NAME}), `@${file}`, undefined])
        {
            const e = await run(source).catch(x=>x);
            expect(e, String(source)).toMatchObject({code, exit_code: 2});
            expect(shown(e), String(source)).not.toContain(NAME);
        }
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
    expect(mock_fetch).not.toHaveBeenCalled();
};

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('sequence list --name', ()=>{
    it('asks Reply\'s name search oldest first, a thousand at a time, and keeps only the names equal to the one asked, whatever the case', async()=>{
        answer(json({items: [
            sequence(1, 'Q4 outreach'),
            sequence(2, 'Q4 Outreach (copy)'),
            sequence(3, 'q4 OUTREACH', {status: 'paused', isArchived: true, created: '2026-10-02T09:30:00+00:00'}),
        ], hasMore: false}));
        const {out} = await list('-', {name: NAME});
        expect(JSON.parse(out)).toEqual({items: [
            {id: 1, name: 'Q4 outreach', status: 'new', is_archived: false, created_at: '2026-10-01T10:00:00+00:00'},
            {id: 3, name: 'q4 OUTREACH', status: 'paused', is_archived: true, created_at: '2026-10-02T09:30:00+00:00'},
        ]});
        expect(sent()).toEqual([{method: 'GET', url: page_url(0), body: undefined}]);
    });

    it('reads the list to its end', async()=>{
        answer(json({items: [sequence(1, 'Q4 Outreach v2')], hasMore: true}), json({items: [sequence(2, NAME)], hasMore: false}));
        const {out} = await list('-', {name: NAME});
        expect(JSON.parse(out).items.map((i: {id: number})=>i.id)).toEqual([2]);
        expect(sent().map(r=>r.url)).toEqual([page_url(0), page_url(1000)]);
    });

    it('answers an empty list when no sequence carries the name', async()=>{
        answer(json({items: [], hasMore: false}));
        const {out} = await list('-', {name: NAME});
        expect(JSON.parse(out)).toEqual({items: []});
    });

    it('a match Reply gives no status, archive flag or date carries null for it', async()=>{
        answer(json({items: [{id: 1, name: NAME}], hasMore: false}));
        const {out} = await list('-', {name: NAME});
        expect(JSON.parse(out)).toEqual({items: [{id: 1, name: NAME, status: null, is_archived: null, created_at: null}]});
    });

    it('twenty pages without an end is sequence.list_incomplete, never a partial answer', async()=>{
        for (let i = 0; i < 20; i++)
        {
            answer(json({items: [sequence(i + 1, `${NAME} ${i}`)], hasMore: true}));
        }
        await expect(list('-', {name: NAME})).rejects.toMatchObject({code: 'sequence.list_incomplete', exit_code: 1});
        expect(mock_fetch).toHaveBeenCalledTimes(20);
    });

    it('a page, or a match, that can\'t be read is reply.unavailable', async()=>{
        answer(json({items: []}));
        await expect(list('-', {name: NAME})).rejects.toMatchObject({code: 'reply.unavailable'});
        answer(json({items: [{id: 'x', name: NAME}], hasMore: false}));
        await expect(list('-', {name: NAME})).rejects.toMatchObject({code: 'reply.unavailable'});
    });

    it('takes the name from stdin only: inline JSON, @file or no flag is usage.name, with no call and the name not repeated', async()=>{
        await refuses_argv(source=>list(source), 'usage.name');
    });

    it('refuses a blank or non-string name, or another field, with no call', async()=>{
        for (const input of [{name: '  '}, {name: 7}, {}, {name: NAME, status: 'new'}, '[]', 'not json'])
        {
            const e = await list('-', input).catch(x=>x);
            expect(e, JSON.stringify(input)).toMatchObject({code: 'usage.name', exit_code: 2});
            expect(shown(e), JSON.stringify(input)).not.toContain(NAME);
        }
        expect(mock_fetch).not.toHaveBeenCalled();
    });
});

describe('sequence create --name', ()=>{
    const PLACEHOLDER = {
        type: 'task', actionType: 'toDo', delayInMinutes: 0,
        description: 'Added because a sequence needs one step to exist; replace it before this sequence is ever started.',
    };

    it('makes the draft with its one task step, and answers its id and state', async()=>{
        answer(json(sequence(123, NAME), 201));
        const {out} = await create('-', {name: NAME});
        expect(JSON.parse(out)).toEqual({sequence_id: 123, steps_added: 1, status: 'new', is_archived: false});
        expect(sent()).toEqual([{method: 'POST', url: 'https://api/v3/sequences', body: {name: NAME, steps: [PLACEHOLDER]}}]);
    });

    it('a 5xx, a lost answer, or a 2xx without a readable id is outcome.unknown (exit 3), posted once, and the hint says a '
        + 'repeat may make a second one', async()=>{
        for (const outcome of [()=>json('', 503), ()=>json({code: 'x'}, 502), ()=>json({}, 201), ()=>json('not json', 200), 'lost'])
        {
            mock_fetch.mockReset();
            if (outcome === 'lost')
            {
                mock_fetch.mockRejectedValueOnce(lost_connection());
            }
            else
            {
                answer(outcome());
            }
            const e = await create('-', {name: NAME}).catch(x=>x);
            expect(e, String(outcome)).toMatchObject({code: 'outcome.unknown', exit_code: 3});
            expect(e.hint, String(outcome)).toContain('second');
            expect(e.hint, String(outcome)).toContain('sequence list --name -');
            expect(e.hint, String(outcome)).not.toContain('safe to re-run');
            expect(mock_fetch, String(outcome)).toHaveBeenCalledTimes(1);
        }
    });

    it('a 400 that names fields is reply.invalid_request, and a 403 is access.feature_unavailable', async()=>{
        answer(json({status: 400, errors: [{pointer: '/name', detail: 'Name is required.'}]}, 400));
        await expect(create('-', {name: NAME})).rejects.toMatchObject({code: 'reply.invalid_request', details: {fields: ['name']}});
        answer(json({code: 'sequence.forbidden'}, 403));
        await expect(create('-', {name: NAME})).rejects.toMatchObject({code: 'access.feature_unavailable'});
    });

    it('takes the name from stdin only: inline JSON, @file or no flag is usage.name, with no call and the name not repeated', async()=>{
        await refuses_argv(source=>create(source), 'usage.name');
    });
});
