import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { PaginationParams } from '../types/index.js';
import { simpleResponse } from '../utils/response-helper.js';
import { CacheMiddleware } from '../utils/cache-middleware.js';
import { Intent, getFieldsForIntent } from '../utils/field-profiles.js';
import { buildFieldTypeMap } from '../utils/field-type-map.js';

interface DescribeObjectParams {
  objectName: string;
  includeFields?: boolean;
  pageSize?: number;
  pageNumber?: number;
  intent?: Intent;
}

function isDescribeObjectParams(obj: any): obj is DescribeObjectParams {
  return typeof obj === 'object' && obj !== null && typeof obj.objectName === 'string';
}

export async function handleDescribeObject(client: SalesforceClient, args: any, cacheMiddleware?: CacheMiddleware) {
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

  const fetcher = () => client.describeObject(
    args.objectName,
    args.includeFields,
    pagination
  ) as Promise<unknown>;

  const metadata = (cacheMiddleware
    ? await cacheMiddleware.getCachedMetadata(args.objectName, fetcher)
    : await fetcher()) as Record<string, unknown>;

  // Render describe results as structured markdown
  const lines: string[] = [`# ${args.objectName}`];

  const descMeta = [
    metadata.label,
    metadata.keyPrefix ? `prefix: ${metadata.keyPrefix}` : null,
    metadata.recordCount != null ? `${metadata.recordCount} records` : null,
  ].filter(Boolean);
  if (descMeta.length > 0) lines.push(descMeta.join(' | '));

  let fields = metadata.fields as Array<Record<string, unknown>> | undefined;

  // Filter fields by intent if provided
  if (fields && fields.length > 0 && args.intent) {
    const fieldTypeMap = buildFieldTypeMap(metadata as { fields?: Array<{ name: string; type: string }> });
    const relevantFieldNames = new Set(getFieldsForIntent(args.intent, fieldTypeMap));
    fields = fields.filter(f => relevantFieldNames.has(f.name as string));
  }

  if (fields && fields.length > 0) {
    const intentLabel = args.intent ? ` — ${args.intent} intent` : '';
    lines.push('');
    lines.push(`Fields (${fields.length}${intentLabel}):`);
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
  const lines: string[] = [`# Salesforce Objects (${results.length})`];
  lines.push('');
  for (const obj of results) {
    lines.push(`${obj.name} | ${obj.label || ''}`);
  }

  if (objects.totalPages && ((objects.pageNumber as number) || 1) < (objects.totalPages as number)) {
    lines.push(`\nPage ${objects.pageNumber || 1}/${objects.totalPages} — use pageNumber to see more`);
  }

  return simpleResponse(lines.join('\n'), 'list_objects');
}
