# Controlled release plan: the features built since the August production baseline

Status: **PLAN. Nothing in it is deployed or approved.** Written 2026-10-23. Production runs the 2026-08-28 app (commit `d80ef66`) plus the `/crawler` page (version `60045ea5-992c-499e-8290-a8ef08572667`; rollback target for that release `799e564e-59ed-4b7a-b610-4f7f88d2428f`). This plan covers everything after that baseline. It follows the Bootstrap Rule (free-only, no accounts, no billing).

## 1. Inventory: what exists in the repository but not in production

42 commits, 420 files, about 46,000 added lines since `d80ef66`. By area:

| Area | What | Touches the Worker | Touches the browser data (IndexedDB) | Extension |
|---|---|---|---|---|
| Archive Viewer, search-to-evidence, Coverage Verdict (593adbd, a8ac226, 46d551c) | `/api/view-capture` proxies archive captures; a coverage verdict per provider | **Yes: new public route** | no | partly |
| Workspace simplification, research methodology, AI-assisted analysis (132844a, 8b22ea5) | 4-section workspace, outline, bibliography, quantitative and qualitative findings | existing `/api/analyze/qualitative` | yes (stores) | no |
| Ask Sources and Discover Sources (98509dc) | `/api/analyze/ask-sources` (optional AI), `/api/search` changes | **Yes: new public route that can call a paid AI** | yes | no |
| Entities, mentions, claims, findings, bulk ingestion and review queue (8e525ac to e54f809) | the investigation workspace | no | yes (many stores) | no |
| Ask Chronium router, three views, light theme, case export/import (1df0052, daad2cb, 2167c12, 0a36c33) | deterministic, local | no | yes | yes (synced) |
| Chromium side-panel extension (a1a16ad onward) | search, cases, views, discovery, recovery | uses the Worker's `/api/search` | its own | **the extension** |
| Deep Discovery Phases 0 and 1 (408b366, 32aeebd) | engine, Find Records tab, runs and ledger | **Yes: `/api/fetch` and `/api/captures` (new public routes)** | yes (v11) | yes |
| Records Recovery Phase 3 (3cc2682) | gap detection, requests, decisions, report appendix | no | yes (v12) | yes (summary, report) |
| Crawler policy page (deployed) | `/crawler` | no | no | no |

Worker code: only `src/index.js` (modified: archive viewer, Ask Sources, search, discovery routes) and `src/discoveryProxy.js` (new). Front-end: 47 files; extension: 44 files.

## 2. Security review of the public Worker routes

Reviewed by reading `src/index.js` and `src/discoveryProxy.js`. Tested behaviour is noted; "code-read" means I have not exploited it.

### 2.1 Findings that must be fixed before any release (blockers)

| # | Finding | Severity | Detail and fix |
|---|---|---|---|
| **B1** | `/api/view-capture` serves third-party HTML from Chronium's own origin with **no Content-Security-Policy and no sandbox header** (code-read: the only sandbox is the app's own `<iframe sandbox>`; a direct link to the route renders the page with scripts) | **High** | Anyone can create an archived page containing a script (the Internet Archive accepts submissions), then send a person a link to `/api/view-capture?url=<that capture>`. The script would run on Chronium's origin and could read that person's investigations from IndexedDB. **Not in production today** (the route is 404 there). Fix: send `Content-Security-Policy: sandbox` (no `allow-scripts`) and `X-Content-Type-Options: nosniff` on every response of this route (the `/api/fetch` proxy already does). Also change `redirect: "follow"` so a redirect that leaves the archive hosts is refused. Add an HTTP-level test that a hostile capture cannot run script |
| **B2** | `/api/captures` has **no rate limit**; neither route has abuse protection beyond a per-colo best-effort counter | High for availability | See 2.3. Fix: limits on `/api/captures`; same-origin enforcement; a Cloudflare rate-limiting rule; kill switch |
| **B3** | One-way database door: opening the new site upgrades each browser's IndexedDB from **version 4 to 12**. **A browser that has upgraded cannot be taken back to the old site code**: the old code requests version 4 and the browser refuses (tested: the old module throws a version error). Data is not lost, but the old app cannot open it | High for rollback | Fix/mitigate: (a) rollback target after release is the last good **new** version, never the old app; (b) a one-time on-screen notice, before the first upgrade, offering "Download a backup of all my cases" (export of every case), tested; (c) staging first |
| **B4** | Old bookmarked links break quietly: `#/workspace/sources`, `claims`, `timeline`, `gaps`, `outline`, `analysis` now open the Research panel with **no tab marked as selected**; `#/workspace/overview` now means a different page; `#/bibliography` goes home | Medium (usability, accessibility) | Fix: a redirect table (sources to Research, claims/timeline/gaps to Findings, outline to Findings, analysis to Findings, bibliography to Evidence) and always mark the current tab |
| **B5** | Public AI endpoints (`/api/analyze/qualitative` already live; `/api/analyze/ask-sources` new) can spend a paid key and have **no per-visitor limit** (only input and token caps and a 30-minute cache) | Medium (cost) | Fix: per-visitor and global daily ceilings; a hard daily token ceiling that switches the endpoint to "unavailable"; keep AI opt-in. The Bootstrap Rule forbids an uncapped paid dependency |
| **B6** | The discovery proxy's CPU time per request is **unmeasured** on the real edge. The Workers free plan allows about 10 ms of CPU per request; reading and copying a 10 MB body may exceed it | Medium | Measure on a staging Worker with large PDFs (see stage 1); if needed, lower the body cap (for example 4 MB) or stream |
| **B7** | Test-only environment variables exist in the Worker (`DISCOVERY_ALLOW_PRIVATE`, `DISCOVERY_IP_PER_MINUTE`, `DISCOVERY_HOST_PER_MINUTE`, `DISCOVERY_UPSTREAM_TIMEOUT_MS`). If one were ever set in production, private addresses or limits would be relaxed | Medium | Fix: ignore them unless a second explicit variable `DISCOVERY_TEST_MODE` is set; add a release check that `wrangler.jsonc` and the deployed version's variables contain none of them |

