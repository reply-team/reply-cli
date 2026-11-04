<!-- Generated. Do not edit by hand. -->

# What this adapter does not reach

Generated from `fulfilment.yaml` in this skill. Edit that file, not this one.

This file describes **one product's coverage of the contract**, and nothing else.
Every line in it is a statement about this adapter — never about the operations themselves. The
vendor-neutral layer exists precisely so that a capability this product lacks stays visible as an
unmet need rather than quietly disappearing from the set of things an SDR requires; deleting an
operation from the contract because this API has no endpoint for it would undo the layer entirely.

**Expect this file to be long, and read its length as the design working rather than failing.** No
provider covers the whole of an SDR's job, and a map that admitted only the parts one product happens
to reach would be a flattering map and a useless one. A gap recorded here costs a user one honest
sentence. A gap papered over with an adjacent endpoint costs them a broken run, wrong data, or a
message sent to someone who should never have received it — so when an operation is absent, say so
and name what the documentation says. Never substitute something that returns approximately the right
shape.

**Coverage.** 325 of 325 operations carry an entry — 43 direct, 6 composed, 84 partial, 192 absent. 0 have no entry at all: nothing is claimed about them in either direction, and they are named row by row, as *not assessed*, in their family mapping table. The table at the foot of this file is where to look for the shape of that silence.

## 01 — Discovery, enrichment and verification

*People and audience* · [mapping-01-discovery.md](mapping-01-discovery.md)

- `candidate.search` — **partial**
  - *Missing:* Preview answers how many and shows a capped sample, not the population. The whole result set exists only after Start a Live Data search, and Start is not a read: it buys the people and creates them as contacts. So "show me everyone this filter finds, before I spend anything" cannot be answered here.
  - *Surface:* live-data -> Preview a Live Data search, with the departments, industries, job titles, locations and seniorities typeahead pages that build the filter (documented Beta or Coming soon)
  - *Notes:* Beta, and say so as part of the plan rather than as a footnote at the end. Build the filter from the typeahead values instead of guessing accepted ones. Preview adds no prospects and consumes no credits, which is what makes it the safe half of this operation. The write scope on a read is what the page documents, not a mistake.
- `candidate.get` — **partial**
  - *Missing:* The read is per search, not per person: it returns a search and what it found, and there is no address for one found person on their own. Once Start has run, the person is an ordinary contact and is read with Get a contact — so the discovery surface stops being the place to look at exactly the moment the person becomes ours.
  - *Surface:* live-data -> Get a Live Data search, List Live Data searches (documented Beta or Coming soon)
  - *Notes:* Check List Live Data searches for an existing near-identical search before starting another one. A repeat spends again and returns a different world.
- `candidate.promote` — **partial**
  - *Missing:* There is no promote-these-ones surface. Start finds and buys in one act: it adds everyone the filter returns as prospects and consumes credits per resulting contact, so the selection has to be made in the filter and cannot be made from a reviewed result set. The per-item promotion ledger the contract requires has to be read back off the search rather than off the call.
  - *Surface:* live-data -> Start a Live Data search (documented Beta or Coming soon)
  - *Notes:* Preview before Start, always — Start spends the user's allowance and the mistake is only visible once it is paid for. Show who came back in the preview and let the user approve the filter itself. Start can optionally drop the found people into a sequence or a list; treat that as enrolment and hold it to the enrolment gate rather than letting it ride along.
- `company.search` — **absent**
  - *Because:* not evidenced — the preview reports a companiesCount, but the search returns and creates people. No documented surface returns companies from the outside world as companies. The accounts endpoints search only the companies we already hold, which is a different question and must not be offered as an answer to this one.
  - *Surface:* live-data -> Preview a Live Data search
- `company.resolve` — **absent**
  - *Because:* not evidenced — no documented surface decides which company four spellings of a name refer to. Accounts can be filtered by what we already hold, which finds an exact-ish match and says nothing about the three spellings that did not match.
- `contact.enrich` — **absent**
  - *Because:* Documented as available late August 2026 and not callable today. Say that, and name the date the documentation gives. Never substitute an unrelated endpoint.
  - *Surface:* contact-enrichment -> enrich by email, enrich by profile URL, find email, find phone
- `company.enrich` — **absent**
  - *Because:* not evidenced — the enrichment surface is about people, and firmographics on a company are not among its documented pages. The whole enrichment group is in any case documented as available late August 2026 and is not callable today.
- `employment.check` — **absent**
  - *Because:* not evidenced — nothing documented answers whether a person has left the company we have them at. There is no job-change monitoring surface, and the AI insights page that might touch on it is documented as available late August 2026 and is not callable today.
- `email_address.verify` — **partial**
  - *Missing:* Two things. It validates people we already hold, taken by contact id, so a raw address that is not a contact yet cannot be checked without creating one first. And it returns the channel's verdict only — the send, hold or never_send decision the contract asks for comes from a contactability policy this product does not hold, so that half is the agent's own judgement and must be reported as such.
  - *Surface:* email-validations -> Estimate email validation, Schedule email validation; background-jobs -> Get a background job
  - *Notes:* Three calls in order: Estimate first, because it reports the eligible count and what it would cost against the team's quota; then Schedule, which reserves credits and returns a job; then poll the job to a terminal state and read the verdicts. Estimate is how the user approves a spend before it happens, which makes skipping it the expensive shortcut.
- `phone_number.verify` — **absent**
  - *Because:* not evidenced — the enrichment surface looks a number up; nothing documented checks that a number we already hold is reachable or reports whether it is a mobile, a desk line or a virtual one. Finding and verifying are different acts and the line type is the part that changes what may be sent. The enrichment group is in any case not callable until late August 2026.
  - *Surface:* contact-enrichment -> find phone
- `enrichment_policy.define` — **absent**
  - *Because:* not evidenced — no documented surface stores a buying order, an acceptance predicate or a spend ceiling. Each metered call carries its own limits at call time, so nothing binds the next one, and there is no version or author to read back.
- `enrichment_policy.get` — **absent**
  - *Because:* not evidenced — there is no stored policy to read, since none can be defined.

## 02 — Contacts, identity and hygiene

*People and audience* · [mapping-02-contacts.md](mapping-02-contacts.md)

- `contact.resolve` — **partial**
  - *Missing:* Filtering answers one key set per call, so resolving a collection is one call per person, and what comes back is a match list rather than a verdict: nothing returns "same human, this confident, under this rule". Ambiguity between two candidate records is something the caller has to notice and decide, and nothing marks it.
  - *Surface:* contacts -> Filter contacts, Count filtered contacts
  - *Notes:* Email is the key that behaves. Every other key is a filter over fields, which finds people who look similar rather than people who are the same.
- `contact.restore` — **absent**
  - *Because:* not evidenced — the contacts group documents Delete a contact and Bulk delete contacts and nothing that brings one back. Treat a delete here as irreversible with no restore window, and say so before deleting rather than after.
- `provenance.set` — **absent**
  - *Because:* not evidenced — no documented surface records where a person's data came from or under what terms. A custom field could hold the text, and must not be reported as provenance: the contract's version carries the lawful basis the sending decision rests on, and a field with a source name typed into it proves nothing.
- `job_change.record` — **absent**
  - *Because:* not evidenced — nothing documented forks a record when somebody moves employer. Updating the company on the existing contact is the opposite of what the operation asks for: it destroys the history at the old employer, which is usually the reason we were talking to them.
- `cooldown.set` — **absent**
  - *Because:* not evidenced — no documented surface holds a person until a date and then releases them. Suppression is permanent until lifted by hand, which is a different promise, and offering it as a cooldown means a person we meant to come back to in Q4 is never contacted again.
- `contact.disqualify` — **absent**
  - *Because:* not evidenced — the contact status surfaces are about sequence participation and delivery outcomes, not about whether somebody is a prospect at all. The blacklist rules are suppression, a different act with a different meaning: using one for the other tells the user we may never contact this person, when what they said was that this person is not a fit.
- `contact.requalify` — **absent**
  - *Because:* not evidenced — there is no qualification state to reverse, since none can be recorded.
- `contact.normalize` — **absent**
  - *Because:* not evidenced — nothing documented rewrites records into a house format under a declared rule set while keeping what was there before. Bulk updates through the import path can overwrite values, which is not the same operation: it keeps no prior value and reports no rule set, so nothing can be undone or explained afterwards.
- `identity_policy.define` — **partial**
  - *Missing:* The decision exists as an argument on each import — skip existing, which never overwrites, or update existing — and nowhere else. There is no stored policy, no version, nobody recorded as having set it, and the matching rules themselves are not configurable. Every import re-decides the question, and two imports can disagree with nothing to notice it.
  - *Surface:* contacts -> Import contacts
  - *Notes:* Because the policy cannot live in the product, it has to be carried by whatever keeps the user's durable context, and re-confirmed at each import rather than assumed from last time.
- `identity_policy.get` — **absent**
  - *Because:* not evidenced — there is no stored identity policy to read back, only the choice made on each import, which is not recorded anywhere afterwards.
- `duplicate.list` — **absent**
  - *Because:* not evidenced — no documented surface reports suspected duplicates. Filtering can confirm that two records share an address once you already suspect it; nothing proposes the clusters in the first place, which is the entire operation.
- `duplicate.merge` — **absent**
  - *Because:* not evidenced — no documented surface combines two contact records into one. Deleting the loser and updating the winner is not a merge: it destroys the history the contract requires the merge to carry across, and there is no restore.
- `duplicate.link` — **absent**
  - *Because:* not evidenced — nothing records that two records are the same human while both have to stay.
- `duplicate.unlink` — **absent**
  - *Because:* not evidenced — there is no link to undo, since none can be made.
- `duplicate.reject` — **absent**
  - *Because:* not evidenced — no documented surface records a not-a-duplicate decision, so the same pair would be proposed again by anything that looks a second time.
- `field.retire` — **partial**
  - *Missing:* Delete, not retire, and nothing reports what still references the field before it goes. The check the contract requires before repeating — is this still used by a mapping, a filter or a template — has to be done by hand, and the documentation does not say what happens to the values already stored. Treat the loss as total until somebody demonstrates otherwise.
  - *Surface:* custom-fields -> Delete a custom field

## 03 — Audience and lists

*People and audience* · [mapping-03-audiences.md](mapping-03-audiences.md)

