import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { PaginationParams } from '../types/index.js';

interface GetOpportunityDetailsParams {
  opportunityId: string;
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
}

function isSearchOpportunitiesParams(obj: any): obj is SearchOpportunitiesParams {
  if (typeof obj !== 'object' || obj === null) return false;

  // Validate string patterns
  if ('namePattern' in obj && typeof obj.namePattern !== 'string') return false;
  if ('accountNamePattern' in obj && typeof obj.accountNamePattern !== 'string') return false;
  if ('descriptionPattern' in obj && typeof obj.descriptionPattern !== 'string') return false;

  // Validate other parameters
  if ('stage' in obj && typeof obj.stage !== 'string') return false;
  if ('minAmount' in obj && typeof obj.minAmount !== 'number') return false;
  if ('maxAmount' in obj && typeof obj.maxAmount !== 'number') return false;
  if ('closeDateStart' in obj && typeof obj.closeDateStart !== 'string') return false;
  if ('closeDateEnd' in obj && typeof obj.closeDateEnd !== 'string') return false;

  return true;
}

function sanitizeSearchPattern(pattern: string): string {
  // Escape special SOQL characters
  return pattern
    .replace(/'/g, "\\'")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .trim();
}

function buildNameMatchCondition(field: string, pattern: string): string {
  const sanitizedPattern = sanitizeSearchPattern(pattern);
  // Use word boundaries for more precise matching
  return `(${field} LIKE '% ${sanitizedPattern}%' OR ${field} LIKE '${sanitizedPattern}%')`;
}

export async function handleGetOpportunityDetails(client: SalesforceClient, args: any) {
  if (!isGetOpportunityDetailsParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid opportunity details parameters'
    );
  }

  // Use a comprehensive set of commonly used Opportunity fields
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

  const opportunity = records.results[0];
  
  // Format the opportunity details in a more readable way
  const formattedOpportunity = {
    basic_info: {
      id: opportunity.Id,
      name: opportunity.Name,
      amount: opportunity.Amount,
      stage: opportunity.StageName,
      probability: opportunity.Probability,
      close_date: opportunity.CloseDate,
      type: opportunity.Type,
      description: opportunity.Description,
      next_step: opportunity.NextStep,
      forecast_category: opportunity.ForecastCategory,
      expected_revenue: opportunity.ExpectedRevenue,
      lead_source: opportunity.LeadSource,
      is_closed: opportunity.IsClosed,
      is_won: opportunity.IsWon,
      last_activity_date: opportunity.LastActivityDate
    },
    account: opportunity.Account ? {
      name: opportunity.Account.Name,
      industry: opportunity.Account.Industry,
      website: opportunity.Account.Website
    } : null,
    owner: opportunity.Owner ? {
      name: opportunity.Owner.Name,
      email: opportunity.Owner.Email
    } : null,
    contacts: opportunity.OpportunityContactRoles?.records.map((role: { Contact?: { Name?: string; Email?: string }; Role?: string }) => ({
      name: role.Contact?.Name,
      email: role.Contact?.Email,
      role: role.Role
    })) || [],
    history: opportunity.Histories?.records.map((history: { CreatedDate: string; Field: string; OldValue: any; NewValue: any }) => ({
      date: history.CreatedDate,
      field: history.Field,
      old_value: history.OldValue,
      new_value: history.NewValue
    })).sort((a: { date: string }, b: { date: string }) => new Date(b.date).getTime() - new Date(a.date).getTime()) || [],
    tasks: opportunity.Tasks?.records.map((task: { Subject: string; Status: string; Priority: string; CreatedDate: string }) => ({
      subject: task.Subject,
      status: task.Status,
      priority: task.Priority,
      created_date: task.CreatedDate
    })).sort((a: { created_date: string }, b: { created_date: string }) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime()) || [],
    notes: opportunity.Notes?.records.map((note: { Title: string; Body: string; CreatedDate: string; CreatedBy?: { Name?: string } }) => ({
      title: note.Title,
      body: note.Body,
      created_date: note.CreatedDate,
      created_by: note.CreatedBy?.Name
    })).sort((a: { created_date: string }, b: { created_date: string }) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime()) || []
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(formattedOpportunity, null, 2),
      },
    ],
  };
}

export async function handleSearchOpportunities(client: SalesforceClient, args: any) {
  if (!isSearchOpportunitiesParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid opportunity search parameters'
    );
  }

  // Build WHERE conditions
  const conditions = [];

  // Add search conditions if provided
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

  // Build the query with more comprehensive fields
  let query = `
    SELECT Id, Name, Amount, StageName, CloseDate, Description,
           Account.Name, Account.Industry, Account.Website,
           Owner.Name, Owner.Email,
           ExpectedRevenue, Probability, Type
    FROM Opportunity
  `;

  // Add WHERE clause if conditions exist
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  // Add ORDER BY with multiple sort criteria
  query += ' ORDER BY CloseDate DESC, Amount DESC NULLS LAST';

  console.error('Executing SOQL Query:', query);

  // Execute with pagination
  const records = await client.executeQuery(query, {
    pageSize: args.pageSize || 25,
    pageNumber: args.pageNumber || 1
  });

  interface OpportunityRecord {
    Id: string;
    Name: string;
    StageName: string;
    Amount?: number;
    ExpectedRevenue?: number;
    Probability?: number;
    CloseDate?: string;
    Type?: string;
    Description?: string;
    Account?: {
      Name?: string;
      Industry?: string;
      Website?: string;
    };
    Owner?: {
      Name?: string;
      Email?: string;
    };
  }

  // Format the results for better readability
  const formattedResults = (records.results as OpportunityRecord[]).map(opp => ({
    id: opp.Id,
    name: opp.Name,
    stage: opp.StageName,
    amount: opp.Amount,
    expected_revenue: opp.ExpectedRevenue,
    probability: opp.Probability,
    close_date: opp.CloseDate,
    type: opp.Type,
    description: opp.Description,
    account: opp.Account ? {
      name: opp.Account.Name,
      industry: opp.Account.Industry,
      website: opp.Account.Website
    } : null,
    owner: opp.Owner ? {
      name: opp.Owner.Name,
      email: opp.Owner.Email
    } : null
  }));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          total_count: records.totalCount,
          page_number: records.pageNumber,
          page_size: records.pageSize,
          total_pages: records.totalPages,
          results: formattedResults
        }, null, 2),
      },
    ],
  };
}
