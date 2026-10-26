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
| AI routes | 3 | n/a | 10 (see section 5) | 1 | request body 256 KB (hard-coded; see 15.4) |

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

## 14. GitHub push and Workers Builds (resolved 2026-10-26: Mari checked the dashboard; Builds shows "Connect", so no repository is connected; the three commits were pushed, `main` = `65490df`)

Workers Builds is opt-in (the dashboard connects a repository only if someone chooses Connect), and a connected Worker deploys on every push to its production branch. I could not read this Worker's setting: the CLI login has no builds scope and I have no dashboard access. **Indirect evidence that it is not connected:** eight pushes to `main` on 2026-10-23 (16:16 to 18:05 local) produced exactly one new deployment, the documented manual page release at 22:54Z, and none for the pushes made after it. The check for you in the dashboard: Workers & Pages → `chronium-mind` → Settings → Builds (it should say nothing is connected; if a repository is shown, press Disconnect before pushing).

## 15. Stage 1 direction update (2026-10-26, after review)

Mari's directions for this round, and where each stands. **No staging resource exists; nothing is deployed; production services and settings are unchanged.**

### 15.1 Cloudflare capabilities verified, and what could not be verified

| Question | Answer | Source / status |
|---|---|---|
| Is the Workers Rate Limiting binding real and stable? | Yes. "Generally Available" since 2025-09-19; the `ratelimit` binding "is now stable and recommended for all production workloads". | Cloudflare changelog (official) |
| Does it work on the Workers **Free** plan? | **Not stated anywhere in Cloudflare's official documentation** (the binding page, the pricing page and the changelog are all silent on plans). A third-party comparison says there is no extra charge for the binding itself. | **UNVERIFIED.** Only a real deploy can settle it. Wrangler's local simulation accepts it (see 15.3), which proves the code and config, not the plan |
| Binding limits | Window must be exactly 10 or 60 seconds; counted per Cloudflare location; approximate (can overshoot while counts propagate); `namespace_id` is a unique positive integer per account; several bindings per Worker allowed | Official binding page |
| Is the Free daily request allowance shared with production? | Cloudflare's wording is account-level: "Accounts on the Workers Free plan have a daily request limit of 100,000 requests, resetting at midnight UTC", and Error 1027 is "Worker exceeded free tier daily request limit". The page does not say in so many words that all Workers share it, and does not mention Pages Functions. **The natural reading is that one account-wide counter covers every Worker in the account.** Secondary sources say the same | Official wording; sharing is a strong inference, not an explicit statement |
| What is the account's plan? | **Unknown to me.** The CLI login cannot read billing. If the account is already on Workers Paid there is no daily cap (and extra requests cost money: 10 million included per month, then $0.30 per million); if it is on Free, the cap exists and is shared | **Must be checked in the dashboard (Billing / Workers plan)** |
| Does the account hold other live projects? | **Yes.** `wrangler d1 list` shows the production databases `infinpay`, `truewolfwaves`, `truewolfwaves-content`, `truewolfflix-content`, `waves` and `sdklanding-leads` in the same account. Those apps' Workers and Pages Functions would draw from the same daily allowance if the account is on Free | Read from the account (read-only commands) |
| WAF rate-limiting rule availability | Per zone only (Free: 1 rule, IP only, 10 s window and block); a `workers.dev` hostname is not a zone I control | Official; applicability to `workers.dev` unverified |
| Workers metrics | CPU time quantiles, wall time, per-isolate memory P50/P90/P99/P999, requests, errors by invocation status, 3 months of history | Official |
| Turnstile | Free, unlimited challenges, 20 widgets | Official plans page |
| Anthropic workspace spend limits | Monthly spend limit per workspace, own keys per workspace, spend alerts | Anthropic announcement and docs; the exact console steps were not shown in what I read |

### 15.2 Account-level quota and cost exposure (why nothing is created yet)

