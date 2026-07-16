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
import { CORE_OBJECTS } from '../utils/discovery-constants.js';
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

/**
 * Resolve an object name to the key its catalog is stored under.
 *
 * SOQL is case-insensitive, so an agent will write `opportunity` as readily as
 * `Opportunity`, but the catalog is keyed by exact API name. Matching the
 * spelling as written would miss the cache and re-discover the object under a
 * second key — which is worse than slow: `allCatalogs()` would then return
 * every Opportunity field twice, and the duplicate's promoted fields would push
 * the global budget further past its cap, demoting fields on *other* objects.
 * A read-only search must not degrade the hints on unrelated surfaces.
 */
function canonicalObjectName(fd: FieldDiscovery, objectName: string): string {
  if (fd.getCatalog(objectName)) return objectName;
  return CORE_OBJECTS.find(o => o.toLowerCase() === objectName.toLowerCase()) ?? objectName;
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
  // Number.isFinite, not typeof: NaN is a number, and it survives the clamp
  // (Math.min(NaN, 100) is NaN) all the way to slice(0, NaN), which returns []
  // and renders as "no fields matched" — a plumbing failure dressed up as a
  // claim about the org's schema.
  const limit = Number.isFinite(args.limit as number)
    ? Math.max(1, Math.min(args.limit as number, MAX_SEARCH_LIMIT))
    : DEFAULT_SEARCH_LIMIT;
  const minPopulationPct = Number.isFinite(args.minPopulationPct as number)
    ? Math.max(0, Math.min(args.minPopulationPct as number, 100))
    : undefined;

  if (args.objectName !== undefined && typeof args.objectName !== 'string') {
    throw new McpError(
      ErrorCode.InvalidParams,
      'search_fields `objectName` must be a string',
    );
  }

  // Same shape as the catalog resource's guard (index.ts): an object name is
  // interpolated into SOQL during discovery, so validate it here rather than
  // relying on describe() to reject it first.
  if (args.objectName !== undefined && !/^[A-Za-z]\w*$/.test(args.objectName)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid Salesforce object name: "${args.objectName}"`,
    );
  }

  const objectName = args.objectName ? canonicalObjectName(fd, args.objectName) : undefined;

  // Scope to one object on request — discovering it on demand if the startup
  // sweep hasn't reached it, exactly as the catalog resource does.
  if (objectName && !fd.getCatalog(objectName)) {
    await fd.discoverObject(objectName);
  }

  const candidates = candidatesFrom(fd, objectName);

  // Nothing to search means discovery hasn't landed (or the named object
  // couldn't be discovered). Say so rather than returning a bare "0 matches",
  // which reads as "this org has no AI field" — a confidently wrong answer.
  if (candidates.length === 0) {
    const scope = objectName ? ` for ${objectName}` : '';
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
    ...(minPopulationPct !== undefined ? { minPopulationPct } : {}),
  });

  if (hits.length === 0) {
    const scope = objectName ? ` on ${objectName}` : ' on any discovered object';
    return simpleResponse(
      `No fields${scope} matched "${args.term}". The match is lexical — it looks ` +
      `at field API names, labels, and help text — so a concept named differently ` +
      `in the schema won't surface. Try a synonym, or read the full catalog: ` +
      `\`salesforce://field-catalog/${objectName ?? '{object}'}/all\`.`,
      'search_fields',
    );
  }

  return simpleResponse(renderHits(args.term, hits, includeValues), 'search_fields');
}
