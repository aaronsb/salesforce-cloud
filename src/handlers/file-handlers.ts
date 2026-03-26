import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import type { FieldDiscovery } from '../client/field-discovery.js';
import { saveToWorkspace, formatFileOutput } from '../utils/file-output.js';
import { sanitizeFilename } from '../utils/workspace.js';
import { getNextSteps } from '../utils/next-steps.js';

interface DownloadFileParams {
  contentId: string;
}

function isDownloadFileParams(obj: any): obj is DownloadFileParams {
  return typeof obj === 'object' && obj !== null && typeof obj.contentId === 'string';
}

export async function handleDownloadFile(client: SalesforceClient, args: any, fieldDiscovery?: FieldDiscovery) {
  if (!isDownloadFileParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid parameters: contentId (string) is required',
    );
  }

  // Validate the ID looks like a Salesforce ID
  if (!/^[a-zA-Z0-9]{15,18}$/.test(args.contentId)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid Salesforce ID: "${args.contentId}". Expected a 15 or 18 character alphanumeric ID.`,
    );
  }

  const fileInfo = await client.downloadFile(args.contentId, fieldDiscovery);
  const safeFilename = sanitizeFilename(fileInfo.filename);
  const result = await saveToWorkspace(safeFilename, fileInfo.buffer, fileInfo.mimeType);

  const lines = [
    formatFileOutput(result),
    '',
    `**Content Version ID:** ${fileInfo.versionId}`,
    `**Content Document ID:** ${fileInfo.documentId}`,
    `**MIME Type:** ${fileInfo.mimeType}`,
  ];

  const nextSteps = getNextSteps('download_file', {
    contentId: args.contentId,
    documentId: fileInfo.documentId,
    filename: safeFilename,
  });

  return {
    content: [{ type: 'text', text: lines.join('\n') + nextSteps }],
  };
}
