import {Operation_error, type Ids} from '../utils/errors';
import {call_reply, expect_object, refusal, reply_code_of, detail_of, open_session, type Answer} from './call';
import {parse_id, parse_int_in, type Op_globals} from './options';
import {read_sequence, count_contacts, require_count, sequence_not_found, sequence_archived} from './sequence-read';
import {print_result, with_ids} from './result';
import type {Cli_context} from '../context';

// What a pause or a start answered when it did not do it.
const action_refusal = (id: number, a: Answer, refused_code: string, refused_title: string): Operation_error=>{
    const code = reply_code_of(a);
    if (a.status === 404)
    {
        return sequence_not_found(id, a);
    }
    if (code === 'sequenceAction.archived')
    {
        return sequence_archived(id, a);
    }
    if (code === 'sequenceAction.activationInProgress')
    {
        return new Operation_error('sequence.busy', 'Reply is still activating this sequence; try again shortly.', {
            status: a.status, reply_code: code,
        });
    }
    if (a.status === 400 || a.status === 409)
    {
        return new Operation_error(refused_code, refused_title, {status: a.status, reply_code: code, detail: detail_of(a)});
    }
    return refusal(a, 'write');
};

const handle_sequence_pause = async(id_arg: string, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const id = parse_id(id_arg, 'Sequence id');
    const s = await open_session(ctx, g);
    try {
        // No read first: Reply answers an already-paused sequence with a 200 and changes nothing.
        const a = await call_reply(s, 'POST', `/v3/sequences/${id}/pause`, 'write');
        if (a.status !== 200)
        {
            throw action_refusal(id, a, 'sequence.not_pausable', 'Reply will not pause this sequence.');
        }
        expect_object(a, 'write');
        print_result({status: 'paused', sequence_id: id}, g);
    } catch (e) {
        throw with_ids(e, {sequence_id: id});
    }
};

const handle_sequence_start = async(
    id_arg: string, opts: {expectContacts?: string}, ctx: Cli_context, g: Op_globals,
): Promise<void>=>{
    const id = parse_id(id_arg, 'Sequence id');
    const expected = opts.expectContacts === undefined ? undefined : parse_int_in(opts.expectContacts, '--expect-contacts', 0, 10000000, 0);
    const s = await open_session(ctx, g);
    const ids: Ids = {sequence_id: id};
    try {
        let contacts: number | null = null;
        let previous_status: string | null = null;
        if (expected !== undefined)
        {
            // The approval guard: start only if the sequence still holds the number of people that
            // was approved. The state is read first, so a repeat after a start that already landed
            // answers already_active instead of failing on a count that has moved since.
            const sequence = await read_sequence(s, id);
            if (sequence.isArchived === true)
            {
                throw sequence_archived(id);
            }
            // Reply's start answers the sequence as it is afterwards, so only this read can say
            // whether the start was a first start or a resume.
            previous_status = typeof sequence.status === 'string' ? sequence.status : null;
            if (sequence.status === 'active')
            {
                // Nothing left to guard: the count is reported where Reply gives it, and not needed.
                print_result({status: 'already_active', sequence_id: id, previous_status, contacts: await count_contacts(s, id)}, g);
                return;
            }
            const count = await require_count(s, id);
            if (count !== expected)
            {
                throw new Operation_error('sequence.contact_count_changed',
                    `The sequence holds ${count} contacts, not the ${expected} expected, so nothing was started.`,
                    {status: 200, details: {expected, actual: count}});
            }
            contacts = count;
        }
        // Reply answers an already-active sequence with a 200 and changes nothing.
        const a = await call_reply(s, 'POST', `/v3/sequences/${id}/start`, 'write');
        if (a.status !== 200)
        {
            throw action_refusal(id, a, 'sequence.not_startable', 'Reply will not start this sequence.');
        }
        expect_object(a, 'write');
        print_result({status: 'started', sequence_id: id, previous_status, contacts}, g);
    } catch (e) {
        throw with_ids(e, ids);
    }
};

export {handle_sequence_pause, handle_sequence_start};
