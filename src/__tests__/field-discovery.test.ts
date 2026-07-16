/// <reference types="jest" />

import { FieldDiscovery } from '../client/field-discovery';
import { SalesforceClient } from '../client/salesforce-client';
import { Regulator } from '../utils/field-regulator';
import { CORE_OBJECTS, MAX_PROMOTED_PER_OBJECT, MAX_PROMOTED_TOTAL } from '../utils/discovery-constants';

// ── Fixtures ─────────────────────────────────────────────────────────

interface FakeField {
  name: string;
  label: string;
  type: string;
  custom?: boolean;
  inlineHelpText?: string | null;
  nillable?: boolean;
}

function field(overrides: Partial<FakeField> & { name: string }): FakeField {
  return {
    label: overrides.name,
    type: 'string',
    custom: false,
    inlineHelpText: null,
    nillable: true,
    ...overrides,
  };
}

/**
 * Build a fake SalesforceClient. `describes` maps object name to its field
 * list; `counts` maps object name to total record count. Per-field population
 * counts come from `populated` (object name -> field name -> count).
 */
function makeClient(opts: {
  describes?: Record<string, FakeField[]>;
  counts?: Record<string, number>;
  populated?: Record<string, Record<string, number>>;
  describeError?: Record<string, string>;
  countError?: string[];
  fieldQueryError?: string[];
} = {}) {
  const {
    describes = {}, counts = {}, populated = {},
    describeError = {}, countError = [], fieldQueryError = [],
  } = opts;

  const describe = jest.fn(async (objectName: string) => {
    if (describeError[objectName]) throw new Error(describeError[objectName]);
    return { name: objectName, fields: describes[objectName] ?? [] };
  });

  const query = jest.fn(async (soql: string) => {
    const fromMatch = soql.match(/FROM (\w+)/);
    const objectName = fromMatch ? fromMatch[1] : '';

    // Total record count: SELECT COUNT() FROM X
    if (/SELECT COUNT\(\)/.test(soql)) {
      if (countError.includes(objectName)) throw new Error('count blew up');
      return { totalSize: counts[objectName] ?? 0 };
    }

    // Per-field population: SELECT COUNT(Id) cnt FROM X WHERE f != null
    const fieldMatch = soql.match(/WHERE (\w+) != null/);
    const fieldName = fieldMatch ? fieldMatch[1] : '';
    if (fieldQueryError.includes(fieldName)) throw new Error('field query blew up');
    return { records: [{ cnt: populated[objectName]?.[fieldName] ?? 0 }] };
  });

  const client = {
    ensureInitialized: jest.fn().mockResolvedValue(undefined),
    getConnection: () => ({ describe, query }),
  };

  return { client: client as unknown as SalesforceClient, describe, query };
}

// Discovery logs progress to stderr; keep test output clean.
let errSpy: jest.SpyInstance;
beforeEach(() => { errSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errSpy.mockRestore(); jest.clearAllMocks(); });

// ── Tests ────────────────────────────────────────────────────────────

