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
import { handleSearchFields } from './handlers/field-search-handler.js';
import { handleCreateRecord, handleUpdateRecord, handleDeleteRecord } from './handlers/record-handlers.js';
import { handleGetUserInfo } from './handlers/user-handlers.js';
import { handleAnalyzeConversation } from './handlers/conversation-handlers.js';
import { handleGenerateBusinessCase } from './handlers/business-case-handlers.js';
import { handleEnrichOpportunity } from './handlers/enrichment-handlers.js';
import { handleFindSimilarOpportunities } from './handlers/pattern-handlers.js';
import { handleOpportunityInsights } from './handlers/insights-handlers.js';
import { handleAnalyze } from './handlers/analyze-handler.js';
import { handleBatch } from './handlers/batch-handler.js';
import { handleDownloadFile } from './handlers/file-handlers.js';
import { toolSchemas } from './schemas/tool-schemas.js';
import { SessionCache } from './utils/session-cache.js';
import { CacheMiddleware } from './utils/cache-middleware.js';
import { FieldDiscovery } from './client/field-discovery.js';
import type { ScoredField } from './utils/field-regulator.js';
import { buildInvalidFieldHint } from './utils/field-hints.js';
import { CORE_OBJECTS } from './utils/discovery-constants.js';
import { VERSION } from './version.js';

class SalesforceServer {
  private server: Server;
  private sfClient: SalesforceClient;
  private cache: SessionCache;
  private cacheMiddleware: CacheMiddleware;
  private fieldDiscovery: FieldDiscovery;

