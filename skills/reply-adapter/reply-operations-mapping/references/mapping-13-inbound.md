<!-- Generated. Do not edit by hand. -->

# Family 13 — Inbound · mapping

Generated from `fulfilment.yaml` in this skill. Edit that file, not this one.

*The conversation, the queue and the day* · 11 operations, 11 with an entry · contract 2.0.0 · adapter `reply`

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
| `inbound_lead.record` † | `control` | `auto`<br>*departs:* the protective floor — recording an event that already occurred outside our control is not a decision, and delaying it burns the only thing this motion is measured on. | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. There is no inbound-lead or form-capture group: an arrival has nowhere to be recorded as an arrival, with the clock the rest of this family depends on.<br>Do not simulate the queue out of tasks, contact owners or inbox categories. Those entities have their own meanings and their own operations, and an arrival modelled as a task loses the one thing that made it an arrival — the response clock. |
| `inbound_lead.list` † | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. |
| `inbound_lead.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. |
| `inbound_lead.route` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. There is no routing rule — territory, existing owner, round-robin or availability — anywhere in the documentation.<br>Contact and account ownership can be changed, but changing an owner is not routing an arrival: it carries no rule, no queue and no clock, and reporting it as routing would claim a guarantee that was never made. |
| `inbound_lead.claim` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. |
| `inbound_lead.release` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. |
| `inbound_lead.triage` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Nothing classifies what kind of request an arrival is.<br>Inbox categories classify reply threads on conversations we started. That is a different act on a different entity, and it is covered by its own contract operation. |
| `inbound_lead.close` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. |
| `inbound_lead.reopen` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. |
| `response_policy.define` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. No response target can be stated, so none can be measured or breached. |
| `response_policy.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. |

The contract's own classification of these operations — the full five properties, the check before repeating, the invariants they enforce — is in `catalog-13-inbound.md`, in the `sdr-operations` skill. What this adapter does not reach, and why, is collected in [fulfilment.md](fulfilment.md).
