# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Building and Development
- **Build**: `npm run build` - Compiles TypeScript to JavaScript in `build/` directory
- **Development**: `npm run watch` - Watch mode for automatic recompilation
- **Linting**: `npm run lint` - Check for code quality issues
- **Fix Linting**: `npm run lint:fix` - Auto-fix linting issues
- **Testing**: `npm run test` - Run Jest test suite
- **Inspector**: `npm run inspector` - Launch MCP inspector for debugging

### Running Tests
- Single test file: `npm test -- src/__tests__/filename.test.ts`
- Watch mode: `npm test -- --watch`
- Coverage: `npm test -- --coverage`

## Architecture Overview

This is a Model Context Protocol (MCP) server that provides Salesforce integration tools. The architecture follows a handler-based pattern where each tool has its own dedicated handler function.

### Key Components

1. **Entry Point** (`src/index.ts`): Initializes the MCP server and registers all tools
2. **Client Layer** (`src/client/`): `SalesforceClient` class wraps JSForce for all Salesforce API interactions
3. **Handler Layer** (`src/handlers/`): Each tool has a dedicated handler function that processes requests
4. **Schema Definitions** (`src/schemas/tool-schemas.ts`): Declarative tool definitions using MCP schema format
5. **Type Definitions** (`src/types/`): TypeScript interfaces for strong type safety

### Tool Pattern

When adding new tools:
1. Define the tool schema in `src/schemas/tool-schemas.ts`
2. Create a handler function in `src/handlers/` that accepts the tool arguments
3. Add corresponding TypeScript types in `src/types/`
4. Register the handler in `src/index.ts`

### Salesforce Integration Patterns

- **Authentication**: OAuth2 password flow using environment variables
- **Query Pagination**: Built-in pagination support with `pageSize` and `pageNumber` parameters
- **Custom Fields**: Always check for fields ending in `__c` when working with Salesforce data
- **Error Handling**: Use MCP's `McpError` for consistent error responses

### Response Format

All paginated responses follow this structure:
```typescript
{
  records: T[],
  totalSize: number,
  pageInfo: {
    currentPage: number,
    totalPages: number,
    hasNextPage: boolean,
    hasPreviousPage: boolean
  }
}
```

## Salesforce-Specific Considerations

- **Custom Fields**: Most business-specific fields end with `__c`
- **Object Discovery**: Use `describe_object` with `includeFields: true` to discover available fields
- **SOQL Queries**: Build queries dynamically based on discovered fields
- **API Limits**: Be mindful of Salesforce API limits when implementing bulk operations

## Docker Deployment

The project includes multi-stage Docker build for production deployment:
- Base image: Node.js 20 Alpine
- Build stage compiles TypeScript
- Production stage runs with minimal dependencies
- Published to GitHub Container Registry as `ghcr.io/aaronsb/salesforce-cloud`