- `segment.define` — **absent**
  - *Because:* not evidenced — filters are expressed per call and no documented surface saves one under a name. A contact list cannot stand in for a segment: it holds people, not a definition, it does not re-evaluate, and it cannot say who would match tomorrow.
- `segment.get` — **absent**
  - *Because:* not evidenced — there is no saved definition to show, since none can be saved.
- `segment.list` — **absent**
  - *Because:* not evidenced — there are no saved definitions to list.
- `segment.delete` — **absent**
  - *Because:* not evidenced — there is nothing to retire.
- `list.get` — **partial**
  - *Missing:* What is on the list is readable; where it came from is not. Nothing records the definition, the import or the search behind a list, so the second half of the question has no answer here — and it must not be improvised from the list's name, which is the one place a wrong answer will look plausible.
  - *Surface:* contact-lists -> Get a contact list, Get contact's lists; contacts -> Filter contacts
- `list_membership.remove` — **absent**
  - *Because:* not evidenced — the contact lists group documents adding and moving and nothing that takes a person off a list. Move relocates people to another list rather than removing them, so using it as a removal quietly files them somewhere else. This is the gap that makes a mis-built list expensive, and the honest response is to get the list right before it is written rather than to plan on trimming it.
  - *Surface:* contact-lists -> Move contacts to a contact list
- `audience.assess` — **absent**
  - *Because:* not evidenced — no documented surface judges whether a set of people is fit to work. Duplicates cannot be listed, contactability is not modelled, and address verification is a separate metered job over contacts rather than over a list. The assessment is therefore the agent's own and has to be reported as a judgement, not as something the product checked.
- `audience.screen` — **absent**
  - *Because:* not evidenced — nothing re-checks a list against the exclusion rules and takes the failures out. The blacklist rules can be read and a validation job can be run, but there is no removal from a list at all, so the second half of the operation has nowhere to land.
- `contactability_policy.define` — **absent**
  - *Because:* not evidenced — the blacklist rules are individual exclusion entries for domains, addresses and exceptions, not a policy answering send, hold or never_send per verdict and per flag. Reporting them as one would leave every verdict the rules do not mention silently defaulting to send, which is exactly the failure the policy exists to prevent.
- `contactability_policy.get` — **absent**
  - *Because:* not evidenced — there is no policy to read, only the individual blacklist entries.

## 04 — Import

*People and audience* · [mapping-04-import.md](mapping-04-import.md)

- `source.inspect` — **absent**
  - *Because:* not evidenced as an API surface, and rightly so — the file is inspected locally, before any call, which is what the import ordering this skill already carried says: inspect the source locally, zero API calls. There is no upload-and-profile endpoint and there does not need to be. Do the inspection, then show the user what would land, then ask.
- `import.list` — **partial**
  - *Missing:* There is no import history. Imports appear as background jobs among every other kind of job, and the documentation does not say the listing can be filtered to imports, so the question is answered by reading a general job list and recognising them. Anything older than that listing retains is simply gone.
  - *Surface:* background-jobs -> List background jobs
- `import.get` — **partial**
  - *Missing:* A job is identified by its own id, not by an import record, and the documentation does not state that the result carries a per-row ledger tying each source row to the contact it created or matched. Keep that reconciliation yourself at import time — after the fact it may not be recoverable at all.
  - *Surface:* background-jobs -> Get a background job
- `import.revert` — **absent**
  - *Because:* not evidenced — nothing undoes an import. Bulk deleting the contacts is not a revert: it destroys people the import updated rather than created, and it cannot put back a field the import overwrote. Say the import is not reversible before it runs, which is the only moment at which saying it helps anyone.

## 05 — Campaign, schedule, windows and limits

*The programme* · [mapping-05-campaigns.md](mapping-05-campaigns.md)

- `campaign.list` — **partial**
  - *Missing:* State comes back; health does not. Nothing in the listing separates a campaign that is fine from one that is not progressing, degraded or blocked, so "what is running, and what is quietly broken" needs a second pass over stats and sender health — and that verdict is this adapter's judgement, not a field it read.
  - *Surface:* sequences -> List all sequences, Count sequences; sequence-folders -> List sequences in a folder
- `campaign.update` — **partial**
  - *Missing:* Owner moves through its own endpoint, so one conceptual update is two calls. Beyond that there is no declared successor and no personalisation tier on the sequence: a campaign that hands over to another one cannot say so here and has to be tracked outside the product.
  - *Surface:* sequences -> Update a sequence, Change sequence owner
  - *Notes:* The update is last-write-wins — read the campaign first, or a field nobody meant to touch is reverted by a call that only meant to change the name. The owner endpoint is separate and may carry its own scope; take it from its page.
- `reply_policy.set` — **partial**
  - *Missing:* One switch, not a decision per event class: a reply either finishes the person or sending continues, and that is the whole vocabulary. There is no per-event-class routing and no attribution window, so "a reply within thirty days still counts as this campaign's" cannot be expressed at all.
  - *Surface:* sequences -> Update a sequence
  - *Notes:* Continuing to send after a reply is the setting that keeps writing to somebody who already answered. The contract raises this to confirm_once for exactly that reason, and learning it is one field on an update endpoint changes nothing about the confirmation.
- `schedule.set` — **partial**
  - *Missing:* Windows per day and the timezone policy are there, including sending in the prospect's own timezone rather than the schedule's. A delay basis and an out-of-window behaviour are not: nothing states whether a touch falling outside a window defers to the next open one or is skipped, so the defer-or-skip decision the contract makes the user take has no setting to carry it. Holidays are all-or-nothing per schedule.
  - *Surface:* schedules -> Create a schedule, Update a schedule, Set default schedule; sequences -> Update a sequence to attach it
  - *Notes:* Two calls: create or update the schedule, then attach it through the sequence update. A schedule is a shared object, so changing one silently rewrites every future date on every campaign pointing at it — which is the damage the contract's confirm_once is guarding against. Check who else uses it before editing rather than after.
- `pacing.set` — **partial**
  - *Missing:* People admitted per day, messages per day and a minimum gap between sends all exist, and so does a same-domain cap the contract does not ask for. Jitter and the cold-start ramp do not: a new campaign runs at its full configured rate from day one unless somebody raises the numbers by hand over several days, and nothing records that they intended to.
  - *Surface:* sequences -> Update a sequence
  - *Notes:* These are per-campaign, which is the point of the operation — slowing this campaign without slowing everything else on the same mailbox. Ceilings that belong to the sending capability itself are set elsewhere and are not reachable from here.
- `sender_binding.set` — **partial**
  - *Missing:* Binding is per campaign only — named participations cannot be bound. And the documentation does not say what happens to people already mid-campaign when the binding changes, so the preview the contract requires, the one telling a user which live threads are about to change From address, cannot be produced from this API.
  - *Surface:* sequence-email-accounts -> Assign email account to sequence, Set sequence email accounts, Remove email account from sequence; sequence-linkedin-accounts -> Assign a LinkedIn account to a sequence
  - *Notes:* Because the live-participation behaviour is undocumented, treat a rebinding on a running campaign as an act with an unknown blast radius: pause, rebind, read back, resume. Confirm the sender is healthy before binding it to anything.
- `campaign.validate` — **absent**
  - *Because:* not evidenced — no documented surface answers whether a campaign is safe to turn on. The pieces a validation would read do exist separately, as steps, sender assignments, the schedule and the enrolled count, so the check is assembled by the agent out of several reads and reported as its own work. Never report it as something the product verified: an unpublished template or a schedule that never opens will not announce itself.
- `campaign.test` — **partial**
  - *Missing:* It tests a template, not the campaign. There is no surface that sends step one exactly as a real contact would receive it, the documentation places no restriction on the recipient address, and nothing checks that the unsubscribe mechanism in the message actually works. The contract's test — receive it yourself, click the unsubscribe link, and only to an address the workspace can demonstrate it owns — is only partly reachable.
  - *Surface:* email-templates -> Send a test email, Render an email template
  - *Notes:* A test send is still a send and still metered, so the contract's confirm_each stands. Say which parts were tested and which were not, rather than reporting a green test.
- `campaign.freeze` — **partial**
  - *Missing:* Neither route is a freeze. A pause carries no expiry and never resumes itself, so the thing that makes a freeze safe — that somebody forgetting about it is not a failure — is gone. A dated holiday calendar does expire by itself, but it suppresses at the schedule, and a schedule may be shared by campaigns nobody meant to stop.
  - *Surface:* sequences -> Pause a sequence; or holiday-calendars -> Create a holiday calendar with schedules -> Link a holiday calendar to a schedule
  - *Notes:* Say which route was taken and what it costs. A pause leaves the resume as a human's job, so it belongs in whatever carries work across sessions rather than in someone's memory. A linked calendar needs a check of which other campaigns point at that schedule, before linking.
- `campaign.unfreeze` — **partial**
  - *Missing:* No preview of what letting it go early releases. The contract wants the count of messages that go out the moment the suppression lifts, and nothing here produces one, so the user is approving a release whose size nobody has been told.
  - *Surface:* sequences -> Start a sequence; or schedules -> Unlink a holiday calendar from a schedule
  - *Notes:* Work the release out from the enrolled counts and the pacing before asking for the confirmation, and say out loud that the number is an estimate rather than a reading.
- `schedule.resolve` — **absent**
  - *Because:* not evidenced — nothing documented returns a resolved calendar. The schedule can be read and so can a linked holiday calendar, but the day-by-day answer for a campaign or for one person, showing what a weekend, a holiday or a closed window moved, has to be computed and cannot be checked against anything.
- `send_window.resolve` — **absent**
  - *Because:* not evidenced — no documented surface answers when one person may be contacted on one channel. Some inputs are readable, being the schedule's windows, its timezone policy and its linked holiday calendars, but legal quiet hours in the recipient's local time and operator blackouts are not modelled at all, so the parts that carry legal weight are the ones missing.
- `blackout.define` — **partial**
  - *Missing:* Named date ranges exist, with an annual-repeat flag. Defer-or-skip does not: nothing states whether the touches a range stops come back afterwards or are lost, which is half of what the contract asks the user to decide. Nor does the create call take the region the range applies to, so whose region applies cannot be stated at the moment the range is drawn.
  - *Surface:* holiday-calendars -> Create a holiday calendar, Update a holiday calendar; schedules -> Link a holiday calendar to a schedule
  - *Notes:* A calendar suppresses nothing until it is linked to a schedule, and it then applies to every campaign on that schedule. Linking is the act; creating is not, and reporting the create as the blackout is how a holiday range ends up suppressing nothing.
