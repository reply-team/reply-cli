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
| Gemini CLI · GitHub Copilot | copied files | each vendor's documented directory | not yet | — |

The project directories overlap in a way the rows above do not show: Windsurf
also reads `.agents/skills`, which is where `--project` puts things for Cursor
and Codex. A project-scope install aimed at one of them therefore makes those
skills visible in the others, and removing them for one changes what the others
see. Use user scope when you want a host's skills to itself.

"Not yet" means the skills directory for that assistant comes from its
documentation and has not been confirmed by a verification run of our own: the
install works, but we cannot promise the assistant reads from where we put the
files. The remaining two are marked `(paths not yet verified)`
in the report and carry `"verified": false` in `--json`. Cursor and Windsurf
were verified with reply-cli 0.5.1.

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
