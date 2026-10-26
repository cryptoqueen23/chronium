# Final review: switching off the production Anthropic AI (`release/ai-off`)

Review date 2026-10-26. **Read-only review. Nothing was deployed, no production setting, secret or version was changed, and no request body was ever sent to the live site** (only GET requests, and the platform's read-only metadata API). Deployment waits for Mari's explicit approval.

## Recommendation (separate from the GitHub push)

1. **Now, by you, no deploy:** in the Anthropic console, put a low monthly spend limit (for example $10) and an alert on the workspace that owns the production key. This caps the worst case in money immediately.
2. **On your approval: deploy `release/ai-off`** (a Worker-only release; section 6 gives the exact commands). It closes the unguarded route and the public usage counter. It cannot upgrade anyone's saved cases (section 4).
3. **Afterwards, on your approval: delete the `ANTHROPIC_API_KEY` secret** from the production Worker and revoke that key in the Anthropic console, so no live credential remains for a provider you no longer use.
4. **Do not deploy `main` for this.** `main` carries the new front end (database version 12). The Stage 0 website release is a separate, later decision, with its own real-profile upgrade test.

Risk of doing steps 2 and 3: the live "Run AI analysis" button stops working and shows the plain word `not-available`. Risk of not doing them: the route stays open to anyone, bounded only by the Anthropic spend limit you set in step 1.

## 1. What is live (verified)

| Item | Evidence |
|---|---|
| Worker | `chronium-mind`, version `60045ea5-992c-499e-8290-a8ef08572667` (2026-10-23), bindings: KV `CONNECTOR_HEALTH` (`4ed1a352…`), assets, variable `AI_PROVIDER="anthropic"`, secret `ANTHROPIC_API_KEY` (read back through the account API; secret values are not readable) |
| **The deployed Worker script is the production package, byte for byte** | The deployed module was downloaded through the read-only API (6,047,402 bytes, SHA-256 `fa5429c6209fdfc8…`). The production package (`.release/package`, branch `release/crawler-page`, commit `244a9d3`) was compiled with the same Wrangler (4.127.0) and produced **an identical file, byte for byte** (`cmp` reports no difference) |
| Static files | All 16 files in the package are served byte-identical by the live site (verifier below) |
| Front-end database | The live `db.js` has `const DB_VERSION = 4;`; `boot.js` and `upgrade.js` (the Stage 0 guard) do not exist on the live site (404) |
| The AI route | `POST /api/analyze/qualitative`: no caller check, no per-visitor or daily limit; `claude-haiku-4-5`, 1,200 output tokens, 12,000 input characters. `GET /api/ai/usage` is public (6 calls ever, last 2026-08-29) |

## 2. What the patch changes

Branch `release/ai-off`, commit `1575301`, one commit on top of `244a9d3`. **One file, five lines added** in `src/index.js`: unless the variable `AI_ENABLED` is exactly `"on"`, both `/api/ai/usage` and `/api/analyze/qualitative` answer `404 {"error":"not-available"}` for every method, before anything else happens. The production Worker has no such variable, so AI is off.

Compiled, the patched Worker differs from the **deployed** module by exactly **two added lines** (comments are removed by the bundler); `diff` of the two files shows nothing else. The patched module is 6,047,590 bytes (+188). No dependency, binding, variable, route table or configuration file changes: `wrangler.jsonc` is identical to production's, and `wrangler deploy --dry-run` lists exactly the live bindings (`CONNECTOR_HEALTH` `4ed1a352…`, `ASSETS`, `AI_PROVIDER="anthropic"`) and **no new ones**.

## 3. Route behaviour: a differential test of the two builds

The production package and the patched package were run side by side locally and sent the same 29 requests (every route, both pages, static files, HEAD/OPTIONS/PUT, malformed bodies). Result:

| | Count | Detail |
|---|---|---|
| Identical status and identical bytes | **20** | `/`, `/crawler`, `/app.js`, `/db.js`, `/styles.css`, `/robots.txt`, `/favicon.ico`, unknown pages, `/boot.js`, `/upgrade.js`, `/api/health`, `/api/check-link`, `/api/search` (both cases), `/api/view-capture`, `/api/fetch`, `/api/captures`, `/api/features`, unknown API, `/api/analyze/ask-sources` |
| **Different** | **9**, **all on the two AI routes and nothing else** | `GET /api/ai/usage` 200 to 404; `GET`/`HEAD`/`OPTIONS`/`PUT /api/analyze/qualitative` 405 to 404; `POST /api/analyze/qualitative` (four bodies: missing evidence, one item, two items, malformed) 200/200/502/400 to 404 |

Against the live site, the read-only verifier `scripts/verify-ai-off-release.mjs --expect=before` passes (16 of 16 static files identical, other routes unchanged, usage 200, analysis GET 405). Against the patched package running locally, `--expect=after` passes (both AI routes 404). With the switch turned on locally (`AI_ENABLED:on`) the route answers again without any model call when evidence is missing, so **re-enabling is a configuration change, not a code change**.

(A note on the local runs: the local simulator crashes on a POST with a body to an API route that does not exist, in the old production code. That is a quirk of the local runtime and is not affected by the patch; the probes avoid it. It does not show anything about production.)

## 4. Why this cannot upgrade your existing IndexedDB database

A browser's saved cases are upgraded only when the **page code** it loads asks for a newer database version. Four independent facts show this release changes no page code:

1. **Every static file is byte-identical** to what is live (16 of 16, SHA-256 compared by the verifier: `app.js`, `db.js`, `index.html`, `styles.css`, `ui.js`, `ingest/*`, `vendor/*`, the two images, `crawler.html`). The patch touches only `src/index.js`, which is the Worker, not a page.
2. **The served `db.js` stays at `DB_VERSION = 4`**, and the verifier asserts it; the files that would raise it (`boot.js`, `upgrade.js`, anything from `main`) stay 404.
3. **The deploy contains no new asset.** `wrangler deploy --dry-run` of the patched package differs from the production package's dry run by **0.18 KiB in total upload size** (5905.85 versus 5905.67 KiB), which is the five lines. (Wrangler's "24 files" is 16 files plus 8 directories, the same for both packages.) The earlier page-only release followed the same method and uploaded only the one new file it had.
4. **There is no service worker** that could cache or swap page code (none exists in the site), and the Chrome extension and the stable personal copy are separate programs with their own storage, untouched.

