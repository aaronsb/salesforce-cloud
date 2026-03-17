/**
 * Bounded DSL for computed columns in data cube queries (ADR-101).
 *
 * Expressions: `name = expr` where expr supports:
 * - Column references (any existing column name)
 * - Numeric literals
 * - Arithmetic: + - * /
 * - Comparisons: > < >= <= == != (produce Yes/No)
 *
 * Evaluation is linear — each expression can reference columns from
 * earlier expressions. No functions, no loops, no nesting beyond parens.
 *
 * Adapted from jira-cloud cube-dsl.ts for Salesforce analytics.
 */

const MAX_EXPRESSIONS = 5;

export interface ComputeExpression {
  name: string;
  expr: string;
}

export interface ComputeResult {
  name: string;
  value: number | string; // number for arithmetic, "Yes"/"No" for comparisons
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

type TokenType = 'number' | 'ident' | 'op' | 'paren';
interface Token {
  type: TokenType;
  value: string;
}

const OP_CHARS = new Set(['+', '-', '*', '/', '>', '<', '=', '!']);

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    if (expr[i] === ' ' || expr[i] === '\t') { i++; continue; }

    if (expr[i] === '(' || expr[i] === ')') {
      tokens.push({ type: 'paren', value: expr[i] });
      i++;
      continue;
    }

    if (OP_CHARS.has(expr[i])) {
      const two = expr.slice(i, i + 2);
      if (['>=', '<=', '==', '!='].includes(two)) {
        tokens.push({ type: 'op', value: two });
        i += 2;
        continue;
      }
      if (['+', '-', '*', '/', '>', '<'].includes(expr[i])) {
        tokens.push({ type: 'op', value: expr[i] });
        i++;
        continue;
      }
    }

