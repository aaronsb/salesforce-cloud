/// <reference types="jest" />

import {
  extractObjectNames, buildFieldHint, buildQueryFieldHints,
  parseInvalidField, buildInvalidFieldHint, CatalogSource, HINT_FIELD_LIMIT,
} from '../utils/field-hints';
import type { ObjectCatalog } from '../client/field-discovery';
import type { ScoredField } from '../utils/field-regulator';

// ── Fixtures ─────────────────────────────────────────────────────────

function scored(name: string, promoted = true): ScoredField {
  return {
    field: {
      name, label: name, type: 'string', custom: false,
      helpText: null, nillable: true, computationType: 'text',
    },
    score: 100,
    adjustments: [],
    promoted,
  };
}

function catalog(objectName: string, fieldNames: string[], totalFields?: number): ObjectCatalog {
  const fields = fieldNames.map(n => scored(n));
  return {
    objectName,
    fields,
    promoted: fields,
    wellKnown: new Map(),
    describeMs: 1,
    scoringMs: 1,
    totalFields: totalFields ?? fieldNames.length,
    totalRecords: 100,
  };
}

function source(catalogs: Record<string, ObjectCatalog>): CatalogSource {
  return { getCatalog: (name: string) => catalogs[name] };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('extractObjectNames', () => {
  it('pulls the object out of a simple query', () => {
    expect(extractObjectNames('SELECT Id, Name FROM Account')).toEqual(['Account']);
  });

  it('handles a WHERE clause and trailing syntax', () => {
    expect(extractObjectNames("SELECT Id FROM Opportunity WHERE StageName = 'Closed Won' ORDER BY Amount DESC LIMIT 10"))
      .toEqual(['Opportunity']);
  });

  it('finds objects in subqueries as well as the main FROM', () => {
    const soql = 'SELECT Id, (SELECT Id FROM Contacts) FROM Account';
    expect(extractObjectNames(soql)).toEqual(['Contacts', 'Account']);
  });

  it('deduplicates repeated objects, preserving first-seen order', () => {
    const soql = 'SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Account)';
    expect(extractObjectNames(soql)).toEqual(['Account']);
  });

  it('is case-insensitive on the FROM keyword', () => {
    expect(extractObjectNames('select id from account')).toEqual(['account']);
  });

  it('matches custom objects', () => {
    expect(extractObjectNames('SELECT Id FROM My_Custom__c')).toEqual(['My_Custom__c']);
  });

  it('returns nothing when there is no FROM', () => {
    expect(extractObjectNames('SELECT COUNT()')).toEqual([]);
  });

  it('does not treat a field named "from-ish" as an object', () => {
    expect(extractObjectNames('SELECT FromAddress FROM Email')).toEqual(['Email']);
  });
});

describe('buildFieldHint', () => {
  it('names the promoted fields and points at the full catalog', () => {
    const src = source({ Account: catalog('Account', ['Name', 'Industry'], 87) });

    const hint = buildFieldHint(src, 'Account');

    expect(hint).toContain('Account fields ranked by usage (2 of 87)');
    expect(hint).toContain('Name, Industry');
    expect(hint).toContain('salesforce://field-catalog/Account/all');
  });

  it('caps the inline list and says how many more there are', () => {
    const names = Array.from({ length: HINT_FIELD_LIMIT + 5 }, (_, i) => `F${i}`);
    const src = source({ Account: catalog('Account', names) });

    const hint = buildFieldHint(src, 'Account');

    expect(hint).toContain(`F${HINT_FIELD_LIMIT - 1}`);
    expect(hint).not.toContain(`F${HINT_FIELD_LIMIT}`);
    expect(hint).toContain('+5 more');
  });

  it('omits the "more" suffix when everything fits', () => {
    const src = source({ Account: catalog('Account', ['Name']) });

    expect(buildFieldHint(src, 'Account')).not.toContain('more');
  });

  it('resolves the object case-insensitively for known core objects', () => {
    const src = source({ Account: catalog('Account', ['Name']) });

    expect(buildFieldHint(src, 'account')).toContain('Account fields ranked by usage');
  });

  it('returns nothing for an undiscovered object rather than guessing', () => {
    const src = source({});

    expect(buildFieldHint(src, 'Account')).toBe('');
  });

  it('returns nothing when the catalog has no promoted fields', () => {
    const empty = catalog('Account', []);
    const src = source({ Account: empty });

    expect(buildFieldHint(src, 'Account')).toBe('');
  });

  it('returns nothing for an unknown custom object', () => {
    const src = source({ Account: catalog('Account', ['Name']) });

    expect(buildFieldHint(src, 'Mystery__c')).toBe('');
  });
});

describe('buildQueryFieldHints', () => {
  it('emits a breadcrumb for the queried object', () => {
    const src = source({ Account: catalog('Account', ['Name', 'Industry'], 87) });

    const hints = buildQueryFieldHints(src, 'SELECT Id FROM Account');

    expect(hints).toContain('---');
    expect(hints).toContain('Account fields ranked by usage');
  });

  it('emits one breadcrumb per discovered object in the query', () => {
    const src = source({
      Account: catalog('Account', ['Name']),
      Contact: catalog('Contact', ['Email']),
    });

    const hints = buildQueryFieldHints(src, 'SELECT Id, (SELECT Id FROM Contact) FROM Account');

    expect(hints).toContain('Account fields ranked by usage');
    expect(hints).toContain('Contact fields ranked by usage');
  });

  it('skips undiscovered objects but keeps the ones it knows', () => {
    const src = source({ Account: catalog('Account', ['Name']) });

    const hints = buildQueryFieldHints(src, 'SELECT Id, (SELECT Id FROM Unknown__c) FROM Account');

    expect(hints).toContain('Account fields ranked by usage');
    expect(hints).not.toContain('Unknown__c fields');
  });

  it('stays silent when nothing in the query is discovered', () => {
    const src = source({});

    expect(buildQueryFieldHints(src, 'SELECT Id FROM Account')).toBe('');
  });
});

describe('parseInvalidField', () => {
  it('extracts the field and object from a Salesforce bad-column error', () => {
    const message = "SOQL query failed: No such column 'Bogus__c' on entity 'Account'. If you are attempting to use a custom field, be sure to append the '__c'.";

    expect(parseInvalidField(message)).toEqual({ field: 'Bogus__c', objectName: 'Account' });
  });

  it('returns null for an unrelated error', () => {
    expect(parseInvalidField('SOQL query failed: MALFORMED_QUERY')).toBeNull();
  });

  it('returns null for an empty message', () => {
    expect(parseInvalidField('')).toBeNull();
  });
});

describe('buildInvalidFieldHint', () => {
  it('names the offending field and the fields that do exist', () => {
    const src = source({ Account: catalog('Account', ['Name', 'Industry'], 87) });
    const message = "No such column 'Bogus__c' on entity 'Account'.";

    const hint = buildInvalidFieldHint(src, message);

    expect(hint).toContain('`Bogus__c` does not exist on Account');
    expect(hint).toContain('Name, Industry');
    expect(hint).toContain('salesforce://field-catalog/Account/all');
  });

  it('stays silent for errors that are not about a bad field', () => {
    const src = source({ Account: catalog('Account', ['Name']) });

    expect(buildInvalidFieldHint(src, 'INVALID_SESSION_ID')).toBe('');
  });

  it('stays silent when the object is not discovered, rather than asserting nothing exists', () => {
    const src = source({});
    const message = "No such column 'Bogus__c' on entity 'Account'.";

    expect(buildInvalidFieldHint(src, message)).toBe('');
  });
});
