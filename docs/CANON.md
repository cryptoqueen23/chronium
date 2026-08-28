# Chronium Mind Canon

## North Star

Chronium's goal is to become **the research engine for everyone** — students,
homeschoolers, journalists, lawyers, doctors, researchers, businesses, and
government.

Core workflow: **SEARCH → DISCOVER → VERIFY → COMPARE → CONNECT → ANALYZE →
CREATE → CITE.**

Chronium is **not just an archive or OSINT tool**. Copperas Cove is the
proving ground, not the product boundary. Architect the core as a **generic
Research Workspace** with pluggable data-source connectors, so specialized
areas (legal, medical, academic, legislative — see `docs/ROADMAP.md` Future
Verticals) can be added later without rebuilding the engine.

**Google helps people find pages. Chronium helps people conduct research.**

## Mission

Chronium Mind is a **research, data aggregation, and historical intelligence engine**.

Its job is to turn scattered websites, archives, PDFs, government records, datasets, and research into a **searchable, connected, reusable evidence base**.

**Core rule: NEVER LOSE THE RECEIPT.**

Every finding, comparison, timeline event, connection, or AI answer should trace back to evidence.

## Immediate Goal

Build **Mari's Research Workspace first**. Public Chronium comes later.

Research should compound. Once something is collected/indexed, it should be reusable across future investigations instead of researched again.

## Core Workflow

The data-pipeline view of the same North Star loop above — how one piece of
evidence actually flows through the system, not the user-facing research
loop (see `docs/RESEARCH_METHOD.md` for that level of detail):

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

### CANON RULE — Backup-to-the-Backup Reliability

Chronium treats archives as a **redundant source pool, not independent
buttons.** The researcher clicks one "View archived copy" button; Chronium
is responsible for it actually opening a working page.

For every historical result:

```text
Discover → Deduplicate → Validate → Rank → Open
```

If the preferred capture fails, keep trying known alternatives automatically
until a working copy is found:

```text
Wayback → alternate Wayback capture → Arquivo.pt → Memento/other archive
        → Common Crawl where usable → other preserved source
```

* Never knowingly send the researcher to a dead capture.
* Validate before presenting a result as usable — checking happens at
  click time (`/api/check-link`), not at render time for every row, but a
  button is never allowed to open an unvalidated URL.
* Keep multiple captures/providers behind one deduplicated result — a
  researcher never sees three near-identical rows for the same page.
* A provider outage must not break historical search. Failed providers
  degrade silently unless *all* sources fail.
* Cache successful (and short-lived negative) resolutions so Chronium never
  repeatedly re-tests the same link.
* Preserve which provider/capture ultimately supplied the evidence — that's
  the provenance that matters, not whichever capture was tried first.
* If absolutely no preserved copy works, say so plainly ("No accessible
  archived copy found") — **never fake availability.**

The UI shows the research result, not archive infrastructure: a provider
that succeeded with zero matches, or one that's temporarily down, is not a
result card — it's a line in "Source status," collapsed by default.

**Shipped:** `groupSamePage` (`src/index.js`) does discover→dedupe→rank
server-side, ordering each result's alternates by provider preference with
same-provider captures first; `/api/check-link` validates and caches
resolutions (Cache API, 10 min on success / 45s on failure); the
`.link-check` handler (`public/app.js`) walks the whole alternates chain at
click time, updates the row's provenance when a fallback wins, and only
shows "No accessible archived copy found" once every known capture has
actually been tried.

### CANON RULE — Never Confuse Absence of Evidence With Evidence of Absence

"No results" is never one thing, and Chronium must never collapse it into
one. A researcher acting on a false "nothing was ever archived here" can
miss the actual evidence. Every archive query result carries a **Coverage
Verdict** distinguishing exactly what happened:

* **`found`** — the provider answered and returned matches.
* **`provider-unavailable`** — the provider could not be reached (timeout,
  5xx, rate-limited, circuit open). Coverage is **unknown**. Never
  presented as "nothing archived" — only as "Chronium couldn't ask."
* **`no-captures-in-index`** — the provider answered successfully and this
  *exact query* matched nothing. This is a soft, query-scoped result, not
  a claim that the material was never archived anywhere.
* **`verified-gap`** — cross-checked against an independent signal (not
  just re-asking the same index the same way), and both agree nothing is
  archived. This is the *only* verdict that supports saying "no captures
  exist" with actual confidence.

A `no-captures-in-index` result can still directly contradict itself: if
an independent cross-check finds the domain *does* have other captures
(just not matching this query), that's flagged (`crossCheckFoundCaptures`)
and shown as a visible callout, not buried in collapsed "Source status" -
it's telling the researcher their exact query missed real history, which
is exactly the failure mode this rule exists to prevent.

**Shipped:** `searchWayback` (`src/index.js`) computes this verdict. When
its CDX query returns zero results, it cross-checks against the Wayback
Availability API (`archive.org/wayback/available`) - a separate index
surface, independent of CDX's own query/indexing quirks - before ever
calling something a gap. `ArchiveProvider.search()` gives every other
connector a sane default (`provider-unavailable` on failure,
`no-captures-in-index` on an empty success) so nothing falls through
unlabeled. The frontend (`renderCoverage`, `public/app.js`) renders each
verdict differently: a contradiction gets a visible warning callout, a
verified gap gets a quiet note, and "provider unavailable" is always
worded as unknown coverage, never as absence.

## AI

AI assists research. **AI is never the source of truth.**

Use deterministic code for search, hashing, math, dates, exact comparisons and deduplication.

Use AI only where reasoning/semantic analysis adds value.

### CANON RULE — AI/Agents Are Last Resort

Chronium must **never use AI or agents when normal software can do the job
reliably.**

Priority order, always tried in this sequence:

```text
Cache → deterministic code → database/index → search/connectors
      → rules/algorithms → AI → Agent
```

* AI is used only when reasoning/synthesis genuinely requires it.
* Agents are used only when multi-step reasoning/orchestration genuinely requires them.
* **Never** use AI for sorting, counting, filtering, deduping, hashing, citations, metadata, basic timelines, statistics, file organization, or any other deterministic work — this is the concrete rule behind Quantitative Analysis (`public/app.js`) being 100% client-side/free while only Qualitative Analysis calls an AI provider, and only on explicit user action.
* **Bootstrap rule:** use the cheapest reliable method.
* **Bottom-line rule:** every paid AI/agent call must create enough value to justify its marginal cost.

AI and agents are **replaceable accelerators — not dependencies of
Chronium's core research engine.** The core (search, evidence, claims,
reports) must work with zero AI calls; AI only ever adds interpretation on
top, never becomes required to use the product.

