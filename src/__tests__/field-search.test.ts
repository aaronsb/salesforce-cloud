/// <reference types="jest" />

import { searchFields, scoreFieldMatch, FieldSearchInput } from '../utils/field-search';
import type { ScoredField, FieldCandidate } from '../utils/field-regulator';

/**
 * The matcher is the whole risk surface of ADR-302: it decides what "ai" means
 * against a wall of field metadata. These tests pin the behaviour that makes it
 * useful — segment matches beat substrings, requested values ride along, sparse
 * custom flags are reachable — and the behaviour that keeps it honest: it is
 * lexical, so a concept the schema doesn't name lexically does not surface.
 */

/**
 * `score` defaults to populationPct for brevity, but is settable independently:
 * the two are separate tie-break levels, and a fixture that conflates them
 * cannot tell which one fired.
 */
function field(
  partial: Partial<FieldCandidate> & { name: string },
  score?: number,
): ScoredField {
  return {
    field: {
      label: partial.name,
      type: 'string',
      custom: true,
      helpText: null,
      nillable: true,
      computationType: 'text',
      ...partial,
    },
    score: score ?? partial.populationPct ?? 0,
    adjustments: [],
    promoted: false,
  };
}

function input(objectName: string, sf: ScoredField): FieldSearchInput {
  return { objectName, field: sf };
}

describe('scoreFieldMatch', () => {
  it('scores a name-segment match above a substring buried in a longer word', () => {
    const flag = scoreFieldMatch(['ai'], { name: 'AI_Opportunity__c', label: 'AI Sales', helpText: null });
    const email = scoreFieldMatch(['ai'], { name: 'Email__c', label: 'Email', helpText: null });

    expect(flag).not.toBeNull();
    expect(email).not.toBeNull(); // "ai" is a substring of "email" — still a (weak) hit
    expect(flag!.relevance).toBeGreaterThan(email!.relevance);
  });

  it('reports every metadata source the term matched on', () => {
    const m = scoreFieldMatch(['ai'], {
      name: 'AI_Opportunity__c',
      label: 'AI Sales',
      helpText: 'Flag for AI-driven deals',
    });
    expect(m!.matchedOn.sort()).toEqual(['helpText', 'label', 'name']);
  });

  it('returns null when nothing matches', () => {
    expect(scoreFieldMatch(['renewal'], { name: 'Amount', label: 'Amount', helpText: null })).toBeNull();
  });

  it('rewards covering more of a multi-word query', () => {
    const both = scoreFieldMatch(['ai', 'delivery'], {
      name: 'AI_Delivery__c', label: 'AI Augmented Delivery', helpText: null,
    });
    const one = scoreFieldMatch(['ai', 'delivery'], {
      name: 'AI_Opportunity__c', label: 'AI Sales', helpText: null,
    });
    expect(both!.relevance).toBeGreaterThan(one!.relevance);
  });
});

describe('searchFields', () => {
  const catalog: FieldSearchInput[] = [
    input('Opportunity', field({ name: 'AI_Opportunity__c', label: 'AI Sales', type: 'picklist', computationType: 'categorical', populationPct: 4, picklistValues: ['Yes', 'No'] })),
    input('Opportunity', field({ name: 'AI_Delivery__c', label: 'AI Augmented Delivery', type: 'picklist', computationType: 'categorical', populationPct: 3, picklistValues: ['Yes', 'No'] })),
    input('Opportunity', field({ name: 'Email__c', label: 'Email', populationPct: 90 })),
    input('Account', field({ name: 'Amount', label: 'Amount', type: 'currency', computationType: 'numeric', populationPct: 100 })),
  ];

  it('finds the AI flags and ranks them above an incidental substring hit', () => {
    const hits = searchFields('ai', catalog);
    const names = hits.map(h => h.name);
    expect(names.slice(0, 2).sort()).toEqual(['AI_Delivery__c', 'AI_Opportunity__c']);
    // Email__c only matches because "ai" ⊂ "email"; it must rank last of the hits.
    expect(names[names.length - 1]).toBe('Email__c');
    expect(names).not.toContain('Amount');
  });

  it('reaches sparsely-populated custom flags (the whole point)', () => {
    const hits = searchFields('ai', catalog);
    const flag = hits.find(h => h.name === 'AI_Opportunity__c');
    expect(flag).toBeDefined();
    expect(flag!.populationPct).toBe(4); // 4% populated, still surfaced
    expect(flag!.promoted).toBe(false);
  });

  it('omits picklist values unless includeValues is set', () => {
    const without = searchFields('ai', catalog).find(h => h.name === 'AI_Opportunity__c');
    expect(without!.values).toBeUndefined();

    const withValues = searchFields('ai', catalog, { includeValues: true })
      .find(h => h.name === 'AI_Opportunity__c');
    expect(withValues!.values).toEqual(['Yes', 'No']);
  });

  it('filters by minPopulationPct', () => {
    const hits = searchFields('ai', catalog, { minPopulationPct: 50 });
    // Only Email__c (90%) clears the bar and still matches "ai".
    expect(hits.map(h => h.name)).toEqual(['Email__c']);
  });

  it('respects the result limit', () => {
    expect(searchFields('ai', catalog, { limit: 1 })).toHaveLength(1);
  });

  it('returns nothing for an empty term', () => {
    expect(searchFields('   ', catalog)).toEqual([]);
  });

  it('breaks relevance ties deterministically by catalog score then population', () => {
    const tie: FieldSearchInput[] = [
      input('A', field({ name: 'Region_Low__c', label: 'Region', populationPct: 10 })),
      input('B', field({ name: 'Region_High__c', label: 'Region', populationPct: 80 })),
    ];
    const hits = searchFields('region', tie);
    // Equal relevance (same label word match); higher score/population wins.
    expect(hits[0].name).toBe('Region_High__c');
  });

  // score and population are separate levels. With the fixture conflating them,
  // either could be deleted and the test above would still pass.
  it('prefers catalog score over population when they disagree', () => {
    const tie: FieldSearchInput[] = [
      input('A', field({ name: 'Region_Dense__c', label: 'Region', populationPct: 90 }, 10)),
      input('B', field({ name: 'Region_Ranked__c', label: 'Region', populationPct: 20 }, 90)),
    ];

    const hits = searchFields('region', tie);

    expect(hits[0].name).toBe('Region_Ranked__c');
  });

  // Standard fields share a name across objects, so name alone leaves ties
  // unresolved and order falls back to catalog insertion — which is the
  // completion order of parallel discovery, i.e. network timing. Without an
  // object tie-break the same search returns different rows across restarts.
  it('breaks an identical-name tie by object, not by discovery order', () => {
    const sameName = () => field({ name: 'Name', label: 'Name', populationPct: 100 }, 100);
    const forward: FieldSearchInput[] = [
      input('Opportunity', sameName()),
      input('Account', sameName()),
    ];
    const reversed: FieldSearchInput[] = [
      input('Account', sameName()),
      input('Opportunity', sameName()),
    ];

    const a = searchFields('name', forward).map(h => h.object);
    const b = searchFields('name', reversed).map(h => h.object);

    expect(a).toEqual(['Account', 'Opportunity']);
    expect(b).toEqual(a);
  });
});
