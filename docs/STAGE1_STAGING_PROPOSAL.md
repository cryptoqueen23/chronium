# Stage 1 proposal: an isolated staging Worker and measured, controlled test traffic

**Status: PROPOSAL FOR REVIEW. Nothing described here has been created, deployed or switched on.** Written 2026-10-26. Facts about Cloudflare and Anthropic below were read from their official documentation on that date (links in section 12); anything I could not confirm is marked **UNVERIFIED** and is a test to run, not a claim.

Standing limits that apply to everything here: no production deployment; no use of Copperas Cove or CivicPlus (or any real government site) as a test target; both CivicPlus letters stay unsent; Copperas Cove automation stays blocked in the code; the staging Worker is created only after this document is approved.

## 1. Identity and isolation

| Item | Production (today) | Staging (proposed) |
|---|---|---|
| Worker name | `chronium-mind` | `chronium-mind-staging` (already in `wrangler.jsonc` `env.staging`) |
| Hostname | `chronium-mind.truewolfflix777.workers.dev` | `chronium-mind-staging.truewolfflix777.workers.dev` (no custom domain) |
| KV namespace | production `CONNECTOR_HEALTH` | a **new** namespace created with `wrangler kv namespace create CONNECTOR_HEALTH --env staging`; the placeholder id is replaced; the validator refuses to deploy while it is a placeholder or equals the production id |
| Secrets | `ANTHROPIC_API_KEY` (production) | **none** by default. For the AI phase only: a separate key from a separate Anthropic workspace with its own low monthly spend cap (section 6) |
| Variables | `ENVIRONMENT=production`, all switches off | `ENVIRONMENT=staging`, all switches off at creation; switched on one at a time per the test plan, only on staging, and only by `wrangler` vars recorded in the test log |
| `TEST_MODE` / `DISCOVERY_ALLOW_PRIVATE` | refused by the validator | **not set** on staging either. Staging behaves like production code; its fixtures are public hosts (section 3), so no test-only bypass is needed |
| User data | none on the server (cases live in each browser) | none; staging uses its own origin, so its browser storage is separate from the live site's |
| Fixtures | n/a | a **second** Worker `chronium-fixtures-staging` (own name, no KV, no secrets, serves only fixed fixture responses; section 3) |

Things to know about this account layout:
- `workers.dev` is on the Public Suffix List (checked), so the registrable domain of both Workers is `truewolfflix777.workers.dev`. Staging and production are **different origins** (separate IndexedDB, localStorage, cookies are host-only) but the **same site**. This is enough to keep staging data separate from production data. It is not a security boundary between them, which is why staging holds no production secret.
- Both Workers are in one Cloudflare account. The Free plan's daily request allowance (100,000 per day) is documented per plan; I believe it is counted per account, **UNVERIFIED**. A test that burns the allowance could take the live site down with Error 1027 until midnight UTC. The test plan therefore has a hard budget of 2,000 requests per day across staging and fixtures, and aborts at that number (section 8).
- Disabling `workers.dev` is per Worker; a dashboard-only disable is undone by the next deploy unless `workers_dev = false` is in config. Preview and version URLs stay reachable regardless. Staging should not be left deployed between test sessions (section 9).

## 2. Default-off endpoints

All five switches are `off` in the committed `env.staging` block (`FEATURE_DISCOVERY_FETCH`, `FEATURE_DISCOVERY_CAPTURES`, `FEATURE_VIEW_CAPTURE`, `FEATURE_ASK_SOURCES`, `AI_ENABLED`). A switched-off route answers `404 {"error":"not-available"}` to every request, tested on real workerd (`scripts/test-stage0-http.mjs`). The smoke test after the first deploy repeats that against the real edge before anything is enabled: every guarded route must return 404, `/api/features` must report all `false`, and `/api/health` must return 200.

## 3. Test fixtures (a separate fixture Worker, plus local-only cases)

A public fixture host is needed because staging cannot reach `127.0.0.1` and must not be given a test-only bypass. `chronium-fixtures-staging` serves fixed, harmless responses and nothing else. It makes no outbound requests. Proposed paths:

