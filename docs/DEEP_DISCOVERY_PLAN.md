# Deep Discovery: implementation plan (PROPOSAL, nothing built)

Status: plan only, written 2026-10-23 for review. No Deep Discovery code exists. Needs approval before implementation. Follows `docs/CANON.md` (Investigative Standard, Bootstrap Rule, Accessibility standard) and the mission in `docs/ROADMAP.md` ("find the records before requesting them").

## 1. Goal and non-goals

**Goal.** Given a public body or a topic, find publicly available records without a prior public information request: follow official websites and their document areas, find linked files and attachments, recover historical copies when a file is gone, record exactly what was searched, and say what could not be located. Every retrieved item carries its original URL, dates, a hash, and a citation.

**Three outcomes per target document** (Mari's wording): **Found** (working link, text and fingerprint saved) / **Historical copy found** (original unavailable, an archived copy exists, capture date recorded) / **Not located** (what was searched, which sources were down or blocked, and a narrowly targeted request can be drafted later). "Not located" never means "does not exist".

**Non-goals.** No login-walled, paywalled, CAPTCHA'd, or private systems. No bypassing robots.txt or terms. No JavaScript-rendering browser farm. No accounts, billing, or Chronium-hosted storage (Bootstrap Rule). No AI required. No scanned-document OCR in the first phases. Not a whole-internet crawler: bounded, per-run, user-started.

## 2. What probing a real target showed (2026-10-23, light GETs only)

Target: Copperas Cove, TX (`www.copperascovetx.gov`, the proving-ground corpus named in CANON). Reachable from the build machine.

| Finding | Consequence for the design |
|---|---|
| It is a **CivicPlus** site (`/AgendaCenter`, `/DocumentCenter`, `/Facilities`, `/FormCenter`). | Build one **CivicPlus adapter**; the same platform serves many Texas cities, so it pays off beyond one city. |
| `robots.txt` has a `User-agent: *` group with **`Crawl-delay: 10`** and disallows search, calendar, RSS, bids, FAQ, CivicAlerts, admin; named groups for AI crawlers repeat the same rules plus the same blocks. | A polite run is **at most one request per 10 seconds per host** (about 360 an hour). 400 documents is roughly 70 minutes. Time, not money, is the cost. Runs must be resumable and shown honestly as slow. |
| `sitemap.xml` lists 253 URLs, but only the two document-centre landing pages, not the documents. | A sitemap crawl alone finds almost nothing. Documents sit behind the centres. |
| The AgendaCenter page has no static `ViewFile` links; its list loads via `AgendaCenter/UpdateCategoryList`. DocumentCenter static HTML shows one `View` link; folders load by script. | A "follow links in HTML" crawler would report the site as nearly empty. The adapter must call the same public endpoints the page itself calls, within robots rules. **Unverified:** whether those calls are permitted by robots and the site's terms, and their exact shapes. That is the first task of Phase 0. |
| `archive.org`/`web.archive.org` are unreachable from the build machine (known limitation since August). | Recovery code can be unit-tested with fixtures but not live-verified here; live verification needs the user's machine or deployed Worker. |

## 3. Architecture

Principle: **the discovery engine runs where it costs Chronium nothing (the user's browser), and the Worker does only small stateless jobs.**

```
User starts a run (Find Documents)           +-----------------------------+
  public/discovery/engine.js (pure logic)    |  Worker (existing, stateless)|
   - planner  (seed -> frontier)             |  /api/captures?url=  (CDX etc.,|
   - policy   (robots, delay, caps, scope)   |   cached; 10 URLs per call)  |
   - adapters (generic HTML, sitemap,        |  /api/fetch?url=  (website    |
               CivicPlus, later others)      |   mode only: small, guarded)  |
   - classifier (agenda, minutes, budget...) +-----------------------------+
   - recovery  (original -> archive copies)
   - ledger    (every source tried + result)       Fetcher (pluggable)
   - gaps      (series holes, linked-but-missing)   - ExtensionFetcher: direct fetch
  -> writes into the existing case (IndexedDB)       with per-domain host permission
                                                    - ProxyFetcher: Worker /api/fetch
```

**Fetcher decision (needs Mari's approval, section 12).**
- **Extension (primary):** direct `fetch` from the side panel/service worker to the official site, using an *optional host permission requested per domain at run time* (`chrome.permissions.request`, user prompt). No Worker requests for fetching, no central IP, politeness is per user. Cannot be done from the website because of CORS.
- **Website (limited):** `/api/fetch` proxy, only for single-URL retrieval and runs of at most 25 fetches, with the guards in section 8. Per-host spacing is best-effort (Worker is shared across users, so one site could see several users' requests): hence the small cap and a per-host daily ceiling.
- Recovery lookups (`/api/captures`) go through the Worker for both: archives often send no CORS headers, and the existing provider layer (retry, circuit breaker, caches) is reused.

**Reuse, not rebuild:** ingestion adapters (PDF/DOCX/XLSX/CSV/TXT text extraction, SHA-256, dedupe) from `public/ingest/`; archive providers in `src/index.js`; case model, export/import, Ask Chronium and the three views read discovered documents as ordinary sources.

## 4. Pipeline (one run)

1. **Plan.** Input: a domain or page URL (or a registry entry), optional topic words, optional date range, and the free caps. Output: a visible plan ("up to 150 pages, 100 documents, about N minutes at the site's 10 s delay") the user confirms.
2. **Preflight per host.** Fetch and cache `robots.txt` (24 h). Pick the `*` group (our User-Agent is not named). Record `Crawl-delay`, disallowed prefixes, sitemap lines. If the host asks for more than the cap allows, say so and offer to run a smaller scope.
3. **Discover.** Frontier BFS from seeds: sitemap URLs first, then adapter-specific listing calls, then in-scope links. Depth limit (default 2), same-registrable-domain plus an explicit allowlist of document hosts the page links to (for example a city's file CDN), page cap, per-host spacing, 3 redirect hops max.
4. **Classify** each link by URL, link text, file type and date tokens: agenda, minutes, packet/attachment, budget, audit/ACFR, check register/expenditure report, contract, ordinance/resolution, other.
5. **Retrieve** documents (size cap, type allowlist) and extract text. Compute SHA-256 of the bytes as served. Save to the case (see section 5).
6. **Recover.** For a target that is unavailable (404/410/403/timeout) or, optionally, for every document, ask `/api/captures` for archived copies (Wayback CDX, Arquivo.pt, Memento aggregator) and record capture dates.
7. **Ledger.** Every attempted source (host, URL, action, result, time, bytes, robots decision, cached or not) is recorded, including failures and skips.
8. **Gaps** (section 7) and a plain-language **coverage summary**: searched N sources of what the plan listed; M unavailable; K blocked by robots; documents Found / Historical / Not located.

Runs are **resumable** (state is in the case) and **pausable**. In the extension the run lives in the side panel; a service-worker alarm can continue while the panel is closed in a later phase.

## 5. Data model (additive; no change to existing stores' meaning)

Documents become ordinary `records` with extra provenance fields: `sourceType: 'discovered-document'`, `originalUrl`, `finalUrl`, `retrievedAt`, `httpStatus`, `contentType`, `contentLength`, `etag`, `lastModified`, `fileHash` (SHA-256, already used), `storageMode` (default **local-only: text and metadata kept, bytes not copied**, opt-in local copy as today), `discovery: { runId, parentUrl, linkText, adapter, classification, robots: 'allowed' }`, `fetcher: 'extension'|'proxy'`, `engineVersion`, and for recovered items `archiveUrl` + `captureDate` (existing fields).

New stores (IndexedDB version 11, additive): `discoveryRuns` (id, investigationId, seeds, caps, startedAt, finishedAt, status, summary) and `discoveryLedger` (id, runId, url, host, action, result, httpStatus, at, bytes, robots, cached, note). Both carry `investigationId`; both go into `.chronium.json` as optional arrays (older files without them still import; format version stays 1, importer already tolerates missing lists). `docs/COST_DRIVERS.md` gains rows when each phase ships.

## 6. First public sources (in order)

| # | Source | How | Why first | Must verify before coding |
|---|---|---|---|---|
| 1 | **Copperas Cove, TX** (CivicPlus) | CivicPlus adapter: AgendaCenter category/year lists, DocumentCenter folders, sitemap | The proving-ground corpus; the same platform serves many Texas cities | The AJAX endpoints' shapes and that robots/terms allow them; `Crawl-delay: 10` |
| 2 | **Any other official site, generic** | sitemap + in-scope links + file-type detection | Works for simpler sites without an adapter | n/a (same policy engine) |
| 3 | **Internet Archive Wayback CDX, Arquivo.pt, Memento** | existing providers, new `/api/captures` | Recovery of historical copies | Live verification outside the build machine |
| 4 | **Legistar (Granicus) public Web API** | JSON API, many cities | Votes, agenda items, attachments in structured form | Whether a given city exposes it without a key |
| 5 | **Texas open data (data.texas.gov / Socrata) and Comptroller local-government datasets** | public API | Spending/debt datasets that corroborate city documents | Dataset licences and API terms |
| 6 | **USAspending, GovInfo, Federal Register** | public APIs | Federal money tracing | Keys and terms (some need a free key: decide if that counts as an "account") |
| Later | **MSRB EMMA, IRS 990/ProPublica, campaign finance** | link-out or bulk files | Bonds, nonprofits | EMMA's terms may forbid automation: default to **link-only** unless verified otherwise |

Each source is a **registry entry** with `automation: 'allowed' | 'link-only' | 'forbidden'`, the date and text of the terms checked, rate limits, and a cost class. No source ships without a verified entry.

## 7. Missing evidence without overclaiming

Gap detectors are deterministic and always worded as "not located in the sources searched":
- **Series holes:** agendas present but minutes absent for the same meeting date; a monthly or fiscal-year series with a missing month/year; a budget for FY n and n+2 but not n+1.
- **Linked but unretrievable:** a page links a file that returned 404/403/timeout (then recovery is tried).
- **Referenced but not found:** a retrieved document cites an ordinance, agreement, or attachment number that appears nowhere else in the case.
- **Source-level:** a host that was blocked by robots, timed out, or whose pages need JavaScript is listed as "could not be searched", never as "empty".

Draft of a **targeted Texas Public Information Act request** is a later phase (Phase 4) and only from items in "Not located"; it states what was searched and when. Comparing a request against what was found (available / partial / missing) is also Phase 4.

## 8. Security and access boundaries

- **Scope:** only `http`/`https`; no credentials, cookies, or user headers sent; no form posts except the documented public listing calls of a verified adapter; no login, paywall, CAPTCHA, or private-network targets.
- **robots.txt is obeyed** (including `Crawl-delay`, Allow/Disallow precedence, wildcard rules, per-group selection). If robots cannot be fetched, treat as "unknown": proceed only for the user-given seed with a warning, not for expansion. Retry-After and 429/503 cause backoff and stop-after-N, recorded in the ledger.
- **Terms and copyright:** registry flag per source; link-only sources are never fetched. Retrieved text is stored locally for the user's own research; nothing is republished by Chronium.
- **Identification:** a descriptive User-Agent with a contact URL on proxy fetches. In the extension the browser may not allow overriding `User-Agent`; use `declarativeNetRequest` header modification if it works, otherwise state the limitation. **Open technical risk.**
- **Worker proxy hardening (website mode):** SSRF guard (reject IP literals, localhost, private/link-local/metadata ranges, userinfo URLs, non-standard ports; re-validate every redirect hop; DNS-rebinding is limited by Workers' inability to reach private networks); host must be on the registry allowlist or confirmed by the user; response size cap (10 MB), content-type allowlist, 10 s timeout, max 3 redirects; no cookies; strips `Set-Cookie`; no request or URL logging; per-IP and per-host rate limits using the Cache API, not KV writes; `DISCOVERY_ALLOW_PRIVATE` exists only in the dev/test environment.
- **Extension:** no `<all_urls>` at install; optional host permissions requested per domain with a plain-language prompt; revocable.
- **Privacy:** investigations stay local. Only target URLs go to the Worker, and are not stored.
- **Safe handling:** retrieved HTML is never executed or injected unescaped; PDFs parsed in the existing sandboxed worker path; archives and zips are not auto-expanded beyond the existing ingestion limits.

## 9. Cost model and controls (Bootstrap Rule)

Estimates, not measurements; free-tier figures are from memory and must be re-checked (Workers Free about 100,000 requests/day, about 10 ms CPU and 50 subrequests per request; KV Free about 1,000 writes/day).

Worked example, one run on Copperas Cove: about 60 listing calls + about 400 documents = about 460 fetches; at the site's 10 s delay that is about 77 minutes.

| Mode | Worker requests per run | Chronium storage | Notes |
|---|---|---|---|
| Extension direct fetch | about 40 (recovery lookups, 10 URLs per call) | none (IndexedDB on the user's device, about 40 MB of text for 400 documents) | free to Chronium; time-bound by robots |
| Website proxy (small runs) | up to 25 fetches + a few lookups | none | capped by design |

At about 40 Worker requests per extension run, the free allowance supports on the order of 2,500 runs a day; at 25 proxy fetches it supports about 3,000. KV writes per run: 0 (ledger is local). R2/D1 not used.

**Controls:** free caps (defaults: depth 2, 150 pages, 100 documents, 3 runs a day per browser, 25 fetches in website mode); the 24 h Cache API cache for fetches and `robots.txt`; recovery batching; hard stop at cap with an honest "stopped at the free limit, N more found but not retrieved"; per-run cost line in the summary (requests made, bytes, minutes). Caps live in one config object so a future premium tier can raise them (heavy crawling, larger runs, scheduled monitoring, hosted storage) without touching the engine. No billing, accounts, or gating is built.

## 10. Acceptance tests (define before coding; all offline unless marked)

**Unit (pure functions, Node):**
- URL canonicalization and dedupe (case, fragments, tracking params, trailing slash, percent-encoding).
- robots parser against fixtures: group selection, Allow/Disallow longest-match precedence, wildcards and `$`, Crawl-delay, Sitemap lines, malformed file, empty file; the real Copperas Cove file as a fixture.
- Link extraction: relative and `<base>`, `javascript:`/`mailto:` ignored, file-type detection, duplicates.
- Classifier: agenda/minutes/budget/audit/check register/contract/ordinance cases and a "none" case, with measured precision on a fixture set.
- Frontier: depth, page, host and document caps respected; cycles; off-scope hosts excluded; deterministic order.
- Rate limiter: spacing honours the larger of Crawl-delay and the floor; backoff on 429/503.
- SSRF guard: localhost, `127.0.0.1`, `[::1]`, `169.254.169.254`, `10.x`, `192.168.x`, decimal/hex/octal IP forms, `user@host`, redirect to a private address, non-http schemes, odd ports: all rejected; ordinary public hosts accepted.
- Outcome classifier with a mock fetcher: Found / Historical copy found / Not located, including "archive source down" (must yield Not located with the archive listed as unavailable, never "does not exist").
- Ledger completeness: every attempted source appears exactly once with a result; counts in the summary equal ledger counts.
- Gap detectors: series holes, linked-but-missing, referenced-but-missing; wording test that no message contains "does not exist" or "no record".
- Hash determinism and provenance fields present on every saved document.
- Export/import round trip of runs, ledger and discovered documents; older bundle without them still imports.
- **Cost guard:** with a counting mock fetcher and Worker, a run never exceeds its caps (requests, pages, documents), and stops with the honest message.

**Integration (offline, local fixture site served by a test HTTP server):** robots.txt with Crawl-delay, an agenda listing, linked PDFs/DOCX/TXT, a 404 link, a redirect, a 429, an off-scope link, a link-only domain, a JS-only page. Run through ExtensionFetcher (headful Chrome for Testing, host permission granted) and through the Worker proxy under `wrangler dev`. Assert: results, ledger, no request to disallowed paths, spacing respected (fake timers where possible), zero Worker requests for the extension path except recovery.

**Browser/UI:** Find Documents start, plan confirmation, host permission prompt, progress with pause/resume, results grouped Found / Historical copy found / Not located, the "what was searched" ledger, a gap list; keyboard-only, axe at 320 to 1920 px and in the side panel, both themes, forced-colors, reduced motion; the three views and Ask Chronium show discovered documents with their provenance and "How do we know?".

**Live smoke (manual, not CI):** a 20-page capped run against the real Copperas Cove site honouring its 10 s delay; confirm every saved document has URL, date, hash, citation; recovery check run from a machine that can reach archive.org.

**Regression:** all existing tests and the Ask Chronium benchmark stay as they are.

## 11. Phases and exit criteria

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Spec and guards** | Source registry format; robots, URL, SSRF, rate-limit, link-extraction, classifier modules with unit tests; **verify Copperas Cove's AJAX endpoints and terms**; confirm UA-header option in the extension | all unit tests above for these modules pass; written verification of terms for source 1 |
| **1. Single-document retrieval** | fetcher abstraction (extension + proxy), retrieve one URL, hash, text, provenance, save to case, ledger entry | provenance complete; website proxy guard tests pass; offline integration test |
| **2. Bounded crawl + CivicPlus adapter + recovery** | planner, frontier, caps, resumable runs, `/api/captures`, three outcomes, coverage summary UI | fixture-site integration passes; cost guard test passes; live smoke on Copperas Cove (20 pages) |
| **3. Gaps and Records Recovery** | gap detectors, "not located" list, coverage report in Big Picture / Reports | wording tests pass; Big Picture shows searched / unavailable / not located |
| **4. Request support** | Texas Public Information Act draft from "Not located"; request-vs-found comparison | drafts cite what was searched and when |
| **5. More sources** | Legistar, Texas open data, federal APIs, link-only registry entries | one verified registry entry and cost row per source |

Each phase ends with a local commit, test results, cost-row updates in `docs/COST_DRIVERS.md`, and a stop for approval. Nothing is deployed without approval.

## 12. Decisions needed from Mari

1. **Honour `Crawl-delay: 10`** (recommended) even though it makes a 400-document run take over an hour? Alternative: smaller default scope plus resumable runs. Recommended: honour it, never go faster than a site asks.
2. **Extension-first direct fetching** with per-domain permission (recommended), with the website limited to small proxy runs?
3. **First target:** Copperas Cove / CivicPlus adapter (recommended), or another city?
4. **Free caps:** depth 2, 150 pages, 100 documents, 3 runs a day. Adjust?
5. **Storage default:** text and metadata only, originals not copied (recommended, matches Storage Modes)?
6. **Free API keys** (Congress.gov, GovInfo need a free key): does a user-supplied free key count as acceptable, or should keyed sources wait?
7. **EMMA and similar sites that restrict automation:** link-only unless their terms clearly allow retrieval (recommended).

## 13. Known limitations (stated up front)

- Cannot see unpublished, private, access-restricted, or JavaScript-only content; such sites are reported as "could not be searched".
- Politeness limits make large runs slow; coverage per run is bounded by caps and by what robots permits.
- Scanned documents are saved but not searchable until OCR (not in the first phases); they are labelled unverified.
- A site's markup or endpoints can change and break an adapter; adapters are versioned and tested against fixtures, and a failure is reported, not hidden.
- Hashes are of bytes as served; dynamic pages can differ between fetches.
- Archive recovery depends on third parties (rate limits, outages) and could not be verified live from the build machine.
- Extension direct fetching works only in Chromium browsers on desktop; the website's proxy mode is deliberately small.
- Legal and terms judgements are made per source and recorded in the registry; they are not legal advice.
- "Searched N sources" never means the whole internet; "Not located" never means the record does not exist.

## Changes to this plan after Phase 0 (2026-10-23)

Decisions recorded from Mari: honour Crawl-delay always (mandatory); extension-first with a tightly limited website proxy; Copperas Cove first but the adapter reusable; caps provisional and treated as ceilings; text and fingerprint by default with explicit opt-in to keep originals; free API keys acceptable if they cost nothing and are not exposed; EMMA link-only until verified.

What Phase 0 changed or added:
1. **The CivicPlus adapter is blocked, not just unwritten.** Verification (`docs/CIVICPLUS_VERIFICATION.md`) found the CivicPlus terms restrict automated systems and the city asserts copyright; automation for `copperascovetx.gov` is registered `unverified` and the engine refuses to contact it. Compliant alternatives (user-directed capture, user-supplied URLs, written permission, a Public Information Act request) replace the "run the adapter" step in Phases 1 and 2 until a recorded decision clears it.
2. **A host policy registry** (`allowed` / `link-only` / `forbidden` / `unverified`) gates every request; unlisted hosts need an explicit per-run acknowledgment, recorded in the ledger (`docs/DISCOVERY_SOURCE_REGISTRY.md`).
3. **Per-host daily request ceiling of 500** per browser, counted across runs, deliberately under the 1,000-pages-a-day figure in the CivicPlus terms.
4. **Redirects**: each hop is its own checked, scheduled, robots-evaluated request; a redirect to a different host is re-queued through scope and policy, never followed inline. Redirect targets are never treated as seeds (a test caught that a seed's redirect could bypass the scope check; fixed).
5. **robots.txt group selection** is by product token. The extra blocks the city wrote for named AI crawlers do not apply to us; the earlier plan text implying they did was wrong and is corrected.
6. **Browser fetchers cannot validate redirects before they happen** (the Location header is hidden for manual redirects): the engine validates the final address afterwards and discards disallowed content, but the redirect request itself has then already been sent. Phase 1 must add network rules in the extension to block private targets.
7. **New outcome words**: Found, Historical copy found, Partially retrieved, Not located in the sources searched, Source unavailable, Access restricted, Search incomplete; plus coverage statuses Searched, Partially searched, Not checked yet, Not accessible, Source unavailable. "Not located" is only produced when every consulted source gave a definite no.
8. **Search transparency**: every run keeps a ledger (addresses, results, counts; never page text, never queries) and a coverage table per planned source, in words and as an accessible table.
9. Sitemaps, document retrieval, recovery lookups and gap detection stay in later phases as planned; Phase 0 records document links as candidates only.

