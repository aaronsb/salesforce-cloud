# Release Runbook

How to ship a new version of salesforce-cloud-mcp.

## What Happens on Release

A single `git tag` push triggers two CI workflows:

| Workflow | File | What it does |
|----------|------|-------------|
| **Publish to npm** | `.github/workflows/npm-publish.yml` | Builds, publishes to npm with provenance |
| **Build .mcpb** | `.github/workflows/release-mcpb.yml` | Builds .mcpb bundle, attaches to GitHub Release |

Both npm and mcpb publishing start from the same `v*` tag.

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

### 3. Publish to MCP Registry (manual)

The npm publish and .mcpb GitHub Release are automated by CI. The MCP Registry publish is manual:

```bash
make publish-all    # builds .mcpb locally, publishes to MCP Registry, creates GitHub Release
```

Or just the registry step:

```bash
mcp-publisher login github
mcp-publisher publish server.json
```

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

### 5. Verify CI

```bash
gh run list --limit 3   # should show npm-publish running
gh run watch <run-id>   # watch it
```

### 6. Verify artifacts

```bash
# npm
npm view @aaronsb/salesforce-cloud-mcp version

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

The version lives in four places, kept in sync by `make version-sync`:

| File | Field | Purpose |
|------|-------|---------|
| `package.json` | `version` | Source of truth, npm |
| `server.json` | `version` | MCP server metadata |
| `manifest.json` | `version` | Desktop extension metadata |
| `mcpb/manifest.json` | `version` | .mcpb bundle metadata |

Never edit these manually — use `npm version` + `make version-sync`.

## Publishing Channels

| Channel | How | Automated? |
|---------|-----|-----------|
| **npm** | Tag push triggers `.github/workflows/npm-publish.yml` | Yes (CI) |
| **.mcpb + GitHub Release** | Tag push triggers `.github/workflows/release-mcpb.yml` | Yes (CI) |
| **MCP Registry** | `mcp-publisher publish server.json` | No (manual) |
