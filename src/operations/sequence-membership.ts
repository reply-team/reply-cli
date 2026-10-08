import {Operation_error, type Ids} from '../utils/errors';
import {
    call_reply, expect_object, is_object, is_reply_id, item_failure, refusal, reply_code_of, detail_of, unreadable,
    open_session, type Answer, type Item_failure, type Op_session,
} from './call';
import type {Call_kind} from '../utils/client';
import {parse_id, parse_int_in, parse_idempotency_key, type Op_globals} from './options';
import {read_contact_input, type Contact_flags} from './contact-input';
import {ensure_contact, find_contact, read_opted_out} from './contacts';
import {read_sequence, sequence_not_found, sequence_archived} from './sequence-read';
import {print_result, with_ids} from './result';
import type {Cli_context} from '../context';

type Add_contact_opts = Contact_flags & {startStep?: string; ignoreStepDelay?: boolean; idempotencyKey?: string};

const step_not_found = (position: number, why: string): Operation_error=>
    new Operation_error('sequence.step_not_found', `There is no step ${position} to start at: ${why}.`, {status: 200});

// INTERIM (API gap): a sequence's steps carry no order field. GET /v3/sequences/{id} returns them
// as a graph of parentId links, with the order shown only in display names like "1" and "3.1",
// and no endpoint maps a position to a step id.
// Needed: a step order field, or a position→id lookup.
// Workaround: walk the chain from the one step without a parent and take the Nth link. Refuse
// wherever the answer would be a guess: a fork, a condition, a position past the end.
const resolve_step_position = (sequence: Record<string, unknown>, position: number): number=>{
    const steps = Array.isArray(sequence.steps) ? sequence.steps.filter(is_object) : [];
    if (steps.length === 0)
    {
        throw step_not_found(position, 'the sequence has no steps');
    }
    const roots = steps.filter(step=>step.parentId === null || step.parentId === undefined);
    if (roots.length !== 1)
    {
        throw step_not_found(position, `its steps have ${roots.length} starting points, so they are not one chain`);
    }
    let at = roots[0];
    for (let index = 1; index <= steps.length; index++)
    {
        if (typeof at.type === 'string' && at.type.toLowerCase() === 'condition')
        {
            throw step_not_found(position, `step ${index} is a condition, so the steps after it branch`);
        }
        if (index === position)
        {
            if (!is_reply_id(at.id))
            {
                throw step_not_found(position, `step ${position} carries no id`);
            }
            return at.id;
        }
        const current = at;
        const next = steps.filter(step=>step.parentId === current.id);
        if (next.length === 0)
        {
            throw step_not_found(position, `the chain ends at step ${index}`);
        }
        if (next.length > 1)
        {
            throw step_not_found(position, `step ${index} is followed by ${next.length} steps`);
        }
        at = next[0];
    }
    throw step_not_found(position, 'its steps lead back into one another');
};

// INTERIM (API gap): POST /v3/sequences/{id}/contact-links/bulk never says that a contact is
// already in the sequence. For one who is, it acts as a forward-only move: a start step ahead of
// theirs answers "added" and moves them there, skipping the steps between; the same or an earlier
// step is refused with the generic invalidInput, and even then can reassign their email account.
// Needed: a per-item "already in sequence" answer, and a no-op for a contact who is already in.
// Workaround: for a contact that existed before this call, read its participation first and write
// nothing when it is there. It costs one extra read per add of an existing contact.
const participation_before_add = async(s: Op_session, sequence_id: number, contact_id: number): Promise<boolean>=>{
    const a = await call_reply(s, 'GET', `/v3/sequences/${sequence_id}/contacts/${contact_id}`, 'read');
    if (a.status === 404)
    {
        return false;
    }
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    expect_object(a, 'read');
    return true;
};

