<!-- Generated. Do not edit by hand. -->

# Family 11 — Meetings, qualification and handoff · mapping

Generated from `fulfilment.yaml` in this skill. Edit that file, not this one.

*The conversation, the queue and the day* · 17 operations, 17 with an entry · contract 2.0.0 · adapter `reply`

**Reading the table.** † marks a core operation. *Reach* and *approval* are the
contract's own classification, reproduced here unchanged: knowing which endpoint performs an
operation alters neither what it is nor what it needs approved, and the two columns are present so
a reader can see for themselves that the mapping changed nothing. *Fulfilment* is this adapter's
claim — `direct` (one surface performs it), `composed` (several calls in the stated order),
`partial` (performed, but not to the contract's full promise, with the unkept part named) or
`absent` (not performable here today, with the evidence). *Surface* names an endpoint group and a
documentation page, never a path: the path, its parameters and its body come from that page at call
time. An operation shown as *not assessed* has no entry at all — nobody has answered for it yet,
which is a different statement from `absent`.

| Operation | Reach | Approval | Fulfilment | Surface | Scopes | Notes |
|---|---|---|---|---|---|---|
| `meeting.propose` | `act` | `confirm_each`<br>*departs:* raised: it puts words and specific times in front of a named person. | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Nothing offers times and nothing hands over a way to pick one. Toggle thread meeting-intent marks that a thread is about a meeting and proposes nothing, so it must not be read as a booking surface. |
| `meeting.book` | `act`<br>*conditional:* `act` when the booking issues the invitation; `control` when it records a meeting invited elsewhere — resolved by the preview. | `confirm_each`<br>*conditional:* confirm_each when it acts, auto when the preview resolves it to `control`.<br>*departs:* confirm_each when the booking issues the invitation, because each invitation reaches one person's calendar and is its own decision; auto when the preview resolves it to recording a meeting invited elsewhere. Act × compensatable derives confirm_once, so the acting side sits deliberately above the table. | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Meetings appear in reporting as facts that already happened; no endpoint creates one, issues an invitation, or records a meeting that was invited elsewhere. |
| `meeting.confirm` | `act` | `confirm_each`<br>*departs:* raised: it reaches named people. | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. There is nothing to read a meeting's attendee responses from and nothing that chases the people who have not answered. |
| `meeting.reschedule` | `act` | `confirm_each`<br>*departs:* raised: the attendee is told. | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. With no booking surface there is no meeting here to move. |
| `meeting.cancel` | `act` | `confirm_each`<br>*departs:* raised: the attendee is told. | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Tell the user to cancel it in the calendar rather than leaving someone expecting a meeting nobody will attend. |
| `meeting_outcome.record` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — the meetings report carries when a booking was made, by whom, from which campaign and on which channel, and no outcome field of any kind. Held, no-show and cancelled beforehand cannot be told apart here, which also means meeting outcomes cannot be read back out of this product later. |
| `meeting.list` | `read` | `auto` | `partial` | reports -> List meetings | `reporting:read` | *missing:* A booking ledger rather than a calendar. A row gives who booked it, the channel it came from, the person, the campaign and when the booking was made — not when the meeting is, who is attending, how to join, or how it went. Nothing upcoming can be answered from it and no outcome can be read out of it.<br>Filterable by date window and by user, so it does answer how many meetings were booked and by whom over a stated period. Measurement is rate-limited harder than the rest of the surface — sequential calls, cached within the session, no polling. |
| `meeting.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. The reporting list is the only place a meeting appears at all and it has no per-meeting read. |
| `qualification.record` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Custom fields could be made to hold the answers, but that is a schema somebody would have to invent, and inventing it here would produce a record no other run could read back. |
| `handoff.create` | `control` | `confirm_once`<br>*departs:* raised: it commits another person's time and starts their clock. | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Changing who owns a person moves the record; it makes no offer, starts no clock, and can be neither accepted nor refused, so it is not this operation. |
| `handoff.accept` | `control` | `auto` | `absent` | — | — | *because:* Nothing creates a handoff here, so there is nothing to accept and no commitment clock to start. |
| `handoff.reject` | `control` | `auto` | `absent` | — | — | *because:* Nothing creates a handoff here, so there is nothing to refuse. |
| `handoff.return` | `control` | `auto` | `absent` | — | — | *because:* Nothing creates or accepts a handoff here, so there is nothing to give back. |
| `handoff.withdraw` | `control` | `auto` | `absent` | — | — | *because:* Nothing creates a handoff here, so there is nothing to pull back. |
| `handoff.list` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Nothing shows what has been handed over and left unanswered, in either direction. |
| `handoff.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. |
| `opportunity.create` | `control` | `confirm_once`<br>*departs:* raised: it is one of the four facts people are paid on, and an accidental one corrupts attainment for the period. | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. A conversion into a deal is recorded wherever the pipeline lives, and this adapter has no view of that. Name the system the user should record it in rather than approximating it with a field on a person or an account. |

The contract's own classification of these operations — the full five properties, the check before repeating, the invariants they enforce — is in `catalog-11-meetings.md`, in the `sdr-operations` skill. What this adapter does not reach, and why, is collected in [fulfilment.md](fulfilment.md).