| Case | Fixture | Expected result from staging |
|---|---|---|
| Robots | `/robots.txt` (allow-all), `/disallowed/` (disallowed), `/crawl-delay/` (Crawl-delay: 10) | disallowed refused; delay honoured |
| Large files | `/bin/1`, `/bin/5`, `/bin/10`, `/bin/11`, `/bin/50` MB; the same with and without `Content-Length`; chunked | up to 10 MB served; larger cut off at the cap and marked truncated; memory does not grow past the cap |
| Timeouts | `/hang` (never answers), `/trickle` (1 byte every 2 s), `/slow` (answers after 8 s) | upstream timeout fires; 504; no stuck connection |
| Concurrency | `/slow` hit by 6 and by 12 simultaneous requests | 4 served, the rest `busy` (429); see also the Free plan's 6-connection limit |
| Redirects | `/r/1` to `/r/5` chains, a loop, redirect to another fixture host, redirect to `http://127.0.0.1/`, to `http://169.254.169.254/`, to `file:///`, to `data:` and `javascript:` | at most 3 hops; every hop re-validated; private and non-http targets refused |
| Private address attempts (no fixture needed) | literal `127.0.0.1`, `[::1]`, `10.0.0.1`, `169.254.169.254`, `0x7f000001`, `2130706433`, `127.1`, `localhost`, a name that resolves to loopback | all refused before any connection. Names that resolve to private space need a name I control: **UNVERIFIED** until a custom domain exists; otherwise a public wildcard-DNS service such as `localtest.me` (resolves to 127.0.0.1; the request never leaves Cloudflare if the guard works) can be used and is noted as a third-party name |
| DNS change between check and connect | needs a name whose A record I can change quickly | **cannot be tested** without a custom domain and DNS access; recorded as an accepted residual risk (STAGE0_SECURITY section 8, item 3) unless a custom domain is approved |
| Hostile HTML | `/html/script` (inline script, `onerror`, `javascript:` links), `/html/meta-refresh`, `/html/base`, `/html/iframe-nest`, `/html/form-post`, `/html/huge` (about 1.9 MB of links, over the 2 MB page cap variant too), `/html/links-50000` | text and links extracted; nothing executes; link and page caps hold; viewer renders in the sandboxed frame with no script |
| Archive viewer | not a fixture (the viewer only proxies the known archive hosts). It is tested against **one** public Wayback capture, a handful of requests, plus local tests for the host check | unchanged behaviour; sandbox and navigation checks hold |
| Policy | a fixture host is not in the host registry, so tests send `ack=1`; the Copperas Cove and CivicPlus hosts are **never** requested, only checked for refusal with zero outbound requests (existing unit test) | |

Also unchanged and still run locally on every change: the full `scripts/test-stage0-http.mjs` (56 checks on real workerd + Chrome).

Browser requirement: the Worker refuses any request without `Sec-Fetch-Site: same-origin`. Controlled traffic therefore comes from a **real Chrome page loaded from the staging origin** issuing `fetch()` (puppeteer, which the repo already uses), not from `curl`.

## 4. Rate-limit proposals (concrete numbers, and what each plan allows)

Verified from Cloudflare's documentation (2026-10-26): **WAF rate limiting rules**: Free = 1 rule, counting by IP only, counting period 10 s only, mitigation timeout 10 s only; Pro = 2 rules, periods up to 1 min, timeouts up to 1 h; Business = 5 rules; the rules are created **per zone**. A `workers.dev` hostname is not a zone I control, so these rules cannot be attached to it. That the WAF does not apply to `workers.dev` is **UNVERIFIED** (the documentation does not say either way), but I know of no way to attach a zone rule to it. **Consequence: the "Cloudflare dashboard rate-limit rule" assumed in Stage 0 (risk 1) is not available while the site lives only on `workers.dev`.** It needs a custom domain on a Cloudflare zone.

Three layers, in order of how firm they are:

1. **In-Worker counters (exists, free).** Per data centre and not atomic (STAGE0_SECURITY risk 2). Staging values (lower than production defaults, set by `LIMIT_*` variables, which production can only lower, never raise):

