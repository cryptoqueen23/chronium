# Claude Handoff — Chronium Mind

You are working on **Chronium Mind**, a historical-web and public-record
intelligence aggregator. This file is the current-state handoff — it is
rewritten each time a session ends with meaningful progress, not an
append-only log. If you're picking this up cold, read this file, then
`docs/CANON.md` (mission, evidence rules, storage/cost principles, and
every `CANON RULE` — these are load-bearing, not decoration), then
`docs/ROADMAP.md` (phase status), then skim `src/index.js` and
`public/app.js`.

**Last updated:** 2026-08-28, end of session. Everything below reflects
what's actually shipped and pushed to `origin/main`, not aspiration.

## What Chronium Mind actually is right now

Two things, merged into one engine, exactly as the original handoff
intended — this part of the plan held up:

1. A federated **historical web search** (Arquivo.pt full-text, Wayback
   Machine CDX, Common Crawl, a Memento aggregator) with cross-archive
   dedup, capture-reachability validation, and an in-app **Archive
   Viewer** so a result opens as a rendered page inside Chronium, not a
   raw archive URL that might force a download.
2. An **Investigation Workspace** — upload/search your own documents,
   turn a passage into cited Evidence, build Claims, and generate a
   deterministic (free) Evidence-Backed Report. AI is a paid, opt-in,
   last-resort layer on top (Qualitative Analysis only), never a
   dependency of the core loop.

Copperas Cove, TX (`data/copperas-cove/normalized.json`, ~3,200 real
government records with Wayback provenance) is still the proof corpus,
not a special case in the code. If you find yourself writing
Copperas-Cove-specific logic anywhere outside `data/`, stop — that breaks
the generic-core principle in `docs/CANON.md`.

## The core loop, and where it stands

```
SEARCH → FIND RECEIPT (exact passage + page) → SAVE EVIDENCE → FINDING → REPORT
```

This is the thing that matters most and it works end-to-end today,
verified live (Puppeteer, real multi-page PDFs, zero console errors):
upload a document → search a term → get the actual matched passage (not a
stale upload-time snippet) with the source page number → open the source
at that page → one-click "Save as Evidence" (excerpt + page/location +
source + provenance auto-carried over, no retyping) → link evidence to a
Claim → deterministic Report shows the claim with its exact evidence and
citation.

**Investigation Workspace navigation (as of this session):** 4 primary
sections, not 9 — **Research | Evidence | Findings | Report**. Findings
has 5 sub-tabs: Claims, Timeline, Contradictions, Gaps, Analysis. This
was a deliberate simplification (see CANON.md-adjacent commit
`132844a`) — a first-time user shouldn't need to understand "Outline" or
"coverage lanes" vocabulary before they can upload a PDF and search it.
Nothing was deleted; Outline's research-question field moved to
Findings→Analysis (its only consumer), coverage lanes moved to
Findings→Gaps (same reasoning), Sources/dashboard-stats moved into
Research under a collapsed "Uploaded files & sources" disclosure.

## What's shipped, concretely (this session, in commit order)

1. **Passage-aware search + PDF page tracking.** `PdfAdapter`
   (`public/ingest/adapters.js`) now records per-page character offsets
   during extraction. `searchInvestigation` (`public/db.js`) returns the
   actual text around a match plus the page number, not a static
   first-450-chars snippet.
2. **CANON "Backup-to-the-Backup Reliability."** Archives are a redundant
   pool, not independent buttons — `groupSamePage` orders alternate
   captures by provider preference, `/api/check-link` validates and
   caches resolutions, a dead primary capture falls back through
   alternates automatically before ever showing failure.
3. **Archive Viewer.** Clicking "View archived page" renders the capture
   *inside* Chronium (`/api/view-capture`, `src/index.js`) — sandboxed
   iframe for HTML, native PDF viewer, formatted text/JSON/XML/CSV panel
   — instead of navigating to a URL that might force a download. Handles
   the pywb toolbar-wrapper problem (Arquivo.pt/Wayback both wrap replay
   pages in a frameset; the real content is a static nested `<iframe>` at
   a `mp_`/`if_`-modified URL) by fetching the direct-content variant for
   HTML only, not for PDFs/images (that modifier is HTML-specific).
