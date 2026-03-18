import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { queryResponse } from '../utils/response-helper.js';
import { SessionCache } from '../utils/session-cache.js';

export interface QueryParams {
  query: string;
  pageSize?: number;
  pageNumber?: number;
  detail?: 'summary' | 'full';
}

function isQueryParams(obj: any): obj is QueryParams {
  return typeof obj === 'object' && obj !== null && typeof obj.query === 'string';
}

export async function handleExecuteSOQL(client: SalesforceClient, args: any, cache?: SessionCache) {
  if (!isQueryParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid query parameters'
    );
  }

  const fingerprint = `soql:${args.query}:${args.pageSize || ''}:${args.pageNumber || ''}`;

  // Check query cache first
  if (cache) {
    const cached = cache.getQuery(fingerprint);
    if (cached) {
      return queryResponse(cached as Record<string, unknown>, 'execute_soql', args.detail);
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

  return queryResponse(records as Record<string, unknown>, 'execute_soql', args.detail);
}
