/// <reference types="jest" />

import { FieldDiscovery } from '../client/field-discovery';
import { SalesforceClient } from '../client/salesforce-client';
import { Regulator } from '../utils/field-regulator';
import { CORE_OBJECTS, MAX_PROMOTED_PER_OBJECT, MAX_PROMOTED_TOTAL, SAMPLE_STRATA } from '../utils/discovery-constants';

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

export type FakeRecord = Record<string, unknown> & { CreatedDate: string };

/**
 * Build a fake Salesforce that holds records and answers the two query shapes
 * discovery actually issues (ADR-301): one aggregate probe for count and span,
 * then a windowed wide SELECT per stratum.
 *
 * It simulates rows rather than mocking query strings, because the thing under
 * test is what the sampler reads *out of records* — how a boolean splits, how
 * usage moves across creation time. A fake that returned canned counts could
 * only ever confirm the arithmetic it was handed.
 */
function makeClient(opts: {
  describes?: Record<string, FakeField[]>;
  records?: Record<string, FakeRecord[]>;
  describeError?: Record<string, string>;
  probeError?: string[];
  sampleError?: string[];
} = {}) {
  const { describes = {}, records = {}, describeError = {}, probeError = [], sampleError = [] } = opts;

  const describe = jest.fn(async (objectName: string) => {
    if (describeError[objectName]) throw new Error(describeError[objectName]);
    return { name: objectName, fields: describes[objectName] ?? [] };
  });

  const query = jest.fn(async (soql: string) => {
    const objectName = soql.match(/FROM (\w+)/)?.[1] ?? '';
    const rows = records[objectName] ?? [];

    // Probe: SELECT COUNT(Id) total, MIN(CreatedDate) spanFrom, MAX(CreatedDate) spanTo
    if (/MIN\(CreatedDate\)/.test(soql)) {
      if (probeError.includes(objectName)) throw new Error('probe blew up');
      if (rows.length === 0) return { records: [{ total: 0, spanFrom: null, spanTo: null }] };
      const dates = rows.map(r => r.CreatedDate).sort();
      return { records: [{ total: rows.length, spanFrom: dates[0], spanTo: dates[dates.length - 1] }] };
    }

    // Stratum: SELECT <fields> FROM X WHERE CreatedDate >= A [AND CreatedDate < B] LIMIT n
    if (sampleError.includes(objectName)) throw new Error('sample blew up');
    const from = soql.match(/CreatedDate >= ([0-9TZ:.-]+)/)?.[1];
    const to = soql.match(/CreatedDate < ([0-9TZ:.-]+)/)?.[1];
    const limit = Number(soql.match(/LIMIT (\d+)/)?.[1] ?? rows.length);
    const projected = (soql.match(/^SELECT (.+?) FROM/)?.[1] ?? '').split(', ');

    const inWindow = rows.filter(r => {
      const t = Date.parse(r.CreatedDate);
      if (from !== undefined && t < Date.parse(from)) return false;
      if (to !== undefined && t >= Date.parse(to)) return false;
      return true;
    }).slice(0, limit);

    // Salesforce returns only what was asked for.
    return {
      records: inWindow.map(r =>
        Object.fromEntries(projected.filter(f => f in r).map(f => [f, r[f]]))),
    };
  });

  const client = {
    ensureInitialized: jest.fn().mockResolvedValue(undefined),
    getConnection: () => ({ describe, query }),
  };

  return { client: client as unknown as SalesforceClient, describe, query };
}

