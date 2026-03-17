/**
 * Field-type computation map for Salesforce objects.
 *
 * Maps Salesforce field types (from describe_object metadata) to computation
 * types that determine which analytics operations are valid for each field.
 * This prevents agents from generating invalid SOQL and enables type-safe
 * analytics queries.
 *
 * See ADR-101 for the full design rationale.
 */

/** Computation type categories for analytics operations */
export type ComputationType =
  | 'numeric'
  | 'categorical'
  | 'text'
  | 'temporal'
  | 'identifier'
  | 'flag'
  | 'compound'
  | 'binary';

/** Metadata about a field's computation capabilities */
export interface FieldTypeInfo {
  /** The computation category this field belongs to */
  computationType: ComputationType;
  /** Operations valid for this field (e.g., sum, avg, group-by) */
  validOperations: string[];
  /** SOQL-specific notes for query generation */
  soqlNotes?: string;
}

/** A field entry in the type map, combining name with type info */
export interface FieldTypeEntry extends FieldTypeInfo {
  fieldName: string;
  sfType: string;
}

/**
 * Static mapping from Salesforce field types to computation types.
 *
 * The keys are Salesforce field type strings as returned by describe_object.
 * Each entry defines the computation type, valid operations, and any
 * SOQL-specific handling notes.
 */
const SF_TYPE_MAP: Record<string, FieldTypeInfo> = {
  // Numeric types — support aggregation and arithmetic
  currency: {
    computationType: 'numeric',
    validOperations: ['sum', 'avg', 'min', 'max', 'arithmetic', 'count'],
  },
  double: {
    computationType: 'numeric',
    validOperations: ['sum', 'avg', 'min', 'max', 'arithmetic', 'count'],
  },
  int: {
    computationType: 'numeric',
    validOperations: ['sum', 'avg', 'min', 'max', 'arithmetic', 'count'],
  },
  long: {
    computationType: 'numeric',
    validOperations: ['sum', 'avg', 'min', 'max', 'arithmetic', 'count'],
  },
  percent: {
    computationType: 'numeric',
    validOperations: ['sum', 'avg', 'min', 'max', 'arithmetic', 'count'],
  },

  // Categorical types — support group-by and distribution
  picklist: {
    computationType: 'categorical',
    validOperations: ['group-by', 'count', 'distribution'],
    soqlNotes: 'Single-value; use = in SOQL WHERE',
  },
  combobox: {
    computationType: 'categorical',
    validOperations: ['group-by', 'count', 'distribution'],
    soqlNotes: 'Single-value; use = in SOQL WHERE',
  },
  multipicklist: {
    computationType: 'categorical',
    validOperations: ['group-by', 'count', 'distribution'],
    soqlNotes: 'Use INCLUDES() not = for filtering',
  },

  // Text types — support filtering and counting
  string: {
    computationType: 'text',
    validOperations: ['filter', 'count'],
  },
  textarea: {
    computationType: 'text',
    validOperations: ['filter', 'count'],
    soqlNotes: 'Not indexable; excluded from SOQL WHERE by default',
  },
  url: {
    computationType: 'text',
    validOperations: ['filter', 'count'],
  },
  email: {
    computationType: 'text',
    validOperations: ['filter', 'count'],
  },
  phone: {
    computationType: 'text',
    validOperations: ['filter', 'count'],
  },

  // Temporal types — support range and duration operations
  date: {
    computationType: 'temporal',
    validOperations: ['range', 'duration', 'cycle-time', 'min', 'max'],
  },
  datetime: {
    computationType: 'temporal',
    validOperations: ['range', 'duration', 'cycle-time', 'min', 'max'],
  },
  time: {
    computationType: 'temporal',
    validOperations: ['range', 'min', 'max'],
    soqlNotes: 'Time-of-day only; no date component',
  },

  // Identifier types — support joins and lookups
  reference: {
    computationType: 'identifier',
    validOperations: ['join', 'lookup', 'count-distinct'],
    soqlNotes: 'Resolves to ID + relationship Name (e.g., AccountId + Account.Name)',
  },
  id: {
    computationType: 'identifier',
    validOperations: ['lookup', 'count-distinct'],
    soqlNotes: 'Record identifier; always unique',
  },

  // Flag type — boolean fields
  boolean: {
    computationType: 'flag',
    validOperations: ['filter', 'count-where', 'group-by'],
  },

  // Compound types — display-only, must use component fields
  address: {
    computationType: 'compound',
    validOperations: ['display'],
    soqlNotes: 'Not directly queryable; use component fields (e.g., BillingCity)',
  },
  location: {
    computationType: 'compound',
    validOperations: ['display'],
    soqlNotes: 'Not directly queryable; use component fields',
  },

  // Binary type — excluded from analytics
  base64: {
    computationType: 'binary',
    validOperations: [],
    soqlNotes: 'Excluded from analytics and rendering',
  },
};

/** Default for unknown Salesforce field types */
const UNKNOWN_TYPE_INFO: FieldTypeInfo = {
  computationType: 'text',
  validOperations: ['filter', 'count'],
  soqlNotes: 'Unknown SF field type; treated as text',
};

/**
 * Look up the computation type info for a Salesforce field type.
 *
 * @param sfFieldType - The Salesforce field type string (e.g., 'currency', 'picklist')
 * @returns The computation type info for the field
 */
export function getComputationType(sfFieldType: string): FieldTypeInfo {
  return SF_TYPE_MAP[sfFieldType.toLowerCase()] ?? UNKNOWN_TYPE_INFO;
}