| Route | Per visitor per min | Per target site per min | Global per day | Concurrent | Max bytes |
|---|---|---|---|---|---|
| `/api/fetch` | 10 | 10 | 300 | 2 | 10 MB |
| `/api/captures` | 10 | 20 | 300 | 2 | 64 KB |
| `/api/view-capture` | 10 | 20 | 200 | 2 | 15 MB |
| AI routes | 3 | n/a | 10 (see section 5) | 1 | 64 KB |

   Proposed production values if features are ever enabled: the current built-in defaults (fetch 30/min/visitor, 30/min/site, 3,000/day, 4 concurrent; captures 30/60/3,000; view-capture 20/60/3,000; AI 6/min). Production would start at half of those and rise only on evidence.

2. **Workers Rate Limiting binding (needs no zone; needs a code change).** Windows can only be 10 s or 60 s; counted per Cloudflare location; approximate by design. Whether the Free plan includes it is **UNVERIFIED** (the documentation page does not say); the staging deploy will show it (a deploy with the binding either works or is rejected). Proposed: `fetch/captures/view-capture` 15 per 60 s per IP; AI 3 per 60 s per IP. Requires Wrangler 4.36 or newer and a small addition to `guard.js` (Stage 1 code change, to be reviewed before it is made).

3. **WAF rate-limiting rule (needs a custom domain on a zone).** Only worth doing if a custom domain is approved.
   - Free zone, 1 rule: path starts with `/api/` (guarded routes), more than 10 requests per 10 s per IP, block for 10 s. This is a flood brake only (the block lasts as long as the window, so a patient client still averages several requests per second); the app's own counters do the real limiting.
   - Pro zone, 2 rules (price **not verified here**; check the Cloudflare pricing page): rule A, `/api/fetch`, `/api/captures`, `/api/view-capture`, more than 20 per 60 s per IP, block 10 min; rule B, AI routes, more than 6 per 60 s per IP, block 1 h.

4. **Turnstile (human check), free.** Cloudflare's plans page lists it as free with unlimited challenges, up to 20 widgets and 10 hostnames each on Free. Some third-party pages mention a 1 million siteverify per month cap that I could not find in Cloudflare's own page (**UNVERIFIED**). It would sit in front of `/api/fetch` and the AI routes, needs a widget on the page, a token check in the Worker, and an accessibility review of the widget (WCAG 2.2: an accessible alternative is required). It is a decision for you (section 11), not a default.

## 5. AI ceilings and projected maximum spend

What the code does today (read from `src/index.js` and `src/ai/anthropic.js`): model `claude-haiku-4-5-20251001`, `max_tokens` 1,200, evidence text capped at 12,000 characters (about 3,000 tokens) plus the system prompt, question and context. I use **5,000 input tokens + 1,200 output tokens as the worst case per call**.

Anthropic pricing (their pricing page, 2026-10-26): Claude Haiku 4.5 is **$1 per million input tokens and $5 per million output tokens**. Worst case per call: 5,000 × $1/M + 1,200 × $5/M = $0.005 + $0.006 = **$0.011**.

| Setting | Per visitor per day | Global per day | Max spend per day (if every call is worst case) | Max per 30 days |
|---|---|---|---|---|
| Staging AI test | 3 | 10 | $0.11 | $3.30 |
| Proposed first production value | 5 | 50 | $0.55 | $16.50 |
| Alternative | 5 | 100 | $1.10 | $33 |

Caveats, stated plainly:
- The counters are per data centre and not atomic, so the true worst case can exceed the global ceiling by a small multiple (I would plan for 3×: $1.65 per day at the 50 ceiling). **The firm limit is the provider-side one:** set a monthly spend limit in the Anthropic console on a dedicated workspace for each of staging and production (staging: $5 per month). I cannot see your Anthropic console, so this is an action for you.
- The current Anthropic price list also shows Claude Haiku 5.5 at $0.10 and $0.50 per million tokens (10 times cheaper). Moving to it would be a code change plus a quality check of the answers; it is **not proposed here**, only noted.
- Paid AI stays off in production until you choose the two ceilings (Stage 0 decision; the code refuses to enable AI without both).

