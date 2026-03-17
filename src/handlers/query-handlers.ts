import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { queryResponse } from '../utils/response-helper.js';

export interface QueryParams {
  query: string;
  pageSize?: number;
  pageNumber?: number;
  detail?: 'summary' | 'full';
}

function isQueryParams(obj: any): obj is QueryParams {
  return typeof obj === 'object' && obj !== null && typeof obj.query === 'string';
}

export async function handleExecuteSOQL(client: SalesforceClient, args: any) {
  if (!isQueryParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid query parameters'
    );
  }

  const records = await client.executeQuery(args.query, {
    pageSize: args.pageSize,
    pageNumber: args.pageNumber
  });

  return queryResponse(records as Record<string, unknown>, 'execute_soql', args.detail);
}
