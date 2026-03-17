/**
 * Batch operation executor with result references (ADR-104).
 *
 * Executes up to 16 sequential operations with $N.field references
 * that extract values from prior results. Includes destructive
 * operation pre-scan and sliding-window rate limiting.
 */

const MAX_OPERATIONS = 16;
const DELETE_WINDOW_LIMIT = 10;
const UPDATE_WINDOW_LIMIT = 50;
const WINDOW_MS = 60_000;

export interface BatchOperation {
  tool: string;
  args: Record<string, unknown>;
  confirm?: boolean;
}

export interface BatchRequest {
  operations: BatchOperation[];
  onError?: 'bail' | 'continue';
  detail?: 'summary' | 'full';
}

export interface OperationResult {
  index: number;
  tool: string;
  status: 'success' | 'error' | 'skipped';
  text: string;
}

// ---------------------------------------------------------------------------
// Result reference resolution
// ---------------------------------------------------------------------------

const REF_PATTERN = /\$(\d+)\.(\w+)/g;

/**
 * Resolve $N.field references in a value string against prior results.
 */
export function resolveRefs(value: string, results: OperationResult[]): string {
  return value.replace(REF_PATTERN, (_match, indexStr, field) => {
    const index = parseInt(indexStr, 10);
    if (index >= results.length) {
      throw new Error(`Reference $${index}.${field}: operation ${index} has not executed yet.`);
    }
    const result = results[index];
    if (result.status !== 'success') {
      throw new Error(`Reference $${index}.${field}: operation ${index} ${result.status}.`);
    }
    const extracted = extractField(result.text, field);
    if (!extracted) {
      throw new Error(`Reference $${index}.${field}: field "${field}" not found in result.`);
    }
    return extracted;
  });
}

/**
 * Extract a field value from an operation result text.
 * Supports: id, key, recordId, objectName, success
 */
function extractField(text: string, field: string): string | undefined {
  // Try to find patterns like "record: <id>" or "Created <type> record: <id>"
  if (field === 'id' || field === 'recordId') {
    // Match Salesforce-style IDs (15 or 18 char alphanumeric)
    const idMatch = text.match(/:\s*([a-zA-Z0-9]{15,18})\b/);
    if (idMatch) return idMatch[1];
    // Fallback: any word after "record:"
    const fallback = text.match(/record:\s*(\S+)/);
    if (fallback) return fallback[1];
  }
  if (field === 'objectName') {
    const match = text.match(/(Created|Updated|Deleted)\s+(\w+)\s+record/);
    if (match) return match[2];
  }
  if (field === 'success') {
    return text.includes('Error') ? 'false' : 'true';
  }
  return undefined;
}

/**
 * Resolve all $N.field references in an args object (recursively for string values).
 */
export function resolveArgsRefs(
  args: Record<string, unknown>,
  results: OperationResult[],
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.includes('$')) {
      resolved[key] = resolveRefs(value, results);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      resolved[key] = resolveArgsRefs(value as Record<string, unknown>, results);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Destructive operation pre-scan
// ---------------------------------------------------------------------------

const DESTRUCTIVE_TOOLS = new Set(['delete_record']);
const MUTATIVE_TOOLS = new Set(['update_record']);

export interface PreScanResult {
  ok: boolean;
  message?: string;
  unconfirmedDeletes: number[];
}

/**
 * Pre-scan a batch for destructive operations.
 * Returns an error if deletes lack confirm:true or exceed limits.
 */
export function preScanBatch(operations: BatchOperation[]): PreScanResult {
  if (operations.length > MAX_OPERATIONS) {
    return {
      ok: false,
      message: `Batch exceeds max operations (${MAX_OPERATIONS}). Got ${operations.length}.`,
      unconfirmedDeletes: [],
    };
  }

  const unconfirmedDeletes: number[] = [];
  let deleteCount = 0;

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (DESTRUCTIVE_TOOLS.has(op.tool)) {
      deleteCount++;
      if (!op.confirm) {
        unconfirmedDeletes.push(i);
      }
    }
  }

  if (unconfirmedDeletes.length > 0) {
    return {
      ok: false,
      message: `Destructive operations at positions [${unconfirmedDeletes.join(', ')}] require confirm: true.`,
      unconfirmedDeletes,
    };
  }

  if (deleteCount > 3) {
    return {
      ok: false,
      message: `Max 3 delete operations per batch. Got ${deleteCount}. Use Salesforce Bulk API for large-scale deletions.`,
      unconfirmedDeletes: [],
    };
  }

  // Check for forward references in args (static validation)
  for (let i = 0; i < operations.length; i++) {
    const argsStr = JSON.stringify(operations[i].args);
    const refs = argsStr.matchAll(/\$(\d+)\.\w+/g);
    for (const match of refs) {
      const refIndex = parseInt(match[1], 10);
      if (refIndex >= i) {
        return {
          ok: false,
          message: `Operation ${i} references $${refIndex} which has not executed yet. References must point backwards.`,
          unconfirmedDeletes: [],
        };
      }
    }
  }

  return { ok: true, unconfirmedDeletes: [] };
}

