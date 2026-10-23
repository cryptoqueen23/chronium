# Deep Discovery Phase 1: find, retrieve, record, report

Status: built and tested locally on 2026-10-23. **Committed locally only: not pushed, not deployed.** The live site is unchanged. Approval for Phase 1 (with the "user-directed discovery" addition) came from Mari on 2026-10-23; the brief and its restrictions are summarised below.

## What it does

A person pastes the address of a government website or its document library into **Find public records** (website: the new **Find Records** tab inside an investigation; extension: **My Research**, under the case list). Chronium then:

1. checks the address is safe and the site is cleared (see "Policy gates");
2. reads the site's `robots.txt` and the delay it asks for;
3. follows the pages and document links the site publishes, one request at a time, inside the free limits;
4. retrieves the documents it finds (optional), hashes each one as served, and keeps its original address, final address, time, HTTP details, the page it was linked from, and the engine version;
5. for a document that could not be retrieved (not found, or the site did not answer), asks the Internet Archive whether an archived copy exists (optional) and records its address and capture date;
6. saves everything into the open case **without duplicating**: the same content found at two addresses is one source that keeps both addresses;
7. shows a **coverage report**: where it looked, what it found, what it could not reach, what is unknown.

This is how the engine can be used well beyond Texas municipalities: any public website with linked documents, within the same rules. Specialised connectors (CivicPlus, Legistar and others) can be added later on top of the same engine.

## How it is built (and what is reused)

| Piece | File | Notes |
|---|---|---|
| Policy, robots, scheduling, URL safety, limits, provenance | `public/discovery/{config,urlGuard,robots,scheduler,links,outcomes,ledger}.js` | **Phase 0 code, reused unchanged** except where noted |
| Engine | `engine.js` | New: document retrieval phase, redirect handling for documents, content-hash duplicate detection, archived-copy lookup, classification hint, checkpoint for continuing, `isSeed` passed to fetchers |
| Document classifier | `classify.js` | Words only: agenda, minutes, packet, budget, audit, check register, contract, ordinance, resolution, other. A hint, labelled with its basis |
| Connector interface + CivicPlus adapter interface | `connector.js` | `listingCalls()` hook honoured only for registry-`allowed` hosts; the CivicPlus adapter recognises address shapes and offers no calls |
| Saving into a case | `save.js` | `createDocumentSaver` (dedupe, provenance, batch + review-queue rows like bulk import), `recordRun` |
| Runs and ledger storage | `public/db.js` (IndexedDB **version 11**, additive) | `discoveryRuns`, `discoveryLedger`; included in `.chronium.json` export/import; deleted with the case |
| Fetchers | `fetchers.js` | `createProxyFetcher` (website, via the Worker), `createArchiveLookup`; the Fetch API fetcher is the extension's |
| Worker endpoints | `src/discoveryProxy.js` | `/api/fetch` (guarded proxy, website mode only) and `/api/captures` (Wayback availability) |
| Screen | `panel.js` + `discovery.css` | One module, used by the website and the side panel |
| Coverage report | `report.js` | `buildCoverageReport`, `coverageReportHtml`, `coverageReportText` |
| Extension network rules | `extension/network.js` | Blocks private targets for the extension's own requests; sets an identifying User-Agent per granted site |

### Policy gates (every request passes all of them)

