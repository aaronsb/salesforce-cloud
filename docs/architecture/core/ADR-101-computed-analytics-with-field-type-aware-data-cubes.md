---
status: Draft
date: 2026-03-16
deciders:
  - aaronsb
related:
  - ADR-100
---

# ADR-101: Computed analytics with field-type-aware data cubes

## Context

Salesforce data is rich but analysis-hostile for agents. To answer "what's the win rate by industry?" an agent must:

1. Discover available fields via `describe_object`
2. Construct SOQL manually
3. Iterate through paginated results
4. Perform aggregation in its own context window
5. Format the output

This is fragile, token-expensive, and error-prone. Agents frequently construct invalid SOQL or miss pagination boundaries.

Additionally, Salesforce objects have **arbitrary custom fields** (`__c`) whose types vary per org. Any analytics layer must work across unknown schemas without hardcoding field names.

The jira-cloud server solves this with a cube DSL and budget-aware grouping. We can adapt this pattern with a key addition: **automatic field-type inference from Salesforce metadata**.

## Decision

### 1. Field-type computation mapping

Build a lookup table that maps Salesforce field types (from `describe_object`) to computation types:

| SF Field Type | Computation Type | Valid Operations |
|---|---|---|
| `currency`, `double`, `int`, `percent` | numeric | sum, avg, min, max, arithmetic |
| `picklist`, `multipicklist`, `string` | categorical | group-by, count, distribution |
| `date`, `datetime` | temporal | range, duration, cycle-time |
| `reference`, `id` | identifier | join, lookup, count-distinct |
| `boolean` | flag | filter, count-where |

The type map is built from cached `describe_object` results (metadata changes rarely). The agent never specifies types — the system infers what operations are valid for each field.

### 2. Bounded compute DSL

Adopt a safe expression language for computed columns, adapted from jira-cloud's cube DSL:

- Expressions: `name = expr` (e.g., `win_rate = closed_won / total * 100`)
- Operators: arithmetic (`+ - * /`), comparisons (`> < >= <= == !=`)
- Column references resolve to aggregated values
- Max 5 expressions per request (bounded complexity)
- No function calls, no string operations, no side effects

The DSL validates expressions against the field-type map — attempting `sum` on a picklist field returns a clear error, not garbage.

### 3. Analysis tool with budget-aware grouping

Add an `analyze` tool (or extend existing tools) with parameters:

```typescript
{
  object: string;           // e.g., 'Opportunity'
  filter?: string;          // SOQL WHERE clause or simplified filter
  groupBy?: string;         // Field to group by (must be categorical)
  metrics?: string[];       // ['summary', 'distribution', 'cycle']
  compute?: string[];       // ['win_rate = closed_won / total * 100']
  maxGroups?: number;       // Cap on group cardinality (default: 20)
}
```

The server:
1. Resolves `groupBy` against the type map (must be categorical)
2. Estimates query budget: `groups × (standard_measures + implicit_measures)`
3. Caps groups to stay within Salesforce API limits
4. Executes aggregation queries server-side
5. Renders results as a markdown table (per ADR-100)

### 4. Queue/batch operations with result references

Add a `batch` tool for multi-step operations in a single call:

```typescript
{
  operations: [
    { tool: 'create_record', args: { objectName: 'Account', data: { Name: 'Acme' } } },
    { tool: 'create_record', args: { objectName: 'Contact', data: { AccountId: '$0.id', LastName: 'Smith' } } }
  ],
  onError: 'bail' | 'continue'
}
```

- `$N.field` references extract values from prior operation results
- Per-operation error strategy controls whether failures stop the batch
- Summary rendering shows one-liner per operation status

## Consequences

### Positive

- Agents can request pipeline analytics in one tool call instead of multi-step SOQL construction
- Works across any Salesforce org regardless of custom field configuration
- API budget management prevents accidental rate limit exhaustion
- Batch operations reduce round-trips for create-then-link workflows
- Type safety catches invalid operations at query time, not after expensive API calls

### Negative

- Complexity: the type map, DSL parser, and budget calculator are non-trivial to implement
- `describe_object` caching adds a startup cost and cache invalidation concern
- The DSL is intentionally limited — agents needing complex analytics must still construct SOQL
- Batch operations need careful error handling for partial failures

### Neutral

- The field-type map becomes a shared utility used by both analytics and the rendering layer (ADR-100)
- Implicit measures (like "overdue" or "stale") can be defined per-object as the system matures
- The bounded DSL prevents injection attacks by design — no arbitrary code execution

## Alternatives Considered

- **Let agents write SOQL for analytics**: Current approach. Works for simple queries but agents frequently get SOQL wrong, can't aggregate efficiently, and waste tokens on pagination. Rejected as the default path, but raw SOQL remains available via `execute_soql`.
- **Pre-built dashboard endpoints**: Fixed analytics (e.g., `pipeline_summary`). Quick to implement but inflexible — every new analysis requires a code change. Rejected in favor of the composable DSL.
- **Full expression language (JavaScript subset)**: More powerful but unbounded complexity and security surface. The jira-cloud project deliberately chose a minimal DSL. Adopted their constraint.
