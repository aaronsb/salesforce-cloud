/**
 * ADR-300 Field Regulator — composable scoring pipeline for field promotion.
 *
 * Each regulator is a pure function that adjusts a field's score based on
 * a single signal (population, namespace, label, type, etc.). Regulators
 * stack — all run on every field, order doesn't matter. The audit trail
 * of adjustments makes promotion decisions transparent and debuggable.
 */

import { ComputationType } from './field-type-map.js';
import type { FieldTrend } from './record-sampler.js';

// ── Types ────────────────────────────────────────────────────────────

export interface FieldCandidate {
  name: string;
  label: string;
  type: string;
  custom: boolean;
  helpText: string | null;
  nillable: boolean;
  computationType: ComputationType;
  /** Population percentage (0-100), undefined if not scored. */
  populationPct?: number;
  /** Active picklist values, for categorical fields. Undefined otherwise. */
  picklistValues?: string[];
  /**
   * Population within each sampled creation-time window, oldest first (ADR-301).
   * A by-product of stratified sampling, and the only place drift is visible:
   * `populationPct` alone cannot tell a steadily-used field from one that was
   * mandatory for years and has since been abandoned.
   */
  strataPopulation?: number[];
  /** Direction of travel derived from strataPopulation. */
  trend?: FieldTrend;
}

export interface ScoreAdjustment {
  regulator: string;
  /** Positive = boost, negative = penalty. */
  delta: number;
  reason: string;
}

export interface ScoredField {
  field: FieldCandidate;
  score: number;
  adjustments: ScoreAdjustment[];
  promoted: boolean;
}

/** A regulator: field in, adjustment out (or null to skip). */
export type Regulator = (field: FieldCandidate) => ScoreAdjustment | null;

// ── Built-in Regulators ──────────────────────────────────────────────

/** Base population score from `WHERE field != null` density. */
export const populationRegulator: Regulator = (field) => {
  if (field.populationPct === undefined) return null;
  return {
    regulator: 'population',
    delta: field.populationPct,
    reason: `${field.populationPct}% populated`,
  };
};

/** Managed package namespace penalty (prefix__FieldName__c). */
export const namespaceRegulator: Regulator = (field) => {
  if (!field.custom) return null;
  const match = field.name.match(/^([a-zA-Z0-9]+)__\w+__c$/);
  if (!match) return null;

  return {
    regulator: 'namespace',
    delta: -20,
    reason: `managed package (${match[1]}__)`,
  };
};

/** Label-based demotion for deprecated/abandoned fields. */
export const labelDemotionRegulator: Regulator = (field) => {
  const label = field.label.toLowerCase();
  const name = field.name.toLowerCase();

  if (label.includes('deprecated') || label.includes('do not use')) {
    return { regulator: 'label-demotion', delta: -80, reason: `deprecated: "${field.label}"` };
  }
  if (label.startsWith('z[') || label.startsWith('z ')) {
    return { regulator: 'label-demotion', delta: -80, reason: `z-prefix (hidden): "${field.label}"` };
  }
  if (name.startsWith('tech') || label.startsWith('TECH')) {
    return { regulator: 'label-demotion', delta: -30, reason: `TECH prefix (automation): "${field.label}"` };
  }
  return null;
};

/** Boost for fields with help text — someone invested in documenting them. */
export const qualityBoostRegulator: Regulator = (field) => {
  if (field.helpText && field.helpText.trim().length > 0) {
    return { regulator: 'quality-boost', delta: 15, reason: 'has help text' };
  }
  return null;
};

/** Categorical/numeric fields are more analytically useful. */
export const typeRelevanceRegulator: Regulator = (field) => {
  switch (field.computationType) {
    case 'categorical':
      return { regulator: 'type-relevance', delta: 10, reason: 'categorical (groupable)' };
    case 'numeric':
      return { regulator: 'type-relevance', delta: 10, reason: 'numeric (aggregatable)' };
    case 'temporal':
      return { regulator: 'type-relevance', delta: 5, reason: 'temporal (rangeable)' };
    case 'flag':
      return { regulator: 'type-relevance', delta: 5, reason: 'boolean (filterable)' };
    default:
      return null;
  }
};