1. URL guard: http/https only, no credentials, no odd ports, no private/loopback/link-local/metadata addresses in any spelling.
2. Host policy registry: `copperascovetx.gov`, `civicplus.com` are `unverified`, `emma.msrb.org` is `link-only`; those are never contacted. An unlisted site needs the person's tick-box acknowledgment, recorded in the ledger. (The Worker enforces the same registry, so `/api/fetch` cannot be used to route around it.)
3. `robots.txt` (group chosen by our product token): Allow/Disallow, wildcards, and **Crawl-delay, never shortened**. A site asking for more than 60 s between requests is reported "too slow to search", not hurried. The Worker also checks robots on its side (it keeps the `robots.txt` it just served, so the site is not asked twice).
4. Per-host serial scheduling with a 3 s floor; 429/503 and `Retry-After` back-off; stop after three throttles.
5. Caps (all in `config.js`, with hard ceilings): depth 2, 150 pages, 100 documents, 400 requests, 300 MB, 3 hours, 3 runs a day, **500 requests per host per day**, 25 archive lookups, 25 fetches for website-started runs.
6. Redirects: every hop is its own checked, scheduled, robots-evaluated request, and must stay inside the search area. Browser fetchers that follow redirects themselves are validated afterwards; in the **extension**, network rules now also stop any redirect to a private address *before* it is requested.
7. Documents that answer with a web page (usually an error or sign-in page) are not saved.
8. An archived-copy lookup is made only for a document that was "not found" or whose site did not answer. A document the site restricted (login, 403, robots) is never looked up elsewhere: that would route around the restriction.

### Outcome words

