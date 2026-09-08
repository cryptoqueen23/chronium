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

**Last updated:** 2026-09-08 (third update same day). **Entity Mentions +
Evidence↔Subject linking — Phase 2 of the case-file layer — is built and
live-verified**, per the user's explicit request after accepting Phase 1.
See "In progress this session: Entity Mentions" below. Uncommitted as of
this writing; the very next thing to commit (see "Where to look next").

Phase 1 (Investigation Entities / Subjects tab) is **done, live-verified,
and committed** as `8e525ac` ("feat: add evidence-backed investigation
entities") — accepted by the user as the clean baseline for Phase 2. Ask
Sources + Discover Sources is committed as `98509dc`. See those commits
and `docs/ROADMAP.md` Phase 6/Phase 5 for what each covers; this file no
longer carries their uncommitted-diff details since git history is the
source of truth for both now. `principle.md` (Chronium's product
constitution) is merged into `docs/CANON.md` as "Product Principles" —
read that section first, before the rest of CANON.md.

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
   a passage into cited Evidence, build Claims, build a **case file of
   Subjects, evidence-backed Relationships between them, and Entity
   Mentions pinpointing exactly where each subject appears in the
   evidence** (Phase 2, new this session — see below), and generate a
   deterministic (free) Evidence-Backed Report. AI is a paid, opt-in,
   last-resort layer (Qualitative Analysis synthesis only).
3. **Ask Sources** (including Discover Sources) — a conversational entry
   point over the same investigation state, source-first and
   deterministic-first. See commit `98509dc`.

Copperas Cove, TX is still the proof corpus, not a special case in the
code — no Copperas-Cove-specific logic outside `data/`.

## In progress this session: Entity Mentions (Evidence↔Subject linking) — uncommitted, live-verified 2026-09-08

The user's explicit ask, Phase 2 of `docs/INVESTIGATION_WORKSPACE_PLAN.md`,
following acceptance of Phase 1: answer "where, exactly, in the evidence
does this subject appear?" — distinct from a Relationship. Core principle
pasted verbatim: **"An ENTITY is not the same thing as an ENTITY MENTION
... quotedName must preserve the exact name/string from the source ...
Never rewrite source text to match the canonical entity name."** Explicit
non-negotiable: **"MENTIONED IN DOCUMENT != RELATIONSHIP BETWEEN ENTITIES"**
— two entities mentioned in the same evidence item, or an entity having an
alias, must never auto-create a relationship. Two permanent regression
tests were specified: the Marc Payne/Raymond Payne identity-isolation test
again (this time at the mention layer — evidence stays correctly isolated
per entity, no cross-contamination), and a NEW same-document/co-occurrence
test (Raymond Payne + Sheena Tanner mentioned in one evidence item — both
recorded as mentions, zero relationship implied).

Before writing code: re-read `docs/INVESTIGATION_WORKSPACE_PLAN.md` (Part
4's original `entityMentions` sketch, deferred in Phase 1's as-built
section — this is that deferred piece, now built), inspected commit
`8e525ac`, the evidence item shape (`public/db.js` `evidenceItems` store),
and the existing deletion semantics for entities/aliases/relationships.

**Scoped tightly per explicit instruction**: entity mentions + evidence↔
subject linking only. Explicitly NOT touched: network visualization,
timeline engine, identity scoring, source tiers, AI entity extraction —
linking is manual only this phase, by design ("we need the evidence model
correct before automation touches it"). `#workspaceKebabBtn` (found broken
in Phase 1) was explicitly NOT fixed, per instruction. See
`docs/INVESTIGATION_WORKSPACE_PLAN.md` "Phase 2: as-built" (appended this
session) for the complete as-built record — schema, deletion-semantics
table, and full verification detail. This handoff section is the
condensed pointer; that doc is the detailed record.

**Files touched (no new files this phase):**
```
 M public/entities.js       - MentionValidationError, validateEntityMentionFields
 M public/db.js              - DB_VERSION 7->8, entityMentions store + CRUD;
                                deleteEntity()/deleteEvidenceItem() extended to cascade mentions
 M public/app.js             - Evidence tab: Link Subject + Linked Subjects chips;
                                Subject profile: Evidence Mentions panel
 M public/index.html         - #linkSubjectDialog, Evidence Mentions panel markup
 M public/styles.css         - .linked-subjects, .alias-chip a
 M scripts/test-entities.mjs - +9 unit tests for validateEntityMentionFields (30 total)
```

**The core distinction, as implemented**: `createEntityMention()`/
`updateEntityMention()` (`public/db.js`) never call
`createRelationship()`/`updateRelationship()` — there is no code path
between them, structurally, not just by convention. `quotedName` is
preserved exactly as entered (only outer whitespace trimmed) — this is
the specific field that would have caught the real Marc/Ray Payne
research error the project is named after avoiding, and there's now a
named unit test asserting it survives verbatim.

**The hard rule, where it actually lives** (same shape as Phase 1's
Relationship rule, applied to a different assertion): `public/entities.js`
`validateEntityMentionFields()` checks shape (entity/evidence ids present,
`quotedName` non-empty) → `public/db.js`'s `assertMentionReferencesExist()`
checks existence (both the entity and evidence item are real, in this
investigation) inside the SAME transaction as the write. Verified by
calling `createEntityMention()` directly, bypassing the UI: a fabricated
entity id, a fabricated evidence id, an empty `quotedName`, and a missing
`quotedName` field were all rejected — zero mentions persisted from any of
the four attempts.

**Deletion/referential integrity, decided and verified** (full reasoning
in the plan doc's table): deleting an entity or an evidence item
cascade-deletes mentions that reference it (a mention has no independent
meaning once either side is gone — same logic as Phase 1's alias
cascade); deleting a mention directly never touches the entity or
evidence; deleting an alias never touches mentions (unrelated stores by
construction); a relationship exists fully independently of mentions in
both directions.

**A test-harness technique worth recording**: `waitForSelector(...,
{visible:true})` is unreliable specifically on `<option>` elements and on
freshly-opened popup-menu items in this environment, even when the
element demonstrably exists (confirmed via direct `evaluate` each time) —
wait on the container, act on the child via `evaluate` instead of
trusting the visibility check. Separately: to seed a genuine lower-version
IndexedDB database for a real migration test, the app's own script must
be prevented from opening its own (current-version) connection first, or
the seed's `indexedDB.open()` at the lower version hangs forever —
blocking the `app.js` network request for one navigation
(`page.setRequestInterception`) gives a real origin with IndexedDB access
but no app connection yet, which made a rigorous v7→v8 migration test
possible (see "VERIFIED" below).

**VERIFIED (live, Puppeteer against `wrangler dev`, viewport 1280×900):**
- `npm run check` clean. `npm run test:entities` 30/30 pass (21 from
  Phase 1 + 9 new).
- One Puppeteer run, 30/30 assertions, zero unexpected console errors (one
  intentionally-aborted network request from the migration-seed technique
  above, not an app defect):
  a genuine v7-shaped database (built with raw IndexedDB calls replicating
  Phase 1's exact schema, not just re-running today's code) seeded with
  real Phase 1 data, then the actual app's first load in that profile
  confirmed the v8 migration + `entityMentions` store + all seeded data
  intact → Link Subject flow end-to-end (Evidence card → dialog → Subject
  profile) → quotedName round-trips exactly, distinct from the entity's
  own name in the UI → **Marc/Raymond Payne mention-isolation regression**:
  each profile shows only its own evidence, zero cross-contamination →
  **Raymond/Sheena same-document regression**: one evidence item linked to
  both, zero relationships created as a result → direct-`db.js` bypass
  rejection (§ above) → all five deletion/referential-integrity scenarios
  → full **Phase 1 regression pass**: relationship-without-evidence still
  rejected, fabricated relationship-evidence-id still rejected, Ask
  Sources' bare-depth-phrase guard still holds, existing evidence still
  works, investigations/subjects survive reload, Delete Subject still
  works, Delete Investigation still works.

Driver scripts lived entirely in the scratchpad directory, never in the
repo.

**Still outstanding:**
- Not committed as of this writing — see "Where to look next."
- `docs/ROADMAP.md` Phase 6 and `docs/INVESTIGATION_WORKSPACE_PLAN.md`
  were updated this session to reflect the above.
- `#workspaceKebabBtn` (found in Phase 1) is still a real, known, unfixed
  issue — don't rediscover it from scratch next session.
- A bulk `listMentionsForInvestigation()` query doesn't exist — the
  Evidence tab does one `listMentionsForEvidence()` call per item via
  `Promise.all`, fine at current scale, matching the existing per-row
  query pattern used elsewhere in this app. Revisit only if a real
  investigation shows this is a bottleneck.

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

**Immediate:** commit the Entity Mentions diff (see "In progress this
session" above) — it is live-verified and has been sitting uncommitted
since being built. Suggested message per the user's own instruction:
`feat: link subjects to evidence mentions`.

**Then STOP.** The user's own instruction for this phase was explicit:
*"Do NOT begin Phase 3. Stop after the commit and hand Phase 2 back for
review."* Do not self-direct into what's left of
`docs/INVESTIGATION_WORKSPACE_PLAN.md`'s later phases — timeline events,
identity-resolution scoring/source tiers, or network view — or any other
roadmap item, including the still-open, explicitly-flagged
`#workspaceKebabBtn` bug, without being asked. Report back what was
built and wait. (Note: the plan doc's original Part 5 sketch numbered
timeline events as "Phase 2" before this session's actual Phase 2 request
turned out to be entity mentions instead — treat the plan doc's own
"Phase 1: as-built" / "Phase 2: as-built" sections, and whatever number
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
