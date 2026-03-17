import {
  resolveRefs,
  resolveArgsRefs,
  preScanBatch,
  RateLimiter,
  renderBatchResults,
} from '../utils/batch-executor';
import type { OperationResult, BatchOperation } from '../utils/batch-executor';

describe('batch-executor', () => {
  describe('resolveRefs', () => {
    const results: OperationResult[] = [
      { index: 0, tool: 'create_record', status: 'success', text: 'Created Account record: 001ABC123456789' },
      { index: 1, tool: 'create_record', status: 'success', text: 'Created Contact record: 003DEF456789012' },
    ];

    it('should resolve $N.id references', () => {
      expect(resolveRefs('$0.id', results)).toBe('001ABC123456789');
      expect(resolveRefs('$1.id', results)).toBe('003DEF456789012');
    });

    it('should resolve $N.objectName references', () => {
      expect(resolveRefs('$0.objectName', results)).toBe('Account');
    });

    it('should resolve multiple references in one string', () => {
      expect(resolveRefs('Account $0.id has Contact $1.id', results))
        .toBe('Account 001ABC123456789 has Contact 003DEF456789012');
    });

    it('should throw for out-of-bounds reference', () => {
      expect(() => resolveRefs('$5.id', results)).toThrow(/has not executed/);
    });

    it('should throw for reference to failed operation', () => {
      const failedResults: OperationResult[] = [
        { index: 0, tool: 'create_record', status: 'error', text: 'Error: failed' },
      ];
      expect(() => resolveRefs('$0.id', failedResults)).toThrow(/error/);
    });
  });

  describe('resolveArgsRefs', () => {
    const results: OperationResult[] = [
      { index: 0, tool: 'create_record', status: 'success', text: 'Created Account record: 001ABC123456789' },
    ];

    it('should resolve refs in string values', () => {
      const args = { AccountId: '$0.id', Name: 'Test' };
      const resolved = resolveArgsRefs(args, results);
      expect(resolved.AccountId).toBe('001ABC123456789');
      expect(resolved.Name).toBe('Test');
    });

    it('should resolve refs in nested objects', () => {
      const args = { data: { AccountId: '$0.id' } };
      const resolved = resolveArgsRefs(args, results);
      expect((resolved.data as Record<string, unknown>).AccountId).toBe('001ABC123456789');
    });

    it('should pass through non-string values unchanged', () => {
      const args = { amount: 100, active: true };
      const resolved = resolveArgsRefs(args, results);
      expect(resolved.amount).toBe(100);
      expect(resolved.active).toBe(true);
    });
  });

  describe('preScanBatch', () => {
    it('should pass clean batch', () => {
      const ops: BatchOperation[] = [
        { tool: 'create_record', args: {} },
        { tool: 'update_record', args: {} },
      ];
      expect(preScanBatch(ops).ok).toBe(true);
    });

    it('should reject batch exceeding max operations', () => {
      const ops: BatchOperation[] = Array.from({ length: 17 }, () => ({ tool: 'create_record', args: {} }));
      const result = preScanBatch(ops);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('max operations');
    });

    it('should reject unconfirmed deletes', () => {
      const ops: BatchOperation[] = [
        { tool: 'delete_record', args: { objectName: 'Account', recordId: '001' } },
      ];
      const result = preScanBatch(ops);
      expect(result.ok).toBe(false);
      expect(result.unconfirmedDeletes).toEqual([0]);
    });

    it('should pass confirmed deletes', () => {
      const ops: BatchOperation[] = [
        { tool: 'delete_record', args: {}, confirm: true },
      ];
      expect(preScanBatch(ops).ok).toBe(true);
    });

    it('should reject more than 3 deletes', () => {
      const ops: BatchOperation[] = Array.from({ length: 4 }, () => ({
        tool: 'delete_record', args: {}, confirm: true,
      }));
      const result = preScanBatch(ops);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Max 3 delete');
    });

    it('should allow many updates (warning only, not blocking)', () => {
      const ops: BatchOperation[] = Array.from({ length: 6 }, () => ({
        tool: 'update_record', args: {},
      }));
      const result = preScanBatch(ops);
      expect(result.ok).toBe(true);
    });

    it('should reject forward references in pre-scan', () => {
      const ops: BatchOperation[] = [
        { tool: 'create_record', args: { AccountId: '$1.id' } },
        { tool: 'create_record', args: {} },
      ];
      const result = preScanBatch(ops);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('has not executed yet');
    });
  });

  describe('RateLimiter', () => {
    it('should allow operations within limits', () => {
      const limiter = new RateLimiter();
      const ops: BatchOperation[] = [
        { tool: 'delete_record', args: {}, confirm: true },
      ];
      expect(limiter.check(ops).ok).toBe(true);
    });

    it('should reject when delete limit exceeded', () => {
      const limiter = new RateLimiter();
      // Fill up the window
      const tenDeletes: BatchOperation[] = Array.from({ length: 10 }, () => ({
        tool: 'delete_record', args: {}, confirm: true,
      }));
      limiter.record(tenDeletes);

      // One more should fail
      const oneMore: BatchOperation[] = [{ tool: 'delete_record', args: {}, confirm: true }];
      const result = limiter.check(oneMore);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Delete rate limit');
    });

    it('should allow creates without affecting limits', () => {
      const limiter = new RateLimiter();
      const creates: BatchOperation[] = Array.from({ length: 100 }, () => ({
        tool: 'create_record', args: {},
      }));
      expect(limiter.check(creates).ok).toBe(true);
    });
  });

  describe('renderBatchResults', () => {
    const results: OperationResult[] = [
      { index: 0, tool: 'create_record', status: 'success', text: 'Created Account: 001ABC' },
      { index: 1, tool: 'update_record', status: 'error', text: 'Error: not found' },
      { index: 2, tool: 'create_record', status: 'skipped', text: 'Skipped due to prior failure' },
    ];

    it('should render summary mode', () => {
      const text = renderBatchResults(results, 'summary');
      expect(text).toContain('1 succeeded');
      expect(text).toContain('1 failed');
      expect(text).toContain('1 skipped');
      expect(text).toContain('[x] [0] create_record: success');
      expect(text).toContain('[!] [1] update_record: error');
    });

    it('should render full mode with result text', () => {
      const text = renderBatchResults(results, 'full');
      expect(text).toContain('Created Account: 001ABC');
      expect(text).toContain('Error: not found');
    });
  });
});
