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

  it('no tool description instructs a discovery round-trip before real work', () => {
    const offenders = Object.entries(toolSchemas)
      .filter(([name]) => name !== 'describe_object' && name !== 'list_objects')
      .filter(([, s]) => /(?:use|call|run)\s+`?describe_object`?\s+first/i.test(s.description))
      .map(([name]) => name);

    expect(offenders).toEqual([]);
  });
});
