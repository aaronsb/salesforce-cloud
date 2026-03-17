/// <reference types="jest" />

import { SessionCache, CacheOptions } from '../utils/session-cache';
import { queryFingerprint, estimateSize, formatCacheStub, formatDeltaHint } from '../utils/cache-utils';

// ---------------------------------------------------------------------------
// cache-utils
// ---------------------------------------------------------------------------

describe('queryFingerprint', () => {
  it('should return a hex string', () => {
    const fp = queryFingerprint('SELECT Id FROM Account');
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should produce identical fingerprints for whitespace-only differences', () => {
    const a = queryFingerprint('SELECT  Id   FROM  Account');
    const b = queryFingerprint('SELECT Id FROM Account');
    expect(a).toBe(b);
  });

  it('should produce different fingerprints for different queries', () => {
    const a = queryFingerprint('SELECT Id FROM Account');
    const b = queryFingerprint('SELECT Id FROM Contact');
    expect(a).not.toBe(b);
  });
});

describe('estimateSize', () => {
  it('should return the byte length of JSON-serialized data', () => {
    const obj = { key: 'value' };
    const size = estimateSize(obj);
    expect(size).toBe(Buffer.byteLength(JSON.stringify(obj), 'utf8'));
  });

  it('should return 0 for circular references', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(estimateSize(a)).toBe(0);
  });
});

describe('formatCacheStub', () => {
  it('should include object type, id, name, and epoch', () => {
    const stub = formatCacheStub('Opportunity', '006ABC', 'Acme Deal', '2026-03-16T14:32:00Z');
    expect(stub).toContain('Opportunity');
    expect(stub).toContain('006ABC');
    expect(stub).toContain('Acme Deal');
    expect(stub).toContain('2026-03-16T14:32:00Z');
    expect(stub).toContain('↩');
    expect(stub).toContain('unchanged');
  });

  it('should omit name segment when name is undefined', () => {
    const stub = formatCacheStub('Account', '001XYZ', undefined, '2026-01-01T00:00:00Z');
    expect(stub).not.toContain('(');
  });
});

describe('formatDeltaHint', () => {
  it('should list changed fields', () => {
    const hint = formatDeltaHint(
      'Opportunity', '006ABC', 'Acme Deal',
      { Stage: 'Proposal', Amount: 250000 },
      { Stage: 'Negotiation', Amount: 275000 }
    );
    expect(hint).toContain('⚡');
    expect(hint).toContain('Stage: Proposal → Negotiation');
    expect(hint).toContain('Amount: 250000 → 275000');
  });

  it('should handle no changed fields gracefully', () => {
    const hint = formatDeltaHint(
      'Account', '001A', 'Acme', { Name: 'Acme' }, { Name: 'Acme' }
    );
    expect(hint).toContain('⚡');
    expect(hint).toContain('updated');
    expect(hint).not.toContain('→');
  });

  it('should skip attributes and SystemModstamp fields', () => {
    const hint = formatDeltaHint(
      'Account', '001A', 'Acme',
      { attributes: { type: 'Account' }, SystemModstamp: 'old', Name: 'Acme' },
      { attributes: { type: 'Account' }, SystemModstamp: 'new', Name: 'Acme' }
    );
    expect(hint).not.toContain('attributes');
    expect(hint).not.toContain('SystemModstamp');
  });
});

// ---------------------------------------------------------------------------
// SessionCache — Metadata tier
// ---------------------------------------------------------------------------

