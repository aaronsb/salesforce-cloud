.PHONY: build test lint clean publish pack inspect

build:
	npm run build

test:
	npm test

lint:
	npm run lint

lint-fix:
	npm run lint:fix

clean:
	rm -rf build/ *.tgz

inspect:
	npm run inspector

# npm packaging
pack: build
	npm pack

publish: build lint test
	npm publish

# Local development
watch:
	npm run watch

# Verify everything before shipping
check: lint test build
	@echo "All checks passed"