// ---------------------------------------------------------------------------
// Sliding-window rate limiter
// ---------------------------------------------------------------------------

export class RateLimiter {
  private deleteTimestamps: number[] = [];
  private updateTimestamps: number[] = [];

  /** Check if a batch of operations would exceed rate limits. */
  check(operations: BatchOperation[]): { ok: boolean; message?: string } {
    const now = Date.now();
    this.prune(now);

    const newDeletes = operations.filter(op => DESTRUCTIVE_TOOLS.has(op.tool)).length;
    const newUpdates = operations.filter(op => MUTATIVE_TOOLS.has(op.tool)).length;

    if (this.deleteTimestamps.length + newDeletes > DELETE_WINDOW_LIMIT) {
      const resetIn = Math.ceil((this.deleteTimestamps[0] + WINDOW_MS - now) / 1000);
      return {
        ok: false,
        message: `Delete rate limit: max ${DELETE_WINDOW_LIMIT} per 60s. Resets in ~${resetIn}s.`,
      };
    }

    if (this.updateTimestamps.length + newUpdates > UPDATE_WINDOW_LIMIT) {
      const resetIn = Math.ceil((this.updateTimestamps[0] + WINDOW_MS - now) / 1000);
      return {
        ok: false,
        message: `Update rate limit: max ${UPDATE_WINDOW_LIMIT} per 60s. Resets in ~${resetIn}s.`,
      };
    }

    return { ok: true };
  }

  /** Record that operations were executed. */
  record(operations: BatchOperation[]): void {
    const now = Date.now();
    for (const op of operations) {
      if (DESTRUCTIVE_TOOLS.has(op.tool)) this.deleteTimestamps.push(now);
      if (MUTATIVE_TOOLS.has(op.tool)) this.updateTimestamps.push(now);
    }
  }

  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    this.deleteTimestamps = this.deleteTimestamps.filter(t => t > cutoff);
    this.updateTimestamps = this.updateTimestamps.filter(t => t > cutoff);
  }
}

// ---------------------------------------------------------------------------
// Batch result rendering
// ---------------------------------------------------------------------------

export function renderBatchResults(results: OperationResult[], detail: 'summary' | 'full'): string {
  const lines: string[] = [`## Batch Results (${results.length} operations)`];
  const succeeded = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'error').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  lines.push(`${succeeded} succeeded | ${failed} failed | ${skipped} skipped`);
  lines.push('');

  for (const r of results) {
    const icon = r.status === 'success' ? '[x]' : r.status === 'error' ? '[!]' : '[-]';
    if (detail === 'summary') {
      lines.push(`${icon} [${r.index}] ${r.tool}: ${r.status}`);
    } else {
      lines.push(`${icon} [${r.index}] ${r.tool}: ${r.text}`);
    }
  }

  return lines.join('\n');
}