Found / Historical copy found / Partially retrieved / Not located in the sources searched / Source unavailable / Access restricted / Search incomplete (definitions in the Phase 0 plan and in the report's "What the result words mean"). "Not located" is produced only when every consulted source gave a definite no; a failed connection is never a "no". Combining the site and the archive: not found + archive has a copy = Historical copy found; unavailable + archive says none = Search incomplete; unavailable + archive unreachable = Source unavailable.

## Using it

**Website.** Open an investigation, choose **Find Records**, paste an address, tick the terms box, choose options (retrieve documents; look for archived copies; keep a copy of originals), **Start search**. Progress is announced in a polite status region (at most every ten seconds, and on every change of state). **Pause**, **Resume**, **Cancel** are real buttons. At the end focus moves to the coverage report heading. A cancelled or limit-stopped search offers **Continue this search**, which does not repeat finished pages or documents. Earlier searches in the case are listed with **Show report**.

**Extension.** The same screen, in My Research. The first time for a site, the browser asks for permission to read that site (an optional host permission, per site, revocable). The panel then fetches directly, so **no Worker requests are used for fetching**; only archive lookups use the Worker.

## Tests (all local; no real website is contacted by any test)

| Command | Result |
|---|---|
| `npm test` | 181 passing (37 Phase 0 discovery tests + 26 Phase 1 tests + the earlier suites) |
| `npm run test:discovery` | 63 passing |
| `node scripts/test-discovery-ui.mjs` (website UI; needs `wrangler dev --port 8791 --var DISCOVERY_ALLOW_PRIVATE:127.0.0.1:8790 --var DISCOVERY_IP_PER_MINUTE:5000 --var DISCOVERY_HOST_PER_MINUTE:5000`) | 74 checks passing |
| `node scripts/test-discovery-extension.mjs` (Chrome for Testing; needs the Worker on 8791 only because the panel is pointed at it) | 28 checks passing |
| Existing browser suites re-run after the change: `test-discovery-browser` (26), `test-extension` (9), `test-portable-browser` (14), `test-views-browser` (56), `test-ask-browser` (16), `test-a11y` (axe sweep clean), `test-a11y-deep` (128), `test-a11y-modes` (146), `test-contrast` (132) | all passing, same counts as before |

What the Phase 1 tests cover, against the brief: robots compliance (disallowed documents never requested; Allow/Disallow; Crawl-delay gaps of at least 10 s asserted between page and document requests in fake time); request limits and the cost guard (requests, pages, documents, bytes, archive lookups, website-mode fetches never exceeded, and the stop is announced); cancel and resume (what was retrieved is kept; finished documents are not requested again; the one legitimate repeat is a redirect target); pause (no request while paused); duplicate content; broken links (404, 403, 500, timeout, sign-in page returned as a document, partial download); redirects (followed hop by hop, to a private address refused, to a loopback address blocked by the extension's network rule); coverage classification and wording (no sentence claims a record does not exist; hostile text is escaped; only http(s) is linked); saving (one record per content, other addresses kept, provenance fields, originals not copied by default, saving twice adds nothing); import/export (runs and ledger travel; importing twice adds nothing; a file without the new lists still imports); database upgrade from version 10 (a case saved with the previous module opens intact); the Worker proxy (SSRF, registry, ack, robots, redirects not followed, size/type caps, rate limits, robots reuse); host policy (Copperas Cove contacted zero times even with an acknowledgment); the connector listing-call gate; screen behaviour (labelled field, errors as text tied to the field and announced, focus management, keyboard-only Pause/Resume/Cancel/Continue, 320/375/768/1024/1440 px, 44 px targets, axe in dark and light, WCAG text spacing, forced colors, reduced motion).

Bugs the tests found and I fixed in this phase: one oversize network rule meant the extension's identifying User-Agent and private-redirect block were silently not installed (found by the extension test; now several small rules, each installed and logged separately); an unset option overriding the engine's clock default; the continue button had no address to continue from; the Worker asked a site for `robots.txt` a second time; a coverage line for web archives that read as a gap when no lookup had been needed.

## CivicPlus access findings

Detail in `docs/CIVICPLUS_VERIFICATION.md` ("Phase 1 re-verification"). Short version: `robots.txt` allows the agenda and document paths (Crawl-delay 10); the CivicPlus Terms of Use restrict automated systems and access by non-provided interfaces, define "Site" as CivicPlus's own websites, and **do not say whether a city's CivicPlus-hosted site or its visitors are covered**; the city asserts copyright and states nothing about automation; no permission, export or API was found. **Not verified as permitting automation, so Copperas Cove retrieval stays disabled** (engine and Worker both refuse it; tested). The reusable adapter interface exists and is tested. Next step is Mari's decision (ask in writing, accept a recorded risk, or user-directed capture only); suggested request text is in the verification note.

## Live-source validation: what was authorized, what was skipped

Authorization basis: Mari's approval of "a small, permitted live-source validation". I treated "permitted" as: robots.txt allows it, the site's own published policy does not forbid it, and the content is a public record the owner may reuse.

| Source | What I did | Basis / reason |
|---|---|---|
| **www.archives.gov** (U.S. National Archives) | **Ran** one tiny live search (website mode, through the local Worker): 8 requests, 73 s, depth 1, caps 5 pages / 4 documents. | Federal agency. Its privacy and copyright notice says materials produced by Federal agencies are generally in the public domain (CC0 for the site's works), "not all materials ... are", and contains no prohibition on automated access (it asks people to link rather than mirror). `robots.txt` allows the pages with `Crawl-delay: 10`, which was honored (gaps of 10 to 11 s). |
| comptroller.texas.gov, www.govinfo.gov, www.federalregister.gov | `robots.txt` read only (one request each) while choosing a source. **Not searched.** | Terms for automated use not read; not needed once archives.gov was chosen |
| www.gao.gov | `robots.txt` read only. **Skipped.** | `Crawl-delay: 420` (7 minutes) is more than the 60 s this tool will wait; the engine would report it "too slow to search" rather than go faster |
| www.cbo.gov | `robots.txt` request answered 403 with a bot-challenge page. **Skipped; not circumvented.** | Access control |
| **copperascovetx.gov, civicplus.com** | **No request from Chronium.** (The CivicPlus terms page was read through a page-reading tool, as a person would.) | Permission uncertain (above) |
| emma.msrb.org | Not contacted | `link-only` in the registry |
| web.archive.org (Wayback availability) | During development the UI and extension tests reached it through the local Worker with fixture addresses (roughly twenty availability lookups, all answered "no copy", which also showed the endpoint works from this machine). **The tests now stub it**; nothing sensitive was sent. | Public availability API; the Worker's own code path |

## Real examples of records discovered

From the live run (www.archives.gov, 2026-10-23 20:47 to 20:49 UTC, seed `https://www.archives.gov/records-mgmt/policy/transfer-guidance`):

- Redirect handled hop by hop: `/records-mgmt/policy/transfer-guidance` (HTTP 302) to `.../transfer-guidance.html` (200).
- Pages followed: `/`, `/citizen-archivist`, `/contact`.
- **Document retrieved:** *Records Management Glossary of Terms*, `https://www.archives.gov/records-mgmt/rm-glossary-of-terms.pdf` (a 301 to `/files/records-mgmt/rm-glossary-of-terms.pdf`), 473,745 bytes, retrieved 2026-10-23T20:48:59Z, SHA-256 `30576758da5df0cd0c329af2b7b30b7adf098d9f9f68520cc2a54b51f6ff994e`, saved as a source with both addresses and all provenance fields.
- Stopped honestly: "60 more pages were found beyond the page limit and were not queued".

(The live run was done in Node, which has no PDF text extractor loaded, so no text was extracted from the PDF there; in the website the existing ingestion adapters extract PDF, DOCX, XLSX and text, in the extension plain text and CSV only and the rest says so.)

## Coverage report example

Local fixture site, fake clock (so the retrieval times are artefacts), archive lookups answered by a stub. Shown as the report's plain-text form; the screen shows the same facts as accessible tables.

```
COVERAGE REPORT
1 source fully searched of 2 planned. 16 document links found, 9 retrieved, 1 historical copy found.

Where Chronium looked:
  Official website: records.example.gov: Partially searched (13 completed, 6 could not be completed)
  Web archives (historical copies of documents that could not be retrieved): Searched (4 requests completed)

Retrieved (9):
  https://records.example.gov/docs/agenda-2024-03-12.pdf
    Agenda; retrieved ... UTC; sha256 f3a4450ad9260dec03fe97ac14cabdcdefa5c4cc2c64e580b917dc4ab91b3ce8
  https://records.example.gov/docs/agenda-copy.pdf
    Agenda; ...; sha256 f3a4450ad926...; same content as https://records.example.gov/docs/agenda-2024-03-12.pdf
  ... (7 more)

Historical copy found (1):
  https://records.example.gov/docs/missing.pdf
    Other document; the site answered "not found" (HTTP 404)
    archived copy: https://web.archive.org/web/20230101000000/https://example.gov/docs/missing.pdf (captured 2023-01-01) via Wayback Machine

Source unavailable or search incomplete (3):
  https://records.example.gov/docs/error500.pdf
    the site reported an error (HTTP 500); web archives consulted: no copy found
  https://records.example.gov/docs/slow.pdf
    the site did not answer in time; web archives consulted: no copy found
  https://records.example.gov/docs/login.pdf
    a web page came back instead of the document (possibly an error or sign-in page); nothing was saved

Access restricted (3):
  https://records.example.gov/docs/forbidden.pdf          the site refused access (HTTP 403)
  https://records.example.gov/docs/redirect-private.pdf   a redirect led somewhere that is not allowed
  https://records.example.gov/private/blocked.pdf         robots.txt asks automated tools not to fetch this

What remains unknown:
  Chronium only follows links that pages on the site publish. A record that no page links to, or that sits behind a login, a search form or a script, is not seen and is not counted here.
  "Not located" and "unavailable" describe this search only. They are not evidence that a record is missing, was destroyed, or never existed.
  Scanned pages and images are saved but cannot be searched until text recognition is added.
```

## Measured costs

| What | Measured |
|---|---|
| Worker requests, website mode | **Exactly one per request made to the site, plus one per archive lookup.** Live run: 8 requests to the site = 8 Worker requests, 0 lookups. Local UI run: 20 + 4 lookups = 24. Capped at 25 for a run started from the website (plus up to 25 lookups). Extension mode: **0 Worker requests for fetching**; only archive lookups (cap 25). |
| Worker storage | **0 KV writes, no D1/R2.** The Worker uses the Cache API only: `robots.txt` per site (24 h), archive answers per address (24 h; not cached when the archive is unreachable), and 90-second rate-limit counters. |
| Worker CPU / memory | **Not measured.** (Local `wrangler dev` does not report it; the per-request work is a fetch, a size-capped read and header copying.) |
| Browser storage (IndexedDB, on the person's device) | Local fixture run, 6 small documents + 1 archive record + run + ledger: about **52 KB** growth. Live run: ledger 9 rows, 3.4 KB; the PDF's text and fingerprint are kept, **the 474 KB original is not copied** (reference only) unless the person opts in. Storage for a full 100-document run with extracted text is **not measured**; the Phase 0 synthetic measurement of a default-cap page crawl was a 53 KB ledger. |
| Time | Set by the site: archives.gov, 8 requests in 73 s at its 10 s Crawl-delay. A default-cap run (150 pages + 100 documents) at a 10 s delay is roughly 40 minutes; at the 3 s floor, 13 minutes. |

`docs/COST_DRIVERS.md` has the updated rows.

## Remaining limitations

- **CivicPlus / Copperas Cove automation is not enabled** and no list parser exists (see above). Other CivicPlus cities are not special-cased; the generic engine follows their static links only, and the agenda list that loads by script is not seen (the report says so).
- **Archive coverage is one archive** (Wayback availability: the closest capture). Arquivo.pt and Memento lookups are not implemented because their responses could not be verified. archive.org answered from this machine today (HTTP 200 on its availability API, directly and through the local Worker), so the August note that it was unreachable no longer held on 2026-10-23; reachability can vary, and an unreachable archive is always reported as "could not be reached", never as "no copy".
- **JavaScript-only pages** are not run: lists built by script are not seen.
- **Text extraction**: website uses the existing adapters (PDF, DOCX, XLSX, text, email); the extension panel extracts text and CSV only. Scanned pages are not OCR'd.
- **User-Agent and private-address rules are Chromium-only** (declarativeNetRequest). Verified in Chrome for Testing. A site that rewrites the User-Agent at its own edge cannot be helped.
- **Website mode is deliberately small** (25 fetches), and the Worker is shared, so its per-site pacing is best-effort across users (a per-site-per-minute ceiling exists).
- **"Continue" counts as the same run** for the daily run limit (it does not use one of the 3 runs); the per-host daily request ceiling of 500 still applies.
- **A continued search shows its own report**: it covers only the work done in the continuation (the earlier part keeps its stored report under "Earlier searches in this case"); the saved sources of both parts are in the case together.
- **`/api/fetch` is a small guarded proxy, not an open one**, but anyone can call it directly: it answers only same-origin browsers (no cross-origin headers are sent), refuses private addresses, blocked hosts and robots-disallowed paths, never follows redirects, sends no cookies, and is limited to 40 requests a minute per visitor and 30 a minute per site. A hostname that resolves to a private address cannot be detected without DNS lookups; the Worker cannot reach private networks.
- **The site's pages can change** between runs; hashes are of the bytes as served.
- **The permission prompt for a new site in the real extension is not automated-tested** (the test copy of the extension pre-grants the test site). Check it by hand.
- Classification is a hint from words; it can be wrong, and says what it was based on.
- Nothing here is legal advice; terms are read and recorded per source.

## Manual checks still needed (not claimed as done)

NVDA and VoiceOver reading the progress announcements and the tables; a real touch device; real Windows High Contrast; the extension's per-site permission prompt in ordinary Chrome; a second look at the CivicPlus terms by a person. The checklist in `docs/MANUAL_A11Y_TESTS.md` has the new items. No WCAG conformance claim is made.

## Decisions waiting for Mari

1. CivicPlus / Copperas Cove: ask in writing, accept a recorded risk, or user-directed capture only.
2. Push the Phase 1 commit(s) (not done), and, separately, deploy (not done; the live site is unchanged).
3. Whether to add a more specific "this site only" path scope to user-directed discovery (today the search area is the pasted address's whole registrable domain).
