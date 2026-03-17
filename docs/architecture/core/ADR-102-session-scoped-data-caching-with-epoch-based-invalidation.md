---
status: Draft
date: 2026-03-16
deciders:
  - aaronsb
related:
  - ADR-100
  - ADR-101
  - ADR-104
---

# ADR-102: Session-scoped data caching with epoch-based invalidation

## Context

MCP servers have two scarce resources to protect:

1. **The agent's context window** — every token of response data consumes budget. Sending the same 50-field opportunity record three times in a conversation wastes context that could hold reasoning, user instructions, or other tool results.

2. **Salesforce API call limits** — orgs have daily API budgets. Redundant queries for unchanged data burn limits unnecessarily.

The current server treats every tool call as stateless — a second `get_opportunity_details` for the same record re-queries Salesforce and re-sends the full payload. The agent has no way to say "I already have this, just tell me if it changed."

This is especially wasteful in multi-step workflows where the agent repeatedly touches the same records (e.g., search → detail → analyze → enrich for the same opportunity).

Salesforce provides a natural staleness signal: every record carries `SystemModstamp`, a server-side timestamp updated on any field change. Metadata (object descriptions) changes even less frequently.

## Decision

### 1. Three-tier cache with distinct lifetimes

| Tier | Contents | Lifetime | Invalidation |
|------|----------|----------|-------------|
| **Metadata** | `describe_object` results, field-type maps | Session (minutes) | TTL-based, manual flush |
| **Record** | Individual records by `{objectType}:{id}` | Session | Epoch-based (SystemModstamp) |
| **Query** | Result sets by query fingerprint | Short (seconds) | Next matching query invalidates |

- **Metadata tier** supports ADR-101's field-type computation map. Cached on first access per object, reused for all subsequent analytics and rendering.
- **Record tier** is the core innovation. Each cached record stores its `SystemModstamp` as the epoch marker.
- **Query tier** prevents duplicate queries within tight loops but expires quickly (5-15 seconds). Query results have a fundamental staleness gap that record-level epochs cannot solve: `SystemModstamp` detects changes to *known* records but cannot detect *new* records matching a cached query, or records that no longer match after modification. Short TTL is the honest and likely permanent answer. MCP sessions are conversational, not real-time dashboards — the data doesn't change fast enough within a typical interaction to warrant Streaming API or PushTopic complexity. A 10-15 second TTL with `refresh: true` as an escape hatch covers the actual usage pattern.

### 2. Epoch-based record invalidation

When a tool call would return a previously-cached record:

1. **Lightweight epoch check**: Execute `SELECT Id, SystemModstamp FROM {Object} WHERE Id IN ({cached_ids})` — a single cheap query regardless of how many fields the record has.
2. **Compare epochs**: For each record, compare cached `SystemModstamp` against the fresh value.
3. **If unchanged**: Return a compact reference instead of the full record:
   ```
   ↩ Opportunity 006ABC (Acme Cloud Migration) — unchanged since 2026-03-16T14:32:00Z
   ```
4. **If changed**: Refetch the full record, update the cache, return the new data with a delta hint:
   ```
   ⚡ Opportunity 006ABC updated (Stage: Proposal → Negotiation, Amount: $250K → $275K)
   ```
5. **If deleted**: Remove from cache, return a tombstone notice.

The agent sees either "nothing changed, use what you have" or a focused diff — never a redundant full payload.

### 3. Agent-side cache signals

Add optional parameters to tool schemas:

- **`refresh: boolean`** — force bypass cache and refetch from Salesforce (default: false)
- **`since: string`** — ISO timestamp; only return records modified after this epoch

And response metadata:

- **`cached: boolean`** — whether this response came from cache
- **`epoch: string`** — the SystemModstamp of the returned data
- **`cacheHits: number`** — how many records were served from cache (visibility into savings)

### 4. Write-through on mutations

When the server executes `create_record`, `update_record`, or `delete_record`:

- **Create**: Add the new record to cache with its returned `SystemModstamp`
- **Update**: Invalidate the cached record (next read will refetch with new epoch)
- **Delete**: Remove from cache, add a tombstone for the session

This prevents the common pattern of "update a record, immediately re-read it, get stale cached data."

### 5. Cache budget and eviction

- **Max cached records**: configurable, default 500 per session
- **Eviction policy**: LRU (least recently used) — records not touched recently are evicted first
- **Memory ceiling**: if total cached payload exceeds a threshold (e.g., 10MB), evict oldest entries
- **Session boundary**: cache is cleared when the MCP transport disconnects

## Consequences

### Positive

- Dramatic reduction in redundant data sent to the agent — repeat access to the same records costs nearly zero tokens
- Salesforce API call savings on read-heavy workflows (epoch checks are much cheaper than full queries)
- Delta rendering ("Stage changed from X to Y") is more useful than re-sending the full record
- Metadata caching enables ADR-101's field-type map without per-query describe overhead
- Write-through prevents stale-after-mutation bugs

### Negative

- Session-scoped state adds complexity — the server is no longer purely stateless
- Epoch checks add a query per cache-hit batch (though much cheaper than full refetches)
- Cache size needs tuning per deployment — too small loses the benefit, too large wastes memory
- Edge case: concurrent modification by another user between epoch check and agent action (mitigated by short cache lifetimes and the `refresh` escape hatch)

### Neutral

- MCP resources (`salesforce://opportunity/006ABC`) become a natural interface for cached records — the resource URI is the cache key
- The cache layer sits between handlers and the client — handlers don't need to know about caching
- Epoch-based invalidation aligns with Salesforce's own optimistic concurrency model
- The `since` parameter enables efficient polling patterns for agents monitoring record changes

## Alternatives Considered

- **No caching, rely on ADR-100 rendering alone**: Reduces token size per response but doesn't prevent redundant fetches. An agent asking about the same opportunity 5 times still makes 5 API calls and sends 5 payloads. Insufficient.
- **TTL-only caching (no epochs)**: Simpler but either too aggressive (serves stale data) or too conservative (short TTL negates the benefit). Epochs give precise staleness detection at low cost.
- **ETag/If-Modified-Since with Salesforce API**: Salesforce REST API supports conditional requests, but JSForce doesn't expose this cleanly, and it's per-request overhead. SystemModstamp achieves the same result with a single bulk query.
- **Client-side caching in the MCP client**: Pushes complexity to every consumer. Server-side caching benefits all clients uniformly.
- **Persistent cross-session cache**: Adds storage and invalidation complexity for marginal benefit — MCP sessions are typically short-lived. Rejected in favor of session-scoped simplicity.
