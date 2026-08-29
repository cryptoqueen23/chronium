# Chronium Research Method

Companion to `docs/CANON.md`'s data-level "Core Workflow" (SOURCE → CAPTURE → EXTRACT →
INDEX → SEARCH → CONNECT → COMPARE → TIMELINE → EVIDENCE). This document is the
investigation-level loop: how a human researcher actually moves through Chronium,
not how one piece of evidence flows through the pipeline.

## The Research Loop

A cycle, not a one-way pipeline — it feeds back into itself:

```text
QUESTION
   ↓
DISCOVER
   ↓
COLLECT
   ↓
EXTRACT
   ↓
DEDUPLICATE
   ↓
CONNECT
   ↓
COMPARE
   ↓
FIND GAPS
   ↓
VERIFY
   ↓
REPORT
   ↓
NEW QUESTIONS  →  (back to QUESTION)
```

## Detailed Research Workflow

A more granular walk through the same loop, for a single research question:

```text
RESEARCH QUESTION
      ↓
RESEARCH OUTLINE
      ↓
SOURCE DISCOVERY
      ↓
DETAILED BIBLIOGRAPHY
      ↓
SOURCE INGESTION
      ↓
EXTRACTION / INDEXING
      ↓
GAPS + CONTRADICTIONS
      ↓
ADDITIONAL RESEARCH
      ↓
FINDINGS
      ↓
AGGREGATED REPORT
```

## Investigation Structure

```text
INVESTIGATION
   ├── OUTLINE
   │
   ├── SOURCES / BIBLIOGRAPHY
   │       └── EVIDENCE
   │               └── CLAIMS
   │
   ├── CONTRADICTIONS
   ├── GAPS
   ├── TIMELINE
   └── REPORT
```

An investigation is more than a flat bag of saved records: sources carry evidence,
evidence supports (or contradicts) specific claims, and claims are what a
timeline/report/gap-analysis actually reasons over. **This structure is shipped**
as of 2026-08-28 — Sources, Evidence, Claims, Timeline, Gaps, and a deterministic
Evidence-Backed Report all exist. Contradictions currently comes from AI
Qualitative Analysis' output (opt-in, paid) rather than a deterministic
two-Claims-that-can't-both-be-true detector — that deterministic version is
still ahead (`docs/ROADMAP.md` Phase 4). The Investigation Workspace's visible
navigation groups this into 4 sections (Research / Evidence / Findings / Report)
rather than one tab per concept — see `docs/CLAUDE_HANDOFF.md` for the current
shape — but the underlying data model below is unchanged by that grouping.

## Analysis Modes

Chronium supports three first-class analysis modes over the same evidence base:

- **Quantitative** — extracts structured numbers and calculates trends, changes,
  totals, variances, outliers, and reconciliations.
- **Qualitative** — extracts themes, statements, rationale, decisions, language
  changes, relationships, and chronology from narrative evidence.
- **Mixed-method** — cross-checks what the numbers show against what the records
  say (e.g. does the budget line item match what the meeting minutes describe).

Both quantitative and qualitative analysis must preserve their methodology and
source/evidence citations. **Never turn a correlation, discrepancy, theme, or AI
interpretation into a factual conclusion** — this is the SOURCE FACT / COMPUTED
FACT / AI ANALYSIS separation from `docs/CANON.md`, applied specifically to
analysis output.

## Current Research Flow (supersedes the workflow diagram above)

```text
QUESTION
   ↓
OUTLINE
   ↓
SOURCES / BIBLIOGRAPHY
   ↓
QUANTITATIVE + QUALITATIVE ANALYSIS
   ↓
CROSS-VALIDATION
   ↓
GAPS / CONTRADICTIONS
   ↓
FINDINGS
   ↓
EVIDENCE-BACKED REPORT
```

## Research Outline & Coverage

An investigation begins with a question and a **dynamic** research outline.
Chronium uses the outline to determine what evidence categories/sources are
needed, tracks coverage against it, and expands the outline as new leads emerge.

Illustrative example of outline coverage as a UI concept — percentages are a
rough, visible signal of which research lanes have adequate evidence and which
don't, **never presented as mathematical truth**:

```text
Election authorization:     100%
Tax collections:             80%
Budgets:                    100%
Expenditures:                65%
Contracts:                   40%
Completed road projects:     25%
```

Before publishing, Chronium should be able to surface a gap warning grounded in
that coverage picture, e.g.:

> Research gap: strong evidence for what was collected and budgeted, insufficient
> evidence for actual project-level expenditures.

## Source → Evidence Item → Claim

These are modeled as **three separate things**, not one flat "record":

- **Source** — the bibliography entry (see Target Source Record Shape below):
  provenance, publisher, source type/authority, dates, original/archive
  locations, hash/version, topics/entities, relevant pages/sections,
  investigation usage, preservation status, notes.
- **Evidence Item** — a specific piece of content pulled from a Source (a
  paragraph, a table row, a figure) that bears on the investigation.
- **Claim** — a specific factual assertion an Evidence Item supports (or
  contradicts). Claims are what findings and reports actually reason over.

