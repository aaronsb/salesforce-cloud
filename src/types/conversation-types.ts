export interface ConversationInsights {
  totalActivities: number;
  gongCalls: number;
  emailExchanges: {
    inbound: number;
    outbound: number;
  };
  lastActivityDate: Date | null;
  callTopics: string[];
  engagementTrend: 'increasing' | 'stable' | 'declining';
  keyContacts: string[];
  activityTypes: Record<string, number>;
  recommendations: Recommendation[];
}

export interface Recommendation {
  type: 'engagement' | 'communication' | 'follow-up' | 'progression';
  priority: 'high' | 'medium' | 'low';
  message: string;
}

export interface ConversationAnalysisResult {
  success: boolean;
  opportunityId: string;
  insights?: ConversationInsights;
  error?: string;
  analysisDate: string;
}

export interface ConversationAnalysisArgs {
  opportunityId: string;
}