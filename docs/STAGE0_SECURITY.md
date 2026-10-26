# Stage 0: security and safety hardening

Status: implemented locally, committed locally, **not pushed, not deployed**. Stage 1 has not been started. Nothing here changes what the live site does today: with the committed configuration every new network-facing feature is switched **off** inside the Worker.

Written for: Mari, to review before approving any push or deployment.

## 1. What Stage 0 changed, by blocker

| # | Blocker | What now happens |
|---|---|---|
| B1 | Archived content could run code next to the app | Captured pages are only ever returned as data to the app's own `fetch()`. Every response carries `Content-Security-Policy: sandbox` (scriptable or unknown types get the strict policy), `nosniff`, `no-referrer`, `Cross-Origin-Resource-Policy: same-origin` and `Vary: Sec-Fetch-*`. A direct address-bar or frame load is refused by the Worker (`Sec-Fetch-Dest` must be `empty`). The app shows captures only inside a sandboxed frame. Every redirect destination is re-checked against the archive host list and the URL guard; at most three hops. Size is enforced on the stream. |
| B2 | Limits lived in the browser | The Worker enforces per-visitor and per-site per-minute counts, a global per-day count, concurrency slots, upstream timeouts and streamed byte caps, per route. If the counting storage is missing or fails the request is refused (503): no limit means no service. Production environment values can only **lower** the built-in ceilings. |
| B3 | Silent one-way database upgrade (v4 to v12) | A start-up gate inspects the browser's database **without upgrading it**. If an upgrade is pending and there is data, the person is asked to save a backup first (a plain file with every store) and may choose "Update without a backup" after a confirmation. A brand-new browser gets no prompt. A blocked or failed upgrade is explained and offers a retry; nothing is changed until the upgrade succeeds. See section 5. |
| B4 | Six old workspace links | `#/workspace/sources, outline, claims, timeline, gaps, analysis` redirect to their new homes, select the right tab, announce the move in a live region and put keyboard focus in the workspace. An unknown address falls back to the Big Picture. |
| B5 | Paid AI abuse | The two AI routes go through the same guard: switch on, caller check, body-size check, per-visitor and global daily ceilings, per-minute burst limit. AI is available only when its switch is on **and** both ceilings are configured; otherwise the route answers 404. The provider key is a Worker secret and never appears in any response (tested by scanning every response and header). |
| B6 | No measurements | `scripts/measure-worker-resources.mjs` and section 7. Real edge CPU can only be measured in Stage 1. |
| B7 | Test settings could weaken production | Test-only variables are honoured only when `TEST_MODE` is `on` **and** `ENVIRONMENT` is not production. An unset `ENVIRONMENT` counts as production. Any test-only variable present in a production environment makes the guarded routes answer 503. `npm run deploy` refuses to deploy an unsafe configuration (section 4). |

## 2. Kill switches

Five independent switches, all `"off"` in the committed configuration. A switch must equal exactly `"on"`; anything else is off.

| Variable | Guards |
|---|---|
| `FEATURE_DISCOVERY_FETCH` | `/api/fetch` (Find Records document fetching) |
| `FEATURE_DISCOVERY_CAPTURES` | `/api/captures` (archive look-ups) |
| `FEATURE_VIEW_CAPTURE` | `/api/view-capture` (in-page archive viewer, downloads) |
| `FEATURE_ASK_SOURCES` | `/api/analyze/ask-sources` (also needs `AI_ENABLED`) |
| `AI_ENABLED` | `/api/analyze/qualitative`, and Ask Sources |

The **Worker** enforces them. A disabled route answers `404 {"error":"not-available"}` to *any* request, including a perfectly formed browser request, so hiding the button is not what protects it. `/api/features` reports the effective state as booleans so the screens can explain themselves; it carries no secrets. Tested on a real Workers runtime in `scripts/test-stage0-http.mjs`.

## 3. Who may call, and how

- Browsers send `Sec-Fetch-Site` on every request. Anything that does not say `same-origin` is refused (403), so a plain script or `curl` without browser headers is turned away. The only exception is a named browser extension, and only on `/api/fetch` and `/api/captures`, when its `chrome-extension://<id>` origin is listed in `ALLOWED_EXTENSION_ORIGINS`.
- **Limit of this control:** a determined person can send forged `Sec-Fetch-*` headers from a script. Headers alone cannot stop that. The per-visitor, per-site and per-day counters, the concurrency slots and the size caps still apply to such a caller, and the Cloudflare dashboard rate-limit rule in section 8 is the backstop.
- The URL guard refuses non-HTTP(S), credentials in URLs, private, loopback, link-local and metadata addresses, unusual ports, and numeric or encoded host tricks. For documents, hostnames are also resolved through a DNS-over-HTTPS check (A and AAAA) and refused if any answer is private; if the check cannot be made the request is refused (fail closed). Redirects are never followed automatically: the Worker hands the redirect back or re-validates each hop itself.

## 4. Configuration safety (B7)

- `wrangler.jsonc` sets `ENVIRONMENT: "production"` and every switch `"off"`.
- `npm run deploy` runs `scripts/validate-production-config.mjs --dry-run` first. It checks the file **and** the variables wrangler reports it would deploy, so a `--var` typed on the command line is caught. It rejects: a missing or wrong `ENVIRONMENT`; any test-only variable; a missing or loosely written switch; any switch that is `on` unless it was named with `--allow-on=...` (a deliberate, recorded choice); AI `on` without both ceilings as whole numbers; non-numeric `LIMIT_*` values.
- Production values for `LIMIT_<ROUTE>_...` can only lower the built-in limits. Test mode may set exact values.
- Tested by `scripts/test-config-safety.mjs`.

## 5. The one-way IndexedDB door (B3)

