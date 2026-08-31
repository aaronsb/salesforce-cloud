---
description: Release workflow — version bumping, npm publish, mcpb bundle, GitHub releases
vocabulary: release publish version bump tag npm mcpb bundle deploy ship
pattern: npm version|npm publish|make release|make publish|mcpb pack|gh release
threshold: 2.0
scope: agent, subagent
---
# Release Workflow

## Use the Makefile

Do NOT manually bump versions or tag. The Makefile handles version sync across all manifests.

| Command | What it does |
|---------|-------------|
| `make release-patch` | Bump patch, sync versions, commit, tag, push — CI publishes everything |
| `make release-minor` | Bump minor, same flow |
| `make release-major` | Bump major, same flow |
| `make publish-all` | Manual fallback: registry + mcpb upload (CI does all of this on tag push) |
| `make mcpb` | Build .mcpb bundle only |

## Version Files

`scripts/version-sync.cjs` keeps these in sync from `package.json`:
- `package.json` (source of truth)
- `server.json` (version twice: server entry and its npm package)
- `manifest.json`
- `mcpb/manifest.json`
- `src/version.ts`

Never edit versions in these files directly — always go through `make release-*`.
`scripts/check-publish-identity.cjs` gates every publish path on all of them
agreeing with the tag.

## Publishing Channels

The `v*` tag push publishes all three from CI, by OIDC — there is nothing to run
by hand:

1. **npm** — `.github/workflows/npm-publish.yml`, trusted publishing
2. **MCP Registry** — the `mcp-registry` job in the same workflow, after npm succeeds
3. **.mcpb + GitHub Release** — `.github/workflows/release-mcpb.yml`

## Typical Flow

```
make release-patch      # bump + sync + commit + tag + push; CI does the rest
gh run list --limit 3   # confirm both workflows went green
```

Run `make publish-all` only when CI could not publish. It is idempotent, so it
finishes a half-succeeded release instead of double-publishing.