## 6. Secrets

Staging has none by default. For the AI phase only: create a separate Anthropic workspace and key with a $5 monthly cap, set it with `wrangler secret put ANTHROPIC_API_KEY --env staging` (it never goes in a file or the command history), run the AI tests, then **delete the secret** (`wrangler secret delete ... --env staging`) and revoke the key. The existing test already scans every response and header for the key and asserts it never appears.

## 7. Separate origin for archived HTML (design; recommendation: defer)

Today: the viewer fetches the capture through the Worker and renders it inside an `<iframe sandbox="" srcdoc=…>`. An empty `sandbox` gives the frame an opaque origin with scripts, forms, popups and top navigation all disabled, so archived code cannot read Chronium's IndexedDB or cookies even though the bytes pass through the app's origin. The Worker adds isolation headers (`nosniff`, `no-referrer`, `CORP: same-origin`, `Vary: Sec-Fetch-*`) and refuses direct navigations to the capture route.

A separate-origin design, if you decide you want it:
- **Second Worker** `chronium-captures` on its own hostname that serves only the archive-proxy route, with the known-archive-host allow-list, the same size, redirect and concurrency guards, and nothing else (no AI, no fetch proxy, no secrets, no KV).
- **Storage:** a different origin has its own IndexedDB and localStorage, so nothing from Chronium is reachable. Same-site is not enough against cookie scoping tricks (see below), so the stronger form is a different registrable domain, which requires a custom domain. On `workers.dev` the two Workers would be same-site but cross-origin.
- **Cookies:** the captures Worker sets none and strips any `Set-Cookie` from upstream. Chronium itself sets none. Requests to it use `credentials: 'omit'`.
- **CORS:** no `Access-Control-Allow-Origin` at all; the page embeds it in a frame, not via `fetch`, so no CORS access is granted. `Cross-Origin-Resource-Policy: cross-origin` is only set for frame embedding if needed.
- **CSP and framing on every response from the captures origin:** `Content-Security-Policy: default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:; frame-ancestors https://<main origin>; sandbox`, plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. Scripts are blocked twice (CSP and sandbox). The embedding frame keeps its own `sandbox` attribute without `allow-same-origin`.
- **Cost:** a second Worker is free; a different registrable domain costs a domain.
- **Recommendation:** the existing opaque-origin sandbox already stops the dangerous behaviour. A separate origin adds defence in depth against a browser sandbox bug or a future change that loosens the frame. Defer it until after the staging measurements; do it first if the site gets a custom domain anyway.

## 8. Measurement plan (actual Cloudflare Worker CPU, memory, requests, errors)

Traffic is generated by a puppeteer script from this machine, loading the staging origin in Chrome, with every request logged by the script itself (timestamp, route, fixture, status, bytes, duration) and saved as a JSON file. Hard budget: **2,000 requests per day across staging and fixtures**, a counter in the script that aborts at 1,800, and no parallelism above the stated concurrency tests. No load test.

Cases and counts (approximate): each large-file size (1, 5, 10, 11 MB) 20 times; HTML page 20; hostile HTML cases 5 each; redirects 5 each; timeouts 5 each; concurrency bursts of 6 and 12, 3 times each; refusals of every private-address form 3 times each; the limit-exhaustion test (drive one visitor past 10 per minute, confirm 429s and recovery); AI phase (only after a separate go-ahead): 10 calls.

Read from Cloudflare after each session (Workers & Pages → the Worker → Metrics; the documentation lists CPU time quantiles, wall time, **memory usage at P50/P90/P99/P999 per isolate**, requests, subrequests, and invocation statuses including "Exceeded resources" and "Worker threw exception"; history up to three months):
- CPU time per request, p50 and p99, per case, against the Free plan's **10 ms**. Because staging stays on the **Free plan**, exceeding the limit shows up directly as errors ("Exceeded resources"), which answers whether the Free plan is enough.
- Memory p99 against the **128 MB** isolate limit (the local measurement of 130 to 207 MB was a whole-process figure and cannot be compared).
- Request counts and error mix; confirm the number of requests Cloudflare reports matches the script's log (a check on both).

