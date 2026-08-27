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
No database required for generic archive search. Static datasets can prove the adapter model.

### Phase B
Cloudflare D1 for normalized record metadata, project state, saved searches and lightweight indexes.

### Phase C
R2 only for evidence a user explicitly chooses to preserve, generated diff artifacts, or extracted text where legally/operationally appropriate.

## AI boundary

AI can summarize, suggest connections and help query records, but all output must be visibly separated from source facts and computed facts. Every claim should be traceable to source evidence.
