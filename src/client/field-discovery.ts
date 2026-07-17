/**
 * ADR-300 Field Discovery Module
 *
 * Runs at server startup (async, non-blocking) to discover, score, and
 * regulate fields on core Salesforce objects. Results are cached for the
 * session lifetime and exposed as MCP resources.
 *
 * The pipeline: describe → type-classify → population-score → regulate → cache
 */

import { SalesforceClient } from './salesforce-client.js';
import { getComputationType, isScorable } from '../utils/field-type-map.js';
import { FieldCandidate, ScoredField, regulateFields, DEFAULT_REGULATORS, Regulator } from '../utils/field-regulator.js';
import { withRetry, parallelLimit } from '../utils/rate-limited-executor.js';
import {
  CORE_OBJECTS, DISCOVERY_CONCURRENCY, SCORING_BATCH_SIZE,
  MAX_PROMOTED_PER_OBJECT, MAX_PROMOTED_TOTAL, WELL_KNOWN_PATTERNS,
  SAMPLE_EXCLUDED_TYPES,
} from '../utils/discovery-constants.js';
import { planStrata, pooledPopulation, populationIn, trendFrom } from '../utils/record-sampler.js';

// ── Types ────────────────────────────────────────────────────────────

export interface ObjectCatalog {
  objectName: string;
  /** All scored fields, sorted by score descending. */
  fields: ScoredField[];
  /** Just the promoted fields (convenience accessor). */
  promoted: ScoredField[];
  /** Well-known field resolutions for this object. */
  wellKnown: Map<string, string>;
  /** Discovery timing. */
  describeMs: number;
  scoringMs: number;
  totalFields: number;
  totalRecords: number;
  /**
   * Records actually drawn to score this object (ADR-301). Population is an
   * estimate from this many rows, not a census — worth reporting, because the
   * exactness it replaced was exactness about the wrong quantity.
   */
  sampledRecords: number;
}

export interface DiscoveryStats {
  objectsDiscovered: number;
  /** Core objects the startup sweep intends to cover. */
  objectsExpected: number;
  /** Core objects not yet discovered. Empty once ready. */
  pendingObjects: string[];
  totalFieldsSeen: number;
  totalPromoted: number;
  totalMs: number;
  ready: boolean;
  /**
   * Rough time left, projected from the pace so far (ADR-301). Present only
   * while discovery is running and at least one object has landed to project
   * from — a caller deciding whether to wait needs a number, and "unknown" is
   * an honest answer before there is any evidence to base one on.
   */
  etaMs?: number;
  errors: string[];
}

// ── FieldDiscovery Class ─────────────────────────────────────────────

export class FieldDiscovery {
  private catalogs = new Map<string, ObjectCatalog>();
  private client: SalesforceClient;
  private regulators: Regulator[];
  private startupPromise: Promise<void> | null = null;
  private errors: string[] = [];
  private totalMs = 0;
  /** When the startup sweep began — the basis for the ETA projection. */
  private startedAt: number | null = null;
  private _ready = false;

  constructor(client: SalesforceClient, regulators?: Regulator[]) {
    this.client = client;
    this.regulators = regulators ?? DEFAULT_REGULATORS;
  }

  /** Whether startup discovery has completed. */
  get ready(): boolean { return this._ready; }

  /** Kick off async discovery. Non-blocking, fire-and-forget safe. */
  startAsync(): void {
    if (this.startupPromise) return;
    this.startupPromise = this.discoverCoreObjects();
    this.startupPromise.catch((err) => {
      console.error(`Field discovery failed: ${err.message}`);
    });
  }

  /**
   * Wait for startup discovery to settle. Resolves `true` once it has run —
   * whether it succeeded or failed in a way the catalog already absorbed — and
   * `false` if it was never started, in which case there was nothing to wait
   * for and nothing has changed.
   *
   * The boolean is the point. Callers wait on this to react to discovery
   * *landing*; a bare `Promise<void>` that resolves immediately when
   * `startAsync()` was never called is indistinguishable from "discovery
   * finished", so a caller would act on a state change that never happened.
   *
   * Never rejects: discovery logs its own failures and records them in stats,
   * so re-raising here would force every caller to handle an error that has
   * already been dealt with.
   */
  whenSettled(): Promise<boolean> {
    if (!this.startupPromise) return Promise.resolve(false);
    return this.startupPromise.then(() => true, () => true);
  }

  /** Get the catalog for an object (returns undefined if not yet discovered). */
  getCatalog(objectName: string): ObjectCatalog | undefined {
    return this.catalogs.get(objectName);
  }

  /** All discovered catalogs, for surfaces that search across objects (ADR-302). */
  allCatalogs(): ObjectCatalog[] {
    return [...this.catalogs.values()];
  }

  /** Resolve a well-known semantic field name to its actual API name on this org. */
  resolveWellKnown(objectName: string, semantic: string): string | undefined {
    return this.catalogs.get(objectName)?.wellKnown.get(semantic);
  }

