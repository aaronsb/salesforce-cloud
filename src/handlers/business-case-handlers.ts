import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';

interface GenerateBusinessCaseArgs {
  opportunityId: string;
  clientName?: string;
  outputFormat?: 'pdf' | 'docx' | 'markdown';
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
  _sfClient: SalesforceClient
) {
  if (!isGenerateBusinessCaseArgs(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid business case generation parameters'
    );
  }

  const instructions = {
    success: true,
    opportunityId: args.opportunityId,
    clientName: args.clientName,
    outputFormat: args.outputFormat || 'pdf',
    instructions: {
      step1: "Data Collection",
      dataGatheringSteps: [
        {
          action: "get_opportunity_details",
          params: { opportunityId: args.opportunityId },
          purpose: "Get core opportunity information including stage, amount, close date, and account details"
        },
        {
          action: "analyze_conversation", 
          params: { opportunityId: args.opportunityId },
          purpose: "Extract engagement patterns, call history, and communication insights"
        },
        {
          action: "execute_soql",
          params: { 
            query: `SELECT Contact.Name, Contact.Title, Contact.Email, Contact.Phone, Role FROM OpportunityContactRole WHERE OpportunityId = '${args.opportunityId}'`
          },
          purpose: "Get key stakeholders and decision makers"
        },
        {
          action: "execute_soql",
          params: {
            query: `SELECT Id, Name, StageName, Amount, CloseDate, Account.Industry FROM Opportunity WHERE IsWon = true AND Amount >= 15000 AND Amount <= 60000 ORDER BY CloseDate DESC LIMIT 10`
          },
          purpose: "Find similar successful deals for pattern analysis and benchmarking"
        }
      ],
      step2: "Document Generation",
      documentCreationSteps: [
        {
          action: "Use mcp__texflow__document with action='create'",
          content_template: `
# Business Case: [Opportunity Name]

## Executive Summary
**Client**: [Account Name]  
**Opportunity**: [Opportunity Name]  
**Value**: $[Amount]  
**Stage**: [Stage] ([Probability]%)  
**Target Close**: [Close Date]

## Client Profile
- **Company**: [Account Name]
- **Industry**: [Industry or 'Technology Services']
- **Website**: [Website]
- **Key Contacts**: [List from OpportunityContactRole query]

## Engagement Overview
- **Discovery Calls**: [Number from conversation analysis]
- **Email Exchanges**: [Inbound/Outbound counts]
- **Last Activity**: [Date]
- **Call Topics**: [Topics from Gong activities]

## Value Proposition
Based on similar successful engagements averaging $[Average from similar deals], this transformation will deliver:

- **Accelerated Delivery**: 40% faster feature delivery through optimized practices
- **Quality Improvement**: 50% reduction in defects through better processes  
- **Team Alignment**: Unified tooling and methodology across all teams
- **Measurable ROI**: Realized within 6 months of implementation

## Success Pattern Analysis
From [Number] similar technology company wins:
- **Average Deal Size**: $[Amount from analysis]
- **Common Industries**: [Top industries from similar deals]
- **Typical Timeline**: 90-day initial implementation with ongoing support

## Recommended Next Steps
[Generated from conversation analysis recommendations]

## Risk Mitigation
- Start with pilot team to prove value
- Phased implementation reduces disruption
- Ongoing coaching ensures sustained adoption

**Prepared**: [Current Date]  
**Opportunity ID**: [OpportunityId]
          `,
          purpose: "Create the base business case document in LaTeX format"
        },
        {
          action: "Use mcp__texflow__output with action='export'",
          params: {
            format: args.outputFormat || 'pdf',
            output_path: `business_case_${args.opportunityId}.${args.outputFormat || 'pdf'}`
          },
          purpose: "Export the business case to the requested format"
        }
      ],
      step3: "Data Integration Instructions",
      integrationNotes: [
        "Replace [Opportunity Name] with data from get_opportunity_details",
        "Replace [Account Name] with Account.Name from opportunity details", 
        "Replace [Amount] with opportunity Amount, formatted with commas",
        "Replace [Stage] and [Probability] from opportunity details",
        "Replace [Close Date] with CloseDate from opportunity",
        "Replace [Industry] with Account.Industry or default to 'Technology Services'",
        "Replace [Number from conversation analysis] with gongCalls count",
        "Replace [Inbound/Outbound counts] with emailExchanges data",
        "Replace [Date] with lastActivityDate from conversation analysis",
        "Replace [Topics from Gong activities] with callTopics array joined",
        "Replace [Average from similar deals] with calculated average from similar opportunities",
        "Replace [Number] with count of similar deals found",
        "Replace [Top industries] with most common industries from similar deals",
        "Replace [Current Date] with today's date",
        "Replace [OpportunityId] with the actual opportunity ID",
        "Use conversation analysis recommendations for 'Recommended Next Steps' section"
      ]
    },
    exampleWorkflow: `
// Example complete workflow:
1. const oppDetails = await get_opportunity_details({opportunityId: "${args.opportunityId}"});
2. const convAnalysis = await analyze_conversation({opportunityId: "${args.opportunityId}"});  
3. const contacts = await execute_soql({query: "SELECT Contact.Name, Contact.Title..."});
4. const similarDeals = await execute_soql({query: "SELECT Id, Name, Amount FROM Opportunity WHERE IsWon = true..."});
5. // Process and calculate averages, patterns from similarDeals
6. // Substitute all template variables with actual data
7. const doc = await mcp__texflow__document({action: 'create', content: processedTemplate, format: 'latex'});
8. const pdf = await mcp__texflow__output({action: 'export', source: doc.path, format: '${args.outputFormat || 'pdf'}'});
    `,
    tips: [
      "Ensure all currency amounts are formatted with commas (e.g., $30,000)",
      "Format dates consistently (e.g., 'July 30, 2025')", 
      "If any data is missing, use sensible defaults or 'TBD'",
      "Calculate averages and percentages from similar deals for benchmarking",
      "Include specific call topics and engagement details to show active relationship",
      "Use the conversation analysis recommendations to create actionable next steps"
    ]
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(instructions, null, 2),
      },
    ],
  };
}