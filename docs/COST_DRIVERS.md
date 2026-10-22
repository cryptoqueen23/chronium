# Cost drivers (Bootstrap Rule bookkeeping)

Who pays for each operation, what makes it grow, and how it is kept cheap.
**Figures are estimates from the architecture, not measurements** (no usage
metering exists yet; only AI calls are counted). Cloudflare free-tier numbers
below are from memory of Cloudflare's published limits and must be re-checked
before relying on them. Update this file whenever a connector or operation is
added or changed.

Cost classes: `local` (user's browser, $0 to Chronium) / `edge-cached` /
`edge-uncached` / `third-party-metered` (someone else's rate limit or bill) /
`paid-ai`.

| Operation | Class | Who pays | What scales it | Ceiling / risk | Mitigation today | Heavy form belongs to |
|---|---|---|---|---|---|---|
| Ingest files (ZIP/PDF/DOCX/XLSX/CSV), hash, extract text | local | user's device | file count and size | browser memory on very large ZIPs | streaming ZIP, dedupe by hash, originals not copied by default | free |
| Case storage (IndexedDB) | local | user's device | evidence volume | browser quota | local-copy of originals is opt-in | free; cloud storage = premium |
| Ask Chronium, search inside a case | local | user's device | case size (whole case loaded per question) | slow past ~tens of thousands of documents | deterministic, no network | free |
| Investigation views (Big Picture / Overview / Deep Dive) | local | user's device | case size (whole case loaded per view) | slow past tens of thousands of documents | derived on demand from the local snapshot, nothing stored or sent | free |
| Case export / import | local | user's device | case size, embedded file copies | large files | embedded copies optional | free, always (portability guarantee) |
| Extension side panel | local | user's device | none | none | none | free |
| Historical search `/api/search` (Arquivo.pt; Wayback, Common Crawl, Memento in URL mode) | edge-cached + third-party-metered | Chronium (Worker requests), archives (rate limits) | searches/day, number of archives per search | Workers free tier (about 100k requests/day); archive throttling | 5-min response cache, 10-min per-connector success cache, retry once, circuit breaker, queries capped at 300 chars | free with limits; bulk or monitored searching = premium |
| Connector health + circuit breaker (KV) | edge | Chronium | searches/day (writes on failures and cache) | KV free tier has a low daily write cap (about 1k/day): the first limit likely to bite | writes only on state change | internal |
| Link check `/api/check-link` | edge-uncached | Chronium | result clicks | Worker requests; target sites' tolerance | HEAD first, bounded redirects | free with limits |
| Archive viewer `/api/view-capture` (proxies a capture) | edge-uncached | Chronium (bandwidth, CPU) | captures opened, capture size | bandwidth and CPU on free tier | short-lived cache | free with limits; heavy use = premium |
| Local corpus search (bundled demo corpus) | edge | Chronium | searches/day | Worker CPU | none needed at this size | n/a |
| Qualitative Analysis (AI) | paid-ai | whoever holds the key (Chronium or user) | explicit clicks x input size | per-token bill | explicit click only, ~12k-char input cap, token cap, 30-min content-hash cache, client cache, usage counter at `/api/ai/usage`, provider swappable by config | premium or bring-your-own key; never required |
| Discover Sources (outward search layer) | edge-cached + third-party-metered | Chronium + each provider | questions asked | same as historical search | shares `/api/search` caching | free with limits |
| Planned: Deep Discovery crawler | edge-uncached + third-party-metered | Chronium | pages crawled per case | fetch limits, site terms, storage | must be bounded, rate-limited, robots/terms-respecting, cached (not built) | premium for large crawls; small bounded crawl free |
| Planned: OCR of scanned documents | local first | user's device | pages | CPU/time | browser-side OCR, labelled unverified (not built) | server OCR = premium |
| Planned: government, legislation, books, nonprofit connectors | edge-cached + third-party-metered | Chronium + providers | queries/day | each provider's published limits; some forbid scraping | per-connector entry added when built; verify terms first | free with limits |
| Planned: monitoring / alerts, cloud sync, hosted storage | edge + storage | Chronium | users x cases | storage and scheduled jobs | not built; optional, encrypted, never required | premium |

## Watch list (first things likely to cost money or throttle)

1. KV writes (circuit breaker bookkeeping) once real traffic exists.
2. Worker request volume, since every search and link check is a request.
3. Capture proxying bandwidth.
4. AI calls, if a Chronium-owned key is ever used for free users (today: opt-in, usage counted).

## Entitlement seam (not implemented)

Each row above that is not `local` is a candidate capability name. When
billing is eventually built, a plan check wraps the capability at the Worker
route or client call site; the research engine, data model and `.chronium.json`
format do not change. Until then there are no plans, accounts, or gates.
