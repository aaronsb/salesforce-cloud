/**
 * Markdown renderer for Salesforce MCP tool responses.
 *
 * Converts structured JSON responses to token-efficient markdown
 * optimized for AI assistant consumption.
 *
 * Design principles:
 * - Minimal tokens, maximum clarity
 * - Pipe-delimited summaries for list results
 * - Status indicators: [x] done, [>] in-progress, [ ] open
 * - Token-conscious truncation of long text fields
 */

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a date string to a compact, readable format.
 * Handles date-only strings (YYYY-MM-DD) without timezone shifting.
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Not set';
  const dateOnly = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Format an opportunity stage with a visual status indicator.
 * [x] = closed/won, [>] = in-progress, [ ] = open/early stage
 */
export function formatStatus(stage: string | null | undefined): string {
  if (!stage) return '[?] Unknown';
  const lower = stage.toLowerCase();

  if (lower.includes('closed won') || lower.includes('closed-won')) return `[x] ${stage}`;
  if (lower.includes('closed')) return `[x] ${stage}`;
  if (
    lower.includes('negotiation') ||
    lower.includes('proposal') ||
    lower.includes('review') ||
    lower.includes('in progress')
  ) return `[>] ${stage}`;

  return `[ ] ${stage}`;
}

/**
 * Truncate text to a maximum length, collapsing newlines.
 */
