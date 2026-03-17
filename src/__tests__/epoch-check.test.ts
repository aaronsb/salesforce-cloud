import { checkEpochs, renderEpochResults } from '../utils/epoch-check';
import { SessionCache } from '../utils/session-cache';

// Mock SalesforceClient
const mockClient = {
  executeQuery: jest.fn(),
} as any;

describe('epoch-check', () => {
  let cache: SessionCache;

  beforeEach(() => {
    cache = new SessionCache();
    jest.clearAllMocks();
  });

  describe('checkEpochs', () => {
    it('should return unchanged for records with matching epoch', async () => {
      const epoch = '2026-03-16T14:00:00Z';
      cache.setRecord('Opportunity', '006A', { Name: 'Deal A' }, epoch);

      mockClient.executeQuery.mockResolvedValue({
        results: [{ Id: '006A', Name: 'Deal A', SystemModstamp: epoch }],
      });

      const results = await checkEpochs(mockClient, cache, 'Opportunity', ['006A']);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('unchanged');
      expect(results[0].text).toContain('unchanged');
    });

    it('should return changed for records with different epoch', async () => {
      cache.setRecord('Opportunity', '006A', { Name: 'Deal A', StageName: 'Proposal' }, '2026-03-16T14:00:00Z');

      mockClient.executeQuery.mockResolvedValue({
        results: [{ Id: '006A', Name: 'Deal A', StageName: 'Negotiation', SystemModstamp: '2026-03-16T15:00:00Z' }],
      });

      const results = await checkEpochs(mockClient, cache, 'Opportunity', ['006A']);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('changed');
    });

    it('should return deleted for records not in query results', async () => {
      cache.setRecord('Opportunity', '006A', { Name: 'Deal A' }, '2026-03-16T14:00:00Z');

      mockClient.executeQuery.mockResolvedValue({ results: [] });

      const results = await checkEpochs(mockClient, cache, 'Opportunity', ['006A']);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('deleted');
      expect(results[0].text).toContain('deleted');
    });

    it('should return new-to-cache for uncached records', async () => {
      mockClient.executeQuery.mockResolvedValue({
        results: [{ Id: '006B', Name: 'New Deal', SystemModstamp: '2026-03-16T15:00:00Z' }],
      });

      const results = await checkEpochs(mockClient, cache, 'Opportunity', ['006B']);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('changed');
      expect(results[0].text).toContain('new to cache');
    });

    it('should handle multiple records in one call', async () => {
      cache.setRecord('Account', 'A1', { Name: 'Acme' }, 'epoch1');
      cache.setRecord('Account', 'A2', { Name: 'Beta' }, 'epoch2');

      mockClient.executeQuery.mockResolvedValue({
        results: [
          { Id: 'A1', Name: 'Acme', SystemModstamp: 'epoch1' }, // unchanged
          { Id: 'A2', Name: 'Beta Corp', SystemModstamp: 'epoch3' }, // changed
        ],
      });

      const results = await checkEpochs(mockClient, cache, 'Account', ['A1', 'A2']);
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('unchanged');
      expect(results[1].status).toBe('changed');
    });

    it('should return empty array for empty id list', async () => {
      const results = await checkEpochs(mockClient, cache, 'Opportunity', []);
      expect(results).toEqual([]);
      expect(mockClient.executeQuery).not.toHaveBeenCalled();
    });

    it('should handle query failure gracefully', async () => {
      mockClient.executeQuery.mockRejectedValue(new Error('API limit'));

      const results = await checkEpochs(mockClient, cache, 'Opportunity', ['006A']);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('changed');
      expect(results[0].text).toContain('cache check failed');
    });
  });

  describe('renderEpochResults', () => {
    it('should render grouped results', () => {
      const results = [
        { id: '1', status: 'unchanged' as const, text: '↩ unchanged record 1' },
        { id: '2', status: 'changed' as const, text: '⚡ changed record 2' },
        { id: '3', status: 'deleted' as const, text: '🗑 deleted record 3' },
      ];

      const rendered = renderEpochResults(results);
      expect(rendered).toContain('## Changed (1)');
      expect(rendered).toContain('## Unchanged (1)');
      expect(rendered).toContain('## Deleted (1)');
    });

    it('should return message for empty results', () => {
      expect(renderEpochResults([])).toBe('No records to check.');
    });
  });
});