The live site uses database version 4. This build uses version 12. Opening the database with the new code upgrades it in place and **older app versions cannot reopen an upgraded database**. That is a property of IndexedDB, not something we can undo, so:

1. Start-up inspects the database without upgrading (`public/upgrade.js`). If it does not exist, nothing is created yet.
2. If an upgrade is pending and cases exist, a dialog (alert dialog, focus on its title, keyboard-contained) offers **Download backup** first. "Update now" becomes available after the backup is saved. "Update without a backup" needs a confirmation.
3. The backup is a generic copy of every store (files as base64), written at the old version. **Restore** adds missing items and never overwrites existing ones.
4. If another tab holds the old database open, the upgrade is blocked after 15 seconds; the person is told in words, told their cases are unchanged, and can retry once the other tab is closed.
5. If the live site is rolled back to the old app after an upgrade, that browser's cases will not open in the old app. Restore from the backup file into a browser that has the old database, or roll forward.

Tests: `scripts/test-db-upgrade-safety.mjs` (data layer) and the "upgrade:" checks in `scripts/test-stage0-http.mjs` (real Chrome, a v4 database created by the production code from commit d80ef66): prompt shown before any change, backup contents, upgrade preserves the case, restore, declined and confirmed no-backup paths, a blocked upgrade and its retry, a brand-new browser, keyboard containment, axe (dark and light, 320 and 1280 px), 44 px buttons.

## 6. Staging design for Stage 1 (not created)

`wrangler.jsonc` contains an `env.staging` block: its own Worker name (`chronium-mind-staging`), its own KV namespace (the id is a deliberate placeholder until the namespace is created), `ENVIRONMENT: "staging"`, every switch `"off"`. The validator refuses to deploy staging while the placeholder remains, if it names the production KV namespace or Worker, or if `ENVIRONMENT` is wrong. Secrets belong to a Worker, so the staging Worker holds **no** production AI key unless one is deliberately set on it; staging cannot write production investigations because investigations live in each person's browser, not in a server. A staging provider key, if ever used, should be a separate low-limit key.

## 7. Measured resource consumption

Official limits were read from the Cloudflare documentation (Workers Free plan) when this work was done and must be re-checked in the dashboard before any deployment: 100,000 requests/day, 10 ms CPU per request, 128 MB memory, 50 subrequests per request, 6 simultaneous outgoing connections. These are the numbers the limits in `src/guard.js` are sized against.

Local measurements (`node scripts/measure-worker-resources.mjs`, local workerd, local fixtures; **not edge numbers**):

MEASUREMENTS_PLACEHOLDER

What this does and does not tell us: bodies are streamed and byte-capped, so memory does not grow with document size, and over-limit documents are cut off at the cap. CPU on the edge for large bodies has **not** been measured and must be read from the Workers metrics of a staging Worker in Stage 1 before any feature is switched on.

## 8. Remaining risks and decisions that need approval

Risks that remain after Stage 0:

1. **Forged browser headers** (section 3): counters and caps still apply, but a script can imitate a browser. Needs a Cloudflare dashboard rate-limit rule (a dashboard setting, outside the code) before any feature is switched on.
2. **Counters are per data centre and not atomic** (Cache API). A burst across data centres can exceed a limit by a small multiple. The global daily ceiling is the loose backstop; the dashboard rule is the firm one.
3. **DNS check is a point-in-time check** (a small gap between the check and the connection remains). Redirects are re-validated, private ranges are refused after resolution, and the fetch itself is made by Cloudflare's network, which also refuses its own internal addresses.
4. `ack` and `seed` (the person confirmed a site's policy / the site came from the person) are claims by the caller and cannot be verified by the server. They gate friendliness, not safety; safety does not depend on them.
5. **Archive viewing relies on the sandbox policy and the navigation check**, both on the app's own origin. Serving captures from a separate origin (for example a different registrable domain) is stronger and is listed below as a decision.
6. Real edge CPU is unmeasured (section 7). The real Chrome permission-prompt test for the browser extension is **still not run**; simulated tests do not replace it, and it remains mandatory before any extension release.
7. No claim of WCAG conformance is made. Automated axe checks and keyboard tests pass for the new screens; the manual checks in `docs/MANUAL_A11Y_TESTS.md` still apply.

Decisions that need Mari's approval (none has been taken):

- Whether to serve captures from a separate origin.
- Whether to add a human check (for example Cloudflare Turnstile) in front of document fetching.
- Creating the staging KV namespace and the staging Worker (Stage 1).
- The Cloudflare rate-limit rule and its numbers.
- The AI ceilings (`AI_PER_VISITOR_PER_DAY`, `AI_DAILY_CEILING`); AI stays off until they are chosen.
- Whether the website's "Find Records" ships at all, or stays an extension feature.

## 9. Deployment checklist (for a later, separately approved release)

1. Re-read the Cloudflare limits in the dashboard; add the rate-limit rule.
2. `npm run check`, `npm test`, the browser suites and `scripts/test-stage0-http.mjs` all green.
3. Back up note to testers: the database upgrade is one-way (section 5).
4. `npm run deploy` (validator first). Switch features on only one at a time, with `--allow-on=<VAR>`, and watch the Workers metrics.
5. Rollback: `wrangler rollback` to the version recorded before the release. Switches can also be turned off without a code change.

## 10. Tests added or changed

`scripts/test-stage0-security.mjs` (28), `scripts/test-config-safety.mjs` (8), `scripts/test-db-upgrade-safety.mjs` (6), `scripts/test-stage0-http.mjs` (real Workers runtime plus real Chrome, 56 checks), `scripts/run-browser-suites.mjs` (runs every browser suite against fresh local Workers). `scripts/test-discovery-phase1.mjs` and the discovery and recovery browser suites were updated to the new test configuration.
