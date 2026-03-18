import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { ConversationAnalysisResult, ConversationInsights, ConversationAnalysisArgs } from '../types/conversation-types.js';
import { conversationResponse, simpleResponse } from '../utils/response-helper.js';
import { validateSalesforceId } from '../utils/index.js';

function isConversationAnalysisArgs(obj: any): obj is ConversationAnalysisArgs {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.opportunityId === 'string'
  );
}

/**
 * Shared conversation analysis logic — used by both analyze_conversation
 * and generate_business_case handlers.
 */
export async function analyzeConversationInsights(
  opportunityId: string,
  sfClient: SalesforceClient,
): Promise<ConversationInsights> {
  const validId = validateSalesforceId(opportunityId, 'opportunityId');
  const tasks = await sfClient.executeQuery(`
    SELECT Id, Subject, Description, Status, CreatedDate,
           ActivityDate, Priority, Type, TaskSubtype, WhoId, Who.Name
    FROM Task
    WHERE WhatId = '${validId}'
    ORDER BY CreatedDate DESC
  `);

  const insights: ConversationInsights = {
    totalActivities: tasks.results.length,
    gongCalls: 0,
    emailExchanges: { inbound: 0, outbound: 0 },
    lastActivityDate: null,
    callTopics: [],
    engagementTrend: 'stable',
    keyContacts: [],
    activityTypes: {},
    recommendations: []
  };

  const contactsSet = new Set<string>();
  let recentActivityCount = 0;
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  tasks.results.forEach((task: any) => {
    const createdDate = new Date(task.CreatedDate);
    if (!insights.lastActivityDate || createdDate > insights.lastActivityDate) {
      insights.lastActivityDate = createdDate;
    }
    if (createdDate > thirtyDaysAgo) recentActivityCount++;
    if (task.Who?.Name) contactsSet.add(task.Who.Name);

    const activityType = task.Type || 'Other';
    insights.activityTypes[activityType] = (insights.activityTypes[activityType] || 0) + 1;

    if (task.Subject?.includes('[Gong')) {
      if (task.Subject.includes('[Gong In]')) {
        insights.emailExchanges.inbound++;
      } else if (task.Subject.includes('[Gong Out]')) {
        insights.emailExchanges.outbound++;
      } else {
        insights.gongCalls++;
        const callTitle = task.Subject.replace(/\[Gong\]?\s*/g, '').trim();
        if (callTitle && !insights.callTopics.includes(callTitle)) {
          insights.callTopics.push(callTitle);
        }
      }
    }
  });

  if (recentActivityCount >= 5) insights.engagementTrend = 'increasing';
  else if (recentActivityCount <= 1) insights.engagementTrend = 'declining';

  insights.keyContacts = Array.from(contactsSet);
  generateRecommendations(insights);

  return insights;
}

export async function handleAnalyzeConversation(
  sfClient: SalesforceClient,
  args: any
) {
  if (!isConversationAnalysisArgs(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid conversation analysis parameters'
    );
  }

  try {
    const insights = await analyzeConversationInsights(args.opportunityId, sfClient);

    const result: ConversationAnalysisResult = {
      success: true,
      opportunityId: args.opportunityId,
      insights,
      analysisDate: new Date().toISOString()
    };

    return conversationResponse(result as unknown as Record<string, unknown>, 'analyze_conversation');
  } catch (error: any) {
    return simpleResponse(`Error: ${error.message}`, 'analyze_conversation');
  }
}

function generateRecommendations(insights: ConversationInsights): void {
  const recommendations: Array<{
    type: 'engagement' | 'communication' | 'follow-up' | 'progression';
    priority: 'high' | 'medium' | 'low';
    message: string;
  }> = [];

  // Activity level recommendations
  if (insights.totalActivities < 3) {
    recommendations.push({
      type: 'engagement',
      priority: 'high',
      message: 'Low activity count - consider scheduling discovery call to increase engagement'
    });
  }

  // Email balance recommendations
  const totalEmails = insights.emailExchanges.inbound + insights.emailExchanges.outbound;
  if (totalEmails > 0 && insights.emailExchanges.inbound > insights.emailExchanges.outbound * 2) {
    recommendations.push({
      type: 'communication',
      priority: 'medium',
      message: 'Client showing high inbound interest - increase outbound follow-up'
    });
  }

  // Recency recommendations
  if (insights.lastActivityDate) {
    const daysSinceLastActivity = Math.floor((Date.now() - insights.lastActivityDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceLastActivity > 7) {
      recommendations.push({
        type: 'follow-up',
        priority: 'high',
        message: `Re-engage: ${daysSinceLastActivity} days since last activity`
      });
    } else if (daysSinceLastActivity > 3) {
      recommendations.push({
        type: 'follow-up',
        priority: 'medium',
        message: 'Consider follow-up to maintain momentum'
      });
    }
  }

  // Call topic recommendations
  if (insights.callTopics.length > 2) {
    recommendations.push({
      type: 'progression',
      priority: 'medium',
      message: 'Multiple discussion topics indicate readiness for next stage'
    });
  }

  // Engagement trend recommendations
  if (insights.engagementTrend === 'declining') {
    recommendations.push({
      type: 'engagement',
      priority: 'high',
      message: 'Engagement declining - schedule check-in call to re-energize relationship'
    });
  } else if (insights.engagementTrend === 'increasing') {
    recommendations.push({
      type: 'progression',
      priority: 'medium',
      message: 'High engagement momentum - consider advancing to next stage'
    });
  }

  insights.recommendations = recommendations;
}