// INTERIM (API gap): every per-item refusal of POST /v3/sequences/{id}/contact-links/bulk is the
// same invalidInput, "Contact could not be added to sequence", whether the contact is opted out,
// over a limit, or anything else. Opted-out contacts are skipped this way without a word.
// Needed: real per-item reasons (opted out, already in the sequence, limits).
// Workaround: after a refusal, read the contact's statuses once. Opted out → contact.opted_out;
// anything else → reply.refused, carrying Reply's own words.
const explain_not_added = async(s: Op_session, contact_id: number, refused: Item_failure): Promise<Operation_error>=>{
    if (await read_opted_out(s, contact_id))
    {
        return new Operation_error('contact.opted_out', `Contact ${contact_id} is opted out, so Reply did not add them to the sequence.`, {status: 200});
    }
    return new Operation_error('reply.refused', 'Reply did not add the contact to the sequence.', {
        status: 200, reply_code: refused.error ?? undefined, detail: refused.details ?? undefined,
    });
};

const add_to_sequence = async(
    s: Op_session, sequence_id: number, contact_id: number, o: {start_step_id?: number; ignore_step_delay: boolean},
): Promise<void>=>{
    const body: Record<string, unknown> = {
        contactIds: [contact_id],
        // Always sent, never left to Reply's default: true would take the person out of every other
        // sequence they are in, which nobody asked for.
        removeFromExisting: false,
        ignoreStepDelay: o.ignore_step_delay,
    };
    if (o.start_step_id !== undefined)
    {
        body.startStepId = o.start_step_id;
    }
    const a = await call_reply(s, 'POST', `/v3/sequences/${sequence_id}/contact-links/bulk`, 'write', body);
    if (a.status === 404)
    {
        throw sequence_not_found(sequence_id, a);
    }
    if (a.status === 400 && reply_code_of(a) === 'sequenceContact.noStepsInSequence')
    {
        throw new Operation_error('sequence.has_no_steps', `Sequence ${sequence_id} has no step to send.`, {status: 400, reply_code: reply_code_of(a)});
    }
    if (a.status === 400 && reply_code_of(a) === 'sequenceContact.contactLimitExceeded')
    {
        throw new Operation_error('account.contact_limit_reached', 'The account is at its plan\'s limit.', {
            status: 400, reply_code: reply_code_of(a), detail: detail_of(a),
        });
    }
    if (a.status !== 200)
    {
        throw refusal(a, 'write');
    }
    const answer = expect_object(a, 'write');
    if (Array.isArray(answer.added) && answer.added.includes(contact_id))
    {
        return;
    }
    const refused = item_failure(answer.notProcessed, contact_id);
    if (refused === undefined)
    {
        throw unreadable(a, 'write');
    }
    throw await explain_not_added(s, contact_id, refused);
};

const handle_sequence_add_contact = async(
    id_arg: string, opts: Add_contact_opts, ctx: Cli_context, g: Op_globals, read_stdin?: () => string,
): Promise<void>=>{
    const sequence_id = parse_id(id_arg, 'Sequence id');
    const contact = read_contact_input(opts, read_stdin);
    const start_step = opts.startStep === undefined ? undefined : parse_int_in(opts.startStep, '--start-step', 1, 10000, 1);
    parse_idempotency_key(opts.idempotencyKey);
    const s = await open_session(ctx, g);
    const ids: Ids = {sequence_id};
    try {
        const sequence = await read_sequence(s, sequence_id);
        if (sequence.isArchived === true)
        {
            throw sequence_archived(sequence_id);
        }
        const start_step_id = start_step === undefined ? undefined : resolve_step_position(sequence, start_step);
        const ensured = await ensure_contact(s, contact);
        ids.contact_id = ensured.id;
        const result = (status: string)=>({
            status, sequence_id, contact_id: ensured.id, contact_created: ensured.created,
            sequence_active: sequence.status === 'active',
        });
        if (!ensured.created && await participation_before_add(s, sequence_id, ensured.id))
        {
            print_result(result('already_in_sequence'), g);
            return;
        }
        await add_to_sequence(s, sequence_id, ensured.id, {start_step_id, ignore_step_delay: opts.ignoreStepDelay === true});
        print_result(result('added'), g);
    } catch (e) {
        throw with_ids(e, ids);
    }
};

type Remove_contact_opts = Contact_flags & {idempotencyKey?: string};

