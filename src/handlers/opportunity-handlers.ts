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
  searchTerm?: string;
  stage?: string;
  minAmount?: number;
  maxAmount?: number;
  closeDateStart?: string;
  closeDateEnd?: string;
}

function isSearchOpportunitiesParams(obj: any): obj is SearchOpportunitiesParams {
  if (typeof obj !== 'object' || obj === null) return false;
  
  // Validate optional parameters if they exist
  if ('searchTerm' in obj && typeof obj.searchTerm !== 'string') return false;
  if ('stage' in obj && typeof obj.stage !== 'string') return false;
  if ('minAmount' in obj && typeof obj.minAmount !== 'number') return false;
  if ('maxAmount' in obj && typeof obj.maxAmount !== 'number') return false;
  if ('closeDateStart' in obj && typeof obj.closeDateStart !== 'string') return false;
  if ('closeDateEnd' in obj && typeof obj.closeDateEnd !== 'string') return false;

  return true;
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

  let query = 'SELECT Id, Name, Amount, StageName, CloseDate, AccountId, Account.Name, OwnerId, Owner.Name FROM Opportunity';

  // Build WHERE clause
  let conditions = [];

  // Add search conditions based on provided parameters
  if (args.searchTerm) {
    const escapedTerm = args.searchTerm.replace(/'/g, "\\'");
    conditions.push(`(Name LIKE '%${escapedTerm}%' OR Account.Name LIKE '%${escapedTerm}%')`);
  }

  if (args.stage) {
    conditions.push(`StageName = '${args.stage}'`);
  }

  if (args.minAmount) {
    conditions.push(`Amount >= ${args.minAmount}`);
  }

  if (args.maxAmount) {
    conditions.push(`Amount <= ${args.maxAmount}`);
  }

  if (args.closeDateStart) {
    conditions.push(`CloseDate >= ${args.closeDateStart}`);
  }

  if (args.closeDateEnd) {
    conditions.push(`CloseDate <= ${args.closeDateEnd}`);
  }

  // Add WHERE clause if there are conditions
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY CloseDate DESC';

  const records = await client.executeQuery(query, {
    pageSize: args.pageSize,
    pageNumber: args.pageNumber
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(records, null, 2),
      },
    ],
  };
}