What the release does **not** protect against: someone deploying a different directory by mistake. The exact commands below deploy from `.release\ai-off-package`, and the verifier is run straight afterwards; if it fails on any static file, the rollback is one command.

## 5. Side effects to accept

- The live "Run AI analysis" button will show the text `not-available` (the old page shows the server's error code) instead of an analysis. Nothing is lost; no case is touched.
- `/api/ai/usage` stops answering.
- The secret stays bound but unused until step 3 of the recommendation.
- Deploys take up to about a minute to reach every location: **on staging the previous version kept serving for roughly 20 to 60 seconds**. The verifier must be run after waiting until `/api/ai/usage` answers 404.

## 6. Exact procedure (NOT RUN; needs Mari's explicit approval)

Before: confirm the current version is `60045ea5-992c-499e-8290-a8ef08572667` (`npx wrangler deployments list --name chronium-mind`), and that step 1 (Anthropic spend limit) is done.

```
cd C:\Users\insur\chronium\.release\ai-off-package
node ..\..\node_modules\wrangler\bin\wrangler.js deploy
```
Expect: the same three bindings as today, a new version id, and no new assets uploaded (at most "0 new"). If it lists a new or changed static file, **stop and do not continue**.

Then wait for the new version to take over, and verify (read-only GETs):
```
cd C:\Users\insur\chronium
node scripts\verify-ai-off-release.mjs --package=.release\ai-off-package --url=https://chronium-mind.truewolfflix777.workers.dev --expect=after
```
Pass means 16 of 16 static files identical, database version 4, no `boot.js`/`upgrade.js`, other routes unchanged, both AI routes 404. If `/api/ai/usage` still answers 200, wait 30 to 60 seconds and rerun once.

## 7. Rollback

The previous version is retained and rollback does not touch assets, secrets, variables or anyone's browser data:
```
cd C:\Users\insur\chronium\.release\ai-off-package
node ..\..\node_modules\wrangler\bin\wrangler.js rollback 60045ea5-992c-499e-8290-a8ef08572667 --message "Roll back the AI-off release"
```
Then `node scripts\verify-crawler-release.mjs --package=.release\package --url=https://chronium-mind.truewolfflix777.workers.dev --expect=after` confirms production is back to the earlier state (usage 200, analysis 405). Version `60045ea5` and nine earlier versions were confirmed present in the production Worker's history on 2026-10-26. A rollback takes the same up-to-a-minute to reach every location.

## 8. What was not done

No deployment; no secret deleted or rotated; no variable changed; no Anthropic console access; no POST to any public site. The live Worker script was read through the account's read-only API using the existing Wrangler login (the token was used for GET requests only and never printed).


## 9. Pre-deployment checklist: results (second pass, 2026-10-26)

| # | Mari's check | Result | Evidence |
|---|---|---|---|
| 1 | The release branch is based on the exact deployed version, not on `main` | **Pass** | `release/ai-off` (`1575301`) has exactly one parent, `244a9d3`, the production package commit, which sits on `d80ef66`. `main` is **not** an ancestor of it and it is not an ancestor of `main`. The deployed Worker module is byte-identical to the compile of that package (SHA-256 `fa5429c6209fdfc8`). The exported package equals the commit exactly, file for file (stray local `.wrangler` scratch folders were removed) |
| 2 | All existing website assets unchanged | **Pass** | `verify-ai-off-release.mjs` against the live site today: **16 of 16 static files byte-identical** to the package. The package differs from the production package only in `src/index.js` (5 lines); `wrangler.jsonc` and `package.json` are byte-identical to it. Dry-run upload sizes differ by 0.18 KiB |
| 3 | It cannot upgrade IndexedDB from version 4 | **Pass, in a real browser** | `scripts/test-ai-off-browser.mjs` (Chrome for Testing, throwaway profile, the page's **own production code**, run against a local copy of the patched package): created a case with a source and two evidence passages in a version-4 database; reloaded; opened the Analysis tab; pressed the real "Run AI analysis" button; navigated; reloaded again. The database stayed **version 4 at every step**, the case and both passages were untouched, no `boot.js` or `upgrade.js` was ever requested, and every request stayed on the page's own origin. The same test on the **unpatched** production package (the control) also stays at version 4, so the test is sensitive to what it checks (there, the AI call answers 502 instead of 404). 10 of 10 checks both times |
| 4 | Both old AI routes answer 404 when disabled | **Pass** | `GET /api/ai/usage` and `/api/analyze/qualitative` answer 404 for GET, POST, HEAD, OPTIONS and PUT; in the browser the live page shows the word `not-available` and keeps working. A side-by-side run of 29 requests against the production package and the patched one: 20 identical, 9 different, all 9 on these two routes |
| 5 | Nothing in the deployment affects the personal Chrome extension | **Pass** | The extension (and the stable personal copy) call only `/api/search` and `/api/captures` on the server (and fetch sites directly); neither is changed (search and captures answer identically in the 29-request comparison; `/api/captures` is 404 on production today and stays 404). The extension contains **no reference** to the two AI routes (0 matches). It is a separate program with its own storage under its own ID; the deployment replaces only the website's Worker and its files remain identical. Nothing in `C:\Users\insur\ChroniumMind-Personal` is touched |
| 6 | The exact rollback command and deployment target | **Pass** | Section 10 below. Target: Worker **`chronium-mind`**, account `marimercruz8@gmail.com` (`c0059d95...`, the only account this login sees), top-level configuration (no `--env`), KV `CONNECTOR_HEALTH` `4ed1a352…`. Rollback target `60045ea5-992c-499e-8290-a8ef08572667`, present in the version history |
| 7 | The patch is fail-closed, including when `AI_ENABLED` is absent or malformed | **Pass** | `scripts/verify-ai-off-failclosed.mjs` loads the patched Worker unchanged and tries **36 values** (missing, null, empty, space, `ON`, `On`, `true`, `1`, numbers, booleans, `yes`, `enabled`, leading/trailing spaces, newline, tab, quotes, `off`, `false`, `0`, the words `null`/`undefined`, `{}`, `[]`, `["on"]`, an object whose text says "on", look-alike Cyrillic and full-width characters, a zero-width space, a 10,000-character string) against 7 requests each (GET, POST, HEAD, OPTIONS, PUT on the analysis route; usage; POST to usage): **every one answers 404**, and 12 path tricks (trailing slash, upper case, double slash, `%71`, `%00`, `?x=1`, `#frag`, `./`, `../`, `/api/ai/usage/`, `.json`, `/api/ai`) all answer 404. Only the exact string `on` enables it, and even then, with no key, a call fails inside the Worker before any network request. Zero outbound requests were attempted by any of it. The comparison is exact (`=== "on"`), made before any other code on those paths runs |
| 8 | Whether any other live route can invoke Anthropic or incur charges | **None can** | In the Worker source there is exactly **one** call that reaches a model (`provider.complete`, inside `handleQualitativeAnalysis`) and **one** address that sends to Anthropic (`api.anthropic.com`, in the adapter); the analysis handler is called from one place, after the switch. `/api/ai/usage` only reads the counters (no model call) and is also behind the switch. The Worker has only a `fetch` handler (no scheduled, queue or email triggers). Its other outbound destinations are free public archive services with no key: Arquivo.pt, the Wayback Machine, Common Crawl, Memento. The only credentials it reads are the KV binding and `ANTHROPIC_API_KEY` (an R2 name appears in a comment only). The production configuration has no R2, D1, queue or AI bindings. The account is on the Workers Free plan, so Worker requests cannot be billed |

## 10. The final release command, and rollback (NOT RUN: waiting for Mari's explicit approval)

Before running it: confirm the current production version is still `60045ea5-992c-499e-8290-a8ef08572667` (`npx wrangler deployments list --name chronium-mind`) and that you have reviewed your Anthropic spending controls.

**Deploy** (from the project folder, using the installed Wrangler 4.127.0):
```
cd C:\Users\insur\chronium\.release\ai-off-package
node ..\..\node_modules\wrangler\bin\wrangler.js deploy --message "Switch off the paid-AI routes (Worker only; no front-end change)"
```
Expect: Worker `chronium-mind`; bindings exactly `CONNECTOR_HEALTH (4ed1a352…)`, `ASSETS`, `AI_PROVIDER ("anthropic")`; **no new assets uploaded**. **If it names a new or changed static file, stop and run the rollback.**

**Verify** (read-only; wait 30 to 60 seconds for every location to switch first; on staging the previous version kept serving for up to a minute):
```
cd C:\Users\insur\chronium
node scripts\verify-ai-off-release.mjs --package=.release\ai-off-package --url=https://chronium-mind.truewolfflix777.workers.dev --expect=after
```
Pass means: 16 of 16 static files identical, database version 4, no `boot.js`/`upgrade.js`, every other route unchanged, both AI routes 404. If `/api/ai/usage` still answers 200, wait a minute and rerun once.

**Rollback** (one command; resources such as KV are not changed by a rollback):
```
cd C:\Users\insur\chronium\.release\ai-off-package
node ..\..\node_modules\wrangler\bin\wrangler.js rollback 60045ea5-992c-499e-8290-a8ef08572667 --message "Roll back the AI-off release"
```
then `node scripts\verify-ai-off-release.mjs --package=.release\ai-off-package --url=https://chronium-mind.truewolfflix777.workers.dev --expect=before` (it expects the pre-release behaviour: usage 200, analysis 405).

## 11. After the shutdown is deployed and verified: removing the Anthropic key (NOT DONE; waiting for approval)

Not before section 10's verification passes, and not before you have reviewed your Anthropic account's spending controls.

1. **Identify the key.** In the Anthropic Console, open the API keys list. The live counters show the last model call on **2026-08-29 about 22:09 UTC**: the key whose "last used" date matches is the one bound to this Worker. If you named a key for Chronium, that is it. Check no other project uses it.
2. **Remove the secret from the Worker** (production). This creates a new version and deploys immediately:
   ```
   cd C:\Users\insur\chronium\.release\ai-off-package
   node ..\..\node_modules\wrangler\bin\wrangler.js secret delete ANTHROPIC_API_KEY
   ```
   Then `node scripts\list-worker-bindings.mjs`: `chronium-mind` must list no `ANTHROPIC_API_KEY`; and rerun the verifier with `--expect=after`.
3. **Revoke the key at Anthropic** (delete it in the Console's API keys page). **This is the step that makes it permanent.** Cloudflare's documentation does not say whether a rollback to an older version would restore a deleted secret (a secret change is recorded as its own version), so a revoked key is the only thing that guarantees the old route could never spend again even after a rollback.
4. Leave `AI_PROVIDER` as it is; it is harmless. The route is already off.

## 12. A finding during this pass: a credential stored as a plain variable (staging)

On **2026-10-26** Mari added an OpenAI key to the **staging** Worker as a **plain-text variable** named `OPENAI_API_KEY` (the value was never displayed here: every check since redacts it). A plain-text variable is not a secret: its value is shown in the dashboard and returned by the account API to any tool using the Cloudflare login. Production has no OpenAI key. Staging's AI switch is `off` and the code deployed on staging (version `db94028d`) predates the OpenAI adapter and does not read it, so nothing can use or spend it. Fix (Mari's step, see `docs/AI_OPENAI_PLAN.md` section 1): delete the variable, add it back with the type **Secret** (or `npx wrangler secret put OPENAI_API_KEY --env staging`), and consider rotating the key since it has been stored as readable text. `scripts/list-worker-bindings.mjs` audits every Worker and flags this case without printing values. Also: by default a `wrangler deploy` replaces a Worker's plain variables with the ones in the configuration file (Wrangler has a `--keep-vars` option to prevent that), so a dashboard-added plain variable can be silently dropped by the next staging deploy; a secret is not affected.
