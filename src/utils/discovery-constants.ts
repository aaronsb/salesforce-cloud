/**
 * ADR-300 Field Discovery — Tunable Constants
 *
 * Centralized parameters for field discovery. Adjust these to control
 * startup cost, API pressure, and catalog size.
 */

/** Objects to discover at startup. Others discovered on-demand via describe_object. */
export const CORE_OBJECTS = [
  'Account', 'Opportunity', 'Contact', 'Lead', 'Contract', 'ContentVersion',
];

/** Max concurrent Salesforce API calls during discovery (describes + scoring). */
export const DISCOVERY_CONCURRENCY = 3;

/** Max concurrent population scoring queries per object. */
export const SCORING_BATCH_SIZE = 5;

// ── ADR-301 sampling ─────────────────────────────────────────────────

/**
 * Creation-time windows a sample is drawn across.
 *
 * Enough to see a trend, few enough to stay cheap: each stratum costs one
 * query, and the whole point of sampling is that scoring an object costs
 * queries-per-stratum rather than queries-per-field.
 */
export const SAMPLE_STRATA = 6;

/** Records to sample per object, spread across the strata by weight. */
export const SAMPLE_TOTAL = 300;

/**
 * Floor on any single stratum's sample, including the oldest.
 *
 * This is the tail ADR-301 calls mandatory. Fields can be alive only in old
 * records, and a stratum sampled at zero reports those fields as unused —
 * indistinguishable from not existing. Also keeps the per-stratum population
 * precise enough to read a trend from.
 */
export const MIN_STRATUM_SAMPLE = 25;

/**
 * Geometric weighting toward recent records: each stratum draws this many times
 * the sample of the one before it. >1 means the newest stratum is the largest.
 *
 * The question being answered is what this org populates *now*, so recent
 * practice counts for more — but the weighting is gentle, because the tail is
 * evidence too, not noise to be suppressed.
 */
export const RECENCY_WEIGHT_RATIO = 1.5;

/**
 * Field types SOQL will not accept in a wide projection. Compound fields
 * (address, location) must be selected via their components, base64 bodies
 * can't be bulk-selected, and long text areas blow up the response.
 */
export const SAMPLE_EXCLUDED_TYPES = ['address', 'location', 'base64', 'textarea'];

/**
 * Drop in population, in percentage points, between the oldest and newest half
 * of the sample before a field is treated as being abandoned.
 *
 * Sampling error on a stratum is a few points; this is set well clear of it, so
 * the signal means a practice changed rather than a coin landed badly.
 */
export const DRIFT_THRESHOLD_PP = 30;

/** Max promoted fields per object (hard cap above the tail-curve knee). */
export const MAX_PROMOTED_PER_OBJECT = 40;

/** Max total promoted fields across all objects (global context budget). */
export const MAX_PROMOTED_TOTAL = 200;

/** Backoff configuration for 429 / rate limit responses. */
export const BACKOFF = {
  /** Initial delay in ms after first 429. */
  initialDelayMs: 1000,
  /** Multiplier per retry (exponential). */
  multiplier: 2,
  /** Max delay cap in ms. */
  maxDelayMs: 30_000,
  /** Max retries before giving up on a single query. */
  maxRetries: 3,
  /** Jitter range (0-1). 0.5 = ±50% of calculated delay. */
  jitter: 0.5,
};

/**
 * Well-known field patterns — fields with known semantic meaning
 * but variable API names across orgs. Resolved by label + type matching.
 */
export const WELL_KNOWN_PATTERNS: Array<{
  semantic: string;
  labelPattern: RegExp;
  type: string;
}> = [
  { semantic: 'isLatestVersion', labelPattern: /latest/i, type: 'boolean' },
];
