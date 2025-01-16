import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';

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

export async function handleCreateRecord(client: SalesforceClient, args: any) {
  if (!isCreateRecordParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'objectName must be a string and data must be an object'
    );
  }

  const result = await client.createRecord(args.objectName, args.data);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

export async function handleUpdateRecord(client: SalesforceClient, args: any) {
  if (!isUpdateRecordParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'objectName and recordId must be strings and data must be an object'
    );
  }

  const result = await client.updateRecord(
    args.objectName,
    args.recordId,
    args.data
  );

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

export async function handleDeleteRecord(client: SalesforceClient, args: any) {
  if (!isDeleteRecordParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'objectName and recordId must be strings'
    );
  }

  const result = await client.deleteRecord(args.objectName, args.recordId);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
