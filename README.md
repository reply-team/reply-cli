# Reply CLI

`reply` is the command-line interface for [Reply.io](https://reply.io). Sign in
once and every Reply.io API request runs as you — from your terminal or your
scripts. Today it handles authentication and identity, and `reply api` gives you
authenticated access to the full v3 API; higher-level commands for sequences,
contacts, and the inbox are on the way.

## Installation

Requires [Node.js](https://nodejs.org) 20 or newer. The CLI is published to
GitHub Packages under the `@reply-team` scope, so point that scope at the
registry once, then install globally:

```sh
echo "@reply-team:registry=https://npm.pkg.github.com" >> ~/.npmrc
npm install -g @reply-team/reply-cli
```

```sh
reply --version
```

## Usage

```sh
reply <command> [flags]
reply <command> --help
```

Run `reply --help` for the full command list. Add `--json` to any command for
machine-readable output suitable for scripts.

## Authentication

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
reply --profile bob@reply.io auth whoami   # override for a single command
```

The active profile is resolved as `--profile` → `REPLY_PROFILE` → the profile
set with `profile use` → the built-in default.

Manage profiles after creating them:

```sh
reply profile show                         # inspect the current profile (no secrets)
reply profile show alice@reply.io          # inspect a specific one
reply profile rename alice@reply.io ally   # also moves the stored credential
reply profile unset ally team-id           # clear a field (authority|api_base|team-id)
reply profile delete ally                  # remove it and its stored credential
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

## Environment variables

| Variable | Description |
|----------|-------------|
| `REPLY_API_KEY` | API key used as the credential for the current invocation |
| `REPLY_PROFILE` | Profile to use (same as `--profile`) |
| `REPLY_TEAM_ID` | Team/workspace id sent as `X-TEAM-ID` (same as `--team-id`) |
| `REPLY_CONFIG_DIR` | Config directory (default `~/.config/reply`; `%APPDATA%\reply` on Windows) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for building from source, running the
tests, credential-store internals, and the release process.
