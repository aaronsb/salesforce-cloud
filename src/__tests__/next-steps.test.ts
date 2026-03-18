/// <reference types="jest" />

import { getNextSteps } from '../utils/next-steps';

describe('getNextSteps', () => {
  // ---- Opportunity tools ----

  describe('search_opportunities', () => {
    it('should suggest drill-down tools after search', () => {
      const result = getNextSteps('search_opportunities');
      expect(result).toContain('Next steps:');
      expect(result).toContain('`get_opportunity_details`');
      expect(result).toContain('`analyze_conversation`');
      expect(result).toContain('`find_similar_opportunities`');
      expect(result).toContain('`execute_soql`');
    });
  });

  describe('get_opportunity_details', () => {
    it('should suggest analysis and enrichment tools', () => {
      const result = getNextSteps('get_opportunity_details', { id: '006ABC' });
      expect(result).toContain('`analyze_conversation`');
      expect(result).toContain('`enrich_opportunity`');
      expect(result).toContain('`find_similar_opportunities`');
      expect(result).toContain('`generate_business_case`');
      expect(result).toContain('`update_record`');
      expect(result).toContain('006ABC');
    });

    it('should use placeholder when no result ID is provided', () => {
      const result = getNextSteps('get_opportunity_details');
      expect(result).toContain('<id>');
    });
  });

  describe('analyze_conversation', () => {
    it('should suggest follow-up actions', () => {
      const result = getNextSteps('analyze_conversation', { opportunityId: '006XYZ' });
      expect(result).toContain('`get_opportunity_details`');
      expect(result).toContain('`enrich_opportunity`');
      expect(result).toContain('`generate_business_case`');
      expect(result).toContain('006XYZ');
    });
  });

  describe('generate_business_case', () => {
    it('should suggest viewing and comparing', () => {
      const result = getNextSteps('generate_business_case');
      expect(result).toContain('`get_opportunity_details`');
      expect(result).toContain('`find_similar_opportunities`');
    });
  });

  describe('enrich_opportunity', () => {
    it('should suggest viewing enriched data and next actions', () => {
      const result = getNextSteps('enrich_opportunity');
      expect(result).toContain('`get_opportunity_details`');
      expect(result).toContain('`generate_business_case`');
      expect(result).toContain('`find_similar_opportunities`');
    });
  });

  describe('find_similar_opportunities', () => {
    it('should suggest drill-down and insights', () => {
      const result = getNextSteps('find_similar_opportunities');
      expect(result).toContain('`get_opportunity_details`');
      expect(result).toContain('`opportunity_insights`');
      expect(result).toContain('`search_opportunities`');
    });
  });

  describe('opportunity_insights', () => {
    it('should suggest search and query tools', () => {
      const result = getNextSteps('opportunity_insights');
      expect(result).toContain('`search_opportunities`');
      expect(result).toContain('`find_similar_opportunities`');
      expect(result).toContain('`execute_soql`');
    });
  });

  // ---- SOQL and generic tools ----

  describe('execute_soql', () => {
    it('should suggest discovery and CRUD tools', () => {
      const result = getNextSteps('execute_soql');
      expect(result).toContain('`describe_object`');
      expect(result).toContain('`get_opportunity_details`');
      expect(result).toContain('`create_record`');
    });
  });

  describe('describe_object', () => {
    it('should suggest querying and creating records', () => {
      const result = getNextSteps('describe_object', { objectName: 'Account' });
      expect(result).toContain('`execute_soql`');
      expect(result).toContain('`create_record`');
      expect(result).toContain('`list_objects`');
      expect(result).toContain('Account');
    });
  });

  describe('list_objects', () => {
    it('should suggest describe and query', () => {
      const result = getNextSteps('list_objects');
      expect(result).toContain('`describe_object`');
      expect(result).toContain('`execute_soql`');
    });
  });

  describe('create_record', () => {
    it('should suggest viewing and updating the created record', () => {
      const result = getNextSteps('create_record', { objectName: 'Account', id: '001NEW' });
      expect(result).toContain('`execute_soql`');
      expect(result).toContain('`update_record`');
      expect(result).toContain('`describe_object`');
      expect(result).toContain('001NEW');
    });
  });

  describe('update_record', () => {
    it('should suggest viewing and describing', () => {
      const result = getNextSteps('update_record', { objectName: 'Contact', id: '003UPD' });
      expect(result).toContain('`execute_soql`');
      expect(result).toContain('`describe_object`');
      expect(result).toContain('003UPD');
    });
  });

  describe('delete_record', () => {
    it('should suggest search and list tools', () => {
      const result = getNextSteps('delete_record');
      expect(result).toContain('`execute_soql`');
      expect(result).toContain('`list_objects`');
    });
  });

  describe('get_user_info', () => {
    it('should suggest exploration tools', () => {
      const result = getNextSteps('get_user_info');
      expect(result).toContain('`list_objects`');
      expect(result).toContain('`search_opportunities`');
      expect(result).toContain('`execute_soql`');
    });
  });

  // ---- Edge cases ----

  describe('unknown tool', () => {
    it('should return empty string for unrecognized tools', () => {
      const result = getNextSteps('nonexistent_tool');
      expect(result).toBe('');
    });
  });

  describe('format', () => {
    it('should start with a horizontal rule and Next steps heading', () => {
      const result = getNextSteps('list_objects');
      expect(result).toMatch(/^[\n\s]*---/);
      expect(result).toContain('Next steps:');
    });

    it('should format each step as a markdown list item', () => {
      const result = getNextSteps('list_objects');
      const listItems = result.split('\n').filter(line => line.startsWith('- '));
      expect(listItems.length).toBeGreaterThan(0);
    });
  });
});
