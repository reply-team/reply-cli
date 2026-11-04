<!-- Generated. Do not edit by hand. -->

# Family 10 — Task queue and touches · mapping

Generated from `fulfilment.yaml` in this skill. Edit that file, not this one.

*The conversation, the queue and the day* · 12 operations, 12 with an entry · contract 2.0.0 · adapter `reply`

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
| `task.list` † | `read` | `auto` | `direct` | tasks -> List all tasks, Filter tasks | `tasks:read` | Filter tasks is the one that answers what is owed today, by due window and by owner. |
| `task.get` | `read` | `auto` | `direct` | tasks -> Get a task | `tasks:read` | A task carries the message it is asking for as a subject and a body, so this read gives a human what they need to do the work rather than a pointer to it. |
| `task.create` | `control` | `auto` | `composed` | tasks -> Create a task, Reassign a task | `tasks:write` | *order:* Create a task, then Reassign a task when the queue belongs to somebody else — the create body has no assignee field, so the task lands with the calling user. Work for yourself needs only the first call.<br>Type, start time, due time and a body are required, the type decides what the task is for, and LinkedIn work carries its own subtype. Batch reassign tasks handles a set in one call. |
| `task.complete` † | `control` | `auto` | `direct` | tasks -> Complete a task, Batch complete tasks | `tasks:operate` | Marks the work done and sends nothing, which is exactly what this operation means. Execute and complete a task is a separate endpoint that does send the message the task holds — never reach for it to satisfy this operation. If the user wants the send, that is message.send with the approval message.send requires. |
| `task.skip` | `control` | `auto` | `absent` | — | — | *because:* The documented task states are new, finished, cancelled, archived and detached from a campaign, and none of them is skipped. The update endpoint cannot set a state at all, so declining a task while recording that it was declined has no surface. Completing it instead would put a lie in the record. |
| `task.reschedule` | `control` | `auto` | `direct` | tasks -> Update a task | `tasks:write` | Start and due times are both updatable, but the call replaces the whole task — read it first and resend the type, the body and the person, or they are lost. Only a task still in its new state can be updated, so finished work cannot be pushed to tomorrow. |
| `task.cancel` | `control` | `auto` | `partial` | tasks -> Delete a task, Bulk delete tasks | `tasks:write` | *missing:* Dropping the work is possible, recording that it was deliberately dropped is not. Deletion destroys the task, and the cancelled state the documentation describes cannot be set through the update endpoint, so afterwards nothing distinguishes work called off from work that was never there.<br>Say the deletion is irreversible before doing it. The contract treats this operation as compensatable and on this surface it is not, which is a difference the user has to hear first rather than discover. |
| `task.reassign` | `control` | `auto` | `direct` | tasks -> Reassign a task, Batch reassign tasks | `tasks:write` | The batch form is the one for handing over a whole queue. Reconcile per task rather than assuming the entire set moved. |
| `call.place` | `act` | `confirm_each` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Execute and complete a task, the only endpoint that performs a task's action, supports manual email and SMS and rejects every other type, so a call task cannot be dialled through the API. Calls are placed in the product, and the user needs telling that plainly. |
| `call.log` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — call activity is readable through reporting, under Get calls reporting overview and List call activity, and nothing writes one. A call that happened away from the product cannot be recorded here. |
| `call_recording.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this, and none for the agreement that permitted the recording either. |
| `call_recording.discard` | `control` | `confirm_once` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. A recording that has to be destroyed must be dealt with in the product, and that has to be said out loud rather than left for the user to assume an agent handled it. |

The contract's own classification of these operations — the full five properties, the check before repeating, the invariants they enforce — is in `catalog-10-tasks.md`, in the `sdr-operations` skill. What this adapter does not reach, and why, is collected in [fulfilment.md](fulfilment.md).
