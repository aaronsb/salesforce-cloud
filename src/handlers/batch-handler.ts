import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { CacheMiddleware } from '../utils/cache-middleware.js';
import {
  BatchRequest,
  OperationResult,
  preScanBatch,
  RateLimiter,
  resolveArgsRefs,
  renderBatchResults,
} from '../utils/batch-executor.js';
import { handleCreateRecord, handleUpdateRecord, handleDeleteRecord } from './record-handlers.js';
import { handleExecuteSOQL } from './query-handlers.js';
import { handleGetOpportunityDetails, handleSearchOpportunities } from './opportunity-handlers.js';
import { handleDescribeObject, handleListObjects } from './object-handlers.js';
import { handleGetUserInfo } from './user-handlers.js';
import { handleAnalyze } from './analyze-handler.js';

// Singleton rate limiter — persists across batch calls within a session
const rateLimiter = new RateLimiter();

function isBatchRequest(obj: any): obj is BatchRequest {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    Array.isArray(obj.operations) &&
    obj.operations.length > 0 &&
    obj.operations.every(
      (op: any) =>
        typeof op === 'object' &&
        op !== null &&
        typeof op.tool === 'string' &&
        typeof op.args === 'object'
    )
  );
}

type ToolHandler = (client: SalesforceClient, args: any, cache?: any) => Promise<any>;

function getToolHandler(tool: string): ToolHandler | undefined {
  const handlers: Record<string, ToolHandler> = {
    create_record: handleCreateRecord,
    update_record: handleUpdateRecord,
    delete_record: handleDeleteRecord,
    execute_soql: handleExecuteSOQL,
    get_opportunity_details: handleGetOpportunityDetails,
    search_opportunities: handleSearchOpportunities,
    describe_object: handleDescribeObject,
    list_objects: handleListObjects,
    get_user_info: (_client, _args) => handleGetUserInfo(_client),
    analyze: handleAnalyze,
  };
  return handlers[tool];
}

export async function handleBatch(
  client: SalesforceClient,
  args: any,
  cacheMiddleware?: CacheMiddleware,
) {
  if (!isBatchRequest(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid batch request. Required: operations array with {tool, args} entries.',
    );
  }

  // Pre-scan for destructive operations
  const scanResult = preScanBatch(args.operations);
  if (!scanResult.ok) {
    return {
      content: [{ type: 'text', text: `Batch rejected: ${scanResult.message}` }],
      isError: true,
    };
  }

  // Rate limit check
  const rateCheck = rateLimiter.check(args.operations);
  if (!rateCheck.ok) {
    return {
      content: [{ type: 'text', text: `Rate limit: ${rateCheck.message}` }],
      isError: true,
    };
  }

  const onError = args.onError || 'bail';
  const detail = args.detail || 'summary';
  const results: OperationResult[] = [];

  for (let i = 0; i < args.operations.length; i++) {
    const op = args.operations[i];
    const handler = getToolHandler(op.tool);

    if (!handler) {
      const result: OperationResult = {
        index: i,
        tool: op.tool,
        status: 'error',
        text: `Unknown tool: ${op.tool}`,
      };
      results.push(result);
      if (onError === 'bail') break;
      continue;
    }

    try {
      // Resolve $N.field references in args
      const resolvedArgs = resolveArgsRefs(op.args, results);

      const response = await handler(client, resolvedArgs, cacheMiddleware);
      const text = response?.content?.[0]?.text || 'OK';

      // Extract structured data from args for $N.field references
      const data: Record<string, unknown> = { ...resolvedArgs };
      // For create/update/delete, include key identifiers
      if (resolvedArgs.recordId) data.id = resolvedArgs.recordId;
      if (resolvedArgs.objectName) data.objectName = resolvedArgs.objectName;

      results.push({
        index: i,
        tool: op.tool,
        status: 'success',
        text,
        data,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        index: i,
        tool: op.tool,
        status: 'error',
        text: message,
      });
      if (onError === 'bail') {
        // Mark remaining as skipped
        for (let j = i + 1; j < args.operations.length; j++) {
          results.push({
            index: j,
            tool: args.operations[j].tool,
            status: 'skipped',
            text: 'Skipped due to prior failure',
          });
        }
        break;
      }
    }
  }

  // Record only executed operations for rate limiting (not skipped ones)
  const executedOps = results
    .filter(r => r.status !== 'skipped')
    .map(r => args.operations[r.index]);
  rateLimiter.record(executedOps);

  return {
    content: [{ type: 'text', text: renderBatchResults(results, detail) }],
  };
}
