import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';

interface OpportunityInsightsArgs {
  timeframe?: 'current_quarter' | 'last_quarter' | 'current_year' | 'last_year' | 'all_time';
  includeStageAnalysis?: boolean;
  includeOwnerPerformance?: boolean;
  includeIndustryTrends?: boolean;
  includePipelineHealth?: boolean;
  includeConversionRates?: boolean;
  minAmount?: number;
  maxAmount?: number;
  industry?: string;
  owner?: string;
}

function isOpportunityInsightsArgs(obj: any): obj is OpportunityInsightsArgs {
  return typeof obj === 'object' && obj !== null;
}

export async function handleOpportunityInsights(
  args: any,
  sfClient: SalesforceClient
) {
  if (!isOpportunityInsightsArgs(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid opportunity insights parameters'
    );
  }

  try {
    // Build date filter based on timeframe
    const dateFilter = buildDateFilter(args.timeframe || 'current_quarter');
    
    // Build base query with filters
    const conditions = [];
    
    if (dateFilter) {
      conditions.push(dateFilter);
    }
    
    if (args.minAmount) {
      conditions.push(`Amount >= ${args.minAmount}`);
    }
    
    if (args.maxAmount) {
      conditions.push(`Amount <= ${args.maxAmount}`);
    }
    
    if (args.industry) {
      conditions.push(`Account.Industry = '${args.industry}'`);
    }
    
    if (args.owner) {
      conditions.push(`Owner.Name = '${args.owner}'`);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const baseQuery = `
      SELECT Id, Name, Amount, StageName, Probability, CloseDate, IsWon, IsClosed,
             Account.Name, Account.Industry, Account.NumberOfEmployees,
             Owner.Name, LeadSource, Type, CreatedDate
      FROM Opportunity
      ${whereClause}
      ORDER BY CloseDate DESC LIMIT 1000
    `;
    
    // Execute the query
    const opportunities = await sfClient.executeQuery(baseQuery);
    
    // Generate insights based on requested analysis types
    const insights: any = {
      success: true,
      timeframe: args.timeframe || 'current_quarter',
      totalOpportunities: opportunities.totalCount,
      dataRange: {
        dateFilter: dateFilter || 'All time',
        totalRecords: opportunities.results.length,
        filters: buildFilterSummary(args)
      },
      generatedAt: new Date().toISOString()
    };
    
    // Core metrics (always included)
    insights.coreMetrics = generateCoreMetrics(opportunities.results);
    
    // Optional analysis modules
    if (args.includeStageAnalysis !== false) {
      insights.stageAnalysis = generateStageAnalysis(opportunities.results);
    }
    
    if (args.includeOwnerPerformance !== false) {
      insights.ownerPerformance = generateOwnerPerformance(opportunities.results);
    }
    
    if (args.includeIndustryTrends !== false) {
      insights.industryTrends = generateIndustryTrends(opportunities.results);
    }
    
    if (args.includePipelineHealth !== false) {
      insights.pipelineHealth = generatePipelineHealth(opportunities.results);
    }
    
    if (args.includeConversionRates !== false) {
      insights.conversionRates = generateConversionRates(opportunities.results);
    }
    
    // Strategic recommendations
    insights.strategicRecommendations = generateStrategicRecommendations(opportunities.results, insights);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(insights, null, 2),
        },
      ],
    };

  } catch (error: any) {
    const errorResult = {
      success: false,
      error: error.message,
      generatedAt: new Date().toISOString()
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

function buildDateFilter(timeframe: string): string | null {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
  
  switch (timeframe) {
    case 'current_quarter': {
      const quarterStart = new Date(currentYear, (currentQuarter - 1) * 3, 1);
      return `CloseDate >= ${quarterStart.toISOString().split('T')[0]}`;
    }
      
    case 'last_quarter': {
      const lastQuarter = currentQuarter === 1 ? 4 : currentQuarter - 1;
      const lastQuarterYear = currentQuarter === 1 ? currentYear - 1 : currentYear;
      const lastQuarterStart = new Date(lastQuarterYear, (lastQuarter - 1) * 3, 1);
      const lastQuarterEnd = new Date(lastQuarterYear, lastQuarter * 3, 0);
      return `CloseDate >= ${lastQuarterStart.toISOString().split('T')[0]} AND CloseDate <= ${lastQuarterEnd.toISOString().split('T')[0]}`;
    }
      
    case 'current_year':
      return `CloseDate >= ${currentYear}-01-01`;
      
    case 'last_year':
      return `CloseDate >= ${currentYear - 1}-01-01 AND CloseDate <= ${currentYear - 1}-12-31`;
      
    case 'all_time':
    default:
      return null;
  }
}

function buildFilterSummary(args: OpportunityInsightsArgs) {
  const filters = [];
  if (args.minAmount) filters.push(`Min Amount: $${args.minAmount.toLocaleString()}`);
  if (args.maxAmount) filters.push(`Max Amount: $${args.maxAmount.toLocaleString()}`);
  if (args.industry) filters.push(`Industry: ${args.industry}`);
  if (args.owner) filters.push(`Owner: ${args.owner}`);
  return filters.length > 0 ? filters : ['No additional filters'];
}

function generateCoreMetrics(opportunities: any[]) {
  const totalValue = opportunities.reduce((sum, opp) => sum + (opp.Amount || 0), 0);
  const wonOpps = opportunities.filter(opp => opp.IsWon);
  const lostOpps = opportunities.filter(opp => opp.IsClosed && !opp.IsWon);
  const openOpps = opportunities.filter(opp => !opp.IsClosed);
  
  const wonValue = wonOpps.reduce((sum, opp) => sum + (opp.Amount || 0), 0);
  const openValue = openOpps.reduce((sum, opp) => sum + (opp.Amount || 0), 0);
  
  return {
    totalOpportunities: opportunities.length,
    totalValue: totalValue,
    averageDealSize: opportunities.length > 0 ? Math.round(totalValue / opportunities.length) : 0,
    wonDeals: {
      count: wonOpps.length,
      value: wonValue,
      averageSize: wonOpps.length > 0 ? Math.round(wonValue / wonOpps.length) : 0
    },
    lostDeals: {
      count: lostOpps.length,
      percentage: opportunities.length > 0 ? Math.round((lostOpps.length / opportunities.length) * 100) : 0
    },
    openPipeline: {
      count: openOpps.length,
      value: openValue,
      averageSize: openOpps.length > 0 ? Math.round(openValue / openOpps.length) : 0
    },
    winRate: opportunities.length > 0 ? Math.round((wonOpps.length / (wonOpps.length + lostOpps.length)) * 100) : 0
  };
}

function generateStageAnalysis(opportunities: any[]) {
  const stageMap = new Map<string, { count: number; value: number; avgProbability: number; totalProb: number }>();
  
  opportunities.forEach(opp => {
    const stage = opp.StageName || 'Unknown';
    const current = stageMap.get(stage) || { count: 0, value: 0, avgProbability: 0, totalProb: 0 };
    
    current.count++;
    current.value += opp.Amount || 0;
    current.totalProb += opp.Probability || 0;
    
    stageMap.set(stage, current);
  });
  
  const stageAnalysis = Array.from(stageMap.entries()).map(([stage, data]) => ({
    stage,
    count: data.count,
    value: data.value,
    averageSize: Math.round(data.value / data.count),
    averageProbability: Math.round(data.totalProb / data.count),
    percentage: Math.round((data.count / opportunities.length) * 100)
  })).sort((a, b) => b.value - a.value);
  
  return {
    stages: stageAnalysis,
    insights: generateStageInsights(stageAnalysis)
  };
}

function generateOwnerPerformance(opportunities: any[]) {
  const ownerMap = new Map<string, { 
    total: number; 
    won: number; 
    lost: number; 
    open: number; 
    totalValue: number; 
    wonValue: number;
    openValue: number;
  }>();
  
  opportunities.forEach(opp => {
    const owner = opp.Owner?.Name || 'Unknown';
    const current = ownerMap.get(owner) || { 
      total: 0, won: 0, lost: 0, open: 0, 
      totalValue: 0, wonValue: 0, openValue: 0 
    };
    
    current.total++;
    current.totalValue += opp.Amount || 0;
    
    if (opp.IsWon) {
      current.won++;
      current.wonValue += opp.Amount || 0;
    } else if (opp.IsClosed && !opp.IsWon) {
      current.lost++;
    } else {
      current.open++;
      current.openValue += opp.Amount || 0;
    }
    
    ownerMap.set(owner, current);
  });
  
  const performance = Array.from(ownerMap.entries()).map(([owner, data]) => ({
    owner,
    totalOpportunities: data.total,
    wonDeals: data.won,
    lostDeals: data.lost,
    openDeals: data.open,
    winRate: data.won + data.lost > 0 ? Math.round((data.won / (data.won + data.lost)) * 100) : 0,
    totalValue: data.totalValue,
    wonValue: data.wonValue,
    openValue: data.openValue,
    averageDealSize: Math.round(data.totalValue / data.total)
  })).sort((a, b) => b.wonValue - a.wonValue);
  
  return {
    performers: performance,
    insights: generateOwnerInsights(performance)
  };
}

function generateIndustryTrends(opportunities: any[]) {
  const industryMap = new Map<string, {
    count: number;
    won: number;
    totalValue: number;
    wonValue: number;
    avgDealSize: number;
  }>();
  
  opportunities.forEach(opp => {
    const industry = opp.Account?.Industry || 'Unknown';
    const current = industryMap.get(industry) || { 
      count: 0, won: 0, totalValue: 0, wonValue: 0, avgDealSize: 0 
    };
    
    current.count++;
    current.totalValue += opp.Amount || 0;
    
    if (opp.IsWon) {
      current.won++;
      current.wonValue += opp.Amount || 0;
    }
    
    industryMap.set(industry, current);
  });
  
  const trends = Array.from(industryMap.entries()).map(([industry, data]) => ({
    industry,
    totalOpportunities: data.count,
    wonDeals: data.won,
    winRate: data.count > 0 ? Math.round((data.won / data.count) * 100) : 0,
    totalValue: data.totalValue,
    wonValue: data.wonValue,
    averageDealSize: Math.round(data.totalValue / data.count),
    marketShare: Math.round((data.count / opportunities.length) * 100)
  })).sort((a, b) => b.totalValue - a.totalValue);
  
  return {
    industries: trends,
    insights: generateIndustryInsights(trends)
  };
}

function generatePipelineHealth(opportunities: any[]) {
  const openOpps = opportunities.filter(opp => !opp.IsClosed);
  const now = new Date();
  
  // Categorize by time to close
  const categories = {
    overdue: openOpps.filter(opp => new Date(opp.CloseDate) < now),
    thisMonth: openOpps.filter(opp => {
      const closeDate = new Date(opp.CloseDate);
      return closeDate >= now && closeDate.getMonth() === now.getMonth();
    }),
    nextMonth: openOpps.filter(opp => {
      const closeDate = new Date(opp.CloseDate);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const monthAfter = new Date(now.getFullYear(), now.getMonth() + 2, 1);
      return closeDate >= nextMonth && closeDate < monthAfter;
    }),
    future: openOpps.filter(opp => {
      const closeDate = new Date(opp.CloseDate);
      const monthAfter = new Date(now.getFullYear(), now.getMonth() + 2, 1);
      return closeDate >= monthAfter;
    })
  };
  
  return {
    totalOpenOpportunities: openOpps.length,
    totalOpenValue: openOpps.reduce((sum, opp) => sum + (opp.Amount || 0), 0),
    categories: {
      overdue: {
        count: categories.overdue.length,
        value: categories.overdue.reduce((sum, opp) => sum + (opp.Amount || 0), 0)
      },
      thisMonth: {
        count: categories.thisMonth.length,
        value: categories.thisMonth.reduce((sum, opp) => sum + (opp.Amount || 0), 0)
      },
      nextMonth: {
        count: categories.nextMonth.length,
        value: categories.nextMonth.reduce((sum, opp) => sum + (opp.Amount || 0), 0)
      },
      future: {
        count: categories.future.length,
        value: categories.future.reduce((sum, opp) => sum + (opp.Amount || 0), 0)
      }
    },
    healthScore: calculatePipelineHealthScore(categories, openOpps.length)
  };
}

function generateConversionRates(opportunities: any[]) {
  const stageConversions = new Map<string, { entered: number; converted: number }>();
  
  // Simple conversion analysis based on current stage distribution
  opportunities.forEach(opp => {
    const stage = opp.StageName || 'Unknown';
    const current = stageConversions.get(stage) || { entered: 0, converted: 0 };
    current.entered++;
    
    if (opp.IsWon) {
      current.converted++;
    }
    
    stageConversions.set(stage, current);
  });
  
  const conversions = Array.from(stageConversions.entries()).map(([stage, data]) => ({
    stage,
    entered: data.entered,
    converted: data.converted,
    conversionRate: data.entered > 0 ? Math.round((data.converted / data.entered) * 100) : 0
  })).sort((a, b) => b.conversionRate - a.conversionRate);
  
  return {
    stageConversions: conversions,
    overallConversionRate: opportunities.length > 0 ? 
      Math.round((opportunities.filter(opp => opp.IsWon).length / opportunities.length) * 100) : 0
  };
}

function generateStrategicRecommendations(opportunities: any[], insights: any) {
  const recommendations = [];
  
  // Win rate analysis
  if (insights.coreMetrics.winRate < 30) {
    recommendations.push({
      category: 'Performance',
      priority: 'high',
      issue: `Low win rate (${insights.coreMetrics.winRate}%)`,
      recommendation: 'Focus on qualification criteria and competitive differentiation',
      impact: 'Improve deal quality and close rates'
    });
  }
  
  // Pipeline health
  if (insights.pipelineHealth?.categories.overdue.count > 0) {
    recommendations.push({
      category: 'Pipeline Management',
      priority: 'high',
      issue: `${insights.pipelineHealth.categories.overdue.count} overdue opportunities`,
      recommendation: 'Review and update overdue opportunities, reassess close dates',
      impact: 'Improve forecast accuracy and pipeline hygiene'
    });
  }
  
  // Owner performance gaps
  if (insights.ownerPerformance?.performers.length > 1) {
    const topPerformer = insights.ownerPerformance.performers[0];
    const avgWinRate = insights.ownerPerformance.performers.reduce((sum: number, p: any) => sum + p.winRate, 0) / insights.ownerPerformance.performers.length;
    
    if (topPerformer.winRate > avgWinRate + 20) {
      recommendations.push({
        category: 'Team Development',
        priority: 'medium',
        issue: 'Significant performance variation across team members',
        recommendation: `Share best practices from ${topPerformer.owner} (${topPerformer.winRate}% win rate)`,
        impact: 'Elevate overall team performance'
      });
    }
  }
  
  return recommendations;
}

// Helper functions for insights generation
function generateStageInsights(stageAnalysis: any[]) {
  const insights = [];
  
  const topStage = stageAnalysis[0];
  if (topStage) {
    insights.push(`${topStage.stage} represents ${topStage.percentage}% of pipeline value`);
  }
  
  const lowProbStages = stageAnalysis.filter(s => s.averageProbability < 25);
  if (lowProbStages.length > 0) {
    insights.push(`${lowProbStages.length} stages have low average probability (<25%)`);
  }
  
  return insights;
}

function generateOwnerInsights(performance: any[]) {
  const insights = [];
  
  if (performance.length > 0) {
    const topPerformer = performance[0];
    insights.push(`${topPerformer.owner} leads with $${topPerformer.wonValue.toLocaleString()} in won deals`);
    
    const avgWinRate = performance.reduce((sum: number, p: any) => sum + p.winRate, 0) / performance.length;
    insights.push(`Average team win rate: ${Math.round(avgWinRate)}%`);
  }
  
  return insights;
}

function generateIndustryInsights(trends: any[]) {
  const insights = [];
  
  if (trends.length > 0) {
    const topIndustry = trends[0];
    insights.push(`${topIndustry.industry} is the largest segment (${topIndustry.marketShare}% of deals)`);
    
    const highPerformingIndustries = trends.filter(t => t.winRate > 50);
    if (highPerformingIndustries.length > 0) {
      insights.push(`${highPerformingIndustries.length} industries have >50% win rates`);
    }
  }
  
  return insights;
}

function calculatePipelineHealthScore(categories: any, totalOpen: number): number {
  if (totalOpen === 0) return 100;
  
  let score = 100;
  
  // Penalize overdue opportunities
  score -= (categories.overdue.length / totalOpen) * 30;
  
  // Reward near-term opportunities
  score += (categories.thisMonth.length / totalOpen) * 10;
  
  return Math.max(0, Math.min(100, Math.round(score)));
}