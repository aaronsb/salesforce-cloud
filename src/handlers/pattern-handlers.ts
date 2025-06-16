import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';

interface FindSimilarOpportunitiesArgs {
  referenceOpportunityId?: string;
  industry?: string;
  minAmount?: number;
  maxAmount?: number;
  stage?: string;
  isWon?: boolean;
  closeDateStart?: string;
  closeDateEnd?: string;
  includeAnalysis?: boolean;
  limit?: number;
}

function isFindSimilarOpportunitiesArgs(obj: any): obj is FindSimilarOpportunitiesArgs {
  return typeof obj === 'object' && obj !== null;
}

export async function handleFindSimilarOpportunities(
  args: any,
  sfClient: SalesforceClient
) {
  if (!isFindSimilarOpportunitiesArgs(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid find similar opportunities parameters'
    );
  }

  try {
    let referenceOpp = null;
    
    // If reference opportunity provided, get its details for pattern matching
    if (args.referenceOpportunityId) {
      const refQuery = `
        SELECT Id, Name, Amount, StageName, Probability, CloseDate, Type,
               Account.Name, Account.Industry, Account.NumberOfEmployees,
               Owner.Name, LeadSource
        FROM Opportunity 
        WHERE Id = '${args.referenceOpportunityId}'
      `;
      
      const refResult = await sfClient.executeQuery(refQuery);
      if (refResult.results.length > 0) {
        referenceOpp = refResult.results[0];
      }
    }

    // Build search criteria based on reference or explicit parameters
    const searchCriteria = buildSearchCriteria(args, referenceOpp);
    
    // Execute the search query
    const searchQuery = buildSearchQuery(searchCriteria, args.limit || 50);
    const results = await sfClient.executeQuery(searchQuery);

    // Analyze patterns if requested
    const analysis = args.includeAnalysis !== false ? 
      analyzeOpportunityPatterns(results.results, referenceOpp) : null;

    const response = {
      success: true,
      searchCriteria: searchCriteria,
      referenceOpportunity: referenceOpp ? {
        id: (referenceOpp as any).Id,
        name: (referenceOpp as any).Name,
        amount: (referenceOpp as any).Amount,
        industry: (referenceOpp as any).Account?.Industry,
        stage: (referenceOpp as any).StageName
      } : null,
      results: {
        totalFound: results.totalCount,
        opportunities: results.results.map((opp: any) => ({
          id: opp.Id,
          name: opp.Name,
          amount: opp.Amount,
          stage: opp.StageName,
          probability: opp.Probability,
          closeDate: opp.CloseDate,
          isWon: opp.IsWon,
          account: {
            name: opp.Account?.Name,
            industry: opp.Account?.Industry,
            employees: opp.Account?.NumberOfEmployees
          },
          owner: opp.Owner?.Name,
          leadSource: opp.LeadSource,
          similarity: calculateSimilarity(opp, referenceOpp)
        }))
      },
      analysis: analysis,
      searchDate: new Date().toISOString()
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };

  } catch (error: any) {
    const errorResult = {
      success: false,
      error: error.message,
      searchDate: new Date().toISOString()
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

function buildSearchCriteria(args: FindSimilarOpportunitiesArgs, referenceOpp: any) {
  const criteria: any = {};

  // Use reference opportunity to derive criteria if provided
  if (referenceOpp) {
    // Only set industry if it exists, otherwise use args
    if (referenceOpp.Account?.Industry) {
      criteria.industry = args.industry || referenceOpp.Account.Industry;
    } else if (args.industry) {
      criteria.industry = args.industry;
    }
    
    if (referenceOpp.Amount) {
      criteria.minAmount = args.minAmount || Math.floor(referenceOpp.Amount * 0.3);
      criteria.maxAmount = args.maxAmount || Math.ceil(referenceOpp.Amount * 3);
    }
    
    if (args.stage) {
      criteria.stage = args.stage;
    }
    
    if (referenceOpp.Type) {
      criteria.type = referenceOpp.Type;
    }
  } else {
    // Use explicit parameters
    if (args.industry) criteria.industry = args.industry;
    if (args.minAmount) criteria.minAmount = args.minAmount;
    if (args.maxAmount) criteria.maxAmount = args.maxAmount;
    if (args.stage) criteria.stage = args.stage;
  }

  if (args.isWon !== undefined) criteria.isWon = args.isWon;
  if (args.closeDateStart) criteria.closeDateStart = args.closeDateStart;
  if (args.closeDateEnd) criteria.closeDateEnd = args.closeDateEnd;

  return criteria;
}

function buildSearchQuery(criteria: any, limit: number) {
  const conditions = [];
  
  if (criteria.industry) {
    conditions.push(`Account.Industry = '${criteria.industry}'`);
  }
  
  if (criteria.minAmount) {
    conditions.push(`Amount >= ${criteria.minAmount}`);
  }
  
  if (criteria.maxAmount) {
    conditions.push(`Amount <= ${criteria.maxAmount}`);
  }
  
  if (criteria.stage) {
    conditions.push(`StageName = '${criteria.stage}'`);
  }
  
  if (criteria.isWon !== undefined) {
    conditions.push(`IsWon = ${criteria.isWon}`);
  }
  
  if (criteria.closeDateStart) {
    conditions.push(`CloseDate >= ${criteria.closeDateStart}`);
  }
  
  if (criteria.closeDateEnd) {
    conditions.push(`CloseDate <= ${criteria.closeDateEnd}`);
  }

  // If no criteria specified, just get recent opportunities
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return `
    SELECT Id, Name, Amount, StageName, Probability, CloseDate, IsWon, Type,
           Account.Name, Account.Industry, Account.NumberOfEmployees,
           Owner.Name, LeadSource, CreatedDate
    FROM Opportunity
    ${whereClause}
    ORDER BY CloseDate DESC, Amount DESC
    LIMIT ${limit}
  `;
}

function calculateSimilarity(opportunity: any, reference: any): number {
  if (!reference) return 0;
  
  let score = 0;
  let factors = 0;

  // Industry match (high weight)
  if (opportunity.Account?.Industry === reference.Account?.Industry) {
    score += 30;
  }
  factors += 30;

  // Amount similarity (medium weight)
  if (opportunity.Amount && reference.Amount) {
    const ratio = Math.min(opportunity.Amount, reference.Amount) / 
                  Math.max(opportunity.Amount, reference.Amount);
    score += ratio * 25;
  }
  factors += 25;

  // Stage similarity (medium weight)
  if (opportunity.StageName === reference.StageName) {
    score += 20;
  }
  factors += 20;

  // Type similarity (low weight)
  if (opportunity.Type === reference.Type) {
    score += 15;
  }
  factors += 15;

  // Lead source similarity (low weight)
  if (opportunity.LeadSource === reference.LeadSource) {
    score += 10;
  }
  factors += 10;

  return Math.round((score / factors) * 100);
}

function analyzeOpportunityPatterns(opportunities: any[], reference: any) {
  if (opportunities.length === 0) {
    return { message: 'No opportunities found for analysis' };
  }

  // Industry distribution
  const industryMap = new Map<string, number>();
  const stageMap = new Map<string, number>();
  const sourceMap = new Map<string, number>();
  const ownerMap = new Map<string, number>();
  
  let totalValue = 0;
  let wonCount = 0;
  let totalProbability = 0;
  let validAmounts = 0;
  let validProbabilities = 0;

  opportunities.forEach((opp: any) => {
    // Industry analysis
    if (opp.Account?.Industry) {
      industryMap.set(opp.Account.Industry, (industryMap.get(opp.Account.Industry) || 0) + 1);
    }

    // Stage analysis
    if (opp.StageName) {
      stageMap.set(opp.StageName, (stageMap.get(opp.StageName) || 0) + 1);
    }

    // Lead source analysis
    if (opp.LeadSource) {
      sourceMap.set(opp.LeadSource, (sourceMap.get(opp.LeadSource) || 0) + 1);
    }

    // Owner analysis
    if (opp.Owner?.Name) {
      ownerMap.set(opp.Owner.Name, (ownerMap.get(opp.Owner.Name) || 0) + 1);
    }

    // Value analysis
    if (opp.Amount) {
      totalValue += opp.Amount;
      validAmounts++;
    }

    // Win rate analysis
    if (opp.IsWon) {
      wonCount++;
    }

    // Probability analysis
    if (opp.Probability) {
      totalProbability += opp.Probability;
      validProbabilities++;
    }
  });

  const avgDealSize = validAmounts > 0 ? totalValue / validAmounts : 0;
  const winRate = (wonCount / opportunities.length) * 100;
  const avgProbability = validProbabilities > 0 ? totalProbability / validProbabilities : 0;

  return {
    summary: {
      totalOpportunities: opportunities.length,
      averageDealSize: Math.round(avgDealSize),
      winRate: Math.round(winRate),
      averageProbability: Math.round(avgProbability)
    },
    patterns: {
      topIndustries: Array.from(industryMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([industry, count]) => ({ 
          industry, 
          count, 
          percentage: Math.round((count / opportunities.length) * 100) 
        })),
      topStages: Array.from(stageMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([stage, count]) => ({ 
          stage, 
          count, 
          percentage: Math.round((count / opportunities.length) * 100) 
        })),
      topLeadSources: Array.from(sourceMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([source, count]) => ({ 
          source, 
          count, 
          percentage: Math.round((count / opportunities.length) * 100) 
        })),
      topOwners: Array.from(ownerMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([owner, count]) => ({ 
          owner, 
          count, 
          percentage: Math.round((count / opportunities.length) * 100) 
        }))
    },
    insights: generatePatternInsights(opportunities, reference, avgDealSize, winRate)
  };
}

function generatePatternInsights(opportunities: any[], reference: any, avgDealSize: number, winRate: number) {
  const insights = [];

  // Deal size insights
  if (reference?.Amount && avgDealSize > 0) {
    const ratio = reference.Amount / avgDealSize;
    if (ratio > 1.5) {
      insights.push({
        type: 'dealSize',
        message: `Reference opportunity is ${Math.round(ratio * 100)}% larger than similar deals average`,
        recommendation: 'Position premium value proposition to justify higher investment'
      });
    } else if (ratio < 0.7) {
      insights.push({
        type: 'dealSize',
        message: `Reference opportunity is smaller than similar deals average`,
        recommendation: 'Focus on efficiency and quick wins, or explore expansion opportunities'
      });
    }
  }

  // Win rate insights
  if (winRate > 70) {
    insights.push({
      type: 'winRate',
      message: `High win rate (${Math.round(winRate)}%) in this segment indicates strong market fit`,
      recommendation: 'Leverage proven success stories and case studies from similar clients'
    });
  } else if (winRate < 30) {
    insights.push({
      type: 'winRate',
      message: `Lower win rate (${Math.round(winRate)}%) suggests competitive or challenging market`,
      recommendation: 'Focus on differentiation and unique value proposition'
    });
  }

  // Timing insights
  const recentOpps = opportunities.filter((opp: any) => {
    const closeDate = new Date(opp.CloseDate);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return closeDate > sixMonthsAgo;
  });

  if (recentOpps.length > opportunities.length * 0.6) {
    insights.push({
      type: 'timing',
      message: 'High recent activity indicates growing market demand',
      recommendation: 'Act quickly to capitalize on market momentum'
    });
  }

  return insights;
}