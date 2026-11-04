---
name: reply-api
description: >
  Work with the Reply.io API v3 correctly: discover endpoints through the machine-readable
  docs, respect scopes and rate limits, handle problem+json errors and background jobs.
  Use before calling any non-trivial v3 endpoint, when choosing an endpoint for a task,
  or when an API call fails and needs interpretation.
metadata:
  version: 1.5.0
  pack: reply-adapter
  category: execution
  maturity: reviewed
  status: active
  owner: skills-maintainers
  tags: [api, docs, errors, rate-limits]
  tools: [reply-cli, reply-mcp]
  api: [introduction, authentication, rate-limits]
  relations:
    depends-on: [reply-cli]
    recommends: [reply-auth, reply-operations-mapping]
---

# Working with Reply API v3

## Purpose

API v3 (`https://api.reply.io/v3`) is the full execution surface of Reply — contacts, sequences,
inbox, channels, tasks, schedules, reports, webhooks and the AI-SDR cluster. The docs are built
for agents: this skill teaches the discovery-first workflow that avoids invented endpoints and
malformed bodies.

## When to use / when NOT to use

- Use whenever a task needs an endpoint you haven't verified in this session, or an error needs
  interpreting.
- Do NOT guess endpoint paths or body shapes from memory — verify against the docs first.

## Prerequisites

A working credential (`reply auth whoami` succeeds) with the scopes the target endpoints require.

## Execution guidance

### Discovery-first workflow (always)

1. **Fetch the index once per session:** `https://docs.reply.io/llms.txt` — every endpoint with
   its doc URL and required scope, one line each.
2. **Fetch the endpoint's doc page as raw markdown** by requesting its URL with the `.md` suffix
   (e.g. `https://docs.reply.io/api-reference/sequences/list-all-sequences.md`) — exact path,
   parameters, body schema, response examples.
3. **Call it:** `reply api <path exactly as documented>`.

Known-stable anchors you may use without re-checking: `GET /v3/whoami` (identity; no scope),
`GET /v3/whoami/team-users` (accessible teams), `GET /v3/background-jobs/{id}`,
`GET /v3/sequences/{id}/stats` and `GET /v3/sequences/stats` (stricter rate limits).
The full OpenAPI 3.1 spec exists at `https://docs.reply.io/api-reference/bundled.yaml` — prefer
per-page `.md` fetches; the spec is large.

### Conventions

- REST, plural nouns: `GET` read, `POST` create, `PATCH` update, `DELETE` remove; JSON bodies.
- **Errors** are RFC 9457 `application/problem+json` with a stable `code` slug
  (`<resource>.<variant>`, e.g. `webHook.invalidEvent`). Validation 400s add an `errors[]` array
  with JSON Pointers to the offending fields — read them, fix, retry once.
- **Async:** long operations return `202 Accepted` + `Location: /v3/background-jobs/{id}`.
  Poll that endpoint until it completes; report the job result, not the 202.
- **Change feed:** `GET /v3/inbox/threads/changes` lists the inbox threads that changed, oldest
  first, a page at a time from an opaque `cursor` or a `since` moment, and holds the last 30 days
  only; from reply-cli 0.17.0 it is `reply inbox changes`. Keep the cursor it hands back, even on an
  empty page, and pass it unchanged. A cursor or moment older than the window is refused (CLI code
  `inbox.cursor_expired`), and so is a cursor the feed never issued or one ahead of its clock (CLI
  code `inbox.cursor_refused`): read again from a moment inside the window. An account whose Reply
  has no feed yet answers a bare 404 — page through the inbox threads instead.
- **Rate limits:** 100 req/min and 3000 req/hour per user; reporting and sequence-stats endpoints
  are stricter. On 429 the CLI already retried honoring `Retry-After` — if it still fails, wait
  and reduce concurrency (sequential calls for bulk work).
