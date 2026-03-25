/**
 * Generates contextual next-step suggestions for LLM callers.
 * Appended to handler responses to guide multi-step workflows.
 */

type NextStep = { tool?: string; description: string; example?: Record<string, unknown> };

function formatSteps(steps: NextStep[]): string {
  const lines = ['\n---\nNext steps:'];
  for (const step of steps) {
    const tool = step.tool ? `\`${step.tool}\`` : '';
    const example = step.example ? ` — \`${JSON.stringify(step.example)}\`` : '';
    lines.push(`- ${step.description}${tool ? ` using ${tool}` : ''}${example}`);
  }
  return lines.join('\n');
}

 

/**
 * Return contextual next-step suggestions based on the tool that just ran.
 *
 * @param toolName - The tool that produced the current response
 * @param result - Optional result data for context-aware suggestions
 * @returns Markdown string with follow-up actions, or empty string if none
 */
export function getNextSteps(toolName: string, result?: Record<string, any>): string {
  const steps: NextStep[] = [];

  switch (toolName) {
    // ---- Opportunity tools ----
    case 'search_opportunities':
      steps.push(
        { description: 'View opportunity details', tool: 'get_opportunity_details', example: { opportunityId: '<id>' } },
        { description: 'Analyze engagement patterns', tool: 'analyze_conversation', example: { opportunityId: '<id>' } },
        { description: 'Find similar deals', tool: 'find_similar_opportunities' },
        { description: 'Narrow search with SOQL', tool: 'execute_soql', example: { query: 'SELECT Id, Name, Amount FROM Opportunity WHERE ...' } },
      );
      break;

    case 'get_opportunity_details':
      steps.push(
        { description: 'Analyze conversation activity', tool: 'analyze_conversation', example: { opportunityId: result?.id || '<id>' } },
        { description: 'Enrich with market intelligence', tool: 'enrich_opportunity', example: { opportunityId: result?.id || '<id>' } },
        { description: 'Find similar opportunities', tool: 'find_similar_opportunities', example: { referenceOpportunityId: result?.id || '<id>' } },
        { description: 'Generate a business case', tool: 'generate_business_case', example: { opportunityId: result?.id || '<id>' } },
        { description: 'Update opportunity fields', tool: 'update_record', example: { objectName: 'Opportunity', recordId: result?.id || '<id>', data: {} } },
      );
      break;

    case 'analyze_conversation':
      steps.push(
        { description: 'View full opportunity details', tool: 'get_opportunity_details', example: { opportunityId: result?.opportunityId || '<id>' } },
        { description: 'Enrich with market intelligence', tool: 'enrich_opportunity', example: { opportunityId: result?.opportunityId || '<id>' } },
        { description: 'Generate a business case', tool: 'generate_business_case', example: { opportunityId: result?.opportunityId || '<id>' } },
      );
      break;

    case 'generate_business_case':
      steps.push(
        { description: 'View opportunity details', tool: 'get_opportunity_details', example: { opportunityId: result?.opportunityId || '<id>' } },
        { description: 'Find similar opportunities for comparison', tool: 'find_similar_opportunities', example: { referenceOpportunityId: result?.opportunityId || '<id>' } },
      );
      break;

    case 'enrich_opportunity':
      steps.push(
        { description: 'View enriched opportunity', tool: 'get_opportunity_details', example: { opportunityId: result?.opportunityId || '<id>' } },
        { description: 'Generate a business case', tool: 'generate_business_case', example: { opportunityId: result?.opportunityId || '<id>' } },
        { description: 'Find similar opportunities', tool: 'find_similar_opportunities', example: { referenceOpportunityId: result?.opportunityId || '<id>' } },
      );
      break;

    case 'find_similar_opportunities':
      steps.push(
        { description: 'View opportunity details', tool: 'get_opportunity_details', example: { opportunityId: '<id>' } },
        { description: 'Get pipeline insights', tool: 'opportunity_insights' },
        { description: 'Search with specific criteria', tool: 'search_opportunities' },
      );
      break;

    case 'opportunity_insights':
      steps.push(
        { description: 'Search for specific opportunities', tool: 'search_opportunities' },
        { description: 'Find similar deals', tool: 'find_similar_opportunities' },
        { description: 'Run a custom SOQL query', tool: 'execute_soql' },
      );
      break;

    // ---- SOQL and generic tools ----
    case 'execute_soql':
      steps.push(
        { description: 'Describe an object to discover fields', tool: 'describe_object', example: { objectName: '<objectName>', includeFields: true } },
        { description: 'View opportunity details (if querying opportunities)', tool: 'get_opportunity_details', example: { opportunityId: '<id>' } },
        { description: 'Create a new record', tool: 'create_record', example: { objectName: '<objectName>', data: {} } },
      );
      break;

    case 'describe_object':
      steps.push(
        { description: 'Query this object with SOQL', tool: 'execute_soql', example: { query: 'SELECT Id, Name FROM <objectName>' } },
        { description: 'Create a record', tool: 'create_record', example: { objectName: result?.objectName || '<objectName>', data: {} } },
        { description: 'List all available objects', tool: 'list_objects' },
      );
      break;

    case 'list_objects':
      steps.push(
        { description: 'Describe an object to see its fields', tool: 'describe_object', example: { objectName: '<objectName>', includeFields: true } },
        { description: 'Query a specific object', tool: 'execute_soql', example: { query: 'SELECT Id, Name FROM <objectName>' } },
      );
      break;

    case 'create_record':
      steps.push(
        { description: 'View the created record', tool: 'execute_soql', example: { query: `SELECT Id, Name FROM ${result?.objectName || '<objectName>'} WHERE Id = '${result?.id || '<id>'}'` } },
        { description: 'Update the record', tool: 'update_record', example: { objectName: result?.objectName || '<objectName>', recordId: result?.id || '<id>', data: {} } },
        { description: 'Describe the object for available fields', tool: 'describe_object', example: { objectName: result?.objectName || '<objectName>', includeFields: true } },
      );
      break;

    case 'update_record':
      steps.push(
        { description: 'View the updated record', tool: 'execute_soql', example: { query: `SELECT Id, Name FROM ${result?.objectName || '<objectName>'} WHERE Id = '${result?.id || '<id>'}'` } },
        { description: 'Describe the object for more fields', tool: 'describe_object', example: { objectName: result?.objectName || '<objectName>', includeFields: true } },
      );
      break;

    case 'delete_record':
      steps.push(
        { description: 'Search for related records', tool: 'execute_soql' },
        { description: 'List available objects', tool: 'list_objects' },
      );
      break;

    case 'download_file':
      steps.push(
        { description: 'Find more files on a record', tool: 'execute_soql', example: { query: "SELECT ContentDocumentId, ContentDocument.Title FROM ContentDocumentLink WHERE LinkedEntityId = '<recordId>'" } },
        { description: 'View file version history', tool: 'execute_soql', example: { query: `SELECT Id, Title, VersionNumber, CreatedDate FROM ContentVersion WHERE ContentDocumentId = '${result?.documentId || '<documentId>'}'` } },
      );
      break;

    case 'get_user_info':
      steps.push(
        { description: 'List available objects', tool: 'list_objects' },
        { description: 'Search for opportunities', tool: 'search_opportunities' },
        { description: 'Run a SOQL query', tool: 'execute_soql' },
      );
      break;

    default:
      return '';
  }

  return steps.length > 0 ? formatSteps(steps) : '';
}
