# Claude Handoff — Chronium Mind

You are working on **Chronium Mind**, a historical-web and public-record intelligence aggregator.

## Read first

- `README.md`
- `docs/ARCHITECTURE.md`
- existing `src/index.js`
- existing `public/` frontend
- sample proof datasets in `data/copperas-cove/`

## Current state

The original MVP already works as a federated historical web searcher. It distinguishes topic search from URL/domain history and queries sources according to their actual capabilities.

Separately, a substantial Copperas Cove public-record/Wayback harvesting project now exists. The included Phase 2 CSV contains original government URLs, exact archive links, archive-history links, capture counts, unique-version counts, categories, years, MIME types and investigation priority data.

Those two threads now need to converge into one **generic Chronium engine**.

## Critical product decision

**Do not turn Chronium into a Copperas Cove website.**

Copperas Cove is the first adapter/test corpus. No city-specific assumptions should leak into generic search/rendering components.

## First task

Audit the project and implement the smallest vertical slice that proves the updated architecture:

1. Define a normalized record and version model.
2. Create an adapter for the included Copperas Cove CSV.
3. Add an endpoint that searches the local investigation corpus.
4. Merge those results with appropriate external historical search results in a normalized response.
5. Update the UI so a result clearly shows provenance and whether it came from a live/public dataset or an archive connector.
6. Add a detail experience for records that exposes original URL, exact archived capture, archive history, capture/version counts, year/category and source type.
7. Keep all existing working archive connectors unless there is a demonstrated bug.

## After that

Build the first **Then vs Now** comparison flow for two versions of a known URL/record.

Do not begin auth, payments, large AI pipelines, vector databases or expensive crawling yet.

## Development constraints

- Bootstrap / free-tier-first.
- Cloudflare-friendly.
- Avoid paid APIs.
- No unnecessary framework migration.
- Preserve working code where reasonable.
- Responsive and accessible UI.
- Data-driven generic rendering.
- Source provenance is mandatory.
- Never call an AI inference a source fact.
- Do not imply that a changed page/document is wrongdoing. Present evidence neutrally.

## Product language

Chronium Mind

**Search the Internet through time.**

Secondary idea:

**Your gateway to the Internet's memory.**

The interface can use the existing purple/blue/cyan/gold/dark-navy brand direction, but research screens must remain credible for journalism, legal/evidence research, academic work, education and business intelligence.

## Definition of success for the next commit

A user can search one interface and receive normalized results from both:

- external archive connectors, and
- the included Copperas Cove investigation corpus,

with clear provenance and without Copperas Cove-specific rendering logic.
