/**
 * Intent-driven field relevance profiles (ADR-103 v1).
 *
 * Maps business intents to relevant field subsets, generated dynamically
 * from the field-type map. Custom fields are auto-categorized by type —
 * a custom currency field automatically appears in pipeline intent results.
 */

import { FieldTypeEntry } from './field-type-map';

export type Intent = 'pipeline' | 'engagement' | 'forecasting' | 'reporting' | 'contact-mapping';

// Standard fields per intent (always included if they exist on the object)
const STANDARD_FIELDS: Record<Intent, string[]> = {
  pipeline: [
    'Name', 'StageName', 'Amount', 'CloseDate', 'Probability',
    'Owner.Name', 'Account.Name', 'ForecastCategory', 'IsClosed', 'IsWon',
  ],
  engagement: [
    'Name', 'LastActivityDate', 'Owner.Name', 'Account.Name',
    'StageName', 'CreatedDate', 'LastModifiedDate',
  ],
  forecasting: [
    'Name', 'Amount', 'Probability', 'ForecastCategory', 'CloseDate',
    'StageName', 'ExpectedRevenue', 'Owner.Name', 'IsClosed', 'IsWon',
  ],
  reporting: [], // dynamically filled from type map
  'contact-mapping': [
    'Name', 'Account.Name', 'Owner.Name', 'CreatedBy.Name',
  ],
};

// Which computation types to auto-include per intent
const DYNAMIC_TYPES: Record<Intent, string[]> = {
  pipeline: ['numeric'],          // auto-include custom currency/percent fields
  engagement: ['temporal'],       // auto-include custom date fields
  forecasting: ['numeric'],       // auto-include custom currency/percent fields
  reporting: ['categorical', 'numeric', 'flag'], // all groupable + aggregatable
  'contact-mapping': ['identifier'],  // auto-include custom reference/lookup fields
};

/**
 * Get relevant fields for a business intent, combining standard fields
 * with dynamically discovered fields from the type map.
 */
export function getFieldsForIntent(
  intent: Intent,
  fieldTypeMap: Map<string, FieldTypeEntry>,
): string[] {
  const fields = new Set<string>(STANDARD_FIELDS[intent]);

  // Add fields matching the intent's dynamic types
  const dynamicTypes = DYNAMIC_TYPES[intent];
  for (const [fieldName, entry] of fieldTypeMap) {
    if (dynamicTypes.includes(entry.computationType)) {
      fields.add(fieldName);
    }
  }

  return [...fields];
}

/**
 * Get a compact default field set for common objects.
 * Used when neither intent nor explicit fields are specified.
 */
export function getDefaultFields(objectName: string): string[] {
  const lower = objectName.toLowerCase();

  switch (lower) {
    case 'opportunity':
      return ['Name', 'StageName', 'Amount', 'CloseDate', 'Account.Name', 'Owner.Name'];
    case 'account':
      return ['Name', 'Industry', 'Type', 'BillingCity', 'Owner.Name', 'Phone'];
    case 'contact':
      return ['Name', 'Email', 'Title', 'Account.Name', 'Phone', 'Owner.Name'];
    case 'lead':
      return ['Name', 'Company', 'Status', 'Email', 'Owner.Name', 'LeadSource'];
    case 'case':
      return ['CaseNumber', 'Subject', 'Status', 'Priority', 'Account.Name', 'Owner.Name'];
    default:
      return ['Name', 'Id', 'CreatedDate', 'LastModifiedDate', 'Owner.Name'];
  }
}

/**
 * Filter a list of field names, returning only those that exist in the type map.
 * Handles relationship traversals (e.g., Owner.Name validates against OwnerId).
 */
export function filterFieldsByNames(
  fieldTypeMap: Map<string, FieldTypeEntry>,
  fieldNames: string[],
): string[] {
  return fieldNames.filter(name => {
    // Direct match
    if (fieldTypeMap.has(name)) return true;

    // Relationship traversal: Owner.Name → check for OwnerId
    if (name.includes('.')) {
      const base = name.split('.')[0];
      const refId = base + 'Id';
      return fieldTypeMap.has(refId);
    }

    // Standard fields that exist on most objects but aren't in describe
    const universalFields = new Set(['Id', 'Name', 'CreatedDate', 'LastModifiedDate', 'Owner.Name', 'CreatedBy.Name']);
    return universalFields.has(name);
  });
}
