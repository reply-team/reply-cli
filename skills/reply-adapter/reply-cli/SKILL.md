---
name: reply-cli
description: >
  Operate Reply.io from the terminal with the reply CLI: sign in (OAuth or API key),
  manage profiles and team context, and call any API v3 endpoint via `reply api`.
  Use when executing any Reply.io operation from a shell, setting up authentication,
  or when another Reply skill needs commands executed.
metadata:
  version: 1.3.0
  pack: reply-adapter
  category: execution
  maturity: reviewed
  status: active
  owner: skills-maintainers
  tags: [cli, auth, execution]
  tools: [reply-cli]
  api: [user-account]
  relations:
    recommends: [reply-api, reply-auth, reply-operations-mapping]
---

# Using the reply CLI

## Purpose

`reply` (npm: `reply-cli`, Node ≥ 20) is the terminal entry point to Reply.io. It handles
authentication, multi-account profiles and team context, and exposes the **entire** API v3 through
one command — `reply api`. All other Reply skills execute through it.

Reaching the whole API is not the same as reaching the whole job. Whether a given business
operation can be performed against Reply at all — and how far it keeps the operation's promise —
is answered per operation in `reply-operations-mapping`, not by this skill. This one is how a call
is issued once that question has an answer.

## When to use / when NOT to use

- Use for any Reply.io operation from a shell: auth, identity checks, raw API calls.
- Do NOT call `https://api.reply.io` with curl/fetch directly — the CLI adds credential handling,
  retries with `Retry-After`, team headers and error guidance for free.
- In an MCP-connected client where no shell is available, use the `reply-mcp` skill instead.

## Prerequisites

- Node.js ≥ 20. Setup check once per session: `command -v reply` — if absent, prefix commands with
  `npx -y reply-cli` and suggest `npm i -g reply-cli` for frequent use.
- Verify auth before any workflow: `reply auth whoami` — do not proceed until it succeeds.

## Execution guidance

### Authentication

```bash
reply auth login                      # OAuth in the browser (PKCE) — preferred interactively
echo <key> | reply auth login --with-token   # store an API key (stdin keeps it out of history)
reply auth status                     # who you are signed in as, and how — no secrets printed
reply auth whoami                     # verify the credential against the API
reply auth logout
```

Credential precedence (strict): `--api-key` flag → `REPLY_API_KEY` env → stored credential.
Flag/env are ephemeral — never written to disk. Expired OAuth sessions refresh automatically; if
refresh fails the CLI asks to log in again.

A user with no Reply.io account can create one during `reply auth login` — the sign-in page
offers registration, and a trial costs nothing. Say that rather than treating a missing account
as a dead end.

### Keeping the CLI current

```bash
reply install                         # update to the newest release (`reply update` is an alias)
reply install --dry-run               # report whether an update exists, change nothing
```

Only a global npm install is driven; a project-local copy, an `npx` run or a source checkout is
reported with the command that fits it and left alone. `reply --version` mentions a newer release
when one exists, and says nothing when output is piped or `--json` is in play — so it never
corrupts machine-readable output.

### Profiles (multiple accounts)

```bash
reply profile add alice@example.com && reply profile use alice@example.com
reply profile list                    # '*' marks the active profile
reply --profile bob@example.com auth whoami    # one-off override
```

Resolution: `--profile` → `REPLY_PROFILE` → profile set with `profile use` → default.
Each profile stores its own credential; `profile show` never prints secrets.

### Team context

A profile can pin a team (workspace); it is sent as `X-TEAM-ID` on every call.
Precedence: `--team-id` → `REPLY_TEAM_ID` → the profile's pinned team.

```bash
reply team list          # teams you can act in
reply team use 1045      # verify + pin on the current profile
reply team current       # pinned + effective team
```

Organization API keys additionally need an acting user: pass exactly one of `--user-id <id>` or
`--user-email <email>` (email also requires a team id). Flag-only — never stored.

