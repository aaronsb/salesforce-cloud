.PHONY: build test lint lint-fix clean publish pack inspect watch check help

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

build: ## Compile TypeScript
	npm run build

test: ## Run test suite
	npm test

lint: ## Check code quality
	npm run lint

lint-fix: ## Auto-fix lint issues
	npm run lint:fix

clean: ## Remove build artifacts
	rm -rf build/ *.tgz

inspect: ## Launch MCP inspector
	npm run inspector

pack: build ## Create npm tarball
	npm pack

publish: build lint test ## Publish to npm
	npm publish

watch: ## Watch mode for development
	npm run watch

check: lint test build ## Verify everything before shipping
	@echo "All checks passed"
