.PHONY: build test lint fix clean check inspect watch help
.PHONY: version-sync release-patch release-minor release-major publish-all mcpb

VERSION = $(shell node -p 'require("./package.json").version')

build:          ## Build TypeScript
	npm run build

test:           ## Run tests
	npm test

test-watch:     ## Run tests in watch mode
	npx jest --watch

lint:           ## Run linter
	npm run lint

fix:            ## Run linter with auto-fix
	npm run lint:fix

check: lint test build  ## Lint, test, and build (CI gate)
	@echo "All checks passed"

clean:          ## Remove build output
	rm -rf build *.tgz *.mcpb

inspect:        ## Launch MCP Inspector
	npm run inspector

watch:          ## Watch mode for development
	npm run watch

# ── Version & Release ───────────────────────────────────────────────────

version-sync:   ## Sync version from package.json to server.json and manifests
	@echo "Syncing version $(VERSION) to server.json, manifest.json, mcpb/manifest.json, src/version.ts"
	node scripts/version-sync.cjs

release-patch: check  ## Bump patch, sync, commit, tag, push
	@echo "Current version: $(VERSION)"
	npm version patch --no-git-tag-version
	$(MAKE) version-sync
	$(MAKE) _release-commit

release-minor: check  ## Bump minor, sync, commit, tag, push
	@echo "Current version: $(VERSION)"
	npm version minor --no-git-tag-version
	$(MAKE) version-sync
	$(MAKE) _release-commit

release-major: check  ## Bump major, sync, commit, tag, push
	@echo "Current version: $(VERSION)"
	npm version major --no-git-tag-version
	$(MAKE) version-sync
	$(MAKE) _release-commit

_release-commit:
	$(eval NEW_VERSION := $(shell node -p 'require("./package.json").version'))
	git add package.json package-lock.json server.json manifest.json mcpb/manifest.json src/version.ts
	git commit -m "chore: release v$(NEW_VERSION)"
	# Assert the COMMITTED tree carries the bump — the tag is what triggers
	# publishing, so what matters is the tree the tag points at, not the working
	# tree. `make check` can't see this: it reads the working tree, which is in
	# sync even when a version file was left out of the commit. That is exactly
	# how the server shipped 0.2.0 while package.json said 0.5.0.
	@for f in server.json manifest.json mcpb/manifest.json; do \
	  git show HEAD:$$f | grep -q '"version": "$(NEW_VERSION)"' \
	    || { echo "FATAL: release commit has stale version in $$f — not tagging"; exit 1; }; \
	done
	@git show HEAD:src/version.ts | grep -q "VERSION = '$(NEW_VERSION)'" \
	  || { echo "FATAL: release commit has stale version in src/version.ts — not tagging"; exit 1; }
	@echo "Verified: release commit reports v$(NEW_VERSION) everywhere"
	# Run the full publish-identity gate (including the registry's 100-char
	# description cap) BEFORE tagging — a violation caught in CI has already
	# burned a version number.
	node scripts/check-publish-identity.cjs "v$(NEW_VERSION)"
	git tag -a "v$(NEW_VERSION)" -m "v$(NEW_VERSION)"
	git push && git push --tags
	@echo ""
	@echo ""
	@echo "Released v$(NEW_VERSION). The tag push publishes it — npm, the MCP Registry"
	@echo "and the GitHub Release all go out from CI by OIDC. Nothing to run."
	@echo ""
	@echo "  gh run list --limit 3     # both workflows should be green"
	@echo ""
	@echo "'make publish-all' is the fallback for when CI cannot do it, and running it"
	@echo "now would republish what CI already shipped."

# ── Publishing ──────────────────────────────────────────────────────────

mcpb: build     ## Build .mcpb desktop extension bundle
	rm -rf mcpb/server mcpb/package-lock.json
	mkdir -p mcpb/server
	cp -r build/* mcpb/server/
	cp package.json mcpb/server/package.json
	cd mcpb/server && npm install --production --ignore-scripts --silent
	rm -f mcpb/server/package.json mcpb/server/package-lock.json
	mcpb pack mcpb salesforce-cloud-mcp.mcpb
	@echo ""
	@echo "Built: salesforce-cloud-mcp.mcpb ($$(du -h salesforce-cloud-mcp.mcpb | cut -f1))"

# CI publishes all three channels on tag push (npm-publish.yml and
# release-mcpb.yml). This target is the fallback for when CI cannot do it, and
# it runs the same identity gate and idempotent registry publish as CI — a
# fallback runs precisely when something already went wrong, so it needs the
# guards more than CI does, and a half-succeeded CI run (registry published,
# upload failed) must not die on the duplicate registry publish before
# reaching the upload.
publish-all: mcpb  ## Manual fallback: registry + MCPB upload (CI does all of this on tag push)
	@echo ""
	@echo "Publishing v$(VERSION) manually — CI publishes npm, the registry, and the release on tag push."
	@echo "  1. MCP Registry (requires GitHub auth)"
	@echo "  2. Upload MCPB to GitHub Release"
	@echo ""
	@read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || (echo "Aborted." && exit 1)
	node scripts/check-publish-identity.cjs "v$(VERSION)"
	@echo ""
	@echo "── MCP Registry ──"
	mcp-publisher login github
	bash scripts/mcp-registry-publish.sh
	@echo ""
	@echo "── GitHub Release ──"
	@echo "Uploading .mcpb to existing release (created by CI)..."
	gh release upload "v$(VERSION)" salesforce-cloud-mcp.mcpb --clobber 2>/dev/null || \
		(echo "Release v$(VERSION) not found — CI may not have run yet. Creating..."; \
		gh release create "v$(VERSION)" --title "v$(VERSION)" --notes "Release v$(VERSION)" salesforce-cloud-mcp.mcpb)
	@echo ""
	@echo "v$(VERSION) published."

help:           ## Show this help
	@grep -E '^[a-z_-]+:.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
