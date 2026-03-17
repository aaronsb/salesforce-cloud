---
status: Draft
date: 2026-03-16
deciders:
  - aaronsb
related:
  - ADR-100
  - ADR-104
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

| SF Field Type | Computation Type | Valid Operations | Notes |
|---|---|---|---|
| `currency`, `double`, `int`, `long`, `percent` | numeric | sum, avg, min, max, arithmetic | |
| `picklist`, `combobox` | categorical | group-by, count, distribution | single-value; use `=` in SOQL |
| `multipicklist` | categorical | group-by, count, distribution | requires `INCLUDES()` in SOQL, not `=` |
| `string`, `textarea`, `url`, `email`, `phone` | text | filter (LIKE), count | `textarea` excluded from SOQL WHERE by default (not indexable) |
| `date`, `datetime`, `time` | temporal | range, duration, cycle-time | `time` is time-of-day only, no date component |
| `reference` | identifier | join, lookup, count-distinct | resolves to both ID and relationship Name (e.g., `AccountId` + `Account.Name`) |
| `id` | identifier | lookup, count-distinct | record identifier, always unique |
| `boolean` | flag | filter, count-where | |
| `address`, `location` | compound | display-only | not directly queryable in SOQL; use component fields (`BillingCity`, etc.) |
| `base64` | binary | skip | excluded from analytics and rendering |

The type map is built from cached `describe_object` results (metadata changes rarely). The agent never specifies types — the system infers what operations are valid for each field.

**SOQL-specific handling**: The type map also encodes query semantics. `multipicklist` fields use `INCLUDES('value')` rather than `= 'value'`. `textarea` fields can't appear in WHERE clauses without explicit opt-in. `address` and `location` are compound types that must be decomposed into their component fields for queries. These rules prevent agents from generating invalid SOQL.

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

## Consequences

### Positive

- Agents can request pipeline analytics in one tool call instead of multi-step SOQL construction
- Works across any Salesforce org regardless of custom field configuration
- API budget management prevents accidental rate limit exhaustion
- Type safety catches invalid operations at query time, not after expensive API calls
- SOQL semantics are encoded in the type map, preventing invalid query generation

### Negative

- Complexity: the type map, DSL parser, and budget calculator are non-trivial to implement
- `describe_object` caching adds a startup cost and cache invalidation concern
- The DSL is intentionally limited — agents needing complex analytics must still construct SOQL

### Neutral

- The field-type map becomes a shared utility used by analytics, rendering (ADR-100), elicitation (ADR-103), and batch validation (ADR-104)
- Implicit measures (like "overdue" or "stale") can be defined per-object as the system matures
- The bounded DSL prevents injection attacks by design — no arbitrary code execution

## Implementation Order

This ADR should be implemented **after ADR-100** (rendering) and **in parallel with ADR-102** (caching), since both share the metadata tier. The field-type map is a prerequisite for ADR-103 (elicitation) and ADR-104 (batch validation).

## Alternatives Considered

- **Let agents write SOQL for analytics**: Current approach. Works for simple queries but agents frequently get SOQL wrong, can't aggregate efficiently, and waste tokens on pagination. Rejected as the default path, but raw SOQL remains available via `execute_soql`.
- **Pre-built dashboard endpoints**: Fixed analytics (e.g., `pipeline_summary`). Quick to implement but inflexible — every new analysis requires a code change. Rejected in favor of the composable DSL.
- **Full expression language (JavaScript subset)**: More powerful but unbounded complexity and security surface. The jira-cloud project deliberately chose a minimal DSL. Adopted their constraint.
