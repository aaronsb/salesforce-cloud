#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as dotenv from 'dotenv';

// Load environment variables from .env file (local dev only).
// quiet: true suppresses stdout logging that corrupts the JSON-RPC stream.
dotenv.config({ quiet: true });
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from './client/salesforce-client.js';
import { handleExecuteSOQL } from './handlers/query-handlers.js';
import { handleSearchOpportunities, handleGetOpportunityDetails } from './handlers/opportunity-handlers.js';
import { handleDescribeObject, handleListObjects } from './handlers/object-handlers.js';
import { handleCreateRecord, handleUpdateRecord, handleDeleteRecord } from './handlers/record-handlers.js';
import { handleGetUserInfo } from './handlers/user-handlers.js';
import { handleAnalyzeConversation } from './handlers/conversation-handlers.js';
import { handleGenerateBusinessCase } from './handlers/business-case-handlers.js';
import { handleEnrichOpportunity } from './handlers/enrichment-handlers.js';
import { handleFindSimilarOpportunities } from './handlers/pattern-handlers.js';
import { handleOpportunityInsights } from './handlers/insights-handlers.js';
import { handleAnalyze } from './handlers/analyze-handler.js';
import { handleBatch } from './handlers/batch-handler.js';
import { toolSchemas } from './schemas/tool-schemas.js';
import { SessionCache } from './utils/session-cache.js';
import { CacheMiddleware } from './utils/cache-middleware.js';

class SalesforceServer {
  private server: Server;
  private sfClient: SalesforceClient;
  private cache: SessionCache;
  private cacheMiddleware: CacheMiddleware;

  constructor() {
    console.error('Loading tool schemas...');
    console.error('Available schemas:', Object.keys(toolSchemas));

    // Use environment-provided name or default to 'salesforce-cloud'
    const serverName = process.env.MCP_SERVER_NAME || 'salesforce-cloud';
    console.error(`Using server name: ${serverName}`);

    this.server = new Server(
      {
        name: serverName,
        version: '0.2.0',
        description: 'Salesforce Cloud MCP Server - Provides tools for interacting with Salesforce'
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.sfClient = new SalesforceClient();
    this.cache = new SessionCache();
    this.cacheMiddleware = new CacheMiddleware(this.cache);

    this.setupHandlers();
    
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers() {
    // Set up required MCP protocol handlers
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.entries(toolSchemas).map(([key, schema]) => ({
        name: key,
        description: schema.description,
        inputSchema: {
          type: 'object',
          properties: schema.inputSchema.properties,
          ...(('required' in schema.inputSchema) ? { required: schema.inputSchema.required } : {}),
        },
      })),
    }));

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [], // No resources provided by this server
    }));

    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: [], // No resource templates provided by this server
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      throw new McpError(ErrorCode.InvalidRequest, `No resources available: ${request.params.uri}`);
    });

    // Set up tool handlers
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      console.error('Received request:', JSON.stringify(request, null, 2));

      const { name } = request.params;
      console.error(`Handling tool request: ${name}`);

      try {
        switch (name) {
          case 'batch':
            return await handleBatch(this.sfClient, request.params.arguments, this.cacheMiddleware);

          case 'analyze':
            return await handleAnalyze(this.sfClient, request.params.arguments);

          case 'execute_soql':
            return await handleExecuteSOQL(this.sfClient, request.params.arguments, this.cache);

          case 'describe_object':
            return await handleDescribeObject(this.sfClient, request.params.arguments, this.cacheMiddleware);

          case 'create_record':
            return await handleCreateRecord(this.sfClient, request.params.arguments, this.cacheMiddleware);

          case 'update_record':
            return await handleUpdateRecord(this.sfClient, request.params.arguments, this.cacheMiddleware);

          case 'delete_record':
            return await handleDeleteRecord(this.sfClient, request.params.arguments, this.cacheMiddleware);

          case 'get_user_info':
            return await handleGetUserInfo(this.sfClient);

          case 'list_objects':
            return await handleListObjects(this.sfClient, request.params.arguments);

          case 'search_opportunities':
            return await handleSearchOpportunities(this.sfClient, request.params.arguments, this.cache);

          case 'get_opportunity_details':
            return await handleGetOpportunityDetails(this.sfClient, request.params.arguments, this.cacheMiddleware);

          case 'analyze_conversation':
            return await handleAnalyzeConversation(this.sfClient, request.params.arguments);

          case 'generate_business_case':
            return await handleGenerateBusinessCase(this.sfClient, request.params.arguments);

          case 'enrich_opportunity':
            return await handleEnrichOpportunity(this.sfClient, request.params.arguments);

          case 'find_similar_opportunities':
            return await handleFindSimilarOpportunities(this.sfClient, request.params.arguments);

          case 'opportunity_insights':
            return await handleOpportunityInsights(this.sfClient, request.params.arguments);

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        console.error('Error handling request:', error);
        // Only throw MCP protocol errors (invalid params, unknown tool)
        if (error instanceof McpError && error.code !== ErrorCode.InternalError) {
          throw error;
        }
        // For Salesforce API errors, return as text content — not MCP errors
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `**Request failed:** ${message}\n\nThis may be due to insufficient API permissions, disabled features, or fields not available on this org.` }],
          isError: true,
        };
      }
    });
  }

  async run() {
    // Connect MCP transport FIRST so the handshake completes immediately.
    // Salesforce auth happens lazily on the first tool call — if it fails
    // or hangs, it shouldn't block the MCP initialize/capabilities exchange.
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Salesforce MCP server running on stdio');

    // Kick off Salesforce auth in the background — errors are logged
    // but don't crash the server; they'll surface on the first tool call.
    this.sfClient.initialize().catch((err) => {
      console.error(`Salesforce auth failed (will retry on first tool call): ${err.message}`);
    });
  }
}

const server = new SalesforceServer();
server.run().catch(console.error);
