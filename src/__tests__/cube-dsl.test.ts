import {
  parseExpression,
  parseComputeList,
  evaluateRow,
  extractColumnRefs,
} from '../utils/cube-dsl';

describe('cube-dsl', () => {
  describe('parseExpression', () => {
    it('should parse a simple expression', () => {
      const result = parseExpression('rate = total / count');
      expect(result.name).toBe('rate');
      expect(result.expr).toBe('total / count');
    });

    it('should distinguish assignment = from comparison ==', () => {
      const result = parseExpression('is_big = amount > 100');
      expect(result.name).toBe('is_big');
      expect(result.expr).toBe('amount > 100');
    });

    it('should handle expression containing !=', () => {
      const result = parseExpression('not_zero = count != 0');
      expect(result.name).toBe('not_zero');
      expect(result.expr).toBe('count != 0');
    });

    it('should reject missing assignment', () => {
      expect(() => parseExpression('total + count')).toThrow(/no assignment/);
    });

    it('should reject empty name', () => {
      expect(() => parseExpression(' = total + 1')).toThrow(/Invalid column name/);
    });

    it('should reject invalid name characters', () => {
      expect(() => parseExpression('my-col = 1')).toThrow(/Invalid column name/);
    });

    it('should reject empty expression', () => {
      expect(() => parseExpression('x = ')).toThrow(/Empty expression/);
    });
  });

  describe('parseComputeList', () => {
    it('should parse multiple expressions', () => {
      const result = parseComputeList([
        'total = a + b',
        'avg = total / 2',
      ]);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('total');
      expect(result[1].name).toBe('avg');
    });

    it('should reject more than 5 expressions', () => {
      const exprs = Array.from({ length: 6 }, (_, i) => `col${i} = ${i}`);
      expect(() => parseComputeList(exprs)).toThrow(/Too many/);
    });

    it('should reject duplicate names', () => {
      expect(() => parseComputeList(['x = 1', 'x = 2'])).toThrow(/Duplicate/);
    });

    it('should accept exactly 5 expressions', () => {
      const exprs = Array.from({ length: 5 }, (_, i) => `col${i} = ${i}`);
      expect(parseComputeList(exprs)).toHaveLength(5);
    });
  });

  describe('evaluateRow', () => {
    it('should evaluate simple arithmetic', () => {
      const cols = parseComputeList(['sum = a + b']);
      const values = new Map([['a', 10], ['b', 20]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'sum', value: 30 });
    });

    it('should respect operator precedence (* before +)', () => {
      const cols = parseComputeList(['result = a + b * c']);
      const values = new Map([['a', 2], ['b', 3], ['c', 4]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'result', value: 14 }); // 2 + (3*4)
    });

    it('should handle parentheses overriding precedence', () => {
      const cols = parseComputeList(['result = (a + b) * c']);
      const values = new Map([['a', 2], ['b', 3], ['c', 4]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'result', value: 20 }); // (2+3)*4
    });

    it('should return 0 for division by zero', () => {
      const cols = parseComputeList(['result = a / b']);
      const values = new Map([['a', 10], ['b', 0]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'result', value: 0 });
    });

    it('should produce Yes/No for comparisons', () => {
      const cols = parseComputeList(['big = amount > 100']);
      const values = new Map([['amount', 250]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'big', value: 'Yes' });
    });

    it('should produce No for false comparisons', () => {
      const cols = parseComputeList(['big = amount > 100']);
      const values = new Map([['amount', 50]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'big', value: 'No' });
    });

    it('should handle == comparison', () => {
      const cols = parseComputeList(['exact = a == b']);
      const values = new Map([['a', 5], ['b', 5]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'exact', value: 'Yes' });
    });

    it('should handle != comparison', () => {
      const cols = parseComputeList(['diff = a != b']);
      const values = new Map([['a', 5], ['b', 3]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'diff', value: 'Yes' });
    });

    it('should allow sequential expression references', () => {
      const cols = parseComputeList([
        'total = won + lost',
        'win_rate = won / total * 100',
      ]);
      const values = new Map([['won', 30], ['lost', 70]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'total', value: 100 });
      expect(results[1]).toEqual({ name: 'win_rate', value: 30 });
    });

    it('should store comparison results as 1/0 for downstream', () => {
      const cols = parseComputeList([
        'is_big = amount > 100',
        'score = is_big * 10',
      ]);
      const values = new Map([['amount', 250]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'is_big', value: 'Yes' });
      expect(results[1]).toEqual({ name: 'score', value: 10 }); // 1 * 10
    });

    it('should throw on unknown column', () => {
      const cols = parseComputeList(['x = missing + 1']);
      const values = new Map<string, number>();
      expect(() => evaluateRow(cols, values)).toThrow(/Unknown column/);
    });

    it('should handle numeric literals', () => {
      const cols = parseComputeList(['pct = count / 100 * 100']);
      const values = new Map([['count', 75]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'pct', value: 75 });
    });

    it('should handle decimal literals', () => {
      const cols = parseComputeList(['result = value * 0.5']);
      const values = new Map([['value', 10]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'result', value: 5 });
    });

    it('should handle subtraction', () => {
      const cols = parseComputeList(['delta = a - b']);
      const values = new Map([['a', 100], ['b', 30]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'delta', value: 70 });
    });

    it('should handle >=  and <= comparisons', () => {
      const cols = parseComputeList([
        'gte = a >= b',
        'lte = a <= b',
      ]);
      const values = new Map([['a', 5], ['b', 5]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'gte', value: 'Yes' });
      expect(results[1]).toEqual({ name: 'lte', value: 'Yes' });
    });

    it('should handle comparison inside parentheses', () => {
      const cols = parseComputeList(['score = (amount > 100) * 10']);
      const values = new Map([['amount', 250]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'score', value: 10 }); // (true=1) * 10
    });

    it('should handle unary minus', () => {
      const cols = parseComputeList(['neg = -a + b']);
      const values = new Map([['a', 10], ['b', 3]]);
      const results = evaluateRow(cols, values);
      expect(results[0]).toEqual({ name: 'neg', value: -7 }); // -10 + 3
    });
  });

  describe('extractColumnRefs', () => {
    it('should extract all column references', () => {
      const cols = parseComputeList([
        'rate = won / total * 100',
        'is_high = rate > 50',
      ]);
      const refs = extractColumnRefs(cols);
      expect(refs).toEqual(new Set(['won', 'total', 'rate']));
    });

    it('should not include numeric literals', () => {
      const cols = parseComputeList(['x = a + 100']);
      const refs = extractColumnRefs(cols);
      expect(refs).toEqual(new Set(['a']));
      expect(refs.has('100')).toBe(false);
    });
  });
});
