/**
 * ADR-301 Record Sampler — plan a stratified sample, read population from it.
 *
 * ADR-300 measured population with one aggregate per field. That is expensive
 * enough to force the signal thin — one question per field, nullable fields
 * only — and, worse, it is time-blind: a count over every record returns a
 * single number for the object's whole history. A field that was mandatory for
 * six years and dead for three averages out to a number describing no record
 * that ever existed.
 *
 * Sampling inverts the economics: a few queries reading many fields over some
 * records, instead of many queries reading one field over all records. The
 * sample carries values rather than null-counts, so the richer signals — how a
 * boolean actually splits, how usage moves over time — come free.
 *
 * Everything here is pure. The queries live in field-discovery; this module
 * decides what to ask for and what the answers mean.
 */

import {
  SAMPLE_STRATA, SAMPLE_TOTAL, MIN_STRATUM_SAMPLE, RECENCY_WEIGHT_RATIO,
  DRIFT_THRESHOLD_PP,
} from './discovery-constants.js';

// ── Types ────────────────────────────────────────────────────────────

/** One creation-time window to sample, oldest first. */
export interface Stratum {
  /** Inclusive lower bound, ms since epoch. */
  from: number;
  /** Exclusive upper bound, ms since epoch. The newest stratum has none. */
  to?: number;
  /** How many records to draw from this window. */
  limit: number;
}

/** Population of one field within one stratum, 0-100. */
export type StratumPopulation = number;

export interface FieldTrend {
  /**
   * Change in population between the oldest and newest half of the sample, in
   * percentage points. Negative means the field is falling out of use.
   */
  deltaPp: number;
  direction: 'rising' | 'falling' | 'stable';
}

// ── Stratum planning ─────────────────────────────────────────────────

/**
 * Geometric weights, oldest to newest. The newest stratum draws the largest
 * sample because recent practice answers the question being asked; the oldest
 * still draws one because it is the only witness to fields that have since been
 * abandoned.
 */
export function stratumWeights(count: number, ratio = RECENCY_WEIGHT_RATIO): number[] {
  const raw = Array.from({ length: count }, (_, i) => Math.pow(ratio, i));
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map(w => w / total);
}

/**
 * Split a creation span into weighted, sampled windows.
 *
 * Boundaries derive from the observed span, so the same org plans the same
 * sample on every run — a promotion can be explained after the fact rather than
 * blamed on the day's network timing.
 *
 * Degenerate spans collapse to a single window: an object whose records were
 * all created in the same instant has no time dimension to stratify, and
 * pretending otherwise would issue several queries that each return the same
 * rows.
 */
export function planStrata(
  spanFromMs: number,
  spanToMs: number,
  opts: { strata?: number; total?: number; minPerStratum?: number } = {},
): Stratum[] {
  const strata = opts.strata ?? SAMPLE_STRATA;
  const total = opts.total ?? SAMPLE_TOTAL;
  const minPer = opts.minPerStratum ?? MIN_STRATUM_SAMPLE;

  if (!Number.isFinite(spanFromMs) || !Number.isFinite(spanToMs) || spanToMs <= spanFromMs || strata < 2) {
    return [{ from: spanFromMs, limit: Math.max(total, minPer) }];
  }

  const weights = stratumWeights(strata);
  const width = (spanToMs - spanFromMs) / strata;

  return weights.map((w, i) => {
    const from = spanFromMs + width * i;
    const isNewest = i === strata - 1;
    return {
      from,
      // The newest window is left open so records created after the span was
      // measured — during discovery itself — are not silently outside it.
      ...(isNewest ? {} : { to: spanFromMs + width * (i + 1) }),
      limit: Math.max(minPer, Math.round(total * w)),
    };
  });
}

// ── Reading population out of a sample ───────────────────────────────

/** True when a sampled value counts as "someone filled this in". */
export function isPopulated(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

/**
 * Population of a field within one stratum's records, 0-100.
 *
 * Booleans are measured by how often they are *true*, not by being non-null.
 * A checkbox is never null, so null-counting scores every checkbox 100% — a
 * fact about the schema carrying no information about use. How it splits is the
 * real signal, and it is only visible because the sample carries values.
 */
export function populationIn(
  records: Array<Record<string, unknown>>,
  fieldName: string,
  isFlag: boolean,
): StratumPopulation {
  if (records.length === 0) return 0;
  const hits = records.filter(r => (isFlag ? r[fieldName] === true : isPopulated(r[fieldName]))).length;
  return Math.round((hits / records.length) * 100);
}

/**
 * Population across the whole sample, 0-100.
 *
 * Pooled rather than averaged over strata: the sample is *allocated* by
 * recency weight, so pooling already weights recent practice more heavily.
 * Averaging the per-stratum figures instead would throw that away and hand
 * every era equal say.
 */
export function pooledPopulation(
  strataRecords: Array<Array<Record<string, unknown>>>,
  fieldName: string,
  isFlag: boolean,
): StratumPopulation {
  const all = strataRecords.flat();
  return populationIn(all, fieldName, isFlag);
}

/**
 * Direction of travel, from the per-stratum populations.
 *
 * A least-squares fit across every window, reported as the change the fitted
 * line covers end to end. Two cheaper measures were tried against real data
 * and both lie:
 *
 * Comparing the newest stratum to the oldest reads two small samples and calls
 * the difference a trend — noise in either endpoint invents drift that isn't
 * there.
 *
 * Comparing the mean of the newest half to the oldest half is robust but
 * blind to a cliff, because it averages the drop into the flat years before
 * it. A field observed at [100, 100, 100, 100, 100, 24] — steady for years,
 * then abandoned — comes out at -25pp and reads "stable", which is exactly
 * backwards. A field declining steadily [68, 40, 13, 31, 7, 1] does the same.
 *
 * A regression uses every point, so no single window can manufacture a trend,
 * and it tracks the trajectory rather than flattening it.
 */
export function trendFrom(
  strataPopulations: StratumPopulation[],
  thresholdPp = DRIFT_THRESHOLD_PP,
): FieldTrend | undefined {
  const n = strataPopulations.length;
  if (n < 2) return undefined;

  const meanX = (n - 1) / 2;
  const meanY = strataPopulations.reduce((a, b) => a + b, 0) / n;

  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    covariance += (i - meanX) * (strataPopulations[i] - meanY);
    variance += (i - meanX) ** 2;
  }

  // variance is zero only when n < 2, already handled.
  const slopePerStratum = covariance / variance;
  const deltaPp = Math.round(slopePerStratum * (n - 1));

  const direction = deltaPp <= -thresholdPp ? 'falling'
    : deltaPp >= thresholdPp ? 'rising'
      : 'stable';

  return { deltaPp, direction };
}
