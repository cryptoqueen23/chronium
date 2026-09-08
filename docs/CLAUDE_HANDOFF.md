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

**Last updated:** 2026-09-08 (fourth update same day). **Findings + Claim
Ledger + support/contradiction — Phase 3 of the case-file layer — is
built and live-verified**, per the user's explicit request after
accepting Phase 2. See "In progress this session: Findings + Claim
Ledger" below. Uncommitted as of this writing; the very next thing to
commit (see "Where to look next").

Phase 2 (Entity Mentions / Evidence↔Subject linking) is **done,
live-verified, and committed** as `7e14cc3` ("feat: link subjects to
evidence mentions") — accepted by the user as the clean baseline for
Phase 3. Phase 1 is `8e525ac`, Ask Sources is `98509dc`. See those
commits and `docs/ROADMAP.md` Phase 6/4/9/10/5 for what each covers; this
file no longer carries their uncommitted-diff details since git history
is the source of truth for all three now. `principle.md` (Chronium's
product constitution) is merged into `docs/CANON.md` as "Product
Principles" — read that section first, before the rest of CANON.md.

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
   UNRESOLVED_QUESTION/NO_EVIDENCE_LOCATED (Phase 3, new this session —
   see below) — and generate a deterministic (free) Evidence-Backed
   Report, now including Findings. AI is a paid, opt-in, last-resort
   layer (Qualitative Analysis synthesis only).
3. **Ask Sources** (including Discover Sources) — a conversational entry
   point over the same investigation state, source-first and
   deterministic-first. See commit `98509dc`.

Copperas Cove, TX is still the proof corpus, not a special case in the
code — no Copperas-Cove-specific logic outside `data/`.

## In progress this session: Findings + Claim Ledger + support/contradiction — uncommitted, live-verified 2026-09-08

The user's explicit ask, Phase 3 of `docs/INVESTIGATION_WORKSPACE_PLAN.md`,
following acceptance of Phase 2: "What do we think the records establish,
and why?" Core model pasted verbatim:
**"SOURCE → EVIDENCE → ENTITY MENTION → ENTITY/RELATIONSHIP → CLAIM →
FINDING → REPORT. A claim is something being tested. A finding is the
investigator's evidence-backed conclusion about that claim... Neither may
exist as an unsupported factual conclusion."** Explicit non-negotiable:
**"Evidence count alone must NEVER determine claim status... For Phase 3,
claim status remains a deliberate investigator decision."** A permanent
extension of the Marc/Raymond Payne regression was specified: an
ambiguous supporting source ("Ray Payne") vs. a contradicting official
record (Marc Payne), resolved to REFUTED with a DOCUMENTED_FACT finding —
built as this session's actual core-workflow test content, not a separate
fixture.

Before writing code: re-read `docs/INVESTIGATION_WORKSPACE_PLAN.md`,
inspected commit `7e14cc3`, and — the one genuine surprise this
session — discovered Chronium already had a `claims` store predating
Phase 1 entirely (inline `links: [{evidenceItemId, stance}]`, 2 stances,
no status). The brief's "implement a claim model" was written without
knowing this existed; extending it additively rather than building a
parallel concept was this session's first real architectural decision
(see "A pre-existing store, extended rather than duplicated" in the plan
doc's Phase 3 section).

**Scoped tightly per explicit instruction**: Findings + Claim Ledger +
support/contradiction only. Explicitly NOT touched: network
visualization, automatic NER, automatic identity merging, AI-generated
accusations, source reliability scoring, timeline engine.
`#workspaceKebabBtn` (found broken in Phase 1) still NOT fixed. See
`docs/INVESTIGATION_WORKSPACE_PLAN.md` "Phase 3: as-built" (appended this
session) for the complete as-built record — schema, the full
referential-integrity decision table, and full verification detail. This
handoff section is the condensed pointer; that doc is the detailed
record.

**Files added:** `public/claims.js` (pure vocabulary + validation,
mirrors `public/entities.js`), `scripts/test-claims.mjs` (26 unit tests).
**Files modified:** `public/db.js` (`DB_VERSION` 8→9; new
`claimEvidence`/`claimFindings`/`claimHistory` stores; two new indexes
added to the *pre-existing* `claims` store during the same upgrade; a
one-time idempotent backfill migrating legacy `claims.links` into
`claimEvidence`; extended `createClaim`/`updateClaim`/`deleteClaim`;
`deleteEvidenceItem` extended with block-or-trim logic), `public/app.js`,
`public/index.html`, `public/styles.css`, `package.json` (`test:claims` +
combined `test` script).

**The core distinction, as implemented**: a Claim may legitimately exist
with ZERO evidence (status UNVERIFIED — "an unsupported question/lead may
remain in the claim ledger," brief §11) — this is the one deliberate
asymmetry versus Phase 1/2's Relationships and Mentions, which both
require evidence to exist at all. The hard evidence rule instead lives on
Findings: `createClaimFinding()`/`updateClaimFinding()` reject a
DOCUMENTED_FACT/SUPPORTED_INFERENCE/ALLEGATION with no cited evidence
(`FindingEvidenceRequiredError`) exactly like Phase 1's
`RelationshipEvidenceRequiredError`; UNRESOLVED_QUESTION and
NO_EVIDENCE_LOCATED are the only classifications exempt, because those
two classifications ARE the honest "nothing established" statement.

**Referential integrity — the brief explicitly offered BLOCK vs.
auto-downgrade; BLOCK was chosen throughout**, because silently changing
what a finding asserts is itself an editorial act Chronium has no
business taking on the investigator's behalf: deleting the only evidence
behind an evidence-requiring finding is refused entirely (checked for
every affected finding before any mutation is issued, so a refusal never
leaves a partial delete behind); deleting one of several is allowed and
just trims that finding's `evidenceIds`; deleting a claim while a Finding
still cites it is refused. Full table with all five scenarios in the
plan doc.

**Two things found and handled that weren't explicitly asked about**:
(1) the pre-existing `claims` store, handled by extension (see above);
(2) `deleteEvidenceItem`'s existing call site in `public/app.js` had no
try/catch — it can now throw when blocked, so a `catch` was added there
to surface why instead of the delete silently failing.

**VERIFIED (live, Puppeteer against `wrangler dev`, viewport 1280×900):**
- `npm run check` clean (12 files). `npm test` (new combined script)
  56/56 pass (30 from Phase 1/2 + 26 new).
- One Puppeteer run, **49/49 assertions, zero unexpected console errors**
  (one intentionally-aborted network request from the same migration-seed
  technique introduced in Phase 2, not an app defect):
  a genuine v8-shaped database (raw IndexedDB, full Phase 1+2 schema)
  seeded with a legacy `claims.links`-shaped claim, then the actual app's
  first load confirmed the v9 migration + new stores + the legacy claim
  intact with its old `links` field untouched + the backfill copied it
  into `claimEvidence` exactly once → the full core workflow as one
  continuous run (create claim → tag subject → attach support +
  contradict evidence → status → REFUTED, logged to `claimHistory` →
  create DOCUMENTED_FACT finding, submit button disabled until evidence
  checked → evidence trail intact → survives reload) → **the Payne claim
  regression**: entity IDs stay isolated, zero relationship created, the
  incorrect-but-real supporting source was never deleted, no entity merge
  → conflicting-evidence regression (2 supports + 1 contradicts coexist,
  deleting one link never touches the evidence item) → no-evidence test
  (three asserting classifications rejected with none, NO_EVIDENCE_LOCATED
  succeeds) → all five referential-integrity scenarios, each as a real
  blocked→unblocked transition → direct-`db.js` bypass rejection for
  fabricated claim/evidence ids → Evidence-view "Used in Claims" and
  Subject-profile "Claims/Findings involving this subject" integration →
  full **Phase 1+2 regression pass**: everything in the brief's §17 list.

Driver scripts lived entirely in the scratchpad directory, never in the
repo.

**Still outstanding:**
- Not committed as of this writing — see "Where to look next."
- `docs/ROADMAP.md` (Phases 1/4/9/10) and `docs/INVESTIGATION_WORKSPACE_PLAN.md`
  were updated this session to reflect the above.
- `#workspaceKebabBtn` (found in Phase 1) is still a real, known, unfixed
  issue — don't rediscover it from scratch next session.
- `createdBy`/`updatedBy`/`reviewedBy` were considered (brief §15) and
  deliberately NOT added — no auth system exists yet, so nullable fields
  nobody populates would be speculative weight. Nothing about the current
  schema blocks adding them additively later.
- Automatic contradiction detection (roadmap Phase 4) is explicitly not
  built — this session shipped the manual foundation (multi-position
  claim-evidence stance) it would sit on top of, not the automation
  itself, per the brief's explicit "no AI-generated accusations."

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

**Immediate:** commit the Findings + Claim Ledger diff (see "In progress
this session" above) — it is live-verified and has been sitting
uncommitted since being built. Suggested message per the user's own
instruction: `feat: add evidence-backed claims and findings`.

**Then STOP.** The user's own instruction for this phase was explicit:
*"Do NOT begin Phase 4. Stop after the commit and hand Phase 3 back for
review."* Do not self-direct into automatic contradiction detection
(roadmap Phase 4 — this session built its manual foundation only, not
the automation), timeline events, identity-resolution scoring/source
tiers, network view, or any other roadmap item, including the still-open,
explicitly-flagged `#workspaceKebabBtn` bug, without being asked. Report
back what was built and wait. (Note: the plan doc's original Part 5
sketch numbered timeline events as "Phase 2" before the actual Phase 2
request turned out to be entity mentions, and this Phase 3 — Claims/
Findings — wasn't in that original sketch at all. Treat the plan doc's
own "Phase 1/2/3: as-built" sections, and whatever number/scope the user
assigns next, as authoritative over that original sketch's numbering.)

**One user-flagged direction, not yet requested as work:** after Phase 3
stabilizes, the user wants Chronium to tackle bulk ingestion — an
automated pipeline that processes many documents at once and surfaces
detected people/organizations/mentions/relationships/dates into a
**review queue** the investigator explicitly approves/rejects/merges,
rather than writing directly into the evidence graph. This is explicitly
future work ("once Phase 3 is stable"), not scoped or started — don't
build toward it without being asked, but keep it in mind as the likely
next real ask, and note that it will need automatic NER/extraction, which
every phase so far has deliberately excluded from the core evidence model
until now for exactly this reason ("we need the evidence model correct
before automation touches it").

Beyond that: the user has said further priorities will come from running a
real-world Chronium investigation through the workflow, not speculative
feature expansion.

## Product language

Chronium Mind — **Search the Internet through time.**
Secondary: **Your gateway to the Internet's memory.**

Research screens must stay credible for journalism, legal/evidence
research, academic work, education, and business intelligence.
