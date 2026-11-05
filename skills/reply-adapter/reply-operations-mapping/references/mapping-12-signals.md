<!-- Generated. Do not edit by hand. -->

# Family 12 — Signals and triggers · mapping

Generated from `fulfilment.yaml` in this skill. Edit that file, not this one.

*The conversation, the queue and the day* · 10 operations, 10 with an entry · contract 2.0.0 · adapter `reply`

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
| `signal.list` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Nothing reports that someone changed job, visited a page, raised funding or engaged publicly.<br>ai-sdr-intent-signals -> Industries typeahead, Technologies typeahead is the nearest thing and it is not this: it resolves the words a user says into values a prospect search accepts. Offering it here answers a different question than the one asked. |
| `signal.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Without a feed there is nothing to read one observation from. |
| `signal.acknowledge` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. |
| `signal_policy.define` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Nothing arbitrates between two things firing on the same person, because nothing fires. |
| `signal_policy.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. |
| `trigger.create` | `control` | `auto` | `partial` | webhooks -> Create a webhook subscription, List supported event types | `webhooks:write`, `webhooks:read` | *missing:* Only the watching half. A subscription delivers a named event to a listener outside the product; the rule's other half — producing work in response — has no surface, so the acting side must live in the agent runtime. The watchable set is fixed and product-side (message sent, opened, clicked, replied, bounced; contact opted out or finished; connection request sent and accepted; account connection lost or erroring), so a rule that must watch something outside that set cannot be expressed at all.<br>Read List supported event types before promising a rule — the event names are the whole vocabulary, and a trigger written against an event that is not on that list will never fire rather than failing loudly. |
| `trigger.update` | `control` | `auto` | `partial` | webhooks -> Update a webhook subscription, Enable a webhook subscription, Disable a webhook subscription | `webhooks:write`, `webhooks:operate` | *missing:* The same half as trigger.create: what the rule watches can be changed, what it produces cannot, because production is not in the product.<br>"Switch it off without losing it" maps exactly onto Disable, which is the reversible move. Deleting a subscription to stop it and re-creating it later is not the same act and loses the subscription's history. |
| `trigger.list` | `read` | `auto` | `partial` | webhooks -> List webhook subscriptions, List supported event types | `webhooks:read` | *missing:* What each rule watches is listed; what it produces is not, and cannot be, since the producing half is external. Report the watch, and say plainly that the action behind it is the runtime's and not the product's. |
| `trigger.delete` | `control` | `confirm_once` | `partial` | webhooks -> Delete a webhook subscription | `webhooks:write` | *missing:* Removes the watch only. Whatever the agent runtime built on top of that event keeps existing and has to be taken down separately, or it becomes a rule waiting on an event that will never arrive again. |
| `trigger_run.list` | `read` | `auto` | `partial` | webhooks -> Get webhook delivery logs | `webhooks:read` | *missing:* Deliveries, not runs. The log says which event fired and whether it reached the listener; what work came out of it and what a policy held back are not recorded, because neither the work nor the policy exists on this side. Never report a delivery count as a count of work done. |

The contract's own classification of these operations — the full five properties, the check before repeating, the invariants they enforce — is in `catalog-12-signals.md`, in the `sdr-operations` skill. What this adapter does not reach, and why, is collected in [fulfilment.md](fulfilment.md).
