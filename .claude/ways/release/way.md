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
| `make release-patch` | Bump patch, sync versions, commit, tag, push |
| `make release-minor` | Bump minor, sync versions, commit, tag, push |
| `make release-major` | Bump major, sync versions, commit, tag, push |
| `make publish-all` | Build mcpb + publish npm + GitHub release |
| `make mcpb` | Build .mcpb bundle only |

## Version Files

`scripts/version-sync.cjs` keeps these in sync from `package.json`:
- `package.json` (source of truth)
- `server.json`
- `manifest.json`
- `mcpb/manifest.json`

Never edit versions in these files directly — always go through `make release-*`.

## Publishing Channels

1. **npm** — triggered automatically by `v*` tag push via `.github/workflows/npm-publish.yml`
2. **mcpb** — built locally via `make mcpb`, attached to GitHub release
3. **GitHub Release** — created via `gh release create` with mcpb bundle attached

## Typical Flow

```
make release-patch    # bump + sync + commit + tag + push (triggers npm publish)
make mcpb             # build .mcpb bundle
gh release create v$(version) ... salesforce-cloud-mcp.mcpb
```

Or just `make publish-all` to do it all at once.
