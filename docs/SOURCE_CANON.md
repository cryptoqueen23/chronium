# Chronium Source Canon

Chronium is a **topic-agnostic internet research aggregator**. Government is one use case, not the product.

## Sources

Pull from the best available public sources, including:

* websites and webpages
* Internet Archive / Wayback
* PDFs and documents
* government sites and open data
* academic/research sources
* news and journalism
* company/organization websites
* public databases and APIs
* RSS/Atom feeds
* datasets: CSV/JSON/XML
* images
* video
* audio/podcasts
* user-provided files and URLs

## Source Priority

Prefer:

**primary/authoritative source → archived primary source → reputable secondary source → discovery source**

Search engines are for discovery, not evidence.

## Ingestion Rule

Prefer:

**API/bulk data → RSS/sitemap → structured files → public HTML**

Use free/public sources first. Do not bypass paywalls, authentication, CAPTCHAs, or access controls.

## Every Result Must Preserve

* original URL/source
* publisher/creator
* retrieval date
* publication date when known
* content/document type
* archived URL + timestamp when available
* content hash/version
* relationship to other records

## Chronium Core

All sources normalize into a common research layer:

```text
SOURCE
  ↓
CAPTURE
  ↓
CONTENT
  ↓
ENTITIES
  ↓
CONNECTIONS
  ↓
TIMELINE / VERSIONS
  ↓
SEARCHABLE EVIDENCE
```

Use adapters for individual source types. Never hard-code Chronium around government or one website.

## Topic Agnostic

The same engine should work for:

**government, politics, companies, people, history, science, law, journalism, finance, technology, education, organizations, events, products, culture, or any other research topic.**

A Chronium investigation begins with a **question/topic**, not a predefined industry.

## Core Rule

Chronium should **find, aggregate, preserve, connect, compare and cite** information.

AI analyzes the corpus. **AI is never the source.**
