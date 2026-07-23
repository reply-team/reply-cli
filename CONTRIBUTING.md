# Contributing

Anyone can clone the repo, build it, and open a pull request — contributions and
bug reports are welcome. Merges are restricted: only Reply employees can approve
and merge a PR. Open one from a branch (or a fork), and a maintainer will review.

## Prerequisites

[Node.js](https://nodejs.org) 20 or newer.

## Setup

```sh
npm install
npm run build     # compile TypeScript to dist/
npm test          # run the test suite (vitest)
npm link          # put the built `reply` binary on your PATH
```

## Tests

The suite is fully offline — no test contacts the Reply.io API or the identity
server. `fetch` is stubbed, and the OAuth loopback flow is exercised against a
local `127.0.0.1` listener with an injected browser stub. CI runs the build and
tests on Linux and Windows.

## Conventions

- Data is written to stdout; status and error messages go to stderr.
- `--json` emits compact JSON and `--pretty` indented JSON. On either, an error
  is a single machine-readable line:
  `{"error":{"status":…,"code":…,"title":…,"detail":…,"hint":…}}`.
- Exit codes: `0` success, `1` API or runtime failure, `2` usage error.
- Secrets are never printed; token and key fields are redacted in all output.

## Credentials on disk

Credentials are stored as JSON in the config directory (`~/.config/reply`, or
`%APPDATA%\reply` on Windows), created `0600` inside a `0700` directory — the
same plaintext-file model as `gh`, `aws`, and `az`. On Windows the strict mode
bits are a no-op and it relies on the per-user `%APPDATA%` ACLs, as those tools
do.

Each record is keyed by profile name, so multiple accounts never collide even
when they hit the same backend. A record is either an OAuth entry (access token
+ refresh token + expiry) or an API-key entry. Expired OAuth tokens refresh
automatically; if a refresh fails the record is cleared and the user is prompted
to log in again. The store sits behind a `CredentialStore` interface so an
OS-keychain backend can be added later without touching callers.

## Credential resolution

Resolved in strict order, first hit wins:

1. `--api-key <key>` flag
2. `REPLY_API_KEY` environment variable
3. the stored credential (from `auth login`)

The flag and env var are ephemeral — used for the current invocation only, never
written to disk. There is no `.env` file lookup.

## Testing against a non-prod backend

Profiles inherit the built-in prod URLs; override them to point a profile at
another environment (internal testing only):

```sh
reply profile add dev \
  --authority https://oauth.dev.replyapp.io \
  --api-base  https://api.dev.reply.io/v3
reply --profile dev auth login
```

Any field left off is inherited from the default (prod). Profiles live in
`config.json` in the config directory and can also be hand-edited:

```jsonc
// ~/.config/reply/config.json
{ "profiles": { "dev": { "authority": "https://…", "api_base": "https://…/v3" } } }
```

## Releases

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/).

### Internal builds (automatic)

Every merge to `main` runs CI. If the merged commits include a `feat:` or `fix:`
(per Conventional Commits), semantic-release:

- computes the next semver version,
- publishes it to GitHub Packages under `@latest`
  (`npm install -g @reply-team/reply-cli`),
- pushes a `vX.Y.Z` git tag, and
- creates a **pre-release** GitHub Release whose notes are the changelog.

Commits that only touch docs/CI/chores (`docs:`, `ci:`, `chore:`, `test:`) do not
produce a release. A PR touching only `README.md` / `docs/**` skips the build (the
test matrix doesn't run) and never publishes; such a merge to `main` doesn't start
the workflow at all.

`package.json`'s `version` is intentionally `0.0.0-development` — the real version
of record is the git tag / GitHub Release / published package. Do not hand-edit it.

Commit messages are enforced by commitlint (a local `commit-msg` hook and a PR
check), because the version bump is derived from them.

### Public npm release (deferred — not yet enabled)

Promoting a tested internal build to the public npm registry will be a **manual,
tag-selected** workflow: pick a `vX.Y.Z` tag, rebuild from that commit, publish the
unscoped `reply-cli` to public npm, and flip that tag's GitHub Release from
pre-release to a full release. This is gated on npm-name ownership consolidation and
is tracked in Jira. **It is not implemented yet — there is no public-release workflow.**