### `reply api` — any v3 endpoint

```bash
reply api /v3/whoami                          # GET; your identity + team
reply api /v3/sequences                       # list sequences
reply api /v3/contacts --pretty               # indented output
reply api /v3/contacts --body @contact.json   # a body switches the method to POST
echo '<json>' | reply api /v3/contacts --body -    # body from stdin
reply api /v3/whoami --verbose                # full request/response trace on stderr, creds redacted
```

Rules: the path is used **exactly as written in the API docs** (starts with `/v3`; query string
goes in the path). `--method GET|POST|PUT|PATCH|DELETE` overrides the default. Output is always
`{"code": <http status>, "data": <body>}` on stdout — check `code` yourself; stdout stays clean
for piping. Transient failures (429/5xx) retry automatically honoring `Retry-After`.

### Exit codes & errors

- `0` success · `1` API/runtime error (`code` ≥ 400 in the printed JSON) · `2` usage error.
- On team/user-resolution errors the CLI prints fix-it guidance on stderr (e.g. `TEAM_REQUIRED` →
  `reply team use <id>`, with your teams listed). Follow it before retrying.
- `401` with empty body = bad/expired credential → re-run `reply auth login` or fix the key.

## Validation

After any write, read the entity back (`reply api GET …`) and confirm IDs/counts before reporting
success. Never claim success without checking `code` and the response body. Which read to perform
is not a judgement call: every operation in the `sdr-operations` contract names its
`before_repeating` state, and that is the read-back — it is also what makes a resumed run and an
interrupted plan safe, so it is not optional on the paths nobody is watching.

## Reporting

Include in reports: commands executed (writes only), resulting IDs and counts, and any non-zero
exit codes with their error `code` slugs.

## Failure modes

- `Not authenticated` → run the auth setup above.
- `TEAM_REQUIRED` / `TEAM_NOT_ACCESSIBLE` / `USER_REQUIRED` / `USER_NOT_FOUND` → see
  `reply-auth` skill; the CLI's stderr guidance shows the exact fix.
- Discrete domain commands (e.g. `reply sequences list`) are **not available yet**. The command
  groups are `auth`, `profile`, `team`, `api`, `skills` and `install` — nothing else exists.
  Don't invent one: reach the operation through `reply api`, using the endpoint mapping in
  `reply-operations-mapping`.

## Safety

`reply api` executes real mutations with no dry-run: treat any POST/PATCH/DELETE as live. Follow
the calling skill's confirmation rules; never send a write on the user's behalf without the
explicit confirmation its Safety section requires.

## Related skills

- `reply-api` — how to find the right endpoint and read the docs before calling.
- `reply-auth` — key types, scopes and team/org resolution in depth.
- `reply-operations-mapping` — whether an operation is performable against Reply at all, and the
  endpoint group that performs it.

## Changelog

- 1.3.0 (2026-08-10): said plainly that reaching the whole API is not reaching the whole job — the
  per-operation answer is in `reply-operations-mapping` — because "exposes the entire API v3" was
  the sentence an agent was reading as "anything the user asks for is reachable". The read-back in
  *Validation* is now named as the contract's `before_repeating` state rather than left as a
  general instruction to check afterwards. The command inventory was re-checked against the
  2.0.0 contract and needed no change.
- 1.2.0 (2026-08-02): the command inventory was two groups out of date — `skills` and `install`
  shipped and this skill still said the CLI covers auth/profile/team plus `reply api`, which is
  how an agent ends up telling a user a command does not exist. Added self-update, and a note
  that a user without an account can register during login instead of being turned away.
- 1.1.0 (2026-07-30): moved into the `reply-adapter` pack; category `technical` → `execution`;
  `auth-and-keys` renamed `reply-auth`.
- 1.0.0 (2026-07-27): initial version, matches reply-cli v1 (auth, profiles, teams, `reply api`).
