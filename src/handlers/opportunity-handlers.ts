import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { PaginationParams } from '../types/index.js';
import { opportunityResponse, listResponse } from '../utils/response-helper.js';
import { CacheMiddleware } from '../utils/cache-middleware.js';
import { SessionCache } from '../utils/session-cache.js';
import { Intent, getFieldsForIntent, getDefaultFields } from '../utils/field-profiles.js';
import { buildFieldTypeMap } from '../utils/field-type-map.js';

interface GetOpportunityDetailsParams {
  opportunityId: string;
  detail?: 'summary' | 'full';
  intent?: Intent;
  fields?: string[];
}

function isGetOpportunityDetailsParams(obj: any): obj is GetOpportunityDetailsParams {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.opportunityId === 'string'
  );
}

interface SearchOpportunitiesParams extends PaginationParams {
  namePattern?: string;
  accountNamePattern?: string;
  descriptionPattern?: string;
  stage?: string;
  minAmount?: number;
  maxAmount?: number;
  closeDateStart?: string;
  closeDateEnd?: string;
  detail?: 'summary' | 'full';
}

function isSearchOpportunitiesParams(obj: any): obj is SearchOpportunitiesParams {
  if (typeof obj !== 'object' || obj === null) return false;

  if ('namePattern' in obj && typeof obj.namePattern !== 'string') return false;
  if ('accountNamePattern' in obj && typeof obj.accountNamePattern !== 'string') return false;
  if ('descriptionPattern' in obj && typeof obj.descriptionPattern !== 'string') return false;
  if ('stage' in obj && typeof obj.stage !== 'string') return false;
  if ('minAmount' in obj && typeof obj.minAmount !== 'number') return false;
  if ('maxAmount' in obj && typeof obj.maxAmount !== 'number') return false;
  if ('closeDateStart' in obj && typeof obj.closeDateStart !== 'string') return false;
  if ('closeDateEnd' in obj && typeof obj.closeDateEnd !== 'string') return false;

  return true;
}

