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

**Last updated:** 2026-09-08 (sixth update same day). **Bulk Ingestion +
Investigator Review Queue — Phase 4 of the case-file layer — is done,
live-verified, and committed** as `83cc986` ("feat: add bulk ingestion
review queue") — accepted by the user as the clean baseline for whatever
comes next. Per the user's own explicit instruction, work **stopped
after that commit** — nothing is in progress, nothing is uncommitted.
See `docs/INVESTIGATION_WORKSPACE_PLAN.md` "Phase 4: as-built" for the
full schema/verification record; see "Where to look next" below for
what a new session should do first.

Phase 3 is `c929984`, Phase 2 is `7e14cc3`, Phase 1 is `8e525ac`, Ask
Sources is `98509dc`. See those commits and `docs/ROADMAP.md` Phase
6/6a/4/9/10/5 for what each covers; this file no longer carries their
uncommitted-diff details since git history is the source of truth for
all five now. `principle.md` (Chronium's product constitution) is merged
into `docs/CANON.md` as "Product Principles" — read that section first,
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
   dedicated **Review Queue** that assistively surfaces candidate
   subjects and watchlist-keyword hits for investigator confirmation,
   never auto-deciding identity or relationships. AI is a paid, opt-in,
   last-resort layer (Qualitative Analysis synthesis only).
3. **Ask Sources** (including Discover Sources) — a conversational entry
   point over the same investigation state, source-first and
   deterministic-first. See commit `98509dc`.

Copperas Cove, TX is still the proof corpus, not a special case in the
code — no Copperas-Cove-specific logic outside `data/`.

## Most recent session's work: Bulk Ingestion + Investigator Review Queue (Phase 4) — done, committed `83cc986`

Built to a full 24-section user brief following acceptance of Phase 3,
delivering the bulk-ingestion direction this file had flagged as likely
next. Shipped: a durable Ingestion Job/Item model (extends the
pre-existing `ingestionBatches` store rather than duplicating it, same
precedent as Phase 3 extending `claims`), a Review Queue workspace tab,
assistive-only bulk subject-candidate detection (strong/weak/AMBIGUOUS
matching — a bare shared surname like "Payne" always surfaces every
matching person as a separate button, never auto-picks one), an
investigator-defined watchlist/keyword system that never auto-converts a
hit into a Finding, SHA-256 dedupe with duplicate-occurrence provenance,
lightweight non-authenticating investigator identity, and a
`reviewHistory` audit log. Explicitly NOT built, per the brief's own
§20: automatic accusation/relationship/claim-confirmation/contradiction-
resolution/identity-merging generation anywhere in this pipeline.

`DB_VERSION` 9→10 (additive — `ingestionItems`, `reviewCandidates`,
`watchlists`, `watchlistMatches`, `reviewHistory`, `investigators`,
plus a new index on the pre-existing `ingestionBatches` store). New
files: `public/ingestionReview.js` (pure detection logic),
`public/reviewQueue.js` (self-contained Review Queue UI — a deliberate
architectural deviation from prior phases, since `app.js` was already
large), `scripts/test-ingestion-review.mjs`. A mandated 1,000-record
scale test caught and fixed two real latent bugs (search missing
unpaged items; a search-input race condition — same bug class as an
earlier phase's Subjects search box) and confirmed a genuine
failure-recovery fix (one unreadable file no longer aborts a batch).

`npm test` 77/77, two live Puppeteer driver runs 49/49 assertions, zero
unexpected console errors, full Phase 1-3 regression re-confirmed
intact. `#workspaceKebabBtn` (Phase 1) still open, not touched — out of
this phase's scope. Full schema, the detection decision table, and the
complete verification log live in `docs/INVESTIGATION_WORKSPACE_PLAN.md`
"Phase 4: as-built" — read that before touching any of this phase's code.

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

**Nothing is in progress.** Phase 4 is committed (`83cc986`) and the
working tree is clean. The user's own instruction after accepting this
phase was explicit: *"Do NOT begin Phase 5. Stop after the commit and
hand Phase 4 back for review."* A new session should **wait for the
user's next explicit direction** rather than self-directing into
automatic LLM extraction/conclusions (brief §20 — Phase 4 shipped the
assistive/manual foundation only, not the automation), timeline events,
identity-resolution scoring/source tiers, network view, automatic
contradiction detection, or any other roadmap item — including the
still-open, explicitly-flagged `#workspaceKebabBtn` bug. (Note: the plan
doc's original Part 5 sketch numbered timeline events as "Phase 2"
before the actual numbered phases turned out to be entity mentions/
claims-findings/bulk-ingestion instead. Treat the plan doc's own "Phase
1/2/3/4: as-built" sections, and whatever number/scope the user assigns
next, as authoritative over that original sketch's numbering.)

If the user opens a new session referencing this handoff cold: read this
file, then `docs/CANON.md`, then `docs/ROADMAP.md`, then
`docs/INVESTIGATION_WORKSPACE_PLAN.md`'s "Phase 4: as-built" for the most
recent detailed work, then ask what they want next rather than guessing.

Beyond that: the user has said further priorities will come from running a
real-world Chronium investigation through the workflow, not speculative
feature expansion.

## Product language

Chronium Mind — **Search the Internet through time.**
Secondary: **Your gateway to the Internet's memory.**

Research screens must stay credible for journalism, legal/evidence
research, academic work, education, and business intelligence.
