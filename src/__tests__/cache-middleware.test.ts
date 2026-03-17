import { CacheMiddleware } from '../utils/cache-middleware';
import { SessionCache } from '../utils/session-cache';

describe('CacheMiddleware', () => {
  let cache: SessionCache;
  let middleware: CacheMiddleware;

  beforeEach(() => {
    cache = new SessionCache();
    middleware = new CacheMiddleware(cache);
  });

  // -----------------------------------------------------------------------
  // Write-through: create
  // -----------------------------------------------------------------------

  describe('onRecordCreated', () => {
    it('should add created record to cache', () => {
      const data = { Id: '001ABC', Name: 'Acme Corp', SystemModstamp: '2026-03-16T10:00:00Z' };
      middleware.onRecordCreated('Account', '001ABC', data, '2026-03-16T10:00:00Z');

      const cached = cache.getRecord('Account', '001ABC');
      expect(cached).toEqual(data);
    });

    it('should store the epoch so staleness checks work', () => {
      middleware.onRecordCreated('Account', '001ABC', { Id: '001ABC' }, '2026-03-16T10:00:00Z');

      expect(cache.getRecordEpoch('Account', '001ABC')).toBe('2026-03-16T10:00:00Z');
      expect(cache.isRecordStale('Account', '001ABC', '2026-03-16T10:00:00Z')).toBe(false);
      expect(cache.isRecordStale('Account', '001ABC', '2026-03-16T11:00:00Z')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Write-through: update
  // -----------------------------------------------------------------------

  describe('onRecordUpdated', () => {
    it('should invalidate cached record after update', () => {
      // Pre-populate cache
      cache.setRecord('Account', '001ABC', { Id: '001ABC', Name: 'Old' }, '2026-03-16T10:00:00Z');
      expect(cache.getRecord('Account', '001ABC')).toBeDefined();

      middleware.onRecordUpdated('Account', '001ABC');

      expect(cache.getRecord('Account', '001ABC')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Write-through: delete
  // -----------------------------------------------------------------------

  describe('onRecordDeleted', () => {
    it('should tombstone the record after deletion', () => {
      // Pre-populate cache
      cache.setRecord('Account', '001ABC', { Id: '001ABC', Name: 'Acme' }, '2026-03-16T10:00:00Z');

      middleware.onRecordDeleted('Account', '001ABC');

      // Tombstoned records return undefined from getRecord
      expect(cache.getRecord('Account', '001ABC')).toBeUndefined();
      // But staleness check still reports stale (tombstoned)
      expect(cache.isRecordStale('Account', '001ABC', '2026-03-16T10:00:00Z')).toBe(true);
    });

    it('should tombstone even without prior cache entry', () => {
      middleware.onRecordDeleted('Account', '001NEW');

      expect(cache.getRecord('Account', '001NEW')).toBeUndefined();
      expect(cache.isRecordStale('Account', '001NEW', 'any-epoch')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // getOrFetch — cache-aside reads
  // -----------------------------------------------------------------------

  describe('getOrFetch', () => {
    it('should return cached record on cache hit without calling fetcher', async () => {
      const record = { Id: '006OPP', Name: 'Big Deal', SystemModstamp: '2026-03-16T10:00:00Z' };
      cache.setRecord('Opportunity', '006OPP', record, '2026-03-16T10:00:00Z');

      const fetcher = jest.fn();

      const result = await middleware.getOrFetch('Opportunity', '006OPP', fetcher);

      expect(result).toEqual(record);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('should call fetcher on cache miss and cache the result', async () => {
      const fresh = { Id: '006OPP', Name: 'Big Deal', SystemModstamp: '2026-03-16T12:00:00Z' };
      const fetcher = jest.fn().mockResolvedValue(fresh);

      const result = await middleware.getOrFetch('Opportunity', '006OPP', fetcher);

      expect(result).toEqual(fresh);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Should now be cached
      expect(cache.getRecord('Opportunity', '006OPP')).toEqual(fresh);
      expect(cache.getRecordEpoch('Opportunity', '006OPP')).toBe('2026-03-16T12:00:00Z');
    });

    it('should refetch after record is invalidated (stale)', async () => {
      // Populate cache, then invalidate (simulating an update)
      const staleData = { Id: '006OPP', Name: 'Old Name', SystemModstamp: '2026-03-16T10:00:00Z' };
      cache.setRecord('Opportunity', '006OPP', staleData, '2026-03-16T10:00:00Z');

      middleware.onRecordUpdated('Opportunity', '006OPP');

      const freshData = { Id: '006OPP', Name: 'New Name', SystemModstamp: '2026-03-16T14:00:00Z' };
      const fetcher = jest.fn().mockResolvedValue(freshData);

      const result = await middleware.getOrFetch('Opportunity', '006OPP', fetcher);

      expect(result).toEqual(freshData);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('should refetch after record is tombstoned (deleted then recreated)', async () => {
      middleware.onRecordDeleted('Account', '001ABC');

      const newRecord = { Id: '001ABC', Name: 'Reborn', SystemModstamp: '2026-03-16T15:00:00Z' };
      const fetcher = jest.fn().mockResolvedValue(newRecord);

      const result = await middleware.getOrFetch('Account', '001ABC', fetcher);

      expect(result).toEqual(newRecord);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // getCachedMetadata — TTL-based caching
  // -----------------------------------------------------------------------

  describe('getCachedMetadata', () => {
    it('should return cached metadata without calling fetcher', async () => {
      const metadata = { name: 'Account', fields: ['Id', 'Name'] };
      cache.setMetadata('Account', metadata);

      const fetcher = jest.fn();

      const result = await middleware.getCachedMetadata('Account', fetcher);

      expect(result).toEqual(metadata);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('should call fetcher on cache miss and cache the result', async () => {
      const metadata = { name: 'Contact', fields: ['Id', 'FirstName', 'LastName'] };
      const fetcher = jest.fn().mockResolvedValue(metadata);

      const result = await middleware.getCachedMetadata('Contact', fetcher);

      expect(result).toEqual(metadata);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Should now be cached — second call should not invoke fetcher
      const fetcher2 = jest.fn();
      const result2 = await middleware.getCachedMetadata('Contact', fetcher2);
      expect(result2).toEqual(metadata);
      expect(fetcher2).not.toHaveBeenCalled();
    });

    it('should refetch after TTL expires', async () => {
      // Use a cache with very short metadata TTL
      const shortTtlCache = new SessionCache({ metadataTtlMs: 1 });
      const shortTtlMiddleware = new CacheMiddleware(shortTtlCache);

      const metadata1 = { name: 'Lead', version: 1 };
      const fetcher1 = jest.fn().mockResolvedValue(metadata1);

      await shortTtlMiddleware.getCachedMetadata('Lead', fetcher1);
      expect(fetcher1).toHaveBeenCalledTimes(1);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 5));

      const metadata2 = { name: 'Lead', version: 2 };
      const fetcher2 = jest.fn().mockResolvedValue(metadata2);

      const result = await shortTtlMiddleware.getCachedMetadata('Lead', fetcher2);
      expect(result).toEqual(metadata2);
      expect(fetcher2).toHaveBeenCalledTimes(1);
    });
  });
});