4. **Coverage Verdict.** CANON "Never Confuse Absence of Evidence With
   Evidence of Absence." Every connector result now carries a `verdict`:
   `found`, `provider-unavailable` (coverage unknown, never shown as
   "nothing archived"), `no-captures-in-index` (this query matched
   nothing), or `verified-gap` (cross-checked two independent ways).
   `searchWayback` cross-checks a zero-result CDX query against the
   Wayback Availability API before ever calling something a gap.
5. **Investigation Workspace IA simplification** (described above).

## Known gaps / things the next session should verify or watch

- **`web.archive.org`'s CDX search endpoint was unreliable this session**
  — repeatedly timed out from this dev environment (while
  `archive.org/wayback/available`, a separate API surface, stayed fast).
  This may be environment-specific network flakiness or a real upstream
  issue; Coverage Verdict correctly reports it as `provider-unavailable`
  either way, but if search results for Wayback still look thin, check
  `/api/health/connectors` before assuming it's a real coverage gap.
- **Archive Viewer's PDF-in-iframe path is implemented and code-reviewed
  but not verified live end-to-end in a browser** — the HTML render path
  *was* verified live (real Arquivo.pt capture, real title/content
  rendered). PDF verification was blocked by the same CDX/replay-host
  flakiness above when trying to fetch a real archived PDF. Worth an
  explicit test with a working network path before relying on it.
- **"+ Add Web Source" and "+ Add Files"** (Research tab) both open the
  same combined Add-Research dialog (it already has both a URL form and a
  file-drop zone) — this was a deliberate reuse, not an oversight, but if
  the product direction wants genuinely separate flows later, that's a
  real gap.
- **Common Crawl connector only searches the 3 most recent monthly
  indexes** by design (documented MVP scope in its own `note` field, see
  `src/index.js`) — it will never surface older Common Crawl coverage
  even though CC has indexes back to 2008. Not a bug; a known scope
  limit worth revisiting if deeper historical coverage becomes a
  priority.
- Three commits from this session (`593adbd` investigation P0 + Archive
  Viewer, `a8ac226` pywb modifier fix, `46d551c` Coverage Verdict,
  `132844a` workspace IA) are all pushed to `origin/main`. Nothing is
  sitting local-only as of this handoff.

## Development constraints (still true, unchanged)

- Bootstrap / free-tier-first. Cloudflare-friendly. Avoid paid APIs
  beyond the one opt-in AI provider call.
- No unnecessary framework migration — this is still vanilla JS + one
  Cloudflare Worker, no build step, no framework. Keep it that way unless
  there's a concrete reason.
- Preserve working code where reasonable; consolidate UX, don't delete
  functionality wholesale.
- Responsive and accessible UI (WCAG 2.2 AA — see the user's global
  CLAUDE.md rules, which apply to every project including this one).
- Data-driven generic rendering — no Copperas-Cove-specific logic outside
  `data/`.
- Source provenance is mandatory, on every result, always.
- Never call an AI inference a source fact — see CANON.md's Evidence
  Rules (Source Fact / Computed Fact / AI Analysis).
- AI is a last resort behind cache → deterministic code → index/search →
  rules (CANON RULE "AI/Agents Are Last Resort") — never required for the
  core loop to work.
- Do not imply that a changed page/document is wrongdoing. Present
  evidence neutrally.

## Where to look next

`docs/ROADMAP.md` has the phased build order and current status per
phase — Phase 0 (Reliability) and most of Phase 1 (Investigation
Workspace) are shipped; Phase 2 (Evidence Vault / SHA-256 preservation)
and Phase 3 (Compare Engine / Then-vs-Now) are the next logical P1 work,
per the CANON.md Build Priority. Nothing past Phase 1 gets built until
it's explicitly requested by the user — don't self-direct into Phase 2+
without being asked.

## Product language

Chronium Mind — **Search the Internet through time.**
Secondary: **Your gateway to the Internet's memory.**

Research screens must stay credible for journalism, legal/evidence
research, academic work, education, and business intelligence.