    if (/\d/.test(expr[i])) {
      let num = '';
      while (i < expr.length && /[\d.]/.test(expr[i])) {
        num += expr[i];
        i++;
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    if (/[a-zA-Z_]/.test(expr[i])) {
      let ident = '';
      while (i < expr.length && /\w/.test(expr[i])) {
        ident += expr[i];
        i++;
      }
      tokens.push({ type: 'ident', value: ident });
      continue;
    }

    throw new Error(`Unexpected character "${expr[i]}" in expression`);
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Parser / evaluator (recursive descent)
// Precedence: comparison < additive < multiplicative < primary
// ---------------------------------------------------------------------------

function evaluate(tokens: Token[], columns: Map<string, number>): number | string {
  let pos = 0;

  function peek(): Token | undefined { return tokens[pos]; }
  function advance(): Token { return tokens[pos++]; }

  function primary(): number {
    const tok = peek();
    if (!tok) throw new Error('Unexpected end of expression');

    // Unary minus
    if (tok.type === 'op' && tok.value === '-') {
      advance();
      return -primary();
    }

    if (tok.type === 'paren' && tok.value === '(') {
      advance();
      // Delegate to comparisonExpr so (a > b) works inside parens
      const val = comparisonExpr();
      const close = peek();
      if (!close || close.value !== ')') throw new Error('Missing closing parenthesis');
      advance();
      // Coerce comparison results to number for arithmetic context
      if (typeof val === 'string') return val === 'Yes' ? 1 : 0;
      return val;
    }

    if (tok.type === 'number') {
      advance();
      const num = parseFloat(tok.value);
      if (isNaN(num)) throw new Error(`Invalid number: "${tok.value}"`);
      return num;
    }

    if (tok.type === 'ident') {
      advance();
      const val = columns.get(tok.value);
      if (val === undefined) throw new Error(`Unknown column: "${tok.value}"`);
      return val;
    }

    throw new Error(`Unexpected token: "${tok.value}"`);
  }

  function multiplicativeExpr(): number {
    let left = primary();
    while (peek()?.type === 'op' && (peek()!.value === '*' || peek()!.value === '/')) {
      const op = advance().value;
      const right = primary();
      if (op === '*') left *= right;
      else left = right === 0 ? 0 : left / right;
    }
    return left;
  }

  function additiveExpr(): number {
    let left = multiplicativeExpr();
    while (peek()?.type === 'op' && (peek()!.value === '+' || peek()!.value === '-')) {
      const op = advance().value;
      const right = multiplicativeExpr();
      if (op === '+') left += right;
      else left -= right;
    }
    return left;
  }

  function comparisonExpr(): number | string {
    const left = additiveExpr();
    const tok = peek();
    if (tok?.type === 'op' && ['>', '<', '>=', '<=', '==', '!='].includes(tok.value)) {
      const op = advance().value;
      const right = additiveExpr();
      let result: boolean;
      switch (op) {
        case '>': result = left > right; break;
        case '<': result = left < right; break;
        case '>=': result = left >= right; break;
        case '<=': result = left <= right; break;
        case '==': result = left === right; break;
        case '!=': result = left !== right; break;
        default: throw new Error(`Unknown operator: "${op}"`);
      }
      return result ? 'Yes' : 'No';
    }
    return left;
  }

  const result = comparisonExpr();

  if (pos < tokens.length) {
    throw new Error(`Unexpected token after expression: "${tokens[pos].value}"`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Parse a single compute expression: `name = expr` */
export function parseExpression(raw: string): ComputeExpression {
  // Find the assignment = (not ==, !=, >=, <=)
  let assignIdx = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '=') {
      const prev = i > 0 ? raw[i - 1] : '';
      const next = i + 1 < raw.length ? raw[i + 1] : '';
      if (prev !== '!' && prev !== '>' && prev !== '<' && prev !== '=' && next !== '=') {
        assignIdx = i;
        break;
      }
    }
  }

  if (assignIdx === -1) {
    throw new Error(`Invalid compute expression: no assignment "=" found in "${raw}"`);
  }

  const name = raw.slice(0, assignIdx).trim();
  const expr = raw.slice(assignIdx + 1).trim();

  if (!name || !/^[a-zA-Z_]\w*$/.test(name)) {
    throw new Error(`Invalid column name: "${name}"`);
  }
  if (!expr) {
    throw new Error(`Empty expression for column "${name}"`);
  }

  return { name, expr };
}

/** Parse and validate a list of compute expressions (max 5) */
export function parseComputeList(rawExpressions: string[]): ComputeExpression[] {
  if (rawExpressions.length > MAX_EXPRESSIONS) {
    throw new Error(`Too many compute expressions (max ${MAX_EXPRESSIONS}, got ${rawExpressions.length})`);
  }

  const columns: ComputeExpression[] = [];
  const names = new Set<string>();

  for (const raw of rawExpressions) {
    const col = parseExpression(raw);
    if (names.has(col.name)) {
      throw new Error(`Duplicate column name: "${col.name}"`);
    }
    names.add(col.name);
    columns.push(col);
  }

  return columns;
}

/** Evaluate compute expressions against a row of column values */
export function evaluateRow(
  columns: ComputeExpression[],
  rowValues: Map<string, number>,
): ComputeResult[] {
  const ctx = new Map(rowValues);
  const results: ComputeResult[] = [];

  for (const col of columns) {
    const tokens = tokenize(col.expr);
    const value = evaluate(tokens, ctx);
    // Store numeric value in context for subsequent expressions
    if (typeof value === 'number') {
      ctx.set(col.name, value);
    } else {
      // Boolean results stored as 1/0 for downstream references
      ctx.set(col.name, value === 'Yes' ? 1 : 0);
    }
    results.push({ name: col.name, value });
  }

  return results;
}

/** Extract column references from expressions (for lazy measure detection) */
export function extractColumnRefs(columns: ComputeExpression[]): Set<string> {
  const refs = new Set<string>();
  for (const col of columns) {
    const tokens = tokenize(col.expr);
    for (const tok of tokens) {
      if (tok.type === 'ident') {
        refs.add(tok.value);
      }
    }
  }
  return refs;
}