- `blackout.remove` — **partial**
  - *Missing:* The lift itself works. The preview does not: nothing says whether removing a range opens a window that is open right now on a live campaign, or how many messages go out as a result — and that preview is what the contract uses to decide whether this is an act at all. Here it has to be reasoned out instead of read.
  - *Surface:* schedules -> Unlink a holiday calendar from a schedule; holiday-calendars -> Delete a holiday calendar
  - *Notes:* Unlink lifts the suppression for one schedule; delete removes the calendar from every schedule that used it. They are different-sized acts, and the user should be told which one is being proposed before they agree to it.
- `frequency_policy.define` — **absent**
  - *Because:* not evidenced — no documented surface caps how often one person, account or domain hears from us across campaigns. The per-campaign same-domain limit is the nearest thing and is a different promise: one campaign's contacts-per-domain-per-day, not a cross-campaign, cross-channel cap. Offering it as one would let three campaigns touch the same person in a day while the limit reports as respected.
- `frequency_policy.get` — **absent**
  - *Because:* not evidenced — there is no cap to read, since none can be defined, and the per-campaign same-domain limit answers a different question.
- `capacity.estimate` — **absent**
  - *Because:* not evidenced — nothing projects whether a plan can physically run. Sending capacity, pacing and existing load are each readable somewhere, but no surface puts them against a planned volume over a stated horizon. Any answer is the agent's own arithmetic over several reads and has to be reported that way, with the reads it rests on named.

## 06 — Steps, content and content policy

*The programme* · [mapping-06-steps.md](mapping-06-steps.md)

- `step.add` — **partial**
  - *Missing:* Position is not settable. The create body has no position, order or index field, so a step lands after the ones already made and no reorder endpoint exists to correct it. Content is inline on the step rather than bound to a template version, so a step cannot reference published copy. A branch is expressed as a condition step plus a parent reference and a positive-or-negative flag, and the evaluation window and early-satisfaction behaviour the contract asks for have no field at all.
  - *Surface:* sequence-steps -> Create a sequence step, Bulk create sequence steps
  - *Notes:* Channel and kind arrive together as one discriminated type — email, LinkedIn with its own action subtype, call, SMS, WhatsApp, task, condition — and the delay is a single minutes value, so the contract's unit and basis have to be reduced to minutes before the call. Complex step work, notably variants on a live sequence and LinkedIn steps, is often better handed to the product's own editor than approximated here. Say so and hand off rather than guessing.
- `step.update` — **partial**
  - *Missing:* The step type is a discriminator and cannot be changed, so moving a step to another channel means delete and re-add, which loses the step's variants with it. Position is out of reach here for the same reason it is in step.add.
  - *Surface:* sequence-steps -> Update a sequence step
  - *Notes:* A full replacement rather than a patch — read the step first and resend every field you are not changing, or the delay and the copy you left out are gone. Nothing in the documentation restricts the call while the sequence is live, so the in-flight statement the contract requires is the agent's obligation and not the API's.
- `step.reorder` — **absent**
  - *Because:* Neither Create a sequence step nor Update a sequence step exposes a position, order or index field, and no reorder endpoint is documented. Steps sit in the order they were created. Delete and re-add is not a substitute — it destroys variants and their measurement history, which is the exact loss this operation exists to prevent.
- `template.create` — **partial**
  - *Missing:* No draft state. A template exists in one state and is usable the moment it is created, so the contract's guarantee that unreviewed copy cannot be sent is not enforced by the product and has to be carried by the approval gate instead.
  - *Surface:* email-templates -> Create an email template
  - *Notes:* Folders organise templates — read List email template folders and List email templates first, because reuse beats proliferation here as much as it does for lists.
- `template.update` — **partial**
  - *Missing:* No versioning. The update replaces the content in place and no earlier version is kept, so the rule that a change always produces a new draft and never mutates published copy cannot be honoured. Keep the previous text yourself if anyone may need it back.
  - *Surface:* email-templates -> Update an email template
  - *Notes:* Steps hold their copy inline, so changing a template does not change what a live campaign sends. Those are two separate edits, and which one the user actually asked for is worth settling before either.
- `template.get` — **partial**
  - *Missing:* No version list, no published or retired state, and no list of what binds it — steps carry their own copy, so there is nothing to report as a dependent.
  - *Surface:* email-templates -> Get an email template, Get template variables
  - *Notes:* Get template variables is the read that says which merge fields the copy needs, before anyone renders it against a real person.
- `template.list` — **partial**
  - *Missing:* The second half of the question. Folders say where a template sits; nothing says whether its copy is draft, published or retired, because those states do not exist here.
  - *Surface:* email-templates -> List email templates, List email template folders
- `template.publish` — **absent**
  - *Because:* No version lifecycle is documented for templates. There is no draft, no published version and no publish endpoint — a template is usable from the moment it exists. Never present creating or updating one as publishing it.
- `template.retire` — **absent**
  - *Because:* The same absent lifecycle. Delete an email template destroys the template rather than retiring a version, and it cannot answer the question this operation is really asking — which live campaigns still depend on this copy — so it must not be substituted.
- `content_policy.define` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. The blacklist rules govern which addresses and domains may be contacted, not what the copy may say, and substituting them answers a different question entirely.
- `content_policy.list` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `content_policy.check` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Nothing takes a rendered message and returns the rules it breaks, so copy has to be checked against the account's rules outside the product before it is approved.

## 07 — Messages

*The programme* · [mapping-07-messages.md](mapping-07-messages.md)

- `message.draft` — **partial**
  - *Missing:* The render returns a subject and a body and nothing else. The footer, the identification block and the unsubscribe mechanism the contract requires the draft to show are absent from the response, so what is previewed cannot be proved to be the whole of what would leave. Merge values that are missing or wrong are reported, which is the part it does keep.
  - *Surface:* email-templates -> Render an email template, Get template variables
  - *Notes:* Renders against one contact identifier, optionally in the context of a campaign and a sending identity so their variables resolve too. Two other renders exist and both carry a beta mark — Get sequence preview for a contact under sequence-contacts, and Generate an AI draft reply under inbox — so say beta out loud before planning a route through either.
- `message.send` — **partial**
  - *Missing:* Inside a thread, only a reply. The contract's message.send is one message to one person on one channel, including the first one: from reply-cli 0.17.0 the direct sends (an email, a LinkedIn message, InMail or voice message) send the first one outside any campaign, where the account's Reply has the route; inside a campaign a first message is the campaign's step, with no surface here.
  - *Surface:* inbox -> Send a reply within a thread
  - *Notes:* The reply goes out on the thread's own channel. If that channel's account is disconnected the send fails — tell the user to reconnect, and never switch channel silently. Where the runtime carrying the work passes the reserved `provider` key inside the operation's arguments, `args.provider`, and the send is a direct send by email, that object is `{"schedule_id": "<id>"}` and nothing else: the `id` of a schedule from `reply schedule list`, written as a string of its digits. It goes as `--schedule-id` (from reply-cli 0.17.0). Another shape or another key is refused before anything is sent, with a message naming the shape; write the object in that shape and ask again. Reply refuses a schedule on every LinkedIn direct send in this version (scheduleId is not supported for LinkedIn sends in this version, a 400 on each LinkedIn route), so a schedule on a LinkedIn message is refused before any call. A message composed as a template goes by the same command, in Reply's own syntax, and Reply fills it in for the contact: a send Reply makes within the call is filled in before anything goes and refused with nothing sent where Reply cannot fill it; one held for a later moment or a schedule, or queued behind the account's other sends, is filled in when it goes and fails then. The codes, the names Reply lists, the LinkedIn sending account's two names and the formats that are never filled in are under reply-api, Direct sends, Templates.
- `message.schedule` — **partial**
  - *Missing:* Only a send outside any campaign, and only where the account's Reply has the route. From reply-cli 0.17.0 the direct sends take `--send-after`, a moment with its offset, which the CLI sends as UTC, and Reply holds the send until then; a moment already past is sent at once. A Reply that does not keep a direct send for later answers a bare 404, and nothing is scheduled. The contract's read before repeating — the pending sends for this person on this thread — has no list surface here: a harness that keeps the reference reads and cancels by it.
  - *Surface:* direct-outreach -> the direct sends (an email, a LinkedIn message, InMail or voice message, and Send a LinkedIn connection request to a contact), each with its send-after moment
  - *Notes:* From reply-cli 0.17.0, send with `--idempotency-key`, which goes as the Idempotency-Key header: the same request repeated under the same key answers the send Reply took and sends nothing twice, so a lost answer is repeated under the key rather than read around. Reply honours the key only where it has the direct-send routes, so read `reply direct-send get` of a reference first (from reply-cli 0.17.0): its own `direct_send.not_found` or `direct_send.not_owned` says the routes are there, a bare 404 says they are not, and a key sent there protects nothing. The answer names the send's `reference` and its `state`: `sent` means it went, `failed` and `cancelled` are final, and any other state means Reply holds it and it has not gone yet. Keep the reference; it is the only handle on the send, and after a lost answer `reply direct-send get` of it is read before any repeat. Reply keeps a key for a day, so a repeat goes under it only within 23 hours of the first try; past that, nothing is sent again. From reply-cli 0.17.0 an email direct send also takes `--schedule-id`, a schedule from `reply schedule list`; Reply refuses it on every LinkedIn route. Reply then holds the send until the schedule's first opening at or after the moment, or after now where none is given, and the answer names no moment: Reply estimates one only where the schedule opens within 30 days, and reply-cli does not pass the estimate. A manual-email task dated for the 14th is still queued work for a person, not a queued send.
- `scheduled_message.list` — **absent**
  - *Because:* No surface lists the pending sends — not by person, campaign or sender. From reply-cli 0.17.0, `reply direct-send get <reference>` reads one send by its reference — its state, its moment, when it went and why it failed — which answers for a send already known and never for "what is queued". A harness that keeps the reference reads and cancels by it.