/** Penalty for system/formula fields that auto-populate on every record. */
export const autoPopulatedRegulator: Regulator = (field) => {
  const patterns = [
    /^PhotoUrl$/i, /^Record_ID/i, /ID_18_Character/i,
    /^Jigsaw/i, /SystemModstamp/i, /^Is(Deleted|Archived)/i,
  ];
  if (patterns.some(p => p.test(field.name))) {
    return { regulator: 'auto-populated', delta: -50, reason: `system auto-populated: ${field.name}` };
  }
  return null;
};

/**
 * Demotion for a field the sample never once saw populated (ADR-301).
 *
 * Without this the other regulators rescue it: a checkbox nobody has ever
 * ticked still collects +5 for being filterable, scores positive, and promotes
 * — which makes the boolean signal inert, since scoring it honestly at 0%
 * changes nothing. Only exactly zero qualifies; a field at 3% is rare, not
 * abandoned, and sparse custom flags are precisely what the catalog is for.
 *
 * This is only sayable because the field was *measured*. An unscored field is
 * silent, not zero, and must not be demoted for it.
 */
export const unusedRegulator: Regulator = (field) => {
  if (field.populationPct !== 0) return null;
  return {
    regulator: 'unused',
    delta: -50,
    reason: 'no sampled record populates this field',
  };
};

/**
 * Demotion for fields falling out of use (ADR-301).
 *
 * Population density alone cannot separate a field the org still fills in from
 * one it abandoned: a field that was mandatory for years and dead for the last
 * few averages out to a middling number that ranks alongside a genuinely
 * steady field. The average describes no record that ever existed. Only the
 * trend across creation time tells them apart.
 *
 * The penalty is half the drop, so it scales with how decisively the practice
 * changed rather than firing at one fixed strength. Rising fields get no
 * matching boost: coming into use is already reflected in the recency-weighted
 * density, and paying for it twice would promote a field on the strength of a
 * few recent records.
 */
export const driftRegulator: Regulator = (field) => {
  if (field.trend?.direction !== 'falling') return null;
  return {
    regulator: 'drift',
    delta: Math.round(field.trend.deltaPp / 2),
    reason: `usage falling (${field.trend.deltaPp}pp across the sampled span)`,
  };
};

// ── Pipeline ─────────────────────────────────────────────────────────

export const DEFAULT_REGULATORS: Regulator[] = [
  populationRegulator,
  namespaceRegulator,
  labelDemotionRegulator,
  qualityBoostRegulator,
  typeRelevanceRegulator,
  autoPopulatedRegulator,
  unusedRegulator,
  driftRegulator,
];

/** Score a single field through all regulators. */
export function scoreField(
  field: FieldCandidate,
  regulators: Regulator[] = DEFAULT_REGULATORS,
): ScoredField {
  const adjustments: ScoreAdjustment[] = [];
  let score = 0;

  for (const reg of regulators) {
    const adj = reg(field);
    if (adj) {
      adjustments.push(adj);
      score += adj.delta;
    }
  }

  return { field, score, adjustments, promoted: false };
}

/** Score all fields, rank, and apply promotion cutoff. */
export function regulateFields(
  fields: FieldCandidate[],
  maxPromoted: number,
  regulators: Regulator[] = DEFAULT_REGULATORS,
): ScoredField[] {
  const scored = fields.map(f => scoreField(f, regulators));
  scored.sort((a, b) => b.score - a.score);

  // Find natural break in scores (knee detection)
  const positiveScores = scored.filter(s => s.score > 0);
  let cutoffIndex = Math.min(maxPromoted, positiveScores.length);

  for (let i = 4; i < Math.min(cutoffIndex, positiveScores.length - 1); i++) {
    const relDrop = positiveScores[i].score > 0
      ? (positiveScores[i].score - positiveScores[i + 1].score) / positiveScores[i].score
      : 0;
    if (relDrop > 0.5) {
      cutoffIndex = i + 1;
      break;
    }
  }

  for (let i = 0; i < scored.length; i++) {
    scored[i].promoted = i < cutoffIndex && scored[i].score > 0;
  }

  return scored;
}
