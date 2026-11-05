---
name: reply-operations-mapping
description: >
  Maps the vendor-neutral SDR operation contract onto Reply.io execution: which API v3 endpoint
  group and doc page performs an operation, which scope it needs, how far Reply keeps the
  operation's promise, and how Reply's errors translate back into operation outcomes. Use when a
  plan names an operation and you need to perform it against Reply, when a Reply response needs
  interpreting in business terms, or when you need to know whether Reply can do a thing at all
  before promising it to a user.
metadata:
  version: 2.3.0
  pack: reply-adapter
  category: execution
  maturity: draft
  status: active
  owner: skills-maintainers
  tags: [mapping, operations, endpoints, scopes, adapter, coverage]
  tools: [reply-cli, reply-mcp]
  api: [contacts, contact-lists, contact-blacklist-rules, custom-fields, sequences, sequence-steps, sequence-contacts, sequence-email-accounts, sequence-linkedin-accounts, sequence-folders, sequence-templates, email-templates, inbox, tasks, reports, email-accounts, linkedin-accounts, accounts, schedules, holiday-calendars, webhooks, live-data, direct-outreach, contact-enrichment, email-validations, background-jobs, user-account, industries, ai-sdr-sequences, ai-sdr-pending-approvals]
  relations:
    depends-on: [reply-api, reply-cli, sdr-operations]
    recommends: [reply-auth, reply-mcp]
---

# Reply operations mapping

## Purpose

`sdr-operations` says what `campaign.enroll` *means*. This skill says how to make it happen
against Reply.io — which endpoint group owns it, which scope it needs, what must be true first,
and what the response says in business terms. It also says, for most of the contract, that Reply
does not perform the operation at all. **Both halves are the job.** A map that showed only the
reachable parts would read as complete and would be worth less than one that admits its edges,
because the edges are where an agent invents something.

The per-operation answer is not written here by hand. It lives in the coverage register
`fulfilment.yaml` in this skill, from which the per-family mapping tables and
[fulfilment.md](references/fulfilment.md) are generated. What is written here is everything that
does not fit in a table: how to read a fulfilment claim, the Reply-specific facts that change a
plan before any endpoint is chosen, and how a Reply response translates back into an operation
outcome.

## When to use / when NOT to use

- Use when executing a plan written in operation names against Reply.
- Use when a Reply response or error needs translating back into "what happened to the business
  intent".
- Use **before promising a capability**. The honest answer for most operations is that Reply does
  not have one, and finding that out at planning time costs a sentence, while finding it out
  mid-run costs the run.
- Do NOT use it as an endpoint reference. It names the **endpoint group and doc page**; exact
  paths, parameters and body schemas come from the documentation at call time — see `reply-api`
  for the discovery-first workflow. Paths written from memory are how agents invent endpoints
  that do not exist.
- Do NOT take the ordering from here. The neutral ordering lives in the contract's worked chains
  and only there; this skill adds what is Reply-specific about it and nothing else.
- Do NOT put business judgement here. Whether to dedupe by skipping or updating is a decision
  owned by the core pack; this skill only knows how to carry it out.

## Prerequisites

- A working credential — `reply auth whoami` succeeds (see `reply-cli`).
- The scopes the operation's row names, in the per-family mapping table (see `reply-auth` for the
  scope grammar).
- The operation you intend to perform, taken from the `sdr-operations` contract by name.

## Planning guidance

### Mapping never changes a classification

**Read the operation's classification first, then map it.** The contract already told you what the
operation reaches, whether it can be undone, what it costs, what to read before repeating it, and
what approval it needs. Knowing which endpoint performs it changes none of that.

An operation that is `confirm_once` with a mandatory preview in the contract is still
`confirm_once` with a mandatory preview after you know the endpoint. `campaign.enroll` mapped onto
*Bulk add contacts to sequence* is still one decision over a named population, and the preview is
still the approval artefact. This is the guardrail this layer is most tempted to erode — an
endpoint that returns quickly and cleanly feels safer than one that does not, and it is not — so
the mapping tables reproduce the contract's own reach and approval columns unchanged, precisely so
a reader can see for themselves that nothing was softened in transit.

