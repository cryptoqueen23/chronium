# Claude Handoff: Chronium Mind (updated 2026-10-23, after Deep Discovery Phase 0)

Start a new session here. This file is rewritten at the end of meaningful work, not appended to. Read it, then `docs/CANON.md` (binding rules: Product Principles, Investigative Standard, Bootstrap Rule, Accessibility standard), then `docs/ROADMAP.md`.

Repo: github.com/cryptoqueen23/chronium, local clone `C:\Users\insur\chronium`. Cloudflare Worker (`wrangler dev` / `wrangler deploy`), static front end in `public/`, Chromium MV3 extension in `extension/`.

## State right now

| Item | State |
|---|---|
| `origin/main` | `408b366` (Deep Discovery Phase 0; pushed and verified equal to local) |
| Local only | nothing, except possibly this handoff update (docs only), which needs Mari's approval to push |
| Live site `https://chronium-mind.truewolfflix777.workers.dev` | **Unchanged since before all of this work.** None of Ask Chronium, export/import, the three views, light theme or Deep Discovery is live. **Nothing has been deployed.** |
| Working tree | clean after the Phase 0 commit |

Standing rules from the owner (Mari): never force-push; push only commits she names; never deploy without explicit approval; do not claim WCAG conformance; report benchmark numbers honestly (official harness result, hand-grading is only supporting evidence); free-only / Bootstrap Rule (no billing, accounts, paywalls, paid APIs, or mandatory AI yet); keep the four main areas Search / Compare / My Research / Reports; no new top-level navigation.

## What exists (all in the repo)

- **Historical search** (Worker `src/index.js`): Arquivo.pt, Wayback, Common Crawl, Memento; dedup, link check, circuit breaker in KV, archive viewer.
- **Investigation workspace** (IndexedDB, `public/db.js`): sources, evidence passages, subjects, evidence-backed relationships, claims + evidence links + findings, review queue, bulk ingestion. Optional AI (Qualitative Analysis) behind `src/ai/`, explicit click only.
- **Case portability** (`public/portable.js`, `portableDb.js`): versioned `.chronium.json`, preview-first merge, never overwrites, dedupes sources, renumbers clashing source/claim numbers. Same code in website and extension.
- **Ask Chronium** (`public/askRouter.js`, `askRender.js`; docs `ASK_CHRONIUM.md`): deterministic question router over one investigation's snapshot. No AI, no network. Clarifies instead of guessing; says what is not established.
- **Investigation views** (`public/views.js`; docs `INVESTIGATION_VIEWS.md`): Big Picture / Overview / Deep Dive from one model; "How do we know?" on every key statement; opening an investigation lands on Big Picture; Research is a separate tab.
- **Extension** (`extension/`): side panel with Search, Compare (placeholder), My Research (cases, import/export, views, Ask Chronium), Reports. Shared code is copied into `extension/lib/` by `node scripts/sync-extension.mjs` (run after changing `public/{db,entities,claims,ingestionReview,portable,portableDb,askRouter,askRender,askCommands,views}.js`).
- **Themes**: dark and light (system setting), `prefers-contrast`, reduced motion, forced-colors tab styling. Control boundaries use `--control-border` (website) / `--control` (extension) at 4.5:1 or more; decorative borders deliberately do not.

## Deep Discovery Phase 0 (built and pushed)

Plan: `docs/DEEP_DISCOVERY_PLAN.md` (read its "Changes to this plan after Phase 0"). Code: `public/discovery/` (config, urlGuard, robots, scheduler, links, outcomes, ledger, connector, fetchers, engine, report). Foundation only: robots.txt policy with Crawl-delay, per-host serial scheduling, URL and redirect safety with private-address blocking, bounded link discovery, hard limits, outcome words, a ledger and coverage table ("where Chronium looked"), a connector interface and a host policy registry, a fetcher contract, and accessible progress/status UI pieces. **No document retrieval, no sitemaps, no archive recovery, no UI in the product yet (Phase 1+).** Library files are in `public/` so they would ship as static assets on the next deploy; they have no route and are not wired into any page. They are NOT copied into `extension/lib/` yet.