- One Cloudflare account carries production Infin.Pay, TrueWolf Waves and other live projects. If it is on Free, **a staging test that burns the shared 100,000-per-day allowance would take those apps down with Error 1027 until midnight UTC.**
- Each staging proxy request that fetches a fixture is **two invocations** (the staging Worker and the fixtures Worker), so the earlier budget of 2,000 test requests a day is up to 4,000 invocations: 4% of the allowance at most. It is small, but the allowance is already partly used by the other apps, and I do not know by how much.
- Before anything is created, the dashboard needs to answer, and I need you to tell me: (1) which plan the account is on; (2) the account's busiest day of requests in the last 30 days (Workers & Pages overview); (3) whether any Worker or Pages project in the account is not yours to put at risk.
- Decision rule proposed: if the account is on Free and its recent peak is above 70,000 requests in a day, **do not create staging in this account**; use a separate free Cloudflare account for staging and fixtures instead (an account has its own allowance, its own KV, and no access to production). That also gives the cleanest isolation. If the account is on Workers Paid, staging cannot lock anything out, the exposure is money only (cents at these volumes), and the 2,000-requests-per-day test budget stands.
- A separate account also resolves the same-site concern in section 1: its `workers.dev` subdomain is a different registrable domain.

### 15.3 Rate Limiting binding integration: built, staging-only, fail closed (committed locally, not deployed)

- `src/guard.js`: `enforceBindingLimit` runs **first** in `enforceLimits` (fetch, captures, capture viewer) and in `enforceAiLimits`, before the existing counters. It acts only when `RATE_LIMIT_BINDING` is exactly `"required"`. Then: a missing or malformed binding, a binding that throws, or any answer other than exactly `{ success: true }` refuses the request with 503; `{ success: false }` gives 429 `rate-limited / scope: burst` with `Retry-After`. Any other value of the variable (`on`, `true`, `Required`, empty) leaves the binding untouched, so production behaves exactly as before.
- `wrangler.jsonc`, **staging block only**: `RATE_LIMIT_BINDING: "required"` and three bindings: `RL_FETCH` (namespace 7101, 15 per 60 s; shared by fetch and captures with separate keys), `RL_VIEWCAPTURE` (7102, 15 per 60 s), `RL_AI` (7103, 3 per 60 s). Keys are `route:visitor-ip`.
- `scripts/validate-production-config.mjs`: staging must require the binding and declare all three with a 10 or 60 s window, a positive limit, unique namespace ids and no reuse of a production id; **production must not declare any ratelimits binding or the variable** (staging-only until measured).
- Tests (deterministic, no network): `scripts/test-ratelimit-binding.mjs` (11 tests: untouched when not required, key shape, 429, eleven kinds of broken binding all refused, per-route bindings, binding checked before counters and a refusal never touches them, counters still apply after an allow, no fallback to counters when the binding is missing, AI route, older AI 404 rule intact) and 1 added to `scripts/test-config-safety.mjs`. Both are in `npm test`.
- Real-runtime check, local only: `wrangler dev --env staging` loaded the three bindings (`env.RL_AI (3 requests/60s) Rate Limit local`), and six requests to the AI route gave three allowed then `429 burst` for every later one. **This is the local simulation, not Cloudflare.** Whether the Free plan accepts the binding, and how accurately it counts across locations, remain to be observed on a deployed staging Worker.

### 15.4 Staging AI stays disabled; proposed enforced token caps and workspace

- Staging has `AI_ENABLED: "off"` and no secret. Nothing in this round changes that.
- **What is enforced today** (read from the code): output `max_tokens` 1,200; evidence text 12,000 characters (question 500, previous answer 1,000); request body 256 KB (`aiRouteGuard`). Correction to section 4: the 64 KB figure in the built-in AI limits is **not** the enforced cap; the enforced one is 256 KB, hard-coded.
- **Proposed caps for when AI is ever switched on** (not implemented; needs your approval): output 600 tokens, evidence text 8,000 characters, request body 64 KB, each as a lower-only setting (the same rule as the `LIMIT_*` variables: configuration may only lower them). Worst case per call becomes about 3,000 input tokens × $1/M + 600 output tokens × $5/M = $0.003 + $0.003 = **$0.006**. At the staging ceilings (3 per visitor, 10 global per day): at most $0.06 per day; the $5 workspace cap would last about 800 worst-case calls.
- **Dedicated workspace:** one Anthropic workspace named for staging with a **$5 monthly spend limit** and a spend alert at $2.50, one workspace-scoped API key, created and revoked by you in the console (I cannot see or operate your console). The key is stored only with `wrangler secret put … --env staging` and deleted after the test. Production gets its own workspace and cap later (proposed $20) and never shares a key with staging.

### 15.5 Capture viewing: the separate-origin design is a requirement; the existing endpoint is not enabled anywhere public

