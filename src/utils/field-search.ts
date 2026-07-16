/**
 * ADR-302 Field Search — resolve a concept to the fields that carry it.
 *
 * Field discovery (ADR-300) already ranks and caches every field on the core
 * objects. But it is organised *by object*: to answer "which field records
 * whether a deal involved AI?" an agent has to pull a whole catalog and read
 * it, and in a client without local text-processing (a plain chat UI) that
 * means eyeballing an 80KB blob for a 4%-populated custom field. The catalog
 * knows the answer; nothing lets the agent ask the question.
 *
 * This module is the matcher: a pure function over already-discovered fields
 * that ranks them against a search term. It does no I/O — the handler feeds it
 * the cached catalogs and renders what comes back — so the scoring is
 * deterministic and unit-testable without a Salesforce connection.
 *
 * Deliberately *lexical*, not semantic (ADR-302). It matches the term against
 * the field's API name, label, and help text. A field named `Renewal_Risk__c`
 * is found from "risk" because the string is there; it is not found from
 * "churn" because nothing in the metadata says "churn". That leap is the
 * caller's to make — the tool narrows the haystack, it doesn't read minds.
 */

import type { ScoredField } from './field-regulator.js';

/** A discovered field paired with the object it belongs to. */
export interface FieldSearchInput {
  objectName: string;
  field: ScoredField;
}

/** Options controlling which fields come back and how many. */
export interface FieldSearchOptions {
  /** Restrict to fields at or above this population density (0-100). */
  minPopulationPct?: number;
  /** Include picklist value sets on matched categorical fields. */
  includeValues?: boolean;
  /** Cap on returned hits (post-ranking). */
  limit?: number;
}

/** One ranked search result. */
export interface FieldSearchHit {
  object: string;
  name: string;
  label: string;
  type: string;
  /** Population density if discovery scored it, else undefined. */
  populationPct?: number;
  /** Whether the field is in the object's promoted (Tier 1) set. */
  promoted: boolean;
  /** The catalog's usefulness score (ADR-300 regulator total). */
  score: number;
  /** How strongly the term matched this field. Higher is a better match. */
  relevance: number;
  /** Which metadata carried the match: any of 'name', 'label', 'helpText'. */
  matchedOn: string[];
  /** Active picklist values, when requested and the field is categorical. */
  values?: string[];
}

/** Default and ceiling on returned hits — a search surface, not a dump. */
export const DEFAULT_SEARCH_LIMIT = 25;
export const MAX_SEARCH_LIMIT = 100;

/** Escape a user token so it can sit inside a RegExp safely. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if `token` appears as a whole word in `text` (word-boundary match). */
function matchesWord(text: string, token: string): boolean {
  return new RegExp(`\\b${escapeRegExp(token)}\\b`).test(text);
}

/**
 * Score how well a single field matches the search tokens.
 *
 * The weighting encodes a preference order: a token that *is* a segment of the
 * API name ("ai" in `ai_opportunity__c`) is a stronger signal than the same
 * token buried inside a longer word ("ai" in `email`), and a name match beats a
 * label match beats a help-text match. Name and label contributions are summed
 * rather than max'd — a term landing in both is genuinely more relevant than
 * one landing in either alone.
 *
 * Returns null when no token matched anywhere; such a field is not a hit.
 */
export function scoreFieldMatch(
  tokens: string[],
  field: { name: string; label: string; helpText: string | null },
): { relevance: number; matchedOn: string[] } | null {
  const nameL = field.name.toLowerCase();
  const labelL = (field.label ?? '').toLowerCase();
  const helpL = (field.helpText ?? '').toLowerCase();
  // API-name segments: `ai_opportunity__c` -> ['ai', 'opportunity', 'c'].
  const segments = nameL.split(/_+/).filter(Boolean);

  let relevance = 0;
  let matchedTokens = 0;
  const matchedOn = new Set<string>();

  for (const token of tokens) {
    let tokenScore = 0;

    // Name signal — strongest when the token is a discrete name segment.
    if (segments.includes(token)) {
      tokenScore += 50;
      matchedOn.add('name');
    } else if (segments.some(seg => seg.startsWith(token))) {
      tokenScore += 30;
      matchedOn.add('name');
    } else if (nameL.includes(token)) {
      tokenScore += 15;
      matchedOn.add('name');
    }

    // Label signal — whole-word beats a substring buried in a longer word.
    if (matchesWord(labelL, token)) {
      tokenScore += 40;
      matchedOn.add('label');
    } else if (labelL.includes(token)) {
      tokenScore += 12;
      matchedOn.add('label');
    }

    // Help-text signal — weakest, but it disambiguates cryptic API names.
    if (helpL.includes(token)) {
      tokenScore += 8;
      matchedOn.add('helpText');
    }

    if (tokenScore > 0) {
      matchedTokens += 1;
      relevance += tokenScore;
    }
  }

  if (matchedTokens === 0) return null;

  // Reward matching more of a multi-word query. A field hitting every token is
  // a better answer than one that caught a single common word.
  const coverage = matchedTokens / tokens.length;
  relevance = Math.round(relevance * (0.5 + 0.5 * coverage));

  return { relevance, matchedOn: [...matchedOn] };
}

/** Extract active picklist values from a scored field, if any. */
function picklistValues(field: ScoredField): string[] | undefined {
  const values = field.field.picklistValues;
  return values && values.length > 0 ? values : undefined;
}

/**
 * Rank discovered fields against a free-text term.
 *
 * Pure: the caller supplies every field to consider (typically the union of the
 * cached catalogs) and this returns the ranked matches. Sort is by relevance,
 * then the catalog's own usefulness score, then population, then name — so the
 * order is stable and a well-populated field wins ties against an abandoned one.
 */
export function searchFields(
  term: string,
  candidates: FieldSearchInput[],
  opts: FieldSearchOptions = {},
): FieldSearchHit[] {
  const tokens = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const limit = Math.min(opts.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);

  const hits: FieldSearchHit[] = [];
  for (const { objectName, field } of candidates) {
    const pop = field.field.populationPct;
    if (opts.minPopulationPct !== undefined && (pop ?? 0) < opts.minPopulationPct) {
      continue;
    }

    const match = scoreFieldMatch(tokens, field.field);
    if (!match) continue;

    hits.push({
      object: objectName,
      name: field.field.name,
      label: field.field.label,
      type: field.field.type,
      populationPct: pop,
      promoted: field.promoted,
      score: field.score,
      relevance: match.relevance,
      matchedOn: match.matchedOn,
      ...(opts.includeValues ? { values: picklistValues(field) } : {}),
    });
  }

  // Object is part of the tie-break, not decoration. Standard fields share a
  // name across objects — Name, CreatedDate and OwnerId exist on all of them —
  // so name alone leaves ties unresolved. A stable sort then falls back to
  // input order, which is catalog insertion order, which is the completion
  // order of parallel discovery tasks: network timing. Without this the same
  // search returns a different object's Name first across restarts, and with
  // `limit` truncation it drops different rows.
  hits.sort((a, b) =>
    b.relevance - a.relevance ||
    b.score - a.score ||
    (b.populationPct ?? 0) - (a.populationPct ?? 0) ||
    a.name.localeCompare(b.name) ||
    a.object.localeCompare(b.object),
  );

  return hits.slice(0, limit);
}
