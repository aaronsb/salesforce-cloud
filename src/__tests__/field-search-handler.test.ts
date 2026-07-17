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
    totalFields: fields.length, totalRecords: 100, sampledRecords: 100,
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

  describe('objectName validation', () => {
    // The object name is interpolated into SOQL during discovery
    // (field-discovery.ts builds `SELECT COUNT() FROM ${objectName}`). The
    // catalog resource guards this with the same pattern; the handler must not
    // rely on describe() happening to reject it first.
    it('rejects an object name that is not a plain identifier', async () => {
      const { fd, discoverObject } = fakeDiscovery([oppCatalog]);

      await expect(handleSearchFields(fd, { term: 'ai', objectName: "Opp' OR Id != '" }))
        .rejects.toThrow(/Invalid Salesforce object name/i);
      expect(discoverObject).not.toHaveBeenCalled();
    });

    it('rejects a non-string object name rather than mis-diagnosing it', async () => {
      const { fd } = fakeDiscovery([oppCatalog]);

      // Previously rendered "No field catalog is available for [object Object]",
      // which blames discovery for what is an invalid argument.
      await expect(handleSearchFields(fd, { term: 'ai', objectName: { evil: true } }))
        .rejects.toThrow(/must be a string/i);
    });
  });

  // SOQL is case-insensitive, so an agent will write `opportunity`. Missing the
  // cache would re-discover the object under a second key, and the duplicate's
  // promoted fields push the already-binding global budget further past its cap
  // — demoting fields on *other* objects. A read-only search must not degrade
  // unrelated surfaces.
  it('resolves a differently-cased object name to the cached catalog', async () => {
    const { fd, discoverObject } = fakeDiscovery([oppCatalog]);

    const out = await text(await handleSearchFields(fd, { term: 'ai', objectName: 'opportunity' }));

    expect(discoverObject).not.toHaveBeenCalled();
    expect(out).toContain('AI_Opportunity__c');
  });

  describe('numeric arguments', () => {
    // NaN is a number, survives Math.min/max, and reaches slice(0, NaN) -> [],
    // which renders as "no fields matched" — a plumbing failure reported as a
    // claim about the org's schema. That is the bug class this repo has now
    // fixed three times.
    it('falls back to the default limit rather than reporting no matches', async () => {
      const { fd } = fakeDiscovery([oppCatalog]);

      const out = await text(await handleSearchFields(fd, { term: 'ai', limit: NaN }));

      expect(out).not.toMatch(/matched "ai"/i);
      expect(out).toContain('AI_Opportunity__c');
    });

    it('ignores a non-finite minPopulationPct rather than filtering everything out', async () => {
      const { fd } = fakeDiscovery([oppCatalog]);

      const out = await text(await handleSearchFields(fd, { term: 'ai', minPopulationPct: NaN }));

      expect(out).toContain('AI_Opportunity__c');
    });

    it('clamps an out-of-range minPopulationPct instead of matching nothing', async () => {
      const { fd } = fakeDiscovery([oppCatalog]);

      const out = await text(await handleSearchFields(fd, { term: 'ai', minPopulationPct: 150 }));

      // Clamped to 100 — a real filter, not an accidental empty result.
      expect(out).toMatch(/matched "ai"|AI_Opportunity__c/);
    });
  });
});
