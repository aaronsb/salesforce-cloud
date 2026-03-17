import { createHash } from 'crypto';

/**
 * Generate a deterministic fingerprint for a SOQL query string.
 * Normalizes whitespace so semantically identical queries share a cache key.
 */
export function queryFingerprint(query: string): string {
  const normalized = query.trim().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Estimate the byte size of an object by measuring its JSON serialization.
 * Returns 0 for values that cannot be serialized.
 */
export function estimateSize(obj: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(obj), 'utf8');
  } catch {
    return 0;
  }
}

/**
 * Format a compact cache-hit stub for an unchanged record.
 *
 * Example output:
 *   ↩ Opportunity 006ABC (Acme Cloud Migration) — unchanged since 2026-03-16T14:32:00Z
 */
export function formatCacheStub(
  objectType: string,
  id: string,
  name: string | undefined,
  epoch: string
): string {
  const nameSegment = name ? ` (${name})` : '';
  return `↩ ${objectType} ${id}${nameSegment} — unchanged since ${epoch}`;
}

/**
 * Format a delta hint showing which fields changed between two record snapshots.
 *
 * Example output:
 *   ⚡ Opportunity 006ABC updated (Stage: Proposal → Negotiation, Amount: $250K → $275K)
 */
export function formatDeltaHint(
  objectType: string,
  id: string,
  name: string | undefined,
  oldRecord: Record<string, unknown>,
  newRecord: Record<string, unknown>
): string {
  const diffs: string[] = [];

  for (const key of Object.keys(newRecord)) {
    // Skip internal / meta fields
    if (key === 'attributes' || key === 'SystemModstamp') continue;

    const oldVal = oldRecord[key];
    const newVal = newRecord[key];

    if (oldVal !== undefined && oldVal !== newVal) {
      diffs.push(`${key}: ${String(oldVal)} → ${String(newVal)}`);
    }
  }

  const nameSegment = name ? ` (${name})` : '';
  const diffSegment = diffs.length > 0 ? ` (${diffs.join(', ')})` : '';
  return `⚡ ${objectType} ${id}${nameSegment} updated${diffSegment}`;
}
