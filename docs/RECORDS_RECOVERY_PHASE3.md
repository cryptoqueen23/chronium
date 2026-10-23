# Records Recovery (Phase 3): as built

Status: **built and tested locally on 2026-10-23. Committed locally; not pushed; not deployed.** The design is `docs/RECORDS_RECOVERY_PLAN.md`, including its section 14 (the Section 12 decisions as resolved, and the amendments). This file records what was actually built, how it behaves, how it was tested, what it does not do, and whether it is ready to deploy (it is not; see the end).

## The distinction this feature must keep

**A gap in Chronium's evidence inventory is not necessarily a gap in the government's records, or in its response to a public information request.** This sentence is on every screen, every table-bearing output, the Big Picture summary, the report appendix and the follow-up draft. The wording scan in the tests refuses any generated text that says a record "does not exist", that an agency "failed to produce", "withheld", "refused", "violated", or uses the bare word for a gap that this feature replaced with "not held in this case".

## What was built

| Piece | Where | Notes |
|---|---|---|
| Pure modules (no network, clock, randomness or storage) | `public/recovery/{config,facts,series,match,request,detect,model,report}.js` | A test fails if any of them uses `fetch`, `XMLHttpRequest`, `WebSocket`, `indexedDB`, `localStorage`, `Math.random`, `Date.now()` or `new Date()` |
| Local store | `public/recovery/store.js`, IndexedDB **version 12** (`recoveryReviews`, `recoveryRequests`, `recoverySettings`) | Only a reviewer's decisions, the person's requests with their corrections and follow-up drafts, and the case's settings are stored. **Calculated results are never stored.** All three travel in `.chronium.json`; older files without them still import; deleting a case removes them. The store has no write path to evidence, claims, relationships or findings (tested) |
| Screen | `public/recovery/panel.js`, `recovery.css`; website tab **Records Recovery** | Pattern setting; request box; correction editor; decisions; follow-up draft |
| Big Picture summary | `views.js` + `recovery/report.js` | Counts, the notice, a link to the tab |
| Deep Dive section | `views.js` | Every item with its evidence and decision |
| Report appendix | website Report tab; extension Reports (plain text) | Notice, items, "What remains unknown" |
| Extension | synced to `extension/lib/recovery/` | Big Picture summary and the Reports appendix. **The full editing screen is not in the side panel** (it says so and points to the website; cases move by Export and Import) |

## The six steps you listed

1. **Request parsing and user correction.** Paste a request; fixed rules read it into items (kind of record, body, date range / single date / month / year / "since", fiscal year, citation number, "all"). A line naming several kinds of record becomes one item for each. Every item shows the words it came from and "partly inferred" or "requires your review" where that applies; unreadable bullets stay as free text. The person edits any field (labelled), adds and removes items, and nothing is saved until Save request. Swapped dates are fixed and announced; invalid values are refused.
2. **Evidence inventory and matching.** `facts.js` reads each source's type, body, date, fiscal year, citations and readability, recording **where each fact came from**. `match.js` implements the tiers below.
3. **Gap detection.** G1 agenda/minutes pairs; G2 recurring-series dates with no document; G3 annual documents (budget, audit) with a fiscal year absent between two held years; G4 documents linked in a search but not retrieved (from the stored search records, closed if the file is later imported); G5 ordinances, resolutions and contracts cited but not held; G6 held but cannot be searched yet; G7 limits of the searches made; G8 content that changed between retrievals. Each item states **what was searched** and **what is not concluded**.
4. **Reviewer decisions and portable export/import.** Acknowledge (stays open); Confirm a match (closes it, naming the source if chosen, shown as "Closed by a reviewer", never "found by Chronium"); Not applicable (a reason is **required**); Reopen. Append-only; the latest decision wins; each shows who, when and why. They export and import with the case, and the calculated items are identical on the other device (tested).
5. **Big Picture and Deep Dive integration.** As above.
6. **Report appendix and editable follow-up request.** Built from the request items that are *Not held in this case*, *Partly located*, *Possible match, requires review* or *Cannot assess*. It says it describes **the person's own research file, not what the agency holds**, asks the office to say which records exist and to explain if any cannot be released, includes "what I searched", leaves bracketed placeholders (name, agency, date, and a prompt to check the Texas Public Information Act, Texas Government Code Chapter 552, and its current timelines), and contains no accusation, deadline claim or legal conclusion. It is editable text in a box; edits are saved with the request; **Chronium never sends it**.