function sanitizeSearchPattern(pattern: string): string {
  return pattern
    .replace(/'/g, "\\'")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .trim();
}

function buildNameMatchCondition(field: string, pattern: string): string {
  const sanitizedPattern = sanitizeSearchPattern(pattern);
  return `(${field} LIKE '% ${sanitizedPattern}%' OR ${field} LIKE '${sanitizedPattern}%')`;
}

export async function handleGetOpportunityDetails(client: SalesforceClient, args: any, cacheMiddleware?: CacheMiddleware) {
  if (!isGetOpportunityDetailsParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid opportunity details parameters'
    );
  }

  // Determine which fields to SELECT
  let selectFields: string[] | null = null;

  if (args.fields && args.fields.length > 0) {
    // Explicit fields override everything
    selectFields = [...new Set(['Id', 'SystemModstamp', ...args.fields])];
  } else if (args.intent) {
    // Intent-driven field selection — need describe metadata for field type map
    try {
      const describeResult = cacheMiddleware
        ? await cacheMiddleware.getCachedMetadata('Opportunity', () =>
            client.describeObject('Opportunity', true) as Promise<unknown>)
        : await client.describeObject('Opportunity', true);
      const fieldTypeMap = buildFieldTypeMap(describeResult as { fields?: Array<{ name: string; type: string }> });
      selectFields = [...new Set(['Id', 'SystemModstamp', ...getFieldsForIntent(args.intent, fieldTypeMap)])];
    } catch {
      // Fall back to defaults if describe fails
      selectFields = [...new Set(['Id', 'SystemModstamp', ...getDefaultFields('Opportunity')])];
    }
  }

  const fetcher = async () => {
    let query: string;

    if (selectFields) {
      // Focused query — no subqueries to keep it lightweight
      query = `SELECT ${selectFields.join(', ')} FROM Opportunity WHERE Id = '${args.opportunityId}'`;
    } else {
      // Full query with subqueries (original behavior)
      query = `
        SELECT Id, Name, Amount, Type, StageName, Probability, CloseDate, Description,
               LeadSource, NextStep, ForecastCategory, ExpectedRevenue, TotalOpportunityQuantity,
               HasOpportunityLineItem, IsClosed, IsWon, LastActivityDate, SystemModstamp,
               Account.Name, Account.Industry, Account.Website,
               Owner.Name, Owner.Email,
               (SELECT Id, ContactId, Contact.Name, Contact.Email, Role
                FROM OpportunityContactRoles),
               (SELECT Id, CreatedDate, Field, OldValue, NewValue
                FROM Histories ORDER BY CreatedDate DESC),
               (SELECT Id, Title, Body, CreatedDate, CreatedBy.Name
                FROM Notes ORDER BY CreatedDate DESC),
               (SELECT Id, Subject, Status, Priority, CreatedDate
                FROM Tasks ORDER BY CreatedDate DESC)
        FROM Opportunity
        WHERE Id = '${args.opportunityId}'
      `;
    }

    let records;
    try {
      records = await client.executeQuery(query);
    } catch (error) {
      if (!selectFields) {
        // Full query failed — fall back to safe core fields
        console.error('Full opportunity query failed, falling back to core fields:', error);
        const safeQuery = `
          SELECT Id, Name, Amount, Type, StageName, Probability, CloseDate, Description,
                 LeadSource, NextStep, ForecastCategory, ExpectedRevenue,
                 IsClosed, IsWon, LastActivityDate, SystemModstamp,
                 Account.Name, Account.Industry, Account.Website,
                 Owner.Name, Owner.Email
          FROM Opportunity
          WHERE Id = '${args.opportunityId}'
        `;
        records = await client.executeQuery(safeQuery);
      } else {
        throw error;
      }
    }

    if (!records || !records.results || records.results.length === 0) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Opportunity with ID ${args.opportunityId} not found`
      );
    }

    return records.results[0] as Record<string, unknown>;
  };

  const opportunity = cacheMiddleware
    ? await cacheMiddleware.getOrFetch('Opportunity', args.opportunityId, fetcher)
    : await fetcher();

  return opportunityResponse(opportunity, 'get_opportunity_details', args.detail || 'full');
}

export async function handleSearchOpportunities(client: SalesforceClient, args: any, cache?: SessionCache) {
  if (!isSearchOpportunitiesParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid opportunity search parameters'
    );
  }

  const conditions = [];

  if (args.namePattern) {
    conditions.push(buildNameMatchCondition('Name', args.namePattern));
  }
  if (args.accountNamePattern) {
    conditions.push(buildNameMatchCondition('Account.Name', args.accountNamePattern));
  }
  if (args.stage) {
    const sanitizedStage = sanitizeSearchPattern(args.stage);
    conditions.push(`StageName = '${sanitizedStage}'`);
  }

  let query = `
    SELECT Id, Name, Amount, StageName, CloseDate, Description,
           Account.Name, Account.Industry, Account.Website,
           Owner.Name, Owner.Email,
           ExpectedRevenue, Probability, Type
    FROM Opportunity
  `;

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY CloseDate DESC, Amount DESC NULLS LAST';

  const pageSize = args.pageSize || 25;
  const pageNumber = args.pageNumber || 1;
  const fingerprint = `search_opportunities:${query}:${pageSize}:${pageNumber}`;

  // Check query cache first
  if (cache) {
    const cached = cache.getQuery(fingerprint) as Record<string, unknown> | undefined;
    if (cached) {
      const results = (cached.results || []) as Record<string, unknown>[];
      return listResponse(
        'Opportunity',
        results,
        {
          currentPage: (cached.pageNumber as number) || 1,
          totalPages: (cached.totalPages as number) || 1,
          hasNextPage: ((cached.pageNumber as number) || 1) < ((cached.totalPages as number) || 1),
          hasPreviousPage: ((cached.pageNumber as number) || 1) > 1,
          totalSize: cached.totalCount as number,
        },
        'search_opportunities',
        args.detail || 'summary',
      );
    }
  }

  const records = await client.executeQuery(query, { pageSize, pageNumber });

  // Store in query cache
  if (cache) {
    cache.setQuery(fingerprint, records);
  }

  const results = (records.results || []) as Record<string, unknown>[];
  return listResponse(
    'Opportunity',
    results,
    {
      currentPage: records.pageNumber || 1,
      totalPages: records.totalPages || 1,
      hasNextPage: (records.pageNumber || 1) < (records.totalPages || 1),
      hasPreviousPage: (records.pageNumber || 1) > 1,
      totalSize: records.totalCount,
    },
    'search_opportunities',
    args.detail || 'summary',
  );
}
