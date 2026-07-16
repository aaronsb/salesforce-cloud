/**
 * ADR-302 Field Search handler — the concept→field entry point.
 *
 * Turns a free-text term into a ranked list of the fields that carry it, drawn
 * from the discovered catalogs (ADR-300). This is the step that was otherwise a
 * fetch-the-whole-catalog-and-grep-it chore, collapsed into one call — and, with
 * `includeValues`, it folds in the follow-up round-trip too: a matched picklist
 * comes back with its value set, so the agent can write `WHERE Field = 'Yes'`
 * without a separate probe.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { FieldDiscovery } from '../client/field-discovery.js';
import {
  searchFields, FieldSearchInput, FieldSearchHit,
  DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT,
} from '../utils/field-search.js';
import { simpleResponse } from '../utils/response-helper.js';

interface SearchFieldsParams {
  term: string;
  objectName?: string;
  includeValues?: boolean;
  minPopulationPct?: number;
  limit?: number;
}

function isSearchFieldsParams(obj: any): obj is SearchFieldsParams {
  return typeof obj === 'object' && obj !== null &&
    typeof obj.term === 'string' && obj.term.trim() !== '';
}

/** Flatten a set of catalogs into the (object, field) pairs the matcher wants. */
function candidatesFrom(fd: FieldDiscovery, objectName?: string): FieldSearchInput[] {
  const catalogs = objectName
    ? [fd.getCatalog(objectName)].filter((c): c is NonNullable<typeof c> => !!c)
    : fd.allCatalogs();

  const inputs: FieldSearchInput[] = [];
  for (const catalog of catalogs) {
    for (const field of catalog.fields) {
      inputs.push({ objectName: catalog.objectName, field });
    }
  }
  return inputs;
}

function renderHits(term: string, hits: FieldSearchHit[], includeValues: boolean): string {
  const lines: string[] = [`# Field search: "${term}" — ${hits.length} match${hits.length === 1 ? '' : 'es'}`];
  lines.push('');

  const header = ['Object', 'Field', 'Label', 'Type', 'Pop%', 'Promoted', 'Matched'];
  if (includeValues) header.push('Values');
  lines.push(header.join(' | '));
  lines.push(header.map(() => '---').join(' | '));

  for (const h of hits) {
    const row = [
      h.object,
      h.name,
      h.label || '',
      h.type,
      h.populationPct != null ? String(h.populationPct) : '—',
      h.promoted ? 'yes' : 'no',
      h.matchedOn.join('+'),
    ];
    if (includeValues) {
      row.push(h.values ? h.values.join(', ') : '—');
    }
    lines.push(row.join(' | '));
  }

  return lines.join('\n');
}

export async function handleSearchFields(fd: FieldDiscovery, args: any) {
  if (!isSearchFieldsParams(args)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'search_fields requires a non-empty `term` string',
    );
  }

  const includeValues = args.includeValues === true;
  const limit = typeof args.limit === 'number'
    ? Math.max(1, Math.min(args.limit, MAX_SEARCH_LIMIT))
    : DEFAULT_SEARCH_LIMIT;

  // Scope to one object on request — discovering it on demand if the startup
  // sweep hasn't reached it, exactly as the catalog resource does.
  if (args.objectName && !fd.getCatalog(args.objectName)) {
    await fd.discoverObject(args.objectName);
  }

  const candidates = candidatesFrom(fd, args.objectName);

  // Nothing to search means discovery hasn't landed (or the named object
  // couldn't be discovered). Say so rather than returning a bare "0 matches",
  // which reads as "this org has no AI field" — a confidently wrong answer.
  if (candidates.length === 0) {
    const scope = args.objectName ? ` for ${args.objectName}` : '';
    return simpleResponse(
      `No field catalog is available${scope} yet — discovery may still be in ` +
      `progress. Read \`salesforce://field-catalog/_stats\` to check status, ` +
      `or retry shortly.`,
      'search_fields',
    );
  }

  const hits = searchFields(args.term, candidates, {
    includeValues,
    limit,
    ...(typeof args.minPopulationPct === 'number' ? { minPopulationPct: args.minPopulationPct } : {}),
  });

  if (hits.length === 0) {
    const scope = args.objectName ? ` on ${args.objectName}` : ' on any discovered object';
    return simpleResponse(
      `No fields${scope} matched "${args.term}". The match is lexical — it looks ` +
      `at field API names, labels, and help text — so a concept named differently ` +
      `in the schema won't surface. Try a synonym, or read the full catalog: ` +
      `\`salesforce://field-catalog/${args.objectName ?? '{object}'}/all\`.`,
      'search_fields',
    );
  }

  return simpleResponse(renderHits(args.term, hits, includeValues), 'search_fields');
}
