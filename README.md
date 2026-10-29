# Reply CLI

`reply` is the command-line interface for [Reply.io](https://reply.io). Sign in
once and every Reply.io API request runs as you — from your terminal or your
scripts. Today it handles authentication and identity, and `reply api` gives you
authenticated access to the full v3 API; higher-level commands for sequences,
contacts, and the inbox are on the way.

## Installation

`reply` runs on [Node.js](https://nodejs.org) **20 or newer** — check yours with
`node --version`, and install or upgrade Node first if it is older. Then install
the CLI globally from npm:

```sh
npm install -g reply-cli
```

```sh
reply --version
```

That is the whole installation. There is nothing else to run.

## Staying up to date

One command keeps the CLI current:

```sh
reply install
```

It looks up the newest release, and when it can update your copy safely it runs
npm for you and reports the result:

```
✓ reply 0.4.0 → 0.5.0 installed
```

Already on the newest release, it says so and does nothing. Where the copy is
not ours to change — installed inside a project, run through `npx`, or built
from a checkout — it prints the exact command that fits your setup and leaves
everything alone. It exits non-zero whenever an update exists and was not
applied, so `reply install --dry-run` works as a check in CI.

`reply --version` mentions a newer release when there is one:

```
0.4.0
reply 0.4.0 → 0.5.0 available · run `reply install`
```

That check reads the public GitHub releases, is cached for a day, times out
after a second and a half, and stays silent when it fails. It never runs for any
other command, and never at all with `--json`, when output is piped, in CI, or
with `REPLY_NO_UPDATE_CHECK=1` set.

## Where this fits

Reply's agentic toolkit is three pieces. They are complementary, not alternatives:

| | What it is | When you want it |
|---|---|---|
| **reply CLI** (this repo) | `npm i -g reply-cli` — authenticated access to *every* v3 endpoint via `reply api` | Your agent has a shell. This is the complete surface. |
| **[Reply MCP](https://github.com/reply-team/reply-mcp)** | A curated tool catalog over `mcp.reply.io` | Your client speaks MCP and has no shell — desktop apps, hosted assistants. |
| **[reply-skills](https://github.com/reply-team/reply-skills)** | Outbound expertise as markdown skills: what to do, in what order, with what guardrails | Your agent knows *how* to call things but not *what* to run. |

MCP gives your agent tools. Skills give it judgement. Most setups want both; a shell-capable
agent can do everything through the CLI alone.

The shortest path that works: install the CLI, `reply auth login`, `reply skills install`, then
talk to your agent in plain words. MCP is optional — add it when your client has no shell.

## Usage

```sh
reply <command> [flags]
reply <command> --help
```

Run `reply --help` for the full command list. Add `--json` to any command for
machine-readable output suitable for scripts.

## Authentication

**You need a Reply.io account.** If you have one, sign in with it. If you don't, `reply auth
login` takes you to the browser, where you can create one and start a free trial — no credit
card. The CLI, the skill packs and the local tooling are free and open source; what a Reply.io
account gives you is the execution: mailboxes, sending, the contact store, the inbox, analytics.

> **Open source, not self-hosted.** The CLI and the skill packs are MIT and yours to fork.
> Execution always runs against Reply.io — the API, the hosted MCP server at `mcp.reply.io`,
> your mailboxes and your data. There is no local mode, and outreach without a Reply.io account
> is not something this toolkit can do.

Log in through your browser with OAuth:

```sh
reply auth login
```

Or store an API key, read from stdin so it never lands in your shell history:

```sh
reply auth login --with-token
```

Inspect and manage the active credential:

```sh
reply auth status     # who you're signed in as, and how — no secrets shown
reply auth whoami     # verify the stored credential against the API
reply auth logout     # remove the stored credential
```

Pass a key for a single command with `--api-key` or the `REPLY_API_KEY`
environment variable; both take precedence over a stored login and are never
written to disk.

## Profiles

Profiles keep more than one Reply.io account signed in at once — each stores its
own credential. Name them however you like; account emails work well:

```sh
reply profile add alice@reply.io
reply profile use alice@reply.io           # make it the active profile
reply auth login                           # signs in alice@reply.io

reply profile list                         # '*' marks the active profile
reply profile current                      # just the active profile's name
reply --profile bob@reply.io auth whoami   # override for a single command
```

The active profile is resolved as `--profile` → `REPLY_PROFILE` → the profile
set with `profile use` → the built-in default.

Manage profiles after creating them:

```sh
reply profile show                              # inspect the current profile (no secrets)
reply profile show alice@reply.io               # inspect a specific one
reply profile set alice@reply.io --team-id 1045 # edit in place; only what you pass changes
reply profile rename alice@reply.io ally        # also moves the stored credential
reply profile unset ally team-id                # clear a field (authority|api_base|team-id)
reply profile delete ally                       # remove it and its stored credential (-y skips the prompt)
```

`profile set` takes `--team-id`, and `--authority` / `--api-base` for pointing a
profile at a non-production backend. Naming `default` edits the built-in
profile, which is how you pin a team for everything without creating a profile
first:

```sh
reply profile set default --team-id 1045
```

`profile show` lists the backend URLs, pinned team, and which authorization
would be used (in priority order: `--api-key` → `REPLY_API_KEY` → stored
credential) — it never prints tokens or keys. `--authority` and `--api-base`
must be `http(s)` URLs.

## Teams

A profile can pin a team (workspace); it's sent as `X-TEAM-ID`, with precedence
`--team-id` → `REPLY_TEAM_ID` → the profile's team. The `team` command sees and
sets the **current profile's** team:

```sh
reply team list            # teams you can act in (* marks the profile's team)
reply team current         # the profile's pinned team + the effective team (from whoami)
reply team use 1045        # verify 1045 is one of your teams, then pin it on the current profile
reply team clear           # remove the pin
```

If a call needs a team and you're in more than one, the API answers with a
`TEAM_REQUIRED` error listing your teams — run `reply team use <id>` to pin one.

## Working with your Reply account

First-class commands for the operations an agent or an automation performs most. Every command
prints JSON (indented; compact with `--json`) and says what happened in a stable `status`.

| Command | Does |
|---|---|
| `reply sequence list --name -` | every sequence of a name, ignoring case, archived ones included |
| `reply sequence create --name -` | make a draft of a name, holding nobody, with one task step → its id |
| `reply sequence get <id>` | the sequence as Reply holds it |
| `reply sequence contacts <id> [--limit] [--offset]` | one page of its contacts, plus the total |
| `reply sequence stats <id> (--preset … \| --from … --to …)` | its email and LinkedIn counts over a window |
| `reply sequence add-contact <id> <contact> [--start-step N] [--ignore-step-delay]` | put a contact in → `added` / `already_in_sequence` |
| `reply sequence remove-contact <id> <contact>` | take a contact out → `removed` / `not_in_sequence` |
| `reply sequence pause <id>` | → `paused` |
| `reply sequence start <id> [--expect-contacts N]` | → `started` / `already_active` |
| `reply contact-list add-contact <list-id> <contact> [--refuse-opted-out]` | → `added` |
| `reply contact find --contact -` | the id of the contact under an email or a LinkedIn URL, or null; never creates one |
| `reply contact get <id>` | the contact as Reply holds it |
| `reply contact update (<id> \| <contact>) --fields -` | change some fields and custom fields; null clears one → `updated` |
| `reply contact delete <id>` | → `deleted` |
| `reply contact opt-out <contact>` | → `opted_out` |
| `reply contact send-email <contact> --email-account-id N --message - [--track-links] [--track-opens]` | one email outside any sequence → `sent` |
| `reply contact linkedin-connect <contact> --linkedin-account-id N [--message -]` | a LinkedIn invitation, with or without a note → `sent` / `already_connected` |
| `reply contact linkedin-message …` · `linkedin-inmail …` · `linkedin-voice …` | a LinkedIn message, an InMail, or an AI voice message spoken from a script → `sent` |
| any direct send `… [--send-after <moment>] [--schedule-id N] [--idempotency-key K]` | the send held until a moment, timed by a schedule, under a key of yours → `sent`, with its `reference` and `state` |
| `reply direct-send get <reference>` | a send as Reply holds it: whether it has gone out, when, and why it failed |
| `reply direct-send cancel <reference>` | stop a send that has not gone out yet → `state` `cancelled` |
| `reply inbox list (--contact-id \| --sequence-id) [--source] [--channel] [--category-id] [--since]` | one page of threads |
| `reply inbox events [--cursor … \| --since …] [--top N]` | one page of the inbox feed, read forward by cursor |
| `reply inbox get <thread-id>` | a thread with its subject, and one page of its messages |
| `reply inbox reply <thread-id> --message -` | reply in the thread, on its own channel → `sent` |
| `reply inbox categories` | the categories a thread can be filed under |
| `reply inbox categorize <thread-id> (--category-id N \| --clear)` | → `categorized` / `cleared` |
| `reply inbox mark-read <thread-id>` · `reply inbox mark-unread <thread-id>` | → `read` / `unread` |
| `reply account list [--channel email\|linkedin]` | the email and LinkedIn accounts a send can go from, whose each is, and the state of each |
| `reply schedule list` | the sending schedules the account can use, each with its time zone and its windows by weekday |

`<contact>` is exactly one of `--contact <json>|@file|-`, `--email <address>` (with `--first-name`,
`--last-name`, `--company`, `--title`), or `--contact-id <id>`. The JSON takes the same fields
(`email`, `first_name`, …) plus `linkedin_url`, with an email, a LinkedIn URL or both, and `-` reads
it from stdin, which keeps personal data out of the argument list:

```sh
echo '{"email":"ann@example.com","first_name":"Ann"}' | reply sequence add-contact 123 --contact -
echo '{"linkedin_url":"https://www.linkedin.com/in/ann-example","first_name":"Ann"}' | reply contact opt-out --contact -
```

The two `add-contact` commands always import a contact given by email, and Reply refuses an import
without a first name, even for a contact it already holds; a contact given only by LinkedIn URL is
looked up first and imported only when Reply holds nobody under it. `contact opt-out`, `contact
update` and the direct sends look first and import only someone Reply doesn't hold yet, so only then
is a first name needed, and a direct send sends only to a contact it created (below); `sequence
remove-contact` never imports. Each of these except `sequence remove-contact` answers the
`contact_id` it acted on and `contact_created`, so a caller can keep the id. A send looks the person
up by every address it was given, the one it reaches them at first (the email for `contact send-email`,
the LinkedIn URL for the LinkedIn sends), then the other when there is one. Otherwise a contact is
looked up by its email, and one with only a LinkedIn URL by that; an import is matched by the email
when there is one.

A direct send given a person's fields sends only to a contact it creates. When a lookup by any address
it was given finds a contact, or its import matches one Reply already holds (by the email, say, or a teammate's), nothing
is sent: the answer is `contact.already_held` (exit 1) with that contact's id in `ids.contact_id`.
Read that contact first with `reply contact get`, its opt-out included, and send to it with
`--contact-id` if it is the one to reach. Reply does not refuse a direct send to a contact it holds
as opted out, so a send never reaches a contact Reply already held without that read. A LinkedIn
send needs a `linkedin_url` in `--contact` (or `--contact-id`): `--email` alone is refused. On a send,
`contact_created` is kept for consistency with the add commands: given a person's fields it is always `true`,
and with `--contact-id` it is always `false`; in both cases a successful answer says the send was made.

The lookup is Reply's exact
one: an email matches ignoring case, and a LinkedIn URL is matched by its lowercased slug — on
linkedin.com the path's case does not count, nor the scheme's or host's, a default port, one trailing
slash or a fragment, while `www` and the query do. Reply is asked for a LinkedIn URL in that form
first, then as given, and the CLI stores a LinkedIn URL by its lowercased slug when it imports a
contact or runs `contact update`.

The commands that carry a person's or a sequence's text in a field of their own read it from stdin
only, and refuse it on the argument list: `contact find --contact -` (`{email}` or
`{linkedin_url}`), `contact update --fields -` (`{first_name, last_name, company, title,
linkedin_url, custom_fields: [{name, value}]}`, where a field left out stays as it is and `null`
clears one), and `sequence list|create --name -` (`{name}`):

```sh
echo '{"title":"CTO","custom_fields":[{"name":"leadSource","value":"Event"}]}' | reply contact update 456 --fields -
echo '{"name":"Q4 outreach"}' | reply sequence list --name -
```

`contact update` refuses a custom field the account has none of, `contact.field_not_found`, before
it changes or imports anything. Given the contact by its flags rather than its id, it changes only
what `--fields` names: the contact's own fields find the contact, or import it, and never change one
Reply already holds.

When `--contact -` and the command's own input (`--message -` or `--fields -`) both read stdin, it
holds one object with each under its flag's name, so neither the person nor the text ever sits in
the argument list:

```sh
echo '{"contact":{"email":"ann@example.com","first_name":"Ann"},"fields":{"title":"CTO"}}' | reply contact update --contact - --fields -
echo '{"contact":{"linkedin_url":"https://www.linkedin.com/in/ann-example","first_name":"Ann"},"message":{"body":"Thanks for connecting, Ann."}}' | reply contact linkedin-message --contact - --linkedin-account-id 34 --message -
```

`inbox reply` takes its message, `{body, reply_to_message_id}`, from stdin only, and refuses it on
the argument list. The reply goes to the thread's contact from the account that owns the thread;
`reply_to_message_id` (email threads only) names the message it answers:

```sh
echo '{"body":"Thanks, Tuesday works."}' | reply inbox reply 9876 --message -
```

The direct sends reach a contact outside any sequence, from an account you name: `contact
send-email` (`{subject, body}`, the body HTML), `contact linkedin-connect` (`{note}`, or no
`--message` for an invitation without one), `contact linkedin-message` (`{body}`), `contact
linkedin-inmail` (`{subject, body}`) and `contact linkedin-voice` (`{script}`, which Reply speaks in
the LinkedIn account's voice). Each reads its text from stdin only and refuses it on the argument
list. `reply account list` gives the ids to send from, each account's status (`active`, `inactive`,
`disconnected` or `other`) and Reply's own word for it. In a team that shares its accounts the list
holds teammates' accounts too, and `owner_user_id` says whose each one is. Without `--channel` both
lists are read, and one the plan or role does not include fails the whole command; `--channel email`
or `--channel linkedin` reads one alone:

```sh
echo '{"subject":"Quick question","body":"<p>Hi Ann, does Tuesday work?</p>"}' | reply contact send-email --contact-id 456 --email-account-id 12 --message -
echo '{"body":"Thanks for connecting, Ann."}' | reply contact linkedin-message --contact-id 456 --linkedin-account-id 34 --message -
```

A LinkedIn send answers Reply's activity id and its `sentAtUtc` as Reply gives it; a direct email
answers no time, so its `sent_at` is null, and the CLI never puts its own clock in either. The
lengths Reply publishes (a LinkedIn message's 8000 characters, an InMail's 200 and 1900, a script's
1000) are refused before anything is sent. Reply reads `{{…}}` in a LinkedIn text as its template
variables, and refuses one it cannot fill with `linkedin.missing_variables`.

`contact send-email` tracks neither links nor opens unless `--track-links` or `--track-opens` asks
it to. An email Reply sends within the request adds `rendered_subject` and `rendered_body`, the text
as Reply filled it in, when Reply gives them; a send held for later has neither. A template variable
Reply cannot fill is `contact.missing_variables`, with the names under the error's
`details.missing_variables`, and a template Reply cannot render is `contact.rendering_failed`, with
Reply's message as its `detail`. Neither sends anything:

```sh
# {"error":{"code":"contact.missing_variables",…,"details":{"missing_variables":["FirstName","Company"]}}}
```

Every direct send also takes `--send-after <moment>`, `--schedule-id <id>` and `--idempotency-key
<key>`. Reply holds the send until the moment, given with its offset (`2026-11-03T14:00:00Z`,
`2026-11-03T16:00:00+02:00`) and sent to Reply in UTC; a moment without an offset is refused
(`usage.date`). `--schedule-id` names the sending schedule Reply times the send by (see `reply
schedule list`). The answer then adds Reply's `reference`, `send_after` and `state`, each only when
Reply gives it. `status: "sent"` means Reply took the send, and `state`, when present, says whether
it has gone out: `queued` or `sending` is not yet, then `sent`, `failed` or `cancelled`. `reply
direct-send get <reference>` reads the send later, and `reply direct-send cancel <reference>` stops
one that has not gone out; the reference is Reply's, passed on as given. An answer without `state`
comes from a Reply that does not know these flags yet: it sent at once, as without them.

`--idempotency-key` goes to Reply as the `Idempotency-Key` header, never in the body. A Reply that
knows the header answers a repeat with the same key with the send the key first made; while that
one is still being made the answer is `idempotency_key.in_use`, and the same key on a different
send is `idempotency_key.reused`. Neither sends anything. `idempotency_key.reused` names the send
the key was first taken for under the error's `details`: its `reference`, `state` and `send_after`,
each only when Reply gives it. A key is 1 to 255 printable ASCII characters; a space inside is kept,
and one at either end is refused (`usage.idempotency_key`), since a header loses it on the way out.

```sh
echo '{"body":"Following up on my note."}' | reply contact linkedin-message --contact-id 456 --linkedin-account-id 34 --message - --send-after 2026-11-03T14:00:00Z --idempotency-key follow-up-456-1
# {"status":"sent",…,"reference":"linkedin-1042","send_after":"2026-11-03T14:00:00Z","state":"queued"}
reply direct-send get linkedin-1042
reply direct-send cancel linkedin-1042
```

Both answer the send under the CLI's names, each null when Reply gives none: `reference`,
`channel`, `contact_id`, `state`, `send_after`, `sent_at`, `message_id`, `failure_reason`,
`failure_code`, `missing_variables`, `rendered_subject`, `rendered_body` and `cancelled_at`.
`failure_reason` is a sentence for a person and never parsed; `failure_code` is Reply's code for
the failure, the one to branch on. `direct-send cancel` of a send already cancelled answers it
again. A send already gone out or failed is `direct_send.already_sent` or
`direct_send.already_failed`, and a reference Reply has no send for is `direct_send.not_found`.

`reply inbox events` reads the inbox feed forward. Each page holds the threads whose latest message,
inbound or outbound, changed, oldest first and as Reply gives them, with `has_more` and a `cursor`.
Start with `--since <moment>` (inclusive, at most 30 days ago) or with neither flag, which reads the
last 30 days, then pass the answered cursor back with `--cursor` while `has_more` is true. Loop on
`has_more`, not on the number of items: an empty page still carries a cursor, and when `has_more` is
false that cursor is where the next read starts. A cursor or a `--since` older than the 30 days the
feed keeps is `inbox.cursor_expired`: start again with `--since`. A cursor Reply will not read
otherwise, unreadable or ahead of its clock, is `inbox.cursor_refused`, with `cursor` in
`details.fields`; start again the same way.

```sh
reply inbox events --since 2026-11-01T00:00:00Z --json
# {"items":[{"threadId":9876,"contactId":456,"channel":"email","lastActivityDate":"2026-11-03T14:02:11Z",…}],
#   "has_more":true,"cursor":"AQjfObhYHZgAAADjVg"}
reply inbox events --cursor AQjfObhYHZgAAADjVg --json
```

A Reply that does not have `direct-send get`, `direct-send cancel` or the feed yet answers
`reply.refused` with status 404 and no `reply_code`.

`reply schedule list` gives every sending schedule the account can use, in one answer and in the
order Reply gives them: its `time_zone_id` as Reply holds it, a Windows time zone identifier such as
`Eastern Standard Time`, whether it reads its windows in each recipient's own time zone, whether it
skips holidays, whether it is your default, and its windows, one entry for each day Reply holds, in
Reply's order, each day's `week_day` in lower case and each time of day as `HH:MM`.
`follow_up_timings` are the windows of the later steps, used when `use_follow_up_schedule` is true,
and `reply_status` is Reply's own word for how the schedule is used: `unknown`,
`inCampaignTemplate`, `inCurrentUserSequence`, `inTeamMemberSequence`, `isDefaultForCurrentUser` or
`isDefaultForTeamMember`, only the first of them that holds:

```sh
reply schedule list --json
# {"items":[{"id":41,"name":"Business hours","time_zone_id":"Eastern Standard Time","use_recipient_time_zone":false,
#   "exclude_holidays":true,"is_default":true,"main_timings":[{"week_day":"monday","active":true,
#   "ranges":[{"from":"09:00","to":"17:00"}]}, …],"use_follow_up_schedule":false,"follow_up_timings":[],
#   "reply_status":"isDefaultForCurrentUser"}]}
```

`inbox reply`, `sequence create` and the five direct sends are the work commands that are not safe to
re-run. On exit 3 (outcome unknown) a reply or a send may already have gone, and running it again may
send it twice, unless the hint says nothing was sent: a send whose contact's import lost its answer
was never made, and its hint says so; run again, it answers `contact.already_held` if that import did
create the contact. An `--idempotency-key` does not change this: a Reply that does not know the
header yet would make the send again.
For `inbox reply`, read the thread with `reply inbox get` before trying again. For
`sequence create`, Reply allows two sequences of one name, so after exit 3 look the name up with
`sequence list --name -` first. Every other work command can simply be run again; a `contact delete`
repeated after its first one took effect answers `contact.not_found`.

**Errors.** With `--json`, a failure is one line on stderr:
`{"error":{"code":"contact.opted_out","title":…,"status":…,"reply_code":…,"ids":{…}}}`. `ids` is
whatever the command learned before failing, for example the id of a contact it created before
Reply refused the add. `reply.invalid_request` means Reply didn't accept a field as given;
`details.fields` names the fields, never their values. Each command's `--help` lists its error codes.

**Exit codes.** `0` done · `1` failed, and the main effect did not happen · `2` usage error, nothing
sent · `3` **outcome unknown**: a write may have happened and no answer came back. Re-running the
same command is safe, except `inbox reply`, `sequence create` and the direct sends (above): each of
the others checks or relies on Reply's own state rather than repeating an effect blindly.

**Retries.** Reads are retried on errors. A write is retried only when it can't have reached Reply:
the connection was never made, or a `429` asked to wait 3 seconds or less. A longer `429` comes back
as `rate_limited` with `retry_after`.

## Raw API access

`reply api` is a raw, authenticated passthrough to any v3 endpoint — the
agent/CI escape hatch. See the
[Reply API reference](https://docs.reply.io/api-reference/introduction) for the
full surface.

Use the path exactly as it appears in the docs (starting with `/v3`); the query
string goes in the path. The request URL is literally `api_base + path`, and the
profile stores the host **without** `/v3`, so the call's URL matches the docs. A
`--body` switches the method to POST (it also accepts `@file` or `-` for stdin).

```sh
reply api /v3/whoami                          # your identity + team
reply api /v3/sequences                       # list sequences
reply api /v3/contacts --pretty               # list contacts, indented
reply api /v3/sequences/12345                 # one sequence by id
reply api /v3/contacts --body @contact.json   # create a contact (POST; body schema per the docs)
echo '<json>' | reply api /v3/contacts --body -   # body from stdin
reply api /v3/whoami --verbose                # full request/response on stderr
```

It prints `{ "code": <status>, "data": <body> }` and exits non-zero on HTTP
`>= 400`. On a team/user-resolution conflict it adds a short fix-it hint on
stderr. Add `--verbose` for a full request/response trace on stderr with
credentials redacted; stdout stays the plain JSON, so pipes keep working.

A write through `reply api` (POST, PUT, PATCH, DELETE) is never resent on a 5xx or on a
connection that broke after sending. That last case exits 3: the write may have happened. `reply api`
goes by the method alone, so this includes a POST that only reads, such as the `…/filter` calls; run
it again yourself if it failed. A `429` is waited out only when `Retry-After` asks for 3 seconds or
less; a longer one is printed as the `429` it is.

### Windows: Git Bash rewrites the path

Under Git Bash / MSYS, `reply api /v3/whoami` never reaches the CLI as you typed
it — MSYS converts a leading-slash argument into a Windows path, so the request
would go to `https://api.reply.io/C:/Program Files/Git/v3/whoami`. **Quoting does
not help**: quotes are removed before the conversion. Either of these does:

```sh
reply api //v3/whoami                     # a doubled leading slash survives
MSYS_NO_PATHCONV=1 reply api /v3/whoami   # or turn the conversion off
```

The CLI refuses such a path instead of sending it, and exits `2` (usage) rather
than `1`, so a mangled path can never be mistaken for an endpoint that does not
exist. PowerShell, cmd, macOS and Linux are unaffected.

## Skills

Reply's outbound expertise ships as three markdown skill packs in
[reply-skills](https://github.com/reply-team/reply-skills). One command installs
them into every AI assistant on your machine, dependencies resolved:

```sh
reply skills install
```

```
✓ detected Claude Code, Codex
✓ Claude Code · ai-sdr-core, reply-adapter, agentic-runtime installed
✓ Codex       · ai-sdr-core, reply-adapter, agentic-runtime installed
Start a new session in each assistant so the skills load.
```

| Pack | Alias | What it gives your agent |
|---|---|---|
| `ai-sdr-core` | `core` | Vendor-neutral SDR operations, playbooks and guardrails |
| `reply-adapter` | `adapter` | Executing those operations against Reply.io |
| `agentic-runtime` | `runtime` | Durable multi-session work: plans, checkpoints, reports |

Install a subset — dependencies come along automatically, so `adapter` pulls
`core`:

```sh
reply skills install core
reply skills install adapter runtime
reply skills install --agent codex        # only this assistant
reply skills install --project            # into this repository, not your home
```

Then manage them:

```sh
reply skills list             # what's installed where (notes packs with an update available)
reply skills update           # bring installed packs to the latest version
reply skills remove runtime   # remove one pack
reply skills remove           # remove all of them
```

On Claude Code and Codex the packs are installed through the assistant's own
plugin mechanism, so they keep updating through it. Other `SKILL.md` hosts
receive the skills as files. Add `--json` for a machine-readable report, and
`--dry-run` to see the plan without changing anything.

| Assistant | How it receives the packs | Skills path | Paths verified | To take effect |
|---|---|---|---|---|
| Claude Code | its own plugin CLI | managed by the plugin CLI | yes | start a new session |
| Codex | its own plugin CLI (`--project` copies files instead) | managed by the plugin CLI | yes | start a new session |
| Cursor | copied files | `~/.cursor/skills`, or `.agents/skills` with `--project` | Cursor 3.14.27, cursor-agent 2026.08.04-aaa8809 | a new session (a new chat) |
| Windsurf (ships as Devin) | copied files | `~/.codeium/windsurf/skills`, or `.windsurf/skills` with `--project` | Devin 3.6.27, devin CLI 3000.3.27 | a new session (the next `devin` run) |
| Antigravity | copied files | `~/.gemini/config/skills`, or `.agents/skills` with `--project` | Antigravity 2.0.1 | nothing — it re-reads its skills every turn, including in a conversation already open |
| GitHub Copilot | copied files | `~/.copilot/skills`, or `.agents/skills` with `--project` | Copilot CLI 1.0.80 | a new session, or `/skills reload` in the open one |

The project directories overlap in a way the rows above do not show: Windsurf
also reads `.agents/skills`, which is where `--project` puts things for Cursor,
Codex, Antigravity and GitHub Copilot. A project-scope install aimed at one of
them therefore makes those skills visible in the others, and removing them for
one changes what the others see. Use user scope when you want a host's skills to
itself. GitHub Copilot reads two further repository directories, `.claude/skills`
and `.github/skills`. This command never writes to either — Claude Code installs
through its own plugin CLI in both scopes — so that crossover appears only when
something else fills them: a skill copied there by hand, or the `npx skills`
channel, which writes `.claude/skills` for a project-scoped Claude Code install.

Every assistant in the table has been verified against the version named. A host
added later may arrive with its skills directory taken from the vendor's
documentation alone; until someone confirms it by installing and using a skill,
the report marks that host `(paths not yet verified)` and `--json` carries
`"verified": false`. Cursor and Windsurf were verified with reply-cli 0.5.1,
Antigravity and GitHub Copilot with the release that adds them.

GitHub Copilot is two products over one directory: the `copilot` CLI and the
VS Code agent host, which ships `~/.copilot/skills` among the defaults of its
`chat.agentSkillsLocations` setting — alongside `~/.claude/skills` and
`~/.agents/skills`, user directories the CLI itself does not read. The CLI is
what the row above was verified against. VS Code scans those directories once per window and does not watch them,
so an install made while it is open needs `Developer: Reload Window` rather than
just a new chat.

Antigravity is the one host that needs nothing to pick up new skills — it
re-reads them every turn, so an install lands in a conversation you already have
open.

Installing skills is not the same as connecting Reply: `reply-adapter` needs a
Reply.io login (`reply auth login`) to actually do anything.

## Environment variables

| Variable | Description |
|----------|-------------|
| `REPLY_API_KEY` | API key used as the credential for the current invocation |
| `REPLY_PROFILE` | Profile to use (same as `--profile`) |
| `REPLY_TEAM_ID` | Team/workspace id sent as `X-TEAM-ID` (same as `--team-id`) |
| `REPLY_CONFIG_DIR` | Config directory (default `~/.config/reply`; `%APPDATA%\reply` on Windows) |
| `REPLY_NO_UPDATE_CHECK` | Set to `1` to never check whether a newer release exists |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for building from source, running the
tests, credential-store internals, and the release process.
