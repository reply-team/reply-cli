<!-- Generated. Do not edit by hand. -->

# Family 18 — The team: people, ownership, workload and targets · mapping

Generated from `fulfilment.yaml` in this skill. Edit that file, not this one.

*The organisation around the work* · 15 operations, 15 with an entry · contract 2.0.0 · adapter `reply`

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
| `actor.list` | `read` | `auto` | `partial` | user-account -> List team users | — | *missing:* Identity only — the team, the user identifier, the display name and the email address. The state the operation asks for, active, ramping, unavailable or gone, is not carried, so this read cannot tell an agent whether the person it is about to hand work to is still there.<br>No scope required. It covers the teams this credential can act in; people outside them do not appear, which is a different answer from not existing. |
| `actor.get` | `read` | `auto` | `partial` | user-account -> Get current user, List team users | — | *missing:* Only the calling credential has a record of its own. Anyone else is an identity row in the team listing and nothing more — no state, and none of the ceilings that apply to them. |
| `team.list` | `read` | `auto` | `direct` | user-account -> List team users | — | Every row carries the team it belongs to, so one read answers both which teams exist and who is in them. No scope required. Teams this credential cannot act in are not listed. |
| `workload.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — checked against the endpoint index, nothing reports what a person is carrying. Open tasks and live enrolments can each be listed on their own, but no surface answers the question this operation asks, and adding up two listings is not the same answer. |
| `workload_policy.define` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this |
| `workload_policy.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no ceiling is declared anywhere, so the answer here is always none declared, which the contract reads as unlimited. |
| `ownership.get` | `read` | `auto` | `partial` | accounts -> Get an account; contacts -> Filter contacts | `contacts:read` | *missing:* The owner is an attribute of the record rather than a surface of its own, so it is read with the record. The second half of the question has no answer here at all: nothing states whether acting on an unowned record would make the actor its owner, and that rule is set in the product's own settings rather than returned by any response. |
| `ownership.assign` | `control` | `auto` | `direct` | contacts -> Change contacts owner; accounts -> Update account owner | `contacts:operate`, `contacts:write` | One endpoint per subject kind — people through the contact group, companies through the account group. There is no routing rule to defer to here, so the caller names the person; check they are still on the team first, because the owner listing carries no state. |
| `assignment_policy.define` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this |
| `assignment_policy.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no routing rule is stored in this product, so there is none to read and nothing that would say who gets the next piece of work. |
| `book.transfer` | `act` | `confirm_once` | `partial` | contacts -> Change contacts owner; accounts -> Update account owner; tasks -> Batch reassign tasks | `contacts:operate`, `contacts:write`, `tasks:write` | *missing:* Three parts of the book move — contact ownership, account ownership and open tasks. The senders behind live threads, the open conversations and the authored content do not, and no surface reports the book as a whole, so the ledger the contract requires has to be built by the caller from what each call returns before anything is repeated.<br>Reassigning ownership does not re-point the sending account behind a live thread. Say so before the transfer: a departing person's threads keep sending from their mailbox until the sequences are changed, and that is the part users are most often surprised by. |
| `goal.define` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — checked against the endpoint index, this product stores no quota, goal or target, so there is nothing to set. |
| `goal.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no target is stored here, so there is none to read. |
| `goal.list` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no target is stored here, so there is none to list. |
| `pace.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — pace is a target measured against achievement, and no target exists in this product. Achievement alone is readable through the reporting surfaces, and reporting it as pace would invent the half that is missing. |

The contract's own classification of these operations — the full five properties, the check before repeating, the invariants they enforce — is in `catalog-18-team.md`, in the `sdr-operations` skill. What this adapter does not reach, and why, is collected in [fulfilment.md](fulfilment.md).
