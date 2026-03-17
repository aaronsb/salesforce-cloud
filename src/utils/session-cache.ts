import { estimateSize } from './cache-utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheOptions {
  /** Max records stored across all tiers before LRU eviction kicks in. Default 500. */
  maxRecords?: number;
  /** Approximate memory ceiling in bytes. Default 10 MB. */
  maxBytes?: number;
  /** Metadata tier TTL in milliseconds. Default 5 minutes. */
  metadataTtlMs?: number;
  /** Query tier TTL in milliseconds. Default 10 seconds. */
  queryTtlMs?: number;
}

export interface CacheStats {
  metadata: { count: number; bytes: number };
  record: { count: number; bytes: number };
  query: { count: number; bytes: number };
  totalCount: number;
  totalBytes: number;
  evictions: number;
}

interface CacheEntry<T> {
  data: T;
  size: number;
  lastAccessed: number;
  createdAt: number;
}

interface RecordEntry<T> extends CacheEntry<T> {
  epoch: string;          // SystemModstamp value
  tombstoned: boolean;
}

// ---------------------------------------------------------------------------
// SessionCache
// ---------------------------------------------------------------------------

export class SessionCache {
  // Configurable limits
  private readonly maxRecords: number;
  private readonly maxBytes: number;
  private readonly metadataTtlMs: number;
  private readonly queryTtlMs: number;

  // Storage maps
  private metadata = new Map<string, CacheEntry<unknown>>();
  private records  = new Map<string, RecordEntry<unknown>>();
  private queries  = new Map<string, CacheEntry<unknown>>();

  // Stats
  private evictionCount = 0;

  constructor(options: CacheOptions = {}) {
    this.maxRecords    = options.maxRecords    ?? 500;
    this.maxBytes      = options.maxBytes      ?? 10 * 1024 * 1024; // 10 MB
    this.metadataTtlMs = options.metadataTtlMs ?? 5 * 60 * 1000;   // 5 min
    this.queryTtlMs    = options.queryTtlMs    ?? 10 * 1000;        // 10 s
  }

  // -----------------------------------------------------------------------
  // Metadata tier — TTL-based (5 min default)
  // -----------------------------------------------------------------------

  getMetadata(objectName: string): unknown | undefined {
    const entry = this.metadata.get(objectName);
    if (!entry) return undefined;

    if (Date.now() - entry.createdAt > this.metadataTtlMs) {
      this.metadata.delete(objectName);
      return undefined;
    }

    entry.lastAccessed = Date.now();
    return entry.data;
  }

  setMetadata(objectName: string, data: unknown): void {
    const size = estimateSize(data);
    this.metadata.set(objectName, {
      data,
      size,
      lastAccessed: Date.now(),
      createdAt: Date.now(),
    });
    this.enforceEviction();
  }

  // -----------------------------------------------------------------------
  // Record tier — epoch-based (SystemModstamp)
  // -----------------------------------------------------------------------

  private recordKey(objectType: string, id: string): string {
    return `${objectType}:${id}`;
  }

  getRecord(objectType: string, id: string): unknown | undefined {
    const key = this.recordKey(objectType, id);
    const entry = this.records.get(key);
    if (!entry || entry.tombstoned) return undefined;

    entry.lastAccessed = Date.now();
    return entry.data;
  }

  setRecord(objectType: string, id: string, data: unknown, epoch: string): void {
    const key = this.recordKey(objectType, id);
    const size = estimateSize(data);
    this.records.set(key, {
      data,
      size,
      lastAccessed: Date.now(),
      createdAt: Date.now(),
      epoch,
      tombstoned: false,
    });
    this.enforceEviction();
  }

  invalidateRecord(objectType: string, id: string): void {
    const key = this.recordKey(objectType, id);
    this.records.delete(key);
  }

  tombstone(objectType: string, id: string): void {
    const key = this.recordKey(objectType, id);
    const existing = this.records.get(key);
    if (existing) {
      existing.tombstoned = true;
      existing.data = null;
      existing.size = 0;
      existing.lastAccessed = Date.now();
    } else {
      this.records.set(key, {
        data: null,
        size: 0,
        lastAccessed: Date.now(),
        createdAt: Date.now(),
        epoch: '',
        tombstoned: true,
      });
    }
  }

