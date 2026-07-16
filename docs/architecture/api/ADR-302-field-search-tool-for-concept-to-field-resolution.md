---
status: Accepted
date: 2026-07-16
deciders:
  - aaronsb
  - claude
related:
  - ADR-300
  - ADR-301
---

# ADR-302: Field search tool for concept-to-field resolution

## Context

Field discovery (ADR-300) ranks and caches every field on the core objects and
exposes the result as catalog resources. That solved *"which fields on this
object matter?"* It did not solve the question that comes first in practice:
*"I know what I want to filter or sum — which field is it?"*

The catalog is organised by object. To answer "which field records whether a
deal involved AI?" an agent must pull `salesforce://field-catalog/Opportunity/all`
and scan it. In Claude Code that scan is a local `grep`; in a plain chat client
(Claude Desktop) there is no local text-processing escape hatch, so the agent
reads an 80KB JSON blob into context and eyeballs it — and the field it wants is
often a 3-4% populated custom flag that is easy to skim past. The catalog holds
the answer; nothing lets the agent *ask*.

A concrete session drove this out. A user asked for total pipeline "attributed
to AI" without knowing the field name. Resolving it took: (1) read the full
catalog, (2) grep it for `ai`, finding `AI_Opportunity__c` and `AI_Delivery__c`,
(3) run a `GROUP BY` query *just to learn the picklist values were `Yes`/`No`*,
then (4) aggregate. Steps 1-3 are pure discovery overhead, they recur for every
"which field is X" question, and step 1 is the one that degrades badly outside
Claude Code.

## Decision

Add a `search_fields` tool: a lexical search over the discovered catalogs that
returns the fields matching a term, ranked, optionally carrying their value
sets. It is a read over already-discovered metadata — no new Salesforce calls on
the hot path.

### Matching

Split the term into whitespace tokens and score each candidate field against its
API name, label, and help text. Weighting encodes a signal hierarchy:

| Signal | Weight | Rationale |
|---|---|---|
| Token is a name segment (`ai` in `ai_opportunity__c`) | +50 | Strongest — the field is *named* for it |
| Name segment prefix | +30 | |
| Substring anywhere in name (`ai` in `email`) | +15 | Weak — incidental |
| Whole-word match in label | +40 | |
| Substring in label | +12 | |
| Substring in help text | +8 | Weakest, but disambiguates cryptic API names |

Name and label contributions sum (a term in both is genuinely more relevant), and
the total is scaled by token coverage so a hit on every word of a multi-word
query outranks one that caught a single common word. Results sort by relevance,
then the catalog's own usefulness score (ADR-300), then population, then name —
deterministic, and ties break toward the field with real data behind it.

The matcher is a **pure function** (`src/utils/field-search.ts`) fed the cached
catalogs by the handler. It does no I/O, so its ranking is unit-testable without
a Salesforce connection.

### Value enrichment

`includeValues: true` returns the active picklist values for matched categorical
fields. This folds the step-3 round-trip into the search: a matched picklist
comes back as `AI_Opportunity__c … values: [Yes, No]`, so the agent writes
`WHERE AI_Opportunity__c = 'Yes'` directly. The values ride along on the describe
discovery already performs (ADR-300) — captured into `FieldCandidate` at zero
extra API cost, active values only, since inactive ones can't appear in a filter.

### Scope

Searches all discovered core objects by default; `objectName` narrows to one and
discovers it on demand if the startup sweep hasn't reached it, mirroring the
catalog resource. `minPopulationPct` filters by density but is **off by default**
— sparse custom flags are exactly what this tool exists to find. `limit` defaults
to 25, capped at 100: a search surface, not a dump (ADR-214).

### What it deliberately is not

- **Not semantic.** It matches strings in metadata. It finds `AI_Opportunity__c`
  from "ai" because the characters are there; it will *not* find it from
  "attribution", because nothing in the schema says "attribution". The response
  says so, and points at the full catalog. Synonym/embedding resolution is a
  possible future `mode`, deliberately deferred — it is real scope and easy to
  get subtly wrong.
- **Not a value sampler for free text.** `includeValues` returns picklist value
  sets only (free, from metadata). Sampling distinct values of a free-text or
  high-cardinality field means a live query per field and belongs behind its own
  guard rail, not here (cf. ADR-301 sampling).
- **Not a question-answerer.** It resolves concept → field and stops. The
  judgement calls a real business question needs — which amount field, how to
  bound a date range, whether to dedupe overlapping flags — stay with the caller,
  where they are explicit and auditable, rather than hidden inside a tool.

## Consequences

### Positive

- Concept → field resolution is one call, and it works identically in any MCP
  client — the painful path (dump-and-grep) is gone where it hurt most.
- `includeValues` removes the "now what values does it take?" round-trip.
- Sparse, admin-created custom flags become discoverable by meaning, not just by
  reading the whole catalog.
- Pure matcher keeps ranking behaviour under test.

### Negative

- Lexical matching misses concepts the schema names unexpectedly. Mitigated by
  the honest empty-result message and the catalog fallback, not hidden.
- One more tool on the `ListTools` surface. Justified: it is the missing verb for
  the discovery data ADR-300 already pays to build.

### Neutral

- Adds `picklistValues` to `FieldCandidate`. Additive; catalog resource output is
  unchanged (it does not emit the field).
- Depends on discovery having run. Before it lands, the tool says so rather than
  returning a bare "0 matches" that reads as "this org has no such field".

## Alternatives Considered

- **A query parameter on the catalog resource** (`…/Opportunity?q=ai`). Rejected:
  MCP resources are meant to be cheap passive reads; `includeValues` takes
  parameters and has enrichment behaviour, which is a tool's job.
- **Semantic matching from day one.** Rejected for v1 — high value but real scope
  and failure modes; the lexical version covers the majority of real "which field
  is X" cases cheaply. Left as a future `mode`.
- **A natural-language "answer this business question" tool.** Rejected on
  principle: it would bury the schema decisions that materially change the answer.
  Keep the resolver dumb and composable.
