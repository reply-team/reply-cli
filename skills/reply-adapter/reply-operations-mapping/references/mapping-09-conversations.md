<!-- Generated. Do not edit by hand. -->

# Family 9 — Conversations and activity · mapping

Generated from `fulfilment.yaml` in this skill. Edit that file, not this one.

*The conversation, the queue and the day* · 9 operations, 9 with an entry · contract 2.0.0 · adapter `reply`

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
| `conversation.list` † | `read` | `auto` | `direct` | inbox -> List inbox categories, List and filter inbox threads | `inbox:read` | Categories carry unread counts, so reading them first gives the shape of the work. |
| `conversation.get` † | `read` | `auto` | `direct` | inbox -> Get inbox thread, List messages in an inbox thread | `inbox:read` | Two reads — the thread, then its messages in order. Note the thread's channel while you are there, because a reply has to go out on the same one. |
| `conversation.classify` † | `control` | `auto` | `partial` | inbox -> Assign or clear a thread's category, Assign threads to a category | `inbox:operate` | *missing:* The meaning is recorded, its provenance is not. No field carries who decided it, which message they decided it from, or how sure they were, so a category set by a model and one set by a person are indistinguishable afterwards.<br>The vocabulary is the account's own inbox categories — read List inbox categories first and map onto what exists rather than inventing a label. Re-read the thread to confirm it took. |
| `conversation.assign` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Assign threads to a category and Assign or clear a thread's category move a thread between categories, not between people, and the resemblance in the names is exactly the trap. Changing who owns the person is a different act with different consequences and is not a substitute. |
| `conversation.snooze` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Nothing takes a thread out of the queue and brings it back on a date. |
| `conversation.close` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Mark threads as read records a read state, not a worked one, and deleting a thread destroys it. Neither says the thread was dealt with, which is the whole of what closing one means. |
| `conversation.reopen` | `control` | `auto` | `absent` | — | — | *because:* Nothing closes a thread here, so nothing reopens one. Mark threads as unread is the nearest surface and it says something else. |
| `referral.record` | `control` | `confirm_once`<br>*departs:* raised: it creates a person we will contact on the strength of a stranger's sentence. | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. The pieces exist separately, since the named person can be created and the referrer can be taken out of the campaign, but nothing records that the one came from the other — and that link is the only fact that justifies contacting a stranger, so performing the two calls without it is not the operation. |
| `activity.log` | `control` | `auto` | `partial` | contacts -> Add a note to a contact | `contacts:operate` | *missing:* Only the note. A free-text note is one of the things this operation records; an email sent from a personal client, a conversation in a corridor, or a message on a channel we do not send from cannot be logged as an activity with its channel, direction and time, so the record stays an incomplete account of what happened to this person.<br>Get activities for a contact is the read that shows what the product recorded itself, and a note is not guaranteed to appear in it. Check before telling the user the record is whole. |

The contract's own classification of these operations — the full five properties, the check before repeating, the invariants they enforce — is in `catalog-09-conversations.md`, in the `sdr-operations` skill. What this adapter does not reach, and why, is collected in [fulfilment.md](fulfilment.md).
