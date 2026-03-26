// Mock the backoff constants to avoid real delays in tests
jest.mock('../utils/discovery-constants.js', () => ({
  BACKOFF: {
    initialDelayMs: 1,
    multiplier: 1,
    maxDelayMs: 5,
    maxRetries: 2,
    jitter: 0,
  },
}));

import { withRetry, parallelLimit } from '../utils/rate-limited-executor.js';

describe('withRetry', () => {
  it('should return result on first success', async () => {
    const result = await withRetry(() => Promise.resolve(42), 'test');
    expect(result).toBe(42);
  });

  it('should retry on rate limit error', async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 2) {
        const err: any = new Error('rate limited');
        err.statusCode = 429;
        return Promise.reject(err);
      }
      return Promise.resolve('ok');
    };
    const result = await withRetry(fn, 'test');
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('should throw non-rate-limit errors immediately', async () => {
    const fn = () => Promise.reject(new Error('bad query'));
    await expect(withRetry(fn, 'test')).rejects.toThrow('bad query');
  });

  it('should throw after exhausting retries', async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      const err: any = new Error('rate limited');
      err.statusCode = 429;
      return Promise.reject(err);
    };
    await expect(withRetry(fn, 'test')).rejects.toThrow();
    expect(attempts).toBe(3); // initial + 2 retries
  });
});

describe('parallelLimit', () => {
  it('should execute all tasks', async () => {
    const tasks = [1, 2, 3].map(n => () => Promise.resolve(n));
    const results = await parallelLimit(tasks, 2);
    expect(results).toEqual([1, 2, 3]);
  });

  it('should respect concurrency limit', async () => {
    let maxConcurrent = 0;
    let current = 0;

    const tasks = Array.from({ length: 10 }, () => async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise(r => setTimeout(r, 10));
      current--;
      return true;
    });

    await parallelLimit(tasks, 3);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  it('should handle empty task list', async () => {
    const results = await parallelLimit([], 5);
    expect(results).toEqual([]);
  });

  it('should preserve order', async () => {
    const tasks = [30, 10, 20].map(delay => async () => {
      await new Promise(r => setTimeout(r, delay));
      return delay;
    });
    const results = await parallelLimit(tasks, 3);
    expect(results).toEqual([30, 10, 20]);
  });
});
