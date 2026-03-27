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
	@echo "Syncing version $(VERSION) to server.json, manifest.json, mcpb/manifest.json"
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
	git add package.json package-lock.json server.json manifest.json mcpb/manifest.json
	git commit -m "chore: release v$(NEW_VERSION)"
	git tag -a "v$(NEW_VERSION)" -m "v$(NEW_VERSION)"
	git push && git push --tags
	@echo ""
	@echo ""
	@echo "Released v$(NEW_VERSION)."
	@echo "  npm: publishing automatically via GitHub Actions trusted publisher"
	@echo "  Run 'make publish-all' for MCPB bundle + MCP Registry + GitHub Release"

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

publish-all: mcpb  ## Build MCPB, publish to MCP Registry (npm + GitHub Release via CI)
	@echo ""
	@echo "Publishing v$(VERSION):"
	@echo "  - npm: automatic via CI (triggered by tag push)"
	@echo "  - GitHub Release + .mcpb: automatic via CI (triggered by tag push)"
	@echo "  - MCP Registry: manual (below)"
	@echo ""
	@read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || (echo "Aborted." && exit 1)
	@echo ""
	@echo "── MCP Registry ──"
	mcp-publisher login github
	mcp-publisher publish server.json
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