- `scheduled_message.cancel` — **partial**
  - *Missing:* By reference only, and only where the account's Reply has the route. From reply-cli 0.17.0, `reply direct-send cancel <reference>` cancels one direct send still held for its moment. Nothing lists the pending sends, so a harness that keeps the reference reads and cancels by it; a send whose reference was not kept cannot be found to cancel. What is pending in a live participation is still the next touch of a campaign, and stopping that is enrollment.pause or enrollment.stop rather than this.
  - *Surface:* direct-outreach -> the direct send's cancel, by its reference
  - *Notes:* A cancel of a send already cancelled is a success, and one whose answer was lost is safe to run again. A send that has gone answers `direct_send.already_sent` and one that failed `direct_send.already_failed`: report it as gone or failed, never as cancelled. A bare 404 means the account's Reply does not have the route yet.

## 08 — Enrollment

*The programme* · [mapping-08-enrollment.md](mapping-08-enrollment.md)

- `enrollment.pause` — **partial**
  - *Missing:* No reason is accepted and there is no dated automatic resume. The hold is a bare status, so why someone was held and when they should carry on again survive only wherever the agent chooses to write them down.
  - *Surface:* sequence-contacts -> Set contacts' status in this sequence
  - *Notes:* At most one hundred people per call, and only a participation that is currently active can be held. The response returns failures keyed by person and an empty object when every one succeeded — reconcile per person rather than reading that empty object as a count.
- `enrollment.resume` — **partial**
  - *Missing:* Setting a participation back to active is accepted from any current state, so the refusal the contract requires — resume only what is actually held — is not enforced by the API. The check-first read has to perform it, or a finished participation is quietly restarted and someone is written to again.
  - *Surface:* sequence-contacts -> Set contacts' status in this sequence
  - *Notes:* On a live campaign this sends. The preview naming who resumes is the approval artefact and knowing which endpoint performs the call softens nothing about that.
- `enrollment.stop` — **partial**
  - *Missing:* The mandatory reason. The body carries identifiers and nothing else, so neither why someone was taken out nor that a different person was the cause can be recorded — and naming that other person is part of the operation, not a nicety. Record the reason wherever the run itself is recorded.
  - *Surface:* sequence-contacts -> Remove contact from sequence, Bulk remove contacts from sequence
  - *Notes:* The bulk response counts requested, removed, not found and not in sequence, and lists the identifiers actually removed. An already-absent participation reads as a completed stop.
- `disposition.set` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Marking someone replied or bounced records what happened to a message, and an inbox category records what a reply meant; neither is the business outcome of the participation, and pressing one into service as a stand-in corrupts the number people are measured on.

## 09 — Conversations and activity

*The conversation, the queue and the day* · [mapping-09-conversations.md](mapping-09-conversations.md)

- `conversation.classify` — **partial**
  - *Missing:* The meaning is recorded, its provenance is not. No field carries who decided it, which message they decided it from, or how sure they were, so a category set by a model and one set by a person are indistinguishable afterwards.
  - *Surface:* inbox -> Assign or clear a thread's category, Assign threads to a category
  - *Notes:* The vocabulary is the account's own inbox categories — read List inbox categories first and map onto what exists rather than inventing a label. Re-read the thread to confirm it took.
- `conversation.assign` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Assign threads to a category and Assign or clear a thread's category move a thread between categories, not between people, and the resemblance in the names is exactly the trap. Changing who owns the person is a different act with different consequences and is not a substitute.
- `conversation.snooze` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Nothing takes a thread out of the queue and brings it back on a date.
- `conversation.close` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Mark threads as read records a read state, not a worked one, and deleting a thread destroys it. Neither says the thread was dealt with, which is the whole of what closing one means.
- `conversation.reopen` — **absent**
  - *Because:* Nothing closes a thread here, so nothing reopens one. Mark threads as unread is the nearest surface and it says something else.
- `referral.record` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. The pieces exist separately, since the named person can be created and the referrer can be taken out of the campaign, but nothing records that the one came from the other — and that link is the only fact that justifies contacting a stranger, so performing the two calls without it is not the operation.
- `activity.log` — **partial**
  - *Missing:* Only the note. A free-text note is one of the things this operation records; an email sent from a personal client, a conversation in a corridor, or a message on a channel we do not send from cannot be logged as an activity with its channel, direction and time, so the record stays an incomplete account of what happened to this person.
  - *Surface:* contacts -> Add a note to a contact
  - *Notes:* Get activities for a contact is the read that shows what the product recorded itself, and a note is not guaranteed to appear in it. Check before telling the user the record is whole.

## 10 — Task queue and touches

*The conversation, the queue and the day* · [mapping-10-tasks.md](mapping-10-tasks.md)

- `task.skip` — **absent**
  - *Because:* The documented task states are new, finished, cancelled, archived and detached from a campaign, and none of them is skipped. The update endpoint cannot set a state at all, so declining a task while recording that it was declined has no surface. Completing it instead would put a lie in the record.
- `task.cancel` — **partial**
  - *Missing:* Dropping the work is possible, recording that it was deliberately dropped is not. Deletion destroys the task, and the cancelled state the documentation describes cannot be set through the update endpoint, so afterwards nothing distinguishes work called off from work that was never there.
  - *Surface:* tasks -> Delete a task, Bulk delete tasks
  - *Notes:* Say the deletion is irreversible before doing it. The contract treats this operation as compensatable and on this surface it is not, which is a difference the user has to hear first rather than discover.
- `call.place` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Execute and complete a task, the only endpoint that performs a task's action, supports manual email and SMS and rejects every other type, so a call task cannot be dialled through the API. Calls are placed in the product, and the user needs telling that plainly.
- `call.log` — **absent**
  - *Because:* not evidenced — call activity is readable through reporting, under Get calls reporting overview and List call activity, and nothing writes one. A call that happened away from the product cannot be recorded here.
- `call_recording.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this, and none for the agreement that permitted the recording either.
- `call_recording.discard` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. A recording that has to be destroyed must be dealt with in the product, and that has to be said out loud rather than left for the user to assume an agent handled it.

## 11 — Meetings, qualification and handoff

*The conversation, the queue and the day* · [mapping-11-meetings.md](mapping-11-meetings.md)

- `meeting.propose` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Nothing offers times and nothing hands over a way to pick one. Toggle thread meeting-intent marks that a thread is about a meeting and proposes nothing, so it must not be read as a booking surface.
- `meeting.book` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Meetings appear in reporting as facts that already happened; no endpoint creates one, issues an invitation, or records a meeting that was invited elsewhere.
- `meeting.confirm` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. There is nothing to read a meeting's attendee responses from and nothing that chases the people who have not answered.
- `meeting.reschedule` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. With no booking surface there is no meeting here to move.
- `meeting.cancel` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Tell the user to cancel it in the calendar rather than leaving someone expecting a meeting nobody will attend.
- `meeting_outcome.record` — **absent**
  - *Because:* not evidenced — the meetings report carries when a booking was made, by whom, from which campaign and on which channel, and no outcome field of any kind. Held, no-show and cancelled beforehand cannot be told apart here, which also means meeting outcomes cannot be read back out of this product later.
- `meeting.list` — **partial**
  - *Missing:* A booking ledger rather than a calendar. A row gives who booked it, the channel it came from, the person, the campaign and when the booking was made — not when the meeting is, who is attending, how to join, or how it went. Nothing upcoming can be answered from it and no outcome can be read out of it.
  - *Surface:* reports -> List meetings
  - *Notes:* Filterable by date window and by user, so it does answer how many meetings were booked and by whom over a stated period. Measurement is rate-limited harder than the rest of the surface — sequential calls, cached within the session, no polling.
- `meeting.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. The reporting list is the only place a meeting appears at all and it has no per-meeting read.
- `qualification.record` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Custom fields could be made to hold the answers, but that is a schema somebody would have to invent, and inventing it here would produce a record no other run could read back.
- `handoff.create` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Changing who owns a person moves the record; it makes no offer, starts no clock, and can be neither accepted nor refused, so it is not this operation.
- `handoff.accept` — **absent**
  - *Because:* Nothing creates a handoff here, so there is nothing to accept and no commitment clock to start.
- `handoff.reject` — **absent**
  - *Because:* Nothing creates a handoff here, so there is nothing to refuse.
- `handoff.return` — **absent**
  - *Because:* Nothing creates or accepts a handoff here, so there is nothing to give back.
- `handoff.withdraw` — **absent**
  - *Because:* Nothing creates a handoff here, so there is nothing to pull back.
- `handoff.list` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Nothing shows what has been handed over and left unanswered, in either direction.
- `handoff.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `opportunity.create` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. A conversion into a deal is recorded wherever the pipeline lives, and this adapter has no view of that. Name the system the user should record it in rather than approximating it with a field on a person or an account.

## 12 — Signals and triggers

*The conversation, the queue and the day* · [mapping-12-signals.md](mapping-12-signals.md)

- `signal.list` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Nothing reports that someone changed job, visited a page, raised funding or engaged publicly.
  - *Notes:* ai-sdr-intent-signals -> Industries typeahead, Technologies typeahead is the nearest thing and it is not this: it resolves the words a user says into values a prospect search accepts. Offering it here answers a different question than the one asked.
- `signal.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Without a feed there is nothing to read one observation from.
- `signal.acknowledge` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `signal_policy.define` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Nothing arbitrates between two things firing on the same person, because nothing fires.
- `signal_policy.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `trigger.create` — **partial**
  - *Missing:* Only the watching half. A subscription delivers a named event to a listener outside the product; the rule's other half — producing work in response — has no surface, so the acting side must live in the agent runtime. The watchable set is fixed and product-side (message sent, opened, clicked, replied, bounced; contact opted out or finished; connection request sent and accepted; account connection lost or erroring), so a rule that must watch something outside that set cannot be expressed at all.
  - *Surface:* webhooks -> Create a webhook subscription, List supported event types
  - *Notes:* Read List supported event types before promising a rule — the event names are the whole vocabulary, and a trigger written against an event that is not on that list will never fire rather than failing loudly.
- `trigger.update` — **partial**
  - *Missing:* The same half as trigger.create: what the rule watches can be changed, what it produces cannot, because production is not in the product.
  - *Surface:* webhooks -> Update a webhook subscription, Enable a webhook subscription, Disable a webhook subscription
  - *Notes:* "Switch it off without losing it" maps exactly onto Disable, which is the reversible move. Deleting a subscription to stop it and re-creating it later is not the same act and loses the subscription's history.
- `trigger.list` — **partial**
  - *Missing:* What each rule watches is listed; what it produces is not, and cannot be, since the producing half is external. Report the watch, and say plainly that the action behind it is the runtime's and not the product's.
  - *Surface:* webhooks -> List webhook subscriptions, List supported event types
- `trigger.delete` — **partial**
  - *Missing:* Removes the watch only. Whatever the agent runtime built on top of that event keeps existing and has to be taken down separately, or it becomes a rule waiting on an event that will never arrive again.
  - *Surface:* webhooks -> Delete a webhook subscription
- `trigger_run.list` — **partial**
  - *Missing:* Deliveries, not runs. The log says which event fired and whether it reached the listener; what work came out of it and what a policy held back are not recorded, because neither the work nor the policy exists on this side. Never report a delivery count as a count of work done.
  - *Surface:* webhooks -> Get webhook delivery logs

## 13 — Inbound

*The conversation, the queue and the day* · [mapping-13-inbound.md](mapping-13-inbound.md)

- `inbound_lead.record` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. There is no inbound-lead or form-capture group: an arrival has nowhere to be recorded as an arrival, with the clock the rest of this family depends on.
  - *Notes:* Do not simulate the queue out of tasks, contact owners or inbox categories. Those entities have their own meanings and their own operations, and an arrival modelled as a task loses the one thing that made it an arrival — the response clock.
- `inbound_lead.list` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `inbound_lead.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `inbound_lead.route` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. There is no routing rule — territory, existing owner, round-robin or availability — anywhere in the documentation.
  - *Notes:* Contact and account ownership can be changed, but changing an owner is not routing an arrival: it carries no rule, no queue and no clock, and reporting it as routing would claim a guarantee that was never made.