/** N records spread evenly across a span, each built by `shape(i, n)`. */
function spread(
  n: number,
  shape: (i: number, n: number) => Record<string, unknown>,
  fromISO = '2016-01-01T00:00:00Z',
  toISO = '2026-01-01T00:00:00Z',
): FakeRecord[] {
  const lo = Date.parse(fromISO);
  const hi = Date.parse(toISO);
  return Array.from({ length: n }, (_, i) => ({
    ...shape(i, n),
    CreatedDate: new Date(lo + ((hi - lo) * i) / Math.max(1, n - 1)).toISOString(),
  }));
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
        records: { Account: spread(100, () => ({ Name: 'x', Industry: 'Tech' })) },
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
        // Name always filled; Industry on a quarter of records, evenly across time.
        records: {
          Account: spread(200, i => ({ Name: 'x', Industry: i % 4 === 0 ? 'Tech' : null })),
        },
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      const byName = (n: string) => catalog!.fields.find(s => s.field.name === n)!;
      expect(byName('Name').field.populationPct).toBe(100);
      expect(byName('Industry').field.populationPct).toBe(25);
      // Fields are returned ranked, densest first.
      expect(catalog!.fields[0].field.name).toBe('Name');
    });

    // The whole point of sampling: cost scales with strata, not with fields.
    it('costs a query per stratum, not a query per field', async () => {
      const many = Array.from({ length: 60 }, (_, i) => field({ name: `F${i}` }));
      const { client, query } = makeClient({
        describes: { Account: many },
        records: { Account: spread(500, () => Object.fromEntries(many.map(f => [f.name, 'x']))) },
      });
      const discovery = new FieldDiscovery(client);

      await discovery.discoverObject('Account');

      // One probe + one per stratum. The old design would have issued ~62.
      expect(query).toHaveBeenCalledTimes(1 + SAMPLE_STRATA);
    });

    it('reads every field from a single projection per stratum', async () => {
      const { client, query } = makeClient({
        describes: { Account: [field({ name: 'Name' }), field({ name: 'Industry' })] },
        records: { Account: spread(50, () => ({ Name: 'x', Industry: 'y' })) },
      });
      const discovery = new FieldDiscovery(client);

      await discovery.discoverObject('Account');

      const sampleQueries = query.mock.calls
        .map(([soql]) => soql as string)
        .filter(s => /CreatedDate >=/.test(s));
      expect(sampleQueries.length).toBeGreaterThan(0);
      for (const soql of sampleQueries) {
        expect(soql).toContain('Name');
        expect(soql).toContain('Industry');
      }
    });

    it('caches the catalog — a second call does not re-describe', async () => {
      const { client, describe } = makeClient({
        describes: { Account: [field({ name: 'Name' })] },
        records: { Account: spread(10, () => ({ Name: 'x' })) },
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

    it('skips sampling entirely when the object has no records', async () => {
      const { client, query } = makeClient({
        describes: { Account: [field({ name: 'Name' })] },
        records: { Account: [] },
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      expect(catalog!.totalRecords).toBe(0);
      expect(catalog!.sampledRecords).toBe(0);
      // Only the probe runs — nothing to sample.
      expect(query).toHaveBeenCalledTimes(1);
      expect(catalog!.fields[0].field.populationPct).toBeUndefined();
    });

    it('survives a failing probe and still returns a catalog', async () => {
      const { client } = makeClient({
        describes: { Account: [field({ name: 'Name' })] },
        records: { Account: spread(10, () => ({ Name: 'x' })) },
        probeError: ['Account'],
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      expect(catalog).not.toBeNull();
      expect(catalog!.totalRecords).toBe(0);
      expect(discovery.getStats().errors).toContain('Account sample probe: probe blew up');
    });

    it('leaves fields unscored when every sample window fails, without failing discovery', async () => {
      const { client } = makeClient({
        describes: { Account: [field({ name: 'Name' })] },
        records: { Account: spread(100, () => ({ Name: 'x' })) },
        sampleError: ['Account'],
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      expect(catalog).not.toBeNull();
      expect(catalog!.sampledRecords).toBe(0);
      expect(catalog!.fields[0].field.populationPct).toBeUndefined();
      expect(discovery.getStats().errors.some(e => /stratum/.test(e))).toBe(true);
    });

    it('does not score non-scorable field types', async () => {
      const { client } = makeClient({
        describes: {
          Account: [
            field({ name: 'Id', type: 'id' }),              // identifier — not scorable
            field({ name: 'Notes', type: 'textarea' }),      // long text — not scorable
            field({ name: 'Name', type: 'string' }),         // scorable
          ],
        },
        records: { Account: spread(50, () => ({ Id: '1', Notes: 'n', Name: 'x' })) },
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      const pop = (n: string) => catalog!.fields.find(s => s.field.name === n)!.field.populationPct;
      expect(pop('Name')).toBe(100);
      expect(pop('Id')).toBeUndefined();
      expect(pop('Notes')).toBeUndefined();
    });

    // SOQL rejects these in a wide projection, so they must not be asked for.
    it('leaves compound and long-text fields out of the projection', async () => {
      const { client, query } = makeClient({
        describes: {
          Account: [
            field({ name: 'BillingAddress', type: 'address' }),
            field({ name: 'Notes', type: 'textarea' }),
            field({ name: 'Name', type: 'string' }),
          ],
        },
        records: { Account: spread(20, () => ({ Name: 'x' })) },
      });
      const discovery = new FieldDiscovery(client);

      await discovery.discoverObject('Account');

      const sample = query.mock.calls.map(([s]) => s as string).find(s => /CreatedDate >=/.test(s))!;
      expect(sample).toContain('Name');
      expect(sample).not.toContain('BillingAddress');
      expect(sample).not.toContain('Notes');
    });

    it('does not score non-nillable fields', async () => {
      const { client } = makeClient({
        describes: {
          Account: [
            field({ name: 'Required', nillable: false }),
            field({ name: 'Optional', nillable: true }),
          ],
        },
        records: { Account: spread(10, i => ({ Required: 'x', Optional: i % 2 ? 'y' : null })) },
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      const pop = (n: string) => catalog!.fields.find(s => s.field.name === n)!.field.populationPct;
      // Required is 100% populated by definition — a fact about the schema, not
      // about use, so it carries no signal and stays unscored (ADR-300).
      expect(pop('Required')).toBeUndefined();
      expect(pop('Optional')).toBeDefined();
    });

    // A checkbox is never null, so null-counting scores every checkbox 100%.
    // How it splits is the real evidence, and only a sample can see it.
    it('scores a boolean by how often it is true', async () => {
      const { client } = makeClient({
        describes: {
          Account: [
            field({ name: 'Used__c', type: 'boolean', nillable: false }),
            field({ name: 'Dead__c', type: 'boolean', nillable: false }),
          ],
        },
        records: { Account: spread(100, i => ({ Used__c: i % 4 === 0, Dead__c: false })) },
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      const pop = (n: string) => catalog!.fields.find(s => s.field.name === n)!.field.populationPct;
      expect(pop('Used__c')).toBe(25);
      expect(pop('Dead__c')).toBe(0);
    });

    it('does not promote an all-false checkbox', async () => {
      const { client } = makeClient({
        describes: { Account: [field({ name: 'Dead__c', type: 'boolean', nillable: false })] },
        records: { Account: spread(100, () => ({ Dead__c: false })) },
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      expect(catalog!.promoted.map(s => s.field.name)).not.toContain('Dead__c');
    });

    it('honors injected regulators over the defaults', async () => {
      const onlyBoostIndustry: Regulator = (f) =>
        f.name === 'Industry' ? { regulator: 'test', delta: 999, reason: 'test boost' } : null;
      const { client } = makeClient({
        describes: { Account: [field({ name: 'Name' }), field({ name: 'Industry' })] },
        records: { Account: spread(100, i => ({ Name: 'x', Industry: i === 0 ? 'Tech' : null })) },
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
        records: { Account: spread(1, () => ({ Name: 'x' })) },
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
        records: { ContentVersion: spread(10, () => ({ IsLatest__c: true, Title: 't', LatestNote: 'n' })) },
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
        records: { ContentVersion: spread(10, () => ({ IsLatest__c: true, Title: 't', LatestNote: 'n' })) },
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
        records: { ContentVersion: spread(1, () => ({ Title: 't' })) },
      });
      const discovery = new FieldDiscovery(client);
      await discovery.discoverObject('ContentVersion');

      expect(discovery.resolveWellKnown('ContentVersion', 'nonesuch')).toBeUndefined();
    });
  });

  describe('getStats', () => {
    // Progress, not a bare "not ready": a caller deciding whether to wait or
    // fall back needs to know how much is outstanding (ADR-301).
    describe('pending state', () => {
      it('names the objects still outstanding before discovery runs', () => {
        const { client } = makeClient();
        const discovery = new FieldDiscovery(client);

        const stats = discovery.getStats();

        expect(stats.ready).toBe(false);
        expect(stats.objectsExpected).toBe(CORE_OBJECTS.length);
        expect(stats.pendingObjects).toEqual([...CORE_OBJECTS]);
      });

      it('shrinks the pending list as objects land', async () => {
        const { client } = makeClient({
          describes: { Account: [field({ name: 'Name' })] },
          records: { Account: spread(10, () => ({ Name: 'x' })) },
        });
        const discovery = new FieldDiscovery(client);

        await discovery.discoverObject('Account');

        expect(discovery.getStats().pendingObjects).not.toContain('Account');
        expect(discovery.getStats().pendingObjects).toContain('Contact');
      });

      it('reports nothing pending once discovery is ready', async () => {
        const { client } = makeClient({
          describes: Object.fromEntries(CORE_OBJECTS.map(o => [o, [field({ name: 'Name' })]])),
          records: Object.fromEntries(CORE_OBJECTS.map(o => [o, spread(5, () => ({ Name: 'x' }))])),
        });
        const discovery = new FieldDiscovery(client);

        discovery.startAsync();
        await discovery.whenSettled();

        expect(discovery.getStats().pendingObjects).toEqual([]);
        expect(discovery.getStats().etaMs).toBeUndefined();
      });

      // An estimate needs something to estimate from; guessing before any
      // object has landed would be inventing a number.
      it('offers no estimate before there is any pace to project from', () => {
        const { client } = makeClient();
        const discovery = new FieldDiscovery(client);

        expect(discovery.getStats().etaMs).toBeUndefined();
      });
    });

    it('reports zeroed, not-ready stats before discovery runs', () => {
      const { client } = makeClient();
      const discovery = new FieldDiscovery(client);

      expect(discovery.getStats()).toMatchObject({
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
        records: {
          Account: spread(10, () => ({ Name: 'x', Industry: 'Tech' })),
          Contact: spread(10, () => ({ Email: 'a@b.c' })),
        },
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
      const records: Record<string, FakeRecord[]> = {};
      for (const obj of CORE_OBJECTS) {
        describes[obj] = [field({ name: 'Name' })];
        records[obj] = spread(5, () => ({ Name: 'x' }));
      }
      const { client } = makeClient({ describes, records });
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
        records: Object.fromEntries(CORE_OBJECTS.map(o => [o, spread(1, () => ({ Name: 'x' }))])),
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
        records: Object.fromEntries(CORE_OBJECTS.map(o => [o, spread(1, () => ({ Name: 'x' }))])),
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
        records: Object.fromEntries(CORE_OBJECTS.map(o => [o, spread(1, () => ({ Name: 'x' }))])),
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

  // The motivating case, in miniature. On a real org BillingCity is 98%
  // populated in the oldest records and 3% in the newest — an all-time count
  // averages that to a middling number describing no record that ever existed,
  // and ranks the corpse alongside a genuinely steady field.
  describe('drift across creation time', () => {
    const abandonedThenSteady = () => makeClient({
      describes: {
        Account: [
          field({ name: 'Abandoned__c', custom: true }),
          field({ name: 'Steady__c', custom: true }),
        ],
      },
      records: {
        Account: spread(300, (i, n) => ({
          // Filled for the first two-thirds of the object's life, then dropped.
          Abandoned__c: i < n * 0.66 ? 'filled' : null,
          // Filled throughout.
          Steady__c: 'filled',
        })),
      },
    });

    it('reports the per-era populations a single number cannot show', async () => {
      const { client } = abandonedThenSteady();
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      const strata = catalog!.fields.find(s => s.field.name === 'Abandoned__c')!.field.strataPopulation!;
      expect(strata.length).toBeGreaterThan(1);
      expect(strata[0]).toBeGreaterThan(strata[strata.length - 1]);
    });

    it('marks a collapsing field as falling and a steady one as stable', async () => {
      const { client } = abandonedThenSteady();
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');
      const trend = (n: string) => catalog!.fields.find(s => s.field.name === n)!.field.trend;

      expect(trend('Abandoned__c')!.direction).toBe('falling');
      expect(trend('Steady__c')!.direction).toBe('stable');
    });

    it('ranks the abandoned field below the steady one', async () => {
      const { client } = abandonedThenSteady();
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');
      const score = (n: string) => catalog!.fields.find(s => s.field.name === n)!.score;

      expect(score('Abandoned__c')).toBeLessThan(score('Steady__c'));
      expect(catalog!.fields[0].field.name).toBe('Steady__c');
    });

    it('records the drift demotion in the audit trail', async () => {
      const { client } = abandonedThenSteady();
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');
      const adjustments = catalog!.fields.find(s => s.field.name === 'Abandoned__c')!.adjustments;

      expect(adjustments.some(a => a.regulator === 'drift')).toBe(true);
    });

    // The tail is what makes recency weighting safe: a field alive only in old
    // records must still be visible, or an agent querying history never learns
    // it exists.
    it('still finds a field that only the oldest records populate', async () => {
      const { client } = makeClient({
        describes: { Account: [field({ name: 'Legacy__c', custom: true })] },
        records: {
          Account: spread(300, (i, n) => ({ Legacy__c: i < n * 0.15 ? 'filled' : null })),
        },
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');
      const legacy = catalog!.fields.find(s => s.field.name === 'Legacy__c')!;

      // Seen, and honestly described as falling — not silently scored zero.
      expect(legacy.field.populationPct).toBeGreaterThan(0);
      expect(legacy.field.strataPopulation![0]).toBeGreaterThan(0);
    });
  });

  describe('global promotion budget', () => {
    it('caps promoted fields at the per-object maximum', async () => {
      const many = Array.from({ length: MAX_PROMOTED_PER_OBJECT + 20 }, (_, i) =>
        field({ name: `F${i}` }),
      );
      const { client } = makeClient({
        describes: { Account: many },
        // Uniform population: no knee, so the hard per-object cap is what bites.
        records: { Account: spread(100, () => Object.fromEntries(many.map(f => [f.name, 'x']))) },
      });
      const discovery = new FieldDiscovery(client);

      const catalog = await discovery.discoverObject('Account');

      expect(catalog!.promoted.length).toBe(MAX_PROMOTED_PER_OBJECT);
    });

    it('demotes the lowest-scoring fields once the global budget is exceeded', async () => {
      // 6 core objects x 40 promoted = 240, over the 200 global budget.
      const describes: Record<string, FakeField[]> = {};
      const records: Record<string, FakeRecord[]> = {};
      for (const obj of CORE_OBJECTS) {
        const fields = Array.from({ length: MAX_PROMOTED_PER_OBJECT + 10 }, (_, i) =>
          field({ name: `${obj}_F${i}` }),
        );
        describes[obj] = fields;
        records[obj] = spread(100, () => Object.fromEntries(fields.map(f => [f.name, 'x'])));
      }
      const { client } = makeClient({ describes, records });
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
        records: {
          Account: spread(100, () => Object.fromEntries(accountFields.map(f => [f.name, 'x']))),
          // Sparse but not dead: ~5% of records, spread evenly so it reads as
          // rare rather than abandoned.
          Contact: spread(100, i =>
            Object.fromEntries(contactFields.map(f => [f.name, i % 20 === 0 ? 'x' : null]))),
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
        records: { Account: spread(100, i => ({ Name: 'x', Industry: i % 10 ? 'Tech' : null })) },
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
        records: { Account: spread(1, () => ({ Name: 'x' })) },
      });
      const discovery = new FieldDiscovery(client);

      await discovery.discoverObject('Account');

      expect(client.ensureInitialized).toHaveBeenCalled();
    });
  });
});