## Matching rules as built (section 14 of the plan)

| Tier | Rule | May close a gap? |
|---|---|---|
| Exact | Same SHA-256 or same original address | Yes |
| Series | Same type, body and date, **each read from the document's own text** (a date, type or body that came only from a file name or link makes it a Candidate) | Yes |
| Reference | The document carries the number a citation names | **No**: "possible match, requires review" (or, in a citation gap, listed for information only) |
| Candidate | Some details agree; details from names only; dates stated differently in different places; a date one to three days away | **No**: requires review |
| None | Nothing fits | The gap stays open |

A different type never matches; a different named body never matches; a near number is not a match; an agenda never satisfies minutes. A reviewer's confirmation can close what the rules cannot.

**Cadence.** A recurring series is recognised only from at least `cadenceMinDocuments` dated documents (**default 4, configurable 3 to 12 on the screen, saved with the case, shown in every report**), when at least 80% of the dates sit on one pattern (monthly on the nth weekday, monthly on a day, every two weeks, or weekly) and at least 60% of the dates that pattern expects inside the held range are held. A series with two meetings a month, irregular dates, or too few documents produces **no pattern and therefore no gap**. Nothing is inferred outside the range of held dates. Every pattern-based item says it does not show that a meeting took place, that a record was created, or why the case holds nothing for that date.

## Tests

| Command | Result |
|---|---|
| `npm test` | **219 passing** (181 earlier + 38 Records Recovery) |
| `npm run test:recovery` (`scripts/test-recovery.mjs`) | 38: facts (all date forms, ambiguity, conflicts, type from the heading, citations, own numbers, readability), request parsing and correction, patterns (monthly, weekly, biweekly, refusals, configurable threshold, clamping), every matching tier and protection, the detectors G1 to G8, **the answer keys**, request evaluation, reviewer decisions, wording scan, notice on every output, escaping, follow-up draft, purity/safety scans, performance, store round trip, export/import (twice = no change; older file imports), upgrade from database version 11 |
| `node scripts/test-recovery-ui.mjs` (needs `wrangler dev --port 8791`) | **75 checks**: the tab; the notice; the planted gaps in their tables; no banned wording on screen; table structure; keyboard decisions with announced status and an accessible error for the required reason; evidence untouched; the setting; request read, corrected, saved and compared; follow-up edits persisting across reload; **no outbound request**; Big Picture, Deep Dive and Report surfaces; 320/375/768/1024/1440 px in both themes; axe at 320 and 1440 px; 44 px targets; text spacing; forced colors; the extension's summary and Reports appendix |
| Regression, unchanged counts | discovery UI 74; discovery extension 28; discovery browser 26; extension smoke 9; portable browser 14; views browser 57 (56 + 1 new); ask browser 16; a11y sweep 37 and clean; a11y deep 128; a11y modes 146; contrast 132 |

**Answer keys (synthetic "Larkspur Falls" council, 12 monthly meetings of 2024).** A *complete* series (every agenda has minutes, budgets FY2022 to FY2024, five held and cited ordinances) reports **zero gaps** (the held, cited ordinances are listed "for information only"). The *incomplete* series (minutes for March 12, June 11 and September 10 removed; everything for May 14 removed; the FY2023 budget removed; ordinances 2024-21 and 2024-22 cited but not held) reports **exactly seven items and nothing else**: three pairs, one date, one year, two citations.

**Performance.** 10,000 documents plus a 2,000-row ledger: about **720 ms** in Node (the test allows 2,000 ms). (A first version took 9.4 s; the pattern comparison was quadratic and was rewritten.)

## Sample gap report (synthetic case, plain-text form of the report appendix)