- `inbound_lead.claim` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `inbound_lead.release` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `inbound_lead.triage` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Nothing classifies what kind of request an arrival is.
  - *Notes:* Inbox categories classify reply threads on conversations we started. That is a different act on a different entity, and it is covered by its own contract operation.
- `inbound_lead.close` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `inbound_lead.reopen` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `response_policy.define` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. No response target can be stated, so none can be measured or breached.
- `response_policy.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.

## 14 — Consent, suppression and privacy

*Permission and capability* · [mapping-14-privacy.md](mapping-14-privacy.md)

- `outreach.precheck` — **partial**
  - *Missing:* It answers one question — is this person opted out or excluded on email — and the operation asks four. There is no channel dimension, so a social or phone precheck is not covered. There is no timing half, so "if not, when" cannot be answered. There is no consent basis and no external-register gate. Nothing says what would fix it. Say all of this before a user commits to a route that treats the precheck as sufficient.
  - *Surface:* contacts -> Get a contact's statuses; contact-blacklist-rules -> List email blacklist rules, List domain blacklist rules, List email exception blacklist rules
  - *Notes:* The result is stale the moment it returns, here as in the contract. Nothing about knowing which endpoint answers it changes that.
- `suppression.check` — **partial**
  - *Missing:* The "why". A rule carries its pattern and whether it is system-wide, and nothing else — no reason class comes back, so the answer is yes-or-no with no ground for it. Only email addresses and domains are covered; a number, a social profile or a whole account has no equivalent.
  - *Surface:* contact-blacklist-rules -> List email blacklist rules, List domain blacklist rules, List email exception blacklist rules
  - *Notes:* The listings filter by pattern, so a raw identifier can be checked without it being a contact in the system — which is the part of this operation that matters.
- `suppression.list` — **partial**
  - *Missing:* Three separate lists rather than one, and none of the three facets the operation promises: no scope, no reason class, no record of who added the entry. Numbers, social profiles and whole accounts are not represented at all.
  - *Surface:* contact-blacklist-rules -> List email blacklist rules, List domain blacklist rules, List email exception blacklist rules
- `suppression.add` — **partial**
  - *Missing:* "And here is why" has nowhere to go — no reason is recorded against a rule, so the reason has to be kept in the agent's own record or it is lost, and suppression.remove later has nothing to weigh. Numbers, social profiles and whole accounts have no equivalent.
  - *Surface:* contact-blacklist-rules -> Create an email blacklist rule, Create a domain blacklist rule, Bulk create email blacklist rules, Bulk create domain blacklist rules
  - *Notes:* The contract's read-before-repeating has a real surface here: search the listing for the pattern first. Adding a pattern that already exists is a refusal, so a blind retry is wrong.
- `suppression.remove` — **partial**
  - *Missing:* The evidence that licenses the lift is not recorded, and no retention floor is exposed to check against — so the one guard the contract puts on this irreversible act cannot be enforced by the product and must be enforced by the agent before the call. Email addresses and domains only.
  - *Surface:* contact-blacklist-rules -> Delete an email blacklist rule, Delete a domain blacklist rule, Bulk delete email blacklist rules, Bulk delete domain blacklist rules
- `optout.record` — **partial**
  - *Missing:* It records the exclusion, not the act. What they said, where it arrived, when they did it and when we learned of it have nowhere to go, so the evidence that this was their decision is not retained. The product carries its own opted-out state on a contact — readable through Get a contact's statuses — but no documented surface sets it.
  - *Surface:* contact-blacklist-rules -> Create an email blacklist rule, Bulk create email blacklist rules
  - *Notes:* This is the protective floor operation: recording that somebody said stop is performed first and reported immediately. A blacklist rule stops future sends, which is the effect that matters most; keep the act itself in the agent's own record alongside it.
- `optout.poll` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Nothing pulls un-ingested stop signals from the channel — one-click unsubscribes, list-unsubscribe requests, blocks or stop keywords.
  - *Notes:* The notification surface carries a contact-opted-out event. That is a push about an opt-out the product has already ingested, not the backlog of ones it has not, and the two are not interchangeable: subscribing to it tells you nothing about what is waiting at the channel.
- `optout.confirm` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. No opt-out confirmation exists as its own act, and no ledger records whether one was already sent.
  - *Notes:* A direct email to a contact can be sent, and using it for this is the substitution to refuse. This confirmation is exactly-once, non-promotional and may never require anything of the recipient; with no ledger to check, a second one is a breach rather than a duplicate, and nothing here would stop it.
- `consent.record` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. There is no permission record: what they were told, when, how it was captured and what it covers have nowhere to live.
- `consent.revalidate` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. With no basis recorded there is nothing to recompute and no contactability to downgrade.
- `consent.prove` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `notice.send` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Neither the delivery of a privacy notice nor the record that it was delivered has a surface.
- `disclosure.check` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `disclosure.record` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Nothing binds a disclosure to the message that carried it.
- `dnc_registry.check` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. No external do-not-contact register is reachable from here; the blacklist rules are our own list, not a jurisdiction's.
- `privacy_request.create` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. There is no privacy-request entity, so no clock starts and nothing later can be tied to a request.
- `privacy_request.update` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `privacy_request.refuse` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `privacy_request.fulfill` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. There is no recorded request to fulfil against, and no export of everything held about a person.
  - *Notes:* Contacts can be deleted, singly and in bulk. That is contact.delete, a different contract operation with a different meaning, and performing it must never be reported as fulfilling a privacy request: the request record is the whole point of this operation and it does not exist here.
- `deletion_feed.poll` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. No external erasure register is reachable from here.
- `deletion_feed.report` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `retention.apply` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. No storage limit can be stated or enforced, and no floor is exposed to stop at.
- `audit_log.search` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. There is no audit surface: who changed what, when, on our side is not answerable.
  - *Notes:* A contact's activity history is the record of outreach that touched that contact. It is not a record of our own changes, and it cannot answer why this person was contacted at all — which is the harder half of the question and the one that gets asked under pressure.

## 15 — Sending capability and deliverability

*Permission and capability* · [mapping-15-sending.md](mapping-15-sending.md)

- `sender.list` — **partial**
  - *Missing:* Two lists rather than one, and only two of the four capability classes. Mailboxes and social accounts are covered; numbers and business messaging identities have no group at all, so a channel the user asks about may be invisible rather than empty.
  - *Surface:* email-accounts -> List email accounts, Filter email accounts; linkedin-accounts -> List LinkedIn accounts, List pending LinkedIn accounts
  - *Notes:* Merge the two and label every row with its channel, or the caller cannot tell what it is looking at. Read the pending social list too: a half-finished connection must read as pending setup, never as absent, and leaving it out is how a sender that is nearly ready gets connected a second time.
- `sender.get` — **partial**
  - *Missing:* Identity, channel and configured pacing come back. Pool membership and registration do not, because neither concept exists here — see sender_pool.* and messaging_registration.*. Mailboxes and social accounts only.
  - *Surface:* email-accounts -> Get an email account; linkedin-accounts -> Get a LinkedIn account
- `sender.health` — **partial**
  - *Missing:* Connection state and configured limits are readable, and the mailbox read reports whether the provider has locked or throttled the account. Warm-up position, the channel's automation sanction, and any statement of how much of today's capacity is still available are not exposed — so three of the five things this operation promises have to be tracked by the agent or left unanswered. Numbers and business messaging identities are not covered.
  - *Surface:* email-accounts -> Get an email account, Test SMTP connectivity, Test IMAP connectivity; linkedin-accounts -> Get a LinkedIn account
  - *Notes:* The connectivity tests verify the credential actively rather than reporting a cached status, which is the difference that matters when an account looks fine and is not. A disconnected or erroring account is still a hard stop: this is a core operation and the launch chain refuses on it.
- `sender.connect` — **partial**
  - *Missing:* Mailboxes and social accounts only; numbers and business messaging identities have no surface. On the social channel the call produces a link a person has to complete, so the operation is not finished when the call returns.
  - *Surface:* email-accounts -> Create an email account, Connect Gmail account via OAuth, Connect Office 365 account via OAuth; linkedin-accounts -> Create a connection link, Create a direct connection link
  - *Notes:* Poll the pending social list until the account appears in the real one. Until then it is the contract's pending-setup state, and reporting it as connected is how a campaign gets launched against a sender that cannot send.
- `sender.disconnect` — **partial**
  - *Missing:* It deletes rather than detaches, and the guard the contract puts on this operation is absent: nothing refuses while live enrolments or open conversations still depend on the sender, and no rebind target can be supplied. The check is the caller's, and it has to happen before the call because there is nothing to undo afterwards.
  - *Surface:* email-accounts -> Delete an email account, Bulk delete email accounts; linkedin-accounts -> Delete a LinkedIn account, Bulk delete LinkedIn accounts
  - *Notes:* What is bound to a sender is readable only one campaign at a time (sequence-email-accounts -> List email accounts in sequence; sequence-linkedin-accounts -> List LinkedIn accounts for a sequence), so the check is a scan. On the social channel sender.pause is the reversible alternative and is usually what the user actually wants.
- `sender.reauthorize` — **partial**
  - *Missing:* Only the social channel has a reconnect that names the existing account. On a mailbox the documented route is re-running the provider connection, and nothing states that the history behind it survives — which is the whole promise of this operation. Verify by re-reading rather than assuming, and tell the user what you could not confirm.
  - *Surface:* linkedin-accounts -> Reconnect a LinkedIn account; email-accounts -> Connect Gmail account via OAuth, Connect Office 365 account via OAuth
- `sender.pause` — **partial**
  - *Missing:* Social accounts only. A mailbox has no documented pause — the resume surface exists with no counterpart — so on email the protective move has to be made one level up, at campaign.pause or by removing the sender from the campaign. Say which one you used, because they are not the same blast radius.
  - *Surface:* linkedin-accounts -> Toggle LinkedIn account status
  - *Notes:* The social call flips between enabled and disabled rather than setting a state. Read the account first: issued blind against an already-paused account it re-enables it, which turns the first move in an incident into the worst one.
- `sender.resume` — **partial**
  - *Missing:* Nothing refuses the resume on an invalid warm-up position, because no warm-up position is exposed at all — the contract's guard has to be enforced by the caller or it is not enforced. The mailbox surface is scoped to accounts the provider locked or throttled, not to an operator pause, and no operator pause exists on that channel.
  - *Surface:* email-accounts -> Resume sending; linkedin-accounts -> Toggle LinkedIn account status
  - *Notes:* Resolve the underlying problem before calling, then re-read the account to confirm the lock actually cleared. The social call flips rather than sets — read state first, same as with sender.pause.
- `sender_limit.set` — **partial**
  - *Missing:* The contract's one decision is two different surfaces, one per channel, and only the social one is a dedicated limits endpoint — on a mailbox the limits ride on the account update, so a careless call can overwrite settings the caller did not intend to touch. Numbers and business messaging identities have no surface.
  - *Surface:* linkedin-accounts -> Update LinkedIn account limits; email-accounts -> Update an email account
  - *Notes:* Read the limits in force first and re-read after: report what actually took, not what was requested. Lowering is protective; raising is the direction that needs the approval, and the mapping does not change that.
- `warmup_plan.set` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. No ramp can be defined, read or started, and no warm-up position is exposed anywhere in the API.
  - *Notes:* This is the absence that costs the most in this family: sender.resume refuses on the warm-up position, and with no position readable that refusal cannot be automated. Tell the user the ramp is theirs to hold, and hold it in the agent's own record.
- `message_element.set` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. The legal identification block, the postal address, the channel's stop artefacts and the tracking domain have no per-sender configuration surface.
- `sender.reserve` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. There is no allowance reservation, so two parallel runs against one sender can spend the same capacity twice and neither will be told.
- `sender.release` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Nothing to give back, since nothing can be claimed.
- `sender.summarize` — **absent**
  - *Because:* The per-sender figures surface is documented Coming soon and is not callable today. Say that rather than reaching for something adjacent, and check the page again before planning around it.
  - *Surface:* email-accounts -> Get email account stats, Filter email account stats
  - *Notes:* The reporting overview is account-wide, not per sender, and answers a different question. Substituting it produces a number that looks like this sender's and is not, which is worse than having none. Even when the stats surface opens, failures by class, complaints with their publisher and denominator, deferrals and throttles are not promised by it.
- `restriction.record` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. There is no restriction ledger, so a restriction cannot be recorded, counted, or carried forward.
  - *Notes:* The arrival of one is observable — the notification surface carries account-alert, connection-lost and account-error events, and the mailbox read reports a provider lock. What is missing is the durable record behind them. Keep it in the agent's own record: the recurrence count and the invalidated warm-up position both hang off it, and platforms escalate on how often a sender is restricted rather than on what for.
- `restriction.appeal` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. No appeal route is exposed; where the platform offers one it is outside this API, and saying so plainly is the correct answer.
- `sender_pool.create` — **partial**
  - *Missing:* There is no pool object. The grouping exists only as the set of senders bound to one campaign, so it cannot be named, cannot be created before the campaign exists, and cannot be reused by a second campaign without being rebuilt. Routing policy is not part of it.
  - *Surface:* sequence-email-accounts -> Set sequence email accounts, Assign email account to sequence; sequence-linkedin-accounts -> Assign a LinkedIn account to a sequence
  - *Notes:* Rotation across the bound senders is the product's own behaviour, so do not tell a user that sending across several senders is unavailable — that is a wrong answer, not a cautious one. What is unavailable is the reusable, named, independently routable pool.
- `sender_pool.update` — **partial**
  - *Missing:* Membership changes, one campaign at a time. The routing policy does not — and sticky per recipient in particular is not selectable, which on a conversational channel is correctness rather than optimisation. Say that before a user commits to a route that needs a recipient to keep hearing from the same sender.
  - *Surface:* sequence-email-accounts -> Set sequence email accounts, Assign email account to sequence, Remove email account from sequence; sequence-linkedin-accounts -> Assign a LinkedIn account to a sequence, Remove a LinkedIn account from a sequence
  - *Notes:* Setting the whole set replaces it. Read the current members first, or a call meant to add one sender silently removes the rest.
- `sender_pool.list` — **partial**
  - *Missing:* Pools cannot be enumerated. Every read is scoped to one campaign, so "what pools exist" is answerable only by walking every campaign, and how work routes across the members is not reported at all.
  - *Surface:* sequence-email-accounts -> List email accounts in sequence; sequence-linkedin-accounts -> List LinkedIn accounts for a sequence
- `sender_pool.delete` — **partial**
  - *Missing:* There is no pool to dissolve. Removing every binding leaves the campaign with no sender rather than dissolving a named group — nothing refuses it while the campaign is live and no replacement target can be supplied, so the campaign is left unable to send and nothing says so.
  - *Surface:* sequence-email-accounts -> Remove email account from sequence; sequence-linkedin-accounts -> Remove a LinkedIn account from a sequence
  - *Notes:* The capabilities themselves are untouched, as the contract expects: this removes bindings, not senders.
- `sending_domain.register` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Domains are not a first-class entity here; a sender carries its address and that is all.
- `sending_domain.list` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `sending_domain.retire` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `authentication_requirement.list` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. What has to be published for a domain to authenticate is not stated anywhere in the API.
- `domain_compliance.check` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. No verdict per publisher and per requirement is available, so a failing requirement cannot be named.
- `domain_reputation.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. No reputation signal, blocklist listing or dataset is exposed.
- `message_compliance.check` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Nothing evaluates a rendered message against what it will be held to: required elements, a working unsubscribe, or the reputation of the domains it links to.
  - *Notes:* The rendered message itself can be obtained (email-templates -> Render an email template, Send a test email), so the check can be performed outside the product against a real rendering rather than against the source. That is worth doing, and it is not this operation — report it as an external check.