  isRecordStale(objectType: string, id: string, currentEpoch: string): boolean {
    const key = this.recordKey(objectType, id);
    const entry = this.records.get(key);
    if (!entry || entry.tombstoned) return true;
    return entry.epoch !== currentEpoch;
  }

  getRecordEpoch(objectType: string, id: string): string | undefined {
    const key = this.recordKey(objectType, id);
    const entry = this.records.get(key);
    if (!entry || entry.tombstoned) return undefined;
    return entry.epoch;
  }

  // -----------------------------------------------------------------------
  // Query tier — short TTL (10 s default)
  // -----------------------------------------------------------------------

  getQuery(fingerprint: string): unknown | undefined {
    const entry = this.queries.get(fingerprint);
    if (!entry) return undefined;

    if (Date.now() - entry.createdAt > this.queryTtlMs) {
      this.queries.delete(fingerprint);
      return undefined;
    }

    entry.lastAccessed = Date.now();
    return entry.data;
  }

  setQuery(fingerprint: string, data: unknown): void {
    const size = estimateSize(data);
    this.queries.set(fingerprint, {
      data,
      size,
      lastAccessed: Date.now(),
      createdAt: Date.now(),
    });
    this.enforceEviction();
  }

  // -----------------------------------------------------------------------
  // Cross-cutting
  // -----------------------------------------------------------------------

  clear(): void {
    this.metadata.clear();
    this.records.clear();
    this.queries.clear();
    this.evictionCount = 0;
  }

  getStats(): CacheStats {
    const metaBytes = this.sumBytes(this.metadata);
    const recBytes  = this.sumBytes(this.records);
    const qBytes    = this.sumBytes(this.queries);

    return {
      metadata: { count: this.metadata.size, bytes: metaBytes },
      record:   { count: this.records.size,   bytes: recBytes },
      query:    { count: this.queries.size,    bytes: qBytes },
      totalCount: this.metadata.size + this.records.size + this.queries.size,
      totalBytes: metaBytes + recBytes + qBytes,
      evictions: this.evictionCount,
    };
  }

  /**
   * Evict least-recently-used entries until both the record count and byte
   * budget are within configured limits.
   */
  evictLRU(): number {
    let evicted = 0;

    while (this.totalCount() > this.maxRecords || this.totalBytes() > this.maxBytes) {
      const oldest = this.findLRUEntry();
      if (!oldest) break;
      oldest.map.delete(oldest.key);
      evicted++;
      this.evictionCount++;
    }

    return evicted;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private enforceEviction(): void {
    if (this.totalCount() > this.maxRecords || this.totalBytes() > this.maxBytes) {
      this.evictLRU();
    }
  }

  private totalCount(): number {
    return this.metadata.size + this.records.size + this.queries.size;
  }

  private totalBytes(): number {
    return (
      this.sumBytes(this.metadata) +
      this.sumBytes(this.records) +
      this.sumBytes(this.queries)
    );
  }

  private sumBytes(map: Map<string, CacheEntry<unknown>>): number {
    let total = 0;
    for (const entry of map.values()) {
      total += entry.size;
    }
    return total;
  }

  /**
   * Scan all three maps and return the entry with the oldest lastAccessed
   * timestamp together with its owning map and key, so the caller can delete it.
   */
  private findLRUEntry(): { map: Map<string, CacheEntry<unknown>>; key: string } | undefined {
    let oldestTime = Infinity;
    let result: { map: Map<string, CacheEntry<unknown>>; key: string } | undefined;

    const scan = (map: Map<string, CacheEntry<unknown>>) => {
      for (const [key, entry] of map.entries()) {
        if (entry.lastAccessed < oldestTime) {
          oldestTime = entry.lastAccessed;
          result = { map, key };
        }
      }
    };

    scan(this.queries as Map<string, CacheEntry<unknown>>);
    scan(this.records as Map<string, CacheEntry<unknown>>);
    scan(this.metadata);

    return result;
  }
}
