# Page-only release: the public crawler information page

Status: **PREPARED AND TESTED LOCALLY. NOT DEPLOYED. Waiting for Mari's final approval.** Prepared 2026-10-23. Production is unchanged.

Goal: make `https://chronium-mind.truewolfflix777.workers.dev/crawler` live, and nothing else. The current repository is **not** deployed, so none of the new features (Find Records, Records Recovery, `/api/fetch`, `/api/captures`, the three views, Ask Chronium, case export) reach production.

## 1. Verified production baseline

Method: read-only HTTP requests to the live site (no credentials were used or requested; `wrangler` could not read deployment metadata without a login). Date: 2026-10-23.

| Check | Result |
|---|---|
| Front-end files live now versus every commit that ever touched `public/` | **All four main files (`index.html`, `app.js`, `db.js`, `styles.css`) match commit `d80ef66` ("Build Analysis: deterministic Quantitative + provider-agnostic AI Qualitative", 2026-08-28) and no other commit.** |
| Every file in `public/` at `d80ef66` fetched from production and compared | **14 of 14 byte-identical** (`app.js`, `db.js`, `styles.css`, `ui.js`, `ingest/adapters.js`, `ingest/pipeline.js`, the five `vendor/` libraries and README, both brand images); the root page is identical (it answers `/` directly; `/index.html` redirects to `/`). Production has no other asset I could find: the repository's file list for that commit is 15 files |
| Worker routes live now versus the Worker source at `d80ef66` | Production answers `/api/health`, `/api/health/connectors`, `/api/check-link`, `/api/ai/usage`, `/api/analyze/qualitative`, `/api/search` (all the routes in that source) and answers **404** for `/api/view-capture` and `/api/analyze/ask-sources`, which were added in later commits, and for `/api/fetch` and `/api/captures`. Error bodies for `/api/check-link` (400 `{"ok":false,"kind":"invalid"}`), `/api/search` (400 `Enter at least 2 characters.`), `/api/analyze/qualitative` (405 and the two skipped-analysis replies) are identical to those from the `d80ef66` Worker run locally. `/api/health` reports version `0.2.0`, as that source does |
| Bindings and configuration | `wrangler.jsonc` at `d80ef66` is identical to today's (name `chronium-mind`, compatibility date `2026-08-16`, assets directory `./public` with `run_worker_first: ["/api/*"]`, KV `CONNECTOR_HEALTH` id `4ed1a352…`, var `AI_PROVIDER=anthropic`). Production's KV is populated (connector statistics, AI usage counters dated 2026-08-29), so the binding and the `ANTHROPIC_API_KEY` secret exist; **a deploy does not touch secrets or KV contents** |