- Section 7's separate-origin design (own Worker, own origin, no cookies, no CORS grant, restrictive CSP, framed with a `sandbox` attribute) is now a **requirement** for any future capture viewing, not an option. (Earlier I recommended deferring it; that recommendation is withdrawn as to viewing, and stands only as to the order of work.)
- Enforced in two places: **the Worker** treats `FEATURE_VIEW_CAPTURE` as never effective when `ENVIRONMENT` is production (or unset, which counts as production), whatever the variable says; **the deploy validator** refuses `FEATURE_VIEW_CAPTURE: "on"` in any deployed configuration, production or staging, and `--allow-on` does not override it. Tested in `test-ratelimit-binding.mjs` and `test-config-safety.mjs`. The local unit-test environments are unchanged.
- The staging smoke test confirms the capture route answers 404 (switched off), and the staging configuration cannot be deployed with it on.

### 15.6 Website Find Records stays on the roadmap with automated retrieval disabled

The Find Records tab stays in the product. With `FEATURE_DISCOVERY_FETCH` and `FEATURE_DISCOVERY_CAPTURES` off, the screen already explains plainly that searching a website from the website is not switched on and that the extension can do it; the person's own cases and documents they add are unaffected (existing behaviour from Stage 0; unchanged). The decision to switch retrieval on for the website remains with the Stage 1 measurements and your approval. Copperas Cove and CivicPlus remain blocked in the code and are never a test target.

### 15.7 Initial staging smoke test (built; run locally against a staging-configured Worker)

`scripts/smoke-staging.mjs --base=<address> [--budget=40] [--log=<file>]`. It makes **10 requests** and runs 15 checks: health; every guarded feature reports off; each of the five guarded routes answers 404 `not-available` and leaks no key name or secret; the home page loads through `boot.js` with `app.js` preloaded; the public crawler page loads; the storage-upgrade script is served. It uses harmless `example.org` addresses (never fetched, because the routes are off), refuses to run against the production hostname, refuses to build any request mentioning a `.gov`, Copperas Cove or CivicPlus address, stops at its request budget, makes no browser, stores nothing except an optional log file, and relies on the staging Worker's own storage (its own KV namespace, enforced by the validator). Result against `wrangler dev --env staging` on this machine: 15 passed, 0 failed, 10 requests. The real-browser database-upgrade prompt and the extension permission prompt remain manual tests (section 10).

### 15.8 Remaining blockers before any resource is created

