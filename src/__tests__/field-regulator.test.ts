import {
  scoreField, regulateFields,
  populationRegulator, namespaceRegulator, labelDemotionRegulator,
  qualityBoostRegulator, typeRelevanceRegulator, autoPopulatedRegulator,
  FieldCandidate,
} from '../utils/field-regulator.js';

function makeField(overrides: Partial<FieldCandidate> = {}): FieldCandidate {
  return {
    name: 'TestField__c',
    label: 'Test Field',
    type: 'string',
    custom: true,
    helpText: null,
    nillable: true,
    computationType: 'text',
    ...overrides,
  };
}

describe('populationRegulator', () => {
  it('should return population percentage as score', () => {
    const adj = populationRegulator(makeField({ populationPct: 75 }));
    expect(adj?.delta).toBe(75);
    expect(adj?.regulator).toBe('population');
  });

  it('should return null when populationPct is undefined', () => {
    expect(populationRegulator(makeField())).toBeNull();
  });

  it('should return 0 for empty fields', () => {
    const adj = populationRegulator(makeField({ populationPct: 0 }));
    expect(adj?.delta).toBe(0);
  });
});

describe('namespaceRegulator', () => {
  it('should penalize managed package fields', () => {
    const adj = namespaceRegulator(makeField({ name: 'DOZISF__ZoomInfo_Id__c' }));
    expect(adj?.delta).toBeLessThan(0);
    expect(adj?.reason).toContain('DOZISF');
  });

  it('should not penalize org-owned custom fields', () => {
    expect(namespaceRegulator(makeField({ name: 'My_Custom__c' }))).toBeNull();
  });

  it('should not penalize standard fields', () => {
    expect(namespaceRegulator(makeField({ name: 'AccountId', custom: false }))).toBeNull();
  });
});

describe('labelDemotionRegulator', () => {
  it('should penalize deprecated labels', () => {
    const adj = labelDemotionRegulator(makeField({ label: 'Click Conversion (Deprecated)' }));
    expect(adj?.delta).toBe(-80);
  });

  it('should penalize DO NOT USE labels', () => {
    const adj = labelDemotionRegulator(makeField({ label: 'z[DO NOT USE] Old Field' }));
    expect(adj?.delta).toBe(-80);
  });

  it('should penalize z-prefix convention', () => {
    const adj = labelDemotionRegulator(makeField({ label: 'z[hidden]' }));
    expect(adj?.delta).toBe(-80);
  });

  it('should penalize TECH prefix', () => {
    const adj = labelDemotionRegulator(makeField({ name: 'TECHLastSync__c', label: 'TECHLastSync' }));
    expect(adj?.delta).toBe(-30);
  });

  it('should return null for normal labels', () => {
    expect(labelDemotionRegulator(makeField({ label: 'Annual Revenue' }))).toBeNull();
  });
});

describe('qualityBoostRegulator', () => {
  it('should boost fields with help text', () => {
    const adj = qualityBoostRegulator(makeField({ helpText: 'Total revenue from all sources' }));
    expect(adj?.delta).toBe(15);
  });

  it('should return null without help text', () => {
    expect(qualityBoostRegulator(makeField())).toBeNull();
  });

  it('should return null for whitespace-only help text', () => {
    expect(qualityBoostRegulator(makeField({ helpText: '   ' }))).toBeNull();
  });
});

describe('typeRelevanceRegulator', () => {
  it('should boost categorical fields', () => {
    const adj = typeRelevanceRegulator(makeField({ computationType: 'categorical' }));
    expect(adj?.delta).toBe(10);
  });

  it('should boost numeric fields', () => {
    const adj = typeRelevanceRegulator(makeField({ computationType: 'numeric' }));
    expect(adj?.delta).toBe(10);
  });

  it('should boost temporal fields less', () => {
    const adj = typeRelevanceRegulator(makeField({ computationType: 'temporal' }));
    expect(adj?.delta).toBe(5);
  });

  it('should return null for text fields', () => {
    expect(typeRelevanceRegulator(makeField({ computationType: 'text' }))).toBeNull();
  });
});

describe('autoPopulatedRegulator', () => {
  it('should penalize PhotoUrl', () => {
    const adj = autoPopulatedRegulator(makeField({ name: 'PhotoUrl' }));
    expect(adj?.delta).toBe(-50);
  });

  it('should penalize Record_ID fields', () => {
    const adj = autoPopulatedRegulator(makeField({ name: 'Record_ID__c' }));
    expect(adj?.delta).toBe(-50);
  });

  it('should return null for normal fields', () => {
    expect(autoPopulatedRegulator(makeField({ name: 'Revenue__c' }))).toBeNull();
  });
});

describe('scoreField', () => {
  it('should combine all regulator adjustments', () => {
    const field = makeField({
      populationPct: 100,
      computationType: 'numeric',
      helpText: 'Important metric',
    });
    const result = scoreField(field);
    // population(100) + quality(15) + type(10) = 125
    expect(result.score).toBe(125);
    expect(result.adjustments.length).toBe(3);
  });

  it('should produce negative score for junk fields', () => {
    const field = makeField({
      name: 'adroll__Click_Conversion__c',
      label: 'Click Conversion (Deprecated)',
      populationPct: 100,
    });
    const result = scoreField(field);
    // population(100) + namespace(-20) + deprecated(-80) = 0
    expect(result.score).toBeLessThanOrEqual(0);
  });
});

describe('regulateFields', () => {
  it('should sort by score descending', () => {
    const fields = [
      makeField({ name: 'Low', populationPct: 10 }),
      makeField({ name: 'High', populationPct: 90, computationType: 'numeric' }),
      makeField({ name: 'Mid', populationPct: 50 }),
    ];
    const result = regulateFields(fields, 40);
    expect(result[0].field.name).toBe('High');
    expect(result[result.length - 1].field.name).toBe('Low');
  });

  it('should respect maxPromoted cap', () => {
    const fields = Array.from({ length: 50 }, (_, i) =>
      makeField({ name: `Field_${i}__c`, populationPct: 100 - i }),
    );
    const result = regulateFields(fields, 10);
    const promoted = result.filter(r => r.promoted);
    expect(promoted.length).toBeLessThanOrEqual(10);
  });

  it('should not promote fields with score <= 0', () => {
    const fields = [
      makeField({ name: 'adroll__Junk__c', label: 'Junk (Deprecated)', populationPct: 100 }),
      makeField({ name: 'Good__c', populationPct: 80 }),
    ];
    const result = regulateFields(fields, 40);
    const promoted = result.filter(r => r.promoted);
    expect(promoted.every(p => p.score > 0)).toBe(true);
    expect(promoted.some(p => p.field.name === 'Good__c')).toBe(true);
  });
});
