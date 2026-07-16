/// <reference types="jest" />

import { toolSchemas } from '../schemas/tool-schemas';

/**
 * Tool descriptions are the strongest instruction surface the server has: an
 * agent reads them before it acts, on every call, whereas next-steps only land
 * after one. `execute_soql` used to say "Use describe_object first to discover
 * available fields" — a standing order to perform the reconnaissance round-trip
 * that field discovery (ADR-300) exists to eliminate. Removing it from
 * next-steps while leaving it here changed the polite suggestion and left the
 * imperative.
 */
describe('tool schemas', () => {
  it('exposes a description for every tool', () => {
    const undescribed = Object.entries(toolSchemas)
      .filter(([, s]) => typeof s.description !== 'string' || s.description.trim() === '')
      .map(([name]) => name);

    expect(undescribed).toEqual([]);
  });

  describe('execute_soql', () => {
    const description = toolSchemas.execute_soql.description;

    it('does not order the agent to describe an object before querying', () => {
      expect(description).not.toMatch(/describe[_ ]object first/i);
      expect(description).not.toMatch(/use\s+`?describe_object`?\s+(first|to discover)/i);
    });

    it('points at the field catalog as the cheaper route', () => {
      expect(description).toContain('salesforce://field-catalog/');
    });

    // The catalog is a usage filter, not a field list — standard fields are
    // absent by design (ADR-300). Naming it as the answer to "what can I
    // select?" without that caveat invites the reader to conclude anything
    // missing is unavailable, which is false. Every other surface that names
    // the catalog carries this hedge; the tool description is read before
    // every call, so it needs it most.
    it('does not imply the catalog is the complete set of queryable fields', () => {
      expect(description).toMatch(/standard fields remain queryable/i);
    });

    // A tool description is a promise made before the agent can check it.
    // These were once asserted flatly and were false for any non-core object,
    // and false for every object during the startup discovery window.
    it('does not promise behaviour the server only sometimes delivers', () => {
      expect(description).not.toMatch(/results carry/i);
      expect(description).not.toMatch(/reports the fields that do/i);
    });
  });

  describe('describe_object', () => {
    const description = toolSchemas.describe_object.description;

    it('does not present itself as the way to find queryable fields', () => {
      // It returns the full schema — correct when you want everything, wasteful
      // as a precursor to writing a SELECT.
      expect(description).not.toMatch(/use this to discover available fields/i);
    });

    it('points at the catalog for the ranked view', () => {
      expect(description).toContain('salesforce://field-catalog/');
    });
  });

  describe('search_fields', () => {
    const description = toolSchemas.search_fields.description;

    // "the field catalog" is ambiguous in this repo's own vocabulary:
    // salesforce://field-catalog/{obj} is the *promoted* set, /all is every
    // scored field. This tool searches every scored field, so an agent that has
    // internalised "catalog = promoted, standard fields absent" would otherwise
    // read the description and conclude the opposite.
    it('says it searches every scored field, not just promoted ones', () => {
      expect(description).toMatch(/not just the promoted/i);
    });

    // Default scope is the core objects. A 0-hit search reads as "this org has
    // no such field" unless the description admits what it did not look at.
    it('admits that undiscovered objects are not searched', () => {
      expect(description).toMatch(/not been discovered is not searched/i);
    });

    // The example named two fields that exist only in the author's org — a
    // promise false for every other caller, on the surface read before use.
    it('does not cite org-specific field names as examples', () => {
      expect(description).not.toMatch(/__c/);
    });
  });

  it('no tool description instructs a discovery round-trip before real work', () => {
    const offenders = Object.entries(toolSchemas)
      .filter(([name]) => name !== 'describe_object' && name !== 'list_objects')
      .filter(([, s]) => /(?:use|call|run)\s+`?describe_object`?\s+first/i.test(s.description))
      .map(([name]) => name);

    expect(offenders).toEqual([]);
  });
});
