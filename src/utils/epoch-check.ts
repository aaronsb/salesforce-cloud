/**
 * Epoch-based record staleness check (ADR-102).
 *
 * Performs lightweight SystemModstamp queries to detect which cached
 * records have changed, without refetching full record data.
 */

import { SalesforceClient } from '../client/salesforce-client.js';
import { SessionCache } from './session-cache.js';
import { formatCacheStub, formatDeltaHint } from './cache-utils.js';

interface EpochResult {
  id: string;
  status: 'unchanged' | 'changed' | 'deleted';
  text: string;
  record?: Record<string, unknown>;
}

/**
 * Check a set of record IDs against their cached epochs.
 * Returns a compact stub for unchanged records, a delta hint for changed ones.
 */
export async function checkEpochs(
  client: SalesforceClient,
  cache: SessionCache,
  objectType: string,
  ids: string[],
): Promise<EpochResult[]> {
  if (ids.length === 0) return [];

  // Validate objectType — must be a valid Salesforce API name
  if (!/^[a-zA-Z_]\w*$/.test(objectType)) {
    throw new Error(`Invalid object type: "${objectType}"`);
  }

  // Validate IDs — Salesforce IDs are 15 or 18 char alphanumeric
  const validIds = ids.filter(id => /^[a-zA-Z0-9]{15,18}$/.test(id));
  if (validIds.length === 0) return [];

  // Fetch current SystemModstamp for all IDs in one lightweight query
  const idList = validIds.map(id => `'${id}'`).join(',');
  const query = `SELECT Id, Name, SystemModstamp FROM ${objectType} WHERE Id IN (${idList})`;

  let freshRecords: Array<Record<string, unknown>>;
  try {
    const result = await client.executeQuery(query);
    freshRecords = (result.results || []) as Array<Record<string, unknown>>;
  } catch {
    // If query fails, treat all as stale (force refetch)
    return ids.map(id => ({
      id,
      status: 'changed' as const,
      text: `⚡ ${objectType} ${id} — cache check failed, refetching`,
    }));
  }

  const freshById = new Map<string, Record<string, unknown>>();
  for (const rec of freshRecords) {
    freshById.set(rec.Id as string, rec);
  }

  const results: EpochResult[] = [];

  for (const id of ids) {
    const fresh = freshById.get(id);

    if (!fresh) {
      // Record no longer exists
      cache.tombstone(objectType, id);
      results.push({
        id,
        status: 'deleted',
        text: `🗑 ${objectType} ${id} — deleted`,
      });
      continue;
    }

    const freshEpoch = fresh.SystemModstamp as string;
    const cachedEpoch = cache.getRecordEpoch(objectType, id);

    if (cachedEpoch && cachedEpoch === freshEpoch) {
      // Unchanged — return compact stub
      const name = (fresh.Name as string) || id;
      results.push({
        id,
        status: 'unchanged',
        text: formatCacheStub(objectType, id, name, freshEpoch),
      });
    } else {
      // Changed or not cached — return delta hint if we have old data
      const cachedData = cache.getRecord(objectType, id) as Record<string, unknown> | undefined;
      const name = (fresh.Name as string) || id;

      if (cachedData) {
        results.push({
          id,
          status: 'changed',
          text: formatDeltaHint(objectType, id, name, cachedData, fresh),
          record: fresh,
        });
      } else {
        results.push({
          id,
          status: 'changed',
          text: `⚡ ${objectType} ${id} (${name}) — new to cache`,
          record: fresh,
        });
      }

      // Update cache with fresh epoch
      cache.setRecord(objectType, id, fresh, freshEpoch);
    }
  }

  return results;
}

/**
 * Render epoch check results as a compact markdown summary.
 */
export function renderEpochResults(results: EpochResult[]): string {
  if (results.length === 0) return 'No records to check.';

  const unchanged = results.filter(r => r.status === 'unchanged');
  const changed = results.filter(r => r.status === 'changed');
  const deleted = results.filter(r => r.status === 'deleted');

  const lines: string[] = [];

  if (changed.length > 0) {
    lines.push(`## Changed (${changed.length})`);
    for (const r of changed) lines.push(r.text);
    lines.push('');
  }

  if (unchanged.length > 0) {
    lines.push(`## Unchanged (${unchanged.length})`);
    for (const r of unchanged) lines.push(r.text);
    lines.push('');
  }

  if (deleted.length > 0) {
    lines.push(`## Deleted (${deleted.length})`);
    for (const r of deleted) lines.push(r.text);
  }

  return lines.join('\n');
}
