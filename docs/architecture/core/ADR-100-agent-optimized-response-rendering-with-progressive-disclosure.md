---
status: Draft
date: 2026-03-16
deciders:
  - aaronsb
related:
  - ADR-101
---

# ADR-100: Agent-optimized response rendering with progressive disclosure

## Context

The server currently returns raw JSON via `JSON.stringify()` in every tool response. This works but has problems:

- **Token waste**: JSON with deeply nested objects, null fields, and verbose keys consumes agent context window budget. A 50-record opportunity search can produce thousands of tokens of structural noise.
- **No summarization**: The agent must parse full payloads to extract what it needs. There's no way to get a quick overview before drilling into detail.
- **No workflow guidance**: After each response the agent must independently figure out what to do next, with no hints about available follow-up actions.

The jira-cloud MCP server solves these with a markdown renderer, expand parameters, and next-steps guidance — patterns proven effective in production.

## Decision

### 1. Markdown response rendering

Replace raw JSON responses with structured markdown optimized for agent consumption:

- **Pipe-delimited summaries** for list results: `Name | Stage | Amount | Owner`
- **Status indicators**: `[x]` done, `[>]` in-progress, `[ ]` open
- **Semantic headings** for sections (## Account Details, ## Related Contacts)
- **Token-conscious truncation** of long text fields
- **HTML/rich-text stripping** from Salesforce description fields

Implement a `MarkdownRenderer` utility with per-object formatters (opportunity, account, contact, etc.) that produce compact, scannable output.

### 2. Progressive disclosure via `expand` and `detail` parameters

Add two control mechanisms to tool schemas:

- **`detail`**: `'summary' | 'full'` — controls response depth. Summary mode returns pipe-delimited one-liners; full mode returns complete field rendering. Default: `summary`.
- **`expand`**: array of additional sections to include. Example: `['contacts', 'activities', 'custom_fields']`. Only fetches and renders what's requested.

This lets the agent start broad and narrow down, instead of getting everything upfront.

### 3. Next-steps guidance

Append contextual follow-up suggestions to every response:

```
---
**Next steps:**
- View opportunity details using `get_opportunity_details`
- Analyze engagement using `analyze_conversation`
- Find similar deals using `find_similar_opportunities`
```

Steps are context-aware — a search result suggests drill-down tools; a detail view suggests analysis tools.

## Consequences

### Positive

- Significantly reduced token consumption per response
- Agents can work in a summary→detail pattern, fetching only what they need
- Next-steps guidance enables multi-step workflows without tool-inventory knowledge
- Consistent output format across all tools

### Negative

- New rendering layer to build and maintain
- Raw JSON access requires explicit opt-in (for agents that need structured data)
- Per-object formatters need updating when new tools/objects are added

### Neutral

- Existing tool schemas gain new optional parameters (`detail`, `expand`) — backwards compatible
- Formatters can be built incrementally, starting with opportunity and account objects
- Pattern aligns with jira-cloud's proven approach, reducing design risk

## Alternatives Considered

- **Keep JSON, let agents format**: Low effort but pushes token cost and formatting burden to every agent consumer. Rejected because the server is better positioned to render efficiently.
- **JSON with field filtering**: Return JSON but allow field selection. Reduces payload but doesn't solve readability or workflow guidance. Partial solution at best.
- **Hybrid JSON+markdown**: Return both formats. Doubles payload size. Rejected — let the agent request raw JSON explicitly if needed.