The traffic runs one way: the contract may tighten what this adapter does, and this adapter may
never loosen what the contract requires.

### The fulfilment vocabulary

Every one of the contract's 325 operations carries exactly one of four claims about Reply.

| Claim | What it means | What you do on meeting it |
|---|---|---|
| `direct` | One documented surface performs the operation. | Fetch its doc page, call it, report the operation. |
| `composed` | Several calls in a stated order realise it. | Follow the stated order. Report the **operation**, not the calls — a composed operation that reports three call results has reported nothing a user can read. |
| `partial` | Reply performs it, but not to the contract's full promise. The register names the unkept part. | Say which part is missing **before** the user commits to a route that depends on it, and carry the missing half yourself — usually in whatever holds durable context across sessions. A partial reported as done is the most expensive mistake in this file. |
| `absent` | Not performable here today. The register names the evidence. | Say so, name what the documentation says, and stop. **Never substitute an adjacent endpoint.** Something that returns approximately the right shape is worse than a missing capability, because the user cannot see that it is wrong. |

An operation shown as *not assessed* has no entry at all. That is a different statement from
`absent`: nobody has answered for it yet, and it must be reported as an unanswered question.

### An `absent` is a gap in this adapter, not in the contract

**An operation marked `absent` is a gap in THIS ADAPTER, not in the contract.** The contract
describes the job; this file describes one product's coverage of it. The inverse mistake —
deleting an operation from the contract because this API lacks it — would undo the reason the
vendor-neutral layer exists.

The layer earns its keep exactly here. `meeting.book`, `privacy_request.fulfill`,
`inbound_lead.record` and `frequency_policy.define` are things an SDR organisation genuinely does;
Reply not having a surface for them makes them unmet needs, visible and nameable, rather than
things that quietly stop being part of the job. A contract shaped around one product's endpoints
would be a product manual with a neutral vocabulary painted on it.

### The shape of the coverage, stated honestly

<!-- BEGIN GENERATED adapter-coverage -->

<!-- Generated. Do not edit by hand. -->

All 325 operations carry an entry: **43 direct, 6 composed, 84 partial, 192 absent.**

<!-- END GENERATED adapter-coverage -->

Reaching about a sixth of the contract directly is the true picture, and it is worth stating in
those terms rather than in the terms a mapping is usually written in. A mapping listing only what
it can do would read as complete while being less useful — the reader would have no way to
distinguish "not in this document" from "not possible", which is the one distinction they need
when a plan is being written. The 192 absences are the most informative part of the register, and
[fulfilment.md](references/fulfilment.md) is long for that reason rather than in spite of it.

**One part of this register has not been researched as thoroughly as the rest, and it is worth
knowing which.** The endpoint groups covering *resources* were worked through page by page — 29 of
them are named across the entries. The **settings** groups were not: no entry in the register claims
a `settings:` scope, and that correlates exactly with where the claims are weakest. Every stored
policy object lands `absent` or `partial` — enrichment, contactability, frequency, response,
identity, assignment, workload, review, signal and content policies — and that is one missed pass
rather than fifteen independent judgements. Treat those entries as the least trustworthy in the file
until the settings pages have been read; `warmup_plan.set` first, because its own entry says the
absence it records is the one that costs the most in its family.

Nothing about these figures is a criticism of the product. Reply is strong exactly where an
outbound programme spends most of its time — contacts, lists, sequences, steps, enrolment, the
inbox and tasks. The absences cluster in oversight and review, which is the largest cluster in the
register, then deliverability, then privacy machinery, meetings, inbound queues, signals and the
policy objects that live in other systems or in nobody's system yet. Measurement belongs with the
absences rather than the strengths: the family is mostly absent, because the contract asks for a
measure set with the grouping as an argument and a stated envelope around every figure, which is a
different thing from a report.