### Provider-agnostic AI router (shipped)

`src/ai/provider.js` defines the interface every adapter implements;
`src/ai/index.js` is the registry (`AI_PROVIDER` config var in
`wrangler.jsonc` picks the active one — a config change, not a code
change). Anthropic Claude (Haiku) is the first adapter (`src/ai/anthropic.js`)
— not a special case. Add OpenAI/Gemini/a local model the same way: a new
adapter file + one registry line. The credential is always a Cloudflare
secret (`wrangler secret put ANTHROPIC_API_KEY`), never committed, never
sent to the client.

## Internationalization

Chronium is **English-first, multilingual-native** — architect for it from
day one, don't implement all languages now.

Target the same 12 languages already used in HealthGap's i18n system, and
**reuse HealthGap's existing language/i18n architecture rather than building
a new one** — don't rebuild what already works elsewhere in the Phoenix
ecosystem.

This must extend beyond UI translation: search, indexing, metadata,
evidence, citations, and AI analysis all need to work across languages, not
just have a translated interface. Always **preserve the original source
text** while allowing cross-language search and analysis — a translation is
never a substitute for the source in the evidence chain (see Evidence Rules
above).

The concrete rule for every feature built between now and full multilingual
support: **don't make architectural assumptions that only work in English**
(e.g. hard-coding English-only tokenization, sort order, or date parsing
into the core rather than behind a locale-aware seam).

## Product Posture

Chronium is currently **founder-first/private**. Optimize for research capability, reliability, and low operating cost — not SaaS features.

Architect clean boundaries so authentication, multi-tenancy, usage metering, and a paid gateway can be added later **without rewriting the research engine**. Do not build those commercial layers until explicitly requested.

### Future monetization shape (design note, not built — no auth/payments/credits system exists yet)

When commercial layers do get built, the intended shape:

* Standard evidence-backed reports (Report tab, `docs/RESEARCH_METHOD.md`)
  are **deterministic and free by default** — generating, updating,
  exporting, or citing a report must never require an AI call.
* AI-generated/AI-enhanced output (narrative synthesis, deeper
  interpretation, rewriting) is the **paid feature** — free research stays
  genuinely useful on its own; AI sells acceleration and deeper analysis on
  top of it.
* AI report cost gets tied to the paying user and tracked per generation
  through the provider-agnostic AI router, using the cheapest capable model.
* **Never silently trigger a paid AI call.** Any AI-powered action must be
  clearly labeled ("Generate with AI") and show the user when it's about to
  use their AI allowance/credits — same spirit as Qualitative Analysis
  today requiring an explicit button click, just with real billing behind
  it once that exists.

#### Chronium Monetization (tiers)

| Tier | Revenue |
|---|---|
| **Free** | Core research, archives, local/BYOS storage |
| **Pro** | Advanced research tools — subscription |
| **AI** | AI analysis/reports — paid credits |
| **Vault** | Hosted storage — subscription |
| **Premium Data** | Legal, medical, academic, etc. — add-ons |
| **Ads/Services** | Contextual only — ads/referrals |
| **Research Trends** | Anonymous aggregate trends — B2B/API |
| **Enterprise/Gov** | Teams, private deployments, API — contracts |

**Economic rule:** Charge when Chronium incurs cost or creates professional
value. Keep core research useful for free.

**Four businesses:** Research + AI + Vault + Trends, with Enterprise on top.