  /** Get discovery stats for the inspection surface. */
  getStats(): DiscoveryStats {
    let totalFieldsSeen = 0;
    let totalPromoted = 0;
    for (const catalog of this.catalogs.values()) {
      totalFieldsSeen += catalog.totalFields;
      totalPromoted += catalog.promoted.length;
    }

    // Only the startup sweep has a known scope to be pending against; objects
    // discovered on demand are extra, not outstanding.
    const pendingObjects = this._ready ? [] : CORE_OBJECTS.filter(o => !this.catalogs.has(o));
    const done = CORE_OBJECTS.length - pendingObjects.length;
    const eta = this.etaMs(done, pendingObjects.length);

    return {
      objectsDiscovered: this.catalogs.size,
      objectsExpected: CORE_OBJECTS.length,
      pendingObjects,
      totalFieldsSeen,
      totalPromoted,
      totalMs: this.totalMs,
      ready: this._ready,
      ...(eta !== undefined ? { etaMs: eta } : {}),
      errors: [...this.errors],
    };
  }

  /**
   * Project the time left from the pace so far, accounting for the objects
   * discovered in parallel. A projection, not a promise — but a caller deciding
   * whether to wait or fall back needs a number, and the alternative is asking
   * them to guess.
   */
  private etaMs(done: number, remaining: number): number | undefined {
    if (this._ready || this.startedAt === null || done === 0 || remaining === 0) return undefined;
    const perObject = (Date.now() - this.startedAt) / done;
    return Math.round((perObject * remaining) / DISCOVERY_CONCURRENCY);
  }

  /** Discover an object on-demand (if not already cached). */
  async discoverObject(objectName: string): Promise<ObjectCatalog | null> {
    if (this.catalogs.has(objectName)) return this.catalogs.get(objectName)!;
    try {
      const catalog = await this.probeAndRegulate(objectName);
      this.catalogs.set(objectName, catalog);
      this.enforceGlobalBudget();
      return catalog;
    } catch (err: any) {
      this.errors.push(`${objectName}: ${err.message}`);
      return null;
    }
  }

  // ── Private ──────────────────────────────────────────────────────

  private async discoverCoreObjects(): Promise<void> {
    const start = Date.now();
    this.startedAt = start;

    const tasks = CORE_OBJECTS.map((obj) => async () => {
      try {
        const catalog = await this.probeAndRegulate(obj);
        this.catalogs.set(obj, catalog);
      } catch (err: any) {
        this.errors.push(`${obj}: ${err.message}`);
        console.error(`  Discovery failed for ${obj}: ${err.message}`);
      }
    });

    await parallelLimit(tasks, DISCOVERY_CONCURRENCY);
    this.enforceGlobalBudget();
    this.totalMs = Date.now() - start;
    this._ready = true;

    const stats = this.getStats();
    console.error(
      `Field discovery complete: ${stats.objectsDiscovered} objects, ` +
      `${stats.totalPromoted} promoted fields, ${stats.totalMs}ms` +
      (stats.errors.length > 0 ? ` (${stats.errors.length} errors)` : ''),
    );
  }

