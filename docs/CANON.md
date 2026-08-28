# Chronium Mind Canon

## Mission

Chronium Mind is a **research, data aggregation, and historical intelligence engine**.

Its job is to turn scattered websites, archives, PDFs, government records, datasets, and research into a **searchable, connected, reusable evidence base**.

**Core rule: NEVER LOSE THE RECEIPT.**

Every finding, comparison, timeline event, connection, or AI answer should trace back to evidence.

## Immediate Goal

Build **Mari's Research Workspace first**. Public Chronium comes later.

Research should compound. Once something is collected/indexed, it should be reusable across future investigations instead of researched again.

## Core Workflow

```text
SOURCE
→ CAPTURE
→ EXTRACT
→ INDEX
→ SEARCH
→ CONNECT
→ COMPARE
→ TIMELINE
→ EVIDENCE
```

Users should be able to:

* create investigations
* add URLs, PDFs, files and datasets
* search everything
* preserve original + archived sources
* compare versions / Then vs Now
* extract people, organizations, projects, dates and money
* find related records
* build evidence-backed timelines
* reuse records across investigations

## Evidence Rules

Keep these separate:

1. **Source Fact** — directly in evidence
2. **Computed Fact** — mechanically calculated
3. **AI Analysis** — interpretation

Never present inference as fact.

Connections are leads, not accusations.

Preserve original source, archive URL, dates, capture/version information and provenance whenever available.

## Architecture

Chronium must be **generic**.

Copperas Cove is the first real corpus and stress test, NOT the product.

Use source adapters:

```text
WaybackAdapter
PDFAdapter
GovernmentSiteAdapter
CSVAdapter
LocalFileAdapter
etc.
```

Source-specific logic stays outside the core.

Separate:

* source/evidence storage
* investigations
* search/index
* presentation
* AI analysis

One source may belong to multiple investigations without duplicating it.

## Time

Time is first-class.

Chronium should answer:

* What exists?
* What existed?
* When did it change?
* What disappeared?
* What came before/after?

Multiple archive captures do NOT automatically equal multiple content versions. Hash/deduplicate where practical.

## Search

Search must work without AI and cover extracted text + metadata.

Eventually support filters for date, organization, investigation, category, document type, entity, current/archive and version.

## AI

AI assists research. **AI is never the source of truth.**

Use deterministic code for search, hashing, math, dates, exact comparisons and deduplication.

Use AI only where reasoning/semantic analysis adds value.

## Product Posture

Chronium is currently **founder-first/private**. Optimize for research capability, reliability, and low operating cost — not SaaS features.

Architect clean boundaries so authentication, multi-tenancy, usage metering, and a paid gateway can be added later **without rewriting the research engine**. Do not build those commercial layers until explicitly requested.

## Cost Principle

**Make the expensive part valuable before making the valuable part expensive.**

Division of labor:

* public archives (Wayback, Common Crawl, Arquivo.pt, original publishers, public APIs) already do the crawling and storage — lean on them instead of re-crawling or mirroring
* the browser does local processing (unzip, hash, extract, index) where practical, so cost stays near zero regardless of production size
* Cloudflare is reserved for the owned intelligence layer — the parts only Chronium can provide, not general-purpose storage or compute

## Storage Modes

**Reference before replicate. Index before store. Cache before preserve. Preserve
only when Chronium has a reason to own the bytes.**

**User-owned files are local-first and must not be uploaded to Chronium storage by
default.** Separate Evidence Metadata/Index (hash, extracted text, provenance —
always kept, always small) from Evidence Bytes (the original file — kept only
when explicitly asked). Chronium locally hashes, extracts, indexes, and analyzes
user files while leaving originals on the user's device whenever practical.

Three eventual storage modes for evidence bytes:

- **Local Only (default)** — Chronium indexes; the original stays wherever the
  user already had it. No copy enters Chronium storage unless the user opts in.
- **Bring Your Own Storage** — the user's own cloud (their S3/Drive/etc).
- **Chronium Cloud Storage (paid)** — Chronium hosts the bytes (R2).

Public evidence already reliably hosted elsewhere (Wayback, Arquivo.pt, Common
Crawl, the original publisher) should normally be **referenced/indexed, not
duplicated** — already true of the `ArchiveProvider` connectors, which never copy
archive content. Any cloud-preserved public evidence must be content-hash
deduplicated (the `ArchiveProvider.preserve()` seam is already hash-addressable
in spirit).

**Do not architect IndexedDB as the permanent storage location for arbitrarily
large source collections.** It's fine as a small local cache/fallback for bytes a
user explicitly asks Chronium to keep, never as the assumed home for a bulk
production's original files.

## Stack

Bootstrap and low maintenance:

* local-first where practical
* static/PWA
* IndexedDB/SQLite where appropriate
* Vercel
* Cloudflare free tier when backend is needed
* free/public APIs first
* avoid paid infrastructure until justified

Do not overengineer.

## Build Priority

**P0:** Research library, investigations, universal search, provenance
**P1:** bulk investigation ingestion (incl. PDF extraction), entities, related records, Then vs Now, timelines, research outline, research bibliography
**P2:** evidence-grounded AI assistant, automated final reports, publishing investigations
**P3:** broader federated/public search

Research Outline and Research Bibliography (see `docs/RESEARCH_METHOD.md`) come
**before** automated final reports — a report is only as good as the outline that
scoped the research and the bibliography that backs it.

## Development Rules

* inspect existing code first
* preserve working features
* no giant rewrite
* generic core, source adapters
* data separate from UI
* responsive + WCAG 2.2 AA
* avoid unnecessary dependencies
* never alter original evidence
* never silently discard historical versions

Before adding paid infrastructure or major dependencies, justify the need, cost, lock-in and simpler alternatives.

## Final Test

Before building a feature ask:

**Does this help find, connect, compare, verify, or reuse research faster?**

If not, don't build it yet.