- `placement_test.create` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. There is no seed-list send and no per-provider placement result.
  - *Notes:* The email-validation surface estimates and schedules address validation. That answers whether an address exists, never where a message lands, and offering it here would answer a deliverability question with a data-quality one.
- `placement_test.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `messaging_registration.submit` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. No brand or use-case registration exists, because the channels that require one before any send is permitted are not represented in this API.
- `messaging_registration.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `approved_content.submit` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. No content is submitted to a platform for pre-approval.
  - *Notes:* The pending-approval surface in the AI-SDR cluster is a person inside the organisation approving generated content before it sends. This operation is a platform gating content before we are permitted to send it at all. They are different actors with different consequences for refusal, and mapping one onto the other would report an internal sign-off as a platform's permission.
- `approved_content.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `approved_content.retire` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.

## 16 — Social and messaging channels

*Permission and capability* · [mapping-16-social.md](mapping-16-social.md)

- `social_invitation.list` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Invitations sent cannot be listed, so neither what is pending nor how old it is can be answered.
  - *Notes:* The pending social-account listing is a different thing despite the similar name: it is accounts waiting to finish connecting to the product, not invitations waiting on people. Confusing the two produces a confident answer to a question nobody asked.
- `social_invitation.withdraw` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. A sent invitation cannot be taken back through the API.
- `social_invitation.accept` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `social_invitation.decline` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `social_relationship.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Nothing answers, on demand, whether we are connected to this person or at what degree.
  - *Notes:* The notification surface reports connection requests sent and accepted, so a standing relationship ledger can be maintained outside the product from those events. That is a ledger the agent builds and owns; it is not a read, and it knows nothing about people we never invited.
- `social_profile.view` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. No profile read is exposed, metered or otherwise.
- `social_profile.follow` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `social_profile.unfollow` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `social_post.react` — **absent**
  - *Because:* not evidenced — no documented surface was found for this.
- `social_post.comment` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. No published content can be posted under a person's identity through this API.
- `social_credit.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. The metered messaging allowance is not readable: how many credits remain, when they expire and whether a reply returns one are all unanswerable.
  - *Notes:* A metered message can be sent without any way to check the balance first, so the meter is discovered by exhausting it. Warn the user before planning volume that depends on it.
- `conversation_window.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this. Nothing reports whether this person may be written to freely right now, only with pre-approved content, or only by spending a credit.
  - *Notes:* Both routes exist as sends — an ordinary message and a metered one — but nothing says which is permitted for a given person, so the choice is the caller's and a wrong one fails at send time rather than at planning time. That is a real cost to surface before the user commits to a social route.

## 17 — Oversight, review and safety

*The organisation around the work* · [mapping-17-oversight.md](mapping-17-oversight.md)

- `approval.request` — **absent**
  - *Because:* No documented surface puts an item into a queue for a human. The pending-approval endpoints list, read, send, reject and regenerate items that are already there — the AI SDR sequence generates them itself under the approval mode set on that sequence, and nothing else can be queued for review.
