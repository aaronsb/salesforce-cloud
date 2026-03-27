---
description: MCP server tool development pattern, handler registration, schema definitions
vocabulary: mcp tool handler schema register server transport stdio protocol model context manifest mcpb
pattern: tool-schemas|handlers/|McpError|ListToolsRequest|CallToolRequest
threshold: 2.0
scope: agent, subagent
---
# MCP Tool Development

## Adding a New Tool
1. Define schema in `src/schemas/tool-schemas.ts`
2. Create handler in `src/handlers/{name}-handlers.ts`
3. Add TypeScript types in `src/types/` if needed
4. Register handler in `src/index.ts` switch statement
5. Update `manifest.json` tools array

## Handler Pattern
- Each handler accepts tool arguments, returns MCP content blocks
- Use `McpError` with appropriate `ErrorCode` for error responses
- All list responses must include pagination (`pageInfo`)

## Response Format
```typescript
{ content: [{ type: 'text', text: JSON.stringify(result) }] }
```

## Testing
- Mock `SalesforceClient` methods in tests
- Test both success and error paths
- Validate pagination behavior
