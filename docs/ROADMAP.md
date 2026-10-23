# Chronium Roadmap

Companion to `docs/CANON.md` (mission, evidence rules, storage/cost principles)
and `docs/RESEARCH_METHOD.md` (the investigation-level research loop). This is
the phased build order — directional beyond Phase 1, not committed dates.
Update the phase status here as work actually ships; don't let this drift
into an aspirational document nobody re-reads.

Phase 0 and most of Phase 1 are the P0 from `docs/CANON.md`'s Build
Priority; everything from Phase 2 on is P1/P2/P3 territory or beyond it.
Nothing past Phase 1 gets built until it's explicitly requested — this
document exists to keep the *shape* of where Chronium is headed visible
while work stays scoped to what's actually asked for.

## Phase status

| Phase | Priority | Build | Status |
|---|---|---|---|
| **0. Reliability** | 🟢 DONE | Multi-archive fallback, validate captures before showing/opening them, eliminate 404/dead results, caching, per-connector health tracking | **Shipped 2026-08-28**, extended same day — retry-with-jitter, circuit breaker, `/api/health/connectors`, brief success-only cache, cross-archive dedup, `/api/check-link` validation with auto-fallback to an alternate archive (CANON "Backup-to-the-Backup Reliability"), an in-app **Archive Viewer** so a capture renders instead of navigating to a URL that might force a download, and a **Coverage Verdict** on every connector result distinguishing provider failure from a verified historical gap (CANON "Never Confuse Absence of Evidence With Evidence of Absence"). See `docs/CLAUDE_HANDOFF.md` for specifics and known gaps. |
| **1. Investigation Workspace** | 🟢 DONE (P0) | Fast investigation search, Sources, Evidence, Claims, Timeline, Gaps, Research Outline, Bibliography, Quantitative/Qualitative Findings, mixed-method cross-validation | **P0 shipped 2026-08-28, extended 2026-08-29** — the full SEARCH → FIND RECEIPT → SAVE EVIDENCE → FINDING → REPORT loop works end-to-end, verified live: search returns the actual matched passage + PDF page number, "Save as Evidence" auto-carries excerpt/location/provenance, Claims link evidence, a deterministic Evidence-Backed Report generates from the full structured research state (Question → Method → Outline → Sources/Bibliography → Evidence → Findings → Gaps/Contradictions/Review items → Claims). AI Qualitative Analysis shipped too (Anthropic Claude Haiku, provider-agnostic router, opt-in/paid per CANON.md AI section) alongside always-free deterministic Quantitative Analysis, and separately from it, researcher-asserted Quantitative/Qualitative Findings that preserve formula/method/inputs or methodology/supporting passages, plus a mixed-method cross-validation judgment (consistent/discrepancy/unclear) whose discrepancies surface as review items, never conclusions. The 9-tab workspace was simplified to 4 (Research / Evidence / Findings / Report) on 2026-08-28; on 2026-08-29 the Research Outline (dynamic, per-section method/status/coverage) moved into Research and the detailed Bibliography (full Target Source Record Shape, `docs/RESEARCH_METHOD.md`) moved under Evidence as a sub-toggle — see `docs/CLAUDE_HANDOFF.md`. Outstanding within this phase: Contradiction detection is currently AI-only (Qualitative Analysis' `contradictions` field) — a deterministic version (two Claims that can't both be true) is Phase 4 below. **The Claim model itself was substantially extended 2026-09-08** (status enum, subject-entity tagging, three-stance evidence links via a proper `claimEvidence` join table, a `claimHistory` audit trail) — see Phase 4/9/10 below and `docs/INVESTIGATION_WORKSPACE_PLAN.md` Phase 3. |
| **2. Evidence Vault** | 🔥 | Save a webpage/document excerpt + URL + date + page + timestamp + SHA-256 hash | Not started. |
| **3. Compare Engine** | 🔥 | Compare archived versions, documents, and budgets. "Changes Only" view | Not started. This is the "Then vs Now" P1 item from CANON.md's Build Priority. |
| **4. Contradiction Detector** | 🔥 | Automatically flag conflicting numbers, dates, statements, votes, and document versions | **Manual foundation shipped 2026-09-08** (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 3) — a Claim can carry multiple evidence links with an explicit supports/contradicts/contextualizes stance each, all shown together, never collapsed into one verdict; conflicting evidence is preserved, never deleted when a claim resolves. **Automatic detection is still not built and explicitly out of scope for now** — stance stays investigator-asserted, per that phase's own brief ruling out "AI-generated accusations." A future automatic detector would sit on top of this same claimEvidence data. |
| **5. Research Agent** | ⭐ | Ask "Where did the road money go?" — Chronium searches the investigation + archives and answers with evidence | **Shipped 2026-09-08, live-verified in a real browser.** Ask Sources: a conversational entry point over My Sources + Discover Sources (`public/discover.js`, provider-neutral over `/api/search`), deterministic-first (no AI in the search/artifact/mutation paths), five fact states (Confirmed/Computed/Lead/Unresolved/AI Analysis) on every answer, one-turn follow-up context, Adaptive Research Depth (quick/explain/research/professional re-presenting the same evidence, no re-search), APA/MLA/Chicago/Turabian/legal citations + footnotes, and a Create menu producing Source Index/Evidence Table/Claim Matrix/Quantitative Table/Citations inline. AI enters only via an explicit "Analyze with AI" button over already-found passages (`/api/analyze/ask-sources`), confirmed reachable via `curl`, not yet re-driven through the browser this session (low risk — same request path as the already-verified Qualitative Analysis). See `docs/CLAUDE_HANDOFF.md` for the full verification log. |
| **6. Relationship Graph** | ⭐ | Person ↔ company ↔ contract ↔ payment ↔ agenda ↔ vote ↔ property ↔ document | **Phase 1+2 shipped 2026-09-08, live-verified.** Phase 1: a **Subjects** workspace tab with PERSON/ORGANIZATION/GOVERNMENT_BODY/etc. entities, evidence-backed relationships (confidence CONFIRMED/PROBABLE/POSSIBLE/DISPUTED/REFUTED/UNKNOWN, default UNKNOWN, never auto-inferred), and aliases that never auto-merge. Phase 2 adds **Entity Mentions** — "this evidence item uses the exact string X to refer to entity Y," recorded via a "Link Subject" button on the Evidence tab and shown on both the Evidence card (Linked Subjects) and the Subject profile (Evidence Mentions), always distinct from a Relationship: mentioning two entities in the same evidence item, or an entity having an alias, never auto-creates a relationship between anyone — verified with a dedicated co-occurrence regression test. Both phases share one hard rule, enforced at the `public/db.js` data-layer boundary, not just the UI: a Relationship needs ≥1 real evidence item, a Mention needs a real entity + a real evidence item + non-empty exact-quoted text — all verified by calling the write functions directly with fabricated/missing/empty data and confirming rejection. The Marc Payne/Raymond Payne identity-collision regression (the project's namesake test) passes at both phases: search finds both people, no merge, no relationship transfer, and now also no mention cross-contamination between their evidence. Two pre-existing bugs found and fixed in Phase 1 (a `confirmDialog()` resolve-ordering bug that made every confirm-gated delete in the app silently no-op, including "Delete investigation") — see `docs/INVESTIGATION_WORKSPACE_PLAN.md`'s "Phase 1: as-built" and "Phase 2: as-built" sections for full verification logs and one still-open, explicitly out-of-scope bug (`#workspaceKebabBtn` has no click handler). **Bulk-at-scale entity mentions shipped 2026-09-08 as Phase 4 of the plan doc** — see the Bulk Ingestion row below; it feeds Entity Mentions/Relationships through the exact same Phase 1/2 APIs, just gated behind investigator confirmation instead of one-at-a-time manual entry. Not yet built: timeline events, identity-resolution scoring, source tiers, network view — Phases 3-5 of the same plan doc. |
| **6a. Bulk Ingestion + Review Queue** | ⭐ | Process hundreds/thousands of documents without forcing one-at-a-time manual review; surface candidate subjects/keywords for investigator confirmation, never auto-decide | **Shipped 2026-09-08, live-verified (49/49 Puppeteer assertions across two driver runs, 77/77 unit tests, zero unexpected console errors).** An Ingestion Job/Item model (extends the pre-existing `ingestionBatches` store, same precedent as Phase 3 extending `claims`) tracks bulk imports through PENDING→READY_FOR_REVIEW→REVIEWED/FAILED/SKIPPED without holding thousands of records in memory. A new **Review Queue** workspace tab is assistive-only: bulk subject-candidate detection (`public/ingestionReview.js`, pure logic, no DOM/IndexedDB) surfaces possible entity matches from existing names/aliases — strong (full name/alias) vs. weak (bare surname, PERSON-only) — and forces AMBIGUOUS state with every possibility rendered as its own button whenever a bare surname matches 2+ registered people (the Marc/Raymond Payne regression, extended into bulk detection and re-verified live). Confirming a candidate chains through the existing unmodified `createEvidenceItem`/`createEntityMention` APIs — every Phase 1/2 integrity rule still applies. A co-occurrence regression (two people, one document) confirms zero auto-created relationships. An investigator-defined watchlist/keyword system records matches (matched text/snippet/location) without ever auto-converting a hit into a Finding. SHA-256 dedupe is unchanged; duplicate occurrences now preserve provenance (`duplicateOccurrencePath`) instead of being silently discarded. A 1,000-record scale test (8,955ms ingest, ~9ms/record; queue renders in 1,242ms; paginated, not all rendered at once) caught and fixed two real bugs: search only checked already-paginated items, and a search-input race condition where an earlier broad scan could overwrite a later narrow one on screen (debounce + staleness guard, same bug class as an earlier phase's Subjects search box). Failure recovery verified: one unreadable file no longer aborts the whole batch (`COMPLETED_WITH_ERRORS`, not `FAILED`) — a real latent bug fixed, not just a new feature. Lightweight non-authenticating investigator identity (`investigatorId`/`displayName`) and a simple `reviewHistory` audit log round out the model. See `docs/INVESTIGATION_WORKSPACE_PLAN.md` "Phase 4: as-built" for full schema, verification log, and deferred items (explicitly no automatic accusation/relationship/claim-confirmation/contradiction-resolution/identity-merging generation — assistive detection only, human confirmation always required). |
| **7. Cross-Investigation Intelligence** | ⭐ | "This company/person/address also appears in 4 other investigations." | Not started. Depends on Phase 6. |
| **8. Source Intelligence** | ⭐ | Primary / Government / Archived / Secondary / Unverified classification + confidence/provenance | Partially present — Bibliography (Phase 1) already captures Publisher/Source Type/Reliability as researcher-asserted fields. This phase is about surfacing it more systematically (filtering, weighting) across the workspace. |
| **9. Analysis & Gaps** | 🧠 | What evidence supports the theory? What contradicts it? What's missing? What should I request next? | Gaps (basic version: lanes with no/low linked evidence) shipped in Phase 1. **The Findings ledger (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 3, shipped 2026-09-08) answers "what supports/contradicts it" deterministically** — a Finding is the investigator's evidence-backed conclusion about a Claim, classified DOCUMENTED_FACT/SUPPORTED_INFERENCE/ALLEGATION/UNRESOLVED_QUESTION/NO_EVIDENCE_LOCATED, with the first three requiring real cited evidence, enforced at the data layer. The AI-reasoning layer described here is still the fuller (automated) version, gated on the same AI decision as Phase 1 Analysis. |
| **10. Report Builder** | 🧠 | Turn an investigation into a sourced report, timeline, evidence packet, or story | Basic version (claims → evidence-backed report) shipped in Phase 1; **a Findings section shipped 2026-09-08** (Phase 3 of the plan doc), distinct from Claims, always guaranteed evidence-backed for its three asserting classifications. This phase is still open for richer output formats/formatting, not a new data model. |
| **11. Advanced Chronium** | 🚀 | OCR, entity extraction, document change tracking, alerts, collaboration, APIs | Not started. |

## Future verticals (design for, don't build yet)

These extend Chronium into specialized research domains without requiring a
rebuild of the core engine — see "Architecture: generic core" in
`docs/CANON.md`. Keep them as design constraints on the core (don't make
assumptions that would block them later), not active work.

### Legislative Intelligence

Chronium should eventually support Congress, state legislatures, legislative
staff, attorneys, and policy researchers.

Workflow: **search old bills/laws → compare versions → trace
amendments/actions/votes → find related legislation → analyze what changed →
draft new legislative language → cite every source.**

Start with official sources — the Congress.gov API already exposes bills,
text versions, amendments, actions, committees, related bills, and
summaries. Any AI-generated legislative language must always be
**source-grounded and traceable**, never invented or presented as existing
law — same evidence discipline as the rest of Chronium (`docs/CANON.md`
Evidence Rules: Source Fact / Computed Fact / AI Analysis stay separate).

This plugs into the same Search → Evidence → Compare → Claims → Timeline →
Report system as everything else, once built — it's a new connector +
domain vocabulary, not a parallel product.

## North Star

See `docs/CANON.md` Mission for the full statement. Short version: Chronium
is not just an archive or OSINT tool — Copperas Cove is the proving ground,
not the product boundary. The generic Research Workspace (Search → Discover
→ Verify → Compare → Connect → Analyze → Create → Cite) is the actual
product; specialized verticals like Legislative Intelligence, legal,
medical, and academic research plug into it as connectors and domain
vocabulary layered on the same core, not separate rebuilds.

## Unified Research Extension (captured 2026-10-22, brief from Mari)

Goal: a free, beginner-friendly Chromium Manifest V3 **side-panel extension**
over the existing Worker, IndexedDB workspace and archive connectors (nothing
replaced). One search box; query is classified and connectors chosen
automatically. Primary nav: **Search, Compare, My Research, Reports**.
Advanced controls hidden until requested.

User-facing vocabulary: Investigation Workspace → My Cases · Ask Sources →
Ask Chronium · Discover Sources → Find Sources · Claim Ledger → Check Facts ·
Entity Mentions → Name Matches · Coverage Verdict → Search Status · Bulk
Ingestion → Add Files · Evidence Inspector → Source Details · Compare Mode →
What Changed? · Review Queue → Needs Review. Logic underneath is unchanged.

Build order:
1. Fix Ask Sources zero-result matching and bare-surname identity risk. (done 2026-10-22, see below)
2. Side-panel interface (Search / History / My Cases; advanced inside details).
3. Free connectors: OpenAlex, Crossref, GDELT, Data.gov, Congress.gov, state bills, city budgets/financial records, Internet Archive Advanced Search + Metadata API, Open Library, Google Books, Gutendex, Wikisource.
4. Comparison tools (documents, financial years, bill versions, webpage captures), media discovery, full-text indexing (OCR where practical), evidence exports.
5. Acceptance tests, validate extension against the Worker, push to GitHub.

Literary/historical research (same panel, same engine): author recognition
(e.g. "T. S. Eliot"), Find All Editions (group scans under one work), Find
Where It's Quoted (full-text search of accessible collections), Compare
Editions (OCR-tolerant), Trace References (who cites a work). Each hit
records book, author, year, page/location, link, and whether it is a direct
quotation, paraphrase, citation or mere mention; **OCR match is labelled
distinct from visually verified**. "All books found" always means "indexed
by the sources Chronium successfully checked", never every book published.

Non-negotiables: free (no mandatory paid API), source-first, every finding
shows origin / what was verified / what is uncertain, connector failures and
incomplete searches are shown not hidden, original URL + title + date +
retrieval time + hash + page + archive link preserved, respect copyright,
site terms and rate limits, identity matches require human confirmation.

### Mission: find the records before requesting them (captured 2026-10-22)

Chronium reduces dependence on public-information requests by searching,
retrieving, preserving and analyzing what is already public. Example query:
"Copperas Cove expenditures 2020-2026" fans out to government sites, archived
sites, budgets/ledgers, contracts/laws, state+federal records, documents+media.

**Deep Discovery** (bounded crawler, rate-limited, robots/terms-respecting,
full provenance): search a city site and its public document repositories
(old agendas, attachments, minutes, financial reports); follow public PDF
links and extract tables, transactions, names, dates, amounts; find copies
on other government/library/archive hosts; fall back to Internet Archive
captures; compare figures across budgets, audits, contracts.

**Records Recovery** has three outcomes: **Found** (working link, saved copy
where permitted) / **Historical copy found** (archived version, capture date
recorded) / **Not located** (where searched, unavailable-source vs verified
gap distinguished, narrowly targeted Texas Public Information Act request
generated). Users can upload records received later so they are searchable
with everything else. **Request check:** enter a public information request
and compare it to discovered documents: available / partially available /
still missing. Unpublished, private or access-restricted records are never
bypassed.

Revised priorities: 1-2 fixes (done) -> 3 side panel -> 4 Deep Discovery
crawler -> 5 gov/financial/nonprofit/legislative/historical connectors ->
6 Records Recovery + request generation. Also in scope for connectors:
corporations, nonprofits/tax-exempt entities, public filings. Chronium never
claims to have searched the whole internet: it reports sources searched,
unavailable, and coverage gaps. Core search/evidence/compare/report work
without any paid API or AI.

### Three-level investigation views (captured 2026-10-22, build AFTER case portability)

Three views of the SAME investigation data (no separate stores/processes); main nav stays Search / Compare / My Research / Reports; moving between levels keeps your place; clicking a finding in High View opens its supporting records in Deep View.
- **High View (big picture):** concise source-grounded summary: subject, major findings, important figures, coverage status, unresolved questions.
- **Overview (how it connects):** timelines, financial flows, government decisions, organizations, related documents, discrepancies, progress. Every relationship is evidence-backed or explicitly marked unverified.
- **Deep View (examine evidence):** original documents, exact passages, page numbers, financial calculations, archived versions, document hashes, conflicting records, provenance.
Rules: never state a conclusion without accessible supporting evidence; distinguish MISSING information from NOT YET REVIEWED. Reuse existing evidence/claims infrastructure; implement incrementally.

**Case portability (2026-10-22): built.** `.chronium.json` (versioned, format `chronium-investigation` v1) exports/imports between the website and the extension; preview-first, merge-only (never overwrites; same-id rows kept local, differing ones reported as conflicts), sources deduped by canonical URL, clashing source/claim numbers renumbered. Optional embedded file copies. No cloud, no accounts. Not built: optional encrypted sync. Website changes need a deploy to reach the live site.

**Ask Chronium (2026-10-22): built** (`public/askRouter.js`, `askRender.js`; website Research tab + extension My Research). See `docs/ASK_CHRONIUM.md` for scope, safeguards, benchmark, limitations. Next: three-level views (Big Picture / Overview / Deep Dive), then free connectors in the order given.

## Bootstrap Rule (added 2026-10-22; text in `docs/CANON.md`)

Build lean, stay independent, keep free access within reasonable limits, let paying customers fund expansion. Practical effect on the roadmap:
- Every connector/operation gets a row in `docs/COST_DRIVERS.md` when built (class, who pays, ceiling, mitigation, which tier the heavy form belongs to).
- Browser-local first; cache and rate-limit anything that touches the Worker or a third party; degrade gracefully.
- Billing, paywalls and mandatory accounts are NOT built; premium entitlements stay a seam (named capabilities with cost classes) so plans can be added later without touching the research engine.
- Export/import (`.chronium.json`) is always free and complete: the portability guarantee.
- Connector order (municipal, EMMA, Texas, federal, nonprofit, books) each start with a terms-of-use + rate-limit check and a cost entry before any code.
- Candidate premium tiers (heavy crawling, large-scale analysis, cloud storage, monitoring, server OCR) are listed in COST_DRIVERS.md; nothing is gated today.

**Investigation views (2026-10-22): built, not pushed/deployed.** Big Picture / Overview / Deep Dive plus a "How do we know?" action on every key statement; one model, no new storage. See `docs/INVESTIGATION_VIEWS.md`.

### Open follow-up work (kept on purpose; none of these are done)
1. Improve the benchmark harness to tell correct abstentions ("no evidence located", verified against the corpus) from retrieval failures. Official result stays: 7 WORKS, 2 PARTIAL, 3 DOES NOT WORK; the hand-graded 10 correct / 2 partial is supporting evidence, not a replacement.
2. Expand financial extraction beyond dollar-sign amounts (amounts without `$`, tables split across lines, scanned documents).
3. Improve structured vote identification (unusual wording, outcome and tally parsing).
4. Evidence-based contradiction analysis (finding conflicting passages without them being hand-linked).
5. Real historical document comparison in the Compare tab (still a placeholder).
6. Spanish-language question understanding (and Spanish localization generally).
7. Complete manual accessibility testing (screen readers, real touch, true 400% zoom, light theme); see `docs/ACCESSIBILITY.md`.

**Pre-deployment review (2026-10-22):** opening an investigation lands on Big Picture; light theme added; missing/not-reviewed/unresolved made visually distinct; 400% zoom, theme, keyboard and emulated-touch checks automated (`scripts/test-a11y-deep.mjs`). **NVDA, VoiceOver and real-device touch testing are NOT done** (checklist in `docs/MANUAL_A11Y_TESTS.md`); no WCAG conformance claim.

**Accessibility corrections (2026-10-22):** non-text contrast fixed (control boundaries 1.3 to 1.5:1 -> 4.5+:1, `docs/CONTRAST_REPORT.md`); forced-colors, prefers-contrast, text-spacing, reduced-motion, focus-visibility and form-error tests added (`scripts/test-a11y-modes.mjs`). NVDA, VoiceOver and real-device touch remain NOT tested; no WCAG conformance claim. Still open: per-field error association for the investigation forms; manual tests in `docs/MANUAL_A11Y_TESTS.md`.

### Deep Discovery: plan written, awaiting approval (2026-10-23)
See `docs/DEEP_DISCOVERY_PLAN.md`: architecture (extension-first direct fetch, small guarded Worker proxy, recovery via existing archive providers), first source Copperas Cove (CivicPlus, `Crawl-delay: 10`), cost model, security boundaries, acceptance tests, phases 0 to 5, open decisions. Nothing implemented.

**Deep Discovery Phase 0 built (2026-10-23), not pushed:** robots/Crawl-delay policy, per-host scheduler, URL and redirect safety, bounded link discovery, hard limits, outcome words, ledger + coverage table, connector interface, host policy registry (`docs/DISCOVERY_SOURCE_REGISTRY.md`). CivicPlus/Copperas Cove automation is **not cleared** (`docs/CIVICPLUS_VERIFICATION.md`); adapter not written. Phase 1 needs approval.