**What cannot be verified from outside, stated plainly:** the Worker script's source itself (bytes) and the account's current version id. The evidence above is strong (an exact match of all assets, the same routes, the same error bodies, and 404 on every later route), but it is behavioural, not a byte comparison of the script. The release redeploys the Worker script built from `d80ef66`, so **if production's script had been changed after that commit without a commit, this release would replace it.** To remove that risk, Mari can run step A of section 5 (it shows the deployed version's creation time and message) and compare it with 2026-08-28/29 before approving. Five later commits changed `src/index.js` (593adbd, a8ac226, 46d551c, 98509dc and Phase 1's 32aeebd). Their additions (the archive viewer route, Ask Sources) are absent from production, which is what a script from the `d80ef66` era would show.

## 2. What the release contains

A separate branch **`release/crawler-page`** (commit `244a9d3`) created from `d80ef66`, in an isolated working copy (`.release/crawler`, outside version control's normal tree and excluded from commits). It differs from `d80ef66` by **one added file**:

```
public/crawler.html     (68 lines, static HTML, inline CSS, no scripts, no external requests)
```

The deployment package is an LF-exact export of that commit (`.release/package`, made with `git -c core.autocrlf=false archive`). This matters: a normal Windows checkout converts line endings to CRLF and would change the bytes of all 14 existing assets. The export keeps them byte-identical to production.

- **Worker changes: none.** Same source as `d80ef66`. No new routes, no new bindings, no new variables, no change to `wrangler.jsonc`.
- **Existing investigation workflows: untouched.** The same 15 files are served with the same bytes.
- **The page depends on no application code.** It is self-contained.
- Expected upload on deploy: one new asset (`crawler.html`); the 14 existing assets are unchanged by hash. The Worker script is re-uploaded (unchanged source).

## 3. Validation results

Run against the package served locally (`wrangler dev`, port 8792) and against production, using `scripts/verify-crawler-release.mjs` and `scripts/test-crawler-page-browser.mjs`.

| Test | Result |
|---|---|
| Page renders (HTTP 200 at `/crawler`; `/crawler.html` redirects to it, which is how the platform serves HTML assets) | pass |
| Page needs no other request (no scripts, styles or images from anywhere) | pass |
| Language, title, one `h1`, no skipped headings; skip link works | pass |
| Contact link is `mailto:marimercruz8@gmail.com` and reads the same | pass |
| Layout at 320, 375, 768, 1024, 1440 px in dark and light: no horizontal scroll, nothing clipped | pass (10 checks) |
| axe WCAG 2.0 to 2.2 A/AA at 320 and 1440 px in both themes | pass, no violations |
| Text spacing (WCAG 1.4.12) at 320 px; forced colors | pass |
| Every number on the page matches the code (`npm test`, `scripts/test-crawler-page.mjs`) | pass |
| Existing assets: production = package = local test server | **14 of 14 byte-identical**, plus the root page |
| Existing API behaviour (health, check-link, search, qualitative incl. POST replies) | identical, local release versus production |
| New routes absent: `/api/fetch`, `/api/captures`, `/api/view-capture`, `/api/analyze/ask-sources` | 404 in the release, as in production |
| Browser run | 25 of 25 checks; the only console error seen earlier was the missing favicon, fixed by an inline empty icon |

Manual accessibility checks (screen readers, real touch device) have not been done for this page; none is claimed.

## 4. Route inventory

| Route | Production now | After the release |
|---|---|---|
| `/` and the 14 assets | 200, as listed | **unchanged, byte-identical** |
| `/api/health`, `/api/health/connectors`, `/api/ai/usage`, `/api/check-link`, `/api/search`, `/api/analyze/qualitative` | live | unchanged |
| `/api/view-capture`, `/api/analyze/ask-sources` | 404 | 404 |
| `/api/fetch`, `/api/captures` | 404 | **404 (not introduced)** |
| `/crawler` | 404 | **200, the new page** |
| `/crawler.html` | 404 | 307 to `/crawler` |
| anything else | 404 | 404 |

## 5. Deployment commands (run by Mari in her own authenticated terminal; never paste a token into chat)

Target: Worker **`chronium-mind`**, live at **https://chronium-mind.truewolfflix777.workers.dev** (the account that owns the `truewolfflix777.workers.dev` subdomain). Do not use `--temporary`, and do not deploy from the main checkout.

```powershell
cd C:\Users\insur\chronium\.release\package

# A. Make sure you are logged in to the right account, and record what is live now (the rollback target).
npx wrangler login            # only if not already logged in; opens your browser
npx wrangler whoami           # the account must own the chronium-mind Worker
npx wrangler deployments list # NOTE the newest version id and its date: this is the rollback target

# B. Check the live site is still in the verified "before" state.
cd C:\Users\insur\chronium
node scripts/verify-crawler-release.mjs --package=.release/package --expect=before

# C. Dry run: expected bindings are CONNECTOR_HEALTH (KV), ASSETS, AI_PROVIDER="anthropic" and nothing else.
cd .release\package
npx wrangler deploy --dry-run

# D. Deploy.
npx wrangler deploy

# E. Verify the "after" state (expect: everything OK, /crawler 200 and byte-identical, /api/fetch and /api/captures 404).
cd C:\Users\insur\chronium
node scripts/verify-crawler-release.mjs --package=.release/package --expect=after
```

Expected output of D: one new asset uploaded; the Worker named `chronium-mind`; the URL above; a new version id.

## 6. Rollback

Either takes effect in seconds and leaves KV and secrets untouched.

1. **Roll back to the version recorded in step A:**
   ```powershell
   cd C:\Users\insur\chronium\.release\package
   npx wrangler rollback <the previous version id from step A>
   ```
   Then run `node scripts/verify-crawler-release.mjs --package=.release/package --expect=before` (it expects `/crawler` to be 404 again).
2. **If a rollback by id is unavailable** (for example the old version has aged out): redeploy the baseline itself, which has no `crawler.html`:
   ```powershell
   cd C:\Users\insur\chronium
   mkdir .release\baseline
   git -c core.autocrlf=false archive -o .release\baseline.tar d80ef66
   tar -xf .release\baseline.tar -C .release\baseline
   cd .release\baseline
   npx wrangler deploy
   ```
   (`d80ef66` is the verified baseline; its output is byte-identical to production's assets.)

## 7. Things to know before approving

- The page is served at **`/crawler`** (the platform redirects `/crawler.html` to it). The ChroniumMind User-Agent and the CivicPlus letter now point at `/crawler`.
- **No production code reads the User-Agent that links to the page.** The current production Worker's archive requests send a different string, `ChroniumMind/0.2 (+…workers.dev; research tool, not a browser)`, to archive services only. The new User-Agent (`ChroniumMind/0.1 (+…/crawler; …)`) will start being used only when the Deep Discovery code is deployed. The page describes the tool as built in the repository; until that code is deployed, no site is being read with it. The page does not claim otherwise.
- Publishing makes `marimercruz8@gmail.com` visible on a public page (approved by Mari).
- After this release, the letter to the City of Copperas Cove and CivicPlus may be sent once Mari has verified the live page and approved the letter; it stays unsent until then. The Copperas Cove / CivicPlus automated-access block is unchanged.
- The extension is not part of this release; its real permission-prompt test remains a gate for the extension and any broader rollout.
