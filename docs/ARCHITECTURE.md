# Chronium Mind — Target Architecture

## Principle

Chronium is a federated historical intelligence layer. Heavy archived content remains at the source whenever possible. Chronium stores normalized metadata, relationships, user investigation state, and intentionally preserved evidence.

## Normalized record

Suggested direction, not a frozen schema:

```js
{
  id,
  canonicalKey,
  domain,
  organization,
  jurisdiction,
  category,
  title,
  description,
  documentType,
  originalUrl,
  currentUrl,
  firstSeen,
  lastSeen,
  tags,
  entities,
  relatedRecordIds,
  sourceType,
  sourceAuthority,
  provenance,
  versions: []
}
```

## Version object

```js
{
  id,
  recordId,
  capturedAt,
  source,
  archiveUrl,
  originalUrl,
  mimeType,
  digest,
  statusCode,
  extractedTextRef,
  provenance
}
```

Versions should be first-class objects. Do not stuff every archive URL into one parent row.

## Connector contract

Every connector should expose a common interface conceptually like:

```js
{
  id,
  capabilities: ['full-text', 'url-history', 'document-index'],
  search(query, options),
  history(url, options),
  fetchVersion(ref)
}
```

A connector must truthfully declare what it can search. Wayback CDX and Common Crawl indexes are URL/capture indexes, not general global full-text search engines.

## Sources already represented

- Arquivo.pt
- Internet Archive Wayback CDX
- Common Crawl
- Copperas Cove live/public records
- Copperas Cove archived city records

Future adapters can include agenda systems, document centers, RSS/Atom, sitemaps, public datasets, and user-supplied records.

## Search modes

### Broad historical topic search
Use connectors that genuinely support text/topic search plus any locally indexed investigation corpus.

### URL/domain history
Fan out to capture indexes and version-history sources.

### Investigation corpus search
Search normalized local/project records regardless of which source originally produced them.

## Then vs Now

First implementation can be text-based:

1. select two versions
2. retrieve/extract text
3. normalize whitespace/navigation noise
4. compute additions/deletions
5. show both source URLs and capture dates

Later add structured detection for changed dollar amounts, names, dates and links.

## Persistence path

### Phase A
No database required for generic archive search. Static datasets can prove the adapter model. (Current state: the Investigation Workspace and bulk ingestion run entirely in the browser via IndexedDB — see `docs/CANON.md` Storage Modes.)

### Phase B
Cloudflare D1 for normalized record metadata, project state, saved searches and lightweight indexes.

### Phase C
R2 only for evidence a user explicitly chooses to preserve, generated diff artifacts, or extracted text where legally/operationally appropriate.

## Cloudflare service allocation (target, once a backend is warranted)

One rule per service — don't let responsibilities blur across them:

- **Workers** — orchestration only: search/provider routing (`ArchiveProvider` in `src/index.js` already does this), lightweight APIs, ingestion coordination, auth later. No business data lives in a Worker.
- **D1 — metadata only.** Investigations, source records, hashes, bibliography, evidence links, claims, timelines, relationships, coverage, saved queries. Never raw file bytes.
- **R2 — only what Chronium truly must own.** Selectively preserved evidence (the `ArchiveProvider.preserve()` seam), user uploads someone explicitly chooses to store (opt-in, per Storage Modes — never a default), generated reports/comparison artifacts, and maybe cached extracts where genuinely worth the cost.
- **KV** — tiny, fast-changing config/cache/session-like data only, if and when needed. Not a database.
- **Queues / Cron Triggers** — later: background jobs, retries, scheduled rechecks (did this page change since we last looked?), and large ingestion workflows that outgrow a single request. Not needed for the current client-side ingestion pipeline.

This is the target shape for when a backend becomes warranted — it does not change anything about today's local-first IndexedDB implementation, which stays Phase A until there's a concrete reason (cross-device sync, sharing, a public-facing deployment) to move data server-side.

## AI boundary

AI can summarize, suggest connections and help query records, but all output must be visibly separated from source facts and computed facts. Every claim should be traceable to source evidence.
