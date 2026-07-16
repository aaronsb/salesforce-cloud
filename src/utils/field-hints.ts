/**
 * ADR-300 Field Hints — surface the discovered catalog in the responses the
 * agent is already reading.
 *
 * Discovery runs at startup and ranks every field on the core objects, but a
 * catalog the agent has to go and fetch is a catalog it won't use: it will
 * reach for `describe_object` instead, and pay a recon round-trip before it
 * can start the work it was asked to do. The server already knows the schema,
 * so it answers the question before it is asked — inline, at the moment the
 * agent needs it.
 *
 * Two moments matter:
 *   - A query succeeded → leave a breadcrumb naming the top fields, so the
 *     next query can be written without a describe.
 *   - A query failed on a bad field → name the fields that *do* exist, so the
 *     agent self-corrects instead of falling back to describe.
 *
 * These are breadcrumbs, not dumps (ADR-214): a bounded list plus a pointer to
 * the full catalog resource, never the whole field set.
 */

import type { ObjectCatalog } from '../client/field-discovery.js';
import { CORE_OBJECTS } from './discovery-constants.js';

/** The slice of FieldDiscovery these helpers need. Structural, so tests can fake it. */
export interface CatalogSource {
  getCatalog(objectName: string): ObjectCatalog | undefined;
}

/** Field names to name inline before deferring to the catalog resource. */
export const HINT_FIELD_LIMIT = 15;

/**
 * Extract the object names a SOQL statement reads from.
 *
 * Covers the main FROM plus subquery FROMs; deduplicated, in first-seen order.
 */
export function extractObjectNames(soql: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of soql.matchAll(/\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) {
    const name = match[1];
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

/**
 * Resolve a catalog for an object named in SOQL.
 *
 * SOQL is case-insensitive but the catalog is keyed by the exact API name, so
 * `from account` would miss on a straight lookup. Try the name as written,
 * then fall back to a case-insensitive match against the known core objects.
 */
function findCatalog(source: CatalogSource, objectName: string): ObjectCatalog | undefined {
  const exact = source.getCatalog(objectName);
  if (exact) return exact;

  const canonical = CORE_OBJECTS.find(o => o.toLowerCase() === objectName.toLowerCase());
  return canonical ? source.getCatalog(canonical) : undefined;
}

/**
 * A one-line breadcrumb naming an object's top-ranked fields.
 *
 * Returns '' when the object has not been discovered — a hint that isn't
 * grounded in the catalog is worse than no hint.
 */
export function buildFieldHint(source: CatalogSource, objectName: string): string {
  const catalog = findCatalog(source, objectName);
  if (!catalog || catalog.promoted.length === 0) return '';

  const shown = catalog.promoted.slice(0, HINT_FIELD_LIMIT).map(s => s.field.name);
  const remaining = catalog.promoted.length - shown.length;
  const more = remaining > 0 ? `, +${remaining} more` : '';

  return (
    `${catalog.objectName} fields ranked by usage (${catalog.promoted.length} of ${catalog.totalFields}): ` +
    `${shown.join(', ')}${more}. ` +
    `Full catalog: \`salesforce://field-catalog/${catalog.objectName}/all\``
  );
}

/**
 * Breadcrumbs for every discovered object a query touched, ready to append to
 * a successful response. Empty when nothing is discovered yet.
 */
export function buildQueryFieldHints(source: CatalogSource, soql: string): string {
  const hints = extractObjectNames(soql)
    .map(name => buildFieldHint(source, name))
    .filter(Boolean);
  if (hints.length === 0) return '';
  return `\n\n---\n${hints.map(h => `- ${h}`).join('\n')}`;
}

/**
 * Parse the object and field out of a Salesforce bad-field error.
 *
 * Salesforce reports these as:
 *   No such column 'Bogus__c' on entity 'Account'. If you are attempting...
 */
export function parseInvalidField(message: string): { field: string; objectName: string } | null {
  const match = message.match(/No such column '([^']+)' on entity '([^']+)'/i);
  if (!match) return null;
  return { field: match[1], objectName: match[2] };
}

/**
 * Turn a bad-field error into a self-correcting one by naming the fields that
 * exist. This is the moment recon is most tempting and least necessary — the
 * server knows the answer, so it supplies it rather than letting the agent go
 * describe the object.
 *
 * Returns '' when the error isn't a bad-field error, or the object isn't known.
 */
export function buildInvalidFieldHint(source: CatalogSource, message: string): string {
  const parsed = parseInvalidField(message);
  if (!parsed) return '';

  const hint = buildFieldHint(source, parsed.objectName);
  if (!hint) return '';

  return `\n\n**\`${parsed.field}\` does not exist on ${parsed.objectName}.** ${hint}`;
}
