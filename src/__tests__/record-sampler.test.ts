/// <reference types="jest" />

import {
  stratumWeights, planStrata, isPopulated, populationIn, pooledPopulation, trendFrom,
} from '../utils/record-sampler';
import {
  SAMPLE_STRATA, MIN_STRATUM_SAMPLE, DRIFT_THRESHOLD_PP,
} from '../utils/discovery-constants';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2016, 0, 1);
const T1 = Date.UTC(2026, 0, 1);

describe('stratumWeights', () => {
  it('sums to one', () => {
    const w = stratumWeights(6);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('increases monotonically toward the newest stratum', () => {
    const w = stratumWeights(6);
    for (let i = 1; i < w.length; i++) {
      expect(w[i]).toBeGreaterThan(w[i - 1]);
    }
  });

  it('never gives the oldest stratum zero weight — the tail is evidence', () => {
    expect(stratumWeights(6)[0]).toBeGreaterThan(0);
  });

  it('is uniform when the ratio is 1', () => {
    const w = stratumWeights(4, 1);
    expect(w).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
});

describe('planStrata', () => {
  it('covers the whole span with contiguous windows', () => {
    const strata = planStrata(T0, T1);

    expect(strata).toHaveLength(SAMPLE_STRATA);
    expect(strata[0].from).toBe(T0);
    for (let i = 1; i < strata.length; i++) {
      expect(strata[i].from).toBe(strata[i - 1].to);
    }
  });

  // Records created while discovery is running would otherwise fall outside the
  // span that was measured a moment earlier.
  it('leaves the newest window open-ended', () => {
    const strata = planStrata(T0, T1);

    expect(strata[strata.length - 1].to).toBeUndefined();
    expect(strata.slice(0, -1).every(s => s.to !== undefined)).toBe(true);
  });

  it('samples the newest window most heavily', () => {
    const strata = planStrata(T0, T1);
    const limits = strata.map(s => s.limit);

    expect(limits[limits.length - 1]).toBeGreaterThan(limits[0]);
  });

  // The mandatory tail: a stratum sampled at zero reports its fields as unused,
  // which is indistinguishable from their not existing.
  it('gives every window a non-zero sample at or above the floor', () => {
    for (const s of planStrata(T0, T1)) {
      expect(s.limit).toBeGreaterThanOrEqual(MIN_STRATUM_SAMPLE);
    }
  });

  it('plans the same sample twice for the same span', () => {
    expect(planStrata(T0, T1)).toEqual(planStrata(T0, T1));
  });

  describe('degenerate spans', () => {
    it('collapses to a single window when every record shares a timestamp', () => {
      const strata = planStrata(T0, T0);

      expect(strata).toHaveLength(1);
      expect(strata[0].to).toBeUndefined();
    });

    it('collapses when the span is inverted', () => {
      expect(planStrata(T1, T0)).toHaveLength(1);
    });

    it('collapses when the span is not a number', () => {
      expect(planStrata(NaN, T1)).toHaveLength(1);
      expect(planStrata(T0, NaN)).toHaveLength(1);
    });

    it('still samples a collapsed window', () => {
      expect(planStrata(T0, T0)[0].limit).toBeGreaterThan(0);
    });
  });

  it('honours an explicit stratum count and total', () => {
    const strata = planStrata(T0, T0 + 10 * DAY, { strata: 3, total: 90, minPerStratum: 1 });

    expect(strata).toHaveLength(3);
    expect(strata.reduce((a, s) => a + s.limit, 0)).toBeGreaterThan(0);
  });
});

describe('isPopulated', () => {
  it.each([
    ['a value', 'x', true],
    ['zero', 0, true],
    ['false', false, true],
    ['null', null, false],
    ['undefined', undefined, false],
    ['empty string', '', false],
  ])('treats %s as populated=%s', (_label, value, expected) => {
    expect(isPopulated(value)).toBe(expected);
  });
});

describe('populationIn', () => {
  it('measures how many records carry a value', () => {
    const recs = [{ City: 'A' }, { City: null }, { City: 'B' }, { City: '' }];

    expect(populationIn(recs, 'City', false)).toBe(50);
  });

  // A checkbox is never null, so null-counting scores every checkbox 100% — a
  // fact about the schema, not about use.
  it('measures a boolean by how often it is true, not by being non-null', () => {
    const recs = [{ Flag: false }, { Flag: false }, { Flag: true }, { Flag: false }];

    expect(populationIn(recs, 'Flag', true)).toBe(25);
    // What null-counting would have said:
    expect(populationIn(recs, 'Flag', false)).toBe(100);
  });

  it('reports an all-false checkbox as unused', () => {
    const recs = [{ Flag: false }, { Flag: false }];

    expect(populationIn(recs, 'Flag', true)).toBe(0);
  });

  it('returns zero for an empty sample rather than dividing by it', () => {
    expect(populationIn([], 'City', false)).toBe(0);
  });
});

describe('pooledPopulation', () => {
  // The sample is allocated by recency weight, so pooling already weights the
  // present more heavily. Averaging per-stratum figures would hand every era
  // equal say and throw that away.
  it('weights the present by pooling the recency-allocated sample', () => {
    const older = Array.from({ length: 10 }, () => ({ City: 'filled' }));
    const newer = Array.from({ length: 90 }, () => ({ City: null }));

    // Unweighted average of the two strata would be 50%.
    expect(pooledPopulation([older, newer], 'City', false)).toBe(10);
  });

  it('handles an empty sample', () => {
    expect(pooledPopulation([[], []], 'City', false)).toBe(0);
  });
});

describe('trendFrom', () => {
  it('reports a collapsing field as falling', () => {
    const trend = trendFrom([98, 97, 96, 19, 12, 3]);

    expect(trend!.direction).toBe('falling');
    expect(trend!.deltaPp).toBeLessThan(-DRIFT_THRESHOLD_PP);
  });

  it('reports a steady field as stable', () => {
    const trend = trendFrom([93, 95, 94, 96, 95, 94]);

    expect(trend!.direction).toBe('stable');
    expect(Math.abs(trend!.deltaPp)).toBeLessThan(DRIFT_THRESHOLD_PP);
  });

  it('reports a field coming into use as rising', () => {
    const trend = trendFrom([0, 2, 5, 60, 80, 95]);

    expect(trend!.direction).toBe('rising');
    expect(trend!.deltaPp).toBeGreaterThan(DRIFT_THRESHOLD_PP);
  });

  it('is flat for a field that never moves', () => {
    expect(trendFrom([80, 80, 80, 80, 80, 80])!.deltaPp).toBe(0);
  });

  // These are real shapes, measured on a production org. Both were misread as
  // "stable" by comparing the mean of the newest half to the oldest half:
  // averaging drops the cliff into the flat years before it.
  describe('shapes observed in the wild', () => {
    it('catches a field that was steady for years and then abandoned', () => {
      // A standard picklist: 100% for five windows, then 24%.
      const trend = trendFrom([100, 100, 100, 100, 100, 24]);

      expect(trend!.direction).toBe('falling');
    });

    it('catches a field that declined steadily to nothing', () => {
      const trend = trendFrom([68, 40, 13, 31, 7, 1]);

      expect(trend!.direction).toBe('falling');
    });

    it('leaves a field that dipped only in the newest window alone', () => {
      // Still overwhelmingly used; one softer window is not abandonment.
      const trend = trendFrom([100, 100, 100, 100, 100, 84]);

      expect(trend!.direction).toBe('stable');
    });
  });

  // A single window is a small sample. One reading must not be able to
  // manufacture a trend on its own.
  it('does not let one outlying window decide the direction', () => {
    const steadyWithBlip = trendFrom([95, 95, 0, 95, 95, 95]);

    expect(steadyWithBlip!.direction).toBe('stable');
  });

  it('has no opinion when there is only one stratum', () => {
    expect(trendFrom([50])).toBeUndefined();
    expect(trendFrom([])).toBeUndefined();
  });

  it('reads two strata as the change between them', () => {
    expect(trendFrom([100, 0])!.deltaPp).toBe(-100);
  });
});