### Where the order comes from

**The order is not in this skill and must not be copied into it.** The contract's worked chains —
`references/chains.md` in `sdr-operations` — carry the ordering, the gate at each step and the
failure each step prevents. Chain 1, *Launching outreach to two hundred people from a raw file*,
is the launch and import order that this skill used to restate. Read it there and follow it there.
An order written in two places drifts, and the copy that drifts is always the one further from the
contract.

What is genuinely Reply-specific about the order, and therefore belongs here:

1. **A bulk write is not finished when the call returns.** Large writes answer `202 Accepted` with
   a background-job reference. The operation completes when the job reaches a **terminal state**,
   so the chain step that follows a bulk write is a poll, and the figures that go into the report
   are the job's counts and never the `202`.
2. **Enrolment answers per contact, and the reconciliation is a step of its own.** *Bulk add
   contacts to sequence* returns a result per person — added, already in sequence, not found,
   forbidden, limit exceeded. Reading them is part of performing the operation, not part of
   writing it up afterwards.
3. **Two calls where the contract has one.** Attaching a schedule is create-or-update the schedule
   and then update the sequence; changing a campaign's owner is its own endpoint. Where a mapping
   row names more than one page, that is the shape of the work, and each call is a place the
   sequence can be left half-configured.
4. **Some protective moves are one level up.** Reply has no pause for a mailbox, so on email the
   protective move is `campaign.pause` or unbinding the sender. Say which one you used: they are
   not the same blast radius.

### Two Reply facts that shape almost every plan

1. **Bulk work is asynchronous**, as above. Plan the poll before you plan the write.
2. **Measurement is rate-limited harder than the rest of the surface.** Reporting and
   sequence-stats endpoints carry stricter limits than general endpoints. Sequential calls,
   cached within the session, **never polled**. An agent that parallelises a measurement pass gets
   `429`, and an agent that responds by retrying harder gets a longer one.

## Execution guidance

### Discovery-first, always

Every mapping row means: *use the `reply api` command with the path taken from that doc page*.
Fetch `https://docs.reply.io/llms.txt` once per session, then the specific page as raw markdown —
append `.md` to its URL — before the first call of that kind.

The register names an **endpoint group and a documentation page**, never a path, a parameter or a
body field. That is deliberate: a path written from memory is the single most common way an agent
fails against this API, and a path written into this file would be that mistake made once and then
trusted forever.

### The per-family tables

One table per contract family, generated from the register, in this skill's references:

- Families 1–4, people and audience: [discovery](references/mapping-01-discovery.md),
  [contacts](references/mapping-02-contacts.md), [audiences](references/mapping-03-audiences.md),
  [import](references/mapping-04-import.md).
- Families 5–8, the programme: [campaigns](references/mapping-05-campaigns.md),
  [steps](references/mapping-06-steps.md), [messages](references/mapping-07-messages.md),
  [enrollment](references/mapping-08-enrollment.md).
- Families 9–13, the conversation and the day:
  [conversations](references/mapping-09-conversations.md), [tasks](references/mapping-10-tasks.md),
  [meetings](references/mapping-11-meetings.md), [signals](references/mapping-12-signals.md),
  [inbound](references/mapping-13-inbound.md).
- Families 14–16, permission and capability: [privacy](references/mapping-14-privacy.md),
  [sending](references/mapping-15-sending.md), [social](references/mapping-16-social.md).
- Families 17–21, the organisation around the work:
  [oversight](references/mapping-17-oversight.md), [team](references/mapping-18-team.md),
  [accounts](references/mapping-19-accounts.md),
  [measurement](references/mapping-20-measurement.md),
  [introspection](references/mapping-21-introspection.md).

Read the **one** family that owns the operation in front of you. Everything this adapter does not
reach, with the evidence for each, is collected in [fulfilment.md](references/fulfilment.md).

### The runtime path beats any table

A static table goes stale, and it answers for the product rather than for this login. Where the
runtime can answer, prefer it:

- `capability.list` — what **this credential** may actually do. A table says what the API offers;
  a key with narrower scopes cannot do it.
- `adapter.describe` — the ceilings, batch sizes and page sizes **this installation** works
  within, and whether work of this size runs inline or queues.
- `adapter.verify` — proves by test which operations resolve here, rather than by assertion.

Against Reply today, all three are themselves incomplete, and that is the honest answer rather
than a reason to skip them. Identity and team membership are readable, but no endpoint returns the
granted scope set — what a key may do is discovered by making a call and reading an
`insufficient_scope` refusal back. The ceilings are documented in prose rather than returned per
installation. Nothing tests fulfilment at all: **this register is a claim made from documentation,
and it is the thing a verification would check rather than a substitute for one.** Treat every row
in it as needing confirmation the first time it is used against a real account, and report a row
that turns out to be wrong rather than working around it.

### Async work

A `202` response carries a background-job reference. Poll it to a terminal state, then report that
job's counts. A job that ends `failed` gets its body fetched for the reason — **never blind-retry
a bulk write**, because the first attempt may have partially succeeded. The job's result payload
is opaque and its shape varies by job kind, so where the contract wants one outcome per item,
reconcile against the entities themselves rather than trusting the job to carry the ledger.

### Sourcing prospects — Live Data, and its one hard constraint

The contract's discovery family — `candidate.search`, `candidate.get`, `candidate.promote` — is
`partial` here, on Reply's Live Data surface. Three rules, in order of how expensive it is to get
them wrong:

1. **Preview before Start, always.** Preview costs nothing and adds nobody. Start buys the people
   and creates them as contacts, spending the user's allowance, and **the mistake is only visible
   once it is already paid for**. Show the user who came back and let them approve the filter
   before it is run for real.
2. **Say "beta" as part of the plan, not as a footnote.** Live Data, the intent-signal typeaheads
   and the AI-SDR cluster are documented Beta or Coming soon. That belongs in the sentence where
   the user chooses the route, before they commit to it — not in a caveat after the work. Fetch
   the doc page and confirm the endpoint is callable, exactly as with any other surface.
3. **One Live Data search runs per team at a time.** This is a Reply fact and it belongs nowhere
   else. An agent that does not know it will plan several searches in parallel and stall, or read
   the refusal as a failure and retry it. Plan searches in series, and if one is already running,
   the honest report is that the queue is occupied and by what.

Build the filter from the typeahead values — departments, industries, job titles, locations,
seniorities — rather than guessing accepted ones. Check the existing searches before starting a
near-identical one: a repeat spends again and returns a different world. Whatever comes back then
enters the normal path — `contact.create` or `import.apply` into a named list, with the same
mapping, dedupe policy and approval gate as any other import. Start can optionally drop the found
people straight into a sequence; treat that as `campaign.enroll` and hold it to the enrolment
gate rather than letting it ride along.

**Contact enrichment is documented as available late August 2026 and is not callable today.**
`contact.enrich`, `company.enrich` and `phone_number.verify` are `absent` for that reason. Say
that, name the date the documentation gives, and never substitute an unrelated endpoint: an
enrichment that silently returns something else is worse than a missing capability.

The core-side view of all this — the routes a user without a list can take, of which Live Data is
one — is `audience-building` → *Where an audience comes from*.

### Error translation

