---
status: Draft
date: 2026-03-25
deciders:
  - aaronsb
  - claude
related:
  - ADR-103
---

# ADR-300: Field discovery with tiered promotion and catalog resources

## Context

Salesforce field names are not contractual — they vary across orgs depending on API version, edition, and provisioning history. Standard fields like `IsLatestVersion` vs `IsLatest` on ContentVersion demonstrate this: code that hardcodes field names breaks silently on orgs that use a different variant.

This is the same class of problem seen in Jira Cloud, where custom field IDs (`customfield_10015`) are creation-order artifacts, not stable contracts. The jira-cloud MCP server solved this with a field discovery module that runs at startup, qualifies fields by description and usage, and resolves human-readable names to IDs dynamically.

The Salesforce MCP currently hardcodes standard field names throughout handlers and the client. Custom fields are accessible via `describe_object` but there is no proactive discovery, no usage-based ranking, and no mechanism to surface relevant fields to the agent before it queries.

Additionally, the current `describe_object` tool returns a flat list with no signal about which fields matter. An agent facing 200+ fields on an object has no way to distinguish heavily-used fields from abandoned ones without querying every field and counting non-null values.

## Decision

Implement a two-tier field discovery system that runs at server startup (async, non-blocking) and exposes results as MCP resources for agent elicitation.

### Tier 1: Promoted fields

Fields that pass qualification and meet a usage threshold. These are surfaced proactively in tool schemas, next-steps suggestions, and the field catalog resource.

**Discovery pipeline:**

1. **Describe** — fetch field metadata for core objects (Account, Opportunity, Contact, Lead, Contract, ContentVersion, plus any objects seen in recent queries). Parallel with bounded concurrency (default: 3).
2. **Type classification** — use `field-type-map.ts` to classify each field into computation categories (numeric, categorical, text, temporal, identifier, flag, compound, binary). The `isScorable()` function determines which fields can be population-scored.
3. **Usage scoring** — for scorable fields, run `SELECT COUNT(Id) FROM {Object} WHERE {field} != null` with rate-limited parallel execution (default: 5 concurrent) and exponential backoff on 429s.

**Regulator pipeline (scoring):**

After raw population scores are collected, a composable `FieldRegulator` applies scoring adjustments. Each regulator is a pure function that takes a field + context and returns a score delta with a reason. Regulators stack — order doesn't matter, all run on every field.

| Regulator | Signal | Effect |
|-----------|--------|--------|
| `population` | `WHERE field != null` count | Base score (0-100) |
| `namespace` | Managed package prefix (`DOZISF__`, `adroll__`, etc.) | -20 to -40 penalty |
| `labelDemotion` | "Deprecated", "DO NOT USE", `z[` prefix, `TECH` prefix | -30 to -80 penalty |
| `qualityBoost` | Has help text | +15 boost |
| `typeRelevance` | Categorical/numeric fields more analytically useful | +5 to +10 boost |
| `autoPopulated` | System/formula fields (PhotoUrl, Record_ID, etc.) | -50 penalty |

The regulator stack is extensible — new regulators (e.g., recency weighting) can be added without modifying existing ones. Each field's final score includes an audit trail of all adjustments, making promotion decisions transparent and debuggable.

**Promotion cutoff:**

After regulation, fields are ranked by composite score. The cutoff uses the tail-curve knee (largest relative score drop) with a hard cap (default: 40 per object). Fields with score ≤ 0 are never promoted regardless of position.

**Well-known field resolution:**

Fields with known semantic meaning but variable API names (e.g., "latest version" boolean on ContentVersion) are resolved by label pattern + field type matching rather than hardcoding names.

### Tier 2: Discoverable fields

Everything that didn't make Tier 1. Still fully accessible via `describe_object` and `execute_soql`, but now with additional context:

- Why the field wasn't promoted (low usage, no description, unsupported type)
- The field's population density if sampled
- Whether it's a system field, custom field, or relationship

### MCP resource: field catalog

Expose discovery results as MCP resources for agent elicitation (extends ADR-103):

| Resource URI | Content |
|---|---|
| `salesforce://field-catalog/{objectName}` | Promoted fields with types, labels, usage scores |
| `salesforce://field-catalog/{objectName}/all` | Full catalog including Tier 2 with exclusion reasons |
| `salesforce://field-catalog/_stats` | Discovery statistics: objects scanned, fields promoted vs excluded, undescribed ratio |

These resources give the agent a pre-filtered, ranked view of what fields matter on an object before it writes a SOQL query — reducing round-trips and improving query accuracy.

### Context explosion controls

Discovery can produce hundreds of promoted fields across multiple objects. Uncontrolled injection into tool schemas would create context pressure — the cure worse than the disease. Defense is layered:

| Layer | Control | Scope |
|-------|---------|-------|
| Field scoring | Regulator pipeline (negative scores never promote) | Per field |
| Object cap | Hard cap + knee cutoff (default: 40 per object) | Per object |
| Startup scope | Core objects only; others discovered on-demand | Per session |
| Schema budget | Tool descriptions get summary only; full catalog in resources | Per tool call |
| Global budget | Total promoted field count cap across all objects (default: 200) | Per server |

