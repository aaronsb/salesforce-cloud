/**
 * Analyze handler (ADR-101) — budget-aware analytics with field-type validation.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SalesforceClient } from '../client/salesforce-client.js';
import { buildFieldTypeMap, getGroupByFields, getAggregateFields } from '../utils/field-type-map.js';
import { parseComputeList, evaluateRow } from '../utils/cube-dsl.js';

const MAX_GROUPS = 100;

interface AnalyzeParams {
  object: string;
  filter?: string;
  groupBy?: string;
  compute?: string[];
  maxGroups?: number;
}

function isAnalyzeParams(obj: any): obj is AnalyzeParams {
  return typeof obj === 'object' && obj !== null && typeof obj.object === 'string';
}

/**
 * Validate and sanitize filter input.
 * Rejects obviously dangerous patterns while allowing valid SOQL WHERE clauses.
 */
function sanitizeFilter(filter: string): string {
  // Reject semicolons, comments, and DML keywords
  if (/;|--|\/\*|\*\/|INSERT|UPDATE|DELETE|UPSERT|MERGE/i.test(filter)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Filter contains disallowed characters or keywords.',
    );
  }
  return filter.trim();
}

export async function handleAnalyze(client: SalesforceClient, args: any) {
  if (!isAnalyzeParams(args)) {
    throw new McpError(ErrorCode.InvalidParams, 'object is required');
  }

  const { object, groupBy, compute } = args;
  const maxGroups = Math.min(args.maxGroups ?? 20, MAX_GROUPS);

  // Validate object name
  if (!/^[a-zA-Z_]\w*$/.test(object)) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid object name: "${object}"`);
  }

  // Sanitize filter if provided
  const filter = args.filter ? sanitizeFilter(args.filter) : undefined;

  // Get object metadata for field type validation
  const metadata = await client.describeObject(object, true);
  const fieldMap = buildFieldTypeMap(metadata as any);

  // Validate groupBy field
  if (groupBy) {
    const validGroupBy = getGroupByFields(fieldMap).map(f => f.fieldName);
    if (!validGroupBy.includes(groupBy)) {
      const suggestions = validGroupBy.slice(0, 5).join(', ');
      throw new McpError(
        ErrorCode.InvalidParams,
        `"${groupBy}" is not a valid group-by field for ${object}. Valid fields include: ${suggestions}`,
      );
    }
  }

  const whereClause = filter ? ` WHERE ${filter}` : '';

  if (groupBy) {
    // Grouped analysis — count per group, with explicit aliases
    const numericFields = getAggregateFields(fieldMap).map(f => f.fieldName).slice(0, 3);
    const aggExprs = numericFields.map(f => `SUM(${f}) sum_${f}, AVG(${f}) avg_${f}`).join(', ');
    const aggPart = aggExprs ? `, ${aggExprs}` : '';

    const query = `SELECT ${groupBy}, COUNT(Id) cnt${aggPart} FROM ${object}${whereClause} GROUP BY ${groupBy} ORDER BY COUNT(Id) DESC LIMIT ${maxGroups}`;

    const result = await client.executeQuery(query);
    const rows = (result.results || []) as Array<Record<string, unknown>>;

    const lines: string[] = [`## ${object} by ${groupBy}`];
    lines.push(`${rows.length} groups | filter: ${filter || 'none'}`);
    lines.push('');

    if (rows.length > 0) {
      const keys = Object.keys(rows[0]).filter(k => k !== 'attributes');
      lines.push(keys.join(' | '));
      lines.push(keys.map(() => '---').join(' | '));

      for (const row of rows) {
        const vals = keys.map(k => {
          const v = row[k];
          return v != null ? String(v) : '';
        });
        lines.push(vals.join(' | '));
      }
    }

    // Apply compute expressions if provided
    if (compute && compute.length > 0) {
      const expressions = parseComputeList(compute);
      lines.push('');
      lines.push('## Computed');

      for (const row of rows) {
        const values = new Map<string, number>();
        for (const [k, v] of Object.entries(row)) {
          if (typeof v === 'number') values.set(k, v);
        }
        const results = evaluateRow(expressions, values);
        const groupLabel = row[groupBy] || 'Other';
        const computedParts = results.map(r => `${r.name}=${r.value}`).join(', ');
        lines.push(`${groupLabel}: ${computedParts}`);
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  // Ungrouped — summary counts
  const countQuery = `SELECT COUNT(Id) cnt FROM ${object}${whereClause}`;
  const countResult = await client.executeQuery(countQuery);
  const total = ((countResult.results?.[0] as Record<string, unknown>)?.cnt as number) || 0;

  const numericFields = getAggregateFields(fieldMap).map(f => f.fieldName).slice(0, 5);
  const lines: string[] = [`## ${object} Summary`];
  lines.push(`**Total records:** ${total}`);
  lines.push(`**Filter:** ${filter || 'none'}`);

  if (numericFields.length > 0 && total > 0) {
    // Use explicit aliases so we can read results reliably
    const aggParts = numericFields.map(f =>
      `SUM(${f}) sum_${f}, AVG(${f}) avg_${f}, MIN(${f}) min_${f}, MAX(${f}) max_${f}`
    ).join(', ');
    const aggQuery = `SELECT ${aggParts} FROM ${object}${whereClause}`;
    try {
      const aggResult = await client.executeQuery(aggQuery);
      const agg = (aggResult.results?.[0] || {}) as Record<string, unknown>;
      lines.push('');
      lines.push('## Numeric Fields');
      lines.push('Field | Sum | Avg | Min | Max');
      lines.push('--- | --- | --- | --- | ---');
      for (const f of numericFields) {
        const sum = agg[`sum_${f}`] ?? '';
        const avg = agg[`avg_${f}`] ?? '';
        const min = agg[`min_${f}`] ?? '';
        const max = agg[`max_${f}`] ?? '';
        lines.push(`${f} | ${sum} | ${avg} | ${min} | ${max}`);
      }
    } catch {
      lines.push('\n*Aggregate query failed — some fields may not support aggregation.*');
    }
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
