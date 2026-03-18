/// <reference types="jest" />

import {
  opportunityResponse,
  listResponse,
  queryResponse,
  recordResponse,
  simpleResponse,
} from '../utils/response-helper';

describe('response-helper', () => {
  describe('simpleResponse', () => {
    it('should return text content with next steps', () => {
      const result = simpleResponse('Created Account record: 001ABC', 'create_record', {
        id: '001ABC',
        objectName: 'Account',
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Created Account record: 001ABC');
    });

    it('should work without result metadata', () => {
      const result = simpleResponse('Done', 'list_objects');
      expect(result.content[0].text).toContain('Done');
    });
  });

  describe('opportunityResponse', () => {
    const opp = {
      Id: '006ABC',
      Name: 'Test Deal',
      Amount: 50000,
      StageName: 'Proposal',
      CloseDate: '2026-04-15',
      'Account.Name': 'Acme Corp',
    } as Record<string, unknown>;

    it('should render opportunity in full detail', () => {
      const result = opportunityResponse(opp, 'get_opportunity_details', 'full');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Test Deal');
    });

    it('should render opportunity in summary detail', () => {
      const result = opportunityResponse(opp, 'get_opportunity_details', 'summary');
      expect(result.content[0].text).toContain('Test Deal');
    });

    it('should include next steps', () => {
      const result = opportunityResponse(opp, 'get_opportunity_details', 'full');
      expect(result.content[0].text).toContain('Next steps');
    });
  });

  describe('listResponse', () => {
    const records = [
      { Id: '006A', Name: 'Deal A', Amount: 10000, StageName: 'Proposal' },
      { Id: '006B', Name: 'Deal B', Amount: 20000, StageName: 'Closed Won' },
    ] as Record<string, unknown>[];

    const pagination = {
      currentPage: 1,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
      totalSize: 50,
    };

    it('should render list with pagination info', () => {
      const result = listResponse('Opportunity', records, pagination, 'search_opportunities', 'summary');
      expect(result.content[0].text).toContain('Deal A');
    });

    it('should handle empty results', () => {
      const result = listResponse('Opportunity', [], { ...pagination, totalSize: 0 }, 'search_opportunities');
      expect(result.content).toHaveLength(1);
    });
  });

  describe('queryResponse', () => {
    it('should render query results', () => {
      const queryResult = {
        results: [
          { Id: '001A', Name: 'Test Account' },
        ],
        totalCount: 1,
        pageNumber: 1,
        totalPages: 1,
      };

      const result = queryResponse(queryResult, 'execute_soql', 'summary');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
    });
  });

  describe('recordResponse', () => {
    it('should render a single record', () => {
      const record = { Id: '001ABC', Name: 'Test', Industry: 'Tech' };
      const result = recordResponse('Account', record, 'describe_object', 'full');
      expect(result.content[0].text).toContain('Test');
    });
  });
});