describe('FieldDiscovery', () => {
  describe('discoverObject', () => {
    it('describes an object and returns its catalog', async () => {
      const { client, describe } = makeClient({
        describes: { Account: [field({ name: 'Name' }), field({ name: 'Industry' })] },
        counts: { Account: 100 },
        populated: { Account: { Name: 100, Industry: 50 } },
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      expect(describe).toHaveBeenCalledWith('Account');
      expect(catalog).not.toBeNull();
      expect(catalog!.objectName).toBe('Account');
      expect(catalog!.totalFields).toBe(2);
      expect(catalog!.totalRecords).toBe(100);
    });

    it('scores fields by population density', async () => {
      const { client } = makeClient({
        describes: { Account: [field({ name: 'Name' }), field({ name: 'Industry' })] },
        counts: { Account: 200 },
        populated: { Account: { Name: 200, Industry: 50 } },
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      const byName = (n: string) => catalog!.fields.find(s => s.field.name === n)!;
      expect(byName('Name').field.populationPct).toBe(100);
      expect(byName('Industry').field.populationPct).toBe(25);
      // Fields are returned ranked, densest first.
      expect(catalog!.fields[0].field.name).toBe('Name');
    });

    it('caches the catalog — a second call does not re-describe', async () => {
      const { client, describe } = makeClient({
        describes: { Account: [field({ name: 'Name' })] },
        counts: { Account: 10 },
      });
      const discovery = new FieldDiscovery(client);

      const first = await discovery.discoverObject('Account');
      const second = await discovery.discoverObject('Account');

      expect(describe).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it('records the error and returns null when describe fails', async () => {
      const { client } = makeClient({ describeError: { Ghost: 'no such object' } });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Ghost');

      expect(catalog).toBeNull();
      expect(discovery.getStats().errors).toContain('Ghost: no such object');
    });

    it('skips population scoring entirely when the object has no records', async () => {
      const { client, query } = makeClient({
        describes: { Account: [field({ name: 'Name' })] },
        counts: { Account: 0 },
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      expect(catalog!.totalRecords).toBe(0);
      // Only the COUNT() probe runs — no per-field queries.
      expect(query).toHaveBeenCalledTimes(1);
      expect(catalog!.fields[0].field.populationPct).toBeUndefined();
    });

    it('survives a failing COUNT and still returns a catalog', async () => {
      const { client } = makeClient({
        describes: { Account: [field({ name: 'Name' })] },
        countError: ['Account'],
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      expect(catalog).not.toBeNull();
      expect(catalog!.totalRecords).toBe(0);
      expect(discovery.getStats().errors).toContain('Account COUNT: count blew up');
    });

    it('leaves a field unscored when its population query fails, without failing discovery', async () => {
      const { client } = makeClient({
        describes: { Account: [field({ name: 'Name' }), field({ name: 'Broken' })] },
        counts: { Account: 100 },
        populated: { Account: { Name: 100 } },
        fieldQueryError: ['Broken'],
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      const broken = catalog!.fields.find(s => s.field.name === 'Broken')!;
      const name = catalog!.fields.find(s => s.field.name === 'Name')!;
      expect(broken.field.populationPct).toBeUndefined();
      expect(name.field.populationPct).toBe(100);
    });

    it('does not score non-scorable field types', async () => {
      const { client, query } = makeClient({
        describes: {
          Account: [
            field({ name: 'Id', type: 'id' }),              // identifier — not scorable
            field({ name: 'Notes', type: 'textarea' }),      // long text — not scorable
            field({ name: 'Name', type: 'string' }),         // scorable
          ],
        },
        counts: { Account: 50 },
        populated: { Account: { Name: 25 } },
      });
      const discovery = new FieldDiscovery(client);

      await discovery.discoverObject('Account');

      const scored = query.mock.calls
        .map(([soql]) => (soql as string).match(/WHERE (\w+) != null/)?.[1])
        .filter(Boolean);
      expect(scored).toEqual(['Name']);
    });

    it('does not score non-nillable fields', async () => {
      const { client, query } = makeClient({
        describes: {
          Account: [
            field({ name: 'Required', nillable: false }),
            field({ name: 'Optional', nillable: true }),
          ],
        },
        counts: { Account: 10 },
        populated: { Account: { Optional: 5 } },
      });
      const discovery = new FieldDiscovery(client);

      await discovery.discoverObject('Account');

      const scored = query.mock.calls
        .map(([soql]) => (soql as string).match(/WHERE (\w+) != null/)?.[1])
        .filter(Boolean);
      expect(scored).toEqual(['Optional']);
    });

    it('honors injected regulators over the defaults', async () => {
      const onlyBoostIndustry: Regulator = (f) =>
        f.name === 'Industry' ? { regulator: 'test', delta: 999, reason: 'test boost' } : null;
      const { client } = makeClient({
        describes: { Account: [field({ name: 'Name' }), field({ name: 'Industry' })] },
        counts: { Account: 100 },
        populated: { Account: { Name: 100, Industry: 1 } },
      });
      const discovery = new FieldDiscovery(client, [onlyBoostIndustry]);

      const catalog = await discovery.discoverObject('Account');

      // Industry outranks the fully-populated Name because only our regulator ran.
      expect(catalog!.fields[0].field.name).toBe('Industry');
      expect(catalog!.fields[0].score).toBe(999);
      expect(catalog!.promoted.map(s => s.field.name)).toEqual(['Industry']);
    });
  });

  describe('getCatalog', () => {
    it('returns undefined for an object that has not been discovered', () => {
      const { client } = makeClient();
      const discovery = new FieldDiscovery(client);

      expect(discovery.getCatalog('Account')).toBeUndefined();
    });

    it('returns the catalog once discovered', async () => {
      const { client } = makeClient({
        describes: { Account: [field({ name: 'Name' })] },
        counts: { Account: 1 },
      });
      const discovery = new FieldDiscovery(client);
      await discovery.discoverObject('Account');

      expect(discovery.getCatalog('Account')!.objectName).toBe('Account');
    });
  });

  describe('resolveWellKnown', () => {
    it('resolves a semantic name to the org-specific API name by label and type', async () => {
      const { client } = makeClient({
        describes: {
          ContentVersion: [
            field({ name: 'IsLatest__c', label: 'Is Latest Version', type: 'boolean', custom: true }),
            field({ name: 'Title', label: 'Title', type: 'string' }),
          ],
        },
        counts: { ContentVersion: 10 },
      });
      const discovery = new FieldDiscovery(client);
      await discovery.discoverObject('ContentVersion');

      expect(discovery.resolveWellKnown('ContentVersion', 'isLatestVersion')).toBe('IsLatest__c');
    });

    it('does not match when the label matches but the type does not', async () => {
      const { client } = makeClient({
        describes: {
          ContentVersion: [field({ name: 'LatestNote', label: 'Latest Version Note', type: 'string' })],
        },
        counts: { ContentVersion: 10 },
      });
      const discovery = new FieldDiscovery(client);
      await discovery.discoverObject('ContentVersion');

      expect(discovery.resolveWellKnown('ContentVersion', 'isLatestVersion')).toBeUndefined();
    });

    it('returns undefined for an undiscovered object', () => {
      const { client } = makeClient();
      const discovery = new FieldDiscovery(client);

      expect(discovery.resolveWellKnown('ContentVersion', 'isLatestVersion')).toBeUndefined();
    });

    it('returns undefined for an unknown semantic name', async () => {
      const { client } = makeClient({
        describes: { ContentVersion: [field({ name: 'Title', type: 'string' })] },
        counts: { ContentVersion: 1 },
      });
      const discovery = new FieldDiscovery(client);
      await discovery.discoverObject('ContentVersion');

      expect(discovery.resolveWellKnown('ContentVersion', 'nonesuch')).toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('reports zeroed, not-ready stats before discovery runs', () => {
      const { client } = makeClient();
      const discovery = new FieldDiscovery(client);

      expect(discovery.getStats()).toEqual({
        objectsDiscovered: 0,
        totalFieldsSeen: 0,
        totalPromoted: 0,
        totalMs: 0,
        ready: false,
        errors: [],
      });
    });

    it('aggregates field and promotion counts across objects', async () => {
      const { client } = makeClient({
        describes: {
          Account: [field({ name: 'Name' }), field({ name: 'Industry' })],
          Contact: [field({ name: 'Email' })],
        },
        counts: { Account: 10, Contact: 10 },
        populated: { Account: { Name: 10, Industry: 10 }, Contact: { Email: 10 } },
      });
      const discovery = new FieldDiscovery(client);
      await discovery.discoverObject('Account');
      await discovery.discoverObject('Contact');

      const stats = discovery.getStats();
      expect(stats.objectsDiscovered).toBe(2);
      expect(stats.totalFieldsSeen).toBe(3);
      expect(stats.totalPromoted).toBe(3);
    });

    it('returns a copy of errors that callers cannot mutate', async () => {
      const { client } = makeClient({ describeError: { Ghost: 'boom' } });
      const discovery = new FieldDiscovery(client);
      await discovery.discoverObject('Ghost');

      discovery.getStats().errors.push('injected');

      expect(discovery.getStats().errors).toEqual(['Ghost: boom']);
    });
  });

  describe('startAsync', () => {
    it('discovers every core object and flips ready', async () => {
      const describes: Record<string, FakeField[]> = {};
      const counts: Record<string, number> = {};
      for (const obj of CORE_OBJECTS) {
        describes[obj] = [field({ name: 'Name' })];
        counts[obj] = 5;
      }
      const { client } = makeClient({ describes, counts });
      const discovery = new FieldDiscovery(client);

      expect(discovery.ready).toBe(false);
      discovery.startAsync();
      await discovery['startupPromise'];

      expect(discovery.ready).toBe(true);
      expect(discovery.getStats().objectsDiscovered).toBe(CORE_OBJECTS.length);
      for (const obj of CORE_OBJECTS) {
        expect(discovery.getCatalog(obj)).toBeDefined();
      }
    });

    it('is idempotent — a second call does not start a second pass', async () => {
      const { client, describe } = makeClient({
        describes: Object.fromEntries(CORE_OBJECTS.map(o => [o, [field({ name: 'Name' })]])),
        counts: Object.fromEntries(CORE_OBJECTS.map(o => [o, 1])),
      });
      const discovery = new FieldDiscovery(client);

      discovery.startAsync();
      const firstPromise = discovery['startupPromise'];
      discovery.startAsync();
      await discovery['startupPromise'];

      expect(discovery['startupPromise']).toBe(firstPromise);
      expect(describe).toHaveBeenCalledTimes(CORE_OBJECTS.length);
    });

    it('still becomes ready when some objects fail to describe', async () => {
      const describes = Object.fromEntries(CORE_OBJECTS.map(o => [o, [field({ name: 'Name' })]]));
      const { client } = makeClient({
        describes,
        counts: Object.fromEntries(CORE_OBJECTS.map(o => [o, 1])),
        describeError: { [CORE_OBJECTS[0]]: 'permission denied' },
      });
      const discovery = new FieldDiscovery(client);

      discovery.startAsync();
      await discovery['startupPromise'];

      const stats = discovery.getStats();
      expect(stats.ready).toBe(true);
      expect(stats.objectsDiscovered).toBe(CORE_OBJECTS.length - 1);
      expect(stats.errors).toContain(`${CORE_OBJECTS[0]}: permission denied`);
    });
  });

  describe('whenSettled', () => {
    it('resolves once startup discovery has finished', async () => {
      const { client } = makeClient({
        describes: Object.fromEntries(CORE_OBJECTS.map(o => [o, [field({ name: 'Name' })]])),
        counts: Object.fromEntries(CORE_OBJECTS.map(o => [o, 1])),
      });
      const discovery = new FieldDiscovery(client);

      discovery.startAsync();

      await expect(discovery.whenSettled()).resolves.toBe(true);
      expect(discovery.ready).toBe(true);
    });

    // Callers wait on this to react to discovery landing. Discovery already
    // logs and records its own failures, so rejecting here would force every
    // caller to handle an error that has already been dealt with.
    it('resolves rather than rejecting when discovery blows up', async () => {
      const { client } = makeClient();
      const discovery = new FieldDiscovery(client);
      jest.spyOn(discovery as any, 'discoverCoreObjects').mockRejectedValue(new Error('boom'));

      discovery.startAsync();

      await expect(discovery.whenSettled()).resolves.toBe(true);
    });

    // A bare resolve() here would be indistinguishable from "discovery
    // finished", and a caller would act on a state change that never happened.
    it('reports false when discovery was never started', async () => {
      const { client } = makeClient();
      const discovery = new FieldDiscovery(client);

      await expect(discovery.whenSettled()).resolves.toBe(false);
      expect(discovery.ready).toBe(false);
    });
  });

  describe('global promotion budget', () => {
    it('caps promoted fields at the per-object maximum', async () => {
      const many = Array.from({ length: MAX_PROMOTED_PER_OBJECT + 20 }, (_, i) =>
        field({ name: `F${i}` }),
      );
      const { client } = makeClient({
        describes: { Account: many },
        counts: { Account: 100 },
        // Uniform population: no knee, so the hard per-object cap is what bites.
        populated: { Account: Object.fromEntries(many.map(f => [f.name, 100])) },
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      expect(catalog!.promoted.length).toBe(MAX_PROMOTED_PER_OBJECT);
    });

    it('demotes the lowest-scoring fields once the global budget is exceeded', async () => {
      // 6 core objects x 40 promoted = 240, over the 200 global budget.
      const describes: Record<string, FakeField[]> = {};
      const counts: Record<string, number> = {};
      const populated: Record<string, Record<string, number>> = {};
      for (const obj of CORE_OBJECTS) {
        const fields = Array.from({ length: MAX_PROMOTED_PER_OBJECT + 10 }, (_, i) =>
          field({ name: `${obj}_F${i}` }),
        );
        describes[obj] = fields;
        counts[obj] = 100;
        populated[obj] = Object.fromEntries(fields.map(f => [f.name, 100]));
      }
      const { client } = makeClient({ describes, counts, populated });
      const discovery = new FieldDiscovery(client);

      discovery.startAsync();
      await discovery['startupPromise'];

      const stats = discovery.getStats();
      expect(CORE_OBJECTS.length * MAX_PROMOTED_PER_OBJECT).toBeGreaterThan(MAX_PROMOTED_TOTAL);
      expect(stats.totalPromoted).toBe(MAX_PROMOTED_TOTAL);
    });

    it('keeps the highest scorers when demoting across objects', async () => {
      // Account fields are fully populated; Contact fields are sparse. With the
      // budget forcing demotions, Account should survive and Contact should not.
      const accountFields = Array.from({ length: 30 }, (_, i) => field({ name: `A${i}` }));
      const contactFields = Array.from({ length: 30 }, (_, i) => field({ name: `C${i}` }));
      const { client } = makeClient({
        describes: { Account: accountFields, Contact: contactFields },
        counts: { Account: 100, Contact: 100 },
        populated: {
          Account: Object.fromEntries(accountFields.map(f => [f.name, 100])),
          Contact: Object.fromEntries(contactFields.map(f => [f.name, 5])),
        },
      });
      const discovery = new FieldDiscovery(client);
      await discovery.discoverObject('Account');
      await discovery.discoverObject('Contact');

      // Under budget at 60 promoted, so nothing is demoted yet.
      expect(discovery.getStats().totalPromoted).toBeLessThanOrEqual(MAX_PROMOTED_TOTAL);
      const accountScores = discovery.getCatalog('Account')!.promoted.map(s => s.score);
      const contactScores = discovery.getCatalog('Contact')!.promoted.map(s => s.score);
      expect(Math.min(...accountScores)).toBeGreaterThan(Math.max(...contactScores));
    });

    it('leaves promotions untouched when under the global budget', async () => {
      const { client } = makeClient({
        describes: { Account: [field({ name: 'Name' }), field({ name: 'Industry' })] },
        counts: { Account: 100 },
        populated: { Account: { Name: 100, Industry: 90 } },
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      expect(catalog!.promoted.length).toBe(2);
      expect(discovery.getStats().totalPromoted).toBe(2);
    });
  });

  describe('authentication', () => {
    it('ensures the client is initialized before describing', async () => {
      const { client } = makeClient({
        describes: { Account: [field({ name: 'Name' })] },
        counts: { Account: 1 },
      });
      const discovery = new FieldDiscovery(client);

      await discovery.discoverObject('Account');

      expect(client.ensureInitialized).toHaveBeenCalled();
    });
  });
});