1. **Account plan and quota** (15.2): your answers on the plan, the 30-day peak, and whether to use a separate free account for staging. Nothing is created until this is settled.
2. **Workers Builds** check for `chronium-mind` (section 14): still waiting for your confirmation before the three commits (now four, with this round's) are pushed.
3. Approval of the staging KV namespace, staging Worker and fixtures Worker, after items 1 and 2.
4. Anthropic staging workspace and $5 cap (yours to create), only if the AI phase is wanted at all.
5. Custom domain yes or no (needed only for zone rate-limit rules, the DNS-change test, and the strongest separate-origin form).
6. Approval of the proposed lower AI caps (15.4) before they are implemented.
7. Open facts that only a deploy settles: Free-plan acceptance of the Rate Limiting binding; whether a Free-plan Worker may fetch another `workers.dev` Worker (fixtures design); the real edge CPU and memory.

### 15.9 Lower AI caps: implemented locally (2026-10-26); AI is still OFF everywhere

- `aiCaps(env)` in `src/guard.js`, used by both AI routes in `src/index.js` (the old hard-coded 12,000 characters and 1,200 tokens are gone). **Defaults: 600 output tokens and 8,000 characters of evidence text** (was 1,200 and 12,000). Configuration (`AI_MAX_OUTPUT_TOKENS`, `AI_MAX_INPUT_CHARS`, `AI_MAX_BODY_BYTES`) can only lower them; values that are not whole numbers, are zero or negative, or are higher are ignored; test mode (never production) may set exact values. The validator rejects non-numeric values. The caps are applied by the Worker, never by the page.
- **Deviation from section 15.4, deliberately:** the request-body cap is configurable and lower-only, but its **default stays at 256 KB, not 64 KB**. The page sends *all* of a case's evidence with full text and the Worker truncates it to the evidence cap; a 64 KB body limit would make the Worker refuse medium-sized cases (413) instead of truncating them. Spend is bounded by the output and evidence caps, not by the body size. Set `AI_MAX_BODY_BYTES` to lower it if you prefer refusal to truncation.
- **Resulting worst case per call:** about 2,400 to 3,000 input tokens (8,000 evidence characters plus the system prompt, question and context) and 600 output tokens: at most about $0.006 on Haiku 4.5. At the staging ceilings (3 per visitor, 10 global per day): at most $0.06 per day.
- **Risk to measure, not assume:** the analysis prompt asks for a JSON object with themes, patterns and contradictions. If a model answer is longer than 600 tokens it is cut off mid-JSON, and the existing fallback shows it as plain text with a parse-error flag. Typical output length has not been measured (AI is off and no key exists). **The staging AI phase must record real output token counts first; if a meaningful share hit the cap, the cap should rise (for example to 900) before launch.**
- Tests: `scripts/test-ai-caps.mjs` (8 tests, in `npm test`): defaults, lower-only behaviour with eleven bad values, test-mode exactness, truncation notices, the body-size check, and end-to-end through the real Worker entry point with the provider replaced by a stub (the outgoing `max_tokens` and prompt length are asserted, a lower setting is honoured, a higher one is not, and with the switch off or the ceilings missing nothing is sent anywhere). Helper: `scripts/json-import-hooks.mjs` (lets Node load the Worker unchanged).

### 15.10 Truncated or malformed AI answers can no longer pass as a complete analysis (2026-10-26; AI still OFF)

Gaps found by reading the code (not by a failure): the Worker never read the provider's stop reason, so a cut-off answer looked like any other; any valid-JSON answer of the wrong shape (even `{}`) was returned as a complete, empty analysis; parse failures were cached for 30 minutes; and the page saved a result into the case even when its `parseError` flag was set. Changes:
- `src/aiResult.js` (pure): an answer is **complete** only if (1) the provider's stop reason is exactly `end_turn` (`max_tokens` = truncated, `refusal` = refused, anything missing or new = unverified); (2) the text is exactly one JSON object (a leading fence only with its closing fence; no chatter before or after); (3) every required field is present with exactly the right type (non-empty synthesis; every theme, pattern and contradiction an object with text and an `evidenceIds` string array; Ask Sources `insufficient` a real boolean, an answer non-empty with at least one citation, or an `insufficient` answer that says what is missing); (4) every cited id is one this request actually sent. Incomplete output is **never repaired, never partly used, never cached**.
- Handlers: an incomplete answer becomes `502 {ok:false, error:'ai-truncated'|'ai-malformed'|'ai-unverified'|'ai-refused', incomplete}` with **no model text and no result**; the tokens still count toward usage. Cache keys moved to `v2` and only a cached result marked `complete: true` is ever served. The old lenient parsers are deleted. The Anthropic adapter now returns `stopReason`.
- Page: `public/aiGate.js` `acceptFreshAiResult` refuses anything not explicitly `complete: true` with `parseError: false` **before** saving to the case or showing it (also protects against old, cached or hand-made results), and the plain-language messages for the four refusals are in `apiErrorMessage`.
- **The 600-token output limit, 8,000-character evidence limit and 256 KB body limit are unchanged.** Nothing raises the output limit automatically. A cut-off answer is now a visible refusal, so the rate at which that happens is measurable in the staging AI phase; only measured evidence (the share of calls ending in `max_tokens`, with output token counts) should change the limit, and only by an approved edit.
- Tests: `scripts/test-ai-incomplete.mjs` (22 tests, in `npm test`): stop-reason matrix; **every proper prefix** of a valid analysis, a valid Ask answer and a fenced answer is refused even when the provider claims it finished; 40+ wrong-shape and chatter variants; citations to unsent ids; refusal bodies contain no model text; end to end through the real Worker entry point for both routes (cut-off, cut-off-but-claimed-finished, unverified, empty or wrong JSON, bad citations, never cached, a complete answer accepted and cached and still marked complete); and the page gate.


## 16. Staging creation plan for approval (2026-10-26; NOTHING below has been created)

**Account facts, from Mari's dashboard check:** Workers **Free** plan; **6 of 100,000** requests today; **101** requests this billing period; **162.03 ms** total CPU; **$0.00** billable. The existing account is therefore far from every Free-plan limit, and the shared-allowance risk in 15.2 is small at these volumes. No purchase, upgrade or domain is part of this plan.

### 16.1 Free-plan quotas that apply (official documentation, read 2026-10-26)

| Quota | Free-plan value | This plan's use |
|---|---|---|
| Worker requests | 100,000 per day, account-wide wording, resets 00:00 UTC | hard budget below: at most 60 requests across both phases (0.06%) |
| CPU per request | 10 ms | measured, not assumed (section 8) |
| Memory per isolate | 128 MB | measured at P99 |
| Subrequests per request | 50 | not approached |
| KV | 100,000 reads and **1,000 writes per day** (per account), 1 GB | this plan writes nothing to KV in phases A and B (features off, then only the limiter probe, which refuses before any KV use). The 1,000 daily writes are shared with production's own use, which I cannot see |
| Workers per account | 100 | +1 |
| Environment variables per Worker | 64 | 8 |
| Static assets | not a stated limit | the staging bundle is 68 files, 5.97 MB (dry run); static files are served without running the Worker, and I did not verify whether they count toward the daily allowance, so the budget treats them as if they do |
| Workers Logs | 200,000 events per day, 3-day retention | default |

### 16.2 Rate Limiting binding: what is and is not confirmed

- **Confirmed (official):** generally available since 2025-09-19; windows of 10 or 60 s; per-location, approximate; needs Wrangler 4.36 or later (installed: 4.127.0); `wrangler deploy --env staging --dry-run` accepts the three bindings (`RL_FETCH 15/60s`, `RL_VIEWCAPTURE 15/60s`, `RL_AI 3/60s`).
- **Not stated anywhere in Cloudflare's documentation:** whether the **Free** plan accepts it. A third-party write-up used it on a Free account without any restriction, which is not an official statement.
- **Cannot be settled without a deploy.** The first deploy is therefore designed as the test, and it is safe either way: if the account rejects the binding, `wrangler deploy` fails and **creates no Worker**; nothing is left to clean up except the KV namespace. Fallback if rejected: staging runs on the existing counters only (no binding), which needs a reviewed change to the staging config and validator, and the Stage 0 counters' per-data-centre looseness stays documented.
- Local result (simulation only): `scripts/probe-staging-limiter.mjs` against `wrangler dev --env staging`: 15 requests passed, then `429 burst`; stopped after 19 requests.

### 16.3 Exactly what I intend to create (in this order, each only after your go-ahead for the whole list)

1. **One KV namespace**, with `npx wrangler kv namespace create CONNECTOR_HEALTH --env staging`. Expected title `chronium-mind-staging-CONNECTOR_HEALTH`. Its id replaces the placeholder in `wrangler.jsonc` (a small commit for your review before any deploy; the validator refuses a placeholder, the production id, or a reused id).
2. **One Worker**, `chronium-mind-staging`, deployed with `npm run deploy:staging` (validator and dry run first). Contents per the dry run: the app's 68 static files; `ENVIRONMENT=staging`; **every feature switch `off`** (fetch, captures, capture viewer, Ask Sources, AI); `RATE_LIMIT_BINDING=required`; bindings `CONNECTOR_HEALTH` (the new namespace), `RL_FETCH`, `RL_VIEWCAPTURE`, `RL_AI` (account-unique namespace ids 7101, 7102, 7103). **No secrets of any kind**, so no Anthropic key. Public address: `https://chronium-mind-staging.truewolfflix777.workers.dev`.
3. **Nothing else.** In particular **no fixtures Worker yet** (not needed for phases A and B), no custom domain, no Turnstile, no WAF rule, no Anthropic workspace, no paid plan, no change to the production Worker, its KV, its D1 databases or its variables. The production hostname is refused by both test scripts.

If namespace ids 7101 to 7103 are already used by another Worker in the account, the deploy fails and I will report it, not reuse or change anything of another project's.

### 16.4 First staging test: small, controlled, with stop conditions

**Phase A, off state (10 requests):** `node scripts/smoke-staging.mjs --base=<staging address> --budget=12 --log=<file>`. Every guarded route must answer 404 `not-available`, every feature must report off, pages and the upgrade script must load. **Stop** if anything but expected: no further phase until reviewed.

**Phase B, limiter probe (at most 25 requests, one switch on):** one redeploy of the same Worker with **only** `FEATURE_DISCOVERY_FETCH=on` (validator run with `--allow-on=FEATURE_DISCOVERY_FETCH`, then `wrangler deploy --env staging --var FEATURE_DISCOVERY_FETCH:on`; the committed file keeps it `off`) (AI, captures, capture viewer all off), then `node scripts/probe-staging-limiter.mjs --base=<staging address> --log=<file>`. Every request names the reserved host `probe.invalid`, so **no website is contacted**; the Worker only passes the limiter, fails the DNS check and answers 400. Expected: about 15 answers of `400 address-refused`, then `429 burst`. **Stop conditions, built into the script:** 25 requests; any 2xx (a real fetch happened); any 5xx (binding unsupported or broken, or quota trouble); 3 network errors in a row; or the limiter has engaged and stayed engaged for 3 more requests. Afterwards redeploy with the switch **off** and rerun phase A (10 more requests).

**Totals:** at most about 10 + 25 + 10 = 45 requests, plus the redeploys; hard cap 60. Dashboard check afterwards: requests, errors, CPU, memory, and `$0.00`. The Worker is then **deleted** (`wrangler delete --env staging`) or left with every switch off, as you choose. No real municipal or CivicPlus host is ever requested; the scripts refuse any `.gov`, Copperas Cove or CivicPlus address.

**Success criteria:** phase A all green; phase B shows the binding letting requests through and then refusing, with no other kind of answer; dashboard totals match the scripts' logs; no cost. **If phase B fails** (for example the account does not support the binding): stop, report the exact error, and do not try workarounds without approval.

### 16.5 Not part of this step

Fixtures Worker; edge CPU and memory measurement of document fetching (needs fixtures and a further approval); the AI phase; the real-browser database-upgrade and extension tests (manual, section 10); any production change.


## 17. Staging created and first test run (2026-10-26, 18:57 to 19:00 UTC)

**Authorization:** Mari approved exactly one staging KV namespace and one staging Worker, switches off at first, a 60-request cap, and a limiter probe using only `probe.invalid`. Nothing else was created. Production was not touched.

### 17.1 What exists now

| Item | Value |
|---|---|
| Staging Worker | `chronium-mind-staging`, https://chronium-mind-staging.truewolfflix777.workers.dev (workers.dev and preview URLs enabled), **left deployed with every guarded feature off** |
| Staging KV namespace | title `staging-CONNECTOR_HEALTH`, id `8253207c950845bb8c32622952585e14` (production's is `4ed1a352…`, different) |
| Bindings (read back from the account) | `CONNECTOR_HEALTH` (staging KV), `RL_FETCH` ns 7101 (15/60 s), `RL_VIEWCAPTURE` ns 7102 (15/60 s), `RL_AI` ns 7103 (3/60 s), `ASSETS`, and eight plain variables: `ENVIRONMENT=staging`, `RATE_LIMIT_BINDING=required`, `AI_PROVIDER=anthropic`, and `FEATURE_DISCOVERY_FETCH`, `FEATURE_DISCOVERY_CAPTURES`, `FEATURE_VIEW_CAPTURE`, `FEATURE_ASK_SOURCES`, `AI_ENABLED`, all `off`. **No secret of any kind is bound.** |
| Versions | `f52516f2-d74a-4479-8e01-c16ada57ec52` (initial, all off) → `49413483-087f-41dc-9b39-bc50c9690d67` (fetch on, probe, 18:58:52Z) → `db94028d-a8e1-4896-8596-84226a7fc90c` (all off, 18:59:30Z, **current**) |
| Namespace-id check | Before deploying, every Worker in the account (8) and every Pages project (4) was read through the API (read-only): none declares a Rate Limiting binding, so ids 7101 to 7103 were unused |
| Production | untouched: still version `60045ea5-992c-499e-8290-a8ef08572667`, same 4 bindings (including its own `ANTHROPIC_API_KEY` secret and its own KV) |

### 17.2 Results

- **Rate Limiting binding on the Free plan: accepted.** `wrangler deploy` succeeded with the three `ratelimit` bindings on the Workers Free plan, no upgrade or payment.
- **Phase A (switches off): passed.** 15 of 15 checks, 10 requests. Every guarded route answered 404 `not-available`; every feature reported off; pages and the upgrade script loaded; no key or secret appeared in any response.
- **Phase B (fetch on, limiter probe): INCONCLUSIVE, and the binding did NOT visibly enforce its limit.** 25 sequential requests to `probe.invalid` were all answered `400 address-refused / no-address`; **none was refused by the burst limiter** although the configured limit is 15 per 60 s. The cap of 25 was reached. No successful fetch, no 5xx, no network failure. The binding is documented as approximate and per location, so this cannot be called a bug, but it also means the binding cannot be relied on as a limiter on this evidence. Local simulation (wrangler dev) had refused from request 16. The order of checks "limiter before reserved-name rejection" is therefore not proven on the edge (it is proven locally and in the unit tests). **Not retried, per instructions; a retry or a different design needs approval.** Possible explanations to test, not assumed: the limit counts per location and eventually (sequential requests 0.5 to 1 s apart may be counted late); the production edge may smooth or sample the counter; a configuration detail. The existing per-visitor counters (not the binding) remain the enforced limit.
- **Disabling after the probe: done, with a propagation lesson.** The redeploy that turned fetch off was uploaded at 18:59:30Z, but the previous version kept serving for roughly 20 more seconds. The disabled-state smoke test, run in that window, therefore saw the route still on, and its probe address `https://example.org/` **was actually fetched once (HTTP 200)**: one request to the IANA-reserved example domain, an unintended successful fetch that the stop rules would forbid, caused by the test's probe address and not by the app. Fetch was **on for about a minute in total** (18:58:52Z to about 18:59:50Z). Confirmed off afterwards: `/api/features` all false at 18:59:52Z; `/api/fetch` and `/api/captures` answered 404 `not-available`; the account read-back shows every switch `off`.
- **Fixes made because of this:** `scripts/smoke-staging.mjs` now uses `probe.invalid` for its probe addresses (a wrongly-on route can no longer fetch anything from any website) and **stops before the route probes if any feature still reports on**. Rule going forward: after every deploy, wait until `/api/features` shows the expected state before any other request.

### 17.3 Request counts and observed edge numbers

- **Requests sent by the scripts and me:** 49 of the 60 cap: Phase A 10; Phase B probe 25; disabled-state check 10; one direct `/api/fetch` check 1; features check 1; final route checks 2. Only `probe.invalid` and the one `example.org` request above were ever named in a fetch. No Copperas Cove, CivicPlus or other municipal address was requested.
- **Cloudflare's own counts** (Workers analytics API, read afterwards; the data can lag and static-file requests do not invoke the Worker): 39 invocations: 7 on `f52516f2`, 30 on `49413483`, 2 on `db94028d`; **0 errors**; 6 subrequests, all on the fetch-on version.
- **CPU and wall time per invocation** (microseconds as reported; tiny samples, **not a measurement of document fetching**, which needs the fixtures phase): all-off version, p50 0.83 ms, p99 1.6 ms CPU; fetch-on version (the probe plus the one example.org fetch), **p50 3.8 ms, p99 14.7 ms CPU** (above the Free plan's 10 ms for the slowest request, with no error status recorded), wall p50 45 ms, p99 205 ms. Memory: not available from this analytics source; to read in the dashboard (Workers & Pages → chronium-mind-staging → Metrics).
- **Cost:** none observed; the Free plan was not exceeded. The dashboard figure for billable usage should still read $0.00.

### 17.4 Final state

Every guarded feature `off` on staging (fetch, captures, capture viewer, Ask Sources, AI); AI has no key; staging **retained, deployed**, all switches off; production unchanged. No further staging phase is started without approval.

### 17.5 A production note found along the way (not changed)

The production Worker has an `ANTHROPIC_API_KEY` secret bound, and the live production build predates Stage 0 (its `/api/features` route does not exist), so it has none of the Stage 0 AI switch, ceilings or protections as far as I can tell; I did not call its AI routes to find out. This is the exposure Stage 0 was written to remove (blocker B5, paid AI abuse); it remains live until a production release is separately approved. Nothing was changed.

### 15.11 Provider decision (2026-10-26): sections about Anthropic above are superseded

Mari chose **OpenAI** as the AI provider. The Anthropic workspace, the $5 Anthropic cap and the Haiku 4.5 cost figures in sections 5, 6 and 15.4 are **withdrawn**; the caps (600 output tokens, 8,000 evidence characters, 256 KB body), the ceilings, the strict validation and the rule that AI stays off until approved are unchanged. The replacement plan, costs, key-handling procedure and measurement plan are in `docs/AI_OPENAI_PLAN.md`. Staging still carries `AI_PROVIDER=anthropic` as a deployed variable with no key; that is harmless while AI is off and is to be changed only at an approved redeploy.
