#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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
import { handleDescribeObject, handleListObjects } from './handlers/object-handlers.js';
import { handleCreateRecord, handleUpdateRecord, handleDeleteRecord } from './handlers/record-handlers.js';
import { handleGetUserInfo } from './handlers/user-handlers.js';
import { toolSchemas } from './schemas/tool-schemas.js';

class SalesforceServer {
  private server: Server;
  private sfClient: SalesforceClient;

  constructor() {
    console.error('Loading tool schemas...');
    console.error('Available schemas:', Object.keys(toolSchemas));

    // Convert tool schemas to the format expected by the MCP SDK
    const tools = Object.entries(toolSchemas).map(([key, schema]) => {
      console.error(`Registering tool: ${key}`);
      const inputSchema = {
        type: 'object',
        properties: schema.inputSchema.properties,
      } as const;

      // Only add required field if it exists in the schema
      if ('required' in schema.inputSchema) {
        Object.assign(inputSchema, { required: schema.inputSchema.required });
      }

      return {
        name: key,
        description: schema.description,
        inputSchema,
      };
    });

    console.error('Initializing server with tools:', JSON.stringify(tools, null, 2));

    // Use environment-provided name or default to 'salesforce-cloud'
    const serverName = process.env.MCP_SERVER_NAME || 'salesforce-cloud';
    console.error(`Using server name: ${serverName}`);

    this.server = new Server(
      {
        name: serverName,
        version: '0.1.0',
        description: 'Salesforce Cloud MCP Server - Provides tools for interacting with Salesforce'
      },
      {
        capabilities: {
          tools: {
            schemas: tools,
          },
          resources: {
            schemas: [], // Explicitly define empty resources
          },
        },
      }
    );

    this.sfClient = new SalesforceClient();
    
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
          case 'execute_soql':
            return await handleExecuteSOQL(this.sfClient, request.params.arguments);

          case 'describe_object':
            return await handleDescribeObject(this.sfClient, request.params.arguments);

          case 'create_record':
            return await handleCreateRecord(this.sfClient, request.params.arguments);

          case 'update_record':
            return await handleUpdateRecord(this.sfClient, request.params.arguments);

          case 'delete_record':
            return await handleDeleteRecord(this.sfClient, request.params.arguments);

          case 'get_user_info':
            return await handleGetUserInfo(this.sfClient);

          case 'list_objects':
            return await handleListObjects(this.sfClient, request.params.arguments);

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        console.error('Error handling request:', error);
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(ErrorCode.InternalError, 'Internal server error');
      }
    });
  }

  async run() {
    await this.sfClient.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Salesforce MCP server running on stdio');
  }
}

const server = new SalesforceServer();
server.run().catch(console.error);