**CivicPlus finding (important):** `docs/CIVICPLUS_VERIFICATION.md`. Copperas Cove is CivicPlus-hosted; robots.txt (group `*`) allows the agenda and document paths with `Crawl-delay: 10` (the extra blocks for calendar/RSSFeed/bids are only for named AI crawlers); the AgendaCenter list loads by a script POST to `/AgendaCenter/UpdateCategoryList`; the CivicPlus Terms of Use (updated 2022-09-01, read through a summarising tool, a person should re-read) forbid automated systems beyond human request rates and access outside the provided interface, with liquidated damages above 1,000 page requests a day; the city asserts copyright and states nothing about automation. **Automation for `copperascovetx.gov` is registered `unverified` and the engine refuses to contact it.** The CivicPlus adapter is NOT written. Decision needed from Mari: ask the city/CivicPlus in writing, accept a recorded risk, or use only user-directed capture / user-supplied URLs / a Public Information Act request.

Limits (centralised in `config.js`, hard ceilings cannot be exceeded): depth 2, 150 pages, 100 document links, 3 runs/day, 25 website-mode fetches, 400 requests/run, 500 requests/host/day, 10 MB per file, 2 MB per page, 3 redirects, 20 s timeout, politeness floor 3 s, never faster than a site's Crawl-delay.
Measured on a synthetic local site at default caps: 151 requests, 0.42 MB, 25 minutes at a 10 s Crawl-delay, about 330 ms CPU, about 4 MB memory (`node scripts/discovery-measure.mjs`).