Outcome rules, decided now so they cannot be bent later: if CPU p99 for a 10 MB document is over 10 ms or memory p99 is over 100 MB on the Free plan, the website's document fetching **does not ship on Free**. The options are then to lower the byte cap, to move that one feature to the extension only, or to move the account to Workers Paid ($5 per month minimum; 30 million CPU ms included, then $0.02 per million; up to 5 minutes CPU per request). None is chosen without your approval.

## 9. Deployment procedure, smoke tests, observability, rollback, database recovery

Procedure (each step needs your go-ahead only where marked):
1. **[approval]** Create the staging KV namespace and the fixtures Worker, in that order; paste the namespace id into `wrangler.jsonc`.
2. `npm run validate:config` and `npm run deploy:staging` (validator first; staging must report `ENVIRONMENT=staging`, every switch off, no test-only variable, no production KV id).
3. Smoke test (off state): `/api/health` 200; all guarded routes 404; `/api/features` all false; static pages load; `/crawler` loads; the upgrade prompt appears for a seeded v4 browser profile.
4. Switch features on **one at a time** by redeploying staging with a single changed variable; after each, run that feature's fixtures, read the metrics, and switch it off again before the next.
5. Fixture Worker is deleted and staging is undeployed (or its switches left off) when a session ends.

Observability: Workers Logs are available on Free (200,000 events per day, 3-day retention; the documentation notes a pricing change from 2026-12-01 to be re-read before relying on it). Metrics as in section 8. Alert: none can be set up on Free that I have verified; the script's own log is the record.

Rollback: staging is disposable. For production later: before any production deploy record `wrangler deployments list` (current production version `60045ea5-992c-499e-8290-a8ef08572667`; the August-era version is `799e564e-59ed-4b7a-b610-4f7f88d2428f`); roll back with `wrangler rollback <version-id>`; switches can also be turned off without a code change by redeploying with `"off"`. **A rollback of the Worker does not roll back anyone's browser database.**

Database recovery (the one-way door, STAGE0_SECURITY section 5): once a browser's database is at version 12, the August-era page cannot open it. Recovery is a backup file made before the upgrade (the prompt offers it) restored by the new build, or rolling forward. A hotfix must therefore ship as a new build, never as a revert to the August code.

## 10. Manual tests that automation cannot replace (both are required before any release)

**A. Real-browser database upgrade, on a profile that has actually used the live site.** (The automated test uses a version-4 database created by the real August `db.js`, but with a small synthetic case.)
1. Use a Chrome profile that has the live site's real cases (or a copy of one; keep the original untouched). In DevTools, Application → IndexedDB → `chronium`, note the version (expect 4) and the counts of investigations, records and evidence items; screenshot it.
2. **Limitation, stated plainly:** browser storage belongs to an origin, so the staging site (a different origin) cannot see the live site's data, and the real data can only be upgraded on the live origin. The staging test therefore uses the version-4 database that the real August `db.js` creates (automated), plus a staging case made by importing an export from the live site. The true live-origin upgrade is done once, at release, on your own profile, with a backup file downloaded and checked first.
3. Steps (at release, on the live origin): open the new site; confirm the prompt appears before anything changes; check DevTools still says version 4; download the backup; confirm the file exists and has the expected counts; choose Update now; confirm version 12 and that every case opens; open a second tab on the old site during the prompt to confirm the blocked message; restore the backup into a wiped profile and compare counts.
4. Also test: very large case (hundreds of records and a few PDFs), cancelling the download, no free disk space, and Safari and Firefox (IndexedDB behaviour differs).

