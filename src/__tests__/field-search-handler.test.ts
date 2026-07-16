/// <reference types="jest" />

import { handleSearchFields } from '../handlers/field-search-handler';
import type { ObjectCatalog } from '../client/field-discovery';
import type { ScoredField, FieldCandidate } from '../utils/field-regulator';

/**
 * Handler-level behaviour the pure matcher can't cover: the rendered surface,
 * on-demand scoping, and the two "say why, don't lie" empty paths — a bare
 * "0 matches" reads as "this org has no such field", which is a different and
 * wrong claim.
 */

function sf(partial: Partial<FieldCandidate> & { name: string }): ScoredField {
  return {
    field: {
      label: partial.name, type: 'string', custom: true, helpText: null,
      nillable: true, computationType: 'text', ...partial,
    },
    score: partial.populationPct ?? 0,
    adjustments: [],
    promoted: false,
  };
}

function catalog(objectName: string, fields: ScoredField[]): ObjectCatalog {
  return {
    objectName, fields, promoted: fields.filter(f => f.promoted),
    wellKnown: new Map(), describeMs: 0, scoringMs: 0,
    totalFields: fields.length, totalRecords: 100,
  };
}

/** Duck-typed FieldDiscovery — the handler only touches these three methods. */
function fakeDiscovery(catalogs: ObjectCatalog[], onDemand?: ObjectCatalog) {
  const byName = new Map(catalogs.map(c => [c.objectName, c]));
  const discoverObject = jest.fn(async (name: string) => {
    if (onDemand && onDemand.objectName === name) {
      byName.set(name, onDemand);
      return onDemand;
    }
    return null;
  });
  return {
    fd: {
      getCatalog: (n: string) => byName.get(n),
      allCatalogs: () => [...byName.values()],
      discoverObject,
    } as any,
    discoverObject,
  };
}

const oppCatalog = catalog('Opportunity', [
  sf({ name: 'AI_Opportunity__c', label: 'AI Sales', type: 'picklist', computationType: 'categorical', populationPct: 4, picklistValues: ['Yes', 'No'] }),
  sf({ name: 'Amount', label: 'Amount', type: 'currency', computationType: 'numeric', populationPct: 100 }),
]);

async function text(res: any): Promise<string> {
  return res.content[0].text as string;
}

describe('handleSearchFields', () => {
  it('renders matched fields as a table', async () => {
    const { fd } = fakeDiscovery([oppCatalog]);
    const out = await text(await handleSearchFields(fd, { term: 'ai' }));
    expect(out).toContain('AI_Opportunity__c');
    expect(out).toContain('AI Sales');
    expect(out).not.toContain('Amount'); // no "ai" in Amount
  });

  it('adds a Values column only when includeValues is set', async () => {
    const { fd } = fakeDiscovery([oppCatalog]);
    const plain = await text(await handleSearchFields(fd, { term: 'ai' }));
    expect(plain).not.toContain('Values');

    const withValues = await text(await handleSearchFields(fd, { term: 'ai', includeValues: true }));
    expect(withValues).toContain('Values');
    expect(withValues).toContain('Yes, No');
  });

  it('discovers a scoped object on demand when the catalog is cold', async () => {
    const { fd, discoverObject } = fakeDiscovery([], oppCatalog);
    const out = await text(await handleSearchFields(fd, { term: 'ai', objectName: 'Opportunity' }));
    expect(discoverObject).toHaveBeenCalledWith('Opportunity');
    expect(out).toContain('AI_Opportunity__c');
  });

  it('explains an empty catalog instead of claiming no field exists', async () => {
    const { fd } = fakeDiscovery([]);
    const out = await text(await handleSearchFields(fd, { term: 'ai' }));
    expect(out).toMatch(/discovery may still be in progress|_stats/i);
  });

  it('says the match is lexical when nothing matches a populated catalog', async () => {
    const { fd } = fakeDiscovery([oppCatalog]);
    const out = await text(await handleSearchFields(fd, { term: 'zzznope' }));
    expect(out).toMatch(/lexical/i);
    expect(out).toContain('field-catalog');
  });

  it('rejects a missing term', async () => {
    const { fd } = fakeDiscovery([oppCatalog]);
    await expect(handleSearchFields(fd, {})).rejects.toThrow(/term/i);
  });
});
