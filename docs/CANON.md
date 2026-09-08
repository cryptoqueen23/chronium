# Chronium Mind Canon

## Product Principles (binding — supersedes the rest of this document on conflict)

Source: `principle.md` (repo root), given to this project as its product
constitution — "so it doesn't slowly turn back into a complicated
research dashboard or an expensive AI wrapper." These are constraints
every feature is tested against before being added, not a feature
wishlist. **If anything elsewhere in this file (or in `docs/ROADMAP.md`,
`docs/ARCHITECTURE.md`, `docs/RESEARCH_METHOD.md`) conflicts with a
principle below, the principle wins** — update the conflicting document
rather than the principle.

> **Mission:** Make serious research accessible to anyone. A student,
> homeschooler, journalist, lawyer, academic, investigator, policymaker,
> or ordinary person should be able to research a subject deeply without
> needing expensive research software, technical expertise, or paid AI
> services.
>
> ### 1. Conversation First
>
> Chronium should feel like a conversation, not database administration.
> The normal workflow is **Add Sources → Ask Sources → Follow the
> Evidence → Create What I Need**. A user should be able to ask things
> like "What do these documents tell me?", "Compare that with 2021?",
> "Why did it change?", "Where did you get that?", "What am I missing?",
> "Anything unusual?", "Make me an outline", "Create my bibliography",
> "Cite that", "Make a report." **Follow-up questions must understand
> the context of the conversation.**
>
> ### 2. Sources First. AI Second.
>
> The user is talking to sources through Chronium, not primarily talking
> to an AI. Search, retrieval, extraction, filtering, calculations,
> comparisons, dates, hashes, deduplication, timelines, and other
> deterministic operations happen first. Use AI only when semantic
> reasoning, interpretation, or synthesis materially improves the
> answer. If sources cannot answer a question, say so. **Never use AI
> to manufacture an answer because evidence is missing.**
>
> ### 3. Never Lose the Receipt
>
> Every meaningful factual answer must be traceable to evidence.
> Preserve **Source → exact Evidence Item → Finding/Claim → Output**. A
> user must always be able to ask "Show me where that came from" and
> reach the document, webpage, archive capture, page, passage, table,
> row, dataset, or other underlying evidence.
>
> ### 4. Research Once. Reuse Everywhere.
>
> Research should compound. Once Chronium has discovered and verified
> information, that research can feed answers, outlines, bibliographies,
> citations, timelines, tables, evidence matrices, quantitative
> analysis, qualitative analysis, presentations, reports, and future
> investigations. Do not independently redo the research every time the
> user requests another output.
>
> ### 5. Free by Default
>
> A person should be able to conduct meaningful research without paying
> Chronium for AI calls, storage, or expensive infrastructure. Core
> research must not depend on a paid LLM. Paid AI and premium services
> can exist later as optional accelerators, never requirements for the
> fundamental research workflow.
>
> ### 6. Chronium Stores the Map, Not the Ocean
>
> Follow the bootstrap rule: reference before replicate, index before
> store, cache before preserve, compute locally when practical, use
> public/free infrastructure before building infrastructure. Original
> public material should normally remain with its existing host/archive.
> User files remain local by default. Chronium owns the intelligence
> layer: provenance, metadata, indexes, relationships, hashes, research
> state, evidence structure, findings, and outputs. Cloud storage is
> selective and optional.
>
> ### 7. Let Other Platforms Do Expensive Work
>
> Do not rebuild services that already exist merely so Chronium can say
> it has them. When practical, allow users to take Chronium research
> into external tools for optional capabilities such as audio, video,
> presentation, visualization, or specialized analysis. Prefer
> user-owned/free external workflows over Chronium paying for
> third-party generation. Later, paid integrated services may be offered
> as conveniences, but they must not replace the free research path.
>
> ### 8. One Research Engine, Any Subject
>
> Never hard-code Chronium around Copperas Cove, government records,
> FOIA/PIR, or any single research field. Those are test cases. The same
> engine must support history, government, law, finance, science,
> education, companies, people, medicine, technology, journalism, public
> policy, academic research, and other legitimate research subjects.
>
> ### 9. Old Internet + Current Internet + User Sources
>
> Chronium should research across the available evidence universe: user
> files + saved library + current web + historical web + public records
> + datasets/APIs + archives + other legitimate sources. Historical
> material is a core Chronium capability, but Chronium itself is broader
> than a historical search engine.
>
> ### 10. Quantitative + Qualitative + Mixed Methods
>
> Chronium must treat all three as first-class research methods.
> Quantitative: what do the numbers show? Qualitative: what do the
> records say? Mixed method: do what they say and what the numbers show
> agree? Calculations must preserve inputs and methodology. Qualitative
> analysis must preserve supporting passages. Disagreement between
> evidence becomes a review item, not an accusation or automatic
> conclusion.
>
> ### 11. Separate Fact From Interpretation
>
> Chronium must distinguish **Source Fact** (directly supported by
> evidence), **Computed Fact** (mechanically derived from evidence),
> **AI Analysis** (model-assisted interpretation), **Investigative
> Lead** (something worth researching further), and **Unresolved**
> (evidence is insufficient or conflicting). Never silently turn one
> category into another.
>
> ### 12. Missing Evidence Is Information, Not Proof
>
> Chronium should identify gaps — e.g. "Referenced attachment not
> located," "FY2022 record not present between FY2021 and FY2023,"
> "Available records do not establish where this amount was ultimately
> spent." But absence of a record is not automatically evidence of
> concealment, wrongdoing, or withholding.
>
> ### 13. Chronium Does the Research Paperwork
>
> The researcher should not have to manually operate Source → Evidence →
> Claim during ordinary use. Chronium should build the bibliography,
> evidence ledger, research outline, findings, gaps, citations, and
> report state behind the conversation. Those structures remain
> inspectable and editable for serious researchers.
>
> ### 14. Create What I Need
>
> There is no single "final output." From the same investigation, a user
> can request: Outline, Bibliography, APA/MLA/Chicago citations,
> Footnotes, Timeline, Table, Evidence Matrix, Findings Summary, Source
> List, Research Gaps, Report. Outputs must remain connected to the
> evidence that produced them.
>
> ### 15. Research Should Lead to More Research
>
> Chronium should help answer "What should I investigate next?" It may
> identify missing periods, conflicting amounts, referenced-but-unlocated
> records, unexplained changes, weakly supported claims, unexplored
> outline sections, or additional sources worth searching. These are
> research suggestions, not conclusions.
>
> ### 16. Simple Enough for a Kid, Trustworthy Enough for a Lawyer
>
> This is the UX standard. A new user should not need a manual. The
> front door should essentially be "What are you researching?", then
> "Add your sources," then "Ask your sources." Advanced methodology,
> provenance, evidence management, and analytical controls remain
> available underneath for people who need them. **Complexity belongs in
> Chronium, not on the user's screen.**
>
> ### 17. Never Fake Coverage
>
> Chronium must tell the truth about what it searched. Provider
> unavailable is different from no results. Not searched is different
> from nothing found. A thin corpus is different from a comprehensive
> investigation. Never imply exhaustive research when coverage does not
> support that conclusion.
>
> ### 18. Reliability Through Redundancy
>
> Important evidence should not depend unnecessarily on one provider.
> Prefer Original Source → Archive/Alternate Source → Additional Backup
> → Selective Preservation when warranted. Preserve provenance through
> every fallback. Never silently substitute one source for another.
>
> ### 19. AI Must Reduce Reading, Not Verification
>
> AI can read and synthesize large amounts of evidence so the researcher
> doesn't have to. But checking the answer must become easier, not
> harder. AI outputs must point back to the evidence used. Do not send
> an entire enormous investigation to an LLM by default. Retrieve
> relevant evidence first and analyze the smallest sufficient evidence
> set. This protects accuracy, privacy, speed, and cost.
>
> ### 20. The Copperas Cove Test
>
> Use the real Copperas Cove research as a primary stress test. Chronium
> should be capable of taking the existing files, public records,
> budgets, spreadsheets, webpages, archived material and other available
> sources and allowing the researcher to investigate them
> conversationally. The benchmark is simple: if it is substantially
> easier to leave Chronium and conduct the investigation manually or in
> a general chatbot, the Chronium workflow still needs work. Do not
> solve that by adding more buttons. Fix the research experience.
>
> ### 21. Adaptive Research Depth
>
> Chronium adapts its responses to the user's requested depth, not the
> user's identity. Same verified evidence, multiple views: quick answer,
> explain, research, professional. Users can ask naturally — "explain
> like I'm 12," "give me the executive summary," "show every source,"
> "generate a report." Evidence and provenance remain constant. Only the
> presentation changes.
>
> ### 22. Leverage Before Build
>
> Chronium should connect first and build last. If another legitimate
> service already provides infrastructure or capability better or
> cheaper, Chronium should use that service through a connector rather
> than recreate it and bear the infrastructure cost. Default order:
> **free/public infrastructure → user-owned service/account → external
> connector → Chronium-built infrastructure only when necessary.**
> Examples: historical web (Wayback/Common Crawl/Arquivo.pt, not storing
> the historical internet ourselves), storage (local or user-owned
> cloud, not Chronium storing everything), video/audio/podcasts (connect
> to services such as NotebookLM or other compatible providers rather
> than building our own generation infrastructure), public data (query
> authoritative APIs/datasets rather than copying entire databases),
> media (reference/retrieve from the original host rather than
> duplicating large files), AI (use only when needed; prefer
> user-provided/free access where legitimately available rather than
> making paid AI a core Chronium expense).
>
> **UX rule:** the connector should be invisible whenever technically
> and legally possible — the user stays inside Chronium while the
> external service performs the work in the background.
>
> **Architecture rule:** build provider-neutral connectors so providers
> can be swapped without rebuilding Chronium.
>
> **Cost rule:** do not make Chronium pay for commodity storage,
> compute, AI, media generation, or datasets when a legitimate free,
> public, or user-owned alternative can perform the job.
>
> **Exception:** Chronium should build and pay for what makes Chronium
> unique — the research orchestration, evidence relationships,
> provenance, research state, verification, and intelligence layer.
>
> **Short rule: Connect first. Build last. Chronium owns the
> intelligence, not the infrastructure.**
>
> **CHRONIUM IN ONE LINE:** Add your sources. Ask your sources. Follow
> the evidence. Create what you need.
>
> **PRODUCT PROMISE:** Research Everything. Lose Nothing.
>
> **ARCHITECTURAL RULE:** Chronium stores the map, not the ocean.
>
> **EVIDENCE RULE:** Never lose the receipt.
>
> **AI RULE:** Sources first. AI when useful. Never AI as evidence.
>
> **ACCESS RULE:** Serious research should remain possible without
> paying for AI or massive cloud storage.

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

Keep these separate (Product Principles #11 above extends this to five
categories — this section stays in sync with that, not a separate list):

1. **Source Fact** — directly in evidence
2. **Computed Fact** — mechanically calculated
3. **AI Analysis** — interpretation
4. **Investigative Lead** — something worth researching further, not a finding
5. **Unresolved** — evidence is insufficient or conflicting

Never present inference as fact. Never silently turn one category into
another.

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
above is **already built** (Sources/Evidence/Claims/Gaps/Timeline/
Bibliography/deterministic Quantitative & Qualitative Findings/deterministic
evidence-backed Reports, 2026-08-29) — this list is a real, mostly-shipped
baseline to hold the line on, not just an aspiration.

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