Phase 0 tests: `npm run test:discovery` (37 unit and integration tests against a deterministic local site, fake clock, no real network; included in `npm test`) and `node scripts/test-discovery-browser.mjs --chrome=<CfT>` (26 checks: live status, keyboard Pause/Resume/Cancel, coverage and request-log tables, axe at 320 to 1280 px in both schemes). A test caught a real bug (a seed's redirect bypassed the scope check); fixed and covered.

Phase 1 (not started, needs approval): single-document retrieval with provenance, the extension fetcher (per-domain optional host permission, network rules blocking private targets, User-Agent via declarativeNetRequest if possible), website proxy `/api/fetch` (small, guarded), UI in My Research, user-directed capture of the page being viewed.

## Benchmark (official, do not inflate)

`scripts/run-acceptance-test.mjs` (12 Ask questions, questions and expected outcomes unchanged): **7 WORKS, 2 PARTIALLY WORKS, 3 DOES NOT WORK.** Hand-graded supporting view: 10 correct, 2 partial, 0 wrong (Q7 "Historical Society" and Q9 "Ordinance 2026-29" are correct "nothing in the case" answers, verified by grep of the corpus, which the harness scores as not working). The earlier "6/12" contained a false positive (Q9). Full table in `docs/ASK_CHRONIUM.md`. One run in this session died with a Chrome "Target closed" error; a re-run was clean (flaky browser, not a regression).

## Tests (all passing after Phase 0)

| Command | Result |
|---|---|
| `npm run check` | syntax clean |
| `npm test` | 155 unit and integration tests (118 earlier + 37 Deep Discovery) |
| `node scripts/test-extension.mjs --chrome=<CfT>` | 9 |
| `node scripts/test-portable-browser.mjs --chrome=<CfT>` | 14 |
| `node scripts/test-ask-browser.mjs --chrome=<CfT>` | 16 |
| `node scripts/test-views-browser.mjs --chrome=<CfT>` | 56 |
| `node scripts/test-a11y.mjs` (axe sweep) | clean |
| `node scripts/test-a11y-deep.mjs` | 128 (themes, keyboard walk incl. focus-not-obscured, real 400% zoom, emulated touch, accessibility tree) |
| `node scripts/test-a11y-modes.mjs` | 146 (forced-colors, prefers-contrast, text spacing, reduced motion, pixel focus ring, form errors, reflow) |
| `node scripts/test-contrast.mjs` | 132 measurements, 0 below 3:1 (report: `docs/CONTRAST_REPORT.md`) |
| `node scripts/test-discovery-browser.mjs --chrome=<CfT>` | 26 (Deep Discovery status UI) |
| `node scripts/screenshots-views.mjs` | 28 real screenshots in `docs/screenshots/` |

Browser tests need `wrangler dev` on port 8787 and **Chrome for Testing** (regular Chrome 137+ ignores `--load-extension`): `~/.cache/puppeteer/chrome/win64-152.0.7977.75/chrome-win64/chrome.exe`. Set `PUPPETEER_EXECUTABLE_PATH` to it for `run-acceptance-test.mjs`.

## NOT done (do not claim)

- **NVDA, VoiceOver, real touch device, real Windows High Contrast: not tested.** Checklist for a person: `docs/MANUAL_A11Y_TESTS.md`. **WCAG 2.2 AA conformance is not claimed.**
- Open follow-ups (also in ROADMAP): (1) benchmark harness should separate correct abstentions from retrieval failures; (2) financial extraction beyond `$` amounts; (3) structured vote identification; (4) evidence-based contradiction analysis; (5) real document/historical comparison in the Compare tab; (6) Spanish question understanding and localization; (7) the manual accessibility tests. Also: per-field error association for the investigation forms (currently an announced alert toast); Easy Reading mode; connectors below.
- Free connectors in the order Mari gave: municipal (agendas, minutes, budgets, audits, check registers, contracts) -> municipal bonds (MSRB EMMA) -> Texas (Comptroller, legislature, campaign finance) -> federal (USAspending, GovInfo, Congress.gov, Federal Register) -> nonprofits (IRS 990, ProPublica) -> books (Open Library, Gutenberg, Internet Archive). **Verify each provider's terms and rate limits before coding; add a row to `docs/COST_DRIVERS.md` with each.** Also planned: Deep Discovery crawler, Records Recovery (Found / Historical copy found / Not located, request-vs-found comparison), literary search. Nothing here is started.

## Gotchas learned the hard way

- Many files have **mixed CRLF/LF endings**. Python edits: read/write with `newline=''` and convert `\n` in patterns; `scripts`-style helper at `%TEMP%\ed.py` (`rep(path, old, new)`) did this but lives outside the repo.
- In the Bash tool, **`\n` / `\\n` inside Python heredocs can be turned into real newlines**; use `chr(92)` for backslashes or the Edit tool. Very long heredocs can fail: use the Write tool for big files.
- `npm install` of one dev dependency previously **removed untracked packages** (puppeteer); they are now in `package.json` devDependencies.
- Puppeteer: **clicks hang on background tabs** (call `bringToFront()` first); screenshot `clip` uses **page** coordinates (add scroll offset); enabling touch emulation **reloads** the page; `[class] .btn` style selectors often match hidden dialog elements (scope to the visible view).
- Kill stale `wrangler dev`/`workerd` listeners before restarting (check port 8787 with `netstat`); a stale one answers requests with old files.
- Quick real-browser zoom: `chrome.tabs.setZoom` via the extension's service worker (website) or `chrome.tabs.getCurrent()` from the panel page.
- The extension's saved cases live in the **extension's own IndexedDB**, separate from the website's; move cases with Export / Import case file.

## Immediate next steps for a new session

1. Phase 0 is pushed. Do not start Phase 1 or deploy without Mari's explicit approval.
2. Get Mari's decision on **CivicPlus / Copperas Cove** (see above). Until then keep the host `unverified`.
3. Phase 1 plan items (above), then Phase 2 (bounded crawl, recovery via the existing archive providers, three outcomes) per `docs/DEEP_DISCOVERY_PLAN.md`.
4. A person should run `docs/MANUAL_A11Y_TESTS.md` (NVDA/VoiceOver/touch); still not done.
5. Remaining roadmap follow-ups: harness that separates correct abstentions from retrieval failures; financial extraction beyond `$`; structured vote identification; evidence-based contradiction analysis; real document comparison in Compare; Spanish; per-field error association in the investigation forms.

## Memory

Project memory for Mari's other projects lives at `C:\Users\insur\.claude\projects\C--Users-insur\memory\`; the Chronium entry points to this file.