  private async probeAndRegulate(objectName: string): Promise<ObjectCatalog> {
    // 1. Describe
    const describeStart = Date.now();
    const meta = await this.describeObject(objectName);
    const describeMs = Date.now() - describeStart;

    // 2. Build candidates with type classification
    const candidates: FieldCandidate[] = meta.fields.map((f: any) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      custom: f.custom,
      helpText: f.inlineHelpText || null,
      nillable: f.nillable,
      computationType: getComputationType(f.type).computationType,
      // Picklist values ride along on the describe we already fetched — no extra
      // API cost. Kept so field search (ADR-302) can answer "what values does
      // this field take?" in the same call that finds it. Active values only:
      // inactive ones can't appear in a WHERE clause the agent would write next.
      picklistValues: Array.isArray(f.picklistValues) && f.picklistValues.length > 0
        ? f.picklistValues.filter((p: any) => p?.active !== false).map((p: any) => p.value)
        : undefined,
    }));

    // 3. Population scoring, from a stratified sample (ADR-301)
    const scoringStart = Date.now();
    const { totalRecords, sampledRecords } = await this.scoreFromSample(objectName, candidates);
    const scoringMs = Date.now() - scoringStart;

    // 4. Regulate and rank
    const scored = regulateFields(candidates, MAX_PROMOTED_PER_OBJECT, this.regulators);

    // 5. Well-known field resolution
    const wellKnown = new Map<string, string>();
    for (const pattern of WELL_KNOWN_PATTERNS) {
      const match = candidates.find(
        f => pattern.labelPattern.test(f.label) && f.type === pattern.type,
      );
      if (match) {
        wellKnown.set(pattern.semantic, match.name);
      }
    }

    return {
      objectName,
      fields: scored,
      promoted: scored.filter(s => s.promoted),
      wellKnown,
      describeMs,
      scoringMs,
      totalFields: candidates.length,
      totalRecords,
      sampledRecords,
    };
  }

  /**
   * Score every candidate from one stratified sample of records (ADR-301).
   *
   * Costs a query per stratum rather than a query per field: a wide projection
   * reads every selectable field at once, and the distribution is computed in
   * memory. The sample carries values, so a boolean can be scored by how it
   * splits and a field's usage can be tracked across time — neither of which a
   * `COUNT(... WHERE f != null)` can see.
   *
   * Mutates `candidates` with populationPct / strataPopulation / trend, and
   * reports what it drew from.
   */
  private async scoreFromSample(
    objectName: string,
    candidates: FieldCandidate[],
  ): Promise<{ totalRecords: number; sampledRecords: number }> {
    // One aggregate answers both "how many?" and "over what span?".
    let totalRecords = 0;
    let spanFrom = NaN;
    let spanTo = NaN;
    try {
      const agg = await this.queryObject(
        objectName,
        `SELECT COUNT(Id) total, MIN(CreatedDate) spanFrom, MAX(CreatedDate) spanTo FROM ${objectName}`,
      );
      const row = (agg.records?.[0] ?? {}) as any;
      totalRecords = row.total ?? 0;
      spanFrom = Date.parse(row.spanFrom);
      spanTo = Date.parse(row.spanTo);
    } catch (err: any) {
      this.errors.push(`${objectName} sample probe: ${err.message}`);
      return { totalRecords: 0, sampledRecords: 0 };
    }

    if (totalRecords === 0) return { totalRecords, sampledRecords: 0 };

    // Only fields population is a meaningful question for. A non-nillable field
    // is 100% populated by definition — a fact about the schema that says
    // nothing about use — so it stays unscored, as it always has (ADR-300).
    // Flags are the exception: never null, but how they split is real evidence.
    const scorable = candidates.filter(f =>
      (f.nillable && isScorable(f.type)) || f.computationType === 'flag');
    if (scorable.length === 0) return { totalRecords, sampledRecords: 0 };

    // A wide SELECT can't carry compound, binary or long-text fields.
    const projectable = candidates.filter(f => !SAMPLE_EXCLUDED_TYPES.includes(f.type.toLowerCase()));
    const projection = projectable.map(f => f.name).join(', ');
    if (!projection) return { totalRecords, sampledRecords: 0 };

    const strata = planStrata(spanFrom, spanTo);
    const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

    const samples: Array<Array<Record<string, unknown>>> = strata.map(() => []);
    const tasks = strata.map((stratum, i) => async () => {
      const bounds = [`CreatedDate >= ${iso(stratum.from)}`];
      if (stratum.to !== undefined) bounds.push(`CreatedDate < ${iso(stratum.to)}`);
      const soql =
        `SELECT ${projection} FROM ${objectName} ` +
        `WHERE ${bounds.join(' AND ')} LIMIT ${stratum.limit}`;
      try {
        const res = await withRetry(() => this.queryObject(objectName, soql), `${objectName} stratum ${i}`);
        samples[i] = (res.records ?? []) as Array<Record<string, unknown>>;
      } catch (err: any) {
        // A window that fails leaves a gap in the trend, not a broken catalog.
        this.errors.push(`${objectName} stratum ${i}: ${err.message}`);
      }
    });
    await parallelLimit(tasks, SCORING_BATCH_SIZE);

    const drawn = samples.filter(s => s.length > 0);
    if (drawn.length === 0) return { totalRecords, sampledRecords: 0 };

    for (const field of scorable) {
      const isFlag = field.computationType === 'flag';
      field.populationPct = pooledPopulation(samples, field.name, isFlag);
      // Only windows that returned records describe an era; an empty one is a
      // gap in the evidence, not a field nobody filled in.
      field.strataPopulation = drawn.map(s => populationIn(s, field.name, isFlag));
      field.trend = trendFrom(field.strataPopulation);
    }

    return { totalRecords, sampledRecords: samples.reduce((a, s) => a + s.length, 0) };
  }

  /** Enforce global budget — demote lowest-scoring promoted fields across objects. */
  private enforceGlobalBudget(): void {
    let totalPromoted = 0;
    for (const catalog of this.catalogs.values()) {
      totalPromoted += catalog.promoted.length;
    }

    if (totalPromoted <= MAX_PROMOTED_TOTAL) return;

    // Collect all promoted fields with their object context
    const allPromoted: Array<{ field: ScoredField; catalog: ObjectCatalog }> = [];
    for (const catalog of this.catalogs.values()) {
      for (const sf of catalog.promoted) {
        allPromoted.push({ field: sf, catalog });
      }
    }

    // Sort by score ascending — lowest scores get demoted first
    allPromoted.sort((a, b) => a.field.score - b.field.score);

    const toRemove = totalPromoted - MAX_PROMOTED_TOTAL;
    for (let i = 0; i < toRemove; i++) {
      allPromoted[i].field.promoted = false;
    }

    // Rebuild promoted arrays
    for (const catalog of this.catalogs.values()) {
      catalog.promoted = catalog.fields.filter(s => s.promoted);
    }
  }

  private async describeObject(objectName: string): Promise<any> {
    await this.client.ensureInitialized();
    return this.client.getConnection().describe(objectName);
  }

  private async queryObject(_objectName: string, soql: string): Promise<any> {
    await this.client.ensureInitialized();
    return this.client.getConnection().query(soql);
  }
}
