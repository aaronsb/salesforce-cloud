import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { businessCaseResponse, simpleResponse } from '../utils/response-helper.js';
import { BusinessCaseData } from '../utils/markdown-renderer.js';
import { analyzeConversationInsights } from './conversation-handlers.js';
import { validateSalesforceId } from '../utils/index.js';

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
  sfClient: SalesforceClient,
  args: any
) {
  if (!isGenerateBusinessCaseArgs(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid business case generation parameters'
    );
  }

  try {
    const oppId = validateSalesforceId(args.opportunityId, 'opportunityId');

    // Fetch opportunity details
    const oppResult = await sfClient.executeQuery(`
      SELECT Id, Name, Amount, StageName, Probability, CloseDate, Description,
             Type, LeadSource, Account.Name, Account.Industry, Account.Website,
             Account.NumberOfEmployees, Owner.Name, Owner.Email
      FROM Opportunity
      WHERE Id = '${oppId}'
    `);

    if (!oppResult.results?.length) {
      throw new McpError(ErrorCode.InvalidRequest, `Opportunity ${oppId} not found`);
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
        WHERE OpportunityId = '${oppId}'
      `).catch((err) => { console.error('Failed to fetch contacts:', err.message); return { results: [] }; }),

      analyzeConversationInsights(oppId, sfClient)
        .catch((err) => { console.error('Failed to analyze conversation:', err.message); return undefined; }),

      sfClient.executeQuery(`
        SELECT Id, Name, Amount, StageName, CloseDate, Account.Industry, Account.Name
        FROM Opportunity
        WHERE IsWon = true AND Amount >= ${minAmount} AND Amount <= ${maxAmount}
        ORDER BY CloseDate DESC
        LIMIT 10
      `).catch((err) => { console.error('Failed to fetch similar deals:', err.message); return { results: [] }; }),
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
