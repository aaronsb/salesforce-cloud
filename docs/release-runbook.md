# Release Runbook

How to ship a new version of salesforce-cloud-mcp.

## What Happens on Release

A single `git tag` push triggers two CI workflows:

| Workflow | File | What it does |
|----------|------|-------------|
| **Publish to npm and the MCP Registry** | `.github/workflows/npm-publish.yml` | Gates on the release identity, publishes to npm with provenance, verifies npm serves the tag, then publishes `server.json` to the MCP Registry |
| **Build .mcpb** | `.github/workflows/release-mcpb.yml` | Gates on the release identity, builds the .mcpb bundle, attaches it to the GitHub Release |

All three channels publish from the same `v*` tag. Nothing is published by hand.

### npm auth: trusted publishing, not a token

`npm-publish.yml` authenticates by exchanging the workflow's OIDC identity for a
short-lived credential. There is no `NPM_TOKEN`, deliberately: a token would take
precedence over OIDC, and a token is a credential that rots. The previous one
expired in June and the publish job failed silently for a month — nothing was
released in between, and the `.mcpb` job kept succeeding beside it, so the
release looked done. v0.6.0 and v0.7.0 both had to be published by hand.

This needs a **trusted publisher configured on npmjs.com** for the package,
naming this repository and `npm-publish.yml`. It is account configuration, not
repo configuration — it does not live in git, so it is worth knowing it exists:

> npmjs.com → the package → Settings → Trusted Publisher → GitHub Actions →
> repository `aaronsb/salesforce-cloud`, workflow `npm-publish.yml`

Three guards exist because this failure is quiet by nature:
`scripts/check-publish-identity.cjs` refuses to publish unless the tag,
`package.json`, `server.json`, and both manifests agree — and `server.json`
names the npm package this repo actually publishes; the job asserts npm
actually serves the tagged version after publishing; and `make release-*`
refuses to tag if the release commit's version files disagree.

## Release Flow

### 1. Ensure main is clean

```bash
git checkout main && git pull
make check          # lint + test + build must pass
```

### 2. Bump version

```bash
# Pick one:
make release-patch  # x.y.Z — bug fixes
make release-minor  # x.Y.0 — new features
make release-major  # X.0.0 — breaking changes
```

`make release-*` runs `check`, bumps `package.json`, syncs version to `server.json` + `manifest.json` + `mcpb/manifest.json`, commits, tags, and pushes.

If `make check` fails, fix it first. Don't skip the check.

### 3. Verify CI

```bash
gh run list --limit 3   # npm-publish and release-mcpb should both go green
gh run watch <run-id>   # watch one
```

Check that both workflows actually went green rather than assuming — a publish
failure lives in a different workflow from the tag push and is quiet by nature.
There is nothing to run by hand: npm, the MCP Registry, and the GitHub Release
all publish from the tag push.

If CI cannot publish (runner outage, auth breakage), `make publish-all` is the
manual fallback for the registry and the .mcpb upload. It runs the same
identity gate and the same idempotent registry publish as CI, so running it
after a half-succeeded CI run finishes what is missing instead of
double-publishing.

### 4. Manual release (if make fails)

If `make release-*` fails partway through, complete manually:

```bash
npm version minor --no-git-tag-version   # or patch/major
make version-sync                         # sync to server.json + manifest.json + mcpb/manifest.json
git add package.json package-lock.json server.json manifest.json mcpb/manifest.json
git commit -m "chore: release vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push && git push --tags
```

### 5. Verify artifacts

```bash
# npm
npm view @aaronsb/salesforce-cloud-mcp version

# MCP Registry
curl -fsSL "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.aaronsb/salesforce-cloud" | head -c 500

# GitHub Release — should have salesforce-cloud-mcp.mcpb attached
gh release view vX.Y.Z
```

## Pre-release Versions

For alpha/beta/rc releases:

```bash
npm version preminor --preid alpha --no-git-tag-version
# → x.y.0-alpha.0
make version-sync
# commit, tag, push as above
```

## Retagging

If a tag was pushed before a fix was ready:

```bash
git tag -d vX.Y.Z                        # delete local tag
git push origin :refs/tags/vX.Y.Z        # delete remote tag
# fix the issue, commit, push
git tag -a vX.Y.Z -m "vX.Y.Z"           # retag on fixed commit
git push --tags                           # triggers CI again
```

## Local .mcpb Builds

For testing or manual distribution without CI:

```bash
make mcpb              # builds bundle for current platform
```

Requires `mcpb` CLI installed (`npm install -g @anthropic-ai/mcpb`).

## Version Files

The version lives in five places, kept in sync by `make version-sync`:

| File | Field | Purpose |
|------|-------|---------|
| `package.json` | `version` | Source of truth, npm |
| `server.json` | `version` | MCP server metadata |
| `manifest.json` | `version` | Desktop extension metadata |
| `mcpb/manifest.json` | `version` | .mcpb bundle metadata |
| `src/version.ts` | `VERSION` | Reported to MCP clients in the initialize handshake |

Never edit these manually — use `npm version` + `make version-sync`.

`src/version.ts` is generated rather than read from `package.json` at runtime
because the .mcpb build strips `package.json` out of the bundle. `make check`
fails if any of the five drift, so a forgotten `version-sync` can't ship — the
server previously reported `0.2.0` while package.json said `0.5.0`.

## Publishing Channels

| Channel | How | Automated? |
|---------|-----|-----------|
| **npm** | Tag push triggers `.github/workflows/npm-publish.yml` | Yes (CI) |
| **.mcpb + GitHub Release** | Tag push triggers `.github/workflows/release-mcpb.yml` | Yes (CI) |
| **MCP Registry** | The `mcp-registry` job in `npm-publish.yml`, after npm succeeds | Yes (CI) |

`make publish-all` is the manual fallback for the registry and the .mcpb
upload when CI cannot publish.
