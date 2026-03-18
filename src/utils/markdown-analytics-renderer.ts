/**
 * Analytics and insights markdown renderers.
 *
 * Split from markdown-renderer.ts for file size management.
 * Uses shared helpers from the core renderer.
 */

import { formatDate, formatStatus, formatAmount } from './markdown-renderer.js';

// ============================================================================
// Conversation analysis rendering
// ============================================================================

export function renderConversationAnalysis(result: Record<string, any>): string {
  const lines: string[] = ['# Conversation Analysis'];
  const insights = result.insights || result;

  const metaParts = [
    `${insights.totalActivities || 0} activities`,
    insights.gongCalls ? `${insights.gongCalls} Gong calls` : null,
    `trend: ${insights.engagementTrend || 'unknown'}`,
  ].filter(Boolean);
  lines.push(metaParts.join(' | '));

  if (insights.lastActivityDate) {
    lines.push(`Last activity: ${formatDate(insights.lastActivityDate)}`);
  }

  // Activity types
  const activityTypes = insights.activityTypes;
  if (activityTypes && Object.keys(activityTypes).length > 0) {
    lines.push('');
    lines.push(`Activity types (${Object.keys(activityTypes).length}):`);
    const typeParts = Object.entries(activityTypes).map(([type, count]) => `${type}: ${count}`);
    lines.push(typeParts.join(' | '));
  }

  // Email flow
  const emails = insights.emailExchanges;
  if (emails && (emails.inbound || emails.outbound)) {
    lines.push(`Email flow: inbound ${emails.inbound} | outbound ${emails.outbound}`);
  }

  // Call topics
  if (insights.callTopics?.length > 0) {
    lines.push('');
    lines.push(`Call topics (${insights.callTopics.length}):`);
    for (const topic of insights.callTopics) {
      lines.push(`- ${topic}`);
    }
  }

  // Key contacts
  if (insights.keyContacts?.length > 0) {
    lines.push('');
    lines.push(`Key contacts (${insights.keyContacts.length}):`);
    lines.push(insights.keyContacts.join(' | '));
  }

  // Recommendations
  if (insights.recommendations?.length > 0) {
    lines.push('');
    lines.push(`Recommendations (${insights.recommendations.length}):`);
    for (const rec of insights.recommendations) {
      lines.push(`- [${rec.priority}] ${rec.message}`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Opportunity insights rendering
// ============================================================================

export function renderOpportunityInsights(insights: Record<string, any>): string {
  const lines: string[] = [];
  const tf = insights.timeframe || 'all_time';
  lines.push(`# Pipeline Insights — ${tf.replace(/_/g, ' ')}`);

  const total = insights.dataRange?.totalRecords ?? insights.totalOpportunities ?? 0;
  lines.push(`${total} opportunities`);

  // Core metrics
  const m = insights.coreMetrics;
  if (m) {
    lines.push('');
    lines.push('Core metrics:');
    lines.push(`Total value: ${formatAmount(m.totalValue)} | Avg deal: ${formatAmount(m.averageDealSize)} | Win rate: ${m.winRate != null ? m.winRate + '%' : 'N/A'}`);
    if (m.wonDeals) lines.push(`Won: ${m.wonDeals.count} deals (${formatAmount(m.wonDeals.value)}) | Lost: ${m.lostDeals?.count ?? 0} | Open: ${m.openPipeline?.count ?? 0} (${formatAmount(m.openPipeline?.value)})`);
  }

  // Stage analysis
  const stages = insights.stageAnalysis?.stages;
  if (stages?.length > 0) {
    lines.push('');
    lines.push(`Stage analysis (${stages.length}):`);
    for (const s of stages) {
      lines.push(`${s.stage} | ${s.count} deals | ${formatAmount(s.value)} | avg prob: ${s.averageProbability ?? s.avgProbability ?? 0}% | ${s.percentage}%`);
    }
  }

  // Owner performance
  const owners = insights.ownerPerformance?.performers;
  if (owners?.length > 0) {
    lines.push('');
    lines.push(`Owner performance (${owners.length}):`);
    for (const o of owners) {
      lines.push(`${o.owner} | ${o.wonDeals} won | ${o.winRate}% win rate | ${formatAmount(o.wonValue)} won | ${formatAmount(o.openValue)} open`);
    }
  }

  // Industry trends
  const industries = insights.industryTrends?.industries;
  if (industries?.length > 0) {
    lines.push('');
    lines.push(`Industry trends (${industries.length}):`);
    for (const i of industries) {
      lines.push(`${i.industry} | ${i.totalOpps} deals | ${i.winRate}% win rate | ${formatAmount(i.totalValue)} | ${i.marketShare}%`);
    }
  }

  // Pipeline health
  const health = insights.pipelineHealth;
  if (health) {
    lines.push('');
    lines.push('Pipeline health:');
    lines.push(`Score: ${health.healthScore} | Open: ${health.totalOpenOpportunities} deals (${formatAmount(health.totalOpenValue)})`);
    const cats = health.categories;
    if (cats) {
      const catParts = [
        cats.overdue?.count ? `Overdue: ${cats.overdue.count} (${formatAmount(cats.overdue.value)})` : null,
        cats.thisMonth?.count ? `This month: ${cats.thisMonth.count} (${formatAmount(cats.thisMonth.value)})` : null,
        cats.nextMonth?.count ? `Next month: ${cats.nextMonth.count} (${formatAmount(cats.nextMonth.value)})` : null,
        cats.future?.count ? `Future: ${cats.future.count} (${formatAmount(cats.future.value)})` : null,
      ].filter(Boolean);
      lines.push(catParts.join(' | '));
    }
  }

  // Recommendations
  const recs = insights.strategicRecommendations;
  if (recs?.length > 0) {
    lines.push('');
    lines.push(`Recommendations (${recs.length}):`);
    for (const r of recs) {
      lines.push(`- [${r.priority}] ${r.recommendation || r.message}`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Similar opportunities rendering
// ============================================================================

export function renderSimilarOpportunities(result: Record<string, any>): string {
  const lines: string[] = ['# Similar Opportunities'];

  // Reference opportunity
  const ref = result.referenceOpportunity;
  if (ref) {
    lines.push(`Reference: ${ref.name} | ${formatStatus(ref.stage)} | ${formatAmount(ref.amount)} | ${ref.industry || ''}`);
  }

  const opps = result.results?.opportunities || [];
  lines.push(`Found ${result.results?.totalFound ?? opps.length} matches`);
  lines.push('');

  // Results list
  for (const o of opps) {
    if (ref && o.id === ref.id) continue; // skip self-match
    const parts = [
      o.name,
      formatStatus(o.stage),
      formatAmount(o.amount),
      o.account?.industry || '',
      o.similarity != null ? `${o.similarity}% match` : null,
    ].filter(Boolean);
    lines.push(parts.join(' | '));
  }

  // Pattern analysis
  const analysis = result.analysis;
  if (analysis) {
    const summary = analysis.summary;
    if (summary) {
      lines.push('');
      lines.push('Patterns:');
      lines.push(`${summary.totalOpportunities} opportunities | avg deal: ${formatAmount(summary.averageDealSize)} | win rate: ${summary.winRate}% | avg probability: ${summary.averageProbability}%`);
    }

    const patterns = analysis.patterns;
    if (patterns) {
      if (patterns.topIndustries?.length > 0) {
        lines.push(`Top industries: ${patterns.topIndustries.map((i: any) => `${i.industry} (${i.percentage}%)`).join(' | ')}`);
      }
      if (patterns.topStages?.length > 0) {
        lines.push(`Top stages: ${patterns.topStages.map((s: any) => `${s.stage} (${s.percentage}%)`).join(' | ')}`);
      }
      if (patterns.topLeadSources?.length > 0) {
        lines.push(`Top sources: ${patterns.topLeadSources.map((s: any) => `${s.source} (${s.percentage}%)`).join(' | ')}`);
      }
    }

    // Insights
    if (analysis.insights?.length > 0) {
      lines.push('');
      lines.push(`Insights (${analysis.insights.length}):`);
      for (const i of analysis.insights) {
        lines.push(`- [${i.type}] ${i.message}`);
      }
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Enrichment rendering
// ============================================================================

export function renderEnrichment(enrichment: Record<string, any>): string {
  const lines: string[] = [];
  const profile = enrichment.opportunityProfile;

  lines.push(`# Opportunity Enrichment — ${profile?.name || 'Unknown'}`);

  // Profile summary
  if (profile) {
    const profileParts = [
      formatStatus(profile.stage),
      formatAmount(profile.amount),
      profile.probability != null ? `${profile.probability}%` : null,
    ].filter(Boolean);
    lines.push(profileParts.join(' | '));

    const acc = profile.account;
    if (acc) {
      const accParts = [acc.name, acc.industry, acc.website, acc.employees ? `${acc.employees} employees` : null].filter(Boolean);
      lines.push(`Account: ${accParts.join(' | ')}`);
    }
  }

  // Market intelligence
  const market = enrichment.marketIntelligence;
  if (market) {
    lines.push('');
    lines.push('Market intelligence:');
    lines.push(`${market.similarDealsAnalyzed} similar deals | avg deal: ${formatAmount(market.averageDealSize)} | market prob: ${market.marketProbabilityAverage}%`);
    if (market.topIndustries?.length > 0) {
      lines.push(`Top industries: ${market.topIndustries.map((i: any) => `${i.industry} (${i.dealCount})`).join(' | ')}`);
    }
    if (market.topLeadSources?.length > 0) {
      lines.push(`Top sources: ${market.topLeadSources.map((s: any) => `${s.source} (${s.dealCount})`).join(' | ')}`);
    }
  }

  // Strategic insights
  if (enrichment.strategicInsights?.length > 0) {
    lines.push('');
    lines.push(`Strategic insights (${enrichment.strategicInsights.length}):`);
    for (const s of enrichment.strategicInsights) {
      lines.push(`- [${s.impact} | ${s.type}] ${s.insight}`);
      if (s.recommendation) lines.push(`  -> ${s.recommendation}`);
    }
  }

  // Best practices
  if (enrichment.bestPractices?.length > 0) {
    lines.push('');
    lines.push(`Best practices (${enrichment.bestPractices.length}):`);
    for (const bp of enrichment.bestPractices) {
      lines.push(`- ${bp.category}: ${bp.practice}`);
    }
  }

  // Competitive intelligence
  const ci = enrichment.competitiveIntelligence;
  if (ci) {
    lines.push('');
    lines.push('Competitive intelligence:');
    if (ci.marketActivity) {
      const ma = ci.marketActivity;
      const maParts = [
        ma.recentSimilarDeals ? `Recent deals: ${ma.recentSimilarDeals}` : null,
        ma.averageTimeframe || null,
        ma.competitiveSignals || null,
      ].filter(Boolean);
      lines.push(maParts.join(' | '));
    }
    if (ci.positioningAdvantages?.length > 0) {
      lines.push('Advantages:');
      for (const adv of ci.positioningAdvantages) {
        lines.push(`- ${adv}`);
      }
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Business case rendering
// ============================================================================

export interface BusinessCaseData {
  opportunity: Record<string, any>;
  conversationInsights?: Record<string, any>;
  contacts?: Array<Record<string, any>>;
  similarDeals?: Array<Record<string, any>>;
  generatedAt: string;
  clientName?: string;
}

export function renderBusinessCase(data: BusinessCaseData): string {
  const opp = data.opportunity;
  const name = data.clientName || opp.Account?.Name || opp.Name || 'Unknown';
  const lines: string[] = [`# Business Case: ${name}`];

  // Executive summary
  lines.push('');
  lines.push('Executive summary:');
  const accParts = [
    opp.Account?.Name,
    opp.Account?.Industry,
    opp.Account?.Website,
  ].filter(Boolean);
  if (accParts.length > 0) lines.push(`Client: ${accParts.join(' | ')}`);
  const oppParts = [
    opp.Name,
    formatAmount(opp.Amount),
    `${formatStatus(opp.StageName)} (${opp.Probability ?? 0}%)`,
  ].filter(Boolean);
  lines.push(`Opportunity: ${oppParts.join(' | ')}`);
  if (opp.CloseDate) lines.push(`Target close: ${formatDate(opp.CloseDate)}`);
  if (opp.Owner?.Name) lines.push(`Owner: ${opp.Owner.Name}${opp.Owner.Email ? ' | ' + opp.Owner.Email : ''}`);

  // Key stakeholders
  if (data.contacts?.length) {
    lines.push('');
    lines.push(`Key stakeholders (${data.contacts.length}):`);
    for (const c of data.contacts) {
      const cParts = [
        c.Contact?.Name || c.Name,
        c.Contact?.Title || c.Title,
        c.Role,
        c.Contact?.Email || c.Email,
      ].filter(Boolean);
      lines.push(cParts.join(' | '));
    }
  }

  // Engagement summary
  const ci = data.conversationInsights;
  if (ci) {
    lines.push('');
    lines.push('Engagement summary:');
    const engParts = [
      `${ci.totalActivities || 0} activities`,
      ci.gongCalls ? `${ci.gongCalls} Gong calls` : null,
      ci.emailExchanges ? `${ci.emailExchanges.inbound} inbound / ${ci.emailExchanges.outbound} outbound emails` : null,
    ].filter(Boolean);
    lines.push(engParts.join(' | '));
    if (ci.lastActivityDate) lines.push(`Last activity: ${formatDate(ci.lastActivityDate)} | Trend: ${ci.engagementTrend || 'unknown'}`);
    if (ci.callTopics?.length > 0) lines.push(`Topics: ${ci.callTopics.join(' | ')}`);
    if (ci.keyContacts?.length > 0) lines.push(`Key contacts: ${ci.keyContacts.join(' | ')}`);
  }

  // Success pattern analysis
  if (data.similarDeals?.length) {
    lines.push('');
    lines.push('Success pattern analysis:');
    const deals = data.similarDeals;
    const amounts = deals.map(d => d.Amount).filter(Boolean);
    const avgDeal = amounts.length > 0 ? amounts.reduce((a: number, b: number) => a + b, 0) / amounts.length : 0;
    lines.push(`${deals.length} similar won deals | avg deal: ${formatAmount(avgDeal)}`);

    // Industry breakdown
    const industries: Record<string, number> = {};
    for (const d of deals) {
      const ind = d.Account?.Industry || 'Unknown';
      industries[ind] = (industries[ind] || 0) + 1;
    }
    const topIndustries = Object.entries(industries).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (topIndustries.length > 0) {
      lines.push(`Top industries: ${topIndustries.map(([ind, count]) => `${ind} (${count})`).join(' | ')}`);
    }
  }

  // Value proposition
  lines.push('');
  lines.push('Value proposition:');
  lines.push('- Accelerated delivery through optimized practices');
  lines.push('- Quality improvement through better processes');
  lines.push('- Team alignment with unified methodology');
  lines.push('- Measurable ROI within 6 months');

  // Recommendations from conversation insights
  if (ci && ci.recommendations?.length > 0) {
    lines.push('');
    lines.push('Recommended next steps:');
    for (const rec of ci.recommendations) {
      lines.push(`- [${rec.priority}] ${rec.message}`);
    }
  }

  // Risk mitigation
  lines.push('');
  lines.push('Risk mitigation:');
  lines.push('- Start with pilot team to prove value');
  lines.push('- Phased implementation reduces disruption');
  lines.push('- Ongoing coaching ensures sustained adoption');

  // Footer
  lines.push('');
  lines.push('---');
  lines.push(`Prepared: ${formatDate(data.generatedAt)} | Opportunity ID: ${opp.Id || ''}`);

  return lines.join('\n');
}
