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
} from '../utils/discovery-constants.js';

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
}

export interface DiscoveryStats {
  objectsDiscovered: number;
  totalFieldsSeen: number;
  totalPromoted: number;
  totalMs: number;
  ready: boolean;
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

  /** Get the catalog for an object (returns undefined if not yet discovered). */
  getCatalog(objectName: string): ObjectCatalog | undefined {
    return this.catalogs.get(objectName);
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
    return {
      objectsDiscovered: this.catalogs.size,
      totalFieldsSeen,
      totalPromoted,
      totalMs: this.totalMs,
      ready: this._ready,
      errors: [...this.errors],
    };
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
    }));

    // 3. Population scoring
    const scoringStart = Date.now();
    const scorable = candidates.filter(f => f.nillable && isScorable(f.type));
    let totalRecords = 0;

    try {
      const countResult = await this.queryObject(objectName, 'SELECT COUNT() FROM ' + objectName);
      totalRecords = countResult.totalSize ?? 0;
    } catch (err: any) {
      this.errors.push(`${objectName} COUNT: ${err.message}`);
    }

    if (totalRecords > 0) {
      const scoringTasks = scorable.map((field) => async () => {
        try {
          const result = await withRetry(
            () => this.queryObject(objectName, `SELECT COUNT(Id) cnt FROM ${objectName} WHERE ${field.name} != null`),
            `${objectName}.${field.name}`,
          );
          const count = (result.records?.[0] as any)?.cnt ?? 0;
          field.populationPct = Math.round((count / totalRecords) * 100);
        } catch {
          // Non-fatal: field just won't have population data
        }
      });
      await parallelLimit(scoringTasks, SCORING_BATCH_SIZE);
    }
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
    };
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
