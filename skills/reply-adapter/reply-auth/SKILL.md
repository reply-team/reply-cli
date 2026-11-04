---
name: reply-auth
description: >
  Reply.io credentials in depth: API key types (personal, Team, Organization), the scopes
  model (domain:verb), acting-user headers, and team/organization resolution errors
  (TEAM_REQUIRED, USER_REQUIRED and friends). Use when choosing or creating a key for an
  agent, resolving 401/403 auth errors, or working across multiple teams.
metadata:
  version: 1.1.0
  pack: reply-adapter
  category: execution
  maturity: reviewed
  status: active
  owner: skills-maintainers
  tags: [auth, keys, scopes, teams, security]
  tools: [reply-cli, reply-mcp]
  api: [authentication, user-account]
  relations:
    recommends: [reply-cli, reply-mcp, approval-boundaries]
---

# Auth, keys & scopes

## Purpose

Every toolkit surface authenticates with the same `Authorization: Bearer` header — an API key or
an OAuth token. What differs is the key's **type** (who it can act as) and its **scopes** (what it
may call). Getting these right is the difference between a safely-bounded agent and a 403 loop.

## When to use / when NOT to use

- Use when provisioning an agent's credential, debugging 401/403, or acting across teams/orgs.
- For interactive personal use, `reply auth login` (OAuth) is simpler — see `reply-cli`.

## Prerequisites

Access to Reply → **Settings → API Key** (personal), or owner/admin rights for Team/Org keys.

## Execution guidance

### Key types

| Type | Acts as | Notes |
|---|---|---|
| Personal | you | scoped; the right choice for agents and MCP |
| Team | any user in one workspace | owner-created; add `X-User-Id` or `X-User-Email` to impersonate; defaults to the owner |
| Organization | any user in any org workspace | **always** requires an acting user: `X-USER-ID`, or `X-User-Email` + `X-TEAM-ID`; multiple keys, named/rotated independently |

Resolved-user permissions always apply — no key grants more than the user it acts as.
MCP accepts personal keys/OAuth only (no Team/Org keys).

### Scopes (`domain:verb`)

Verbs: `read`, `write` (create/update/delete), `operate` (runtime actions: push to sequence,
start/pause, reply). `write` and `operate` each satisfy `read`; they do NOT include each other.
Wildcards: `contacts:*` (any verb in a domain), `*:*` (everything). Domains: settings, contacts,
sequences, channels, inbox, tasks, reporting (read-only), webhooks, ai-sdr, other.
Every endpoint's doc page states its minimal scope; llms.txt shows it per line.

**Least privilege for agents:** grant only what the workflow needs, e.g. inbox triage =
`inbox:read` + `inbox:operate`; analytics = `reporting:read` + `sequences:read`. A 403 with
`insufficient_scope` mid-workflow means the key is missing one of these — the response never
lists granted scopes, so check the key in Settings.

### Team / organization resolution

A credential that can access more than one team must resolve to exactly one before team-scoped
work runs. Codes you will meet (problem+json):

| Code | Status | Meaning | Fix |
|---|---|---|---|
| `TEAM_REQUIRED` | 403 | multiple teams, none specified; payload lists accessible teams | pin one: `reply team use <id>` / `--team-id` / `X-TEAM-ID` |
| `TEAM_NOT_ACCESSIBLE` | 403 | specified team isn't yours | pick from `reply team list` |
| `USER_REQUIRED` | 403 | org key without acting user | pass `--user-id` or `--user-email` (+ team id) |
| `USER_NOT_FOUND` | 401 | acting user doesn't exist | verify the id/email |

Plain invalid/expired key = **empty-body 401** with `WWW-Authenticate: Bearer` (no JSON) — that's
an auth failure, not a resolution failure.

## Validation

`reply api /v3/whoami` confirms identity; `reply api /v3/whoami/team-users` lists teams the
credential can act in. Verify both before long workflows.

## Reporting

When a workflow required scope or team changes, record which key/scopes/team were used — future
runs depend on it.

## Failure modes

Covered above; one addition — key revoked mid-run: every call turns empty-401. Stop, tell the
user, never retry in a loop.

## Safety

- Never commit keys, print them in logs, or store them in the workspace; the CLI store and host
  secret managers are the only homes. Rotate on any suspicion of exposure.
- For unattended agents (daemon, schedulers) prefer narrowly-scoped personal keys and treat
  `operate` scopes as the dangerous tier — they send real messages.

## Related skills

- `reply-cli` — where credentials live locally and how precedence works.
- `reply-mcp` — auth specifics of the MCP connection.

## Changelog

- 1.1.0 (2026-07-30): renamed `auth-and-keys` → `reply-auth` (the knowledge is Reply-specific,
  so it carries the provider prefix); moved into the `reply-adapter` pack.
- 1.0.0 (2026-07-27): initial version per docs.reply.io authentication guide.
