/// <reference types="jest" />

import {
  formatDate,
  formatStatus,
  truncate,
  stripHtml,
  formatAmount,
  formatFieldValue,
  humanizeFieldName,
  projectRemainingFields,
  renderOpportunity,
  renderAccount,
  renderContact,
  renderRecord,
  renderList,
  renderQueryResult,
  MarkdownRenderer,
} from '../utils/markdown-renderer';

// ============================================================================
// Helper function tests
// ============================================================================

describe('formatDate', () => {
  it('should return "Not set" for null/undefined', () => {
    expect(formatDate(null)).toBe('Not set');
    expect(formatDate(undefined)).toBe('Not set');
  });

  it('should format date-only strings without timezone shift', () => {
    const result = formatDate('2026-03-15');
    expect(result).toBe('Mar 15, 2026');
  });

  it('should format full datetime strings', () => {
    const result = formatDate('2026-03-15T10:30:00Z');
    expect(result).toContain('2026');
    expect(result).toContain('Mar');
  });

  it('should return the original string for unparseable dates', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatStatus', () => {
  it('should return [x] for closed stages', () => {
    expect(formatStatus('Closed Won')).toBe('[x] Closed Won');
    expect(formatStatus('Closed Lost')).toBe('[x] Closed Lost');
  });

  it('should return [>] for in-progress stages', () => {
    expect(formatStatus('Negotiation')).toBe('[>] Negotiation');
    expect(formatStatus('Proposal')).toBe('[>] Proposal');
    expect(formatStatus('In Progress')).toBe('[>] In Progress');
  });

  it('should return [ ] for early stages', () => {
    expect(formatStatus('Qualification')).toBe('[ ] Qualification');
    expect(formatStatus('Prospecting')).toBe('[ ] Prospecting');
  });

  it('should handle null/undefined', () => {
    expect(formatStatus(null)).toBe('[?] Unknown');
    expect(formatStatus(undefined)).toBe('[?] Unknown');
  });
});

describe('truncate', () => {
  it('should return empty string for null/undefined', () => {
    expect(truncate(null)).toBe('');
    expect(truncate(undefined)).toBe('');
  });

  it('should return text as-is when shorter than maxLen', () => {
    expect(truncate('short text', 100)).toBe('short text');
  });

  it('should truncate and add ellipsis when too long', () => {
    const long = 'a'.repeat(200);
    const result = truncate(long, 50);
    expect(result.length).toBeLessThanOrEqual(53); // 50 + '...'
    expect(result).toMatch(/\.\.\.$/);
  });

  it('should collapse newlines', () => {
    expect(truncate('line1\n\nline2\nline3', 100)).toBe('line1 line2 line3');
  });
});

describe('stripHtml', () => {
  it('should return empty string for null/undefined', () => {
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(undefined)).toBe('');
  });

  it('should remove HTML tags', () => {
    expect(stripHtml('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });

  it('should decode common HTML entities', () => {
    expect(stripHtml('&amp; &lt; &gt; &nbsp; &quot; &#39;')).toBe('& < > " \'');
  });

  it('should collapse whitespace', () => {
    expect(stripHtml('  multiple   spaces  ')).toBe('multiple spaces');
  });
});

describe('formatAmount', () => {
  it('should return "N/A" for null/undefined', () => {
    expect(formatAmount(null)).toBe('N/A');
    expect(formatAmount(undefined)).toBe('N/A');
  });

  it('should format millions with M suffix', () => {
    expect(formatAmount(1_500_000)).toBe('$1.5M');
    expect(formatAmount(2_000_000)).toBe('$2.0M');
  });

  it('should format thousands with K suffix', () => {
    expect(formatAmount(50_000)).toBe('$50K');
    expect(formatAmount(1_500)).toBe('$2K'); // rounded
  });

  it('should format small amounts without suffix', () => {
    expect(formatAmount(500)).toBe('$500');
    expect(formatAmount(0)).toBe('$0');
  });
});

// ============================================================================
// Opportunity rendering tests
// ============================================================================

describe('renderOpportunity', () => {
  const baseOpp = {
    Name: 'Big Deal',
    StageName: 'Proposal',
    Amount: 100000,
    CloseDate: '2026-06-15',
    Owner: { Name: 'Jane Smith' },
  };

  it('should render summary as pipe-delimited one-liner', () => {
    const result = renderOpportunity(baseOpp, 'summary');
    expect(result).toContain('Big Deal');
    expect(result).toContain('[>] Proposal');
    expect(result).toContain('$100K');
    expect(result).toContain('Jane Smith');
    expect(result).toContain('|');
    // Should be a single line
    expect(result.split('\n')).toHaveLength(1);
  });

  it('should render full detail with sections', () => {
    const fullOpp = {
      ...baseOpp,
      Id: '006ABC',
      Probability: 75,
      Description: '<p>Important deal</p>',
      Account: { Name: 'Acme Corp', Industry: 'Technology' },
      contacts: [
        { name: 'Bob', email: 'bob@acme.com', role: 'Decision Maker' },
      ],
    };
    const result = renderOpportunity(fullOpp, 'full');
    expect(result).toContain('# Big Deal');
    expect(result).toContain('ID: 006ABC');
    expect(result).toContain('[>] Proposal');
    expect(result).toContain('$100K');
    expect(result).toContain('Probability: 75%');
    expect(result).toContain('Description:');
    expect(result).toContain('Important deal');
    expect(result).not.toContain('<p>'); // HTML stripped
    expect(result).toContain('Account: Acme Corp');
    expect(result).toContain('Contacts (1):');
    expect(result).toContain('Bob (Decision Maker)');
  });

  it('should handle camelCase field names from formatted results', () => {
    const opp = {
      name: 'Small Deal',
      stage: 'Closed Won',
      amount: 5000,
      owner: { name: 'John' },
    };
    const result = renderOpportunity(opp, 'summary');
    expect(result).toContain('Small Deal');
    expect(result).toContain('[x] Closed Won');
    expect(result).toContain('$5K');
  });
});

// ============================================================================
// Account rendering tests
// ============================================================================

describe('renderAccount', () => {
  const baseAccount = {
    Name: 'Acme Corp',
    Industry: 'Technology',
    Website: 'https://acme.com',
  };

  it('should render summary as pipe-delimited', () => {
    const result = renderAccount(baseAccount, 'summary');
    expect(result).toContain('Acme Corp');
    expect(result).toContain('Technology');
    expect(result).toContain('|');
  });

  it('should render full detail with heading and fields', () => {
    const result = renderAccount({
      ...baseAccount,
      Id: '001ABC',
      Phone: '555-1234',
      AnnualRevenue: 5000000,
    }, 'full');
    expect(result).toContain('# Acme Corp');
    expect(result).toContain('Technology');
    expect(result).toContain('Phone: 555-1234');
    expect(result).toContain('$5.0M');
  });
});

// ============================================================================
// Contact rendering tests
// ============================================================================

describe('renderContact', () => {
  const baseContact = {
    Name: 'Alice Johnson',
    Title: 'VP Engineering',
    Email: 'alice@example.com',
    Account: { Name: 'TechCo' },
  };

  it('should render summary as pipe-delimited', () => {
    const result = renderContact(baseContact, 'summary');
    expect(result).toContain('Alice Johnson');
    expect(result).toContain('VP Engineering');
    expect(result).toContain('alice@example.com');
    expect(result).toContain('TechCo');
  });

  it('should render full detail', () => {
    const result = renderContact({
      ...baseContact,
      Id: '003ABC',
      Phone: '555-0000',
      Department: 'Engineering',
    }, 'full');
    expect(result).toContain('# Alice Johnson');
    expect(result).toContain('VP Engineering');
    expect(result).toContain('555-0000');
    expect(result).toContain('Department: Engineering');
    expect(result).toContain('Account: TechCo');
  });

  it('should build name from FirstName + LastName when Name is missing', () => {
    const result = renderContact({ FirstName: 'Bob', LastName: 'Smith' }, 'summary');
    expect(result).toContain('Bob Smith');
  });
});

// ============================================================================
// Generic record rendering tests
// ============================================================================

describe('renderRecord', () => {
  it('should route to renderOpportunity for Opportunity objects', () => {
    const result = renderRecord('Opportunity', { Name: 'Test Opp', StageName: 'Proposal', Amount: 1000 }, 'summary');
    expect(result).toContain('[>] Proposal');
  });

  it('should route to renderAccount for Account objects', () => {
    const result = renderRecord('Account', { Name: 'Test Acct', Industry: 'Tech' }, 'summary');
    expect(result).toContain('Test Acct');
    expect(result).toContain('Tech');
  });

  it('should route to renderContact for Contact objects', () => {
    const result = renderRecord('Contact', { Name: 'Test Person', Email: 'test@x.com' }, 'summary');
    expect(result).toContain('Test Person');
    expect(result).toContain('test@x.com');
  });

  it('should render generic records with available fields', () => {
    const result = renderRecord('CustomObject__c', {
      Id: '123',
      Name: 'Custom Thing',
      Status: 'Active',
    }, 'summary');
    expect(result).toContain('Custom Thing');
    expect(result).toContain('Active');
  });

  it('should render generic full detail with all non-null fields', () => {
    const result = renderRecord('Task', {
      Id: '00T123',
      Subject: 'Follow up',
      Status: 'Open',
      Priority: 'High',
      attributes: { type: 'Task' },
    }, 'full');
    expect(result).toContain('# Task:');
    expect(result).toContain('Status: Open');
    expect(result).toContain('Priority: High');
    expect(result).not.toContain('attributes'); // should skip attributes
  });
});

// ============================================================================
// List rendering tests
// ============================================================================

describe('renderList', () => {
  it('should render a list with heading and count', () => {
    const records = [
      { Name: 'Opp 1', StageName: 'Proposal', Amount: 50000 },
      { Name: 'Opp 2', StageName: 'Closed Won', Amount: 100000 },
    ];
    const result = renderList('Opportunity', records, 'summary');
    expect(result).toContain('# Opportunity (2)');
    expect(result).toContain('Opp 1');
    expect(result).toContain('Opp 2');
  });

  it('should show "No records found" for empty list', () => {
    const result = renderList('Account', [], 'summary');
    expect(result).toContain('No records found');
  });

  it('should include pagination when provided', () => {
    const result = renderList('Opportunity', [{ Name: 'Test' }], 'summary', {
      currentPage: 1,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false,
      totalSize: 75,
      pageSize: 25,
    });
    expect(result).toContain('# Opportunity (75)');
    expect(result).toContain('Page 1/3');
    expect(result).toContain('Next page: pageNumber=2');
  });
});

// ============================================================================
// Query result rendering tests
// ============================================================================

describe('renderQueryResult', () => {
  it('should render query results with total count', () => {
    const result = renderQueryResult({
      totalCount: 2,
      results: [
        { attributes: { type: 'Account' }, Name: 'Acme', Industry: 'Tech' },
        { attributes: { type: 'Account' }, Name: 'Globex', Industry: 'Manufacturing' },
      ],
      pageNumber: 1,
      pageSize: 25,
      totalPages: 1,
    });
    expect(result).toContain('# Query Results');
    expect(result).toContain('Found 2 records');
    expect(result).toContain('Acme');
    expect(result).toContain('Globex');
  });

  it('should show pagination for multi-page results', () => {
    const result = renderQueryResult({
      totalCount: 100,
      results: [{ Name: 'Test' }],
      pageNumber: 2,
      pageSize: 25,
      totalPages: 4,
    });
    expect(result).toContain('Page 2/4');
    expect(result).toContain('Next page: pageNumber=3');
  });

  it('should handle empty results', () => {
    const result = renderQueryResult({ totalCount: 0, results: [] });
    expect(result).toContain('Found 0 records');
    expect(result).toContain('No records returned');
  });

  it('should accept snake_case field names', () => {
    const result = renderQueryResult({
      total_count: 1,
      results: [{ Name: 'Test' }],
      page_number: 1,
      page_size: 25,
      total_pages: 1,
    });
    expect(result).toContain('Found 1 record');
  });
});

// ============================================================================
// Dynamic field projection tests
// ============================================================================

describe('formatFieldValue', () => {
  it('should return null for null/undefined values', () => {
    expect(formatFieldValue('anything', null)).toBeNull();
    expect(formatFieldValue('anything', undefined)).toBeNull();
  });

  it('should skip the attributes key', () => {
    expect(formatFieldValue('attributes', { type: 'Opportunity' })).toBeNull();
  });

  it('should format booleans as Yes/No', () => {
    expect(formatFieldValue('IsActive', true)).toBe('Yes');
    expect(formatFieldValue('IsActive', false)).toBe('No');
  });

  it('should format currency fields using formatAmount', () => {
    expect(formatFieldValue('Services_Revenue__c', 50000)).toBe('$50K');
    expect(formatFieldValue('Total_Amount', 1500000)).toBe('$1.5M');
  });

  it('should format percent fields with % suffix', () => {
    expect(formatFieldValue('Win_Probability__c', 75)).toBe('75%');
  });

  it('should format date-named string fields using formatDate', () => {
    expect(formatFieldValue('LastModifiedDate', '2026-03-15')).toBe('Mar 15, 2026');
  });

  it('should pass through plain numbers', () => {
    expect(formatFieldValue('NumberOfEmployees', 500)).toBe('500');
  });

  it('should pass through plain strings', () => {
    expect(formatFieldValue('Channel_Partner__c', 'Acme')).toBe('Acme');
  });

  it('should extract Name from nested objects', () => {
    expect(formatFieldValue('Account', { Name: 'Acme Corp' })).toBe('Acme Corp');
  });

  it('should return item count for arrays', () => {
    expect(formatFieldValue('Tags', ['a', 'b', 'c'])).toBe('3 items');
  });

  it('should return null for complex nested objects without Name', () => {
    expect(formatFieldValue('SomeBlob', { foo: 'bar' })).toBeNull();
  });

  it('should truncate long string values', () => {
    const longText = 'x'.repeat(300);
    const result = formatFieldValue('Notes__c', longText);
    expect(result!.length).toBeLessThan(210);
    expect(result).toMatch(/\.\.\.$/);
  });
});

describe('humanizeFieldName', () => {
  it('should strip __c suffix', () => {
    expect(humanizeFieldName('Services_Revenue__c')).toBe('Services Revenue');
  });

  it('should split CamelCase', () => {
    expect(humanizeFieldName('LastModifiedDate')).toBe('Last Modified Date');
  });

  it('should replace underscores with spaces', () => {
    expect(humanizeFieldName('Channel_Partner')).toBe('Channel Partner');
  });

  it('should handle combined patterns', () => {
    expect(humanizeFieldName('MyCustomField__c')).toBe('My Custom Field');
  });
});

describe('projectRemainingFields', () => {
  it('should emit fields not in consumed set', () => {
    const record = { Id: '001', Name: 'Test', Custom__c: 'value', Other: 42 };
    const consumed = new Set(['Id', 'Name']);
    const result = projectRemainingFields(record, consumed);
    expect(result).toContain('Custom: value');
    expect(result).toContain('Other: 42');
  });

  it('should skip null values', () => {
    const record = { Id: '001', Empty__c: null, Filled__c: 'yes' };
    const consumed = new Set(['Id']);
    const result = projectRemainingFields(record, consumed);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Filled: yes');
  });

  it('should return empty array when all fields are consumed', () => {
    const record = { Id: '001', Name: 'Test' };
    const consumed = new Set(['Id', 'Name']);
    expect(projectRemainingFields(record, consumed)).toHaveLength(0);
  });
});

describe('renderOpportunity dynamic projection', () => {
  it('should include custom __c fields in full rendering', () => {
    const opp = {
      Name: 'Test Deal',
      Id: '006ABC',
      StageName: 'Proposal',
      Amount: 100000,
      Owner: { Name: 'Jane' },
      CloseDate: '2026-06-15',
      Services_Revenue__c: 75000,
      Channel_Partner__c: 'Atlassian',
      Interest__c: 'Jira;Confluence',
    };
    const result = renderOpportunity(opp, 'full');
    expect(result).toContain('Services Revenue: $75K');
    expect(result).toContain('Channel Partner: Atlassian');
    expect(result).toContain('Interest: Jira;Confluence');
  });

  it('should not duplicate fields already in the hardcoded template', () => {
    const opp = {
      Name: 'Test Deal',
      StageName: 'Proposal',
      Amount: 100000,
      Probability: 50,
      Custom__c: 'extra',
    };
    const result = renderOpportunity(opp, 'full');
    // Probability should appear once (from hardcoded section), not twice
    const probMatches = result.match(/Probability/g);
    expect(probMatches).toHaveLength(1);
  });

  it('should not show null custom fields', () => {
    const opp = {
      Name: 'Test Deal',
      StageName: 'Proposal',
      Amount: 100000,
      Services_Revenue__c: null,
      Channel_Partner__c: null,
    };
    const result = renderOpportunity(opp, 'full');
    expect(result).not.toContain('Services Revenue');
    expect(result).not.toContain('Channel Partner');
  });
});

describe('renderAccount dynamic projection', () => {
  it('should include custom fields in full rendering', () => {
    const account = {
      Name: 'Acme Corp',
      Id: '001ABC',
      Industry: 'Tech',
      SLA__c: 'Gold',
      Region__c: 'EMEA',
    };
    const result = renderAccount(account, 'full');
    expect(result).toContain('SLA: Gold');
    expect(result).toContain('Region: EMEA');
  });
});

describe('renderContact dynamic projection', () => {
  it('should include custom fields in full rendering', () => {
    const contact = {
      Name: 'Alice',
      Id: '003ABC',
      Title: 'VP',
      Email: 'alice@co.com',
      Preferred_Language__c: 'French',
    };
    const result = renderContact(contact, 'full');
    expect(result).toContain('Preferred Language: French');
  });
});

describe('renderRecord generic with formatFieldValue', () => {
  it('should format currency-named fields in full mode', () => {
    const result = renderRecord('CustomObj', {
      Id: '123',
      Name: 'Thing',
      Total_Revenue__c: 250000,
      Active__c: true,
    }, 'full');
    expect(result).toContain('Total Revenue: $250K');
    expect(result).toContain('Active: Yes');
  });
});

// ============================================================================
// MarkdownRenderer export
// ============================================================================

describe('MarkdownRenderer', () => {
  it('should expose all renderers', () => {
    expect(MarkdownRenderer.renderOpportunity).toBe(renderOpportunity);
    expect(MarkdownRenderer.renderAccount).toBe(renderAccount);
    expect(MarkdownRenderer.renderContact).toBe(renderContact);
    expect(MarkdownRenderer.renderRecord).toBe(renderRecord);
    expect(MarkdownRenderer.renderList).toBe(renderList);
    expect(MarkdownRenderer.renderQueryResult).toBe(renderQueryResult);
  });

  it('should expose helper functions', () => {
    expect(MarkdownRenderer.helpers.formatDate).toBe(formatDate);
    expect(MarkdownRenderer.helpers.formatStatus).toBe(formatStatus);
    expect(MarkdownRenderer.helpers.truncate).toBe(truncate);
    expect(MarkdownRenderer.helpers.stripHtml).toBe(stripHtml);
    expect(MarkdownRenderer.helpers.formatAmount).toBe(formatAmount);
  });
});
