import {Unknown_outcome_error, UsageError} from '../utils/errors';
import {call_reply, expect_object, refusal, unreadable, open_session, type Answer} from './call';
import {known_refusal, strings_of, DIRECT_SEND_REFUSALS} from './direct-send';
import {print_result} from './result';
import type {Op_globals} from './options';
import type {Cli_context} from '../context';

// Reply's route takes exactly this form and answers anything else with a bare 404, as it does when it
// has no such route at all. Checking the form here keeps that 404 meaning only the latter; nothing else
// is read from the reference, and the form leaves nothing to encode.
const REFERENCE = /^(email|linkedin)-[1-9]\d{0,9}$/;

const path_of = (reference: string): string=>{
    if (reference.trim() === '')
    {
        throw new UsageError('No reference was given.', {code: 'usage.reference', hint: 'A send made with --send-after answers its reference.'});
    }
    if (!REFERENCE.test(reference))
    {
        throw new UsageError('That is not a reference Reply gives: email-<n> or linkedin-<n>, n from 1.',
            {code: 'usage.reference', hint: 'A send made with --send-after answers its reference.'});
    }
    return `/v3/direct-sends/${reference}`;
};

// What Reply says of the text it rendered and of a failure's code, each only when it gives it, as text
// or null, and the unfilled names as a list: an answer without them prints as it did before them.
const RENDERING_KEYS: [string, string][] = [['failureCode', 'failure_code'], ['renderedSubject', 'rendered_subject'], ['renderedBody', 'rendered_body']];

const rendering_of = (body: Record<string, unknown>): Record<string, unknown>=>{
    const given = (v: unknown): boolean=>typeof v === 'string' || v === null;
    const out: Record<string, unknown> = Object.fromEntries(RENDERING_KEYS.filter(([from])=>given(body[from])).map(([from, to])=>[to, body[from]]));
    const missing = body.missingVariables === null ? null : strings_of(body.missingVariables);
    if (missing !== undefined)
    {
        out.missing_variables = missing;
    }
    return out;
};

// A send as Reply holds it, under the CLI's names; one of its first fields that Reply leaves out is null. Its state is Reply's word, passed on as given, so a state the CLI does
// not know yet reaches the caller instead of failing the read. failure_reason is a sentence for a person and failure_code
// Reply's code for the same failure: neither is read here.
const direct_send_of = (a: Answer, kind: 'read' | 'write'): Record<string, unknown>=>{
    const body = expect_object(a, kind);
    if (typeof body.reference !== 'string' || body.reference === '' || typeof body.state !== 'string' || body.state === '')
    {
        throw unreadable(a, kind);
    }
    const field = (name: string): unknown=>body[name] ?? null;
    return {
        reference: body.reference, channel: field('channel'), contact_id: field('contactId'), state: body.state,
        send_after: field('sendAfter'), sent_at: field('sentAt'), message_id: field('messageId'),
        failure_reason: field('failureReason'), ...rendering_of(body), cancelled_at: field('cancelledAt'),
    };
};

const handle_direct_send_get = async(reference: string, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const path = path_of(reference);
    const s = await open_session(ctx, g);
    const a = await call_reply(s, 'GET', path, 'read');
    if (a.status !== 200)
    {
        throw known_refusal(a, DIRECT_SEND_REFUSALS) ?? refusal(a, 'read');
    }
    print_result(direct_send_of(a, 'read'), g);
};

const handle_direct_send_cancel = async(reference: string, ctx: Cli_context, g: Op_globals): Promise<void>=>{
    const path = `${path_of(reference)}/cancel`;
    const s = await open_session(ctx, g);
    try {
        const a = await call_reply(s, 'POST', path, 'write');
        if (a.status !== 200)
        {
            throw known_refusal(a, DIRECT_SEND_REFUSALS) ?? refusal(a, 'write');
        }
        print_result(direct_send_of(a, 'write'), g);
    } catch (e) {
        // A cancel is safe to repeat: Reply answers a send already cancelled as cancelled again.
        if (e instanceof Unknown_outcome_error)
        {
            e.hint = 'The send may or may not have been cancelled; running it again is safe, and direct-send get reads where it stands.';
        }
        throw e;
    }
};

export {handle_direct_send_get, handle_direct_send_cancel};
