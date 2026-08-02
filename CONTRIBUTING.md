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

`npm run smoke:hosts` is a separate check that runs `reply skills install`
entirely inside a throwaway `HOME`/`USERPROFILE` sandbox, and proves your real
home is untouched with a before/after filesystem snapshot. Native hosts
(Claude Code, Codex) are only genuinely exercised when actually installed —
each is additionally pointed at a throwaway config directory
(`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) so its real plugin state is untouched
either way. Flat-directory hosts (Cursor, Gemini CLI, GitHub Copilot) are
always *simulated* inside the sandbox, regardless of what is really on your
machine — that's deliberate, since it's the only way the flat-directory
install path gets exercised at all. It is not part of `npm test` because it
clones from GitHub and, for native hosts, needs a real assistant installed to
exercise for real.

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

## Packages: public vs internal

The same source ships as **two npm packages** (both expose the `reply` bin —
identical commands and flags; only the package name and registry differ):

| Package | Registry | For | Install |
|---|---|---|---|
| `reply-cli` | public npm | end users | `npm install -g reply-cli` |
| `@reply-team/reply-cli` | GitHub Packages | the team, to test pre-release builds | see below |

A public `X.Y.Z` is byte-for-byte the internal tag `vX.Y.Z` — promoted, not rebuilt
differently.

To install an **internal build** (the newest green `main`, published on every
qualifying merge), point the `@reply-team` scope at GitHub Packages and authenticate
with a GitHub token that has `read:packages`:

```sh
npm config set @reply-team:registry https://npm.pkg.github.com
npm config set //npm.pkg.github.com/:_authToken <GITHUB_TOKEN>   # read:packages
npm install -g @reply-team/reply-cli          # newest internal build (@latest)
npm install -g @reply-team/reply-cli@0.3.0    # a specific build
```

`reply install` works on an internal build too, and keeps you on the internal
channel: it reads the package name it is running as, so it will never move you
between the two. Because the internal package lives on GitHub Packages, the
registry line and the `read:packages` token above have to be in place — the
command reminds you of both if the update fails. What it compares against is the
newest release of any kind, pre-releases included, which is exactly the internal
stream; the public channel compares against the promoted release instead.

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

### Public npm release (manual)

To ship a tested build to the public `reply-cli` package on npmjs, run the
**publish-public** workflow (Actions → Run workflow) with a `vX.Y.Z` tag. It rebuilds
from that tag, publishes to public npm via **OIDC trusted publishing** (no token) with
provenance, and flips that tag's GitHub Release from pre-release to full/latest. The
publish is gated by the `npm-public` environment — a `release-mergers` reviewer must
approve it. A public `X.Y.Z` is byte-for-byte the internal tag `vX.Y.Z`.

## Versioning & compatibility

reply-cli follows [Semantic Versioning](https://semver.org). The version is derived
automatically from Conventional Commit messages: `fix:` → patch, `feat:` → minor; a
major bump happens only when we explicitly declare one.

### Pre-1.0 (current)

While the version is `0.x` the CLI is still stabilizing, so — per semver's 0.x rule —
a **minor** release (`0.x.0`) may contain breaking changes. Pin an exact version if you
need stability before 1.0.0. We will cut **1.0.0** once the command surface and the
`--json` output are declared stable.

Contributor rule: **do not use `!` / `BREAKING CHANGE:` in commits while on 0.x** — a
breaking change rides in a normal `feat:` minor. (Otherwise semantic-release would jump
straight to 1.0.0.)

### What counts as breaking (the compatibility surface)

From 1.0.0 onward, a **major** bump is required to:

- remove or rename a command, flag, or argument;
- change the meaning of an **exit code**;
- change the **`--json` / `--pretty` output shape** (field names, types, structure);
- change the **config-file format** or a `REPLY_*` **environment variable**;
- raise the minimum **Node.js** version.

Additive changes (a new command, a new optional flag, a new field in `--json`) are
**minor**. Fixes that don't touch the above are **patch**.

### Deprecation

Before removing anything in the compatibility surface, we **deprecate it first**: it
keeps working and prints a warning on **stderr** (never stdout, so `--json` stays clean)
for at least **one minor release**. Removal happens only in a later **major**.
