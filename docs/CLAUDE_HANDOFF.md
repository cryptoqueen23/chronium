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

**Last updated:** 2026-09-08 (second update same day). **Investigation
Entities (Subjects tab) — Phase 1 of the case-file layer — is built and
live-verified**, per the user's explicit request following the Ask
Sources milestone. See "In progress this session: Investigation Entities"
below. Everything under that heading is uncommitted as of this writing;
it is the very next thing to commit (see "Where to look next"), separately
from the Ask Sources commit below.

Ask Sources + Discover Sources (Roadmap Phase 5) is **done, live-verified,
and committed** as `98509dc` ("feat: Ask Sources + Discover Sources,
live-verified end-to-end") — see that commit and
`docs/ROADMAP.md` Phase 5 for what it covers; this file no longer carries
its uncommitted-diff details since git history is now the source of truth
for it. `principle.md` (repo root, Chronium's product constitution) was
merged into `docs/CANON.md` as "Product Principles" in that same commit —
read that section first, before the rest of CANON.md.

Everything from "Previous session's work" onward below reflects the
session before that, committed as `8b22ea5` and pushed to `origin/main`.

## What Chronium Mind actually is right now

Three things, merged into one engine:

1. A federated **historical web search** (Arquivo.pt, Wayback CDX, Common
   Crawl, Memento) with cross-archive dedup, capture-reachability
   validation, an in-app **Archive Viewer**, and a **Coverage Verdict** on
   every connector result (found / provider-unavailable /
   no-captures-in-index / verified-gap).
2. An **Investigation Workspace** — upload/search your own documents, turn
   a passage into cited Evidence, build Claims, build a **case file of
   Subjects and evidence-backed Relationships between them** (new this
   session — see below), and generate a deterministic (free)
   Evidence-Backed Report. AI is a paid, opt-in, last-resort layer
   (Qualitative Analysis synthesis only).
3. **Ask Sources** (including Discover Sources) — a conversational entry
   point over the same investigation state, source-first and
   deterministic-first. See commit `98509dc`.

Copperas Cove, TX is still the proof corpus, not a special case in the
code — no Copperas-Cove-specific logic outside `data/`.

## In progress this session: Investigation Entities (Subjects tab) — uncommitted, live-verified 2026-09-08

The user's explicit ask, following the Ask Sources milestone: evolve
Chronium from "archive search" into a real investigation workspace —
subjects (people, organizations, government bodies, etc.), a relationship
graph between them, with one hard non-negotiable rule pasted verbatim:
**"A relationship MUST NOT be persisted unless it references at least one
valid evidence item... Enforce this at the data-layer boundary, not just
the UI."** The user also specified a permanent regression test: create
Marc Payne and Raymond Payne as separate people, give each an independent
evidence-backed relationship, and verify Chronium never merges them,
transfers a relationship between them, or infers a connection neither
piece of evidence supports — modeling a real research error from an
earlier Copperas Cove session (a secondary source conflated "Marc Payne"
with "Raymond Payne").

Before writing code: read `docs/INVESTIGATION_WORKSPACE_PLAN.md` in full
(a same-session audit of what already existed toward this — more than
expected, see that doc's Part 1 — plus the phased plan), inspected
`public/db.js`'s existing store/CRUD conventions, the Evidence Items data
shape, the hash-based nav/routing convention (`#/workspace/:tab/:subtab`),
and confirmed there is no unit-test runner beyond `npm run check` (syntax
only) — see "Test conventions" below for what this session added.

**Scoped tightly, per explicit instruction**: entity + relationship data
model and a Subjects tab UI only. Explicitly NOT touched: timeline events,
claims integration, graph visualization, AI extraction, report generation.
See `docs/INVESTIGATION_WORKSPACE_PLAN.md` "Phase 1: as-built" (appended
to that doc this session) for the complete as-built record — file list,
schema, the two deliberate deviations from the original plan (aliases as
a real `entityAliases` store rather than an inline array field;
`entityMentions`/`quotedName` deferred, not built), and full verification
detail. This handoff section is the condensed pointer; that doc is the
detailed record — don't let the two drift apart.

**Files touched:**
```
 M package.json    - `check` gains entities.js; new `test:entities` script
 M public/app.js   - Subjects tab: entity/alias/relationship CRUD UI
 M public/db.js    - DB_VERSION 6->7, entities/relationships/entityAliases stores + CRUD
 M public/index.html - Subjects panel markup, icon-user symbol
 M public/styles.css - .entity-card/.alias-chip/.rel-row/.status-badge.status-* styles
 M public/ui.js    - confirmDialog() bug fix (see below) - NOT feature scope, a blocking dependency fix
?? public/entities.js       - new: pure vocabulary + validation, no DOM/IndexedDB
?? scripts/test-entities.mjs - new: 21 unit tests, plain `node --test`, no new dependency
```

**The hard rule, where it actually lives**: `public/entities.js`
`validateRelationshipFields()` throws `RelationshipEvidenceRequiredError`
for missing/non-array/empty `evidenceIds` (shape check, no DB access).
`public/db.js` `createRelationship()`/`updateRelationship()` — the ONLY
write path to the `relationships` store — call that, then, inside the
SAME IndexedDB transaction as the eventual write,
`assertRelationshipReferencesExist()` confirms every cited evidence id
and both entity ids actually exist in this investigation, throwing
`RelationshipValidationError` otherwise. Verified by calling
`createRelationship()` directly via `page.evaluate(() => import('/db.js'))`
— bypassing the UI entirely, exactly as instructed — with an empty
array, a missing field, and a fabricated evidence id: all three rejected,
zero relationships persisted.

**Two pre-existing bugs found and fixed** (both directly blocked
verifying this phase's own test requirements — not scope creep):
1. `public/ui.js` `confirmDialog()` always resolved `false` regardless of
   which button was clicked (a Promise-settle-ordering bug: `close()`'s
   `onClose: () => resolve(false)` fired before the real
   `resolve(result)`, and only a promise's first settle call counts).
   This affected every confirm-gated destructive action in the app,
   including "Delete investigation" — **which had never actually worked
   via its Confirm button, in any previous session**, not just this
   feature's new "Delete subject." Fixed with an idempotent `settle()`
   guard. Verified on both the new Delete Subject flow AND the
   pre-existing Delete Investigation flow (Cancel confirmed to not
   delete, Confirm confirmed to actually delete).
2. `#workspaceKebabBtn` (the in-workspace "…" menu, home of
   `delete-active-investigation`) has **no click handler wired up at
   all** — found while writing the regression check for bug #1, when
   that specific path turned out to be unreachable independent of the
   confirmDialog bug. **NOT fixed — explicitly out of scope for this
   phase.** The investigations-list page's per-card kebab menu is a
   working alternate path to the same delete feature, so this isn't a
   product dead-end, just a broken shortcut worth a deliberate fix
   decision later.

**A UI consistency bug found and fixed mid-session** (not pre-existing —
introduced and caught within this same session): the Subjects list's
search box called the alias-aware `findEntities()` while live-typing, but
re-entering the tab with a non-empty search box fell back to a
plain name-only filter that couldn't see aliases — same visible search
box, two different behaviors depending on how you got there. Fixed by
routing both paths through `findEntities()`; `renderEntityList()` no
longer filters, only renders what it's given.

**Test conventions established this session**: `public/entities.js` has
zero DOM/IndexedDB dependency by design specifically so it could be unit
tested with plain Node (`node:test` + `node:assert/strict`, both built
in — no new dependency), wired as `npm run test:entities`. This is a
reusable pattern for future pure-logic modules; the DB/UI layers still
need the existing Puppeteer-against-`wrangler dev` approach (see Ask
Sources' verification method, `98509dc`).

**VERIFIED (live, Puppeteer against `wrangler dev`, viewport 1280×900 —
same lesson from the Ask Sources session about default-viewport nav
collapse):**
- `npm run check` clean (11 files). `npm run test:entities` 21/21 pass.
- One Puppeteer run, 21/21 assertions, zero console/page errors:
  6→7 DB migration survives with all three new stores present → Subjects
  tab loads → entity create + list → search "Payne" returns BOTH Marc and
  Raymond → entity profile opens → relationship submit button disabled
  with zero evidence selected, enables on selection → a valid
  evidence-backed relationship round-trips with correct
  Outgoing/Incoming direction and confidence badge → the direct-`db.js`
  bypass rejection (§ above) → **the full Marc/Raymond Payne regression**:
  search returns both, no merge, no relationship transfer in either
  direction, confirmed independently from both profiles → alias added,
  displayed, doesn't merge or rename → deleting Marc Payne doesn't
  corrupt Raymond's entity or his (unrelated) relationship → Evidence/
  Report tabs unaffected → full reload persistence.
- A separate short regression run confirmed the `confirmDialog()` fix
  specifically: Cancel does not delete, Confirm does delete (on the
  pre-existing "Delete investigation" feature), and an Ask Sources smoke
  check (the priority bare-depth-phrase regression from the previous
  session) still holds — `public/ui.js` is a shared dependency, worth the
  extra check.

Driver scripts lived entirely in the scratchpad directory, never in the
repo — confirmed via `git status` throughout.

**Still outstanding:**
- Not committed as of this writing — see "Where to look next."
- `docs/ROADMAP.md` Phase 6 and `docs/INVESTIGATION_WORKSPACE_PLAN.md`
  were updated this session to reflect the above — keep them in sync if
  Phase 2+ of that plan gets built later.
- Bug #2 above (`#workspaceKebabBtn`) is a real, known, unfixed issue —
  don't rediscover it from scratch next session.

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

**Immediate:** commit the Investigation Entities diff (see "In progress
this session" above) — it is live-verified and has been sitting
uncommitted since being built. Suggested message per the user's own
instruction: `feat: add evidence-backed investigation entities`.

**Then STOP.** The user's own instruction for this phase was explicit:
*"Do not begin Phase 2 after committing... Stop and hand Phase 1 back to
me for review."* Do not self-direct into Phase 2 of
`docs/INVESTIGATION_WORKSPACE_PLAN.md` (timeline events), Phase 3
(identity-resolution scoring / source tiers), Phase 4 (network view), or
any other roadmap item — including the still-open, explicitly-flagged
`#workspaceKebabBtn` bug — without being asked. Report back what was
built, the two pre-existing bugs found, and wait.

Beyond that: the user has said further priorities will come from running a
real-world Chronium investigation through the workflow, not speculative
feature expansion.

## Product language

Chronium Mind — **Search the Internet through time.**
Secondary: **Your gateway to the Internet's memory.**

Research screens must stay credible for journalism, legal/evidence
research, academic work, education, and business intelligence.