export function truncate(text: string | null | undefined, maxLen: number = 150): string {
  if (!text) return '';
  const cleaned = text.replace(/\n+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.substring(0, maxLen).trim() + '...';
}

/**
 * Strip HTML tags and decode common entities.
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Format a currency amount with compact notation.
 */
export function formatAmount(amount: number | null | undefined): string {
  if (amount == null) return 'N/A';
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ============================================================================
// Pagination rendering
// ============================================================================

export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  totalSize?: number;
  pageSize?: number;
}

function renderPagination(pagination: PaginationInfo): string {
  const lines: string[] = [];
  lines.push('---');
  const total = pagination.totalSize != null ? ` of ${pagination.totalSize}` : '';
  lines.push(`Page ${pagination.currentPage}/${pagination.totalPages}${total}`);
  if (pagination.hasNextPage) {
    lines.push(`**Next page:** pageNumber=${pagination.currentPage + 1}`);
  }
  return lines.join('\n');
}

// ============================================================================
// Opportunity rendering
// ============================================================================

 

export function renderOpportunity(opp: Record<string, any>, detail: 'summary' | 'full' = 'summary'): string {
  if (detail === 'summary') {
    const parts = [
      opp.Name || opp.name || 'Unnamed',
      formatStatus(opp.StageName || opp.stage),
      formatAmount(opp.Amount ?? opp.amount),
      opp.Owner?.Name || opp.owner?.name || 'No owner',
      opp.CloseDate || opp.close_date ? formatDate(opp.CloseDate || opp.close_date) : null,
    ].filter(Boolean);
    return parts.join(' | ');
  }

  // Full detail rendering
  const lines: string[] = [];
  const name = opp.Name || opp.name || 'Unnamed Opportunity';
  const id = opp.Id || opp.id || '';
  lines.push(`# ${name}`);
  if (id) lines.push(`ID: ${id}`);
  lines.push('');

  // Core fields
  lines.push(`**Stage:** ${formatStatus(opp.StageName || opp.stage)}`);
  lines.push(`**Amount:** ${formatAmount(opp.Amount ?? opp.amount)}`);
  if ((opp.Probability ?? opp.probability) != null) lines.push(`**Probability:** ${opp.Probability ?? opp.probability}%`);
  if (opp.CloseDate || opp.close_date) lines.push(`**Close Date:** ${formatDate(opp.CloseDate || opp.close_date)}`);
  if (opp.Type || opp.type) lines.push(`**Type:** ${opp.Type || opp.type}`);
  if (opp.LeadSource || opp.lead_source) lines.push(`**Lead Source:** ${opp.LeadSource || opp.lead_source}`);
  if (opp.ForecastCategory || opp.forecast_category) lines.push(`**Forecast:** ${opp.ForecastCategory || opp.forecast_category}`);
  if ((opp.ExpectedRevenue ?? opp.expected_revenue) != null) lines.push(`**Expected Revenue:** ${formatAmount(opp.ExpectedRevenue ?? opp.expected_revenue)}`);
  if (opp.NextStep || opp.next_step) lines.push(`**Next Step:** ${opp.NextStep || opp.next_step}`);
  if (opp.LastActivityDate || opp.last_activity_date) lines.push(`**Last Activity:** ${formatDate(opp.LastActivityDate || opp.last_activity_date)}`);

  const isClosed = opp.IsClosed ?? opp.is_closed;
  const isWon = opp.IsWon ?? opp.is_won;
  if (isClosed != null) lines.push(`**Closed:** ${isClosed ? 'Yes' : 'No'} | **Won:** ${isWon ? 'Yes' : 'No'}`);

  // Description
  const desc = opp.Description || opp.description;
  if (desc) {
    lines.push('');
    lines.push('## Description');
    lines.push(truncate(stripHtml(desc), 500));
  }

  // Account
  const account = opp.Account || opp.account;
  if (account) {
    lines.push('');
    lines.push('## Account');
    const accParts = [account.Name || account.name];
    if (account.Industry || account.industry) accParts.push(account.Industry || account.industry);
    if (account.Website || account.website) accParts.push(account.Website || account.website);
    lines.push(accParts.filter(Boolean).join(' | '));
  }

  // Owner
  const owner = opp.Owner || opp.owner;
  if (owner) {
    lines.push('');
    lines.push('## Owner');
    const ownerParts = [owner.Name || owner.name, owner.Email || owner.email].filter(Boolean);
    lines.push(ownerParts.join(' | '));
  }

  // Contacts
  const contacts = opp.contacts || opp.OpportunityContactRoles?.records;
  if (contacts && contacts.length > 0) {
    lines.push('');
    lines.push(`## Contacts (${contacts.length})`);
    for (const c of contacts) {
      const cName = c.name || c.Contact?.Name || 'Unknown';
      const cEmail = c.email || c.Contact?.Email || '';
      const cRole = c.role || c.Role || '';
      lines.push(`- ${cName}${cRole ? ` (${cRole})` : ''}${cEmail ? ` | ${cEmail}` : ''}`);
    }
  }

  // History
  const history = opp.history || opp.Histories?.records;
  if (history && history.length > 0) {
    lines.push('');
    lines.push(`## History (${history.length})`);
    const recent = history.slice(0, 10);
    for (const h of recent) {
      const date = formatDate(h.date || h.CreatedDate);
      const field = h.field || h.Field;
      const oldVal = h.old_value ?? h.OldValue ?? '';
      const newVal = h.new_value ?? h.NewValue ?? '';
      lines.push(`- ${date}: ${field}: ${oldVal} -> ${newVal}`);
    }
    if (history.length > 10) lines.push(`  +${history.length - 10} older entries`);
  }

  // Tasks
  const tasks = opp.tasks || opp.Tasks?.records;
  if (tasks && tasks.length > 0) {
    lines.push('');
    lines.push(`## Tasks (${tasks.length})`);
    const recent = tasks.slice(0, 5);
    for (const t of recent) {
      const subject = t.subject || t.Subject;
      const status = t.status || t.Status;
      const priority = t.priority || t.Priority;
      lines.push(`- ${subject} | ${status} | ${priority}`);
    }
    if (tasks.length > 5) lines.push(`  +${tasks.length - 5} more tasks`);
  }

  // Notes
  const notes = opp.notes || opp.Notes?.records;
  if (notes && notes.length > 0) {
    lines.push('');
    lines.push(`## Notes (${notes.length})`);
    const recent = notes.slice(0, 5);
    for (const n of recent) {
      const title = n.title || n.Title;
      const body = n.body || n.Body;
      const createdBy = n.created_by || n.CreatedBy?.Name || '';
      lines.push(`- **${title}**${createdBy ? ` (${createdBy})` : ''}: ${truncate(stripHtml(body), 100)}`);
    }
    if (notes.length > 5) lines.push(`  +${notes.length - 5} more notes`);
  }

  return lines.join('\n');
}

// ============================================================================
// Account rendering
// ============================================================================

export function renderAccount(account: Record<string, any>, detail: 'summary' | 'full' = 'summary'): string {
  if (detail === 'summary') {
    const parts = [
      account.Name || account.name || 'Unnamed',
      account.Industry || account.industry || null,
      account.Type || account.type || null,
      account.Website || account.website || null,
    ].filter(Boolean);
    return parts.join(' | ');
  }

  const lines: string[] = [];
  const name = account.Name || account.name || 'Unnamed Account';
  lines.push(`# ${name}`);
  if (account.Id || account.id) lines.push(`ID: ${account.Id || account.id}`);
  lines.push('');

  if (account.Industry || account.industry) lines.push(`**Industry:** ${account.Industry || account.industry}`);
  if (account.Type || account.type) lines.push(`**Type:** ${account.Type || account.type}`);
  if (account.Website || account.website) lines.push(`**Website:** ${account.Website || account.website}`);
  if (account.Phone || account.phone) lines.push(`**Phone:** ${account.Phone || account.phone}`);
  if (account.AnnualRevenue ?? account.annual_revenue) lines.push(`**Annual Revenue:** ${formatAmount(account.AnnualRevenue ?? account.annual_revenue)}`);
  if (account.NumberOfEmployees ?? account.number_of_employees) lines.push(`**Employees:** ${account.NumberOfEmployees ?? account.number_of_employees}`);

  const owner = account.Owner || account.owner;
  if (owner) {
    lines.push(`**Owner:** ${owner.Name || owner.name || 'Unknown'}`);
  }

  const desc = account.Description || account.description;
  if (desc) {
    lines.push('');
    lines.push('## Description');
    lines.push(truncate(stripHtml(desc), 500));
  }

  const address = account.BillingAddress || account.billing_address;
  if (address) {
    lines.push('');
    lines.push('## Billing Address');
    const addrParts = [address.street, address.city, address.state, address.postalCode, address.country].filter(Boolean);
    lines.push(addrParts.join(', '));
  }

  return lines.join('\n');
}

// ============================================================================
// Contact rendering
// ============================================================================

export function renderContact(contact: Record<string, any>, detail: 'summary' | 'full' = 'summary'): string {
  if (detail === 'summary') {
    const name = contact.Name || contact.name || [contact.FirstName, contact.LastName].filter(Boolean).join(' ') || 'Unnamed';
    const parts = [
      name,
      contact.Title || contact.title || null,
      contact.Email || contact.email || null,
      contact.Account?.Name || contact.account?.name || null,
    ].filter(Boolean);
    return parts.join(' | ');
  }

  const lines: string[] = [];
  const name = contact.Name || contact.name || [contact.FirstName, contact.LastName].filter(Boolean).join(' ') || 'Unnamed Contact';
  lines.push(`# ${name}`);
  if (contact.Id || contact.id) lines.push(`ID: ${contact.Id || contact.id}`);
  lines.push('');

  if (contact.Title || contact.title) lines.push(`**Title:** ${contact.Title || contact.title}`);
  if (contact.Email || contact.email) lines.push(`**Email:** ${contact.Email || contact.email}`);
  if (contact.Phone || contact.phone) lines.push(`**Phone:** ${contact.Phone || contact.phone}`);
  if (contact.MobilePhone || contact.mobile_phone) lines.push(`**Mobile:** ${contact.MobilePhone || contact.mobile_phone}`);
  if (contact.Department || contact.department) lines.push(`**Department:** ${contact.Department || contact.department}`);

  const account = contact.Account || contact.account;
  if (account) {
    lines.push(`**Account:** ${account.Name || account.name || 'Unknown'}`);
  }

  const owner = contact.Owner || contact.owner;
  if (owner) {
    lines.push(`**Owner:** ${owner.Name || owner.name || 'Unknown'}`);
  }

  const desc = contact.Description || contact.description;
  if (desc) {
    lines.push('');
    lines.push('## Description');
    lines.push(truncate(stripHtml(desc), 500));
  }

  return lines.join('\n');
}

// ============================================================================
// Generic record rendering
// ============================================================================

export function renderRecord(objectName: string, record: Record<string, any>, detail: 'summary' | 'full' = 'summary'): string {
  // Route to specialized renderers when object type is known
  const objLower = objectName.toLowerCase();
  if (objLower === 'opportunity') return renderOpportunity(record, detail);
  if (objLower === 'account') return renderAccount(record, detail);
  if (objLower === 'contact') return renderContact(record, detail);

  if (detail === 'summary') {
    const name = record.Name || record.name || record.Id || record.id || 'Record';
    const parts = [name];
    // Include a few key fields if present
    if (record.Status || record.status) parts.push(record.Status || record.status);
    if (record.Type || record.type) parts.push(record.Type || record.type);
    if (record.Owner?.Name || record.owner?.name) parts.push(record.Owner?.Name || record.owner?.name);
    return parts.join(' | ');
  }

  // Full rendering: enumerate all non-null fields
  const lines: string[] = [];
  const name = record.Name || record.name || objectName;
  lines.push(`# ${objectName}: ${name}`);
  if (record.Id || record.id) lines.push(`ID: ${record.Id || record.id}`);
  lines.push('');

  for (const [key, value] of Object.entries(record)) {
    if (value == null) continue;
    if (key === 'attributes') continue; // Salesforce metadata field
    if (typeof value === 'object') {
      // Nested object — render inline
      if (Array.isArray(value)) {
        lines.push(`**${key}:** ${value.length} items`);
      } else if (value.Name || value.name) {
        lines.push(`**${key}:** ${value.Name || value.name}`);
      }
    } else {
      lines.push(`**${key}:** ${value}`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// List rendering
// ============================================================================

export function renderList(
  objectName: string,
  records: Record<string, any>[],
  detail: 'summary' | 'full' = 'summary',
  pagination?: PaginationInfo
): string {
  const lines: string[] = [];

  lines.push(`# ${objectName} (${pagination?.totalSize ?? records.length})`);
  lines.push('');

  if (records.length === 0) {
    lines.push('No records found.');
  } else if (detail === 'summary') {
    for (const record of records) {
      lines.push(renderRecord(objectName, record, 'summary'));
    }
  } else {
    for (let i = 0; i < records.length; i++) {
      if (i > 0) lines.push('');
      lines.push(renderRecord(objectName, records[i], 'full'));
    }
  }

  if (pagination) {
    lines.push('');
    lines.push(renderPagination(pagination));
  }

  return lines.join('\n');
}

// ============================================================================
// SOQL query result rendering
// ============================================================================

export function renderQueryResult(
  queryResult: {
    totalCount?: number;
    total_count?: number;
    results?: Record<string, any>[];
    records?: Record<string, any>[];
    pageNumber?: number;
    page_number?: number;
    pageSize?: number;
    page_size?: number;
    totalPages?: number;
    total_pages?: number;
  },
  detail: 'summary' | 'full' = 'summary'
): string {
  const records = queryResult.results || queryResult.records || [];
  const totalCount = queryResult.totalCount ?? queryResult.total_count ?? records.length;
  const pageNumber = queryResult.pageNumber ?? queryResult.page_number ?? 1;
  const pageSize = queryResult.pageSize ?? queryResult.page_size ?? records.length;
  const totalPages = queryResult.totalPages ?? queryResult.total_pages ?? 1;

  const lines: string[] = [];

  lines.push(`# Query Results`);
  lines.push(`Found ${totalCount} record${totalCount !== 1 ? 's' : ''}`);
  lines.push('');

  if (records.length === 0) {
    lines.push('No records returned.');
  } else {
    // Detect the object type from the first record's attributes if available
    const objectName = records[0]?.attributes?.type || 'Record';

    for (const record of records) {
      lines.push(renderRecord(objectName, record, detail));
    }
  }

  // Pagination
  if (totalPages > 1) {
    lines.push('');
    lines.push(renderPagination({
      currentPage: pageNumber,
      totalPages,
      hasNextPage: pageNumber < totalPages,
      hasPreviousPage: pageNumber > 1,
      totalSize: totalCount,
      pageSize,
    }));
  }

  return lines.join('\n');
}

// ============================================================================
// Export convenience object
// ============================================================================

export const MarkdownRenderer = {
  renderOpportunity,
  renderAccount,
  renderContact,
  renderRecord,
  renderList,
  renderQueryResult,
  helpers: {
    formatStatus,
    truncate,
    stripHtml,
    formatDate,
    formatAmount,
  },
};