- **Direct sends** (from reply-cli 0.17.0): `--send-after <moment>` takes a moment with its offset
  and sends it as UTC, and Reply holds the send until then. `--idempotency-key <key>` goes as the
  `Idempotency-Key` header: the same request repeated under it answers the send Reply took rather
  than sending again; `idempotency_key.in_use` says the first send under it is still being made
  (wait and repeat), and `idempotency_key.reused` that it was taken for another request, whose send
  the error's `details` names. The answer carries the send's `reference` and `state`, and its
  `send_after` where one was given; take each field only when the answer gives it, and read a
  `send_after` of null as no moment given. `reply direct-send get <reference>` reads the send and
  `reply direct-send cancel <reference>` cancels one still held. Nothing lists the pending sends: a
  harness that keeps the reference reads and cancels by it.
  - **State:** `sent` means it went. `failed` and `cancelled` are final: Reply will not send it,
    and neither a repeat under the key nor a read changes that. Any other state — `queued`,
    `sending`, `waitingForSchedule`, or one this skill does not name — means Reply took the send
    and it has not gone yet. Every such send can still be cancelled except a `sending` one, which
    Reply is already sending.
  - **Text:** where the answer carries `rendered_subject` and `rendered_body`, they are the
    message as sent — the subject rendered, the body rendered with the account's signature and
    the tracking applied. Reply keeps no other rendered copy.
  - **Templates:** the text of an email, a LinkedIn message and an InMail is read as a template
    in Reply's own syntax and filled in for the contact. A send Reply makes within the call is
    filled in before anything goes, and one Reply cannot fill is refused with nothing sent, under a code reply-cli
    gives it: on an email, from reply-cli 0.17.2, a code of the contact's for variables missing, whose
    `details.missing_variables` lists the names, or one for a rendering that failed; on LinkedIn,
    `linkedin.missing_variables`. A send
    held for a later moment or a schedule, or one that goes now which Reply queues behind the
    account's other sends, is filled in when it goes, so a name Reply cannot fill
    then is not refused at the send: the send ends `failed`. On an email its `failure_code` is
    `contact.missingVariables`, with the names under `missing_variables`, or `contact.renderingFailed`,
    as reply-cli 0.17.2 prints them; on LinkedIn it carries no `failure_code`, and Reply's sentence is
    its `failure_reason`. On LinkedIn Reply fills the sending account's
    `SendingLinkedIn.SenderFirstName` and `SendingLinkedIn.SenderName`, and has no variable for
    its last name or its address; the text goes as written, and Reply converts it from HTML to text
    after filling it in. A LinkedIn message's or InMail's length is the length after the text is filled in (`linkedin.message_too_long`). A connection request's note
    and a voice message's script are never filled in: either holding `{{` is refused,
    `linkedin.missing_variables`, so write them as final text.
  - **Read and cancel:** `reply direct-send get <reference>` answers the send's `state`, `channel`
    and `send_after`, and, as they apply, `sent_at` and `message_id` once it went, `failure_reason`
    where it failed and `cancelled_at` where it was cancelled. `reply direct-send cancel
    <reference>` answers the same record, cancelled. A cancel of a send already cancelled answers
    it again, so a cancel whose answer was lost is safe to repeat. A send that went, or that Reply
    is already sending, answers `direct_send.already_sent`, and one that failed
    `direct_send.already_failed`: nothing changed, so report it as gone or failed, never as
    cancelled. `direct_send.not_found` says Reply holds no send under the reference, and
    `direct_send.not_owned` that it holds one for an account this one is not; neither is repeated.
    A failed send carries Reply's `failure_code`: `directSend.dispatchWindowMissed` is `failed` -
    "Nothing went out; sending again is safe" - while `directSend.dispatchInterrupted` is to be
    read as `unknown`, not `failed`: it may have gone out - "check before sending again" - so read
    the person's thread before any new send.
  - **A lost answer:** where an earlier try returned a `reference`, read it first with `reply
    direct-send get <reference>` (from reply-cli 0.17.0), and let its state decide; repeat only
    when the read says nothing of the send. Reply keeps a key for a day, so a repeat goes under
    the same key only within 23 hours of the first try. Past that, or where the account's Reply
    has no direct-send route (a bare 404 on the read), the key no longer settles a repeat: send
    nothing, and leave whether the first try went to a person to check at Reply. Only a lost
    answer is repeated: a timeout, a dropped connection, a CLI that died, an exit 0 whose answer
    was cut off or could not be read, or a 5xx. A send Reply answered with a failure, a 4xx, is
    never repeated, under the key or otherwise: Reply keeps no key for it, so a repeat would be a
    new send. `idempotency_key.in_use` and a rate limit are the two 4xx that sent nothing, and
    are waited out as their own rows say.
- **Schedules** are the account's sending windows: a time zone — the schedule's own, or the
  recipient's where `use_recipient_time_zone` is true — the active ranges of each weekday, whether
  holidays are skipped, and the windows of a sequence's later steps. `reply schedule list` (from
  reply-cli 0.16.0) lists them with their `id`. Reading one, creating one and deleting one go
  through `reply api`, on the pages of the `schedules` group in `llms.txt`: reply-cli 0.17.0 has no
  command of its own for them. A schedule is shared, so a change or a delete reaches every sequence
  that uses it. Its `reply_status` is Reply's word for the first use it finds — a campaign template,
  a sequence of yours or a team member's, or a default — and a delete is only for one nothing uses.
  - **On a direct send** (from reply-cli 0.17.0), `--schedule-id <id>` names a schedule from
    `reply schedule list`, on email only: Reply refuses it on every LinkedIn route. Reply then
    holds the send until the schedule's first opening at or after `--send-after`, or after now
    where no moment is given. The answer's `state` says Reply holds the send, and it names no
    moment: Reply estimates one only where the schedule opens within 30 days, and reply-cli does
    not pass the estimate.
  - **A schedule or a moment.** A moment is one exact instant somebody chose. A schedule serves
    better where the right time is the person's working hours in their own time zone, where
    holidays should be skipped, or where nobody will be awake to time each send: Reply works out
    the next opening for each person. With both, the send goes at the schedule's first opening at
    or after the moment.
  - **A provider object.** Where the runtime carrying the work passes the reserved `provider` key
    inside the operation's arguments, `args.provider`, `message.send` by email reads
    `{"schedule_id": "<id>"}` and nothing else: the schedule's `id` from `reply schedule list`,
    written as a string of its digits. Any other shape or another key is refused before anything is
    sent, with a message that names the shape; write the object in that shape and ask again.
    Reply refuses a schedule on every LinkedIn direct send in this version (scheduleId is not
    supported for LinkedIn sends in this version, a 400 on each LinkedIn route), so a schedule on
    a LinkedIn message is refused before any call.

