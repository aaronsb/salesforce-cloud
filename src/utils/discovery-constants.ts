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