- `approval.list` — **partial**
  - *Missing:* Only AI-generated messages inside an AI SDR sequence reach this queue, on email and LinkedIn. A bulk write, a piece of content or a policy change waiting on a human has no queue here at all, so an empty queue does not mean nothing is waiting.
  - *Surface:* ai-sdr-pending-approvals -> List pending approvals (documented Beta or Coming soon)
  - *Notes:* Each item carries when it was created rather than how long it has waited — the age the operation reports is computed from that. The queue can be filtered by sequence and by user.
- `approval.get` — **partial**
  - *Missing:* The item is addressed by contact rather than by an approval identifier, and only an AI-generated message is retrievable this way. Anything else a human is being asked to approve has no item to fetch.
  - *Surface:* ai-sdr-pending-approvals -> Get pending approval for a contact (documented Beta or Coming soon)
- `approval.resolve` — **partial**
  - *Missing:* Rejection records no reason and is heavier than the contract's reject: it discards the queued draft and removes the contact from the sequence, with nothing documented to bring either back. Tell the user that before they reject, and keep the reason wherever the run is recorded.
  - *Surface:* ai-sdr-pending-approvals -> Send a pending approval, Send a batch of pending approvals, Reject (delete) a pending approval (documented Beta or Coming soon)
  - *Notes:* Approving is the send, exactly as the contract has it, so the approval class is unchanged by the mapping — one named recipient is confirm_each, and the batch send is confirm_once over a preview that names the population.
- `autonomy.get` — **partial**
  - *Missing:* One AI SDR sequence's own settings — whether its generated messages need approval, and whether autopilot is on. Nothing states what a credential may do unattended across the account, and there is no queue timeout, unattended action cap or escalation target to read. Everywhere else, autonomy is the agent's own policy held outside this product.
  - *Surface:* ai-sdr-sequences -> Read AI SDR sequence settings (documented Beta or Coming soon)
- `autonomy.set` — **partial**
  - *Missing:* The gate and the mode, on one AI SDR sequence. The queue timeout and what a timeout means, the unattended action cap, the escalation target and per-channel differences have no setting here.
  - *Surface:* ai-sdr-sequences -> Set the approval mode, Enable autopilot, Disable autopilot (documented Beta or Coming soon)
  - *Notes:* Turning the gate off can also release everything already waiting, in the same call. That makes loosening the gate a send, not a settings change, and it must be previewed and approved as one.
- `escalation.raise` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `escalation.list` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `escalation.resolve` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `editorial_review.record` — **absent**
  - *Because:* not evidenced — no documented surface binds a named human's review to a sent message. A message approved out of the AI SDR queue records that it was sent, which is not the same fact and must never be reported as one.
- `editorial_review.get` — **absent**
  - *Because:* not evidenced — nothing records the review, so nothing can return it. The honest answer to an auditor here is that no review evidence exists in this product.
- `review.request` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `review.list` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `review.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `review.score` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `feedback.record` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `review_policy.define` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `review_policy.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `scorecard.define` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `scorecard.list` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `scorecard.publish` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `scorecard.retire` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `coaching.summarize` — **absent**
  - *Because:* not evidenced — the reporting surfaces cover activity and performance, not coaching. Nothing records that someone attended, listened, commented, scored or gave feedback, so there is nothing to summarise per coach.
- `budget.get` — **absent**
  - *Because:* not evidenced — no documented surface reports what is left on a meter. A meter does exist: starting a Live Data search spends the user's data allowance. That the remaining allowance cannot be read is exactly why a search is previewed before it is started.
- `budget.set` — **absent**
  - *Because:* not evidenced — checked against the endpoint index, nothing sets an allowance ceiling of the kind a pre-flight check reads.
- `stoprule.set` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `stoprule.list` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `stoprule.clear` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `stoprule_firing.list` — **absent**
  - *Because:* not evidenced — nothing stops the work by itself here, so there are no firings to list. When sending is off in this product it was a person or an agent that stopped it, and the reason lives in the run record rather than in the API.
- `stoprule_firing.get` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `outreach.hold` — **partial**
  - *Missing:* This blocks future contact and nothing else. Live enrolments, scheduled steps, open tasks, pending approvals and outstanding meeting proposals are untouched by it, and the rule returns no per-item ledger of who was actually reached. The kill switch the contract describes is only realised once those are stopped too, through their own operations, and every one of them has to be reported.
  - *Surface:* contact-blacklist-rules -> Create an email blacklist rule, Create a domain blacklist rule, Bulk create email blacklist rules, Bulk create domain blacklist rules
  - *Notes:* A person is held by an email rule and a company or a domain by a domain rule. Rules are account-wide, so check the existing rules before adding one and expect the block to apply to work other people own.
- `outreach.release` — **partial**
  - *Missing:* Deleting the rule lifts the block, but nothing resumes by itself: whatever was stopped when the hold went on has to be restarted deliberately, and no ledger of what was held exists to restart it from. Re-check each person's eligibility first — the contract requires it and this product will not.
  - *Surface:* contact-blacklist-rules -> Delete an email blacklist rule, Delete a domain blacklist rule, List email blacklist rules, List domain blacklist rules

## 18 — The team: people, ownership, workload and targets

*The organisation around the work* · [mapping-18-team.md](mapping-18-team.md)

- `actor.list` — **partial**
  - *Missing:* Identity only — the team, the user identifier, the display name and the email address. The state the operation asks for, active, ramping, unavailable or gone, is not carried, so this read cannot tell an agent whether the person it is about to hand work to is still there.
  - *Surface:* user-account -> List team users
  - *Notes:* No scope required. It covers the teams this credential can act in; people outside them do not appear, which is a different answer from not existing.
- `actor.get` — **partial**
  - *Missing:* Only the calling credential has a record of its own. Anyone else is an identity row in the team listing and nothing more — no state, and none of the ceilings that apply to them.
  - *Surface:* user-account -> Get current user, List team users
- `workload.get` — **absent**
  - *Because:* not evidenced — checked against the endpoint index, nothing reports what a person is carrying. Open tasks and live enrolments can each be listed on their own, but no surface answers the question this operation asks, and adding up two listings is not the same answer.
- `workload_policy.define` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `workload_policy.get` — **absent**
  - *Because:* not evidenced — no ceiling is declared anywhere, so the answer here is always none declared, which the contract reads as unlimited.
- `ownership.get` — **partial**
  - *Missing:* The owner is an attribute of the record rather than a surface of its own, so it is read with the record. The second half of the question has no answer here at all: nothing states whether acting on an unowned record would make the actor its owner, and that rule is set in the product's own settings rather than returned by any response.
  - *Surface:* accounts -> Get an account; contacts -> Filter contacts
- `assignment_policy.define` — **absent**
  - *Because:* not evidenced — no documented surface was found for this
- `assignment_policy.get` — **absent**
  - *Because:* not evidenced — no routing rule is stored in this product, so there is none to read and nothing that would say who gets the next piece of work.
- `book.transfer` — **partial**
  - *Missing:* Three parts of the book move — contact ownership, account ownership and open tasks. The senders behind live threads, the open conversations and the authored content do not, and no surface reports the book as a whole, so the ledger the contract requires has to be built by the caller from what each call returns before anything is repeated.
  - *Surface:* contacts -> Change contacts owner; accounts -> Update account owner; tasks -> Batch reassign tasks
  - *Notes:* Reassigning ownership does not re-point the sending account behind a live thread. Say so before the transfer: a departing person's threads keep sending from their mailbox until the sequences are changed, and that is the part users are most often surprised by.
- `goal.define` — **absent**
  - *Because:* not evidenced — checked against the endpoint index, this product stores no quota, goal or target, so there is nothing to set.
- `goal.get` — **absent**
  - *Because:* not evidenced — no target is stored here, so there is none to read.
- `goal.list` — **absent**
  - *Because:* not evidenced — no target is stored here, so there is none to list.
- `pace.get` — **absent**
  - *Because:* not evidenced — pace is a target measured against achievement, and no target exists in this product. Achievement alone is readable through the reporting surfaces, and reporting it as pace would invent the half that is missing.

## 19 — Accounts and buying groups

*The organisation around the work* · [mapping-19-accounts.md](mapping-19-accounts.md)

- `account.update` — **partial**
  - *Missing:* The account's stage can be moved and the rest of the record edited, but the tier the contract names has no home on the record and neither does the reason for the change. The stages are whatever this account has declared, so resolve the words the user says against them before writing — a stage that does not exist is a guess.
  - *Surface:* accounts -> Update an account
- `account.claim` — **absent**
  - *Because:* not evidenced — there is no lease on an account here. Ownership can be changed, which is a different and heavier act: it does not expire by itself, and using it as a claim would leave the account permanently reassigned.
- `account.release` — **absent**
  - *Because:* not evidenced — nothing claims an account, so there is nothing to release.
- `account_membership.list` — **partial**
  - *Missing:* Who is attached, and no more. How each person came to be attached is not recorded, so the basis the contract wants on every row cannot be given, and whether someone is being touched right now needs a separate read against the sequence they are in.
  - *Surface:* accounts -> List contacts for an account
- `collision.check` — **partial**
  - *Missing:* Only outreach collisions are visible, and only by assembling them: the people on the account, then each one's state in the sequences they are in, then the owner on each record. A live customer, support or opportunity motion is invisible here — it lives in the CRM — so a clean answer from this check is not evidence that the company is free.
  - *Surface:* accounts -> List contacts for an account; sequence-contacts -> List contacts in sequence with extended state, Get a contact in a sequence
  - *Notes:* Re-run it immediately before enrolling. Collisions appear between planning and execution, and the gap is exactly where the embarrassing double-touch happens.
- `buying_group.define` — **absent**
  - *Because:* not evidenced — people can be attached to an account, but nothing records what each of them does in a decision, so a group with roles cannot be expressed here.
- `buying_group.get` — **absent**
  - *Because:* not evidenced — no group with roles is stored, so there is none to return.
- `buying_group.enroll` — **absent**
  - *Because:* not evidenced — no surface enrols a group as a group. Enrolling several people from one account one by one is a different act: nothing staggers them, orders them, or reacts to one person's reply on behalf of the others, and doing it by hand while calling it this operation would hide exactly the coordination the operation exists for.

## 20 — Measurement

*The organisation around the work* · [mapping-20-measurement.md](mapping-20-measurement.md)

