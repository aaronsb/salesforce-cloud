/// <reference types="jest" />

import {
  getComputationType,
  buildFieldTypeMap,
  getAnalyzableFields,
  getGroupByFields,
  getAggregateFields,
  getSoqlFilter,
  ComputationType,
  FieldTypeInfo,
  FieldTypeEntry,
} from '../utils/field-type-map';

describe('field-type-map', () => {
  // -------------------------------------------------------------------
  // getComputationType — SF type to computation type mapping
  // -------------------------------------------------------------------
  describe('getComputationType', () => {
    const numericTypes = ['currency', 'double', 'int', 'long', 'percent'];
    const categoricalTypes = ['picklist', 'combobox', 'multipicklist'];
    const textTypes = ['string', 'textarea', 'url', 'email', 'phone'];
    const temporalTypes = ['date', 'datetime', 'time'];
    const identifierTypes = ['reference', 'id'];
    const compoundTypes = ['address', 'location'];

    it.each(numericTypes)('should map %s to numeric', (sfType) => {
      const info = getComputationType(sfType);
      expect(info.computationType).toBe('numeric');
      expect(info.validOperations).toContain('sum');
      expect(info.validOperations).toContain('avg');
      expect(info.validOperations).toContain('min');
      expect(info.validOperations).toContain('max');
      expect(info.validOperations).toContain('arithmetic');
    });

    it.each(categoricalTypes)('should map %s to categorical', (sfType) => {
      const info = getComputationType(sfType);
      expect(info.computationType).toBe('categorical');
      expect(info.validOperations).toContain('group-by');
      expect(info.validOperations).toContain('count');
      expect(info.validOperations).toContain('distribution');
    });

    it('should note INCLUDES() for multipicklist', () => {
      const info = getComputationType('multipicklist');
      expect(info.soqlNotes).toContain('INCLUDES()');
    });

    it.each(textTypes)('should map %s to text', (sfType) => {
      const info = getComputationType(sfType);
      expect(info.computationType).toBe('text');
      expect(info.validOperations).toContain('filter');
      expect(info.validOperations).toContain('count');
    });

    it('should note textarea is not indexable', () => {
      const info = getComputationType('textarea');
      expect(info.soqlNotes).toContain('excluded from SOQL WHERE');
    });

    it.each(temporalTypes)('should map %s to temporal', (sfType) => {
      const info = getComputationType(sfType);
      expect(info.computationType).toBe('temporal');
    });

    it('should note time has no date component', () => {
      const info = getComputationType('time');
      expect(info.soqlNotes).toContain('no date component');
    });

    it.each(identifierTypes)('should map %s to identifier', (sfType) => {
      const info = getComputationType(sfType);
      expect(info.computationType).toBe('identifier');
    });

    it('should note reference resolves to ID + Name', () => {
      const info = getComputationType('reference');
      expect(info.soqlNotes).toContain('relationship Name');
    });

    it('should map boolean to flag', () => {
      const info = getComputationType('boolean');
      expect(info.computationType).toBe('flag');
      expect(info.validOperations).toContain('filter');
      expect(info.validOperations).toContain('group-by');
    });

    it.each(compoundTypes)('should map %s to compound', (sfType) => {
      const info = getComputationType(sfType);
      expect(info.computationType).toBe('compound');
      expect(info.validOperations).toEqual(['display']);
      expect(info.soqlNotes).toContain('component fields');
    });

    it('should map base64 to binary', () => {
      const info = getComputationType('base64');
      expect(info.computationType).toBe('binary');
      expect(info.validOperations).toEqual([]);
    });

    it('should treat unknown types as text', () => {
      const info = getComputationType('encryptedstring');
      expect(info.computationType).toBe('text');
      expect(info.soqlNotes).toContain('Unknown SF field type');
    });

    it('should be case-insensitive', () => {
      expect(getComputationType('Currency').computationType).toBe('numeric');
      expect(getComputationType('PICKLIST').computationType).toBe('categorical');
    });
  });

  // -------------------------------------------------------------------
  // buildFieldTypeMap — build map from describe results
  // -------------------------------------------------------------------
  describe('buildFieldTypeMap', () => {
    const mockDescribe = {
      name: 'Opportunity',
      fields: [
        { name: 'Id', type: 'id', label: 'Record ID' },
        { name: 'Name', type: 'string', label: 'Name' },
        { name: 'Amount', type: 'currency', label: 'Amount' },
        { name: 'StageName', type: 'picklist', label: 'Stage' },
        { name: 'IsWon', type: 'boolean', label: 'Won' },
        { name: 'CloseDate', type: 'date', label: 'Close Date' },
        { name: 'AccountId', type: 'reference', label: 'Account' },
        { name: 'Description', type: 'textarea', label: 'Description' },
        { name: 'Products__c', type: 'multipicklist', label: 'Products' },
        { name: 'BillingAddress', type: 'address', label: 'Address' },
        { name: 'Attachment__c', type: 'base64', label: 'Attachment' },
      ],
    };

    it('should build a map with all fields', () => {
      const map = buildFieldTypeMap(mockDescribe);
      expect(map.size).toBe(11);
    });

    it('should return correct types for each field', () => {
      const map = buildFieldTypeMap(mockDescribe);

      expect(map.get('Id')?.computationType).toBe('identifier');
      expect(map.get('Name')?.computationType).toBe('text');
      expect(map.get('Amount')?.computationType).toBe('numeric');
      expect(map.get('StageName')?.computationType).toBe('categorical');
      expect(map.get('IsWon')?.computationType).toBe('flag');
      expect(map.get('CloseDate')?.computationType).toBe('temporal');
      expect(map.get('AccountId')?.computationType).toBe('identifier');
      expect(map.get('Description')?.computationType).toBe('text');
      expect(map.get('Products__c')?.computationType).toBe('categorical');
      expect(map.get('BillingAddress')?.computationType).toBe('compound');
      expect(map.get('Attachment__c')?.computationType).toBe('binary');
    });

    it('should preserve field name and SF type', () => {
      const map = buildFieldTypeMap(mockDescribe);
      const amount = map.get('Amount');
      expect(amount?.fieldName).toBe('Amount');
      expect(amount?.sfType).toBe('currency');
    });

    it('should return empty map when no fields', () => {
      expect(buildFieldTypeMap({}).size).toBe(0);
      expect(buildFieldTypeMap({ fields: undefined }).size).toBe(0);
    });

    it('should handle empty fields array', () => {
      expect(buildFieldTypeMap({ fields: [] }).size).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // getAnalyzableFields
  // -------------------------------------------------------------------
  describe('getAnalyzableFields', () => {
    const mockDescribe = {
      fields: [
        { name: 'Amount', type: 'currency' },
        { name: 'Stage', type: 'picklist' },
        { name: 'IsWon', type: 'boolean' },
        { name: 'Attachment', type: 'base64' },
        { name: 'Name', type: 'string' },
      ],
    };

    it('should exclude binary fields when no type specified', () => {
      const map = buildFieldTypeMap(mockDescribe);
      const fields = getAnalyzableFields(map);
      expect(fields).toHaveLength(4);
      expect(fields.find((f) => f.fieldName === 'Attachment')).toBeUndefined();
    });

    it('should filter by specific computation type', () => {
      const map = buildFieldTypeMap(mockDescribe);

      const numeric = getAnalyzableFields(map, 'numeric');
      expect(numeric).toHaveLength(1);
      expect(numeric[0].fieldName).toBe('Amount');

      const categorical = getAnalyzableFields(map, 'categorical');
      expect(categorical).toHaveLength(1);
      expect(categorical[0].fieldName).toBe('Stage');
    });
  });

  // -------------------------------------------------------------------
  // getGroupByFields — categorical + flag
  // -------------------------------------------------------------------
  describe('getGroupByFields', () => {
    const mockDescribe = {
      fields: [
        { name: 'Amount', type: 'currency' },
        { name: 'Stage', type: 'picklist' },
        { name: 'Source', type: 'combobox' },
        { name: 'IsWon', type: 'boolean' },
        { name: 'Name', type: 'string' },
        { name: 'CloseDate', type: 'date' },
        { name: 'Products', type: 'multipicklist' },
      ],
    };

    it('should return only categorical and flag fields', () => {
      const map = buildFieldTypeMap(mockDescribe);
      const fields = getGroupByFields(map);
      const names = fields.map((f) => f.fieldName);

      expect(names).toContain('Stage');
      expect(names).toContain('Source');
      expect(names).toContain('IsWon');
      expect(names).toContain('Products');
      expect(names).not.toContain('Amount');
      expect(names).not.toContain('Name');
      expect(names).not.toContain('CloseDate');
    });

    it('should return empty array when no categorical/flag fields', () => {
      const map = buildFieldTypeMap({
        fields: [
          { name: 'Amount', type: 'currency' },
          { name: 'Name', type: 'string' },
        ],
      });
      expect(getGroupByFields(map)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------
  // getAggregateFields — numeric only
  // -------------------------------------------------------------------
  describe('getAggregateFields', () => {
    const mockDescribe = {
      fields: [
        { name: 'Amount', type: 'currency' },
        { name: 'Probability', type: 'percent' },
        { name: 'Quantity', type: 'int' },
        { name: 'Stage', type: 'picklist' },
        { name: 'IsWon', type: 'boolean' },
      ],
    };

    it('should return only numeric fields', () => {
      const map = buildFieldTypeMap(mockDescribe);
      const fields = getAggregateFields(map);
      const names = fields.map((f) => f.fieldName);

      expect(names).toContain('Amount');
      expect(names).toContain('Probability');
      expect(names).toContain('Quantity');
      expect(names).not.toContain('Stage');
      expect(names).not.toContain('IsWon');
    });

    it('should return empty array when no numeric fields', () => {
      const map = buildFieldTypeMap({
        fields: [{ name: 'Stage', type: 'picklist' }],
      });
      expect(getAggregateFields(map)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------
  // getSoqlFilter — SOQL generation with type-specific handling
  // -------------------------------------------------------------------
  describe('getSoqlFilter', () => {
    it('should generate standard equality filter for picklist', () => {
      const info = getComputationType('picklist');
      const result = getSoqlFilter('StageName', info, '=', 'Closed Won');
      expect(result).toBe("StageName = 'Closed Won'");
    });

    it('should auto-correct = to INCLUDES for multipicklist', () => {
      const info = getComputationType('multipicklist');
      const result = getSoqlFilter('Products__c', info, '=', 'Widget');
      expect(result).toBe("Products__c INCLUDES ('Widget')");
    });

    it('should auto-correct != to EXCLUDES for multipicklist', () => {
      const info = getComputationType('multipicklist');
      const result = getSoqlFilter('Products__c', info, '!=', 'Widget');
      expect(result).toBe("Products__c EXCLUDES ('Widget')");
    });

    it('should auto-correct LIKE to INCLUDES for multipicklist', () => {
      const info = getComputationType('multipicklist');
      const result = getSoqlFilter('Products__c', info, 'LIKE', 'Widget');
      expect(result).toBe("Products__c INCLUDES ('Widget')");
    });

    it('should pass through INCLUDES operator', () => {
      const info = getComputationType('multipicklist');
      const result = getSoqlFilter('Products__c', info, 'INCLUDES', 'Widget');
      expect(result).toBe("Products__c INCLUDES ('Widget')");
    });

    it('should pass through EXCLUDES operator', () => {
      const info = getComputationType('multipicklist');
      const result = getSoqlFilter('Products__c', info, 'EXCLUDES', 'Widget');
      expect(result).toBe("Products__c EXCLUDES ('Widget')");
    });

    it('should format numeric values without quotes', () => {
      const info = getComputationType('currency');
      const result = getSoqlFilter('Amount', info, '>', 10000);
      expect(result).toBe('Amount > 10000');
    });

    it('should format string values with quotes', () => {
      const info = getComputationType('string');
      const result = getSoqlFilter('Name', info, 'LIKE', '%Acme%');
      expect(result).toBe("Name LIKE '%Acme%'");
    });

    it('should throw for compound fields', () => {
      const info = getComputationType('address');
      expect(() => getSoqlFilter('BillingAddress', info, '=', 'test')).toThrow(
        /compound type/
      );
      expect(() =>
        getSoqlFilter('BillingAddress', info, '=', 'test')
      ).toThrow(/component fields/);
    });

    it('should throw for binary fields', () => {
      const info = getComputationType('base64');
      expect(() =>
        getSoqlFilter('Attachment__c', info, '=', 'test')
      ).toThrow(/binary type/);
    });

    it('should handle boolean equality with bare literal', () => {
      const info = getComputationType('boolean');
      const result = getSoqlFilter('IsWon', info, '=', 'true');
      expect(result).toBe('IsWon = true');
    });

    it('should escape single quotes in string values', () => {
      const info = getComputationType('string');
      const result = getSoqlFilter('LastName', info, '=', "O'Brien");
      expect(result).toBe("LastName = 'O\\'Brien'");
    });

    it('should handle date comparisons', () => {
      const info = getComputationType('date');
      const result = getSoqlFilter('CloseDate', info, '>=', '2024-01-01');
      expect(result).toBe("CloseDate >= '2024-01-01'");
    });

    it('should be case-insensitive for operators', () => {
      const info = getComputationType('string');
      const result = getSoqlFilter('Name', info, 'like', '%Acme%');
      expect(result).toBe("Name LIKE '%Acme%'");
    });
  });
});