**Reports must be generated from evidence-backed claims, not directly from raw
search results or AI summaries.** This is the concrete mechanism behind "never
lose the receipt" once reporting exists: a report can always be walked backward,
claim → evidence item → source.

## Workspace Navigation (as shipped, 2026-08-28)

The concepts below are all built. The UI groups them into 4 primary
sections rather than one tab per concept — a first-time user shouldn't
need to learn "Outline" or "coverage lanes" vocabulary before they can
upload a document and search it (see `docs/CLAUDE_HANDOFF.md` for the
reasoning). The underlying data model is exactly the concept tree that
follows; only the navigation grouping changed.

```text
CHRONIUM MIND — Investigation Workspace

RESEARCH                         (search + ingestion, one screen)
├── "What are you trying to find?" search
├── My Files (bulk-ingested documents, passage + page-aware search)
├── Current Web / Historical Web (Arquivo.pt, Wayback, Common Crawl, Memento)
└── Datasets / APIs                                    [not started]

EVIDENCE                         (saved receipts: excerpt, source, page, provenance)

FINDINGS                         (sub-tabs, one section)
├── Claims
├── Timeline
├── Contradictions             (AI Qualitative Analysis output today;
│                                deterministic 2-claims-conflict detector
│                                is Phase 4, not started)
├── Gaps                        (coverage lanes live here - a lane with no/low
│                                linked evidence is a gap)
└── Analysis
    ├── Research Question / Method   (feeds Qualitative Analysis)
    ├── Quantitative Analysis        (deterministic, always free)
    └── Qualitative Analysis         (AI-assisted, opt-in, paid)

REPORT                           (deterministic, generated from Claims)

Connections (relationship graph: person ↔ company ↔ contract ↔ ...)  [not started, Phase 6]
```

Bibliography (Publisher/Source Type/Reliability per source) is a separate
top-level nav item, not one of the 4 workspace tabs — it's scoped to the
active investigation's sources the same way the workspace is.

## Bulk Import UX (illustrative)

Two sketches of the intended import experience — a landing/drop state inside an
investigation, and the post-import summary. Directional for layout/prominence;
the underlying ingestion engine (`public/ingest/`) already implements the
hash/dedupe/extract/report mechanics these describe.

```text
CHRONIUM MIND
Research Everything. Lose Nothing.

[ + New Investigation ]   [ ⇧ Import Research ]

────────────────────────────────────────

MY INVESTIGATION
Copperas Cove Road Funding

┌─────────────────────────────────────────────┐
│                                             │
│       DROP YOUR RESEARCH HERE               │
│                                             │
│   ZIP • PDF • CSV • XLSX • DOCX • TXT • EML│
│                                             │
│   Drop files, folders, or a ZIP             │
│                                             │
│              [ Browse Files ]               │
│                                             │
│   Originals stay on your device by default  │
└─────────────────────────────────────────────┘

3,233 documents indexed

[ Search everything in this investigation... ]
```

```text
IMPORT COMPLETE

Files received          1,847
Successfully indexed    1,796
Duplicates                 31
Needs attention             20

PDF                       932
Excel/CSV                  311
Word                       247
Email                      188
Text                       118
Other                       51

[ Search Corpus ] [ Organize ] [ Review Problems ]
```

## Target Source Record Shape

A worked example of what a fully-populated source record should look like once the
schema matures (illustrative — not every field is populated by every ingestion path
yet):

```text
SOURCE ID: CHR-000184

Title: FY 2025-2026 Adopted Budget
Publisher: City of Copperas Cove
Source Type: Primary Government Record
Document Type: Budget
Original URL: [...]

Archive Providers:
  Wayback: [...]
  Arquivo.pt: [...]
  Common Crawl: [...]

Publication Date: September 2025
Retrieved: August 27, 2026
Coverage: FY2025-26

Pages: 412
Relevant Pages: 143-151, 287

Topics: Roads, Street Maintenance, Sales Tax, Capital Projects
Entities: City Council, Public Works, Finance Department
Funds/Accounts: [...]
Amounts: [...]

Used For: Road Funding Investigation
Evidence Supported: CHR-CLAIM-017, CHR-CLAIM-024

Content Hash: [...]
Preservation:
  Original available: yes
  Wayback: yes
  Alternate archive: yes
  R2 preserved: no

Research Notes: [...]
Reliability: PRIMARY / AUTHORITATIVE
```

Notable distinctions this shape makes explicit, worth carrying into the schema as
it evolves:
- **Publication date vs. retrieved date** are different facts and must not collapse
  into one timestamp.
- **Pages vs. relevant pages** — a source can be large; what's actually cited is a
  subset.
- **Preservation is per-provider**, not a single boolean — a source can be backed by
  the original, Wayback, an alternate archive, and/or R2, independently.
- **Reliability** is a source-fact/researcher judgment about the source itself
  (primary/authoritative vs. secondary/discovery), distinct from any AI analysis of
  its content — fits the existing SOURCE FACT / COMPUTED FACT / AI ANALYSIS
  separation in `docs/CANON.md`.
- A human-readable **Source ID** (`CHR-NNNNNN`) and a parallel **Claim ID**
  (`CHR-CLAIM-NNN`) namespace exist so evidence and claims can cross-reference each
  other independent of any one investigation.