| Reply signal | What it means for the operation | What to do |
|---|---|---|
| `400` + `errors[]` with JSON Pointers | The request was malformed, the intent was fine | Fix the indicated field, retry once |
| `401`, empty body | Credential invalid or expired — not an operation failure | Re-authenticate; see `reply-cli` |
| `403 insufficient_scope` | The credential may not perform this class of operation | Name the missing scope to the user; do not retry. This is also how a capability is discovered here, since no endpoint reports the granted scope set |
| `403`/`401` `TEAM_REQUIRED` · `TEAM_NOT_ACCESSIBLE` · `USER_REQUIRED` · `USER_NOT_FOUND` | The call could not be attributed to one team or acting user | See `reply-auth`; the CLI prints the exact fix |
| `404` | The identifier is wrong or stale, so the precondition never held | Re-resolve the entity; never invent an identifier |
| A bare `404` — no `code` of Reply's own — on a direct send, `direct-send get` or `direct-send cancel` | The account's Reply does not have the route yet; nothing was done | Say the capability is not offered here; never re-resolve or retry it as a stale identifier |
| `direct_send.not_found` · `direct_send.not_owned` (from reply-cli 0.17.0) | No send this account holds under the reference | Take the reference from the record of the send; never guess one |
| `direct_send.already_sent` · `direct_send.already_failed` (from reply-cli 0.17.0) | A cancel that came after the send went, or after it failed | Report the send as gone or as failed, never as cancelled; the cancel is not retried |
| `idempotency_key.in_use` (from reply-cli 0.17.0) | The first send under the key is still being made, and this one sent nothing | Wait, then repeat under the same key |
| `idempotency_key.reused` (from reply-cli 0.17.0) | The key was taken for another request, and Reply sent nothing for this one; `details` names the send the key holds — its `reference`, `state` and `send_after` | Where the key is the operation's own, that send is the operation's; never send again under a new key |
| `429` | The operation is fine, the pace is not | Honour `Retry-After`, go sequential. On a measurement pass, cache instead of re-reading |
| `5xx`, or a dropped connection | Unknown whether the operation took effect | Read the operation's **`before_repeating`** state from the contract first, and let that decide. A retry is only safe because a caller-supplied idempotency key was sent with the original call |
| Per-contact `not processed` in a bulk result | Partial success — a normal outcome, not an error | Report each reason; offer the corresponding fix |

**The idempotency key is what makes the last row survivable, and it is the caller's to supply.**
The contract requires one on every act, every collection write, every durable-object write and
every metered call, precisely so that a lost response is a lookup rather than a gamble. In the
contract that lookup is `invocation.get`, which distinguishes "never seen" from "seen and failed"
— and the two must never be collapsed, because a timed-out send may already have arrived.

Reply has no lookup-by-key surface: `invocation.get` is `absent` here. So on a dropped connection
the recovery is the operation's own `before_repeating` read against the entity itself — re-read
the contact, the participation, the thread — and a blind retry is never the answer. Send the key
anyway and record it: it is what makes the run reconstructable, and it is what a future adapter
with such a surface would resolve against.

The direct sends are the one exception. From reply-cli 0.17.0 they take `--idempotency-key`, and
Reply answers a repeat of the same request under the same key with the send it took, so a lost
answer there — a timeout, a dropped connection, a CLI that died, an exit 0 cut off or unreadable,
or a 5xx — is repeated under the key, and a send Reply answered with a failure, a 4xx, never is,
since Reply keeps no key for it; `idempotency_key.in_use` and a rate limit sent nothing and are
waited out. The repeat comes after `reply direct-send get` of a reference the earlier
try returned has said nothing of the send, and only within 23 hours of the first try, since Reply
keeps a key for a day. That holds only where the account's Reply has the
direct-send routes, which `reply direct-send get` of a reference tells (from reply-cli 0.17.0): a
bare 404 there means a key sent to a send protects nothing.

### A provider object inside the arguments

Where the runtime carrying the work passes the reserved `provider` key inside the operation's
arguments, `args.provider`, `message.send` performed as a direct send by email reads it as
`{"schedule_id": "<id>"}` and nothing else: the `id` of one of the account's schedules from
`reply schedule list` (from reply-cli 0.16.0), written as a string of its digits. It becomes the send's `--schedule-id` (from reply-cli 0.17.0), and
Reply holds the send until the schedule's first opening, at or after `send_after` where both are
given. Every other operation leaves the object unread. Another shape or another key is refused
before anything is sent, with a message that names the shape and quotes nothing of what was given:
write the object in that shape and ask again. Reply refuses a schedule on every LinkedIn direct
send in this version (scheduleId is not supported for LinkedIn sends in this version, a 400 on
each LinkedIn route), so a schedule on a LinkedIn message is refused before any call. When a
schedule serves better than a moment is `reply-api`'s to say.

