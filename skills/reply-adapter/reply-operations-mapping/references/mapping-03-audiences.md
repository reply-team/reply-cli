<!-- Generated. Do not edit by hand. -->

# Family 3 — Audience and lists · mapping

Generated from `fulfilment.yaml` in this skill. Edit that file, not this one.

*People and audience* · 16 operations, 16 with an entry · contract 2.0.0 · adapter `reply`

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
| `segment.define` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — filters are expressed per call and no documented surface saves one under a name. A contact list cannot stand in for a segment: it holds people, not a definition, it does not re-evaluate, and it cannot say who would match tomorrow. |
| `segment.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — there is no saved definition to show, since none can be saved. |
| `segment.list` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — there are no saved definitions to list. |
| `segment.delete` | `control` | `confirm_once` | `absent` | — | — | *because:* not evidenced — there is nothing to retire. |
| `segment.preview` | `read` | `auto` | `direct` | contacts -> Count filtered contacts, Filter contacts; live-data -> Preview a Live Data search | `contacts:read`, `contacts:write` | Two universes, two surfaces, and the cost difference the contract describes is real here: counting our own contacts is free, and the external preview adds no prospects and consumes no credits either. The external half is Beta; the internal half is not. Run whichever applies before anything that spends — this is the operation that makes the spend reviewable. |
| `segment.materialize` | `control` | `confirm_once` | `composed` | contacts -> Filter contacts; contact-lists -> List contact lists, Create a contact list, Add contacts to a contact list | `contacts:read`, `contacts:write` | *order:* contacts -> Filter contacts to evaluate the definition, then contact-lists -> Create a contact list or reuse one from List contact lists, then Add contacts to a contact list, then contacts -> Filter contacts by that list to reconcile what actually landed.<br>The freeze is genuine but is not recorded as one: nothing on the list says which definition or which as-of time produced it, so that has to be written down outside the product or the list becomes a set of people nobody can account for. Say before you start that there is no way to take people back off a list — see list_membership.remove — so a list built from the wrong filter is corrected by building another one. |
| `list.create` | `control` | `auto` | `direct` | contact-lists -> Create a contact list | `contacts:write` | Check List contact lists first — reuse beats proliferation. |
| `list.list` | `read` | `auto` | `direct` | contact-lists -> List contact lists | `contacts:read` | The first call before any list.create — reuse beats proliferation. |
| `list.get` | `read` | `auto` | `partial` | contact-lists -> Get a contact list, Get contact's lists; contacts -> Filter contacts | `contacts:read` | *missing:* What is on the list is readable; where it came from is not. Nothing records the definition, the import or the search behind a list, so the second half of the question has no answer here — and it must not be improvised from the list's name, which is the one place a wrong answer will look plausible. |
| `list_membership.add` | `control` | `auto` | `direct` | contact-lists -> Add contacts to a contact list, Move contacts to a contact list | `contacts:write` | Add and Move are different acts: Move takes people off wherever they were. Reconcile afterwards by filtering contacts by the list, because the count asked for and the count that landed differ often enough to matter. |
| `list_membership.remove` | `control` | `auto` | `absent` | contact-lists -> Move contacts to a contact list | — | *because:* not evidenced — the contact lists group documents adding and moving and nothing that takes a person off a list. Move relocates people to another list rather than removing them, so using it as a removal quietly files them somewhere else. This is the gap that makes a mis-built list expensive, and the honest response is to get the list right before it is written rather than to plan on trimming it. |
| `list.delete` | `control` | `confirm_once` | `direct` | contact-lists -> Delete a contact list | `contacts:write` | Check what still references it first — no campaign binding is reported back, and nothing after the fact will tell you what broke. |
| `audience.assess` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface judges whether a set of people is fit to work. Duplicates cannot be listed, contactability is not modelled, and address verification is a separate metered job over contacts rather than over a list. The assessment is therefore the agent's own and has to be reported as a judgement, not as something the product checked. |
| `audience.screen` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — nothing re-checks a list against the exclusion rules and takes the failures out. The blacklist rules can be read and a validation job can be run, but there is no removal from a list at all, so the second half of the operation has nowhere to land. |
| `contactability_policy.define` | `control` | `confirm_once`<br>*departs:* raised above the derived `auto`: it answers, per verdict and per flag, one of send, hold or never_send for every address the account will ever offer, and nothing in it has a default. | `absent` | — | — | *because:* not evidenced — the blacklist rules are individual exclusion entries for domains, addresses and exceptions, not a policy answering send, hold or never_send per verdict and per flag. Reporting them as one would leave every verdict the rules do not mention silently defaulting to send, which is exactly the failure the policy exists to prevent. |
| `contactability_policy.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — there is no policy to read, only the individual blacklist entries. |

The contract's own classification of these operations — the full five properties, the check before repeating, the invariants they enforce — is in `catalog-03-audiences.md`, in the `sdr-operations` skill. What this adapter does not reach, and why, is collected in [fulfilment.md](fulfilment.md).