**Schema vs resource split:** Tool descriptions include a brief summary ("Account: 35 promoted fields — read `salesforce://field-catalog/Account` for details"). The full ranked catalog lives in MCP resources, which agents pull on-demand. This keeps `ListTools` responses small regardless of org complexity.

**Internal field resolution:** Code that needs specific field names (like `downloadFile` resolving "latest version" boolean) queries the discovery cache directly — no schema injection needed. This is a lookup, not a context expansion.

### Async tool property factory

After discovery completes, tool descriptions are enriched with per-object summaries and field counts. If discovery hasn't finished when `ListTools` is called, the server returns base schemas (current behavior). This is transparent to the agent — it just sees better tool descriptions over time.

### Startup and caching

- Discovery fires async after MCP handshake, same pattern as existing auth warmup
- Results cached for session lifetime (field schemas don't change mid-session)
- If a tool call arrives before discovery completes for that object, fall back to raw field names (graceful degradation)
- Discovery can be triggered on-demand for objects not in the startup set via describe_object calls

### Inspection surface

A `field_discovery_status` tool (or extension of `describe_object`) that shows:

- Which fields were promoted and their scores
- Which fields were excluded and why
- Mapping of well-known field names to their resolved API names on this org
- Overall catalog health metrics

This gives transparency into filtering decisions and helps diagnose issues when expected fields don't appear.

## Consequences

### Positive

- Field name references are resilient to cross-org variation — no more hardcoded names that break on different orgs
- Agents get a curated, ranked field list before querying — fewer wasted round-trips
- Custom fields with real usage are surfaced automatically without admin configuration
- The inspection surface makes field resolution debuggable
- Pattern is proven in jira-cloud MCP and can share architectural concepts

### Negative

- Startup adds describe + sampling queries — adds 2-5 seconds of async background work per object
- Usage sampling requires SELECT/aggregate permissions on each object
- Tail-curve cutoff is a heuristic — may occasionally exclude a field that matters for a specific use case (mitigated by Tier 2 availability)

### Neutral

- `describe_object` continues to work as-is for ad-hoc exploration
- Existing tool schemas don't change — promoted fields enhance suggestions, not restrict access
- The field catalog resource enables but doesn't require elicitation workflows

## Experimental Validation

Validated against Praecipio's production Salesforce org (6 core objects, 665 total fields). Experiment code in `experiments/` on the `experiment/field-discovery-validation` branch.

| Hypothesis | Result | Data |
|-----------|--------|------|
| H1: Describe latency | **PASS** | 6.1s total with 3-concurrent parallelism. Each describe ~300-430ms. |
| H2: Quality gate | **PASS** | 49% of fields pass (help text + meaningful label). Filters meaningfully without being too aggressive. |
| H3: Usage scoring | **PASS** | 0 errors after using `isScorable()` type classification to exclude compound, binary, textarea, identifier types. |
| H4: Tail-curve cutoff | **PASS** | Clear knee on every object. ContentVersion: 10 promoted. Contact: 32. Account/Opportunity hit 40-field hard cap. |
| H5: Well-known resolution | **PASS** | `ContentVersion.IsLatest` found by label "Is Latest" + type `boolean`. |
| H6: Regulator pipeline | **PASS** | Correctly demotes: managed packages (adroll__ -80), deprecated labels (-80), auto-populated system fields (-50), TECH prefix (-30). Correctly boosts: help text (+15), categorical/numeric types (+10). |

### Key findings

- **Type classification is the bridge.** The existing `field-type-map.ts` (ADR-101) already classifies every Salesforce type. Adding `isScorable()` eliminated all 24 scoring errors from the initial probe run — compound addresses, long text, and binary fields are excluded cleanly.
- **Regulators catch what population misses.** `adroll__Click_Conversion__c` was 100% populated but correctly scored -10 (managed package penalty + deprecated label). `PhotoUrl` was 100% populated but dropped to score 50 (auto-populated penalty).
- **Concurrency controls work.** 3-concurrent describes + 5-concurrent scoring queries completed in 6s with zero 429s. Exponential backoff with jitter is available but wasn't triggered at this concurrency level.
- **Messy org defense.** The namespace regulator, label demotion, and auto-populated detection together handle the "500 fields from 5 managed packages" scenario — junk fields score negative regardless of population density.

## Alternatives Considered

- **Hardcode all known field name variants** — doesn't scale, breaks on custom fields, requires maintenance as Salesforce evolves. This is what we were doing and it broke on `IsLatestVersion` vs `IsLatest`.
- **Always describe before every query** — too slow, adds latency to every tool call. Startup discovery with caching amortizes the cost.
- **Hard cutoff like Jira's 30-field cap** — too aggressive for Salesforce where objects routinely have 50+ meaningful custom fields. The two-tier approach preserves access to everything while focusing attention on what matters.
- **No usage scoring, just describe metadata** — loses the signal about which fields are actually populated. A field can have a great description but zero data — that's not useful for an agent building queries.
