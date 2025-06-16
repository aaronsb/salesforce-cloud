import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { PaginationParams } from '../types/index.js';

interface DescribeObjectParams {
  objectName: string;
  includeFields?: boolean;
  pageSize?: number;
  pageNumber?: number;
}

function isDescribeObjectParams(obj: any): obj is DescribeObjectParams {
  return typeof obj === 'object' && obj !== null && typeof obj.objectName === 'string';
}

export async function handleDescribeObject(client: SalesforceClient, args: any) {
  if (!isDescribeObjectParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid describe object parameters'
    );
  }

  const pagination: PaginationParams = {
    pageSize: args.pageSize,
    pageNumber: args.pageNumber
  };

  const metadata = await client.describeObject(
    args.objectName,
    args.includeFields,
    pagination
  );

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(metadata, null, 2),
      },
    ],
  };
}

export async function handleListObjects(client: SalesforceClient, args: any) {
  const pagination: PaginationParams = {
    pageSize: typeof args?.pageSize === 'number' ? args.pageSize : undefined,
    pageNumber: typeof args?.pageNumber === 'number' ? args.pageNumber : undefined
  };

  const objects = await client.listObjects(pagination);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(objects, null, 2),
      },
    ],
  };
}
