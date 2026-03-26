/**
 * Rate-limited concurrent executor with exponential backoff.
 *
 * Prevents thundering herd on Salesforce API during field discovery.
 * Respects a concurrency limit and backs off on 429 responses.
 *
 * See ADR-300 for design context.
 */

import { BACKOFF } from './discovery-constants.js';

function isRateLimited(err: unknown): boolean {
  const e = err as { statusCode?: number; errorCode?: string; message?: string };
  if (e?.statusCode === 429) return true;
  if (e?.errorCode === 'REQUEST_LIMIT_EXCEEDED') return true;
  if (typeof e?.message === 'string' && e.message.includes('REQUEST_LIMIT_EXCEEDED')) return true;
  return false;
}

function calculateDelay(attempt: number): number {
  const base = BACKOFF.initialDelayMs * Math.pow(BACKOFF.multiplier, attempt);
  const capped = Math.min(base, BACKOFF.maxDelayMs);
  const jitterRange = capped * BACKOFF.jitter;
  return capped + (Math.random() * 2 - 1) * jitterRange;
}

/**
 * Execute a function with retry on Salesforce rate limiting (429).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  for (let attempt = 0; attempt <= BACKOFF.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isRateLimited(err) && attempt < BACKOFF.maxRetries) {
        const delay = calculateDelay(attempt);
        console.error(`  [429] ${label} — retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${BACKOFF.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  // TypeScript: unreachable, but satisfies the compiler
  throw new Error(`${label}: exhausted retries`);
}

/**
 * Run async tasks with bounded concurrency.
 *
 * Unlike Promise.all which fires everything at once, this maintains
 * at most `concurrency` in-flight tasks at any time.
 */
export async function parallelLimit<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