### 2.2 `/api/fetch` and `/api/captures`: SSRF, DNS, redirects, private networks

What is in place and tested (`scripts/test-discovery-phase1.mjs`, 26 tests):
- **Address guard** (`urlGuard.js`): http and https only; no credentials; ports 80 and 443 only; private, loopback, link-local, carrier-grade, multicast and metadata addresses refused in every spelling (decimal, hex, octal, shorthand IPv4; IPv6 including IPv4-mapped); single-label and local names refused.
- **Redirects are never followed** by `/api/fetch`: the caller receives the 3xx and `Location`, and the engine decides, one hop at a time, with every hop re-checked and re-evaluated against robots.txt and the host registry.
- **Host registry and robots.txt are enforced on the server too**, so the proxy cannot be used to route around the engine's policy (CivicPlus and EMMA hosts return 403 `policy-refused`; robots-disallowed paths return 403).
- No cookies sent or returned; response `Content-Security-Policy: sandbox`, `X-Content-Type-Options: nosniff`; no cross-origin (CORS) headers; image, audio, video and executable types refused; 10 MB and 10 s caps; GET only; the User-Agent identifies Chronium.

Residual concerns:
- **DNS-based tricks cannot be checked by pure code.** A public hostname that resolves to a private address, or resolves differently on a second lookup (DNS rebinding), passes the string checks. The Workers runtime does not let a Worker reach private networks or its own host, which is the main protection, but it is a platform assumption, not a tested control. Defence in depth for stage 3: resolve the name through Cloudflare's DNS-over-HTTPS (an extra subrequest) and refuse private answers; still subject to a time-of-check gap.
- **The person's acknowledgment (`ack=1`) and `seed=1` are claims by the caller**, not facts the server can verify. Effect: the registry blocks only listed hosts; any unlisted public site that allows robots is fetchable by anyone who adds `ack=1`. Mitigation options: an allow-list for the first release (hosts that a person has pasted via the app; cannot be verified server-side), or accept and rely on rate limits and robots. `seed=1` lets a caller fetch a page on a site whose robots.txt is unreachable; low impact.
- **Open-proxy abuse and quota exhaustion.** Anyone can call the routes directly (curl). They return bodies up to 10 MB and each call is a Worker request. An attacker can burn the free daily request allowance (100,000) and so take the whole app down for the rest of the day. The existing per-visitor counter lives in the Cache API **per data centre**, is read-modify-write (not atomic), and is keyed by `CF-Connecting-IP`; many addresses defeat it.
- **Rate-limit design gap:** `/api/captures` has none (B2). Archive lookups also forward Chronium's server address to the Internet Archive; heavy use could get that address throttled, which would also affect the existing Wayback search connector.

### 2.3 Abuse controls proposed (all free, no accounts)