```
RECORDS RECOVERY
This list describes what this case holds. It is not a statement about what the government holds, and a gap here is not evidence that the government lacks a record or that a request was handled wrongly.

Sources this case holds: 26 (19 with a readable date). Recurring series are recognised from at least 4 dated documents.

My request: each requested item compared with what this case holds
- Minutes, city council, January 1, 2024 to December 31, 2024: Partly located in this case. 8 held. Dates the recognised pattern (monthly, on the second Tuesday) expects, with no document of this type held: March 12, 2024; May 14, 2024; June 11, 2024; September 10, 2024. The pattern does not show that a record exists for those dates.
- Budget, fiscal year 2023: Not held in this case. No budget for any body dated in fiscal year 2023 is held in this case.
- Ordinance 2024-21: Not held in this case. No document in this case carries ordinance 2024-21.
- Minutes, city council, January 9, 2024: Located in this case. Matched on type, body and date or fiscal year, read from the documents' own text.

Agenda and minutes pairs (Pairing-based): 3
  - Minutes for March 12, 2024: not held in this case [Open]
      The case holds agenda for the city council dated March 12, 2024 but no minutes for the same date.
      Searched: No automated search is recorded for this case, so this comparison rests only on the documents the case holds.
      Not concluded: This does not show that the record exists elsewhere, that it was ever created, or why this case does not hold it. It describes this case only.
  (June 11 and September 10 likewise)

Recurring series: dates with no document (Pattern-based): 1
  - No agenda, minutes or packet held for May 14, 2024 [Open]
      The city council meeting documents: 11 dated documents in this case follow a pattern (monthly, on the second Tuesday). The case holds nothing within 3 days of May 14, 2024.
      Not concluded: A series gap does not show that a meeting took place on that date, that a record was created, or why the case holds nothing for it (meetings are cancelled and moved). The pattern was recognised from at least 4 dated documents, and that number can be changed.

Annual documents: years with no document (Pattern-based): 1
  - Budget for fiscal year 2023: not held in this case [Open]
Cited by a document in this case, not held (Citation-based): 2
  - Ordinance 2024-21 / Ordinance 2024-22: cited in this case, not held in this case [Open]

What remains unknown:
  - Chronium compares what this case holds with patterns and citations found in it. It has no list of the meetings or records an agency was expected to produce.
  - Dates, agencies and record types are read from words in the documents, file names and links; unusual wording is read as unknown rather than guessed.
  - Citations are found by pattern; some will be missed and some will be wrong.
  - Scanned pages and files whose text could not be read cannot take part in matching by their own words.
  - A gap in this list is a question for a person to look into. It is not a finding.
```

The follow-up draft for the same request lists only the three open items (the located January 9 minutes are left out), begins "I keep a research file ... It describes my own file only; I am not saying what your office holds, and I am not suggesting that anything was handled incorrectly", and ends with "What I searched: ..." and the Chapter 552 prompt.

## Remaining limitations

- **Patterns and citations are heuristics.** Dates, bodies and types come from words; unusual wording is read as unknown. Citations cover common US municipal forms (ordinances, resolutions, contracts); exhibits and attachments are deliberately not tracked.
- **No meeting calendar exists**, so completeness can only be judged against a pattern the case's own documents form. A case with few documents shows few gaps.
- **Documents found only by file name are routed to review**, not matched. In the extension, where PDFs have no extracted text, nearly every pairing is "requires review". This is intended (it is the verification rule), but it is noisy; extracting PDF text in the panel would reduce it.
- **Scanned documents** cannot take part until text recognition exists.
- **The extension has the summary and the report appendix only.** Editing requests, recording decisions and the follow-up draft are on the website. A decision recorded on the website reaches the extension by Export and Import.
- **Ask Chronium does not yet answer "what is not held?"** (the plan listed it). Not built.
- **Request parsing is rule-based.** It will misread unusual phrasing; that is why the person checks and corrects it.
- **The follow-up draft is a starting point, not legal advice.** It does not state the statute's deadlines or rights; it prompts the person to check the current statute.
- **A continued Deep Discovery search shows its own report**, so G4 and G7 use each address's most recent search outcome.
- **Single-person use**: decisions record a typed name, not an authenticated identity.

## Deployment readiness: NOT READY

1. **Nothing is deployed; nothing in this phase is pushed** until Mari says so.
2. **Release gate not run:** the extension's **real per-site permission prompt** (`docs/RECORDS_RECOVERY_PLAN.md` section 13, `docs/MANUAL_A11Y_TESTS.md` section I) is **NOT RUN**. Simulated browser tests do not replace it, and this feature does not change that.
3. **Manual accessibility checks are not done** (NVDA, VoiceOver, real touch, real High Contrast). New items are in `docs/MANUAL_A11Y_TESTS.md` section J. No conformance claim is made.
4. **CivicPlus / Copperas Cove stays blocked.** The permission letter and the public User-Agent page are drafts awaiting Mari (`docs/CIVICPLUS_PERMISSION_REQUEST_DRAFT.md`, `docs/drafts/chronium-crawler.html`); deploying the page and changing the User-Agent link needs her approval.
5. Database version 12 is an additive upgrade, tested from versions 10 and 11, but has not been tried on a large real case.
