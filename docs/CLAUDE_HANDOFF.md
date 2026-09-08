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

**Last updated:** 2026-09-08. **Ask Sources + Discover Sources is now live-
verified end-to-end in a real browser** (see "Live verification: what
actually happened, 2026-09-08" below) — this closes out the "mid-flight"
status from the 2026-08-31 handoff. Everything under "In progress this
session" is still uncommitted working-tree changes as of this writing;
commit it before starting any new feature on top (see "Where to look
next"). Everything below through "AI-assisted analysis: confirmed working"
reflects the previous session, committed as `8b22ea5` ("feat: complete
evidence-backed research methodology workflow") and pushed to
`origin/main`.

**Also new this session:** `principle.md` (repo root) was added upstream
by the user as Chronium's product constitution and merged into
`docs/CANON.md` as a new top "Product Principles" section that explicitly
**supersedes the rest of CANON.md on conflict**. Read that section first,
before the rest of CANON.md — it's 22 numbered principles plus a handful
of one-line rules. One real conflict was found and fixed this session
(see "Follow-up context" below); the rest of Ask Sources was already
broadly aligned since it was designed independently toward the same
"source-first, AI-last-resort, never lose the receipt" ideas.

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

A third capability, **Ask Sources** (including Discover Sources), is
written and **now live-verified in a real browser** — see "Live
verification: what actually happened, 2026-09-08" below for exactly what
was tested. Still uncommitted.

## In progress this session: Ask Sources (uncommitted, syntax-checked, live-verified 2026-09-08)

The user's ask, across several messages: (1) the Research tab's search
box should be a genuinely conversational **"Ask Sources"** entry point,
not an "AI chat" — source-first and deterministic-first; (2) it should
also be the single place to *produce* every research artifact from that
same research state ("Research once, reuse everywhere"); (3) after
`principle.md` landed as the binding product constitution
(`docs/CANON.md` "Product Principles"), four more things explicitly:
first-class **Investigative Lead**/**Unresolved** finding states,
**Adaptive Research Depth** (Quick/Explain/Research/Professional - same
evidence, different presentation), a proper **citation/footnote engine**,
and everything testable conversationally through Ask Sources, not forms.
This is Roadmap Phase 5 ("Research Agent") plus all of the above, done
together because the user asked for it explicitly across this session
(not self-directed scope increase - see the previous handoff's note
about not self-directing into new phases; this session's asks override
that for Ask Sources specifically).

Full original design is in the approved plan file this session used
(`tranquil-shimmying-teapot.md` in Claude Code's plan history) — this
section is the condensed, updated as-built version covering everything
built since, including the post-principle.md additions.

**Files touched** (`git status --short` right now):
```
 M docs/CANON.md         - merged principle.md as "Product Principles" (supersedes on conflict)
 M docs/CLAUDE_HANDOFF.md - this file
 M package.json           - `check` script covers all 4 new public/*.js files
 M public/app.js          - Ask Sources core, Discover Sources, fact-state labels, adaptive depth, footnotes
 M public/db.js           - DB_VERSION 5->6, askSourcesHistory store (+factState), updateClaim()
 M public/index.html      - Research tab hero reworked into Ask Sources, My Sources/Discovered sections
 M public/styles.css      - .ask-sources-*, .fact-badge-*, .biblio-cite, .depth-explain
 M src/index.js           - POST /api/analyze/ask-sources (mirrors qualitative), follow-up context
?? public/artifacts.js    - new: deterministic table artifact renderers
?? public/askCommands.js  - new: command router, fact-state classifier, depth parser
?? public/citations.js    - new: APA/MLA/Chicago/Turabian/legal citations + footnotes
?? public/discover.js     - new: provider-neutral Discover Sources seam over /api/search
```
`principle.md` itself is committed upstream (pulled via fast-forward,
commits `4262054`/`bb2a435`/`0ed5225`/`546750e` on `origin/main`) - not
part of this session's uncommitted diff. No commit of the diff above has
been made.

**Deterministic core** (`public/app.js` `runAskSourcesQuestion`,
`public/askCommands.js` `parseAskSourcesCommand`): a typed question is
parsed by a fixed, keyword/regex rule table (no NLU, no AI) into one of
`search` / `create` / `add-to` / `exclude-from-report` / `clarify-table`
/ `leads` / `unresolved`. Plain search reuses the existing
`searchInvestigation()` (`public/db.js`) and `resultRow()`
(`public/app.js`) — the Source Fact layer. `computeDeterministicFact()`
adds a Computed Fact line for count/earliest/latest questions. Zero
matches states insufficiency plainly, never invents an answer.

**Follow-up context (Principle #1 fix)**: Ask Sources was originally
built single-turn/stateless per an earlier explicit decision in this
same session - `principle.md` then required "follow-up questions must
understand the context of the conversation," which is a real conflict
("this document wins" per the user). Fixed narrowly, not with full chat
memory: `previousAskQuestion`/`previousAskAiAnswer` hold exactly one
prior turn; if a question alone matches nothing, `searchInvestigation()`
is retried once with the previous+current question's terms combined
(still deterministic, no AI); the AI endpoint optionally receives
`previousQuestion`/`previousAnswer` purely to resolve pronouns like "why
did it change," and its system prompt explicitly forbids treating the
previous answer as evidence for the new one.

**Five fact states (Principle #11)**: `classifyAskAnswer()`
(`askCommands.js`) labels every answer Confirmed Fact / Computed Fact /
Investigative Lead / Unresolved / AI Analysis - rendered as a
`.fact-badge` pill on the provenance line, on the AI answer card, and in
the history log. Rule: passages matched -> confirmed; sources matched by
metadata only, no passage -> lead; nothing matched, or AI says
`insufficient` -> unresolved; a real (non-insufficient) AI answer ->
ai-analysis. `docs/CANON.md` Evidence Rules section was updated to the
same 5 categories (was 3) so the two don't drift apart.

**Leads/Unresolved as commands, feeding Gaps**: "what should I
investigate next?" -> `handleLeadsIntent()` (least-covered outline
lanes first, deterministically sorted, plus past questions whose
`factState` was `lead`); "what don't we know?" -> `handleUnresolvedIntent()`
(existing `computeGapWarnings()` output plus past `unresolved` questions).
Both read `askSourcesHistory` (now carries `factState` per entry) so
today's questions become tomorrow's aggregated leads/gaps automatically,
per Principle #11's "must automatically feed Gaps."

**Adaptive Research Depth (Principle #21)**: `parseDepthRequest()`
detects quick/explain/research(default)/professional from phrasing.
Critically this is **one result set, one render path**
(`renderAskSourcesResultsAtDepth()`), not four engines - depth only
changes how much of `results` is shown and whether a Footnotes block is
appended; "explain" never paraphrases source text (that would risk
misquoting - only hides technical clutter via a `.depth-explain` CSS
rule). A pure re-presentation request ("now give me the professional
version") re-renders `lastAskResults` with **no new search or AI call** -
verified by an `isRepresentOnly` heuristic in `parseDepthRequest`. Found
and fixed a real bug here during implementation: a *contextless* bare
depth phrase ("explain it simply" as the very first message) would have
had its filler words survive `extractSearchTerms`'s stopword-stripping
fallback and get sent to `searchInvestigation()` as literal substring
terms - "it" alone would match nearly every record. Fixed by adding
pronouns to the stopword list AND adding an explicit `isBareDepthPhrase`
guard in `runAskSourcesQuestion` that short-circuits to zero results
instead of ever running that search. **This exact scenario is priority
test (j) in the live-verification pass currently running (see below) -
confirm it actually holds in a real browser, not just by code reading.**

**Citations/Footnotes (Principle #14)**: `public/citations.js`
`formatCitation(record, style, location?)` (APA/MLA/Chicago/Turabian/
legal, real stored metadata only, each style's own "no date" convention
for missing fields, optional page/passage locator appended) and
`buildFootnotes(records, style, locationOf?)` (first-appearance-order,
deduped). Wired into: a "Cite" control on every Bibliography card, the
Ask Sources "cite this" command, and an automatic Footnotes block
appended under results at `professional` depth.

**Create menu / artifacts**: "Save Evidence · Add to… ▾" and "Create… ▾"
dropdowns (reusing the existing `openMenu`/`.menu-wrap` pattern) sit
under the answer, driven by the same intent vocabulary the typed-command
parser produces (`ADD_TO_TARGETS`/`CREATE_TARGETS` in `askCommands.js`).
Source Index, Evidence Table, Claim/Evidence Matrix, and Quantitative
Table are pure renderers in `public/artifacts.js`, always computed live
from already-loaded state (no new storage - "research once, reuse
everywhere" is true by construction, nothing to go stale).

**Living-artifact mutations** (narrow, deterministic, always echoed back
in `#askSourcesStatus`, never silent): "Add to Evidence/Outline/Findings/
Report" and "remove this from the report" call existing mutation
functions or a new `updateClaim(claimId, {excludedFromReport})` - the
Report's Claims section now filters on that flag while the claim stays
fully visible in Findings > Claims (also given a manual Include/Exclude
toggle there, not just via Ask Sources commands).

**Q&A history**: `askSourcesHistory` IndexedDB store (`DB_VERSION` 5→6),
one row per question including its `factState`, rendered as a
reverse-chronological `<details>` list under the answer area.

**Discover Sources (added after the above, per explicit follow-up asks -
"do not hard-wire Ask Sources to /api/search as though it represented
all external research"):**
- `public/discover.js` exports `discoverSources(query, {limit})` - the
  ONLY thing Ask Sources calls to search outward. It wraps `/api/search`
  today (which already aggregates Arquivo.pt full-text, the bundled
  Copperas Cove reference corpus, and, in URL mode, Wayback/Common
  Crawl), but adding a future provider means changing this file (or the
  server-side `ARCHIVE_PROVIDERS` list it delegates to) - never
  `public/app.js` or `public/askCommands.js`. Also exports
  `summarizeDiscoverCoverage(connectors)` (found/no-match/unavailable
  buckets), reused for both the "Discovered via..." note and the
  Unresolved coverage message.
- `runAskSourcesQuestion()`'s plain-search branch now runs
  `searchInvestigation()` (My Sources) first, then `discoverSources()`
  (Discover Sources) - rendered as two visually distinct sections
  (`#askMySourcesHeading`+`#investigationSearchResults`, then
  `#askSourcesDiscover`). Discover results are deduped against
  `savedKeys`/My-Sources canonical keys (a source already saved never
  shows up twice), and sorted with a light, honest `authorityRank()`
  heuristic (`.gov`/`.mil` domains and archive-connector captures before
  everything else - never a fabricated reliability score).
- **Discovery is never "Confirmed"** - `classifyAskAnswer()` caps a
  Discover-only result at `lead` (Investigative Lead), never
  `confirmed`, per the explicit product rule that search-result metadata
  is discovery, not evidence, until reviewed. But a discovered result
  WITH real retrieved content (a connector's own full-text snippet) is
  immediately usable - `passageTextOf(r)` (`= matchPassageRaw ||
  matchPassage || snippet`) is now the uniform accessor used everywhere
  passages are read (AI-analysis passage builder, footnotes, the
  Analyze-with-AI enable/disable check) so a discovered-but-unsaved
  source never has to be saved first just to be asked about, cited, or
  AI-analyzed. Saving it into the investigation is a separate, explicit
  one-click action: `.save-discover-evidence-btn` (new, only rendered on
  a Discover row with real snippet content) atomically calls
  `saveRecordToInvestigation` then `createEvidenceItem` against the
  *real* new record id, so an Evidence Item's `sourceRecordId` is never
  left pointing at nothing.
- **Unresolved now names coverage**: `describeSearchCoverage()`
  (`public/app.js`) turns the zero-results case into "Searched: your
  sources. No matches at: X, Y. Unavailable right now (coverage unknown,
  not confirmed absent): Z. Not searched: Wayback/Common Crawl only
  search by URL, not topic." - never a bare "no results," per the
  explicit product requirement and CANON's existing "Never Fake
  Coverage" rule.
- Bug found and fixed mid-implementation (before any live test): the
  depth re-presentation path (`renderAskSourcesResultsAtDepth`) was
  about to treat `lastAskResults` (now a My-Sources+Discover *merge*) as
  if it were all My-Sources rows when re-rendering at a new depth -
  wrong section, wrong action buttons. Fixed by tracking
  `lastAskMyResults`/`lastAskDiscoverResults`/`lastAskDiscoverConnectors`
  as separate module state alongside the merged `lastAskResults`, and
  changing `renderAskSourcesResultsAtDepth`'s signature to take both
  arrays explicitly.

**VERIFIED (concretely, not just by code review):**
- `npm run check` passes clean - all 4 new `public/*.js` files plus
  everything else, repeatedly re-run through the session.
- `POST /api/analyze/ask-sources`: raw `curl` confirmed the
  deterministic-skip response with zero passages, and that it reaches
  the real AI-provider call path with one passage (fails gracefully -
  expected locally, no `.dev.vars`/`ANTHROPIC_API_KEY` in this repo,
  same documented limitation as Qualitative Analysis).
- `GET /api/search` (what `discoverSources()` calls): raw `curl` timed
  at **exactly 16.4s**, HTTP 200, clean JSON:
  `{"query":"copperas cove water debt","mode":"topic","tookMs":16186,
  "total":0,"connectors":[{"source":"Arquivo.pt",...,"error":"The
  operation was aborted",...,"verdict":"provider-unavailable"},
  {"source":"Copperas Cove Investigation Corpus",...,"verdict":
  "no-captures-in-index"}],"results":[]}`. This proves two things at
  once: (1) the backend is not hung/broken - it fails a specific,
  unreachable external connector (Arquivo.pt) correctly and reports it
  as `provider-unavailable`, never a false "nothing archived"; (2) **any
  Ask Sources question that triggers Discover Sources costs ~16-20s in
  this specific sandboxed dev environment**, because it has no real path
  to the live internet - this is an environment limitation, not a code
  bug, but it makes browser-driven testing of Discover-triggering
  questions slow, and matters for how the next session should scope a
  live test (see below).

**VERIFIED IN A REAL BROWSER, 2026-09-08** (this closes out the two failed
attempts documented below the line further down, kept for the record).
Driven with Puppeteer directly via Bash (not a background agent - the prior
session's own recommendation), against the `wrangler dev` instance already
running on `:8787`, viewport 1280×900 (a smaller/default viewport collapses
the sidebar nav into a hidden duplicate and produces false click failures -
not an app bug, a driver-script gotcha worth recording). Two runs, 25
assertions total, all passing, zero console/page errors across both:

- **Run A** (deterministic paths, no Discover): app loads → create
  investigation → ingest a real `.txt` fixture (a synthetic council-minutes
  excerpt, never committed) → **priority test (j)**, a bare depth phrase
  ("explain it simply") as the very first message, confirmed to short-
  circuit to zero results with an `Unresolved` badge instead of the
  literal-"it"-substring-match bug the previous session found and fixed -
  **this was the single most important thing to confirm and it holds** →
  a real question against the ingested passage renders with a `Confirmed
  Fact` badge and the actual matched text → "now give me the professional
  version" re-presents the same results in 8ms (confirmed no new
  search/AI call, per Adaptive Research Depth's design) with a Footnotes
  block appended → Ask history logs both turns → reload persists the
  investigation and history → Evidence/Findings/Report tabs still render
  (regression check against everything from the previous milestone).
- **Run B** (Discover Sources + mutations + leads/unresolved): a
  Discover-triggering question took 16.5s (matches the previously measured
  Arquivo.pt timeout almost exactly) and returned a `Confirmed Fact` from
  My Sources while Discover legitimately found nothing for that query →
  all four inline "Create" artifacts rendered real content (Source Index,
  Evidence Table, Citations, Claim/Evidence Matrix - correctly showing
  "No claims yet." where true, never fabricated rows) → "Add to Evidence"
  saved a real Evidence Item, independently confirmed present in the
  Evidence tab afterward → "what should I investigate next?" and "what
  don't we know?" were re-tested against an investigation with seeded
  outline lanes (a first pass under-tested this and produced a false
  "empty" read from a too-short text assertion, not an app bug -
  corrected in the second pass) and both rendered correctly: leads sorted
  weakest-coverage-first with the right `Investigative Lead` badge,
  unresolved listed the same lanes as "no evidence linked yet" with the
  right `Unresolved` badge and the CANON #12 framing text → Report tab
  still generates.
- The `create` intent's `outline`/`bibliography`/`timeline`/
  `findings-summary`/`gaps`/`report` targets are **navigation, not inline
  artifacts** (`NAV` map, `handleCreateIntent`, `public/app.js`) - by
  design, confirmed by reading the code after a test run flagged an empty
  artifact div for `outline` as a false failure.
- Not exercised this pass: the AI endpoint (`askRunAiBtn` - no
  `ANTHROPIC_API_KEY`/`.dev.vars` in this local `wrangler dev`, same
  documented limitation as every prior AI check in this file; would need
  `wrangler dev --remote` as the previous "AI-assisted analysis" section
  did), citation-style switching beyond the default, and the compound
  cross-artifact follow-up scenario from the original ~12-step design (not
  needed to clear the "does it actually render" bar this pass was set to
  clear).

Driver scripts lived entirely in the scratchpad directory
(`C:\Users\insur\AppData\Local\Temp\claude\...\scratchpad\`), never in the
repo - `git status` was clean of stray files throughout and after.

**Still outstanding:**
- `docs/ROADMAP.md` Phase 5 status line not yet updated to reflect the
  above - do that alongside committing this work.
- No commit has been made yet as of this writing - see "Where to look
  next".
- The AI-analysis path within Ask Sources (`/api/analyze/ask-sources`)
  is confirmed reachable via `curl` (previous session) but not re-driven
  through the browser this session - lower risk than the rest since it
  reuses the same request path as the already-browser-confirmed
  Qualitative Analysis feature, but worth a quick pass with
  `wrangler dev --remote` before calling Ask Sources fully closed out.
- Gaps/Leads aggregation only looks at `askSourcesHistory` entries
  created via Ask Sources itself - metadata-only search hits from a
  single turn aren't separately persisted as standalone "lead" records,
  only as history rows. Fine for the current scope; revisit only if a
  real investigation shows this is insufficient.

---

### Live verification: what went wrong twice before (2026-08-31, kept for the record)

1. First attempt: a background agent was dispatched to install
   Puppeteer (`npm install --no-save puppeteer` + `node
   node_modules/puppeteer/install.mjs` directly, since this repo's
   `allowScripts` gate blocks the normal postinstall Chromium download -
   this workaround is proven and reusable) and drive a ~12-step version
   of the full loop. It was killed by Claude at the ~3-hour mark on the
   assumption it was stuck - **this was a mistake**: its final message
   showed it had actually finished. Root cause of the 3 hours: almost
   certainly the ~16-20s Arquivo.pt timeout, multiplied across roughly
   10 Discover-triggering questions in that script, not a hang.
2. Second attempt: a trimmed version genuinely stalled under the
   platform's 600s watchdog. Cause not investigated further.
3. A third attempt was set up but never run before the session ended.

**What fixed it this time:** far fewer Discover-triggering questions per
run (1 per run, not ~10), driving Puppeteer directly via Bash with an
explicit `waitForFunction` on the answer actually appearing (not a fixed
sleep) so the real ~16s wait was never mistaken for a hang, and a correct
1280×900 viewport.

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

**Immediate:** commit the Ask Sources + Discover Sources diff — it is now
live-verified (see above) and has been sitting uncommitted since
2026-08-31. Update `docs/ROADMAP.md` Phase 5 status and fold the Ask
Sources summary into "What Chronium Mind actually is right now" as part
of that commit, not as a follow-up.

**Explicitly requested next, once that's committed:** the user has asked
for Chronium to grow a **case-file / entity-relationship layer** — subjects
(people, organizations, government bodies, contracts, etc.), a
relationship graph with confidence states (never auto-inferred from
co-occurrence, never auto-confirmed), timeline events, identity resolution
requiring researcher confirmation before merging, source-reliability tiers,
and a report generator that separates documented fact from inference. This
is real, explicit scope — it overrides the previous session's "don't
self-direct beyond Ask Sources" note for this specific area. A full audit
of what's already built toward this (more than expected — Evidence Ledger,
Claim Ledger, Coverage Verdict, and the five fact states already cover
several of the requested pieces) plus a phased implementation plan is in
`docs/INVESTIGATION_WORKSPACE_PLAN.md` — read that before writing any
entity/relationship code. Two decisions already made there, confirmed with
the user: relationships require at least one evidence item to save (hard
validation, not a warning), and Subjects gets its own 5th top-level
workspace tab (Research / Subjects / Evidence / Findings / Report) rather
than being squeezed into existing sub-tabs.

Beyond that: the user has said further priorities will come from running a
real-world Chronium investigation through the workflow, not speculative
feature expansion. Still don't self-direct into Phase 2 (Evidence Vault),
Phase 3 (Compare Engine), or other roadmap items beyond what's explicitly
scoped above.

## Product language

Chronium Mind — **Search the Internet through time.**
Secondary: **Your gateway to the Internet's memory.**

Research screens must stay credible for journalism, legal/evidence
research, academic work, education, and business intelligence.
