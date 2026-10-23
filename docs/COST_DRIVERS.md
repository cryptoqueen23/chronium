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
| Deep Discovery Phase 0 engine (`public/discovery/`): robots, scheduling, link discovery, ledger | local | the user's device (CPU, bandwidth) | pages fetched per run | the host's Crawl-delay (time) and its terms; Chronium pays nothing | caps: depth 2, 150 pages, 100 document links, 3 runs/day, 25 website-mode fetches, 500 requests/host/day, 400 requests/run. **Measured on a synthetic local site at default caps: 151 requests, 0.42 MB, 25 minutes at a 10 s Crawl-delay, about 330 ms of CPU in total, about 4 MB of memory, 53 KB ledger** (`node scripts/discovery-measure.mjs`; real sites vary in page size) | free with caps; larger or scheduled runs = premium |
| Deep Discovery through the website's Worker proxy `/api/fetch` (Phase 1, built) | edge-uncached | Chronium (Worker requests, bandwidth) | fetches per run | Workers free tier; the target site's tolerance | **Measured: one Worker request per request to the site** (live run: 8 for 8; local run: 20). At most 25 fetches per website-mode run; 40 per minute per visitor and 30 per minute per site; 10 MB and 10 s per fetch; no KV writes (Cache API only: robots.txt 24 h, rate counters 90 s); CPU not measured | small runs free; more = premium |
| Deep Discovery archived-copy lookups `/api/captures` (Phase 1, built) | edge-cached + third-party-metered | Chronium (Worker requests), Internet Archive (rate limit) | documents that could not be retrieved | Workers free tier; archive availability | at most 25 lookups per run (hard ceiling 100); answers cached 24 h; an unreachable archive is not cached; Wayback availability only | free with limits |
| Deep Discovery document retrieval and saving (Phase 1, built) | local | the user's device (bandwidth, CPU, IndexedDB) | documents per run (cap 100, hard 300), text size | browser quota; 300 MB download cap per run | text and fingerprint kept, **originals not copied** unless opted in; duplicates by content hash are one record. **Measured: about 52 KB for a 7-record local run; ledger 3.4 KB for 9 rows; large-run storage not measured** | free; hosted storage = premium |
| Deep Discovery in the extension (Phase 1, built) | local | the user's device | same as above | the site's Crawl-delay | **0 Worker requests for fetching**; only archive lookups use the Worker | free |
| Case export / import | local | user's device | case size, embedded file copies | large files | embedded copies optional | free, always (portability guarantee) |
| Extension side panel | local | user's device | none | none | none | free |
| Historical search `/api/search` (Arquivo.pt; Wayback, Common Crawl, Memento in URL mode) | edge-cached + third-party-metered | Chronium (Worker requests), archives (rate limits) | searches/day, number of archives per search | Workers free tier (about 100k requests/day); archive throttling | 5-min response cache, 10-min per-connector success cache, retry once, circuit breaker, queries capped at 300 chars | free with limits; bulk or monitored searching = premium |
| Connector health + circuit breaker (KV) | edge | Chronium | searches/day (writes on failures and cache) | KV free tier has a low daily write cap (about 1k/day): the first limit likely to bite | writes only on state change | internal |
| Link check `/api/check-link` | edge-uncached | Chronium | result clicks | Worker requests; target sites' tolerance | HEAD first, bounded redirects | free with limits |
| Archive viewer `/api/view-capture` (proxies a capture) | edge-uncached | Chronium (bandwidth, CPU) | captures opened, capture size | bandwidth and CPU on free tier | short-lived cache | free with limits; heavy use = premium |
| Local corpus search (bundled demo corpus) | edge | Chronium | searches/day | Worker CPU | none needed at this size | n/a |
| Qualitative Analysis (AI) | paid-ai | whoever holds the key (Chronium or user) | explicit clicks x input size | per-token bill | explicit click only, ~12k-char input cap, token cap, 30-min content-hash cache, client cache, usage counter at `/api/ai/usage`, provider swappable by config | premium or bring-your-own key; never required |
| Discover Sources (outward search layer) | edge-cached + third-party-metered | Chronium + each provider | questions asked | same as historical search | shares `/api/search` caching | free with limits |
| Records Recovery (as built 2026-10-23) | local | the user's device (CPU, IndexedDB) | sources in the case, number of requests | browser memory on very large cases | derived on demand from the case; **no network, no Worker, no AI**. Measured: 10,000 documents plus a 2,000-row ledger in about 0.7 s in Node. Stores only reviewer decisions, requests and settings (tiny) | free |
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
