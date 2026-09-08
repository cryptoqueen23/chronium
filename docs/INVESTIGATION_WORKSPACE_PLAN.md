# Investigation Workspace — Entity/Relationship Layer

Audit + phased plan for the "case file" evolution (subjects, relationships,
timeline events, identity resolution, source tiers). Companion to
`docs/ROADMAP.md` (this is Phase 6 "Relationship Graph" plus parts of 8/9/11
pulled forward) and `docs/CANON.md` (binding — every decision below is
tested against Product Principles, especially #3 Never Lose the Receipt,
#11 Separate Fact From Interpretation, #12 Missing Evidence Is Information,
and #17 Never Fake Coverage).

**Written 2026-09-08, before any code was changed. Phase 1 (below) shipped
later the same day — see "Phase 1: as-built" appended at the end of this
document for what actually landed, including two deviations from this
original plan and two pre-existing bugs found and fixed along the way.**

## Guiding constraint

> Chronium is an evidence engine, not an accusation engine. The software
> should make it *harder*, not easier, to make claims the underlying
> records do not support.

This is not a new principle — it is the operational form of CANON Principles
#3, #11, #12 and the two `CANON RULE` blocks on coverage. Nothing in this
plan may weaken them.

---

## Part 1 — What already exists

Substantially more of the requested case-file model is built than a fresh
reading of the request would suggest. **Do not rebuild any of this.**

| Requested capability | Current state | Where |
|---|---|---|
| Evidence Ledger | **Built.** `evidenceItems` store: excerpt text, location, source link, notes, lane. Backed by `records` carrying SHA-256 `fileHash`, `canonicalKey` dedup, archive/original URLs, capture date, provenance, and a full researcher-asserted `biblio` block. `computeBiblioDerived()` derives retrieval date, relevant pages, usage counts, preservation status rather than storing them twice. | `public/db.js`, `public/ingest/pipeline.js` |
| Evidence immutable after hashing | **Built by construction.** Blobs are keyed by content hash (`blobs` store); annotations live on separate objects. | `public/db.js` `saveBlob()` |
| Claim Ledger, separate from evidence | **Built.** `claims` store with human-readable `CHR-CLAIM-NNN` ids and per-link `stance: supports \| contradicts`. Supporting/contradicting evidence already renders side by side. | `public/db.js`, `renderClaimsList()` |
| Claim *statuses* (UNVERIFIED…REFUTED) | **Missing.** A claim has links but no status field. | — |
| Questions / Gaps | **Partly built.** Outline lanes carry method/status/coverage; `computeGapWarnings()` flags low-coverage and answered-with-no-evidence lanes; Ask Sources' `handleUnresolvedIntent()`/`handleLeadsIntent()` aggregate past unresolved questions. | `public/app.js` |
| "Searches performed" attached to a question | **Missing.** `askSourcesHistory` logs the question and its fact state, not a structured record of which sources were checked over what date range. | — |
| "No record found" ≠ "never happened" | **Built, and stronger than requested.** Coverage Verdict (`found` / `provider-unavailable` / `no-captures-in-index` / `verified-gap`) plus `describeSearchCoverage()`, which already emits "No matches at: X. Unavailable right now (coverage unknown, not confirmed absent): Z. Not searched: …". | `src/index.js`, `public/app.js` |
| Fact vs. inference separation | **Built.** Five fact states (Confirmed / Computed / Investigative Lead / Unresolved / AI Analysis) classified by `classifyAskAnswer()` and rendered as `.fact-badge` pills. | `public/askCommands.js` |
| Auditability ("why does Chronium believe this?") | **Built.** Source → Evidence Item → Claim → Report is intact end to end, with provenance on every result and no AI in the report path. | throughout |
| Report generator | **Built, deterministic, free.** Assembles Question → Outline → Bibliography → Evidence → Findings → Gaps/Contradictions → Claims. | `renderReportPanel()` |
| Source reliability | **Weak.** `biblio.reliability` is a free-text researcher field. No tier vocabulary, no filtering or weighting. | `public/db.js` |
| Timeline | **Placeholder.** Renders a histogram of *source capture years* only. There are no timeline *events*, no per-entity filtering, no evidence links. Labelled "still on the roadmap" in its own UI copy. | `renderTimelinePanel()` |
| Entity model | **Missing — but the seam exists.** `normalizeRecord()` already declares `entities: []` (never populated), and the Sources facet bar ships disabled People/Organizations/Money/Dates/Topics tabs titled "Needs entity extraction — not built yet". | `src/schema.js:44`, `public/app.js:1126` |
| Relationship graph | **Missing entirely.** Zero non-vendor matches for `relationship` in the codebase. | — |
| Identity resolution | **Missing entirely.** | — |
| Network view | **Missing entirely.** Correctly deprioritized. | — |

### Architecture facts that constrain the plan

- **Storage is browser IndexedDB**, `DB_NAME='chronium'`, currently
  `DB_VERSION = 6`, 14 object stores. There is no server database. D1 is a
  documented *future* target (`docs/ARCHITECTURE.md` Phase B), not built.
  Every new store below is an additive `onupgradeneeded` branch — existing
  stores are never touched, so existing corpora survive the upgrade.
- **No build step, no framework.** Vanilla ES modules + one Cloudflare
  Worker. New code follows the existing file-per-concern pattern
  (`public/citations.js`, `public/discover.js`, …).
- **The Worker holds no business data.** It does archive-provider routing,
  link validation, capture proxying, and the two AI endpoints. Entities and
  relationships are client-side state and need no new API routes.
- **`npm run check` is the only test harness** — `node --check` syntax
  validation across 10 files. There is no unit-test runner, no linter, no
  build. "Run tests / lint / build" in practice means `npm run check` plus a
  live browser pass against `wrangler dev`.

---

## Part 2 — Blocker to resolve first

The working tree carries **uncommitted, browser-unverified work**: the Ask
Sources + Discover Sources feature (4 new `public/*.js` files, 6 modified
files, `DB_VERSION` 5→6). Per `docs/CLAUDE_HANDOFF.md` it is syntax-clean
and confirmed at the API level via `curl`, but two attempts to verify it in
a real browser failed — once from a premature kill, once from a genuine
stall.

Building the entity layer on top of that means a second `DB_VERSION` bump
and new UI stacked on code that has never been seen working. A regression
would be ambiguous between the two changes.

**Recommendation:** commit the Ask Sources work as a checkpoint before
starting Phase 1, whether or not it has been live-verified — the commit
message can say verification is pending. That way the entity layer starts
from a known, revertible baseline. Live verification can then happen in
parallel or after, and any breakage is attributable.

---

## Part 3 — Design decisions

### 3.1 Reuse existing vocabulary; do not create parallel ones

The request introduces several enums that overlap with shipped concepts.
Keeping both would let them drift and would violate CANON's rule against
silently converting one category into another.

| Requested | Decision |
|---|---|
| Relationship confidence: CONFIRMED / PROBABLE / POSSIBLE / DISPUTED / REFUTED / UNKNOWN | **Adopt as-is** for edges. It is genuinely a different axis from the five fact states (which classify *answers*, not *assertions*). Default is `UNKNOWN`, never `CONFIRMED`. |
| Claim statuses: UNVERIFIED / SUPPORTED / STRONGLY_SUPPORTED / CONFIRMED / CONTRADICTED / REFUTED | **Adopt, but researcher-set.** Chronium computes a *suggested* status from the existing supports/contradicts link counts and displays it as a Computed Fact, never writing it into the claim. Promotion to CONFIRMED or REFUTED is always a human action. |
| "No evidence located in sources searched" | **Do not reimplement.** Route through the existing `describeSearchCoverage()` / Coverage Verdict path so entity searches inherit the same honesty guarantees. |
| Source tiers 1–6 | **New `biblio.sourceTier` enum field**, alongside the existing free-text `reliability` (which stays — it is the researcher's own judgment, the tier is provenance). Tier is explicitly documented in the UI as describing *provenance, not truth*, and is never used to auto-downgrade or auto-reject evidence. |

### 3.2 Hard rules the code must enforce, not merely document

1. **An edge cannot be saved without at least one `evidenceItemId`.** This
   is a validation failure, not a warning. It is the single most important
   line of defence against the accusation-engine failure mode.
2. **Co-occurrence never creates an edge.** No code path may derive a
   relationship from two entities appearing in the same document. If an
   entity-suggestion feature is built later, its output is an
   *Investigative Lead* queue requiring explicit confirmation, and is
   stored separately from confirmed edges.
3. **Entity merging is never automatic.** Identity resolution produces a
   score and the signals behind it, and merging requires an explicit
   researcher action that records who merged what, when, and on what basis
   — reversibly.
4. **Absence stays absence.** An entity with no located records renders as
   "No evidence located in sources searched," never as a negative finding.

### 3.3 UI placement — one nav change

The workspace was deliberately simplified from 9 tabs to 4 (Research /
Evidence / Findings / Report) and the handoff treats that count as
load-bearing. Subjects and relationships do not fit cleanly under any
existing tab: they are neither evidence nor findings.

**Recommendation: one new top-level tab, `Subjects`,** giving
Research / **Subjects** / Evidence / Findings / Report. It holds the entity
list, the per-entity profile, the relationship editor, and later the
network view — matching the requested dashboard's SUBJECTS and
RELATIONSHIPS sections without scattering them.

*Alternative if the 4-tab count must hold:* Entities become a third
Evidence sub-toggle and relationships a sixth Findings sub-tab. This splits
one mental model across two tabs and is the weaker option.

CASE OVERVIEW from the requested dashboard is already the Research tab's
outline/roll-up; TIMELINE, EVIDENCE, CLAIMS, QUESTIONS/GAPS and REPORT all
have existing homes. No other nav changes are needed.

---

## Part 4 — Phase 1 implementation plan

Scope: **the entity and relationship data model, plus the minimum UI to
create and inspect it.** No timeline events, no identity resolution, no
tiers, no network view — those are Phases 2–4 below. Everything in Phase 1
is deterministic and free; no AI call is added anywhere.

### New files

| File | Purpose |
|---|---|
| `public/entities.js` | Entity/relationship vocabulary and pure logic: `ENTITY_TYPES`, `RELATIONSHIP_CONFIDENCE`, `RELATIONSHIP_TYPES`, `validateEdge()` (enforces the evidence requirement), `computeSuggestedClaimStatus(claim)`, `entityMentionsIn(record, entity)`. No DOM, no storage — testable by reading. |

Renderers live in `public/app.js` alongside the other panels, matching the
existing structure.

### Modified files

| File | Change |
|---|---|
| `public/db.js` | `DB_VERSION` 6→7. Three additive stores + CRUD exports (below). |
| `public/app.js` | `WORKSPACE_TABS` gains `subjects`; `renderSubjectsPanel()`, `renderEntityProfile()`, `renderRelationshipList()`, `renderEntityPicker()`; `refreshWorkspaceData()` loads entities/edges/mentions; `renderClaimsList()` shows the suggested-status Computed Fact line. |
| `public/index.html` | `#workspacePanel-subjects` panel, entity create/edit dialog, relationship create dialog. Semantic landmarks, labelled inputs, 44px targets, focus trap on the dialogs — same pattern as the existing `addResearch` dialog. |
| `public/styles.css` | `.entity-card`, `.entity-type-badge`, `.rel-edge`, `.rel-confidence-*`, `.entity-profile-*`. Confidence must be distinguishable without colour alone (text label + shape), 4.5:1 contrast, light and dark. |
| `package.json` | `check` script gains `public/entities.js`. |
| `docs/ROADMAP.md` | Phase 6 status → in progress, with what actually landed. |
| `docs/CLAUDE_HANDOFF.md` | Current-state rewrite at the end of the phase. |

### Schema (IndexedDB, `DB_VERSION` 7 — additive only)

```js
// entities
{ id, investigationId, type, displayName, aliases: [],
  attributes: {},            // free-form, researcher-entered, never inferred
  notes, createdAt, updatedAt }
// indexes: investigationId, [investigationId, type]

// entityMentions  — entity ↔ where it actually appears
{ id, investigationId, entityId,
  recordId, evidenceItemId,  // at least one required
  location, quotedName,      // the name exactly as written in the source
  createdAt }
// indexes: investigationId, entityId, recordId

// relationships  — the graph edges
{ id, investigationId, fromEntityId, toEntityId, type,
  confidence,                // CONFIRMED|PROBABLE|POSSIBLE|DISPUTED|REFUTED|UNKNOWN, default UNKNOWN
  startDate, endDate,        // nullable
  evidenceItemIds: [],       // NON-EMPTY — enforced in validateEdge()
  notes, createdAt, updatedAt }
// indexes: investigationId, fromEntityId, toEntityId
```

Plus one additive optional field on existing `claims`: `status` (nullable;
absent means UNVERIFIED), written only by explicit researcher action —
following the `excludedFromReport` precedent so old claims keep working.

`quotedName` on a mention is deliberate: it preserves "Marc Payne" as the
document actually spells it even when the mention is attached to a
`Raymond Payne` entity, so an identity collision stays visible in the
evidence rather than being normalised away. This is the field that would
have caught the Marc/Ray Payne error.

### No API changes

Everything is client-side. `src/index.js` is untouched in Phase 1.

### Verification

1. `npm run check` — must pass clean.
2. Live pass against `wrangler dev`, following the handoff's guidance
   (budget ~16–20s for anything that triggers Discover; drive Puppeteer
   directly rather than via a background agent):
   - Open an existing investigation with records already in it — confirm
     the DB upgrade 6→7 does not lose data, and that all four existing tabs
     still render.
   - Create two entities, link a mention to a real evidence item.
   - Attempt to save a relationship with no evidence — **must be rejected**.
   - Save one with evidence; confirm it renders at `UNKNOWN` confidence by
     default and that clicking through reaches the evidence.
   - Reload; confirm persistence.
   - Confirm the Report still generates unchanged.
   - Zero console errors; keyboard-only pass through both new dialogs.
3. Accessibility: axe-style manual check on the new panel and dialogs per
   the global WCAG 2.2 AA rules.

---

## Part 5 — Later phases (not in scope now)

- **Phase 2 — Timeline events.** Replace the capture-year histogram with a
  real `timelineEvents` store (date, precision, type, entityIds,
  evidenceItemIds), filterable by entity/type/date/source/confidence. Every
  event links back to evidence. Keep the histogram as a fallback when an
  investigation has no events yet.
- **Phase 3 — Questions with searches performed.** Extend outline lanes (or
  a new `questions` store) with attached search records: query, date range,
  sources checked, outcome — routed through `describeSearchCoverage()` so
  the outcome wording is the honest one by construction.
- **Phase 4 — Identity resolution + source tiers + report fact labels.**
  `IDENTITY MATCH SCORE` from explicit signals with the reasons shown;
  merge only on researcher confirmation, reversibly. `biblio.sourceTier`.
  Report sections labelled DOCUMENTED FACT / SUPPORTED INFERENCE /
  ALLEGATION / UNRESOLVED QUESTION / NO EVIDENCE LOCATED.
- **Phase 5 — Network view.** Only after the data is trustworthy. Clicking
  any edge reveals its supporting evidence.

---

## Phase 1: as-built (2026-09-08)

Shipped, live-verified in a real browser (21/21 assertions, zero console
errors — see `docs/CLAUDE_HANDOFF.md`), commit follows this doc. Scoped
tightly to the entity/relationship foundation per the user's explicit
instruction — no timeline events, no claims integration, no graph
visualization, no AI extraction, no report generation.

**Files added:** `public/entities.js` (pure vocabulary + validation, no
DOM/IndexedDB), `scripts/test-entities.mjs` (21 unit tests, plain
`node --test`, no new dependency).
**Files modified:** `public/db.js` (`DB_VERSION` 6→7, three new stores +
CRUD), `public/app.js` (Subjects tab UI), `public/index.html` (panel
markup + `icon-user`), `public/styles.css` (entity/alias/relationship
card styles), `public/ui.js` (see "Bugs found and fixed" below),
`package.json` (`check` + new `test:entities` script).

### Two deviations from the plan above

1. **Aliases are a real separate `entityAliases` store**, not the inline
   `aliases: []` array field sketched in Part 4's schema. Same
   join-don't-duplicate pattern already used for `evidenceItems`/`records`
   elsewhere in `db.js`; matches the CRUD shape (`addEntityAlias`/
   `listEntityAliases`) more naturally than a read-modify-write on the
   entity object would.
2. **`entityMentions` (the `quotedName`-preserving store described in
   Part 4, lines ~186-208 above) was NOT built.** It's genuinely valuable
   for a later phase (automatic entity-mention extraction, search-time
   collision warnings) but nothing in Phase 1's own test requirements
   needed it — the Marc/Raymond Payne regression test passes correctly
   with two plain separate entity records and independent evidence-backed
   relationships, no mention-tracking required. Deferred, not dropped;
   revisit when entity-mention extraction is actually being built.

### The hard rule, as actually enforced

`public/db.js` `createRelationship()`/`updateRelationship()` are the only
write path for the `relationships` store. Both: (1) validate shape via
`public/entities.js` `validateRelationshipFields()` — throws
`RelationshipEvidenceRequiredError` if `evidenceIds` is missing, not an
array, or empty; (2) inside the SAME IndexedDB transaction as the
eventual write, confirm every cited evidence id and both entity ids
actually exist in this investigation (`assertRelationshipReferencesExist`)
— throws `RelationshipValidationError` otherwise. Live-verified by calling
`createRelationship()` directly via a `page.evaluate(() => import('/db.js'))`
call that bypasses the UI entirely, exactly as instructed: empty array,
missing field, and a fabricated evidence id were all rejected, and
`listRelationshipsForEntity()` afterward confirmed zero of the three
attempts persisted anything.

### Two pre-existing bugs found and fixed (not scope creep — both directly blocked verifying Phase 1's own test requirements)

1. **`public/ui.js` `confirmDialog()` always resolved `false`, regardless
   of which button was clicked.** `finish(result)` called `close()`
   (which synchronously fires `openOverlay`'s `onClose: () => resolve(false)`)
   *before* calling `resolve(result)` — and a Promise only honors its
   first settle call, so the Confirm button's `resolve(true)` was always a
   no-op. This affected every confirm-gated destructive action in the
   app, including "Delete investigation" (both entry points), not just
   this session's new "Delete subject" — none of them had ever actually
   executed via their Confirm button. Fixed with an idempotent `settle()`
   guard so whichever call happens first (button click vs. Escape/backdrop)
   wins, instead of a fixed call-order assumption. Live-verified
   separately from the Phase 1 entity tests: Cancel confirmed to not
   delete, Confirm confirmed to actually delete, on the *existing*
   "Delete investigation" feature.
2. **`#workspaceKebabBtn` (the in-workspace "…" menu, home of
   `delete-active-investigation`) has no click handler wired up at all** —
   found while writing the regression check for bug #1 above, when that
   path turned out to be unreachable independent of the confirmDialog
   bug. **Not fixed — out of Phase 1 scope**, and the investigations-list
   page's per-card kebab menu (`data-kebab-toggle` + `delete-investigation`)
   is a working alternate path to the same feature, so this isn't a
   dead-end for users, just a broken shortcut. Flagged here for a
   separate, explicit fix decision.

### Verification summary

`npm run check` clean (11 files, `public/entities.js` added to the list).
`npm run test:entities` — 21/21 pass (pure validation logic: every
`ENTITY_TYPES`/`RELATIONSHIP_STATUSES` value, the evidence-required
rejection in its three shapes, self-relationship rejection, status/type
normalization, name-normalization non-collision). Live Puppeteer pass
against `wrangler dev` (viewport 1280×900, per the Ask Sources session's
own lesson about default-viewport nav collapse) — 21/21 assertions, zero
console/page errors, covering: DB migration 6→7 survives with all three
new stores present; Subjects tab loads; entity create + list +
name/alias search (`findEntities`, single search codepath now used by
both live-typing and tab re-entry — a consistency bug in the alias search
was found and fixed mid-session, see the code's own history); relationship
submit button disabled with zero evidence selected, enables on selection;
a valid evidence-backed relationship round-trips onto the profile view
with correct Outgoing/Incoming direction and confidence badge; the
direct-`db.js`-bypass rejection (§ above); the full Marc Payne/Raymond
Payne regression — search returns both, no merge, no relationship
transfer in either direction, confirmed from both entities' profiles
independently; alias addition doesn't merge or rename; entity deletion
doesn't corrupt unrelated entities or their relationships; Evidence/Report
tabs unaffected; full reload persistence.

### Deferred (explicitly, not silently dropped)

`entityMentions`/`quotedName` (see deviation #2 above); timeline events;
identity resolution/match scoring; source tiers; network view; cascading
relationship cleanup on entity delete (current behavior: relationships
pointing at a deleted entity render "Entity removed," the same convention
already used for a removed Evidence Item in the Claims panel — a
relationship is itself an evidence-backed record, so silently
cascade-deleting it because an entity got deleted would lose a receipt);
`deleteInvestigation()` cascading to entities/relationships/aliases (it
doesn't cascade to `evidenceItems`/`claims` either — pre-existing gap,
consistent with, not introduced by, this phase).

---

## Phase 2: as-built (2026-09-08)

Shipped, live-verified in a real browser (30/30 assertions, zero
unexpected console errors — one intentionally-aborted network request
from the test harness's own migration-seed technique, not an app defect;
see "Verification" below). Scoped tightly per explicit instruction: entity
mentions + evidence↔subject linking only. No network visualization,
timeline engine, identity scoring, source tiers, or AI extraction.

### Core distinction, as implemented

An Entity Mention records "this evidence item uses the exact string
`quotedName` to refer to entity `entityId`" — never a relationship, never
inferred from co-occurrence or from an alias. `createEntityMention()`/
`updateEntityMention()` (`public/db.js`) never call
`createRelationship()`/`updateRelationship()`, and cannot as currently
written — there is no code path between them. `quotedName` is preserved
exactly as entered (only outer whitespace trimmed) — never rewritten
toward the entity's canonical name, which is the specific property that
would have caught the real Marc/Ray Payne research error this project is
named after avoiding.

### Files modified (no new files this phase)

`public/entities.js` (`MentionValidationError`, `validateEntityMentionFields`
— shape validation only, mirrors `validateRelationshipFields`'s pattern),
`public/db.js` (`DB_VERSION` 7→8, `entityMentions` store + CRUD,
`deleteEntity()`/`deleteEvidenceItem()` extended to cascade-delete
mentions), `public/app.js` (Evidence tab: "Link Subject" button + Linked
Subjects chips; Subject profile: Evidence Mentions panel), `public/index.html`
(`#linkSubjectDialog`, Evidence Mentions panel markup), `public/styles.css`
(`.linked-subjects`, `.alias-chip a`), `scripts/test-entities.mjs` (9 new
unit tests for `validateEntityMentionFields`).

### Schema (IndexedDB, `DB_VERSION` 8 — additive only)

```js
// entityMentions
{ id, investigationId, entityId, evidenceId,
  quotedName, quotedNameNormalized,   // quotedName preserved EXACTLY (outer whitespace only trimmed)
  snippet, page, location, notes,     // all optional, default ''
  metadata: {}, createdAt, updatedAt }
// indexes: investigationId, entityId, evidenceId, quotedNameNormalized, updatedAt
```

Matches the plan's original Part 4 sketch in spirit; field names follow
the Phase 2 brief's literal spec (`evidenceId` singular, since a mention
cites exactly one evidence item, vs. `relationships`' plural `evidenceIds`
array).

### The enforcement rule, as actually enforced

Mirrors the Phase 1 Relationship pattern exactly, applied to a different
assertion: `validateEntityMentionFields` (shape — entity/evidence ids
present, `quotedName` non-empty) then `assertMentionReferencesExist`
(existence — both the entity and the evidence item are real, in this
investigation, checked inside the SAME IndexedDB transaction as the
eventual write). A direct-`db.js`-call bypass with a fabricated entity id,
a fabricated evidence id, an empty `quotedName`, or a missing `quotedName`
field is rejected in all four cases — verified live, not just by code
reading.

### Deletion / referential integrity, as decided and verified

| Action | Mention behavior | Verified |
|---|---|---|
| Delete an entity | Its mentions are cascade-deleted (same reasoning as aliases: a mention has no independent meaning once its entity is gone) | ✅ evidence item survives untouched |
| Delete an evidence item | Mentions citing it are cascade-deleted (a mention pointing at nothing is a true orphan, unlike a Claim/Relationship, which stays as the factual record itself) | ✅ entity survives untouched |
| Delete a mention directly | Touches only the `entityMentions` store — never the entity, never the evidence | ✅ both survive |
| Delete an alias | No effect on mentions — the two stores are unrelated by construction (a mention doesn't reference aliases at all) | ✅ mention survives |
| A relationship | Exists fully independently of mentions — zero mentions required, zero relationships required | ✅ confirmed both ways |

### Verification summary

`npm run check` clean. `npm run test:entities` — 30/30 pass (21 from
Phase 1 + 9 new mention-validation cases, including "quotedName survives
verbatim — never rewritten toward the entity's canonical name" as its own
named test). Live Puppeteer pass against `wrangler dev` — 30/30
assertions, zero unexpected console errors:

- **Migration v7→v8**: a genuine v7-shaped database was built with raw
  IndexedDB calls replicating Phase 1's exact schema (not just re-running
  today's code), seeded with a real investigation/entity/evidence
  item/relationship, then the actual app loaded for the first time in that
  browser profile — confirmed the upgrade to v8, the new `entityMentions`
  store present, and every seeded Phase 1 record intact afterward.
- **Link Subject flow**: Evidence tab → "Link Subject" → pick an entity →
  edit the quoted wording → save → chip appears on the evidence card,
  labeled with both the entity's name and the distinct quoted text (e.g.
  "Raymond Payne … as 'Ray Payne'") — never implying the two strings are
  the same by silently merging them in the display.
- **Payne identity-isolation regression** (§7): Evidence A ("Councilmember
  Marc Payne recused…") linked only to Marc Payne; Evidence B ("Ray Payne
  appeared before Council…") linked only to Raymond Payne with quotedName
  "Ray Payne" (deliberately alias-like, distinct from the entity's own
  name). Confirmed: Marc's profile shows only Evidence A, Raymond's shows
  only Evidence B; searching "Payne" still returns both; zero relationships
  exist between them at any point.
- **Same-document co-occurrence regression** (§8): one evidence item
  ("Raymond Payne and Sheena Tanner both provided public comment…") linked
  to both entities independently. Confirmed: both profiles show the shared
  evidence item; zero relationships were created between Raymond and
  Sheena as a result — co-occurrence produced two mention rows, nothing
  else.
- **Deletion/referential-integrity** (§9): all five scenarios in the table
  above, each created and verified via direct `db.js` calls in the same
  live browser session (not simulated).
- **Phase 1 regression pass** (§12): relationship-without-evidence still
  rejected, fabricated relationship-evidence-id still rejected, Ask
  Sources' bare-depth-phrase guard still holds, existing evidence still
  lists correctly, investigations/subjects survive reload, Delete Subject
  still works (the `confirmDialog()` fix from Phase 1 holds), Delete
  Investigation still works. `#workspaceKebabBtn` was deliberately left
  unfixed, per explicit instruction not to touch it this phase.

Driver scripts lived entirely in the scratchpad directory, never in the
repo.

### A test-harness technique worth recording

Two Puppeteer quirks were hit and worked around, neither an app defect:
`waitForSelector(..., { visible: true })` is unreliable specifically on
`<option>` elements and on freshly-opened popup-menu items in this
environment, even when the element demonstrably exists and is genuinely
visible (confirmed via direct `evaluate` inspection each time) — the fix
was to wait on the parent/container instead and act on the child directly
via `evaluate`, not to assume a real timeout meant a real bug. Also: to
seed a genuine lower-version IndexedDB database for a migration test,
the app's own script must be prevented from opening its own (current-version)
connection first — opening a lower version while a higher one is already
live cannot succeed and hangs indefinitely. Blocking the `app.js` network
request for one navigation (via `page.setRequestInterception`) gave a
real HTTP origin with IndexedDB access but no app connection yet, which
is what made the seed possible.

### Deferred (explicitly, not silently dropped)

Everything already deferred in Phase 1's own list, unchanged — timeline
events, identity-resolution scoring, source tiers, network view. Also:
`#workspaceKebabBtn`'s missing click handler (found in Phase 1, explicitly
told not to fix this phase either); a bulk `listMentionsForInvestigation()`
query (the Evidence tab currently does one `listMentionsForEvidence()`
call per evidence item via `Promise.all`, fine at this app's current
scale, matching the existing per-row query pattern used elsewhere, e.g.
`investigationCardHtml`'s per-card `listInvestigationRecords` call —
revisit only if a real investigation shows this is a bottleneck).
