import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { PaginationParams } from '../types/index.js';
import { simpleResponse } from '../utils/response-helper.js';

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
  ) as unknown as Record<string, unknown>;

  // Render describe results as structured markdown
  const lines: string[] = [`# ${args.objectName}`];

  if (metadata.label) lines.push(`**Label:** ${metadata.label}`);
  if (metadata.keyPrefix) lines.push(`**Key Prefix:** ${metadata.keyPrefix}`);
  if (metadata.recordCount != null) lines.push(`**Records:** ${metadata.recordCount}`);

  const fields = metadata.fields as Array<Record<string, unknown>> | undefined;
  if (fields && fields.length > 0) {
    lines.push('');
    lines.push(`## Fields (${fields.length})`);
    lines.push('Name | Type | Label');
    lines.push('--- | --- | ---');
    for (const f of fields) {
      lines.push(`${f.name} | ${f.type} | ${f.label || ''}`);
    }
  }

  return simpleResponse(lines.join('\n'), 'describe_object', { objectName: args.objectName });
}

export async function handleListObjects(client: SalesforceClient, args: any) {
  const pagination: PaginationParams = {
    pageSize: typeof args?.pageSize === 'number' ? args.pageSize : undefined,
    pageNumber: typeof args?.pageNumber === 'number' ? args.pageNumber : undefined
  };

  const objects = await client.listObjects(pagination) as unknown as Record<string, unknown>;

  const results = (objects.results || []) as Array<Record<string, unknown>>;
  const lines: string[] = [`## Salesforce Objects (${results.length})`];
  for (const obj of results) {
    lines.push(`- **${obj.name}** — ${obj.label || ''}`);
  }

  if (objects.totalPages && ((objects.pageNumber as number) || 1) < (objects.totalPages as number)) {
    lines.push(`\nPage ${objects.pageNumber || 1}/${objects.totalPages} — use pageNumber to see more`);
  }

  return simpleResponse(lines.join('\n'), 'list_objects');
}