/**
 * Simplified describe field as returned by simplifyObjectMetadata.
 * Matches the shape in src/types/index.ts SimplifiedObject.fields entries.
 */
interface DescribeField {
  name: string;
  type: string;
  [key: string]: unknown;
}

/** Describe result shape — needs at minimum a fields array */
interface DescribeResult {
  fields?: DescribeField[];
  [key: string]: unknown;
}

/**
 * Build a field-type map for an entire Salesforce object from its describe result.
 *
 * @param describeResult - The describe_object result (simplified or raw)
 * @returns Map from field name to FieldTypeEntry
 */
export function buildFieldTypeMap(
  describeResult: DescribeResult
): Map<string, FieldTypeEntry> {
  const map = new Map<string, FieldTypeEntry>();

  if (!describeResult.fields) {
    return map;
  }

  for (const field of describeResult.fields) {
    const typeInfo = getComputationType(field.type);
    map.set(field.name, {
      fieldName: field.name,
      sfType: field.type,
      ...typeInfo,
    });
  }

  return map;
}

/**
 * Filter fields by computation type from a field-type map.
 *
 * @param fieldMap - The field-type map from buildFieldTypeMap
 * @param computationType - Optional computation type to filter by; if omitted, returns all non-binary fields
 * @returns Array of matching field entries
 */
export function getAnalyzableFields(
  fieldMap: Map<string, FieldTypeEntry>,
  computationType?: ComputationType
): FieldTypeEntry[] {
  const entries = Array.from(fieldMap.values());

  if (computationType) {
    return entries.filter((e) => e.computationType === computationType);
  }

  // Exclude binary fields by default — they have no analytics value
  return entries.filter((e) => e.computationType !== 'binary');
}

/**
 * Return fields valid for GROUP BY clauses (categorical + flag).
 *
 * @param fieldMap - The field-type map from buildFieldTypeMap
 * @returns Array of field entries usable in GROUP BY
 */
export function getGroupByFields(
  fieldMap: Map<string, FieldTypeEntry>
): FieldTypeEntry[] {
  return Array.from(fieldMap.values()).filter(
    (e) =>
      e.computationType === 'categorical' || e.computationType === 'flag'
  );
}

/**
 * Return fields valid for aggregate functions (numeric).
 *
 * @param fieldMap - The field-type map from buildFieldTypeMap
 * @returns Array of field entries usable in aggregations (SUM, AVG, etc.)
 */
export function getAggregateFields(
  fieldMap: Map<string, FieldTypeEntry>
): FieldTypeEntry[] {
  return Array.from(fieldMap.values()).filter(
    (e) => e.computationType === 'numeric'
  );
}

/**
 * Generate a correct SOQL filter expression for a given field type.
 *
 * Handles type-specific SOQL semantics:
 * - multipicklist uses INCLUDES() instead of =
 * - textarea fields emit a warning note (not indexable)
 * - compound fields (address, location) are rejected
 * - binary fields are rejected
 *
 * @param fieldName - The API name of the field
 * @param fieldTypeInfo - The FieldTypeInfo for the field
 * @param operator - The filter operator (=, !=, LIKE, >, <, >=, <=, IN, INCLUDES, EXCLUDES)
 * @param value - The filter value (string or number)
 * @returns The SOQL WHERE clause fragment
 * @throws Error if the field type cannot be used in WHERE clauses
 */
export function getSoqlFilter(
  fieldName: string,
  fieldTypeInfo: FieldTypeInfo,
  operator: string,
  value: string | number
): string {
  const { computationType, soqlNotes } = fieldTypeInfo;

  // Compound fields cannot appear in WHERE
  if (computationType === 'compound') {
    throw new Error(
      `Field "${fieldName}" is a compound type (${soqlNotes ?? 'address/location'}). ` +
        'Use component fields instead (e.g., BillingCity, BillingState).'
    );
  }

  // Binary fields cannot appear in WHERE
  if (computationType === 'binary') {
    throw new Error(
      `Field "${fieldName}" is a binary type and cannot be used in SOQL filters.`
    );
  }

  const normalizedOp = operator.toUpperCase();

  // Multipicklist requires INCLUDES/EXCLUDES
  if (
    soqlNotes?.includes('INCLUDES()') &&
    !['INCLUDES', 'EXCLUDES'].includes(normalizedOp)
  ) {
    // Auto-correct = to INCLUDES for multipicklist
    if (normalizedOp === '=' || normalizedOp === 'LIKE') {
      return `${fieldName} INCLUDES ('${String(value)}')`;
    }
    if (normalizedOp === '!=') {
      return `${fieldName} EXCLUDES ('${String(value)}')`;
    }
  }

  // INCLUDES / EXCLUDES operators
  if (normalizedOp === 'INCLUDES') {
    return `${fieldName} INCLUDES ('${String(value)}')`;
  }
  if (normalizedOp === 'EXCLUDES') {
    return `${fieldName} EXCLUDES ('${String(value)}')`;
  }

  // Boolean fields use bare true/false literals in SOQL
  if (computationType === 'flag') {
    const boolVal = String(value).toLowerCase();
    if (boolVal !== 'true' && boolVal !== 'false') {
      throw new Error(`Field "${fieldName}" is boolean — value must be true or false, got "${value}".`);
    }
    return `${fieldName} ${normalizedOp} ${boolVal}`;
  }

  // Standard operators with type-appropriate value formatting
  // Escape single quotes in string values per SOQL convention
  const formattedValue =
    typeof value === 'number'
      ? String(value)
      : `'${String(value).replace(/'/g, "\\'")}'`;

  return `${fieldName} ${normalizedOp} ${formattedValue}`;
}