  constructor() {
    console.error('Loading tool schemas...');
    console.error('Available schemas:', Object.keys(toolSchemas));

    // Use environment-provided name or default to 'salesforce-cloud'
    const serverName = process.env.MCP_SERVER_NAME || 'salesforce-cloud';
    console.error(`Using server name: ${serverName}`);

    this.server = new Server(
      {
        name: serverName,
        version: VERSION,
        description: 'Salesforce Cloud MCP Server - Provides tools for interacting with Salesforce'
      },
      {
        capabilities: {
          tools: {},
          // listChanged: the resource list is built before discovery has run
          // (the transport connects first), so every description in it starts
          // out saying "in progress". Clients cache that listing at connect and
          // have no reason to refetch, so without this the labels stay wrong for
          // the whole session while the resources themselves read fine.
          resources: { listChanged: true },
        },
      }
    );

    this.sfClient = new SalesforceClient();
    // Auth warmup is NOT kicked off here. Doing network I/O this early — before
    // the client has finished the MCP handshake — races the initialize response
    // on stdout under Claude Desktop's UtilityProcess runtime and can leave the
    // handshake unanswered ("unable to connect"). run() defers it to the
    // post-initialize hook instead; see run().
    this.cache = new SessionCache();
    this.cacheMiddleware = new CacheMiddleware(this.cache);
    this.fieldDiscovery = new FieldDiscovery(this.sfClient);

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

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      // Listed unconditionally. Clients call ListResources right after the
      // handshake, which is before auth and discovery have finished — gating
      // on `ready` here made the catalog permanently invisible, since there is
      // no listChanged notification to correct an empty list later. Readiness
      // is reported inside each payload instead.
      const stats = this.fieldDiscovery.getStats();
      const resources = [{
        uri: 'salesforce://field-catalog/_stats',
        name: 'Field Discovery Stats',
        description: stats.ready
          ? `Discovery status: ${stats.objectsDiscovered} objects, ${stats.totalPromoted} promoted fields`
          // Progress, not a bare "wait": a caller deciding whether to block or
          // fall back needs to know how much is left (ADR-301).
          : `Discovery status: in progress — ${stats.objectsExpected - stats.pendingObjects.length}` +
            `/${stats.objectsExpected} objects` +
            (stats.etaMs !== undefined ? `, ~${Math.ceil(stats.etaMs / 1000)}s remaining` : ''),
        mimeType: 'application/json',
      }];

      for (const objectName of CORE_OBJECTS) {
        const catalog = this.fieldDiscovery.getCatalog(objectName);
        resources.push({
          uri: `salesforce://field-catalog/${objectName}`,
          name: `${objectName} Field Catalog`,
          description: catalog
            ? `${catalog.promoted.length} promoted fields out of ${catalog.totalFields}`
            : `Ranked fields for ${objectName} (discovery in progress)`,
          mimeType: 'application/json',
        });
        resources.push({
          uri: `salesforce://field-catalog/${objectName}/all`,
          name: `${objectName} Field Catalog (full)`,
          description: `All scored fields for ${objectName}, including non-promoted, with scoring rationale`,
          mimeType: 'application/json',
        });
      }

      return { resources };
    });

    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: [
        {
          uriTemplate: 'salesforce://field-catalog/{objectName}',
          name: 'Field Catalog',
          description: 'Fields this org actually populates on an object, ranked by observed usage and quality. Not an exhaustive field list — standard fields stay queryable whether or not they appear here.',
          mimeType: 'application/json',
        },
        {
          uriTemplate: 'salesforce://field-catalog/{objectName}/all',
          name: 'Field Catalog (full)',
          description: 'All scored fields for a Salesforce object, including non-promoted, with scoring rationale',
          mimeType: 'application/json',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      // salesforce://field-catalog/_stats
      if (uri === 'salesforce://field-catalog/_stats') {
        const stats = this.fieldDiscovery.getStats();
        return {
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(stats, null, 2) }],
        };
      }

      // salesforce://field-catalog/{objectName} and .../{objectName}/all
      // The `/all` suffix is ADR-300's Tier 2 view: every scored field, not
      // just the promoted ones, each carrying the rationale for its score.
      // Leading [A-Za-z] rather than \w: Salesforce object names never start
      // with an underscore, and it keeps `_stats/all` from falling through to
      // a describe of an object called "_stats".
      const catalogMatch = uri.match(/^salesforce:\/\/field-catalog\/([A-Za-z]\w*)(\/all)?$/);
      if (catalogMatch) {
        const objectName = catalogMatch[1];
        const includeAll = catalogMatch[2] !== undefined;
        // Try cached, or discover on-demand
        let catalog = this.fieldDiscovery.getCatalog(objectName);
        if (!catalog) {
          catalog = await this.fieldDiscovery.discoverObject(objectName) ?? undefined;
        }
        if (!catalog) {
          throw new McpError(ErrorCode.InvalidRequest, `Could not discover fields for: ${objectName}`);
        }

        const describe = (s: ScoredField) => ({
          name: s.field.name,
          label: s.field.label,
          type: s.field.type,
          computationType: s.field.computationType,
          custom: s.field.custom,
          score: s.score,
          populationPct: s.field.populationPct,
          // "47%, falling" and "93%, flat" are different facts about a field,
          // and only one is worth acting on. A single density number cannot
          // tell them apart (ADR-301).
          ...(s.field.trend ? { trend: s.field.trend.direction, trendPp: s.field.trend.deltaPp } : {}),
          // The evidence behind the trend, oldest window first. This is the
          // Tier 2 view — the one that carries rationale — and a direction the
          // reader cannot check is a direction they have to take on faith.
          ...(includeAll && s.field.strataPopulation
            ? { strataPopulation: s.field.strataPopulation }
            : {}),
          adjustments: s.adjustments.map(a => `${a.delta > 0 ? '+' : ''}${a.delta} ${a.reason}`),
        });

        const payload = {
          objectName: catalog.objectName,
          totalFields: catalog.totalFields,
          totalRecords: catalog.totalRecords,
          // Population is estimated from this many records, not counted over
          // all of them (ADR-301). Say so, rather than presenting an estimate
          // with the authority of a census.
          sampledRecords: catalog.sampledRecords,
          ...(includeAll
            ? { fields: catalog.fields.map(s => ({ ...describe(s), promoted: s.promoted })) }
            : { promoted: catalog.promoted.map(describe) }),
          wellKnown: Object.fromEntries(catalog.wellKnown),
        };
        return {
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) }],
        };
      }

      throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
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
            return await handleExecuteSOQL(this.sfClient, request.params.arguments, this.cache, this.fieldDiscovery);

          case 'describe_object':
            return await handleDescribeObject(this.sfClient, request.params.arguments, this.cacheMiddleware);

          case 'search_fields':
            return await handleSearchFields(this.fieldDiscovery, request.params.arguments);

          case 'create_record':
            return await handleCreateRecord(this.sfClient, request.params.arguments, this.cacheMiddleware);

          case 'update_record':
            return await handleUpdateRecord(this.sfClient, request.params.arguments, this.cacheMiddleware);

          case 'delete_record':
            return await handleDeleteRecord(this.sfClient, request.params.arguments, this.cacheMiddleware);

          case 'get_user_info':
            return await handleGetUserInfo(this.sfClient);

          case 'download_file':
            return await handleDownloadFile(this.sfClient, request.params.arguments, this.fieldDiscovery);

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
        // If the call failed on a field that doesn't exist, name the fields
        // that do (ADR-300). Without this the agent's only recourse is to go
        // describe the object — the recon round-trip discovery exists to avoid.
        const fieldHint = buildInvalidFieldHint(this.fieldDiscovery, message);
        const guidance = fieldHint ||
          '\n\nThis may be due to insufficient API permissions, disabled features, or fields not available on this org.';
        return {
          content: [{ type: 'text', text: `**Request failed:** ${message}${guidance}` }],
          isError: true,
        };
      }
    });
  }

  /**
   * Notify clients that the resource list is worth refetching.
   *
   * Best-effort: this fires from a background chain after discovery settles, and
   * a client that has already gone away must not turn a cosmetic refresh into an
   * unhandled rejection that takes the server with it.
   */
  private async announceResourceChange(): Promise<void> {
    try {
      await this.server.sendResourceListChanged();
    } catch (err: any) {
      console.error(`Could not notify clients of resource changes: ${err?.message ?? err}`);
    }
  }

  /**
   * Wait on the auth the constructor's warmup() already started, then kick off
   * field discovery. Separate from run() so it can be tested without binding
   * stdio — the double-login bug lived here and shipped unnoticed.
   */
  startBackgroundInit(): Promise<void> {
    // Join the auth already kicked off by warmup() in the constructor rather
    // than starting a second one — initialize() does not reuse the in-flight
    // promise, so calling it here would log in to Salesforce twice per startup.
    // Errors are logged but don't crash the server; they surface on first use.
    return this.sfClient.ensureInitialized()
      .then(() => {
        // After auth succeeds, start field discovery (ADR-300).
        // Non-blocking — tools work immediately, discovery enriches over time.
        this.fieldDiscovery.startAsync();
        // Tell clients to refetch once discovery lands. The list they cached at
        // connect describes every catalog as "in progress", because it was.
        // Only announce if discovery actually ran — nothing to refetch otherwise.
        return this.fieldDiscovery.whenSettled()
          .then(ran => (ran ? this.announceResourceChange() : undefined));
      })
      .catch((err) => {
        console.error(`Salesforce auth failed (will retry on first tool call): ${err.message}`);
      });
  }

  async run() {
    // Defer all Salesforce work (auth warmup + field discovery) until AFTER the
    // client acknowledges the handshake with notifications/initialized. Firing
    // it in the constructor or right after connect() puts network I/O in the
    // same tick window as the initialize response; under Claude Desktop's
    // built-in Node (Electron UtilityProcess) that race can leave the response
    // unflushed, so the client times out with "unable to connect". Waiting for
    // the initialized notification lets the handshake settle on a quiet event
    // loop first.
    //
    // The convergence contract still holds: warmup() kicks off auth, background
    // init runs discovery and announces the resource-list refetch — just a beat
    // later. And auth stays lazy-safe: every tool handler calls
    // ensureInitialized(), so data converges on first use even if a client never
    // sends the initialized notification. Set before connect() so the handler is
    // registered when the notification arrives.
    this.server.oninitialized = () => {
      this.sfClient.warmup();
      this.startBackgroundInit();
    };

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Salesforce MCP server running on stdio');
  }
}

export { SalesforceServer };

/**
 * Whether to auto-start the server when this module is loaded.
 *
 * This deliberately does NOT gate on `require.main === module`. Under Claude
 * Desktop's built-in Node (Electron UtilityProcess) the entry module is loaded
 * such that `require.main !== module`, so that guard silently skipped startup:
 * the server never constructed, the MCP handshake was never answered, and the
 * extension failed with "unable to connect" — while the exact same build worked
 * as a plain `node`/`npx` CLI (where `require.main === module` holds). Jest is
 * the only context that imports this module without wanting a running server,
 * so gate on that instead. See the release notes for v0.7.2.
 */
export function shouldAutostart(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !env.JEST_WORKER_ID;
}

if (shouldAutostart()) {
  const server = new SalesforceServer();
  server.run().catch((error) => console.error('Fatal error running server:', error));
}