- `engagement.summarize` — **partial**
  - *Missing:* The grouping is not an argument. Each report offers the one breakdown it was built for — by channel, by sequence, by team member — and a question that needs a different grouping has to be assembled from the rows behind the numbers instead. The measure set is likewise the report's, not the caller's.
  - *Surface:* reports -> Get email reporting overview, Get calls reporting overview, Get tasks reporting overview, Get LinkedIn reporting overview, Get channel efficiency overview, Get team performance overview; sequences -> Get stats for all sequences, Get sequence stats
  - *Notes:* These endpoints are rate-limited harder than the rest of the API: sequential calls, cached within the session, no polling. Report the window alongside every figure — two numbers are only comparable when the window and the basis match.
- `funnel.summarize` — **partial**
  - *Missing:* No surface returns a ladder. The stages come from separate reads, and neither the denominator a stage is measured against nor how well that stage can be known at all is stated anywhere — the caller declares both and has to say so when reporting the result. Stages past the meeting are not covered by any of these.
  - *Surface:* reports -> Get email reporting overview, Get channel efficiency overview, List meetings
- `opportunity.summarize` — **absent**
  - *Because:* not evidenced — checked against the endpoint index, nothing here carries opportunities or revenue. That answer lives in the CRM, and reporting meetings as though they were the far end of the funnel would overstate what is known.
- `attribution.explain` — **absent**
  - *Because:* not evidenced — no attribution model is stated anywhere, so nothing can explain why an outcome was credited where it was, or what another model would have said.
- `response_time.summarize` — **absent**
  - *Because:* not evidenced — no documented surface reports time from arrival to first touch, or from a reply arriving to it being answered.
- `metric.describe` — **absent**
  - *Because:* not evidenced — checked against the endpoint index, there is no enumeration or definition surface. What a figure means here is prose on its report page, read by a human, and it says nothing about how far the figure can be trusted.
- `metric.compare` — **absent**
  - *Because:* not evidenced — no surface compares two arms or reports a sample size and an interval. Two report calls placed side by side are not this operation: the arithmetic that says whether the difference means anything is the part that is missing.
- `export.request` — **absent**
  - *Because:* not evidenced — checked against the endpoint index, no general data export exists. The reporting listings return rows inline and paginated, which is a read rather than a bounded extract, and treating one as the other would move personal data with none of the handling an extract implies.
- `export.get` — **absent**
  - *Because:* not evidenced — nothing produces an extract here, so there is none to collect.

## 21 — Introspection and runtime

*The organisation around the work* · [mapping-21-introspection.md](mapping-21-introspection.md)

- `operation.search` — **absent**
  - *Because:* Nothing in this product answers it, and nothing should — the thing being searched is the contract, which the core pack carries. Recorded absent because this register answers only for what this adapter performs.
- `operation.describe` — **absent**
  - *Because:* As above: an operation's meaning, its refusals and its five properties come from the contract in the core pack, not from any API surface here.
- `operation.preview` — **partial**
  - *Missing:* There is no general dry run. Three specific acts can be previewed, all of them beta, and every other write is knowable only by performing it — which means that for most operations the preview an approval gate wants has to be assembled from reads before the write, not requested from the product.
  - *Surface:* sequence-contacts -> Get sequence preview for a contact; ai-sdr-sequences -> Preview autopilot results; live-data -> Preview a Live Data search (documented Beta or Coming soon)
  - *Notes:* Preview before Start on a Live Data search is a hard rule, not a courtesy: Start spends the user's allowance and Preview does not.
- `plan.validate` — **absent**
  - *Because:* not evidenced — no surface takes a plan. Authority, ordering, preconditions and headroom are checked step by step against the reads each step needs, by the agent, before anything runs.
- `contract.describe` — **absent**
  - *Because:* Nothing here describes the contract — which version is in force, what was renamed from what, and what it binds an agent to is the core pack's own answer, not this API's.
- `capability.list` — **partial**
  - *Missing:* The granted scope set is not returned by anything. Identity and the teams a credential may act in are readable; what it may actually do is discovered only by making a call and reading an insufficient_scope refusal back. For an unattended run that means the honest per-capability answer is unknown until something is attempted, and unknown is not permission.
  - *Surface:* user-account -> Get current user, List team users
  - *Notes:* Neither read needs a scope, so both work with any working credential. When a capability has to be known in advance, the key's scopes are visible in the product settings rather than through the API.
- `vocabulary.list` — **partial**
  - *Missing:* Only the reply categories this account has declared. Enrolment statuses, meeting outcomes, step intents, exit reasons, content-policy rule classes and the properties a branch condition may be written over have no listing at all — checked against the endpoint index, there is no enumeration surface. For those kinds the answer is unknown, which the contract allows and which is not the same as an empty list.
  - *Surface:* inbox -> List inbox categories
- `schema.describe` — **partial**
  - *Missing:* Custom fields only, and only on people. No surface describes the standard fields of a record kind or says which of them may be written; that is prose on the record's own doc pages, read at call time, and it cannot be enumerated.
  - *Surface:* custom-fields -> List all custom fields, Get a custom field
- `channel.describe` — **absent**
  - *Because:* not evidenced — no documented surface states a channel's own rules: whether automation is sanctioned there, how its allowance works, how long a reply window stays open or what recording consent it expects. A sending account's configured limits are a different thing and belong to the sender operations; using them as an answer here would confuse one mailbox's ceiling with the channel's rules.
- `adapter.describe` — **partial**
  - *Missing:* Nothing returns any of this. The request ceilings and the queued-versus-inline rule are documented in prose — reporting and stats endpoints are limited harder than the rest, and a long write answers with a background job to poll — but batch ceilings, page sizes and the scope and lifetime of an idempotency key are not stated, and none of it can be read per installation.
  - *Surface:* the Rate limits guide page; background-jobs -> Get a background job
- `adapter.verify` — **absent**
  - *Because:* not evidenced — nothing here tests fulfilment. This register is the claim, made from documentation rather than from a run, and it is the thing a verification would check rather than a substitute for one.
- `job.get` — **partial**
  - *Missing:* Status, progress and the terminal timestamps are documented, but the result payload is opaque and its shape varies by job kind, so the per-item ledger the contract requires is not guaranteed to be there. Where one outcome per item is needed, reconcile against the entities themselves rather than trusting the job to carry it.
  - *Surface:* background-jobs -> Get a background job, List background jobs
  - *Notes:* A long write completes when the job reaches a terminal state, not when the call returns. Never blind-retry a bulk write that failed — the first attempt may have partly succeeded.
- `invocation.get` — **absent**
  - *Because:* not evidenced — checked against the endpoint index, nothing looks a call up by the idempotency key it was sent with. After a lost response the only recovery is the operation's own check-first read, which is why every write in the contract names one.
- `term.resolve` — **absent**
  - *Because:* Nothing here resolves a word onto a concept. The vocabularies this account declares can be listed, but mapping a colleague's shorthand or another system's label onto the right concept is the contract's own answer in the core pack.

## Coverage by family

A family whose *not assessed* column is not zero has not been fully answered for yet. Nothing should be read into those operations either way — an unanswered question is not a recorded absence.

| Family | Operations | Direct | Composed | Partial | Absent | Not assessed |
|---|---|---|---|---|---|---|
| 01 Discovery, enrichment and verification · [mapping-01-discovery.md](mapping-01-discovery.md) | 12 | 0 | 0 | 4 | 8 | 0 |
| 02 Contacts, identity and hygiene · [mapping-02-contacts.md](mapping-02-contacts.md) | 23 | 6 | 1 | 3 | 13 | 0 |
| 03 Audience and lists · [mapping-03-audiences.md](mapping-03-audiences.md) | 16 | 5 | 1 | 1 | 9 | 0 |
| 04 Import · [mapping-04-import.md](mapping-04-import.md) | 5 | 0 | 1 | 2 | 2 | 0 |
| 05 Campaign, schedule, windows and limits · [mapping-05-campaigns.md](mapping-05-campaigns.md) | 26 | 7 | 2 | 11 | 6 | 0 |
| 06 Steps, content and content policy · [mapping-06-steps.md](mapping-06-steps.md) | 18 | 6 | 0 | 6 | 6 | 0 |
| 07 Messages · [mapping-07-messages.md](mapping-07-messages.md) | 5 | 0 | 0 | 4 | 1 | 0 |
| 08 Enrollment · [mapping-08-enrollment.md](mapping-08-enrollment.md) | 7 | 3 | 0 | 3 | 1 | 0 |
| 09 Conversations and activity · [mapping-09-conversations.md](mapping-09-conversations.md) | 9 | 2 | 0 | 2 | 5 | 0 |
| 10 Task queue and touches · [mapping-10-tasks.md](mapping-10-tasks.md) | 12 | 5 | 1 | 1 | 5 | 0 |
| 11 Meetings, qualification and handoff · [mapping-11-meetings.md](mapping-11-meetings.md) | 17 | 0 | 0 | 1 | 16 | 0 |
| 12 Signals and triggers · [mapping-12-signals.md](mapping-12-signals.md) | 10 | 0 | 0 | 5 | 5 | 0 |
| 13 Inbound · [mapping-13-inbound.md](mapping-13-inbound.md) | 11 | 0 | 0 | 0 | 11 | 0 |
| 14 Consent, suppression and privacy · [mapping-14-privacy.md](mapping-14-privacy.md) | 23 | 0 | 0 | 6 | 17 | 0 |
| 15 Sending capability and deliverability · [mapping-15-sending.md](mapping-15-sending.md) | 34 | 0 | 0 | 13 | 21 | 0 |
| 16 Social and messaging channels · [mapping-16-social.md](mapping-16-social.md) | 13 | 1 | 0 | 0 | 12 | 0 |
| 17 Oversight, review and safety · [mapping-17-oversight.md](mapping-17-oversight.md) | 32 | 0 | 0 | 7 | 25 | 0 |
| 18 The team: people, ownership, workload and targets · [mapping-18-team.md](mapping-18-team.md) | 15 | 2 | 0 | 4 | 9 | 0 |
| 19 Accounts and buying groups · [mapping-19-accounts.md](mapping-19-accounts.md) | 12 | 4 | 0 | 3 | 5 | 0 |
| 20 Measurement · [mapping-20-measurement.md](mapping-20-measurement.md) | 10 | 1 | 0 | 2 | 7 | 0 |
| 21 Introspection and runtime · [mapping-21-introspection.md](mapping-21-introspection.md) | 15 | 1 | 0 | 6 | 8 | 0 |