1. **Same-origin enforcement** on `/api/fetch`, `/api/captures`, `/api/view-capture`: require `Sec-Fetch-Site: same-origin` (or a matching `Origin`) from browsers. Stops other websites from using a visitor's browser; does not stop curl.
2. **Cloudflare rate-limiting rule** (dashboard; the free plan includes a small number of rules) on `/api/*`: for example 60 requests per minute per IP, then challenge. This is account configuration, not code; it must be set and checked at release time.
3. **Global daily ceilings in the Worker** for the three proxy routes and the two AI routes, counted in the Cache API per colo plus a coarse global estimate; when reached, answer 503 "unavailable today" (no KV writes needed; KV's free write allowance is about 1,000 a day).
4. **A kill switch**: a Worker variable `DISCOVERY_PROXY=off` makes `/api/fetch` and `/api/captures` answer 404, and the website's Find Records tab says the feature is available in the extension only. Changed from the dashboard (instant new version) without a code release.
5. **Turnstile** (free, no account for visitors) as a later option if abuse appears; it needs a site key and changes the user experience, so it is not part of the first release.
6. **Keep the Worker stateless and credential-free**: no cookies, no secrets in responses; the Anthropic key stays a secret binding.

## 3. Worker limits and cost under the Bootstrap Rule

Estimates unless marked measured. Free-tier figures are from memory of Cloudflare's published limits and **must be re-checked in the dashboard before relying on them**.

| Resource | Limit (Workers free) | Use by the new features | Verdict |
|---|---|---|---|
| Requests | about 100,000 a day for Worker invocations; static asset requests do not count when not routed through the Worker | `/api/*` only. One website discovery run: up to 25 fetches + up to 25 lookups = at most 50 requests, at most 3 runs a day per browser. Measured: live run 8 requests, test run 24 | 100 daily users at 3 runs is at most 15,000 a day, 15% of the allowance, before any abuse. Abuse (2.2) is the real risk, hence the ceilings |
| CPU time | about 10 ms per request | **Unmeasured** for large bodies (B6) | Measure on staging; lower the body cap if needed |
| Memory | 128 MB | A 10 MB body is held about twice while copying: about 20 MB | Fine |
| Subrequests | 50 per request | Proxy: at most 2 (robots.txt, target) | Fine |
| KV | about 1,000 writes a day | **No new KV writes** (Cache API only) | Fine |
| Cache API | per data centre | robots.txt 24 h, archive answers 24 h, 90-second counters | Fine; not shared across data centres |
| Bandwidth | no per-GB charge on Workers; but each website discovery run can move up to 25 x 10 MB through the Worker | Bounded by the caps | Fine; watch totals |
| AI | pay per token | Existing opt-in endpoint plus Ask Sources | **B5**: needs ceilings |
| Third parties | the Internet Archive and each searched site | Politeness rules in the engine (Crawl-delay, serial, back-off, 500 requests per site per day per browser) | Acceptable; monitor for 429s from archives |

Expected monthly cost for a small user base: **$0**. The first money risk is AI usage; the first availability risk is request-quota exhaustion by abuse.

## 4. Compatibility

| Check | Result |
|---|---|
| A browser holding production data (database **version 4**, commit `d80ef66`) opens with the current code (**version 12**) with the case, sources, evidence, claims (including the one-time claim-evidence backfill) and outline intact; Big Picture, Records Recovery, case export and the new stores work on it | **Pass** (`scripts/test-upgrade-from-production.mjs`, new, in `npm test`) |
| Upgrades from versions 10 and 11 | Pass (existing tests) |
| After the upgrade, the old (production) code cannot open the database (browser version error) | **Confirmed by test** (B3) |
| Case files: older `.chronium.json` without the new lists import; files with them import twice with no change; a newer file is refused by an older app with a clear message | Pass |
| Old bookmarked routes | **Gap** (B4) |
| Static assets: the new app loads `citations.js`, `artifacts.js`, `discovery/*`, `recovery/*`, `views.js`, etc. A release must upload all of them together with `index.html`; a partial upload breaks the app | Release check: the verifier must list every file the new `index.html` and its imports reference and confirm 200 |
| Service worker / caching | The site has none; assets are `max-age=0, must-revalidate`, so users receive the new files on the next load |

## 5. Testing required before and during release

Website and extension, using the suites that exist (all pass today, listed in `docs/CLAUDE_HANDOFF.md`): `npm test` (222), discovery UI (74), discovery extension (28), recovery UI (75), discovery browser (26), extension smoke (9), portable (14), views (57), ask (16), a11y (37, 128, 146), contrast (132), upgrade-from-production (1).

To add before stage 1 (not yet written): HTTP-level security tests run against `wrangler dev` and then against staging: CSP/sandbox and nosniff on every route that returns third-party content (including a capture containing a script); same-origin enforcement; rate-limit and ceiling responses; the kill switch; `Location` on a redirect to a private address is returned but never requested; test variables ignored unless test mode; old-route redirects; the backup notice.

## 6. Accessibility limits and manual tests still outstanding

Automated and emulated checks pass (axe WCAG 2.0 to 2.2 A/AA, keyboard walks, 400% zoom, forced colors, text spacing, reduced motion, contrast). **Not done:** NVDA, VoiceOver, a real touch device, real Windows High Contrast, and a person reading the new screens (checklists: `docs/MANUAL_A11Y_TESTS.md` sections A to J). **No WCAG conformance is claimed**, and the plan treats these as required before describing the release as accessible, not as release blockers for a staged beta that says so.

## 7. Staged rollout

Each stage has an exit condition and stops for Mari's approval. Nothing is deployed until she approves that stage.

| Stage | What | Exit condition |
|---|---|---|
| **0. Fixes** (code, local) | B1 to B7; a feature flag for the proxy routes; old-route redirects; the backup notice; new HTTP security tests; a release verifier that lists every referenced asset | All new and existing tests pass; a reviewer reads the diff of `src/` |
| **1. Staging** | Deploy to a **separate Worker** (`chronium-mind-staging` on workers.dev, its own KV namespace, flag ON) from the release candidate. Run every suite against the staging URL; measure CPU time, memory and latency with large PDFs through `wrangler tail`; hostile-capture test; abuse test with a request flood from one machine; confirm Cloudflare's dashboard shows the limits and the rate-limit rule | No test failures; CPU within limits (or body cap lowered); rate limits and kill switch work; no HTTP-level finding open |
| **2. Production A: no proxies** | Production gets the new front-end and all local-first features with `DISCOVERY_PROXY=off` (so `/api/fetch` and `/api/captures` answer 404 as today) and the fixed `/api/view-capture` and capped AI routes. Backup notice on. Website's Find Records says discovery is extension-only for now. Record before/after versions; the rollback target is the previous *new* version, never the old app (B3) | A week of monitoring with no errors above baseline; no quota pressure; reports from real use |
| **3. Production B: archive lookups** | Enable `/api/captures` (flag), with its limits | 48 hours of monitoring: request counts, 429s from the archive, error rate |
| **4. Production C: fetch proxy** | Enable `/api/fetch` for website mode with same-origin enforcement, the dashboard rate-limit rule, and global daily ceilings. Start with a small ceiling and raise it | A week of monitoring: no abuse pattern, CPU and bandwidth within limits, no complaints from any site (the policy page and contact address are live) |
| **5. Extension** | Only after the **real permission-prompt test** (`docs/RECORDS_RECOVERY_PLAN.md` section 13) and a manual accessibility pass; packaging and store review (broad optional host permissions need a written justification) are separate and need their own plan | Documented manual result |

The Copperas Cove / CivicPlus block is independent of all stages and stays in place until a written answer is recorded.

## 8. Monitoring, rollback and recovery

**Monitoring (free tools):** the Cloudflare dashboard's Worker metrics (requests, errors, CPU time percentiles, subrequests) with the daily total checked against 100,000 (act at 50%); `wrangler tail` during the first hours of each stage; the Workers logs; the verifier script run after each deployment and daily for a week; a check of `/api/ai/usage`; watching for 429 responses from the Internet Archive and from searched sites; the contact mailbox on the policy page.

**Rollback, by situation:**
1. **Worker or flag problem (proxy routes, AI routes, abuse):** set the kill switch (`DISCOVERY_PROXY=off`) or lower the ceilings from the dashboard; or `wrangler rollback <last good new version>`. Takes seconds. No user data is involved: the server stores nothing about cases.
2. **Front-end problem:** `wrangler rollback` to the previous new version (static assets are part of a version). **Do not roll back to the old app** after stage 2: browsers that already upgraded cannot open their data with it (B3). If that were ever unavoidable, users restore from their backup or exported case files into a fixed new version.
3. **Platform or account problem:** redeploy from the release tag; the repository is the source of truth.

**Recovery of user data:** all case data lives in each person's browser. The backup notice, the export button and `.chronium.json` are the recovery path. The release must not remove or change export/import.

**Release tags and records:** each stage records the version id before and after, the exact git commit, the verifier output and the date in `docs/` (as was done for `/crawler` in `docs/CRAWLER_PAGE_RELEASE.md`).

## 9. Decisions needed from Mari

1. Approve stage 0 (implementation of the fixes B1 to B7 and the flag). The security fixes are small except the backup notice and the rate-limit design.
2. Cloudflare staging: approve creating a separate staging Worker and KV namespace under the same account (no cost).
3. Rate-limit rule: approve configuring a Cloudflare rate-limiting rule on `/api/*` (dashboard setting; she or I with her authentication).
4. Whether the first public release should include the website's Find Records at all (stage 4), or ship the website without it and keep discovery extension-only until the extension's permission-prompt test is done.
5. AI ceilings: the daily token ceiling for the optional AI features.
