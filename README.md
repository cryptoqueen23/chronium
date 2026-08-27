# Chronium Mind — Current Project Snapshot v0.2

**Search the Internet through time. Connect the evidence.**

Chronium Mind is becoming a reusable historical-web and public-record intelligence aggregator. It is **not** a Copperas Cove-only site. Copperas Cove, Texas is the first real investigation dataset and stress test.

## What is already working

The original MVP remains intact and runnable:

- Cloudflare Worker serves API + static frontend.
- Topic search via Arquivo.pt full-text historical search.
- URL/domain history via Arquivo.pt, Wayback CDX, and Common Crawl.
- Normalized archive search results.
- Provenance links back to archive/original source.
- Source/content filters.
- Edge cache.
- No database or paid API required for the basic historical search layer.

## What has been added to this snapshot

This ZIP now also contains the current Copperas Cove proof-of-concept data harvested from public/archived city records:

- `data/copperas-cove/copperas-cove-phase2-investigation-dataset.csv`
- `data/copperas-cove/copperas-cove-phase2-HIGH-priority.csv`
- `reference/copperas-cove-data.js`
- `reference/copperas-cove-data-full-replacement.js`

These are **reference/proof datasets**, not the permanent Chronium schema.

## Product direction

Chronium should become a reusable engine with five major layers:

1. **Connectors / ingestion** — archives, live sites, government document centers, RSS/sitemaps, uploaded records.
2. **Normalization** — convert sources into one provenance-first record model.
3. **Index / search** — keyword/entity/date/organization/category filtering.
4. **Analysis** — Then vs Now, version diffs, timelines, connections, computed facts.
5. **Investigation workspace** — saved records, notes, searches, comparisons and evidence collections.

See `docs/CLAUDE_HANDOFF.md` and `docs/ARCHITECTURE.md` before changing the code.

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

## Immediate next engineering milestone

Do **not** build a giant rewrite. The next useful milestone is:

1. Define the normalized Chronium record/version schema.
2. Add a local Copperas Cove dataset adapter using the included CSV.
3. Search archive connectors + local investigation records from the same UI.
4. Add a record detail view with original source, exact archive capture, history, category, dates and provenance.
5. Add two-version selection for a first Then vs Now diff.

That proves the aggregator architecture before adding accounts, billing, AI, or large infrastructure.
