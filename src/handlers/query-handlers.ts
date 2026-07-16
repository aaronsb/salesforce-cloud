import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { queryResponse } from '../utils/response-helper.js';
import { SessionCache } from '../utils/session-cache.js';
import { buildQueryFieldHints, CatalogSource } from '../utils/field-hints.js';

export interface QueryParams {
  query: string;
  pageSize?: number;
  pageNumber?: number;
  detail?: 'summary' | 'full';
}

function isQueryParams(obj: any): obj is QueryParams {
  return typeof obj === 'object' && obj !== null && typeof obj.query === 'string';
}

export async function handleExecuteSOQL(
  client: SalesforceClient,
  args: any,
  cache?: SessionCache,
  fieldDiscovery?: CatalogSource,
) {
  if (!isQueryParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid query parameters'
    );
  }

  // Name the queried object's top fields alongside the result, so writing the
  // next query doesn't require a describe round-trip (ADR-300).
  const hints = fieldDiscovery ? buildQueryFieldHints(fieldDiscovery, args.query) : '';

  const fingerprint = `soql:${args.query}:${args.pageSize || ''}:${args.pageNumber || ''}`;

  // Check query cache first
  if (cache) {
    const cached = cache.getQuery(fingerprint);
    if (cached) {
      return withHints(queryResponse(cached as Record<string, unknown>, 'execute_soql', args.detail), hints);
    }
  }

  const records = await client.executeQuery(args.query, {
    pageSize: args.pageSize,
    pageNumber: args.pageNumber
  });

  // Store in query cache
  if (cache) {
    cache.setQuery(fingerprint, records);
  }

  return withHints(queryResponse(records as Record<string, unknown>, 'execute_soql', args.detail), hints);
}

/** Append field breadcrumbs to a rendered response. */
function withHints<T extends { content: Array<{ type: string; text: string }> }>(response: T, hints: string): T {
  if (!hints) return response;
  const [first, ...rest] = response.content;
  return { ...response, content: [{ ...first, text: first.text + hints }, ...rest] };
}
