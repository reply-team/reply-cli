import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_sequence_add_contact, resolve_step_position} from '../../operations/sequence-membership';

const SEQ = {id: 123, status: 'active', isArchived: false, steps: [
    {id: 10, parentId: null, type: 'email'},
    {id: 11, parentId: 10, type: 'email'},
]};
const run = (opts: Record<string, unknown>)=>capture(()=>handle_sequence_add_contact('123', opts, ctx(), {json: true}));

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('sequence add-contact', ()=>{
    it('a new contact: read the sequence, import, add; nothing read in between', async()=>{
        answer(json(SEQ), json({items: [{id: 456, status: 'created'}]}), json({added: [456], notProcessed: {}}));
        const {out} = await run({email: 'ann@acme.com', firstName: 'Ann'});
        expect(JSON.parse(out)).toEqual({status: 'added', sequence_id: 123, contact_id: 456, contact_created: true, sequence_active: true});
        expect(sent().map(r=>`${r.method} ${r.url}`)).toEqual([
            'GET https://api/v3/sequences/123',
            'POST https://api/v3/contacts/import',
            'POST https://api/v3/sequences/123/contact-links/bulk',
        ]);
        expect(sent()[2].body).toEqual({contactIds: [456], removeFromExisting: false, ignoreStepDelay: false});
    });

    it('an existing contact already in the sequence: nothing is written', async()=>{
        answer(json(SEQ), json({items: [{id: 456, status: 'updated'}]}), json({contactId: 456, statusInSequence: 'active'}));
        const {out} = await run({email: 'ann@acme.com'});
        expect(JSON.parse(out)).toMatchObject({status: 'already_in_sequence', contact_id: 456, contact_created: false});
        expect(sent().map(r=>r.url)).not.toContain('https://api/v3/sequences/123/contact-links/bulk');
    });

    it('a --contact-id not yet in the sequence is added', async()=>{
        answer(json(SEQ), json({code: 'sequenceContact.notInSequence'}, 404), json({added: [456], notProcessed: {}}));
        const {out} = await run({contactId: '456', ignoreStepDelay: true});
        expect(JSON.parse(out)).toMatchObject({status: 'added', contact_id: 456, contact_created: false});
        expect(sent()[2].body).toMatchObject({ignoreStepDelay: true});
    });

    it('a paused sequence: added, and sequence_active is false', async()=>{
        answer(json({...SEQ, status: 'paused'}), json({code: 'sequenceContact.notInSequence'}, 404), json({added: [456]}));
        const {out} = await run({contactId: '456'});
        expect(JSON.parse(out).sequence_active).toBe(false);
    });

    it('an archived sequence is refused before anything is written', async()=>{
        answer(json({...SEQ, isArchived: true}));
        await expect(run({email: 'ann@acme.com'})).rejects.toMatchObject({code: 'sequence.archived', ids: {sequence_id: 123}});
        expect(mock_fetch).toHaveBeenCalledTimes(1);
    });

    it('a refusal explained as opted out carries both ids', async()=>{
        answer(
            json(SEQ), json({items: [{id: 456, status: 'created'}]}),
            json({added: [], notProcessed: {'456': {error: 'invalidInput', errorDetails: 'Contact could not be added to sequence'}}}),
            json({contactId: 456, isOptedOut: true}),
        );
        await expect(run({email: 'ann@acme.com'})).rejects.toMatchObject({
            code: 'contact.opted_out', exit_code: 1, ids: {sequence_id: 123, contact_id: 456},
        });
    });

    it('any other refusal is reply.refused with Reply\'s own words', async()=>{
        answer(
            json(SEQ), json({items: [{id: 456, status: 'created'}]}),
            json({added: [], notProcessed: {'456': {error: 'invalidInput', errorDetails: 'Contact could not be added to sequence'}}}),
            json({contactId: 456, isOptedOut: false}),
        );
        await expect(run({email: 'ann@acme.com'})).rejects.toMatchObject({
            code: 'reply.refused', reply_code: 'invalidInput', detail: 'Contact could not be added to sequence',
        });
    });

    it('--start-step 2 starts at the second step of the chain', async()=>{
        answer(json(SEQ), json({code: 'sequenceContact.notInSequence'}, 404), json({added: [456]}));
        await run({contactId: '456', startStep: '2'});
        expect(sent()[2].body).toMatchObject({startStepId: 11});
    });

    it('a --start-step the chain can\'t answer is refused before the contact is touched', async()=>{
        answer(json(SEQ));
        await expect(run({email: 'ann@acme.com', startStep: '3'})).rejects.toMatchObject({code: 'sequence.step_not_found'});
        expect(mock_fetch).toHaveBeenCalledTimes(1);
    });

    it('a 503 on the add is outcome.unknown (exit 3), with the contact id', async()=>{
        answer(json(SEQ), json({items: [{id: 456, status: 'created'}]}), json('', 503));
        await expect(run({email: 'ann@acme.com'})).rejects.toMatchObject({
            code: 'outcome.unknown', exit_code: 3, ids: {sequence_id: 123, contact_id: 456},
        });
    });

    it('a 200 whose body is not an object is outcome.unknown, not a crash', async()=>{
        answer(json(SEQ), json({items: [{id: 456, status: 'created'}]}), json('<html>gateway</html>', 200));
        await expect(run({email: 'ann@acme.com'})).rejects.toMatchObject({code: 'outcome.unknown', exit_code: 3});
    });

    it('no steps in the sequence is sequence.has_no_steps', async()=>{
        answer(json({...SEQ, steps: []}), json({items: [{id: 456, status: 'created'}]}),
            json({code: 'sequenceContact.noStepsInSequence'}, 400));
        await expect(run({email: 'ann@acme.com'})).rejects.toMatchObject({code: 'sequence.has_no_steps'});
    });
});

describe('resolve_step_position', ()=>{
    const seq = (steps: unknown[])=>({steps});
    const code_of = (fn: () => unknown): string | undefined=>{
        try { fn(); } catch (e) { return (e as {code?: string}).code; }
        return undefined;
    };
    it('walks the chain from the step with no parent', ()=>{
        expect(resolve_step_position(seq([{id: 11, parentId: 10}, {id: 10, parentId: null}]), 1)).toBe(10);
        expect(resolve_step_position(seq([{id: 11, parentId: 10}, {id: 10, parentId: null}]), 2)).toBe(11);
    });
    it('refuses a fork, a condition, two roots and a position past the end', ()=>{
        const fork = [{id: 1, parentId: null}, {id: 2, parentId: 1}, {id: 3, parentId: 1}];
        const cond = [{id: 1, parentId: null, type: 'condition'}, {id: 2, parentId: 1}];
        const roots = [{id: 1, parentId: null}, {id: 2, parentId: null}];
        for (const [steps, n] of [[fork, 2], [cond, 2], [roots, 1], [[{id: 1, parentId: null}], 2], [[], 1]] as const)
        {
            expect(code_of(()=>resolve_step_position(seq(steps as unknown[]), n))).toBe('sequence.step_not_found');
        }
    });
});
