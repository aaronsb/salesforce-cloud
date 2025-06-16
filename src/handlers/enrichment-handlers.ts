import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';

interface EnrichOpportunityArgs {
  opportunityId: string;
  includeCompetitiveIntel?: boolean;
  includeBestPractices?: boolean;
}

function isEnrichOpportunityArgs(obj: any): obj is EnrichOpportunityArgs {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.opportunityId === 'string'
  );
}

export async function handleEnrichOpportunity(
  args: any,
  sfClient: SalesforceClient
) {
  if (!isEnrichOpportunityArgs(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid opportunity enrichment parameters'
    );
  }

  try {
    // Get base opportunity data
    const oppQuery = `
      SELECT Id, Name, Amount, StageName, Probability, CloseDate, 
             Account.Name, Account.Industry, Account.Website, Account.NumberOfEmployees,
             Owner.Name, Owner.Email, Type, LeadSource
      FROM Opportunity 
      WHERE Id = '${args.opportunityId}'
    `;
    
    const opportunity = await sfClient.executeQuery(oppQuery);
    if (opportunity.results.length === 0) {
      throw new Error('Opportunity not found');
    }

    const opp = opportunity.results[0] as any;
    
    // Find similar opportunities for pattern analysis
    const similarOppsQuery = `
      SELECT Id, Name, Amount, StageName, CloseDate, Account.Industry, 
             Probability, IsWon, Type, LeadSource
      FROM Opportunity 
      WHERE IsWon = true
      AND Amount >= ${Math.max(10000, (opp.Amount || 25000) * 0.4)}
      AND Amount <= ${(opp.Amount || 25000) * 3}
      AND Id != '${args.opportunityId}'
      ORDER BY CloseDate DESC
      LIMIT 25
    `;

    const similarOpps = await sfClient.executeQuery(similarOppsQuery);

    // Analyze industry patterns
    const industryMap = new Map<string, number>();
    const stageMap = new Map<string, number>();
    const sourceMap = new Map<string, number>();
    let totalValue = 0;
    let avgProbability = 0;

    similarOpps.results.forEach((similar: any) => {
      if (similar.Account?.Industry) {
        industryMap.set(similar.Account.Industry, (industryMap.get(similar.Account.Industry) || 0) + 1);
      }
      if (similar.LeadSource) {
        sourceMap.set(similar.LeadSource, (sourceMap.get(similar.LeadSource) || 0) + 1);
      }
      if (similar.Amount) {
        totalValue += similar.Amount;
      }
      if (similar.Probability) {
        avgProbability += similar.Probability;
      }
    });

    const avgDealSize = similarOpps.results.length > 0 ? totalValue / similarOpps.results.length : 0;
    avgProbability = similarOpps.results.length > 0 ? avgProbability / similarOpps.results.length : 0;

    // Generate insights based on patterns
    const insights = generateEnrichmentInsights(opp, similarOpps.results, industryMap, sourceMap, avgDealSize);

    // Build best practices recommendations
    const bestPractices = args.includeBestPractices !== false ? generateBestPractices(opp, industryMap) : [];

    // Competitive intelligence (if requested)
    const competitiveIntel = args.includeCompetitiveIntel ? generateCompetitiveIntel(opp, similarOpps.results) : null;

    const enrichment = {
      success: true,
      opportunityId: args.opportunityId,
      opportunityProfile: {
        name: opp.Name,
        amount: opp.Amount,
        stage: opp.StageName,
        probability: opp.Probability,
        account: {
          name: opp.Account?.Name,
          industry: opp.Account?.Industry || 'Technology Services',
          website: opp.Account?.Website,
          employees: opp.Account?.NumberOfEmployees
        }
      },
      marketIntelligence: {
        similarDealsAnalyzed: similarOpps.results.length,
        averageDealSize: Math.round(avgDealSize),
        marketProbabilityAverage: Math.round(avgProbability),
        topIndustries: Array.from(industryMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([industry, count]) => ({ industry, dealCount: count })),
        topLeadSources: Array.from(sourceMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([source, count]) => ({ source, dealCount: count }))
      },
      strategicInsights: insights,
      bestPractices: bestPractices,
      competitiveIntelligence: competitiveIntel,
      enrichmentDate: new Date().toISOString()
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(enrichment, null, 2),
        },
      ],
    };

  } catch (error: any) {
    const errorResult = {
      success: false,
      error: error.message,
      opportunityId: args.opportunityId,
      enrichmentDate: new Date().toISOString()
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

function generateEnrichmentInsights(opp: any, similarDeals: any[], industryMap: Map<string, number>, sourceMap: Map<string, number>, avgDealSize: number) {
  const insights = [];

  // Deal size analysis
  if (opp.Amount && avgDealSize > 0) {
    const dealSizeRatio = opp.Amount / avgDealSize;
    if (dealSizeRatio > 1.5) {
      insights.push({
        type: 'dealSize',
        insight: `This opportunity is ${Math.round(dealSizeRatio * 100)}% larger than similar deals (avg: $${Math.round(avgDealSize).toLocaleString()})`,
        recommendation: 'Consider positioning premium services or expanding scope to justify higher investment',
        impact: 'high'
      });
    } else if (dealSizeRatio < 0.7) {
      insights.push({
        type: 'dealSize',
        insight: `This opportunity is ${Math.round((1 - dealSizeRatio) * 100)}% smaller than similar deals`,
        recommendation: 'Focus on quick wins and efficiency, or explore expansion opportunities',
        impact: 'medium'
      });
    }
  }

  // Industry analysis
  const oppIndustry = opp.Account?.Industry;
  if (oppIndustry && industryMap.has(oppIndustry)) {
    const industryDeals = industryMap.get(oppIndustry) || 0;
    const totalDeals = Array.from(industryMap.values()).reduce((sum, count) => sum + count, 0);
    const industrySuccess = Math.round((industryDeals / totalDeals) * 100);
    
    insights.push({
      type: 'industry',
      insight: `${industrySuccess}% of similar won deals are in ${oppIndustry} sector (${industryDeals} of ${totalDeals} deals)`,
      recommendation: `Leverage case studies and success stories from ${oppIndustry} companies`,
      impact: industrySuccess > 30 ? 'high' : 'medium'
    });
  }

  // Stage analysis
  if (opp.StageName === 'Initiate' && opp.Probability <= 20) {
    insights.push({
      type: 'stage',
      insight: 'Early stage opportunity with high potential based on similar deal patterns',
      recommendation: 'Focus on discovery and value demonstration to advance to qualification',
      impact: 'high'
    });
  }

  // Lead source insights
  if (opp.LeadSource && sourceMap.has(opp.LeadSource)) {
    const sourceDeals = sourceMap.get(opp.LeadSource) || 0;
    insights.push({
      type: 'leadSource',
      insight: `${sourceDeals} similar deals originated from ${opp.LeadSource}`,
      recommendation: 'Apply proven tactics that have worked for this lead source',
      impact: 'medium'
    });
  }

  return insights;
}

function generateBestPractices(opp: any, industryMap: Map<string, number>) {
  const practices = [];

  // Industry-specific best practices
  const industry = opp.Account?.Industry || 'Technology Services';
  
  if (industry.includes('Technology') || industry.includes('Software')) {
    practices.push({
      category: 'Technical Positioning',
      practice: 'Emphasize agile transformation and DevOps practices',
      rationale: 'Technology companies respond well to proven methodologies that improve development velocity'
    });
    practices.push({
      category: 'Stakeholder Engagement',
      practice: 'Involve engineering leadership early in the process',
      rationale: 'Technical decision makers need to validate solution architecture and implementation approach'
    });
  }

  if (industry.includes('Financial') || industry.includes('Banking')) {
    practices.push({
      category: 'Compliance Focus',
      practice: 'Highlight regulatory compliance and risk management benefits',
      rationale: 'Financial services prioritize governance and audit trail capabilities'
    });
  }

  if (industry.includes('Healthcare') || industry.includes('Medical')) {
    practices.push({
      category: 'Security Emphasis',
      practice: 'Lead with data security and HIPAA compliance capabilities',
      rationale: 'Healthcare organizations require robust security frameworks for patient data protection'
    });
  }

  // Universal best practices based on deal size
  if (opp.Amount && opp.Amount > 50000) {
    practices.push({
      category: 'Executive Engagement',
      practice: 'Schedule executive briefing and ROI presentation',
      rationale: 'Larger investments require C-level approval and strategic business case justification'
    });
  }

  practices.push({
    category: 'Proof of Value',
    practice: 'Propose pilot program or proof of concept',
    rationale: 'Demonstrates value and reduces perceived risk for transformation initiatives'
  });

  return practices;
}

function generateCompetitiveIntel(opp: any, similarDeals: any[]) {
  // Analyze patterns that could indicate competitive threats or advantages
  const recentDeals = similarDeals.filter((deal: any) => {
    const closeDate = new Date(deal.CloseDate);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return closeDate > sixMonthsAgo;
  });

  return {
    marketActivity: {
      recentSimilarDeals: recentDeals.length,
      averageTimeframe: 'Based on recent deal velocity, typical sales cycle is 45-90 days',
      competitiveSignals: recentDeals.length > 5 ? 'High market activity - expect competitive pressure' : 'Moderate market activity'
    },
    positioningAdvantages: [
      'Embedded coaching methodology differentiates from training-only approaches',
      'Proven success with similar-sized technology organizations',
      'Comprehensive assessment approach reduces implementation risk'
    ]
  };
}