**Flywheel:** More researchers → better aggregate intelligence → better
Chronium → more users → more paying customers.

> **The research belongs to the researcher. Chronium monetizes the service
> and aggregate interest — not the individual.**

#### Free/Freemium Rules

**Free must be a genuinely useful research product, not a demo.**

**Free includes:**

* Live + historical web search
* Public archive connectors
* Investigations/workspaces
* Local files, USB/external drive + BYOS
* Document indexing/search
* Duplicate detection/hashing
* Sources + provenance
* Evidence collection
* Claims
* Gaps
* Timelines
* Citations/bibliography
* Basic version comparison
* Deterministic quantitative analysis
* Deterministic evidence-backed reports
* Export of the user's own research

**Free excludes / paid:**

* AI-generated/enhanced reports
* AI qualitative analysis/synthesis
* Advanced AI contradiction interpretation
* AI drafting/research agents
* Chronium-hosted Vault storage beyond any small free allowance
* Premium/paid data connectors
* Heavy compute/high-volume usage
* Advanced professional automation
* Team/collaboration features
* Enterprise admin, SSO, private deployment
* Commercial/API access

**Monetization rule:** Never cripple basic research to force payment.
Charge for AI, Chronium-incurred costs, premium data, scale, convenience,
professional tools, teams, and enterprise capabilities.

Free should be good enough that someone can conduct and prove a real
investigation from beginning to end. Notably, everything in "Free includes"
above except deterministic quantitative analysis and deterministic reports
is **already built** (Sources/Evidence/Claims/Gaps/Timeline/Bibliography,
2026-08-28) — this list is a real, mostly-shipped baseline to hold the line
on, not just an aspiration.

## Cost Principle

**Make the expensive part valuable before making the valuable part expensive.**

Division of labor:

* public archives (Wayback, Common Crawl, Arquivo.pt, original publishers, public APIs) already do the crawling and storage — lean on them instead of re-crawling or mirroring
* the browser does local processing (unzip, hash, extract, index) where practical, so cost stays near zero regardless of production size
* Cloudflare is reserved for the owned intelligence layer — the parts only Chronium can provide, not general-purpose storage or compute

Chronium connects, indexes, verifies, and reasons. **It does not warehouse
what somebody else can reliably warehouse cheaper.** Storage follows the
data owner (see Storage Modes below); heavy compute follows the customer
creating the cost; public intelligence is computed once and reused whenever
legally and technically appropriate.

Design targets for heavy-user readiness (architect for these now,
Product Posture still applies — don't build the commercial layers until
asked, but don't paint the core into a corner that blocks them later):

* stateless, edge-first services wherever possible, so horizontal scaling is easy
* BYOS/local-first bulk storage, so a large user base never becomes Chronium's storage bill
* multi-provider connectors with health scoring, fallback, and circuit breakers (shipped for archive search 2026-08-28 — same pattern applies to future connectors: AI providers, storage providers, etc.)
* shared public-document fingerprints/indexes, so one document is never processed a million times over
* aggressive caching for archive searches, parsed documents, and common research
* queues for heavy jobs — a big analysis job must never block an interactive search
* AI cost routing: cache → deterministic processing → cheap model → premium model, in that order, always
* hard per-user cost accounting, so the actual cost of each customer is known
* usage limits/metering on anything with meaningful marginal cost
* no single archive, AI company, database, or cloud provider becomes existential to Chronium
* graceful degradation — one dependency dying never stops Chronium from researching
* observability from day one: latency, connector failure rate, compute/user, storage/user, AI cost/user, gross margin

**Track cost per successful investigation/search** as a real metric once
there's anything to measure — treat it close to a technical requirement, not
just a business afterthought.

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

### StorageProvider interface (design now, build when a real bytes-storage need shows up)

Chronium is the connector/intelligence layer, not the warehouse. When
evidence-byte storage is actually needed (today: nothing needs it — Local
Only + indexing covers everything shipped so far), build it
**provider-agnostic from the start** behind one interface, the same pattern
already used for `ArchiveProvider`:

```text
StorageProvider = Local Folder | USB / External Drive | User NAS
                 | BYOS (S3, R2, B2, user's own bucket) | Chronium Hosted Storage (paid)
```

The investigation system only ever gets a reference, a hash, metadata, and
read access through this interface — it never cares where the bytes
actually live. That's what lets a user choose "bring your own storage" vs.
"pay Chronium for convenience" without the rest of the app knowing the
difference.

Use R2 first if/when Chronium-hosted storage is actually built, but **never
hard-code R2** — go through the interface so swapping or adding a provider
later is a config change, not a rewrite. This mirrors the
config-swappable-provider pattern already used elsewhere. Document this
shape now; don't build it until a real feature needs evidence-byte storage
Chronium itself must own.

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

See `docs/ROADMAP.md` for the full phased build order (Phase 0–11) and
future verticals (Legislative Intelligence, etc.) — this section stays the
short executive-summary version; that document is where phase status
actually gets updated as work ships.

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
