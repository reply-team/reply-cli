<!-- Generated. Do not edit by hand. -->

# Family 20 — Measurement · mapping

Generated from `fulfilment.yaml` in this skill. Edit that file, not this one.

*The organisation around the work* · 10 operations, 10 with an entry · contract 2.0.0 · adapter `reply`

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
| `engagement.summarize` † | `read` | `auto` | `partial` | reports -> Get email reporting overview, Get calls reporting overview, Get tasks reporting overview, Get LinkedIn reporting overview, Get channel efficiency overview, Get team performance overview; sequences -> Get stats for all sequences, Get sequence stats | `reporting:read`, `sequences:read` | *missing:* The grouping is not an argument. Each report offers the one breakdown it was built for — by channel, by sequence, by team member — and a question that needs a different grouping has to be assembled from the rows behind the numbers instead. The measure set is likewise the report's, not the caller's.<br>These endpoints are rate-limited harder than the rest of the API: sequential calls, cached within the session, no polling. Report the window alongside every figure — two numbers are only comparable when the window and the basis match. |
| `engagement_event.list` | `read` | `auto` | `direct` | reports -> List email activity, List call activity, List task activity, List LinkedIn activity | `reporting:read` | One listing per channel — these are the rows behind the summary, and the route to any grouping the overviews do not offer. Same stricter rate limits. |
| `funnel.summarize` | `read` | `auto` | `partial` | reports -> Get email reporting overview, Get channel efficiency overview, List meetings | `reporting:read` | *missing:* No surface returns a ladder. The stages come from separate reads, and neither the denominator a stage is measured against nor how well that stage can be known at all is stated anywhere — the caller declares both and has to say so when reporting the result. Stages past the meeting are not covered by any of these. |
| `opportunity.summarize` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — checked against the endpoint index, nothing here carries opportunities or revenue. That answer lives in the CRM, and reporting meetings as though they were the far end of the funnel would overstate what is known. |
| `attribution.explain` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no attribution model is stated anywhere, so nothing can explain why an outcome was credited where it was, or what another model would have said. |
| `response_time.summarize` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no documented surface reports time from arrival to first touch, or from a reply arriving to it being answered. |
| `metric.describe` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — checked against the endpoint index, there is no enumeration or definition surface. What a figure means here is prose on its report page, read by a human, and it says nothing about how far the figure can be trusted. |
| `metric.compare` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — no surface compares two arms or reports a sample size and an interval. Two report calls placed side by side are not this operation: the arithmetic that says whether the difference means anything is the part that is missing. |
| `export.request` | `control` | `confirm_once`<br>*departs:* raised because an extract moves personal data out of the system where its handling rules are enforced. | `absent` | — | — | *because:* not evidenced — checked against the endpoint index, no general data export exists. The reporting listings return rows inline and paginated, which is a read rather than a bounded extract, and treating one as the other would move personal data with none of the handling an extract implies. |
| `export.get` | `read` | `auto` | `absent` | — | — | *because:* not evidenced — nothing produces an extract here, so there is none to collect. |

The contract's own classification of these operations — the full five properties, the check before repeating, the invariants they enforce — is in `catalog-20-measurement.md`, in the `sdr-operations` skill. What this adapter does not reach, and why, is collected in [fulfilment.md](fulfilment.md).
