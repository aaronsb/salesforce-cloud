---
status: Draft
date: 2026-03-16
deciders:
  - aaronsb
related:
  - ADR-100
  - ADR-101
  - ADR-102
---

# ADR-103: Intent-driven schema elicitation to reduce discovery overhead

## Context

Salesforce orgs are vast. A typical org has 400+ objects, and a single object like Opportunity can have 200+ fields (standard + custom). The current tool pattern forces agents through a costly discovery sequence:

1. `list_objects` — returns hundreds of objects, most irrelevant
2. `describe_object` on the guessed object — returns all fields, most irrelevant
3. Agent parses the field list to find what matters
4. Agent constructs a query using the discovered field names

This sequence burns 3+ tool calls and thousands of tokens before the agent does anything useful. Worse, agents frequently guess wrong — describing Account when they needed Opportunity, or missing that the relevant data lives in a custom object like `Deal_Review__c`.

The core problem: **the agent knows what it wants to accomplish but not how the org's schema maps to that intent**. The server knows the schema but not the intent. Neither side has the full picture.

## Decision

### 1. Field relevance profiles (v1 — implement now)

Pre-categorize fields by common intent patterns. When an agent describes what it's trying to do, the server returns only the relevant subset:

```typescript
{
  object: 'Opportunity',
  intent: 'pipeline'  // or 'engagement', 'forecasting', 'reporting', 'contact-mapping'
}
```

The server maintains intent-to-field mappings built from the field-type map (ADR-101):

| Intent | Field Selection Strategy |
|--------|------------------------|
| `pipeline` | Stage, Amount, CloseDate, Probability, Owner + currency custom fields |
| `engagement` | LastActivityDate, activity counts, contact roles, related tasks/events |
| `forecasting` | Amount, Probability, ForecastCategory, CloseDate, historical stage durations |
| `reporting` | All categorical fields (for group-by) + all numeric fields (for aggregation) |
| `contact-mapping` | Related Contact Roles, Account contacts, Owner, created-by |

These profiles are **generated dynamically** from the describe metadata and field-type map — not hardcoded. A custom currency field `Deal_Value__c` automatically appears in `pipeline` intent results. A custom picklist `Region__c` automatically appears in `reporting` intent results.

### 2. Contextual field narrowing on existing tools (v1 — implement now)

Extend existing tools with an optional `fields` parameter that accepts either explicit names or an intent tag:

```typescript
// Explicit field selection
{ query: 'SELECT ... FROM Opportunity', fields: ['Name', 'Amount', 'StageName'] }

// Intent-based selection
{ opportunityId: '006ABC', intent: 'engagement' }
```

When `intent` is provided, the handler uses the relevance profile to select fields. When `fields` is provided, only those fields are returned. When neither is provided, the handler returns a default compact set (not all 200+ fields).

This integrates with ADR-100's progressive disclosure — `intent` controls *which* fields, `detail` controls *how much* of each field.

### 3. Object suggestion from natural language hints (deferred — v2)

> **Deferred**: This section describes a future enhancement. Implement after v1 patterns are proven.

A `discover` tool that accepts a loose description and returns ranked object + field suggestions:

```typescript
{ hint: 'deals closing this quarter over 100k', maxSuggestions: 3 }
```

The server tokenizes the hint against object and field labels, scores relevance, and returns ranked suggestions with ready-to-use field lists. This collapses the full discovery sequence into one call but requires non-trivial NL matching logic.

### 4. Schema fingerprinting for org-specific tuning (deferred — v2)

> **Deferred**: This section describes a future enhancement. Implement after v1 patterns are proven.

On first connection, the server computes a lightweight schema fingerprint: which objects have custom fields (indicating active use), which custom objects exist, and the relationship graph between objects. This fingerprint ranks object suggestions and detects org patterns (e.g., "this org uses Deal_Review__c as the primary pipeline object"). Requires async initialization at startup, similar to jira-cloud's field discovery pattern.

## Consequences

### Positive

- Discovery collapses from 3+ tool calls to 1 — massive token and round-trip savings
- Agents work with curated field sets instead of parsing 200-field describe results
- Custom fields are surfaced automatically via intent profiles, not manual discovery
- `fields` parameter on existing tools is backwards compatible — omitting preserves current behavior

### Negative

- Intent profiles are heuristic — they may miss fields relevant to unusual workflows
- Agents can always fall back to `describe_object` for exhaustive field access — elicitation is additive, not replacing

### Neutral

- Intent profiles evolve naturally as the field-type map (ADR-101) grows
- The deferred v2 features (discover tool, schema fingerprinting) build on v1's field profiles without requiring v1 changes

## Implementation Order

This ADR should be implemented **last** in the sequence. It depends on:
- ADR-101's field-type map (for generating intent profiles dynamically)
- ADR-102's metadata cache (for storing describe results)
- ADR-100's rendering (for formatting elicitation responses)

Start with v1 (sections 1-2) — field profiles and `fields`/`intent` parameters. Evaluate v2 (sections 3-4) after v1 is in production.

## Alternatives Considered

- **Pre-built "smart queries"**: Fixed endpoints like `pipeline_summary` that hide schema entirely. Fast to implement but brittle — every new query pattern requires server code. Rejected in favor of composable intent profiles.
- **Agent-side schema caching**: Let the agent call `describe_object` once and remember the results across turns. Pushes the burden to the agent, wastes its context window on field catalogs, and doesn't help with object selection. Rejected.
- **LLM-powered field matching inside the server**: Run a small model to match intent to fields. Adds latency, cost, and a dependency on an inference service. Overkill when metadata-based heuristics work well for structured data. Rejected for now, but could be a future enhancement for the deferred v2 `discover` tool.
- **GraphQL-style field selection**: Let agents specify exact field paths. Powerful but requires agents to already know the schema — doesn't solve the discovery problem. Useful as a complement (the `fields` parameter) but not a replacement for intent-based elicitation.
