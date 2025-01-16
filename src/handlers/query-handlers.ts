import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { PaginationParams } from '../types/index.js';

interface QueryParams extends PaginationParams {
  query: string;
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

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(records, null, 2),
      },
    ],
  };
}
