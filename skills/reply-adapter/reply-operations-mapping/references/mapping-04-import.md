<!-- Generated. Do not edit by hand. -->

# Family 4 — Import · mapping

Generated from `fulfilment.yaml` in this skill. Edit that file, not this one.

*People and audience* · 5 operations, 5 with an entry · contract 2.0.0 · adapter `reply`

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
| `source.inspect` | `read` | `auto` | `absent` | — | — | *because:* not evidenced as an API surface, and rightly so — the file is inspected locally, before any call, which is what the import ordering this skill already carried says: inspect the source locally, zero API calls. There is no upload-and-profile endpoint and there does not need to be. Do the inspection, then show the user what would land, then ask. |
| `import.apply` | `control` | `confirm_once` | `composed` | contacts -> Import contacts, Filter contacts; background-jobs -> Get a background job | `contacts:write`, `other:read` | *order:* contacts -> Import contacts, then background-jobs -> Get a background job polled to a terminal state, then contacts -> Filter contacts by the target list to reconcile created, updated, skipped and failed against what was asked for.<br>A large import returns a job reference, not a result: the operation completes when the job reaches a terminal state, never when the call returns. A job that ends failed gets its body read for the reason — never blind-retry a bulk write, because the first attempt may have partially succeeded. The approval gate over the file, the count, the mapping, the dedupe policy and the target list belongs before the first call. |
| `import.list` | `read` | `auto` | `partial` | background-jobs -> List background jobs | `other:read` | *missing:* There is no import history. Imports appear as background jobs among every other kind of job, and the documentation does not say the listing can be filtered to imports, so the question is answered by reading a general job list and recognising them. Anything older than that listing retains is simply gone. |
| `import.get` | `read` | `auto` | `partial` | background-jobs -> Get a background job | `other:read` | *missing:* A job is identified by its own id, not by an import record, and the documentation does not state that the result carries a per-row ledger tying each source row to the contact it created or matched. Keep that reconciliation yourself at import time — after the fact it may not be recoverable at all. |
| `import.revert` | `control` | `confirm_once` | `absent` | — | — | *because:* not evidenced — nothing undoes an import. Bulk deleting the contacts is not a revert: it destroys people the import updated rather than created, and it cannot put back a field the import overwrote. Say the import is not reversible before it runs, which is the only moment at which saying it helps anyone. |

The contract's own classification of these operations — the full five properties, the check before repeating, the invariants they enforce — is in `catalog-04-import.md`, in the `sdr-operations` skill. What this adapter does not reach, and why, is collected in [fulfilment.md](fulfilment.md).
