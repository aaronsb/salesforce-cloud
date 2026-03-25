# CLAUDE.md

## Commands

- `npm run build` — compile TypeScript
- `npm run watch` — watch mode
- `npm run lint` / `npm run lint:fix` — linting
- `npm test` — run tests
- `npm run inspector` — MCP inspector
- `make check` — lint + test + build

## Distribution

npm package (`npx salesforce-cloud`). `manifest.json` for .mcpb bundles.

## Environment

Required: `SF_CLIENT_ID`, `SF_CLIENT_SECRET`
Optional: `SF_USERNAME`, `SF_PASSWORD` (if set, uses password flow; otherwise uses client credentials flow)
Optional: `SF_LOGIN_URL` (defaults to `https://login.salesforce.com`)
Optional: `SF_WORKSPACE_DIR` (file download directory; defaults to `~/.local/share/salesforce-cloud-mcp/workspace/`)