**B. Real Chrome extension permission prompt** (never run so far). In Chrome for Testing and in the ordinary Chrome: load `extension/` unpacked; in My Research try Find Records on a government site that is **not** Copperas Cove or CivicPlus; confirm Chrome shows its own host-permission prompt for that site only, that declining leaves the extension unable to read it and says so, that accepting reads only that host, that the identifying User-Agent and the private-address block rules apply (inspect with `chrome://net-export` or the extension's network log), and that Copperas Cove still refuses with **zero** requests. Record the Chrome version and a screenshot of the prompt.

## 11. Costs and what needs a payment or a plan change

| Item | Cost | Needed for |
|---|---|---|
| Staging Worker, fixtures Worker, staging KV namespace, Cache API, workers.dev hostnames, Workers metrics and Logs | **$0** (Workers Free) | Everything in sections 1 to 3, 8 and 9 |
| Rate Limiting binding | **UNVERIFIED** whether free; the staging deploy will show it | Layer 2 |
| WAF rate-limiting rule | Free zone: 1 rule, IP, 10 s windows; Pro zone: price not verified here | Layer 3; **requires a custom domain on a Cloudflare zone** (domain price depends on the name; none owned for this purpose that I know of) |
| Turnstile | Free (documented); needs an accessible widget | Optional |
| Separate registrable domain for captures | domain price | Section 7 strong form |
| Workers Paid | $5 per month minimum | Only if the Free-plan measurements fail (section 8) |
| Staging AI test | at most $0.11 per day, $3.30 per 30 days; $5 provider cap | AI phase (separate go-ahead) |
| Production AI | at most $0.55 per day ($16.50 per 30 days) at 5 per visitor and 50 global, plus the multiple in section 5; the provider cap is the firm limit | Not enabled; needs your ceilings |

## 12. Sources read (2026-10-26)

Cloudflare: Workers limits (developers.cloudflare.com/workers/platform/limits/); Workers pricing (…/workers/platform/pricing/); KV limits (…/kv/platform/limits/); WAF rate limiting rules (…/waf/rate-limiting-rules/); Workers Rate Limiting binding (…/workers/runtime-apis/bindings/rate-limit/); workers.dev routing (…/workers/configuration/routing/workers-dev/); Workers metrics (…/workers/observability/metrics-and-analytics/); Workers Builds (…/workers/ci-cd/builds/); Turnstile plans (…/turnstile/plans/). Public Suffix List (publicsuffix.org). Anthropic: platform.claude.com/docs/en/about-claude/pricing.

Free plan figures used: 100,000 requests per day; 10 ms CPU per request; 128 MB per isolate; 50 subrequests; 6 simultaneous open connections; KV 100,000 reads and 1,000 writes per day, 1 GB.

## 13. Unresolved decisions and open facts (for review)

1. Approve creating the staging KV namespace, staging Worker and fixtures Worker (nothing exists yet).
2. Custom domain: yes or no. It is the only way to get zone rate-limiting rules, a true separate-origin captures site, and the DNS-change test.
3. Which rate-limit layers (section 4), and whether to approve the `guard.js` change for the Rate Limiting binding.
4. Turnstile in front of document fetching: yes or no.
5. AI ceilings (proposed 5 per visitor, 50 global) and whether you create the Anthropic workspaces with spend caps (I cannot see your console).
6. Separate captures origin: defer (recommended) or build.
7. Whether the website's Find Records ships at all, or stays an extension feature (decided by the Free-plan measurements plus your preference).
8. Open facts only the staging deploy or the dashboard can settle: whether the Rate Limiting binding is available on Free; whether the daily 100,000 allowance is per account; whether a Worker can fetch another `workers.dev` Worker on the Free plan (the fixtures design depends on it; if not, fixtures move to a free static host such as Pages); the exact Workers Builds setting for production (section 14).

## 14. GitHub push and Workers Builds

Workers Builds is opt-in (the dashboard connects a repository only if someone chooses Connect), and a connected Worker deploys on every push to its production branch. I could not read this Worker's setting: the CLI login has no builds scope and I have no dashboard access. **Indirect evidence that it is not connected:** eight pushes to `main` on 2026-10-23 (16:16 to 18:05 local) produced exactly one new deployment, the documented manual page release at 22:54Z, and none for the pushes made after it. The check for you in the dashboard: Workers & Pages → `chronium-mind` → Settings → Builds (it should say nothing is connected; if a repository is shown, press Disconnect before pushing).
