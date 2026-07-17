/// <reference types="jest" />

import { handleExecuteSOQL } from '../handlers/query-handlers';
import { SalesforceClient } from '../client/salesforce-client';

// Mock SalesforceClient
jest.mock('../client/salesforce-client', () => {
  return {
    SalesforceClient: jest.fn().mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(undefined),
      executeQuery: jest.fn().mockResolvedValue({
        totalCount: 1,
        pageSize: 25,
        pageNumber: 1,
        totalPages: 1,
        results: [{ Id: '001', Name: 'Test Account' }]
      })
    }))
  };
});

describe('Query Handlers', () => {
  beforeEach(() => {
    // Setup test environment variables
    process.env = {
      ...process.env,
      SF_CLIENT_ID: 'test-client-id',
      SF_CLIENT_SECRET: 'test-client-secret',
      SF_USERNAME: 'test@example.com',
      SF_PASSWORD: 'test-password',
      SF_LOGIN_URL: 'https://test.salesforce.com'
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleExecuteSOQL', () => {
    let mockClient: jest.Mocked<SalesforceClient>;

    beforeEach(() => {
      mockClient = new SalesforceClient() as jest.Mocked<SalesforceClient>;
    });

    it('should execute SOQL query successfully', async () => {
      const params = {
        query: 'SELECT Id, Name FROM Account'
      };

      const result = await handleExecuteSOQL(mockClient, params);

      // Response is now markdown (ADR-100) with next-steps appended
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Query Results');
      expect(result.content[0].text).toContain('Test Account');
      expect(result.content[0].text).toContain('Next steps');
    });

    it('should handle invalid parameters', async () => {
      const params = {
        query: undefined
      };

      await expect(handleExecuteSOQL(mockClient, params))
        .rejects
        .toThrow('Invalid query parameters');
    });

    it('should handle query with pagination', async () => {
      const params = {
        query: 'SELECT Id FROM Account',
        pageSize: 10,
        pageNumber: 2
      };

      await handleExecuteSOQL(mockClient, params);

      expect(mockClient.executeQuery).toHaveBeenCalledWith(
        'SELECT Id FROM Account',
        { pageSize: 10, pageNumber: 2 }
      );
    });

    // ADR-300: the ranked catalog rides along with the result so the agent can
    // write its next query without a describe_object round-trip.
    describe('field hints', () => {
      const catalogSource = {
        getCatalog: (name: string) => name === 'Account' ? {
          objectName: 'Account',
          fields: [],
          promoted: [{
            field: {
              name: 'Industry', label: 'Industry', type: 'string', custom: false,
              helpText: null, nillable: true, computationType: 'text' as const,
            },
            score: 90, adjustments: [], promoted: true,
          }],
          wellKnown: new Map(),
          describeMs: 1, scoringMs: 1, totalFields: 87, totalRecords: 100, sampledRecords: 100,
        } : undefined,
      };

      it('appends the ranked fields for the queried object', async () => {
        const result = await handleExecuteSOQL(
          mockClient, { query: 'SELECT Id FROM Account' }, undefined, catalogSource,
        );

        expect(result.content[0].text).toContain('Account — most-populated fields on this org (1 of 87)');
        expect(result.content[0].text).toContain('Industry');
        expect(result.content[0].text).toContain('salesforce://field-catalog/Account/all');
      });

      it('omits hints for an object that has not been discovered', async () => {
        const result = await handleExecuteSOQL(
          mockClient, { query: 'SELECT Id FROM Unknown__c' }, undefined, catalogSource,
        );

        expect(result.content[0].text).not.toContain('most-populated fields');
      });

      it('works without a catalog source at all', async () => {
        const result = await handleExecuteSOQL(mockClient, { query: 'SELECT Id FROM Account' });

        expect(result.content[0].text).toContain('Query Results');
        expect(result.content[0].text).not.toContain('most-populated fields');
      });
    });
  });
});
