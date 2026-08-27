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
**P1:** PDF extraction, entities, related records, Then vs Now, timelines
**P2:** evidence-grounded AI assistant, publishing investigations
**P3:** broader federated/public search

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
