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
      const queryResult = {
        totalCount: 1,
        pageSize: 25,
        pageNumber: 1,
        totalPages: 1,
        results: [{ Id: '001', Name: 'Test Account' }]
      };

      const params = {
        query: 'SELECT Id, Name FROM Account'
      };

      const result = await handleExecuteSOQL(mockClient, params);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(queryResult, null, 2),
          },
        ],
      });
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
  });
});