describe('SessionCache — Metadata tier', () => {
  let cache: SessionCache;

  beforeEach(() => {
    cache = new SessionCache();
  });

  it('should store and retrieve metadata', () => {
    const data = { name: 'Account', fields: ['Id'] };
    cache.setMetadata('Account', data);
    expect(cache.getMetadata('Account')).toEqual(data);
  });

  it('should return undefined for missing metadata', () => {
    expect(cache.getMetadata('Unknown')).toBeUndefined();
  });

  it('should expire metadata after TTL', () => {
    const cache = new SessionCache({ metadataTtlMs: 50 });
    cache.setMetadata('Account', { name: 'Account' });

    // Immediately available
    expect(cache.getMetadata('Account')).toBeDefined();

    // Simulate time passing by manipulating createdAt
    jest.useFakeTimers();
    jest.advanceTimersByTime(60);
    expect(cache.getMetadata('Account')).toBeUndefined();
    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// SessionCache — Record tier
// ---------------------------------------------------------------------------

describe('SessionCache — Record tier', () => {
  let cache: SessionCache;

  beforeEach(() => {
    cache = new SessionCache();
  });

  it('should store and retrieve a record', () => {
    const record = { Id: '006A', Name: 'Deal' };
    cache.setRecord('Opportunity', '006A', record, '2026-03-16T00:00:00Z');
    expect(cache.getRecord('Opportunity', '006A')).toEqual(record);
  });

  it('should return undefined for missing records', () => {
    expect(cache.getRecord('Opportunity', 'nonexistent')).toBeUndefined();
  });

  it('should store and return the epoch', () => {
    cache.setRecord('Account', '001A', {}, '2026-01-01T00:00:00Z');
    expect(cache.getRecordEpoch('Account', '001A')).toBe('2026-01-01T00:00:00Z');
  });

  it('should detect stale records when epoch differs', () => {
    cache.setRecord('Account', '001A', {}, '2026-01-01T00:00:00Z');
    expect(cache.isRecordStale('Account', '001A', '2026-01-01T00:00:00Z')).toBe(false);
    expect(cache.isRecordStale('Account', '001A', '2026-02-01T00:00:00Z')).toBe(true);
  });

  it('should treat missing records as stale', () => {
    expect(cache.isRecordStale('Account', 'missing', '2026-01-01T00:00:00Z')).toBe(true);
  });

  it('should invalidate a record', () => {
    cache.setRecord('Account', '001A', { Name: 'Acme' }, '2026-01-01T00:00:00Z');
    cache.invalidateRecord('Account', '001A');
    expect(cache.getRecord('Account', '001A')).toBeUndefined();
  });

  it('should tombstone an existing record', () => {
    cache.setRecord('Account', '001A', { Name: 'Acme' }, '2026-01-01T00:00:00Z');
    cache.tombstone('Account', '001A');
    expect(cache.getRecord('Account', '001A')).toBeUndefined();
    expect(cache.getRecordEpoch('Account', '001A')).toBeUndefined();
    expect(cache.isRecordStale('Account', '001A', 'any')).toBe(true);
  });

  it('should tombstone a record that was not previously cached', () => {
    cache.tombstone('Account', '001Z');
    expect(cache.getRecord('Account', '001Z')).toBeUndefined();
    expect(cache.isRecordStale('Account', '001Z', 'any')).toBe(true);
  });

  it('should overwrite an existing record with setRecord', () => {
    cache.setRecord('Account', '001A', { Name: 'Old' }, 'epoch-1');
    cache.setRecord('Account', '001A', { Name: 'New' }, 'epoch-2');
    expect(cache.getRecord('Account', '001A')).toEqual({ Name: 'New' });
    expect(cache.getRecordEpoch('Account', '001A')).toBe('epoch-2');
  });
});

// ---------------------------------------------------------------------------
// SessionCache — Query tier
// ---------------------------------------------------------------------------

describe('SessionCache — Query tier', () => {
  it('should store and retrieve query results', () => {
    const cache = new SessionCache();
    const data = [{ Id: '001' }];
    cache.setQuery('fp123', data);
    expect(cache.getQuery('fp123')).toEqual(data);
  });

  it('should return undefined for missing queries', () => {
    const cache = new SessionCache();
    expect(cache.getQuery('nope')).toBeUndefined();
  });

  it('should expire query results after TTL', () => {
    const cache = new SessionCache({ queryTtlMs: 50 });
    cache.setQuery('fp1', { rows: 1 });

    expect(cache.getQuery('fp1')).toBeDefined();

    jest.useFakeTimers();
    jest.advanceTimersByTime(60);
    expect(cache.getQuery('fp1')).toBeUndefined();
    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// SessionCache — Cross-cutting: clear, stats, eviction
// ---------------------------------------------------------------------------

describe('SessionCache — Cross-cutting', () => {
  it('should clear all tiers', () => {
    const cache = new SessionCache();
    cache.setMetadata('A', {});
    cache.setRecord('B', '1', {}, 'e');
    cache.setQuery('q', {});
    cache.clear();

    const stats = cache.getStats();
    expect(stats.totalCount).toBe(0);
    expect(stats.totalBytes).toBe(0);
  });

  it('should report accurate stats', () => {
    const cache = new SessionCache();
    cache.setMetadata('A', { x: 1 });
    cache.setRecord('B', '1', { y: 2 }, 'e');
    cache.setQuery('q', { z: 3 });

    const stats = cache.getStats();
    expect(stats.metadata.count).toBe(1);
    expect(stats.record.count).toBe(1);
    expect(stats.query.count).toBe(1);
    expect(stats.totalCount).toBe(3);
    expect(stats.totalBytes).toBeGreaterThan(0);
    expect(stats.evictions).toBe(0);
  });

  it('should evict LRU entries when maxRecords is exceeded', () => {
    const cache = new SessionCache({ maxRecords: 3 });
    cache.setRecord('A', '1', { v: 1 }, 'e1');
    cache.setRecord('A', '2', { v: 2 }, 'e2');
    cache.setRecord('A', '3', { v: 3 }, 'e3');

    // Access record 1 to make it recently used
    cache.getRecord('A', '1');

    // Adding a 4th should evict the LRU (record 2, since 1 was just accessed)
    cache.setRecord('A', '4', { v: 4 }, 'e4');

    const stats = cache.getStats();
    expect(stats.totalCount).toBeLessThanOrEqual(3);
    expect(stats.evictions).toBeGreaterThan(0);
    // Record 1 should survive (recently accessed)
    expect(cache.getRecord('A', '1')).toBeDefined();
  });

  it('should evict LRU entries when maxBytes is exceeded', () => {
    // Each record ≈ 50+ bytes; set ceiling so only 2 fit
    const cache = new SessionCache({ maxBytes: 100, maxRecords: 1000 });
    const bigPayload = 'x'.repeat(40);
    cache.setRecord('X', '1', { payload: bigPayload }, 'e1');
    cache.setRecord('X', '2', { payload: bigPayload }, 'e2');
    cache.setRecord('X', '3', { payload: bigPayload }, 'e3');

    const stats = cache.getStats();
    expect(stats.totalBytes).toBeLessThanOrEqual(100);
    expect(stats.evictions).toBeGreaterThan(0);
  });

  it('should track eviction count in stats', () => {
    const cache = new SessionCache({ maxRecords: 2 });
    cache.setRecord('A', '1', {}, 'e');
    cache.setRecord('A', '2', {}, 'e');
    cache.setRecord('A', '3', {}, 'e'); // triggers eviction

    expect(cache.getStats().evictions).toBeGreaterThanOrEqual(1);
  });

  it('should reset eviction counter on clear', () => {
    const cache = new SessionCache({ maxRecords: 1 });
    cache.setRecord('A', '1', {}, 'e');
    cache.setRecord('A', '2', {}, 'e');
    expect(cache.getStats().evictions).toBeGreaterThan(0);
    cache.clear();
    expect(cache.getStats().evictions).toBe(0);
  });

  it('should evict across tiers based on LRU', () => {
    const cache = new SessionCache({ maxRecords: 2 });

    // Insert a query, then a record — query is older
    cache.setQuery('q1', { result: true });

    // Small delay to ensure different timestamps
    const originalNow = Date.now;
    let time = originalNow();
    Date.now = () => ++time;

    cache.setRecord('A', '1', { name: 'keep' }, 'e');

    // Adding a third entry should evict the oldest (query)
    cache.setMetadata('M', { desc: true });

    expect(cache.getQuery('q1')).toBeUndefined(); // evicted
    expect(cache.getRecord('A', '1')).toBeDefined(); // kept

    Date.now = originalNow;
  });
});

// ---------------------------------------------------------------------------
// SessionCache — Constructor options
// ---------------------------------------------------------------------------

describe('SessionCache — Constructor options', () => {
  it('should accept custom configuration', () => {
    const opts: CacheOptions = {
      maxRecords: 100,
      maxBytes: 1024,
      metadataTtlMs: 1000,
      queryTtlMs: 500,
    };
    const cache = new SessionCache(opts);
    // Should not throw
    expect(cache.getStats().totalCount).toBe(0);
  });

  it('should use defaults when no options provided', () => {
    const cache = new SessionCache();
    // Defaults: 500 records, 10MB — fill a few entries, no eviction
    for (let i = 0; i < 10; i++) {
      cache.setRecord('T', String(i), { i }, `e${i}`);
    }
    expect(cache.getStats().totalCount).toBe(10);
    expect(cache.getStats().evictions).toBe(0);
  });
});
