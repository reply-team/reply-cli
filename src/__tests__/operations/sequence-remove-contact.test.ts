import {describe, it, expect, beforeEach} from 'vitest';
import {mock_fetch, json, ctx, sent, answer, capture} from './helpers';
import {handle_sequence_remove_contact} from '../../operations/sequence-membership';

const run = (opts: Record<string, unknown>)=>capture(()=>handle_sequence_remove_contact('123', opts, ctx(), {json: true}));
const NOT_IN = {code: 'sequenceContact.notInSequence'};

beforeEach(()=>{ mock_fetch.mockReset(); });

describe('sequence remove-contact', ()=>{
    it('removes a contact taking part', async()=>{
        answer(json({contactId: 456, statusInSequence: 'active'}), json(undefined, 204));
        const {out} = await run({contactId: '456'});
        expect(JSON.parse(out)).toEqual({status: 'removed', sequence_id: 123, contact_id: 456});
        expect(sent().map(r=>`${r.method} ${r.url}`)).toEqual([
            'GET https://api/v3/sequences/123/contacts/456',
            'DELETE https://api/v3/sequences/123/contact-links/456',
        ]);
    });

    it('a finished participation is left alone: not_in_sequence, nothing written', async()=>{
        answer(json({contactId: 456, statusInSequence: 'finished'}));
        const {out} = await run({contactId: '456'});
        expect(JSON.parse(out).status).toBe('not_in_sequence');
        expect(mock_fetch).toHaveBeenCalledTimes(1);
    });

    it('not in the sequence, and the sequence exists: not_in_sequence', async()=>{
        answer(json(NOT_IN, 404), json({id: 123, status: 'active'}));
        const {out} = await run({contactId: '456'});
        expect(JSON.parse(out).status).toBe('not_in_sequence');
        expect(sent().map(r=>r.method)).toEqual(['GET', 'GET']);
    });

    it('a sequence that doesn\'t exist is sequence.not_found, not a successful stop', async()=>{
        answer(json(NOT_IN, 404), json({code: 'sequence.notFound'}, 404));
        await expect(run({contactId: '456'})).rejects.toMatchObject({code: 'sequence.not_found', ids: {sequence_id: 123, contact_id: 456}});
    });

    it('finds the contact by email, and never creates one', async()=>{
        answer(json({items: [], hasMore: false}));
        const {out} = await run({email: 'ann@example.com'});
        expect(JSON.parse(out)).toEqual({status: 'not_in_sequence', sequence_id: 123, contact_id: null});
        expect(sent().map(r=>r.url)).toEqual(['https://api/v3/contacts/filter?top=100&skip=0']);
    });

    it('a 404 on the DELETE (left in between) is not_in_sequence', async()=>{
        answer(json({statusInSequence: 'active'}), json(NOT_IN, 404));
        const {out} = await run({contactId: '456'});
        expect(JSON.parse(out).status).toBe('not_in_sequence');
    });

    it('a 404 whose code this version doesn\'t know is not read as "not in the sequence"', async()=>{
        answer(json({code: 'something.else'}, 404));
        await expect(run({contactId: '456'})).rejects.toMatchObject({code: 'reply.refused', reply_code: 'something.else'});
        expect(mock_fetch).toHaveBeenCalledTimes(1);
    });

    it('a 404 on the DELETE that names the sequence is sequence.not_found', async()=>{
        answer(json({statusInSequence: 'active'}), json({code: 'sequenceContact.sequenceNotFound'}, 404));
        await expect(run({contactId: '456'})).rejects.toMatchObject({code: 'sequence.not_found'});
    });

    it('a 500 on the DELETE is outcome.unknown (exit 3)', async()=>{
        answer(json({statusInSequence: 'active'}), json('', 500));
        await expect(run({contactId: '456'})).rejects.toMatchObject({code: 'outcome.unknown', exit_code: 3});
    });
});