### Choosing CLI or MCP

`reply api` reaches the whole API, so it reaches every operation this register marks reachable.
The MCP tool catalog is a curated **subset** of that API — convenient where no shell exists, but a
subset of a surface that already covers a minority of the contract. When an operation has no
matching tool, fall back to the CLI rather than approximating it with a different tool. See
`reply-mcp`.

## Validation

After every operation whose reach is `control` or `act`, perform the contract's
**`before_repeating`** read for that operation as a read-back: re-read the entity and confirm
identifiers, counts and status. An operation is reported complete only when that read agrees. For
async work: terminal job state plus reconciled counts.

Where the operation is `partial`, the read-back also has to establish the half Reply does not
enforce. Reply accepts a resume from any state, so the check that the participation was actually
held is the caller's; Reply records no reason on a stop, so the reason lives in the run's own
record or it is lost.

## Reporting

Report in operation terms, with Reply identifiers attached and marked as Reply's —
`campaign.enroll → campaign "Q3 SaaS founders" (Reply sequence id 12345), 214 requested,
211 enrolled, 3 already in the campaign`. A durable artefact names the entity the way the contract
names it, always; the product's own word survives only inside the identifier it labels, where a
reader can see it is an identifier and not a claim about what the entity is. Include
background-job identifiers, the
idempotency key sent, the endpoint groups used for writes, and any scope or team change the run
required.

Where an operation was `partial`, say which part was performed and which was carried outside the
product. Where one was `absent`, name it as a gap in this adapter and say what the documentation
says — never let it disappear from the report because nothing was called.

## Failure modes

- **Inventing a path** instead of fetching the doc page. The single most common way an agent fails
  against Reply.
- **Substituting an adjacent endpoint for an `absent` operation.** Deleting contacts is not
  fulfilling a privacy request; moving a list is not removing from one; marking a thread read is
  not closing it. Each returns approximately the right shape and answers a different question.
- **Reporting a `partial` as done**, without naming the half the product does not keep.
- **Reporting the `202`** as the result of a bulk operation.
- **Treating a partial bulk result as success**, hiding the per-contact reasons.
- **Reading `absent` as a defect in the contract** and proposing the operation be dropped. It is a
  fact about this product on this date, and the register is the place it is recorded.
- **Treating this register as a capability read.** It is documentation-derived and per-product;
  what *this credential* may do is `capability.list`, and here that is answered by an
  `insufficient_scope` refusal rather than by a listing.
- **Parallelising measurement** reads and hitting `429`, then retrying harder.
- **Planning two Live Data searches at once.** One runs per team at a time; the second stalls.
- **Starting a Live Data search without previewing it.** Start spends the user's allowance; the
  mistake is only visible once it is already paid for.
- **Presenting a beta surface as settled**, or a *coming soon* one as callable. Contact enrichment
  is documented for late August 2026 and is not available before then.
- **Telling a user Reply cannot source prospects.** It can, in beta — see *Sourcing prospects*.

## Safety

**Mapping an operation never changes its approval requirement.** `campaign.activate` mapped onto
*Start a sequence* still requires the user to have approved the population and the literal first
message, and the preview the contract demands is still the approval artefact. `reply api` has no
dry-run: any POST/PATCH/DELETE is live the moment it is issued.

The protective actions — `campaign.pause`, `enrollment.pause`, `outreach.hold` where it can be
composed, lowering a sender's limits — are the ones that may be performed first and reported
immediately. See `approval-boundaries` in the core pack for the full rule, which this skill does
not restate or override.

Two Reply-specific safety notes. A schedule is a shared object, so editing one silently rewrites
every future date on every campaign pointing at it — check who else uses it first. And a delete
here is a delete: Reply documents no restore for a contact, a template or a custom field, so treat
those as irreversible with no window and say so before acting rather than after.

