<!-- Generated. Do not edit by hand. -->

# Family 19 — Accounts and buying groups · mapping

Generated from `fulfilment.yaml` in this skill. Edit that file, not this one.

*The organisation around the work* · 12 operations, 12 with an entry · contract 2.0.0 · adapter `reply`

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
| `account.get` | `read` | `auto` | `direct` | accounts -> Get an account | `contacts:read` | The record carries the owner, the stage it is in and how many people are linked to it. The verification read after any account write. |
| `account.search` | `read` | `auto` | `direct` | accounts -> Filter accounts, List accounts | `contacts:read` | Companies already held, never an outside database and never metered — matching the contract exactly. The discovery family is where an outside search belongs. |
| `account.update` | `control` | `auto` | `partial` | accounts -> Update an account | `contacts:write` | *missing:* The account's stage can be moved and the rest of the record edited, but the tier the contract names has no home on the record and neither does the reason for the change. The stages are whatever this account has declared, so resolve the words the user says against them before writing — a stage that does not exist is a guess. |
| `account.claim` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — there is no lease on an account here. Ownership can be changed, which is a different and heavier act: it does not expire by itself, and using it as a claim would leave the account permanently reassigned. |
| `account.release` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — nothing claims an account, so there is nothing to release. |
| `account_membership.create` | `control` | `auto` | `direct` | accounts -> Bulk add contacts to an account | `contacts:operate` | Bulk-shaped: reconcile every person in the response rather than reporting the call. Attach deliberately, so that four spellings of one company do not become four accounts. |
| `account_membership.list` | `read` | `auto` | `partial` | accounts -> List contacts for an account | `contacts:read` | *missing:* Who is attached, and no more. How each person came to be attached is not recorded, so the basis the contract wants on every row cannot be given, and whether someone is being touched right now needs a separate read against the sequence they are in. |
| `account_membership.delete` | `control` | `auto` | `direct` | accounts -> Bulk remove contacts from an account | `contacts:operate` | Detaches the person from the company; it does not delete the person and does not stop any outreach they are in. |
| `collision.check` | `read` | `auto` | `partial` | accounts -> List contacts for an account; sequence-contacts -> List contacts in sequence with extended state, Get a contact in a sequence | `contacts:read`, `sequences:read` | *missing:* Only outreach collisions are visible, and only by assembling them: the people on the account, then each one's state in the sequences they are in, then the owner on each record. A live customer, support or opportunity motion is invisible here — it lives in the CRM — so a clean answer from this check is not evidence that the company is free.<br>Re-run it immediately before enrolling. Collisions appear between planning and execution, and the gap is exactly where the embarrassing double-touch happens. |
| `buying_group.define` | `control` | `auto` | `absent` | — | — | *because:* not evidenced — people can be attached to an account, but nothing records what each of them does in a decision, so a group with roles cannot be expressed here. |
| `buying_group.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no group with roles is stored, so there is none to return. |
| `buying_group.enroll` | `act`<br>*conditional:* bookkeeping while the campaign is not live, `act` the moment it is, with reach equal to the members it will contact; resolved by the same preview as `campaign.enroll`. | `confirm_once`<br>*conditional:* confirm_once before go-live; confirm_once with a mandatory preview once live. | `absent` | — | — | *because:* not evidenced — no surface enrols a group as a group. Enrolling several people from one account one by one is a different act: nothing staggers them, orders them, or reacts to one person's reply on behalf of the others, and doing it by hand while calling it this operation would hide exactly the coordination the operation exists for. |

The contract's own classification of these operations — the full five properties, the check before repeating, the invariants they enforce — is in `catalog-19-accounts.md`, in the `sdr-operations` skill. What this adapter does not reach, and why, is collected in [fulfilment.md](fulfilment.md).
