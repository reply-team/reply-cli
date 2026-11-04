---
name: reply-mcp
description: >
  Connect Reply.io to an MCP-compatible AI client (Claude, ChatGPT, Codex, Cursor) via the
  remote server mcp.reply.io, choose the right auth, and decide when to use MCP tools versus
  the CLI. Use when setting up the Reply MCP connection or choosing between MCP and CLI execution.
metadata:
  version: 1.2.0
  pack: reply-adapter
  category: execution
  maturity: reviewed
  status: active
  owner: skills-maintainers
  tags: [mcp, setup, auth]
  tools: [reply-mcp]
  api: [introduction]
  relations:
    recommends: [reply-cli, reply-auth, reply-operations-mapping]
    alternative-to: [reply-cli]
---

# Reply MCP

## Purpose

Reply MCP (`https://mcp.reply.io`, remote streamable-http) exposes a curated catalog of Reply
tools (`reply_*`) to any MCP client — contacts, sequences, analytics, inbox, tasks, channels,
team, and the AI-SDR configuration surface. One connection, no HTTP plumbing.

## When to use / when NOT to use

- Use in MCP-capable clients when no shell is available, or when curated tools cover the task.
- The MCP catalog is a **subset** of API v3, and API v3 is itself a minority of the job. Of the
  325 vendor-neutral operations in the `sdr-operations` contract, **most are not performable here
  at all**, and the rest divide into fully, by composition, and only in part.
  `reply-operations-mapping` carries that division operation by operation and is generated from the
  fulfilment register — the figures live there once, rather than being copied into a second skill
  where they would go stale without anyone noticing. The tool catalog is a curated slice of what
  remains, so **a missing tool is the ordinary case, not a malfunction**. Size a plan against that
  rather than against the impression a tidy tool list gives.
- When a needed capability is missing from the tools, fall back to the CLI (`reply api` reaches
  the whole API) rather than improvising with an adjacent tool. A tool that returns approximately
  the right shape for a different question is worse than no tool.

## Prerequisites

Either a **personal scoped API key** (Reply → Settings → API Key) or an OAuth-capable MCP client.

## Execution guidance

### Connect

```bash
# Claude Code
claude mcp add --transport http reply-mcp https://mcp.reply.io \
  --header "Authorization: Bearer <personal_api_key>"

# Codex
export REPLY_MCP_TOKEN="<personal_api_key>"
codex mcp add reply-mcp --url https://mcp.reply.io --bearer-token-env-var REPLY_MCP_TOKEN
```

Desktop apps (Claude, ChatGPT): add a remote/custom connector with URL `https://mcp.reply.io` and
authorize via OAuth. Verify by listing tools — `reply_*` should appear.

### Choosing auth

- **Personal API key (recommended):** scoped — grant only the permissions the agent needs; a tool
  is callable only if the key holds its scope.
- **OAuth:** grants the full tool catalog (all scopes) — convenient, but prefer a scoped key when
  you want to bound what the agent can do.
- **Not supported:** Team keys and Organization keys (act-on-behalf) — MCP is a single-user
  connection. Never pass credentials in the URL (`?api_key=…`); header or OAuth only.

## Validation

After connecting, call a read tool (e.g. current-user/team lookup) and confirm the expected
identity before running workflows.

## Reporting

Note which surface executed each step (MCP tool vs CLI) so runs are reproducible.

## Failure modes

- Tool missing for the task → use `reply-cli` (`reply api`), which reaches the whole documented
  API. If the operation is not there either, `reply-operations-mapping` says so and why — that is
  an answer to give the user, not a gap to improvise around.
- Scope-denied tool call → the key lacks that permission; see `reply-auth`.
- OAuth client fails with a registration/allow-list error → the client lacks CIMD support and DCR
  is allow-listed server-side; report it to the Reply community Slack (docs.reply.io/slack).

## Safety

Same rules as everywhere: tools that send messages, start sequences, or delete data require the
user's explicit confirmation in the conversation. A scoped key is the mechanical enforcement —
recommend read-mostly scopes for unattended agents.

## Related skills

- `reply-cli` — full-surface alternative and fallback.
- `reply-auth` — scope grammar and key hygiene.
- `reply-operations-mapping` — which operations Reply performs at all, and how far.

## Changelog

- 1.2.0 (2026-08-10): the "curated subset" claim was measured against nothing. It is now stated
  against the 325-operation contract, and it points at the generated fulfilment register for the
  division rather than restating figures that would go stale here — so a reader can see that the
  tool catalog is a slice of a surface that already covers a minority of the job, and that a
  missing tool is the expected case rather than a fault. Added the rule that an adjacent tool is
  never a substitute for a missing one.
- 1.1.0 (2026-07-30): moved into the `reply-adapter` pack; category `technical` → `execution`;
  `auth-and-keys` renamed `reply-auth`.
- 1.0.0 (2026-07-27): initial version per docs.reply.io/reply-mcp.
