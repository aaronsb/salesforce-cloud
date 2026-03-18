import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { businessCaseResponse, simpleResponse } from '../utils/response-helper.js';
import { BusinessCaseData } from '../utils/markdown-renderer.js';
import { analyzeConversationInsights } from './conversation-handlers.js';

interface GenerateBusinessCaseArgs {
  opportunityId: string;
  clientName?: string;
}

function isGenerateBusinessCaseArgs(obj: any): obj is GenerateBusinessCaseArgs {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.opportunityId === 'string'
  );
}

export async function handleGenerateBusinessCase(
  args: any,
  sfClient: SalesforceClient
) {
  if (!isGenerateBusinessCaseArgs(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid business case generation parameters'
    );
  }

  try {
    // Fetch opportunity details
    const oppResult = await sfClient.executeQuery(`
      SELECT Id, Name, Amount, StageName, Probability, CloseDate, Description,
             Type, LeadSource, Account.Name, Account.Industry, Account.Website,
             Account.NumberOfEmployees, Owner.Name, Owner.Email
      FROM Opportunity
      WHERE Id = '${args.opportunityId}'
    `);

    if (!oppResult.results?.length) {
      throw new McpError(ErrorCode.InvalidRequest, `Opportunity ${args.opportunityId} not found`);
    }

    const opportunity = oppResult.results[0] as Record<string, any>;

    // Fetch contacts, conversation insights, and similar deals in parallel
    const amount = opportunity.Amount || 0;
    const minAmount = Math.floor(amount * 0.3);
    const maxAmount = Math.ceil(amount * 3);

    const [contactsResult, conversationInsights, similarResult] = await Promise.all([
      sfClient.executeQuery(`
        SELECT Contact.Name, Contact.Title, Contact.Email, Contact.Phone, Role
        FROM OpportunityContactRole
        WHERE OpportunityId = '${args.opportunityId}'
      `).catch(() => ({ results: [] })),

      analyzeConversationInsights(args.opportunityId, sfClient)
        .catch(() => undefined),

      sfClient.executeQuery(`
        SELECT Id, Name, Amount, StageName, CloseDate, Account.Industry, Account.Name
        FROM Opportunity
        WHERE IsWon = true AND Amount >= ${minAmount} AND Amount <= ${maxAmount}
        ORDER BY CloseDate DESC
        LIMIT 10
      `).catch(() => ({ results: [] })),
    ]);

    const data: BusinessCaseData = {
      opportunity,
      conversationInsights: conversationInsights as unknown as Record<string, any>,
      contacts: (contactsResult.results || []) as Array<Record<string, any>>,
      similarDeals: (similarResult.results || []) as Array<Record<string, any>>,
      generatedAt: new Date().toISOString(),
      clientName: args.clientName,
    };

    return businessCaseResponse(data, 'generate_business_case');
  } catch (error: any) {
    if (error instanceof McpError) throw error;
    return simpleResponse(`Error generating business case: ${error.message}`, 'generate_business_case');
  }
}
