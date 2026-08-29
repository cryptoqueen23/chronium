# Chronium Mind

**Search the Internet through time. Connect the evidence.**

Chronium Mind is a reusable historical-web and public-record intelligence
aggregator with a real Investigation Workspace on top. It is **not** a
Copperas Cove-only site. Copperas Cove, Texas (`data/copperas-cove/`,
~3,200 real government records) is the proof dataset and stress test —
no city-specific logic belongs anywhere outside `data/`.

## What's working today

**Federated historical search:** topic search via Arquivo.pt full-text;
URL/domain history via Arquivo.pt, Wayback CDX, Common Crawl, and a
Memento aggregator. Cross-archive dedup, capture-reachability validation
with automatic fallback to an alternate archive, and an in-app **Archive
Viewer** that renders a capture inside Chronium (sandboxed HTML iframe,
native PDF viewer, formatted text panel) instead of navigating to a URL
that might force a download. Every connector result carries a *Coverage
Verdict* distinguishing "found" from "provider unavailable" from
"verified gap" — never conflates a connector failure with confirmed
absence of history.

**Investigation Workspace:** the real product. Upload documents or save
web sources into an investigation, then **Research → Evidence → Findings
→ Report**:

- **Research** — search returns the actual matched passage (not a stale
  preview), the source page number for PDFs, and one-click "Save as
  Evidence" that carries over excerpt/location/provenance automatically.
- **Evidence** — your saved receipts: excerpt, source, page/location,
  date, citation.
- **Findings** — Claims, Timeline, Contradictions, Gaps, and Analysis
  (deterministic Quantitative, always free; AI-assisted Qualitative,
  opt-in and paid) as sub-tabs of one section.
- **Report** — a deterministic, evidence-backed report generated from
  Claims. Free. An AI-enhanced report is a future paid tier, not built
  yet.

No database or paid API is required for the core search + investigation
loop — IndexedDB in the browser, one Cloudflare Worker, Cache API for
archive resolutions. The one opt-in paid call is Qualitative Analysis
(Anthropic Claude Haiku today, provider-agnostic router — see `src/ai/`).

## Product direction

Chronium is a reusable engine with five major layers:

1. **Connectors / ingestion** — archives, live sites, government document centers, RSS/sitemaps, uploaded records.
2. **Normalization** — convert sources into one provenance-first record model.
3. **Index / search** — keyword/entity/date/organization/category filtering.
4. **Investigation workspace** — Research → Evidence → Findings → Report, described above.
5. **Analysis** — Then vs Now, version diffs, deeper AI-reasoning layers, connections, computed facts. Mostly ahead, see `docs/ROADMAP.md`.

See `docs/CLAUDE_HANDOFF.md` (current state + known gaps, rewritten each
session) and `docs/CANON.md` (mission, evidence rules, every CANON RULE —
these are load-bearing) before changing the code. `docs/ROADMAP.md` has
the phased build order and what's actually shipped vs. not started.

## Non-negotiable trust rule

Chronium must distinguish:

- **SOURCE FACT** — directly contained in a source.
- **COMPUTED FACT** — mechanically derived, e.g. capture count or text difference.
- **AI ANALYSIS** — machine-generated interpretation/summarization.

Never present AI analysis as source evidence.

## Hosting philosophy

Bootstrap first. Prefer:

- Cloudflare Worker / Pages free tier
- D1 only when structured persistence becomes necessary
- R2 only for deliberate evidence preservation, not mirroring the internet
- local-first user notes/investigations where practical
- public/free archive APIs
- no paid APIs unless there is a clear product reason

**Store the map, not the ocean.**

## Run

```bash
npm install
npm run check
npm run dev
```

Deploy:

```bash
npm run deploy
```

## Current status

Reliability (Phase 0) and the Investigation Workspace P0 (Phase 1) are
shipped — see `docs/ROADMAP.md` for the full phase table and
`docs/CLAUDE_HANDOFF.md` for what's outstanding within those phases and
known gaps to verify. Nothing past Phase 1 (Evidence Vault, Compare
Engine, Contradiction Detector, Research Agent, ...) gets built until
it's explicitly requested — don't self-direct into later phases.
