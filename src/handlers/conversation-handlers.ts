import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { ConversationAnalysisResult, ConversationInsights, ConversationAnalysisArgs } from '../types/conversation-types.js';

function isConversationAnalysisArgs(obj: any): obj is ConversationAnalysisArgs {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.opportunityId === 'string'
  );
}

export async function handleAnalyzeConversation(
  args: any,
  sfClient: SalesforceClient
) {
  if (!isConversationAnalysisArgs(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid conversation analysis parameters'
    );
  }
  try {
    // Get all tasks/activities for the opportunity
    const tasks = await sfClient.executeQuery(`
      SELECT Id, Subject, Description, Status, CreatedDate, 
             ActivityDate, Priority, Type, TaskSubtype, WhoId, Who.Name
      FROM Task 
      WHERE WhatId = '${args.opportunityId}'
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

    // Analyze each activity
    tasks.results.forEach((task: any) => {
      const createdDate = new Date(task.CreatedDate);
      
      // Track most recent activity
      if (!insights.lastActivityDate || createdDate > insights.lastActivityDate) {
        insights.lastActivityDate = createdDate;
      }

      // Count recent activities for trend analysis
      if (createdDate > thirtyDaysAgo) {
        recentActivityCount++;
      }

      // Track contact engagement
      if (task.Who?.Name) {
        contactsSet.add(task.Who.Name);
      }

      // Track activity types
      const activityType = task.Type || 'Other';
      insights.activityTypes[activityType] = (insights.activityTypes[activityType] || 0) + 1;

      // Analyze Gong activities
      if (task.Subject?.includes('[Gong')) {
        if (task.Subject.includes('[Gong In]')) {
          insights.emailExchanges.inbound++;
        } else if (task.Subject.includes('[Gong Out]')) {
          insights.emailExchanges.outbound++;
        } else {
          insights.gongCalls++;
          // Extract call title
          const callTitle = task.Subject.replace(/\[Gong\]?\s*/g, '').trim();
          if (callTitle && !insights.callTopics.includes(callTitle)) {
            insights.callTopics.push(callTitle);
          }
        }
      }
    });

    // Determine engagement trend
    if (recentActivityCount >= 5) {
      insights.engagementTrend = 'increasing';
    } else if (recentActivityCount <= 1) {
      insights.engagementTrend = 'declining';
    }

    // Convert set to array
    insights.keyContacts = Array.from(contactsSet);

    // Generate recommendations
    generateRecommendations(insights);

    const result: ConversationAnalysisResult = {
      success: true,
      opportunityId: args.opportunityId,
      insights,
      analysisDate: new Date().toISOString()
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };

  } catch (error: any) {
    const errorResult: ConversationAnalysisResult = {
      success: false,
      error: error.message,
      opportunityId: args.opportunityId,
      analysisDate: new Date().toISOString()
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(errorResult, null, 2),
        },
      ],
    };
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