# Claude Handoff — Chronium Mind

You are working on **Chronium Mind**, a historical-web and public-record
intelligence aggregator. This file is the current-state handoff — it is
rewritten each time a session ends with meaningful progress, not an
append-only log. If you're picking this up cold, read this file, then
`docs/CANON.md` (mission, evidence rules, storage/cost principles, and
every `CANON RULE` — these are load-bearing, not decoration), then
`docs/ROADMAP.md` (phase status) and `docs/RESEARCH_METHOD.md` (the
investigation-level research loop this session completed most of), then
skim `src/index.js` and `public/app.js`.

**Last updated:** 2026-09-08 (fifth update same day). **Bulk Ingestion +
Investigator Review Queue — Phase 4 of the case-file layer — is built
and live-verified**, per the user's explicit 24-section brief after
accepting Phase 3. See "In progress this session: Bulk Ingestion +
Review Queue" below. Uncommitted as of this writing; the very next thing
to commit (see "Where to look next").

Phase 3 (Findings + Claim Ledger + support/contradiction) is **done,
live-verified, and committed** as `c929984` ("feat: add evidence-backed
claims and findings") — accepted by the user as the clean baseline for
Phase 4. Phase 2 is `7e14cc3`, Phase 1 is `8e525ac`, Ask Sources is
`98509dc`. See those commits and `docs/ROADMAP.md` Phase 6/6a/4/9/10/5
for what each covers; this file no longer carries their uncommitted-diff
details since git history is the source of truth for all four now.
`principle.md` (Chronium's product constitution) is merged into
`docs/CANON.md` as "Product Principles" — read that section first,
before the rest of CANON.md.

Everything from "Previous session's work" onward below reflects an
earlier session, committed as `8b22ea5` and pushed to `origin/main`.

## What Chronium Mind actually is right now

Three things, merged into one engine:

1. A federated **historical web search** (Arquivo.pt, Wayback CDX, Common
   Crawl, Memento) with cross-archive dedup, capture-reachability
   validation, an in-app **Archive Viewer**, and a **Coverage Verdict** on
   every connector result (found / provider-unavailable /
   no-captures-in-index / verified-gap).
2. An **Investigation Workspace** — upload/search your own documents, turn
   a passage into cited Evidence, build a **case file of Subjects,
   evidence-backed Relationships, and Entity Mentions** pinpointing
   exactly where each subject appears, reason over it with a **Claim
   Ledger** (status, subject-tagged, multi-position support/contradict/
   contextualize evidence links) and **Findings** — evidence-backed
   conclusions classified DOCUMENTED_FACT/SUPPORTED_INFERENCE/ALLEGATION/
   UNRESOLVED_QUESTION/NO_EVIDENCE_LOCATED — and generate a deterministic
   (free) Evidence-Backed Report, now including Findings. Bulk documents
   flow through a durable **Ingestion Job/Item** pipeline into a
   dedicated **Review Queue** (Phase 4, new this session — see below)
   that assistively surfaces candidate subjects and watchlist-keyword
   hits for investigator confirmation, never auto-deciding identity or
   relationships. AI is a paid, opt-in, last-resort layer (Qualitative
   Analysis synthesis only).
3. **Ask Sources** (including Discover Sources) — a conversational entry
   point over the same investigation state, source-first and
   deterministic-first. See commit `98509dc`.

Copperas Cove, TX is still the proof corpus, not a special case in the
code — no Copperas-Cove-specific logic outside `data/`.

## In progress this session: Bulk Ingestion + Investigator Review Queue — uncommitted, live-verified 2026-09-08

The user's explicit ask, Phase 4 of `docs/INVESTIGATION_WORKSPACE_PLAN.md`
(a full 24-section brief), following acceptance of Phase 3, and the
direction already flagged in this file's own previous "Where to look
next": "Chronium must help a small investigation team process thousands
of records without forcing investigators to manually open and classify
every document." Core principle pasted verbatim: **"Chronium should
reduce reading burden without reducing evidentiary rigor. The system may
say: 'This document may mention Raymond Payne.' It must NOT automatically
say: 'Raymond Payne is connected to X.'"** Explicit non-negotiables
carried over and extended: the Marc/Raymond Payne identity-collision
regression, this time run through bulk/automated detection rather than
manual entry, plus a new co-occurrence regression (two people in one
document must never auto-create a relationship or finding).

Before writing code: re-read `docs/CLAUDE_HANDOFF.md` and
`docs/INVESTIGATION_WORKSPACE_PLAN.md`, inspected commit `c929984`, and
the existing ingestion/corpus/dedupe/evidence/search architecture. The
one genuine architectural decision this session: `ingestionBatches`
(predating this phase) was extended rather than duplicated with a new
parallel "job" concept — same precedent as Phase 3 extending the
pre-existing `claims` store.

**Scoped tightly per explicit instruction**: ingestion job/item tracking,
Review Queue UI, assistive-only candidate/watchlist detection, dedupe
provenance, investigator identity, review-history audit log. Explicitly
NOT built (brief §20): automatic accusation generation, automatic
relationship generation, automatic claim confirmation, automatic
contradiction resolution, automatic identity merging.
`#workspaceKebabBtn` (found broken in Phase 1) still NOT fixed — not
directly required by this phase. See
`docs/INVESTIGATION_WORKSPACE_PLAN.md` "Phase 4: as-built" (appended this
session) for the complete as-built record — schema, the full detection
decision table, and full verification detail. This handoff section is
the condensed pointer; that doc is the detailed record.

**Files added:** `public/ingestionReview.js` (pure detection logic, no
DOM/IndexedDB — strong/weak/ambiguous candidate matching, watchlist
matching), `scripts/test-ingestion-review.mjs` (21 unit tests),
`public/reviewQueue.js` (~450-line Review Queue workspace UI, a
deliberate architectural deviation from prior phases: self-contained
with its own DOM/event wiring rather than built inline in `app.js`,
which was already large — imports five render helpers `app.js` now
exports for this purpose). **Files modified:** `public/db.js`
(`DB_VERSION` 9→10; new `ingestionItems`/`reviewCandidates`/
`watchlists`/`watchlistMatches`/`reviewHistory`/`investigators` stores; a
`status` index added to the pre-existing `ingestionBatches` store in the
same upgrade pass; `confirmReviewCandidate` chains through the existing,
unmodified `createEvidenceItem`/`createEntityMention` APIs — every Phase
1/2 rule still applies to a bulk-confirmed mention), `public/ingest/pipeline.js`
(byte-read deferred into the per-item try/catch — see failure-recovery
fix below), `public/app.js`, `public/index.html`, `public/styles.css`,
`package.json` (`test:ingestion` + combined `test` script extended).

**The core distinction, as implemented**: detection is strictly
assistive — `findSubjectCandidates()` and `findWatchlistMatches()` return
possibility lists only, never a pre-chosen answer. A strong match (full
registered name/alias) surfaces one named candidate still requiring
confirmation; a weak match (bare PERSON surname) is a normal single
candidate only when exactly one registered person has that surname —
the moment 2+ people share it, state is forced to AMBIGUOUS and every
possibility renders as its own separate confirm button. This is the same
identity-safety discipline as Phase 1/2's Relationships/Mentions, applied
one layer earlier in the pipeline where the automation risk is highest.

**Two real, latent bugs found and fixed via the mandated 1,000-record
scale test** (not features — defects the scale requirement was written
specifically to catch): (1) search-in-queue only filtered
already-paginated items, missing anything beyond the loaded pages — fixed
with a bounded cursor-based full-scan `searchIngestionItems()`; (2) a
search-input race condition at scale — each keystroke fired an
independent async scan, and out-of-order resolution let a stale broad
result overwrite a correct narrow one — fixed with a 250ms debounce plus
a staleness guard inside the render function, the same bug class
previously found and fixed in an earlier phase's Subjects search box.

**Failure recovery** also surfaced a real fix, not just new behavior: the
pipeline originally read every file's bytes eagerly, before the per-item
try/catch, so an unreadable file could throw outside any recoverable
boundary. Fixed by deferring the read itself into the try/catch — one bad
document in a batch now correctly produces `COMPLETED_WITH_ERRORS`
instead of aborting the run.

**VERIFIED (live, Puppeteer against `wrangler dev`, viewport 1280×900):**
- `npm run check` clean (14 files). `npm test` (combined script) 77/77
  pass (30 Phase 1/2 + 26 Phase 3 + 21 new).
- Two Puppeteer driver runs, **49/49 assertions total, zero unexpected
  console errors** (the one console entry present each run is the same
  intentionally-aborted migration-seed network request used since Phase
  2, not an app defect):
  a genuine v9-shaped database (raw IndexedDB, full Phase 1-3 schema)
  seeded with real investigation/entity/claim data confirmed the v9→v10
  migration + all six new stores + every piece of legacy data intact →
  bulk-ingested 4 real documents through the actual Add-Research UI →
  review queue status counts/filters render → investigator created and
  selected → strong alias candidate ("Ray Payne" → Raymond Payne)
  confirmed, producing a real `entityMention` with `quotedName` preserved
  exactly, linked to a real `claimEvidence` row, marked reviewed with
  notes/reviewer attribution → **the Payne regression**: strong Marc
  match (not ambiguous), bare "Payne" document forced AMBIGUOUS with both
  names as separate buttons, no pre-selection anywhere → **co-occurrence
  regression**: Raymond Payne + Sheena Tanner both surface independently,
  zero relationships before or after confirming both → watchlist match/
  acknowledge cycle never creates a Finding → failure recovery (bad file
  + good file, `COMPLETED_WITH_ERRORS`, good file ingests, bad file
  recorded with its real error) → second driver run: **1,000-record scale
  test** (8,955ms ingest, ~9ms/record; 4,588ms re-ingest dedupe of all
  1,000; 1,242ms queue render; paginated 50-at-a-time; search narrows
  correctly at scale) → full **Phase 1-3 regression pass**: relationship/
  finding evidence requirements, quotedName preservation, claim UNVERIFIED
  default, delete-protection, Marc/Raymond isolation, Ask Sources,
  investigation persistence all re-confirmed intact.

Driver scripts and fixtures lived entirely in the scratchpad directory,
never in the repo.

**Still outstanding:**
- Not committed as of this writing — see "Where to look next."
- `docs/ROADMAP.md` (Phase 6/6a) and `docs/INVESTIGATION_WORKSPACE_PLAN.md`
  were updated this session to reflect the above.
- `#workspaceKebabBtn` (found in Phase 1) is still a real, known, unfixed
  issue — don't rediscover it from scratch next session.
- Automatic LLM-driven extraction/conclusions (brief §20) explicitly not
  built — this session shipped the assistive/manual foundation
  (candidate + watchlist surfacing, human confirmation required) it would
  sit on top of, not the automation itself.
- `createdBy`/`updatedBy` beyond `reviewedBy` were not added to ingestion
  items — same reasoning as Phase 3's forward-compatible-not-built note;
  no real auth system exists yet.

## Previous session's work: Research Outline + Detailed Bibliography + Findings/Report

The ask was to make the existing 4-tab loop (Research / Evidence /
Findings / Report) genuinely useful for real research, per `docs/CANON.md`
Build Priority P1 ("research outline, research bibliography" before
automated reports) and `docs/RESEARCH_METHOD.md`'s already-documented
target shape. **Explicitly out of scope and not touched:** Evidence Vault
(Phase 2), Compare Engine (Phase 3). The 4 top-level tabs and Findings' 5
sub-tabs are unchanged in count — nothing was exploded into new nav.

**Data model** (`public/db.js`, `DB_VERSION` 4→5):
- Outline lanes (`outlines` store) gained `method`
  (quantitative/qualitative/mixed) and `status`
  (not-started/in-progress/answered) per section, alongside the existing
  `label`/`coveragePct`.
- Bibliography (`biblio` object on `records`) gained `documentType`,
  `publicationDate`, `dateCoverage`, `relevantPagesNote`. Everything else
  in the Target Source Record Shape (retrieval date, original location,
  archive/capture info, version/hash, relevant pages from evidence,
  investigation usage, preservation status) is **derived, never stored** —
  new export `computeBiblioDerived(record, evidenceItems, claims)`.
- Three new stores, all indexed by `investigationId`:
  `quantitativeFindings` (statement/formula/method/inputs/outlineLaneId),
  `qualitativeFindings` (statement/methodology/evidenceItemIds/
  outlineLaneId), `crossValidations` (pairs one of each with a
  consistent/discrepancy/unclear verdict + note).

**Research tab**: outline authoring moved here (was split across
Findings→Analysis and Findings→Gaps). Each section shows inline-editable
method/status `<select>`s (`updateOutlineLane` on change — no separate
save step), linked evidence + finding counts, a coverage bar, and a
roll-up "X of Y sections answered" line.

**Evidence tab**: gained a sub-toggle — Evidence Items | Bibliography —
same hash convention as Findings sub-tabs
(`#/workspace/evidence/bibliography`). The standalone `#/bibliography`
view/nav-link is **gone**; Bibliography now renders one card per source
(not a table — most fields are legitimately optional) via
`computeBiblioDerived`, with an "Edit" button opening the same dialog,
now with 4 more fields.

**Findings→Gaps**: now read-only (editing lives in Research). Gap
criteria factored into `computeGapWarnings(outline, evidenceItems)`,
shared with the Report. A section marked "Answered" with zero evidence
gets its own distinct warning ("worth double-checking") rather than being
silently trusted or silently flagged as a normal gap.

**Findings→Analysis**: question/method form moved out (now in Research).
Added, between the existing free stat grid and the AI synthesis panel:
Quantitative Findings (form + list, preserves formula/method/inputs, an
auto-summed total is labeled as mechanical/informational only — never a
substitute for the formula), Qualitative Findings (form + list, preserves
methodology/supporting passages), and Mixed-method Cross-Validation (pick
one of each, researcher sets the verdict — Chronium never infers
agreement; a `discrepancy` renders as a visibly distinct review item, not
a conclusion).

**Report tab**: `renderReportPanel` rewritten to assemble, in order,
skipping empty sections: Question & Method → Outline → Sources/
Bibliography → Evidence (summary) → Quantitative Findings → Qualitative
Findings → Gaps/Contradictions/Review items → Claims. Entirely
client-side/deterministic — no AI call anywhere in this path.

## Verified this session (live, Puppeteer against `wrangler dev`)

Full walkthrough with zero console errors: create investigation → set
research question + method → add 2 outline sections with different
method/status → add a URL source → save an evidence item against it →
confirm Bibliography card shows the derived fields (retrieved date,
original location, relevant pages pulled from the evidence item's
location, investigation usage) → add a Quantitative Finding and a
Qualitative Finding → cross-validate them as a discrepancy → confirm Gaps
reflects both the low-coverage and no-evidence sections → confirm Report
renders all sections in the right order, correctly citing the
discrepancy as "needs human review, not a conclusion." Screenshots taken
at each step (not committed — this was verification, not fixtures).

Also checked per the user's ask: `/api/health/connectors` responds fine;
Wayback still shows `"lastError":"The operation was aborted"` (timeouts)
in this dev environment, consistent with the prior handoff's note — this
is unrelated to this session's work and was **not** redesigned around.
Archive Viewer PDF-in-iframe path was not re-verified this session (no
code in that path changed); still carries the same "implemented,
code-reviewed, not live-PDF-verified" caveat as the previous handoff.

## AI-assisted analysis: confirmed working against production secrets

After the Research Methodology milestone was pushed, the user asked to
confirm Qualitative Analysis (the one AI-assisted, paid, opt-in feature)
actually works, not just that its code exists. Confirmed on both ends:

- **Secret is configured**: `wrangler secret list` shows `ANTHROPIC_API_KEY`
  already set on the deployed Worker.
- **Backend confirmed for real**: ran `wrangler dev --remote` (real
  Cloudflare bindings/secrets, not local `.dev.vars` — there is no
  `.dev.vars` file in this repo, so a plain local `wrangler dev` cannot
  exercise this path) and called `/api/analyze/qualitative` directly with
  synthetic evidence. Got a real `200` from Anthropic: valid
  themes/patterns/contradictions/synthesis JSON, each citing real evidence
  IDs, model `claude-haiku-4-5-20251001`, ~4.3s.
- **Full UI path confirmed too**: same remote-mode server, driven with
  Puppeteer — created an investigation, added 2 evidence items, clicked
  "Run AI analysis" on Findings→Analysis, got a real rendered result
  (Synthesis + 2 Themes + 1 Pattern + a correct "1 contradiction — see the
  Contradictions tab" cross-link). Zero console errors.

Nothing code-side changed for this check — it's a verification note, not
a shipped change. If a future session needs to exercise this path via
plain `wrangler dev` (not `--remote`), it'll need a local `.dev.vars` with
`ANTHROPIC_API_KEY=...` — ask the user for that key rather than assuming
one exists locally.

## Known gaps / things the next session should watch

- Same Wayback CDX flakiness as last session — check
  `/api/health/connectors` before assuming a thin Wayback result is a
  real coverage gap.
- Archive Viewer PDF path still wants an explicit live test with a
  working archived PDF, whenever the CDX/replay-host flakiness above
  isn't in the way.
- Quantitative Finding inputs currently support one numeric value per
  evidence item, summed with plain addition — fine for "total/sum"
  formulas, not a general expression evaluator. If a real investigation
  needs something more (weighted sums, subtraction), that's a future
  ask, not assumed now.
- Cross-validation is 1 quantitative finding ↔ 1 qualitative finding per
  entry — no many-to-many, no bulk view beyond the list under Analysis
  and the Report's Gaps/Contradictions/Review-items section. Fine for the
  scale this was built for; revisit only if a real investigation needs
  more.

## Development constraints (still true, unchanged)

- Bootstrap / free-tier-first. Cloudflare-friendly. Avoid paid APIs
  beyond the one opt-in AI provider call.
- No unnecessary framework migration — vanilla JS + one Cloudflare
  Worker, no build step, no framework.
- Preserve working code where reasonable; consolidate UX, don't delete
  functionality wholesale.
- Responsive and accessible UI (WCAG 2.2 AA — see the user's global
  CLAUDE.md rules).
- Data-driven generic rendering — no Copperas-Cove-specific logic outside
  `data/`.
- Source provenance is mandatory, on every result, always.
- Never call an AI inference a source fact — CANON.md's Evidence Rules
  (Source Fact / Computed Fact / AI Analysis) now has a concrete home in
  Quantitative Findings' mechanical sum vs. its formula/method text, and
  in Cross-Validation's researcher-asserted verdict.
- AI is a last resort behind cache → deterministic code → index/search →
  rules — never required for the core loop, including the new Findings
  and Report sections (all client-side/free).
- Do not imply that a changed page/document is wrongdoing. Present
  evidence neutrally.

## Where to look next

**Immediate:** commit the Bulk Ingestion + Review Queue diff (see "In
progress this session" above) — it is live-verified and has been sitting
uncommitted since being built. Suggested message per the user's own
instruction: `feat: add bulk ingestion review queue`.

**Then STOP.** The user's own instruction for this phase was explicit:
*"Do NOT begin Phase 5. Stop after the commit and hand Phase 4 back for
review."* Do not self-direct into automatic LLM extraction/conclusions
(brief §20 — this session shipped the assistive/manual foundation only,
not the automation), timeline events, identity-resolution scoring/source
tiers, network view, automatic contradiction detection, or any other
roadmap item, including the still-open, explicitly-flagged
`#workspaceKebabBtn` bug, without being asked. Report back what was built
and wait. (Note: the plan doc's original Part 5 sketch numbered timeline
events as "Phase 2" before the actual numbered phases turned out to be
entity mentions/claims-findings/bulk-ingestion instead. Treat the plan
doc's own "Phase 1/2/3/4: as-built" sections, and whatever number/scope
the user assigns next, as authoritative over that original sketch's
numbering.)

Beyond that: the user has said further priorities will come from running a
real-world Chronium investigation through the workflow, not speculative
feature expansion.

## Product language

Chronium Mind — **Search the Internet through time.**
Secondary: **Your gateway to the Internet's memory.**

Research screens must stay credible for journalism, legal/evidence
research, academic work, education, and business intelligence.