## Related skills

- `sdr-operations` (core pack) — what each operation means, and the worked chains that carry the
  ordering. This skill is its Reply implementation and states, per operation, how far that
  implementation reaches.
- `reply-api` — discovery-first endpoint workflow, error conventions, rate limits.
- `reply-cli` — how to actually issue the calls.
- `reply-auth` — scopes, key types, team and acting-user resolution.
- `approval-boundaries` (core pack) — the approval rules this skill reads and never lowers.

## Changelog

- 2.3.0 (2026-10-30): `message.send` in the fulfilment register says that a message composed as a
  template goes by the same command and that Reply fills it in, before anything goes or when it
  goes, and points to reply-api's *Templates* for the rest.
- 2.2.0 (2026-10-29): *A provider object inside the arguments* says what `message.send` reads
  there — `{"schedule_id": "<id>"}`, a schedule from `reply schedule list`, by email only — and
  that it becomes `--schedule-id` from reply-cli 0.17.0; `message.send` and `message.schedule` in
  the fulfilment register name it too.
- 2.1.0 (2026-10-29): `message.schedule` and `scheduled_message.cancel` move from `absent` to
  `partial`: from reply-cli 0.17.0 a direct send takes `--send-after` and `--idempotency-key`, and
  `reply direct-send cancel` cancels one by its reference, where the account's Reply has the
  routes. `scheduled_message.list` stays `absent`, since `reply direct-send get` reads one send by
  reference and lists nothing. *Error translation* gains the bare 404 of these routes, the
  `direct_send.*` codes and the two `idempotency_key.*` codes, and the idempotency paragraph names
  the direct sends as the one place a key settles a lost answer, read back by reference first and
  repeated under the key only within 23 hours.
- 2.0.0 (2026-08-10): rewritten against contract 2.0.0. The six hand-written family tables are
  **deleted**: every operation now has an entry in the coverage register `fulfilment.yaml`, from
  which the twenty-one per-family mapping tables and `fulfilment.md` are generated, and this file
  points at them instead of restating a subset. The **Composite ordering** section is deleted —
  the launch and import orders it stated now live once, in the contract's worked chains, and what
  survives here is only what is Reply-specific about the order. New: the fulfilment vocabulary
  (`direct` · `composed` · `partial` · `absent`) with what an agent does on meeting each; the rule
  that an `absent` is a gap in this adapter and never a reason to shrink the contract; the
  coverage figures stated in the body, generated from the register itself, so that a reader is not
  left to infer completeness from a table's length; the runtime path
  (`capability.list`, `adapter.describe`, `adapter.verify`) as preferable to any static table; and
  the Reply limit of one Live Data search per team at a time, which an agent that does not know it
  will plan around wrongly. The `5xx` error row now points at the contract's `before_repeating`
  property rather than at a 1.x "check first" field, and says that the caller-supplied idempotency
  key is what makes a retry safe at all. Every operation name in the file was renamed to the 2.0.0
  contract — `sequence.*` to `campaign.*`, `enrollment.create` to `campaign.enroll`,
  `conversation.read` to `conversation.get`, `conversation.reply` to `message.send`, `metrics.*`
  to `engagement.summarize`, and the three-segment and hyphenated names to their two-segment
  replacements.
- 1.1.0 (2026-08-02): added *Sourcing prospects* — Live Data search and AI SDR intent
  signals, both beta, with Preview-before-Start as a hard rule, and Contact Enrichment
  recorded as not yet callable. Until now the only mention of Live Data in this skill was a
  warning in Failure modes, so an agent reading it could conclude Reply has no prospect
  search at all.
- 1.0.0 (2026-07-30): initial mapping of the six operation families onto Reply API v3,
  including composite launch/import ordering, async handling and error translation.
  Consolidates the Reply-specific execution detail previously embedded in the business
  skills, which are now vendor-neutral.
