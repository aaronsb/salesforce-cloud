import { SessionCache } from './session-cache.js';

/**
 * Middleware layer between handlers and the SessionCache.
 *
 * Implements write-through semantics for mutations (ADR-102, section 4):
 * - Create: cache the new record with its epoch
 * - Update: invalidate cached record so next read refetches
 * - Delete: tombstone in cache so reads return undefined
 *
 * Also provides cache-aside reads for records and metadata.
 */
export class CacheMiddleware {
  constructor(private readonly cache: SessionCache) {}

  // -----------------------------------------------------------------------
  // Write-through mutation hooks
  // -----------------------------------------------------------------------

  /**
   * Called after a successful create. Stores the new record in cache
   * so an immediate read doesn't need to round-trip to Salesforce.
   */
  onRecordCreated(
    objectType: string,
    id: string,
    data: Record<string, unknown>,
    epoch: string
  ): void {
    this.cache.setRecord(objectType, id, data, epoch);
  }

  /**
   * Called after a successful update. Invalidates the cached record
   * so the next read will refetch with the new epoch.
   */
  onRecordUpdated(objectType: string, id: string): void {
    this.cache.invalidateRecord(objectType, id);
  }

  /**
   * Called after a successful delete. Places a tombstone in cache
   * so subsequent reads within the session know the record is gone.
   */
  onRecordDeleted(objectType: string, id: string): void {
    this.cache.tombstone(objectType, id);
  }

  // -----------------------------------------------------------------------
  // Cache-aside reads
  // -----------------------------------------------------------------------

  /**
   * Get a record from cache or fetch it from Salesforce.
   *
   * The fetcher should return the full record including a `SystemModstamp`
   * field that serves as the epoch marker. If the cached record's epoch
   * matches the current epoch, the cached version is returned without
   * calling the fetcher.
   *
   * @param objectType - Salesforce object API name (e.g. "Opportunity")
   * @param id         - Record ID
   * @param fetcher    - Async function that retrieves the record from Salesforce
   * @returns The record data (from cache or freshly fetched)
   */
  async getOrFetch<T extends Record<string, unknown>>(
    objectType: string,
    id: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    const cached = this.cache.getRecord(objectType, id) as T | undefined;

    if (cached !== undefined) {
      return cached;
    }

    const fresh = await fetcher();
    const epoch = (fresh.SystemModstamp as string) ?? '';
    this.cache.setRecord(objectType, id, fresh, epoch);
    return fresh;
  }

  /**
   * Get object metadata from cache or fetch it.
   *
   * Metadata is cached with TTL-based expiration (default 5 minutes).
   *
   * @param objectName - Salesforce object API name
   * @param fetcher    - Async function that retrieves the metadata
   * @returns The metadata (from cache or freshly fetched)
   */
  async getCachedMetadata<T>(
    objectName: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    const cached = this.cache.getMetadata(objectName) as T | undefined;

    if (cached !== undefined) {
      return cached;
    }

    const fresh = await fetcher();
    this.cache.setMetadata(objectName, fresh);
    return fresh;
  }
}
