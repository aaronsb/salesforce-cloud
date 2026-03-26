/**
 * ADR-300 Field Regulator — composable scoring pipeline for field promotion.
 *
 * Each regulator is a pure function that adjusts a field's score based on
 * a single signal (population, namespace, label, type, etc.). Regulators
 * stack — all run on every field, order doesn't matter. The audit trail
 * of adjustments makes promotion decisions transparent and debuggable.
 */

import { ComputationType } from './field-type-map.js';

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

// ── Pipeline ─────────────────────────────────────────────────────────

export const DEFAULT_REGULATORS: Regulator[] = [
  populationRegulator,
  namespaceRegulator,
  labelDemotionRegulator,
  qualityBoostRegulator,
  typeRelevanceRegulator,
  autoPopulatedRegulator,
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
