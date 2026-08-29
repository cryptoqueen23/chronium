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

**Last updated:** 2026-08-29, end of session. Everything below reflects
what's actually shipped, not aspiration. Nothing this session touches
`git push` — check `git status`/`git log` before assuming anything is on
`origin/main`.

## What Chronium Mind actually is right now

Two things, merged into one engine — unchanged from the previous handoff:

1. A federated **historical web search** (Arquivo.pt, Wayback CDX, Common
   Crawl, Memento) with cross-archive dedup, capture-reachability
   validation, an in-app **Archive Viewer**, and a **Coverage Verdict** on
   every connector result (found / provider-unavailable /
   no-captures-in-index / verified-gap).
2. An **Investigation Workspace** — upload/search your own documents, turn
   a passage into cited Evidence, build Claims, and generate a
   deterministic (free) Evidence-Backed Report. AI is a paid, opt-in,
   last-resort layer (Qualitative Analysis synthesis only).

Copperas Cove, TX is still the proof corpus, not a special case in the
code — no Copperas-Cove-specific logic outside `data/`.

## This session's work: Research Outline + Detailed Bibliography + Findings/Report

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

`docs/ROADMAP.md` Phase 1 is now fully done including this session's
work. Phase 2 (Evidence Vault) and Phase 3 (Compare Engine) are next per
CANON.md's Build Priority — **do not start either without being
explicitly asked**, same rule as last session.

## Product language

Chronium Mind — **Search the Internet through time.**
Secondary: **Your gateway to the Internet's memory.**

Research screens must stay credible for journalism, legal/evidence
research, academic work, education, and business intelligence.
