import {
  getFieldsForIntent,
  getDefaultFields,
  filterFieldsByNames,
} from '../utils/field-profiles';
import { buildFieldTypeMap } from '../utils/field-type-map';

// Mock describe result simulating a typical Opportunity object
const mockDescribe = {
  fields: [
    { name: 'Name', type: 'string', label: 'Name' },
    { name: 'Amount', type: 'currency', label: 'Amount' },
    { name: 'StageName', type: 'picklist', label: 'Stage' },
    { name: 'CloseDate', type: 'date', label: 'Close Date' },
    { name: 'Probability', type: 'percent', label: 'Probability' },
    { name: 'IsWon', type: 'boolean', label: 'Won' },
    { name: 'AccountId', type: 'reference', label: 'Account' },
    { name: 'OwnerId', type: 'reference', label: 'Owner' },
    { name: 'Description', type: 'textarea', label: 'Description' },
    { name: 'LastActivityDate', type: 'date', label: 'Last Activity' },
    // Custom fields
    { name: 'Deal_Value__c', type: 'currency', label: 'Deal Value' },
    { name: 'Region__c', type: 'picklist', label: 'Region' },
    { name: 'Renewal_Date__c', type: 'date', label: 'Renewal Date' },
    { name: 'Partner_Id__c', type: 'reference', label: 'Partner' },
  ],
};

describe('field-profiles', () => {
  const fieldMap = buildFieldTypeMap(mockDescribe);

  describe('getFieldsForIntent', () => {
    it('pipeline should include standard pipeline fields', () => {
      const fields = getFieldsForIntent('pipeline', fieldMap);
      expect(fields).toContain('StageName');
      expect(fields).toContain('Amount');
      expect(fields).toContain('CloseDate');
      expect(fields).toContain('Probability');
    });

    it('pipeline should auto-include custom currency fields', () => {
      const fields = getFieldsForIntent('pipeline', fieldMap);
      expect(fields).toContain('Deal_Value__c');
    });

    it('pipeline should not include text fields', () => {
      const fields = getFieldsForIntent('pipeline', fieldMap);
      expect(fields).not.toContain('Description');
    });

    it('engagement should include temporal fields', () => {
      const fields = getFieldsForIntent('engagement', fieldMap);
      expect(fields).toContain('LastActivityDate');
      expect(fields).toContain('Renewal_Date__c');
    });

    it('forecasting should include Amount and Probability', () => {
      const fields = getFieldsForIntent('forecasting', fieldMap);
      expect(fields).toContain('Amount');
      expect(fields).toContain('Probability');
      expect(fields).toContain('Deal_Value__c');
    });

    it('reporting should include all categorical and numeric fields', () => {
      const fields = getFieldsForIntent('reporting', fieldMap);
      expect(fields).toContain('StageName');   // categorical
      expect(fields).toContain('Region__c');   // categorical custom
      expect(fields).toContain('Amount');      // numeric
      expect(fields).toContain('IsWon');       // flag
      expect(fields).not.toContain('Description'); // text — not groupable
    });

    it('contact-mapping should include identifier fields', () => {
      const fields = getFieldsForIntent('contact-mapping', fieldMap);
      expect(fields).toContain('AccountId');
      expect(fields).toContain('OwnerId');
      expect(fields).toContain('Partner_Id__c');
    });

    it('should deduplicate fields', () => {
      const fields = getFieldsForIntent('pipeline', fieldMap);
      const unique = new Set(fields);
      expect(fields.length).toBe(unique.size);
    });

    it('should return only universal fields with empty type map', () => {
      const emptyMap = new Map();
      const fields = getFieldsForIntent('pipeline', emptyMap);
      // With no describe data, only universal fields (Name, Owner.Name, etc.) survive
      expect(fields.length).toBeGreaterThan(0);
      expect(fields).toContain('Name');
    });
  });

  describe('getDefaultFields', () => {
    it('should return Opportunity defaults', () => {
      const fields = getDefaultFields('Opportunity');
      expect(fields).toContain('Name');
      expect(fields).toContain('StageName');
      expect(fields).toContain('Amount');
    });

    it('should return Account defaults', () => {
      const fields = getDefaultFields('Account');
      expect(fields).toContain('Name');
      expect(fields).toContain('Industry');
    });

    it('should return Contact defaults', () => {
      const fields = getDefaultFields('Contact');
      expect(fields).toContain('Name');
      expect(fields).toContain('Email');
    });

    it('should be case-insensitive', () => {
      expect(getDefaultFields('opportunity')).toEqual(getDefaultFields('Opportunity'));
    });

    it('should return generic defaults for unknown objects', () => {
      const fields = getDefaultFields('CustomObject__c');
      expect(fields).toContain('Name');
      expect(fields).toContain('Id');
    });
  });

  describe('filterFieldsByNames', () => {
    it('should keep fields that exist in the type map', () => {
      const result = filterFieldsByNames(fieldMap, ['Amount', 'StageName', 'FakeField']);
      expect(result).toContain('Amount');
      expect(result).toContain('StageName');
      expect(result).not.toContain('FakeField');
    });

    it('should handle relationship traversals via base Id', () => {
      const result = filterFieldsByNames(fieldMap, ['Account.Name', 'Owner.Name']);
      expect(result).toContain('Account.Name');
      expect(result).toContain('Owner.Name');
    });

    it('should pass through universal fields', () => {
      const result = filterFieldsByNames(fieldMap, ['Id', 'CreatedDate']);
      expect(result).toContain('Id');
      expect(result).toContain('CreatedDate');
    });

    it('should return empty array for all invalid fields', () => {
      const result = filterFieldsByNames(fieldMap, ['Nope', 'AlsoNope']);
      expect(result).toEqual([]);
    });
  });
});
