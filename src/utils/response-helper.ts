/**
 * Response helper — wraps renderer + next-steps into MCP responses.
 *
 * Centralizes the JSON.stringify → markdown transition so handlers
 * don't need to know about rendering internals.
 */

import {
  renderOpportunity, renderList, renderQueryResult, renderRecord,
  renderConversationAnalysis, renderOpportunityInsights, renderSimilarOpportunities,
  renderEnrichment, renderBusinessCase, BusinessCaseData,
} from './markdown-renderer.js';
import { getNextSteps } from './next-steps.js';

type Detail = 'summary' | 'full';

/** Build an MCP response from a rendered string + next-steps */
function respond(text: string, toolName: string, result?: Record<string, unknown>) {
  const nextSteps = getNextSteps(toolName, result);
  return {
    content: [{ type: 'text', text: text + nextSteps }],
  };
}

/** Render a single opportunity */
export function opportunityResponse(
  opp: Record<string, unknown>,
  toolName: string,
  detail: Detail = 'full',
) {
  return respond(renderOpportunity(opp, detail), toolName, opp);
}

/** Render a list of records with pagination */
export function listResponse(
  objectName: string,
  records: Record<string, unknown>[],
  pagination: { currentPage: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean; totalSize?: number },
  toolName: string,
  detail: Detail = 'summary',
) {
  // Pass first record as context so next-steps can reference IDs
  const context = records.length > 0 ? records[0] : { objectName };
  return respond(renderList(objectName, records, detail, pagination), toolName, context as Record<string, unknown>);
}

/** Render a SOQL query result */
export function queryResponse(
  queryResult: Record<string, unknown>,
  toolName: string,
  detail: Detail = 'summary',
) {
  return respond(renderQueryResult(queryResult, detail), toolName, queryResult);
}

/** Render a single generic record */
export function recordResponse(
  objectName: string,
  record: Record<string, unknown>,
  toolName: string,
  detail: Detail = 'full',
) {
  return respond(renderRecord(objectName, record, detail), toolName, record);
}

/** Render a simple result (create/update/delete confirmations) */
export function simpleResponse(
  text: string,
  toolName: string,
  result?: Record<string, unknown>,
) {
  return respond(text, toolName, result);
}

/** Render conversation analysis */
export function conversationResponse(
  result: Record<string, unknown>,
  toolName: string,
) {
  return respond(renderConversationAnalysis(result), toolName, result);
}

/** Render opportunity insights */
export function insightsResponse(
  insights: Record<string, unknown>,
  toolName: string,
) {
  return respond(renderOpportunityInsights(insights), toolName, insights);
}

/** Render similar opportunities */
export function similarOpportunitiesResponse(
  result: Record<string, unknown>,
  toolName: string,
) {
  return respond(renderSimilarOpportunities(result), toolName, result);
}

/** Render opportunity enrichment */
export function enrichmentResponse(
  enrichment: Record<string, unknown>,
  toolName: string,
) {
  return respond(renderEnrichment(enrichment), toolName, enrichment);
}

/** Render business case */
export function businessCaseResponse(
  data: BusinessCaseData,
  toolName: string,
) {
  return respond(renderBusinessCase(data), toolName, data.opportunity as Record<string, unknown>);
}
