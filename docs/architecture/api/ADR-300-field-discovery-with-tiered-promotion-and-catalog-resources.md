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

**Qualification pipeline:**

1. **Describe** — fetch field metadata for core objects (Account, Opportunity, Contact, Lead, Contract, ContentVersion, plus any objects seen in recent queries)
2. **Quality gate** — exclude fields with no label beyond the API name and no help text (the Salesforce equivalent of Jira's "no description" filter)
3. **Usage scoring** — for custom fields, run a sampling query: `SELECT {field}, COUNT(Id) FROM {Object} WHERE {field} != null GROUP BY {field}` to estimate population density
4. **Tail-curve cutoff** — find the knee in the usage distribution (largest relative drop between adjacent fields) to automatically cap promoted fields. Hard cap at ~40 fields per object.
5. **Well-known field resolution** — for fields with known semantic meaning but variable names (e.g., "latest version" boolean on ContentVersion), resolve by matching label patterns and field type rather than hardcoding API names

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

### Async tool property factory

Discovery results feed back into tool registration. When the server registers tools via `ListTools`, promoted fields are injected into tool schemas dynamically:

- `execute_soql` schema gains per-object field hints in its description: "Opportunity promoted fields: Amount, StageName, CloseDate, Custom_Revenue__c..."
- `describe_object` includes promotion status and usage scores alongside standard metadata
- Internal field references (like "latest version" boolean in `downloadFile`) resolve through the factory rather than hardcoding API names

The factory runs after discovery completes. If discovery hasn't finished when `ListTools` is called, the server returns base schemas (current behavior). Once discovery completes, subsequent `ListTools` calls return enriched schemas. This is transparent to the agent — it just sees better tool descriptions over time.

This is distinct from the catalog resource: the resource is agent-readable context for planning; the factory is machine-readable schema that shapes what the agent can express in tool calls.

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

## Alternatives Considered

- **Hardcode all known field name variants** — doesn't scale, breaks on custom fields, requires maintenance as Salesforce evolves. This is what we were doing and it broke on `IsLatestVersion` vs `IsLatest`.
- **Always describe before every query** — too slow, adds latency to every tool call. Startup discovery with caching amortizes the cost.
- **Hard cutoff like Jira's 30-field cap** — too aggressive for Salesforce where objects routinely have 50+ meaningful custom fields. The two-tier approach preserves access to everything while focusing attention on what matters.
- **No usage scoring, just describe metadata** — loses the signal about which fields are actually populated. A field can have a great description but zero data — that's not useful for an agent building queries.
