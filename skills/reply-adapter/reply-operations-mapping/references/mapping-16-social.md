<!-- Generated. Do not edit by hand. -->

# Family 16 — Social and messaging channels · mapping

Generated from `fulfilment.yaml` in this skill. Edit that file, not this one.

*Permission and capability* · 13 operations, 13 with an entry · contract 2.0.0 · adapter `reply`

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
| `social_invitation.send` | `act` | `confirm_each`<br>*departs:* raised: the note is content addressed to a named person. | `direct` | direct-outreach -> Send a LinkedIn connection request to a contact | `contacts:operate` | The optional note is supported, and that is exactly why the contract's confirm_each applies: it is content addressed to one named person, so the literal text is approved before the call, not a description of it. The person must already be a contact carrying a profile URL, and the caller names which connected social account sends it — so sender.health comes first. The send happens outside any campaign, which means campaign pacing does not apply to it and the daily invitation limit has to be respected by the caller; see linkedin-guardrails for the pacing this operation is subject to. The contract's read before repeating — the invitation state for this pair — has no surface here, because social_invitation.list is absent. Keep that ledger in the agent's own record, or a retry becomes a second invitation to somebody who already has one. |
| `social_invitation.list` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Invitations sent cannot be listed, so neither what is pending nor how old it is can be answered.<br>The pending social-account listing is a different thing despite the similar name: it is accounts waiting to finish connecting to the product, not invitations waiting on people. Confusing the two produces a confident answer to a question nobody asked. |
| `social_invitation.withdraw` | `control` | `confirm_once`<br>*conditional:* auto for one invitation; confirm_once for a collection. | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. A sent invitation cannot be taken back through the API. |
| `social_invitation.accept` | `act` | `confirm_once` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. |
| `social_invitation.decline` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. |
| `social_relationship.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Nothing answers, on demand, whether we are connected to this person or at what degree.<br>The notification surface reports connection requests sent and accepted, so a standing relationship ledger can be maintained outside the product from those events. That is a ledger the agent builds and owns; it is not a read, and it knows nothing about people we never invited. |
| `social_profile.view` | `act`<br>*conditional:* `act` where the channel surfaces the view to the person; `read` where the operator has declared that it does not. Where the operator has declared neither, absence resolves to `act`. | `confirm_each`<br>*conditional:* confirm_each while it resolves to `act`; auto where it resolves to `read`. Bulk profile research is exactly the case a standing approval exists for. | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. No profile read is exposed, metered or otherwise. |
| `social_profile.follow` | `act` | `confirm_once` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. |
| `social_profile.unfollow` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. |
| `social_post.react` | `act` | `confirm_once` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. |
| `social_post.comment` | `act` | `confirm_each`<br>*departs:* raised from confirm_once: it is published content under a named human's identity. | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. No published content can be posted under a person's identity through this API. |
| `social_credit.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. The metered messaging allowance is not readable: how many credits remain, when they expire and whether a reply returns one are all unanswerable.<br>A metered message can be sent without any way to check the balance first, so the meter is discovered by exhausting it. Warn the user before planning volume that depends on it. |
| `conversation_window.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface was found for this. Nothing reports whether this person may be written to freely right now, only with pre-approved content, or only by spending a credit.<br>Both routes exist as sends — an ordinary message and a metered one — but nothing says which is permitted for a given person, so the choice is the caller's and a wrong one fails at send time rather than at planning time. That is a real cost to surface before the user commits to a social route. |

The contract's own classification of these operations — the full five properties, the check before repeating, the invariants they enforce — is in `catalog-16-social.md`, in the `sdr-operations` skill. What this adapter does not reach, and why, is collected in [fulfilment.md](fulfilment.md).