### Endpoint availability (GA / Beta / Coming soon)

The docs mark endpoints as **Beta** (shape may change) or **Coming soon** (not callable yet) —
much of the AI-SDR cluster (autopilot, pending approvals, enrichment, Live Data) carries such
marks. Check the endpoint's doc page; if it's Coming soon, say so honestly — never improvise a
replacement with unrelated endpoints.

Not every account's Reply has every route yet. A bare 404 — no `code` of Reply's own — on a
direct send, `direct-send get` or `direct-send cancel` means the account's Reply does not have the
route, not that an identifier is wrong; from reply-cli 0.17.0 the CLI passes it through as
`reply.refused` with status 404 and no Reply code. Say the capability is not there yet; never
retry it as a stale identifier.

## Validation

For writes: re-read the entity (`GET`) and verify the change. For bulk/async: poll the background
job to terminal state and reconcile counts (created/updated/skipped/failed).

## Reporting

Record endpoint paths used, entity IDs created/modified, background-job IDs and final counts.

## Failure modes

| Signal | Meaning | Action |
|---|---|---|
| 400 + `errors[]` | invalid body/params | fix per JSON Pointer, retry once |
| 401 empty body | bad/expired credential | fix auth (`reply auth login`) |
| 403 `insufficient_scope` | key lacks the endpoint's scope | tell the user which scope is missing; don't retry |
| 403/401 `TEAM_REQUIRED`·`TEAM_NOT_ACCESSIBLE`·`USER_REQUIRED`·`USER_NOT_FOUND` | team/user resolution | see reply-auth skill |
| 404 | wrong/stale ID | re-list the entity, re-resolve the ID — don't invent IDs |
| 429 | rate limit | respect `Retry-After`; go sequential |
| 5xx | transient | already retried; wait, retry once, then report the API may be down |

## Safety

Read endpoints are safe. Treat every POST/PATCH/DELETE as a live mutation subject to the calling
skill's confirmation rules — especially anything that sends messages or starts sequences.

## Related skills

- `reply-cli` — the execution command (`reply api`).
- `reply-auth` — scopes model and team/org resolution.

## Changelog

- 1.5.0 (2026-10-30): *Conventions* says how a direct send's text is filled in as a template:
  on an email, a LinkedIn message and an InMail; a send that goes now refused by reply-cli 0.17.2's
  three codes, with the names Reply lists; a held send filled in when it goes and failed then; the
  LinkedIn sender's two names, the text as written and the length after it is filled in; and a
  connection request's note and a voice message's script never filled in.
- 1.4.0 (2026-10-29): *Conventions* names the schedules: `reply schedule list` (from reply-cli
  0.16.0), reading, creating and deleting one through `reply api`, and that a schedule is shared;
  `--schedule-id` on a direct send by email (from reply-cli 0.17.0), the first opening at or after
  the moment where both are given, when a schedule serves better than a moment, and the provider
  object a `message.send` reads where the runtime keeps one.
- 1.3.0 (2026-10-29): *Conventions* names the direct sends' `--send-after` and `--idempotency-key`,
  the two `idempotency_key.*` codes and `reply direct-send get` and `cancel`, from reply-cli
  0.17.0, and what a send's answer says: its fields only when given, its state (`sent`, final
  `failed` and `cancelled`, anything else held), its rendered text as sent, what a read and a
  cancel answer, a failed send's two codes, a cancel's two refusals and a second cancel a
  success, and a lost answer read
  back by reference first and repeated under the key within 23 hours; *Endpoint availability*
  says what a bare 404 on those routes means.
- 1.2.0 (2026-10-29): the inbox change feed, `GET /v3/inbox/threads/changes`, and its window.
- 1.1.0 (2026-07-30): moved into the `reply-adapter` pack; category `technical` → `execution`;
  `auth-and-keys` renamed `reply-auth`.
- 1.0.0 (2026-07-27): initial version against docs.reply.io (v3, July 2026).