const NOT_TAKING_PART = ['sequencecontact.notinsequence', 'contact.notfound'];
const SEQUENCE_MISSING = ['sequence.notfound', 'sequencecontact.sequencenotfound'];

// A 404 on a call that names both the sequence and the contact. Only the codes that mean the
// person takes no part are read that way: a missing sequence, or a code this version doesn't know,
// ends the command rather than being taken for a completed stop.
const require_not_taking_part = (sequence_id: number, a: Answer, kind: Call_kind): void=>{
    const code = reply_code_of(a)?.toLowerCase();
    if (code !== undefined && NOT_TAKING_PART.includes(code))
    {
        return;
    }
    if (code !== undefined && SEQUENCE_MISSING.includes(code))
    {
        throw sequence_not_found(sequence_id, a);
    }
    throw refusal(a, kind);
};

// INTERIM (API gap): GET /v3/sequences/{id}/contacts/{contact_id} and the DELETE answer one and
// the same 404, sequenceContact.notInSequence, whether the sequence doesn't exist, the contact
// doesn't exist, or the contact just isn't in it.
// Needed: distinct 404 codes for a missing sequence and a missing contact.
// Workaround: after that 404, read the sequence itself, so a mistyped sequence id is reported as
// sequence.not_found and not as a successful stop.
const confirm_sequence_after_404 = async(s: Op_session, sequence_id: number): Promise<void>=>{
    await read_sequence(s, sequence_id);
};

// INTERIM (API gap): DELETE /v3/sequences/{id}/contact-links/{contact_id} also removes a
// participation that has finished, which changes the sequence's statistics, and its answer says
// nothing about what it removed.
// Needed: a stop that leaves finished participations alone and reports what it did.
// Workaround: read the participation first. A finished one, or none at all, is already stopped,
// and nothing is written.
const participation_before_remove = async(s: Op_session, sequence_id: number, contact_id: number): Promise<'active' | 'stopped'>=>{
    const a = await call_reply(s, 'GET', `/v3/sequences/${sequence_id}/contacts/${contact_id}`, 'read');
    if (a.status === 404)
    {
        require_not_taking_part(sequence_id, a, 'read');
        await confirm_sequence_after_404(s, sequence_id);
        return 'stopped';
    }
    if (a.status !== 200)
    {
        throw refusal(a, 'read');
    }
    return expect_object(a, 'read').statusInSequence === 'finished' ? 'stopped' : 'active';
};

const remove_from_sequence = async(s: Op_session, sequence_id: number, contact_id: number): Promise<'removed' | 'not_in_sequence'>=>{
    if (await participation_before_remove(s, sequence_id, contact_id) === 'stopped')
    {
        return 'not_in_sequence';
    }
    const a = await call_reply(s, 'DELETE', `/v3/sequences/${sequence_id}/contact-links/${contact_id}`, 'write');
    if (a.status === 200 || a.status === 204)
    {
        return 'removed';
    }
    if (a.status === 404)
    {
        // The person left between the read and the removal.
        require_not_taking_part(sequence_id, a, 'write');
        return 'not_in_sequence';
    }
    throw refusal(a, 'write');
};

const handle_sequence_remove_contact = async(
    id_arg: string, opts: Remove_contact_opts, ctx: Cli_context, g: Op_globals, read_stdin?: () => string,
): Promise<void>=>{
    const sequence_id = parse_id(id_arg, 'Sequence id');
    const contact = read_contact_input(opts, read_stdin);
    parse_idempotency_key(opts.idempotencyKey);
    const s = await open_session(ctx, g);
    const ids: Ids = {sequence_id};
    try {
        const contact_id = await find_contact(s, contact);
        if (contact_id === null)
        {
            // Nobody under this address: they take part in nothing.
            print_result({status: 'not_in_sequence', sequence_id, contact_id: null}, g);
            return;
        }
        ids.contact_id = contact_id;
        print_result({status: await remove_from_sequence(s, sequence_id, contact_id), sequence_id, contact_id}, g);
    } catch (e) {
        throw with_ids(e, ids);
    }
};

export {handle_sequence_add_contact, handle_sequence_remove_contact, resolve_step_position};
export type {Add_contact_opts, Remove_contact_opts};
