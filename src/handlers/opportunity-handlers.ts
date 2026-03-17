import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { PaginationParams } from '../types/index.js';
import { opportunityResponse, listResponse } from '../utils/response-helper.js';

interface GetOpportunityDetailsParams {
  opportunityId: string;
  detail?: 'summary' | 'full';
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

export async function handleGetOpportunityDetails(client: SalesforceClient, args: any) {
  if (!isGetOpportunityDetailsParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid opportunity details parameters'
    );
  }

  const query = `
    SELECT Id, Name, Amount, Type, StageName, Probability, CloseDate, Description,
           LeadSource, NextStep, ForecastCategory, ExpectedRevenue, TotalOpportunityQuantity,
           HasOpportunityLineItem, IsClosed, IsWon, LastActivityDate,
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

  const records = await client.executeQuery(query);

  if (!records || !records.results || records.results.length === 0) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Opportunity with ID ${args.opportunityId} not found`
    );
  }

  const opportunity = records.results[0] as Record<string, unknown>;
  return opportunityResponse(opportunity, 'get_opportunity_details', args.detail || 'full');
}

export async function handleSearchOpportunities(client: SalesforceClient, args: any) {
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

  const records = await client.executeQuery(query, {
    pageSize: args.pageSize || 25,
    pageNumber: args.pageNumber || 1
  });

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
