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

# ADR-104: Batch operations with destructive-operation guardrails

## Context

Multi-step Salesforce workflows require multiple tool calls with data dependencies between them. For example, creating an Account and then a Contact referencing that Account requires two round-trips, with the agent extracting the Account ID from the first response to pass into the second.

This is slow (2 round-trips minimum), fragile (the agent must parse IDs correctly), and wasteful (each round-trip consumes context window tokens for the intermediate response).

The jira-cloud server solves this with a queue handler that supports result references (`$0.key`). However, batch operations that include mutations (create, update, delete) introduce a safety concern: an agent could inadvertently execute a rapid sequence of destructive operations. The jira-cloud project addresses this with a `bulk-operation-guard.ts` that uses a sliding window to detect and halt dangerous patterns.

This ADR was split from ADR-101 (analytics), which originally included batch operations. Batch and analytics are separate concerns — analytics is read-only, batch involves mutations with safety implications.

## Decision

### 1. Batch tool with result references

Add a `batch` tool for multi-step operations in a single call:

```typescript
{
  operations: [
    { tool: 'create_record', args: { objectName: 'Account', data: { Name: 'Acme' } } },
    { tool: 'create_record', args: { objectName: 'Contact', data: { AccountId: '$0.id', LastName: 'Smith' } } }
  ],
  onError: 'bail' | 'continue',
  detail: 'summary' | 'full'
}
```

- **`$N.field` references**: Extract values from prior operation results. `$0.id` resolves to the ID returned by operation 0. Supported fields: `id`, `key`, `success`.
- **`onError`**: Controls failure behavior. `bail` (default) stops on first failure. `continue` executes remaining operations and reports partial results.
- **`detail`**: Controls response verbosity (per ADR-100). `summary` returns one-liner per operation; `full` returns complete responses.
- **Max operations**: 16 per batch (same as jira-cloud). Prevents unbounded sequences.

### 2. Destructive operation pre-scan

Before executing any batch, the server scans the operation list for destructive actions:

| Operation | Classification | Guardrail |
|-----------|---------------|-----------|
| `create_record` | constructive | no limit |
| `update_record` | mutative | warn if > 5 in a single batch |
| `delete_record` | destructive | max 3 per batch, require explicit confirmation field |

Delete operations in a batch require `confirm: true` in their args:

```typescript
{ tool: 'delete_record', args: { objectName: 'Account', recordId: '001ABC', confirm: true } }
```

Without `confirm: true`, the batch returns an error before executing anything, listing the destructive operations that need confirmation. This is a speed bump, not a block — the agent can retry with confirmations added.

### 3. Sliding-window rate limiter

Track destructive operations across batches within a 60-second sliding window:

- **Delete threshold**: max 10 deletes per 60 seconds
- **Update threshold**: max 50 updates per 60 seconds
- **Breach behavior**: refuse the batch with a clear message explaining the limit and when it resets

This prevents an agent in a loop from accidentally deleting or modifying large numbers of records. The thresholds are conservative — bulk operations should use Salesforce's native Bulk API, not MCP tool calls.

When the rate limiter triggers, the response includes:
- How many operations were attempted vs. allowed
- Time until the window resets
- Suggestion to use Salesforce's bulk tools for large-scale operations

### 4. Write-through cache integration

Batch operations integrate with ADR-102's cache:

- **Creates**: New records added to cache with their returned `SystemModstamp`
- **Updates**: Cached records invalidated (next read refetches)
- **Deletes**: Cached records removed, tombstoned for the session
- **On batch failure with `onError: 'bail'`**: Only operations that actually executed update the cache

### 5. Result reference resolution

References follow a strict format: `$N.field` where N is the zero-indexed operation number and field is one of the extractable values. Resolution rules:

- References can only point **backwards** (operation 3 can reference $0, $1, $2 but not $3 or higher)
- If the referenced operation failed, the referencing operation fails with a clear error
- If the referenced field doesn't exist in the result, the operation fails before execution
- Circular references are impossible by design (backwards-only)

## Consequences

### Positive

- Multi-step create-then-link workflows execute in one round-trip
- Destructive operations have explicit safety limits — agents can't accidentally bulk-delete
- Sliding window prevents runaway loops from causing damage
- Cache integration means subsequent reads reflect batch mutations correctly
- Summary mode (per ADR-100) keeps batch responses compact

### Negative

- Confirmation requirement on deletes adds friction for legitimate batch deletions
- Rate limits may frustrate agents doing legitimate bulk work (mitigated by clear messaging about Salesforce Bulk API)
- 16-operation cap limits complex multi-step workflows (intentional — complex sequences should be broken into multiple batches)

### Neutral

- The batch tool is independent of analytics (ADR-101) — either can be implemented without the other
- Guardrail thresholds are configurable per deployment if defaults prove too conservative
- The pre-scan pattern can be extended to other safety checks (e.g., preventing cross-object cascading deletes)

## Implementation Order

Implement **after ADR-100** (needs summary rendering) and **after ADR-102** (needs cache write-through). Can be implemented in parallel with ADR-101 (analytics) since they are independent concerns.

## Alternatives Considered

- **No guardrails, trust the agent**: Faster to implement but one bad loop could delete hundreds of records. The jira-cloud project learned this lesson and added guards retroactively. Better to build them in from the start.
- **Require human confirmation for all mutations**: Too restrictive — creates, updates to single records, and controlled deletes should be frictionless. Only bulk/rapid destructive patterns need guardrails.
- **Salesforce-side validation rules**: Relies on the org admin having configured appropriate rules. Can't guarantee coverage, and doesn't protect against rate-limit exhaustion. Server-side guards are a complementary layer.
- **No batch tool, let agents make sequential calls**: Current approach. Works but is slow, fragile, and wasteful. The batch pattern with references is proven in jira-cloud.
