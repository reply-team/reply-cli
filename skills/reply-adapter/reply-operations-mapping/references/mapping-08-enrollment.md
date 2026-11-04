<!-- Generated. Do not edit by hand. -->

# Family 8 — Enrollment · mapping

Generated from `fulfilment.yaml` in this skill. Edit that file, not this one.

*The programme* · 7 operations, 7 with an entry · contract 2.0.0 · adapter `reply`

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
| `campaign.enroll` † | `act`<br>*conditional:* bookkeeping while the campaign is not live, `act` the moment it is; resolved by the preview, never assumed. | `confirm_once`<br>*conditional:* confirm_once before go-live; confirm_once with a mandatory preview once live. One call over a set is one decision, and the preview is the approval artefact — it names the population, it does not count it. | `direct` | sequence-contacts -> Bulk add contacts to sequence | `sequences:operate`, `contacts:read` | Returns per-contact results. Reconcile every one — added, already in sequence, not found, forbidden, limit exceeded. Never summarise a partial result as success. |
| `enrollment.list` † | `read` | `auto` | `direct` | sequence-contacts -> List contacts in sequence, List contacts in sequence with extended state; contacts -> Get sequences for a contact | `sequences:read`, `contacts:read` | Both ends of the same read are covered — the campaign's people, and one person's campaigns. Count contacts in sequence is documented as coming soon, so count by paging the list rather than planning around it. |
| `enrollment.get` | `read` | `auto` | `direct` | sequence-contacts -> Get a contact in a sequence, List contacts in sequence with extended state | `sequences:read` | The extended-state listing is the one that carries progress detail; the single read is the cheaper check-first before a hold, a resume or a stop. Which of the fields this operation names are actually present comes from those two pages at call time, not from here. |
| `enrollment.pause` † | `control` | `auto` | `partial` | sequence-contacts -> Set contacts' status in this sequence | `sequences:operate` | *missing:* No reason is accepted and there is no dated automatic resume. The hold is a bare status, so why someone was held and when they should carry on again survive only wherever the agent chooses to write them down.<br>At most one hundred people per call, and only a participation that is currently active can be held. The response returns failures keyed by person and an empty object when every one succeeded — reconcile per person rather than reading that empty object as a count. |
| `enrollment.resume` | `act`<br>*conditional:* `act` when the campaign is live; `control` when it is not. | `confirm_once`<br>*conditional:* confirm_once with a mandatory preview naming who resumes while the campaign is live; auto while it is not. | `partial` | sequence-contacts -> Set contacts' status in this sequence | `sequences:operate` | *missing:* Setting a participation back to active is accepted from any current state, so the refusal the contract requires — resume only what is actually held — is not enforced by the API. The check-first read has to perform it, or a finished participation is quietly restarted and someone is written to again.<br>On a live campaign this sends. The preview naming who resumes is the approval artefact and knowing which endpoint performs the call softens nothing about that. |
| `enrollment.stop` † | `control` | `confirm_once` | `partial` | sequence-contacts -> Remove contact from sequence, Bulk remove contacts from sequence | `sequences:operate` | *missing:* The mandatory reason. The body carries identifiers and nothing else, so neither why someone was taken out nor that a different person was the cause can be recorded — and naming that other person is part of the operation, not a nicety. Record the reason wherever the run itself is recorded.<br>The bulk response counts requested, removed, not found and not in sequence, and lists the identifiers actually removed. An already-absent participation reads as a completed stop. |
| `disposition.set` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Marking someone replied or bounced records what happened to a message, and an inbox category records what a reply meant; neither is the business outcome of the participation, and pressing one into service as a stand-in corrupts the number people are measured on. |

The contract's own classification of these operations — the full five properties, the check before repeating, the invariants they enforce — is in `catalog-08-enrollment.md`, in the `sdr-operations` skill. What this adapter does not reach, and why, is collected in [fulfilment.md](fulfilment.md).
