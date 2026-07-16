---
status: Draft
date: 2026-07-16
deciders:
  - aaronsb
  - claude
related:
  - ADR-300
---

# ADR-301: Sample records to score fields, and weight the sample by recency

## Context

ADR-300 promotes fields by population density, measured with one aggregate per
field: `SELECT COUNT(Id) FROM {Object} WHERE {field} != null`. Two problems
follow from that shape, and they are the same problem.

**The measurement is expensive, so the signal stays thin.** A heavily-customised
object costs roughly one query per field — well over a hundred, and seconds of
startup, for a single object. At that price the pipeline can only afford one
question per field — *is it null?* — and only for fields that can be null. Everything else a record could tell us (what values, how many distinct,
how a boolean actually splits) is unaffordable, so booleans and required fields
carry no usage signal at all.

**The measurement is time-blind, so it cannot see drift.** A count over every
record returns one number for the object's entire history. Observed on a
production org: `BillingCity` is 98% populated in 2016 records and 3% in 2026
records. Its all-time figure is 47% — a number describing no record that has
ever existed, and no practice anyone has ever followed. A stable field on the
same org reads 93% all-time and 99-100% in every era. The signal cannot
distinguish the corpse from the core field, because averaging erased the only
dimension that separates them.

These are one problem: per-field counting is what makes per-era measurement
unaffordable. Sampling inverts the economics — a few queries reading many
fields over some records, instead of many queries reading one field over all
records — and a sample carries values, so the richer signals come free.

The general principle: **a usage statistic averaged over a corpus's whole
history describes none of its eras.** Any long-lived dataset accretes
abandoned structure, and abandonment is only visible against time.

## Decision

Score fields from a **recency-weighted, stratified sample of records** rather
than a per-field aggregate over all records.

**Sample wide, not deep.** One query selects every selectable field across a
bounded set of records; distribution is computed in memory. Compound, binary
and long-text types are excluded from the projection — SOQL rejects them in a
wide `SELECT`. Cost per object drops from ~1 query per field to roughly one per
stratum.

**Stratify across creation time, weighted toward the present.** Uniform windows
are wrong twice over: record density is not uniform in time, and recent
practice matters more than old practice. Windows are therefore allocated by
weight, not evenly. Weighting is monotonic in recency — the newest stratum
draws the largest sample — because the question being answered is *what does
this org populate now*, not *what did it ever populate*.

**Retain a mandatory tail.** Every stratum, including the oldest, contributes a
non-zero sample. Fields can be alive only in old records; on the reference org,
four fields are populated in early records and entirely absent from recent
ones. A recency-only sample scores those zero and drops them from the catalog,
leaving an agent querying historical records with no idea they exist. The tail
is what makes weighting safe.

**Sampling is deterministic.** Stratum boundaries derive from the object's
observed creation span, so the same org yields the same sample on every run.
Discovery results are debuggable and reproducible; a promotion decision can be
explained after the fact.

**Trend becomes a first-class signal, reported alongside density.** Per-stratum
population is a by-product of stratified sampling, so the catalog reports both
the weighted figure and its direction. "47%, falling steeply" and "93%, flat"
are different facts about a field, and only the second is worth an agent's
attention. A regulator consumes this: sharply declining usage is a demotion
signal, which is the recency weighting ADR-300 anticipated in its extensible
regulator stack.

**Report pending state rather than silence.** Discovery is async (ADR-300), so
callers can arrive before a catalog exists. The catalog reports that it is
pending — with progress and, where derivable, an estimate — instead of
returning nothing. Silence is indistinguishable from "this object has no
notable fields", which is the wrong inference and one the caller cannot detect.
An agent told *pending* can wait or fall back deliberately; an agent told
nothing cannot.

## Consequences

### Positive

- Startup cost per object falls by roughly an order of magnitude, making
  discovery affordable for more objects and larger orgs.
- Abandoned fields are distinguishable from stable ones — the distinction
  ADR-300 exists to draw, which per-field counting cannot express.
- Booleans and non-nullable fields gain a real usage signal: a sample carries
  values, so a checkbox is scored by how it splits rather than by the fact that
  it is never null. This closes a gap where such fields were unscorable and
  therefore unpromotable regardless of merit.
- Sampling reads records, so future signals (cardinality, value distribution,
  format inference) need no additional queries.
- Callers arriving during discovery get an actionable state instead of silence.

### Negative

- Population becomes an estimate with sampling error, where it was previously
  exact. The exactness was of the wrong quantity, but error bars are new and
  must be defensible.
- Weighting encodes a judgement — that recent practice matters more — which is
  right for query authoring and wrong for auditing historical data. The tail
  bounds the damage; it does not remove the bias.
- Wide projections are a new failure surface: field-count and query-length
  limits, and types SOQL refuses to project, all now sit in the startup path.
- Sample size per stratum trades accuracy against startup cost, adding a tuning
  parameter that will need calibration against real orgs.

### Neutral

- The regulator pipeline and promotion budgets are unchanged; this replaces how
  population is measured and adds a regulator, not how fields are ranked or
  capped.
- The catalog resource schema grows a trend field, and its consumers may ignore
  it.
- Objects with no time dimension, or too few records to stratify, need a
  documented degenerate case (sample everything, report no trend).

## Alternatives Considered

- **Keep per-field counting, add per-era counting.** Directly measures drift
  with no sampling error. Rejected on cost: it multiplies an already-expensive
  scan by the stratum count, making the affordability problem worse in exact
  proportion to the insight gained.
- **Sample recent records only.** Simplest, and it answers the current-practice
  question directly. Rejected because it silently deletes fields that live only
  in historical records — the failure is invisible, since a field that scores
  zero is indistinguishable from a field that does not exist.
- **Naive `LIMIT n` sampling.** One query, no stratification. Rejected: without
  an `ORDER BY`, SOQL returns the oldest records, so the sample measures the
  org's founding era rather than the org. Measured on the reference org at 12
  percentage points of mean error against ground truth, versus 5 for a
  stratified sample — and the error is systematic, not noise.
- **Infer usage from field metadata** (required, has help text, is standard).
  Needs no queries at all. Rejected because metadata describes what an admin
  configured, not what anyone does: a required field is 100% populated by
  definition, which is a fact about the schema and carries no information about
  use. Substituting metadata for observation is what makes abandoned fields
  indistinguishable from used ones in the first place.
