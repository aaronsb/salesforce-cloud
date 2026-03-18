import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { simpleResponse } from '../utils/response-helper.js';
import { CacheMiddleware } from '../utils/cache-middleware.js';

interface CreateRecordParams {
  objectName: string;
  data: Record<string, any>;
}

interface UpdateRecordParams {
  objectName: string;
  recordId: string;
  data: Record<string, any>;
}

interface DeleteRecordParams {
  objectName: string;
  recordId: string;
}

function isCreateRecordParams(obj: any): obj is CreateRecordParams {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.objectName === 'string' &&
    obj.data &&
    typeof obj.data === 'object'
  );
}

function isUpdateRecordParams(obj: any): obj is UpdateRecordParams {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.objectName === 'string' &&
    typeof obj.recordId === 'string' &&
    obj.data &&
    typeof obj.data === 'object'
  );
}

function isDeleteRecordParams(obj: any): obj is DeleteRecordParams {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.objectName === 'string' &&
    typeof obj.recordId === 'string'
  );
}

export async function handleCreateRecord(client: SalesforceClient, args: any, cacheMiddleware?: CacheMiddleware) {
  if (!isCreateRecordParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'objectName must be a string and data must be an object'
    );
  }

  const result = await client.createRecord(args.objectName, args.data) as Record<string, any>;
  const id = result?.id || result?.Id || 'unknown';

  if (cacheMiddleware && id !== 'unknown') {
    const epoch = (result?.SystemModstamp as string) || new Date().toISOString();
    cacheMiddleware.onRecordCreated(args.objectName, id, { ...args.data, Id: id }, epoch);
  }

  return simpleResponse(
    `Created ${args.objectName} record: ${id}`,
    'create_record',
    { id, objectName: args.objectName },
  );
}

export async function handleUpdateRecord(client: SalesforceClient, args: any, cacheMiddleware?: CacheMiddleware) {
  if (!isUpdateRecordParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'objectName and recordId must be strings and data must be an object'
    );
  }

  await client.updateRecord(args.objectName, args.recordId, args.data);

  if (cacheMiddleware) {
    cacheMiddleware.onRecordUpdated(args.objectName, args.recordId);
  }

  return simpleResponse(
    `Updated ${args.objectName} record: ${args.recordId}`,
    'update_record',
    { recordId: args.recordId, objectName: args.objectName },
  );
}

export async function handleDeleteRecord(client: SalesforceClient, args: any, cacheMiddleware?: CacheMiddleware) {
  if (!isDeleteRecordParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'objectName and recordId must be strings'
    );
  }

  await client.deleteRecord(args.objectName, args.recordId);

  if (cacheMiddleware) {
    cacheMiddleware.onRecordDeleted(args.objectName, args.recordId);
  }

  return simpleResponse(
    `Deleted ${args.objectName} record: ${args.recordId}`,
    'delete_record',
    { recordId: args.recordId, objectName: args.objectName },
  );
}
