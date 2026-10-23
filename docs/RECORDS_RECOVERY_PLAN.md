# Records Recovery: architecture, matching rules, gap-report design, acceptance tests

Status: **PLAN ONLY. Nothing here is implemented.** Written 2026-10-23 for Mari's review. Implementation (this is "Phase 3" of `docs/DEEP_DISCOVERY_PLAN.md`) starts only after she approves this plan. It follows `docs/CANON.md` (Investigative Standard, Bootstrap Rule, Accessibility standard) and builds on what Phase 0 and Phase 1 already record (`docs/DEEP_DISCOVERY_PHASE1.md`).

## 1. Purpose

After a search, a person should be able to ask: **what do we have, what should we expect to have, what could we not get, and what is still unknown?** Records Recovery answers that from the case itself, deterministically, and shows its work.

The Investigative Standard governs every sentence it produces: show where Chronium searched, what it found, what it could not access, and what remains unknown. **An unsuccessful search is never proof that a record does not exist.** A gap is a *question for a human*, never a finding, never an accusation.

### Non-goals (Phase 3)

No AI. No network requests (it reads only the case). No new crawling. No automatic claims, findings, relationships or accusations. No drafting of Public Information Act requests (that is Phase 4; only the *interface* to it is designed here). No change to the CivicPlus block. No billing, accounts or paywalls.

## 2. What already exists and is reused

| Existing piece | Used for |
|---|---|
| Outcome words (`outcomes.js`): Found / Historical copy found / Partially retrieved / Not located in the sources searched / Source unavailable / Access restricted / Search incomplete | The vocabulary for every gap; no new outcome words |
| `discoveryRuns` and `discoveryLedger` (IndexedDB v11) | Which sources were searched, when, what each address answered, what stopped the run |
| Source records with `discovery` provenance (original/final/archive address, retrieved time, hash, parent page, link text, classification hint) | Facts about each held document |
| `classify.js` (agenda, minutes, packet, budget, audit, check register, contract, ordinance, resolution) | Document type |
| `views.js` snapshot model and the Big Picture "Missing / Not reviewed yet / Unresolved" groups; "How do we know?" panel | Where results are shown and how they are explained |
| Findings class `NO_EVIDENCE_LOCATED` (investigator-asserted) | A person may *promote* a gap to a finding; Chronium never does |
| Review history / investigators (`reviewHistory`, non-authenticating identity) | Who acknowledged what, and when |
| Ask Chronium router | Answers "what is missing?" from the same model |

## 3. Architecture

A new pure module set `public/recovery/` (no DOM, no IndexedDB, no network; runs in the browser, the extension and Node), following the pattern of `views.js` (a snapshot in, a model out):

```
case snapshot (records, evidence, discoveryRuns, discoveryLedger, recoveryReviews)
        |
  1. facts.js      extract facts per held document: type, body, meeting/period date, fiscal year,
        |           numbers it cites (ordinance 2024-17, attachment 3 ...), readability
        v
  2. series.js     group documents into series (same body + same type), order by date,
        |           record how each series was established
        v
  3. match.js      match expectations and references to held documents; give each match a tier
        |
  4. detect.js     gap detectors G1..G8 (section 6); each returns items with evidence + statements
        |
  5. model.js      sort, group, attach reviewer decisions, build "How do we know?" targets
        v
  report.js        HTML (accessible tables), plain text, and Ask Chronium answers
```

- **Derived on demand, not stored.** Like the three views, the items are recomputed from the snapshot every time, so they can never go stale or disagree with the evidence. Only **reviewer decisions** are stored (section 7).
- **Same engine, three surfaces:** a "Records Recovery" panel in **Big Picture** (counts and the top items), a full section in **Deep Dive** (every item with its evidence), and an appendix in the **Report** tab and the extension's Reports. The four main navigation areas are unchanged.
- **No network, no Worker, no cost** (Bootstrap Rule): `local` class in `docs/COST_DRIVERS.md`. Cost grows with case size; target below two seconds for 10,000 documents (tested, section 10).
- **Suggested next actions are text, not actions.** Each item lists what a person could do (search again later; select and capture a specific document; look for an archived copy; ask the records office). None runs automatically.

## 4. Facts extracted from each held document (`facts.js`)

All rules are deterministic, listed here so they can be tested one by one, and every extracted fact records **where it came from** (file name, link text, parent page text, or document text) so the person can check it. When two sources disagree, the fact is marked *conflicting* and routed to review rather than resolved silently.

| Fact | Rule |
|---|---|
| Document type | `classify.js` result (words in link text or file name, then the parent page). Type is `unknown` when no word matches; unknown-type documents take part in nothing except G6 |
| Meeting / period date | In order of authority: (1) an explicit date in the document's own first 2,000 characters (labelled "Regular Meeting", "Minutes of ..."), (2) a date token in the file name or address (ISO `2024-03-12`, `03122024`, `March 12, 2024`, `_03122024-123` CivicPlus style), (3) a date in the link text, (4) *not* the retrieval time and *not* the file's last-modified time (those are provenance, not the meeting date). Ambiguous day/month forms (`03/04/2024`) are interpreted US-style only when no other form fixes the order; otherwise *ambiguous* |
| Governing body | Words such as "City Council", "Planning and Zoning Commission", "Board of Directors" in the same places, normalized to a lower-case key. Unknown body is allowed and groups as "(body not stated)" |
| Fiscal year | `FY2025`, `FY 25`, `2024-25`, `fiscal year 2025`, "Annual Budget 2025"; the fiscal year *end* is never assumed beyond what the document states |
| Citations | Patterns for "Ordinance No. 2024-17", "Resolution 55", "Exhibit A", "Attachment 3", "Agenda Item 7", "Contract 21-044", "see Budget FY2025". Stored as normalized keys (`ordinance:2024-17`) with the surrounding sentence as the quote |
| Readability | Has extracted text / extraction failed / scanned (no text layer) / partial retrieval |

## 5. Evidence-matching rules (`match.js`)

Matching connects an **expectation or reference** (for example "minutes for the 2024-03-12 council meeting", "Ordinance 2024-17") to **held evidence**. Every match carries a tier, shown to the person in words:

| Tier | Meaning | Rule | Counts as "located"? |
|---|---|---|---|
| **Exact** | The very file | Same SHA-256, or the same original address | Yes |
| **Series match** | Same body, same type, same meeting date | All three facts present and equal | Yes |
| **Reference match** | A document that is the thing a citation names | The normalized citation key appears as the document's own number (title or first lines) | Yes, with the quote shown |
| **Candidate** | Might be it | Two of three series facts equal, or the citation appears only in body text (not as the document's own number) | **No**: listed as "possible match, needs your review" |
| **None** | Nothing held fits | No document passes any tier | The expectation remains a gap |

Rules that protect against wrong conclusions:
1. **Never auto-merge and never auto-resolve.** A Candidate does not close a gap; a person confirms it (stored decision). A Series or Reference match closes the gap automatically *and says why*, and the person can reopen it.
2. **A match must not cross bodies or types.** Council minutes never satisfy a Planning Commission expectation; an agenda never satisfies a minutes expectation.
3. **Same name, different identity stays different** (the project's Marc/Raymond Payne rule): citation numbers and dates must match exactly after normalization; partial-number matches are Candidates at best.
4. **A conflicting date** (file name says March 12, document text says March 19) produces a Candidate and a "dates disagree" note, not a match.
5. **A document held only as an archived copy** (historical copy) matches, labelled "archived copy, captured <date>", and does not hide the fact that the original was not retrieved.
6. **Partial or unreadable documents** match by identity facts (name, date) but are flagged "held but not readable"; they are a G6 item, not a missing record.

## 6. Gap detectors (`detect.js`)

Every item has: a stable key, the detector id, the **evidence list** (records, ledger rows, runs), a **"what was searched"** statement (which sources, which runs, on which dates), a **"what is not concluded"** statement, and suggested next actions. Items are never ranked by guessed importance; they are grouped by detector and sorted by date.

| Id | Detector | Fires when | Does NOT conclude |
|---|---|---|---|
| **G1** | Series hole: paired documents | A body has an **agenda** for a date and no **minutes** for that date (and the reverse: minutes with no agenda), counting Series/Reference matches only | That minutes were never written or approved. Minutes are often approved at the *next* meeting, so G1 for the most recent meeting is labelled "may not exist yet" |
| **G2** | Series hole: missing period | In a series with **at least four** held documents whose dates sit on a regular cadence (all gaps within one day of the same step: weekly, 2-weekly, monthly on the same weekday-of-month), a period inside the held range has no document | That a meeting took place then. The statement shows the held dates that form the pattern and says "meetings may have been cancelled or moved". Outside the held range nothing is inferred |
| **G3** | Annual hole | Budget, audit, tax-rate or similar annual documents are held for fiscal year n and n+2 but not n+1 | That one was adopted. It shows what was held and what is absent |
| **G4** | Linked but not retrieved | A discovery ledger row for a linked document ended Not located / Source unavailable / Access restricted / Search incomplete and no match exists | The record does not exist. The *reason* is shown in words (HTTP 404, timed out, robots.txt, restricted) and the archive lookup result |
| **G5** | Referenced but not held | A held document cites an ordinance, resolution, attachment, exhibit or contract number for which no Exact, Series or Reference match exists in the case | That the cited item exists elsewhere or is missing from the source; only that *this case* does not hold it. Shows the quote and the citing document |
| **G6** | Held but not usable | Partial retrieval, extraction failed, scanned/no text layer, unsupported type | Anything about the content. Wording: "held, cannot be searched yet" (distinct from "missing") |
| **G7** | Coverage limits | A run stopped at a limit, a host was stopped or blocked, pages needed script, links were found beyond the caps | That nothing more exists. Lists what was not looked at, so the person can extend the search |
| **G8** | Changed since retrieved (information only) | The same address was retrieved in two runs with different hashes | Which version is right. Both are kept; the dates and hashes are shown |

Detectors only read what the case holds. If a case has no search runs (documents added by hand), G4 and G7 are silent and G1 to G3, G5, G6 still work, with the "what was searched" statement saying "no automated search is recorded for this case".

## 7. Gap-report design

### Wording rules (tested)

- **Required:** every item states what was searched ("In the sources searched on 2026-10-23: ..."), and the report ends with "What remains unknown".
- **Allowed words for an absent record:** "not located in the sources searched", "not held in this case", "could not be retrieved", "unavailable", "restricted".
- **Banned:** "does not exist", "no such record", "missing" as a bare verdict (the group may be titled "Not held in this case"), "failed to produce", "withheld", "hidden", "suspicious", "deleted", or any word attributing motive or fault. The tests scan every generated string for them.
- Dates are written in full (`March 12, 2024`) and the basis of each date is shown.
- A gap is shown with its **tier of confidence** in words: *Pattern-based* (G2), *Pairing-based* (G1), *Citation-based* (G5), *Search-based* (G4, G7).

### Layout

Big Picture panel "Records Recovery": four counts (Not held in this case / Could not be retrieved / Held but not readable yet / Search limits) with a link to Deep Dive; Deep Dive section "Records Recovery": one accessible table per detector (caption, column headers, row headers; columns: Item, What was searched, What is not concluded, Next steps, Your decision); Report appendix: the same, plain. Wide tables scroll inside labelled focusable regions, never the page. Every row has a "How do we know?" link into the existing explanation panel, which lists the evidence rows and the exact rule that fired.

### Reviewer decisions (the only stored data)

New IndexedDB store `recoveryReviews` (database version 12, additive; included in `.chronium.json` as an optional list; old files import unchanged): `{ id, investigationId, itemKey, decision, note, investigatorId, at }`, with decisions **Acknowledged** (seen, still open), **Possible match confirmed** (names the record), **Not applicable** (a person says no such meeting or document was expected, with a required note), **Reopened**. Decisions never change evidence, never create a claim, relationship or finding, and are shown beside the item with who and when. A person may separately record a finding of class `NO_EVIDENCE_LOCATED` through the existing Findings flow; Records Recovery only offers the link.

### Ask Chronium

"What is missing?", "Which minutes are missing?", "What could not be retrieved?", "What did we search?" are answered from the same model with the same wording, each ending with what is unknown. No new routing intelligence: new deterministic intents added to `askRouter.js`, with its existing clarify-instead-of-guess behavior.

### Interface to Phase 4 (not built)

Each item can emit a *request line* (`body`, `type`, `period`, `what was searched`, `date searched`), which is all a Public Information Act draft will need. Phase 4 builds the draft; Phase 3 only guarantees the line is accurate and carries no accusation.

## 8. Accessibility and layout requirements

Same standard as every screen: WCAG 2.2 AA targets, tables with captions and scoped headers, status never by color alone, 44 px targets, 320 to 1440 px with no page-level horizontal scroll, keyboard operable decisions (Acknowledge, Confirm match, Not applicable, Reopen) with a visible focus, errors as text tied to fields, polite status messages for decisions, reduced motion and forced colors respected. Automated checks (axe, text spacing, forced colors) plus the manual checklist in `docs/MANUAL_A11Y_TESTS.md`. No conformance claim.

## 9. Honest limits (stated up front)

- Cadence (G2) is an inference from held documents only; Chronium has no meeting calendar and will not claim a meeting "should" have happened.
- Dates and bodies come from words; unusual naming will produce *unknown* or *conflicting* facts, which are shown, not guessed.
- Citation patterns cover common US municipal forms; others are missed (silence is not a finding, so the report says "citations are detected by pattern").
- Scanned documents need text recognition (not built) to take part in G5.
- Cases with few documents can show few gaps because there is no series to compare; the report says so.

## 10. Acceptance tests (defined before coding; all offline and deterministic)

**Unit (pure functions):**
- Date extraction table: every format in section 4, ambiguous US/other forms, conflicting sources, "retrieval time is never the meeting date".
- Type, body and fiscal-year extraction on labelled fixtures; unknown handled.
- Citation extraction and normalization (`Ordinance No. 2024-17`, `Ord. 2024-17`, `Res. 55`, attachments, exhibits); near-misses rejected.
- Series grouping: same body+type only; ordering; cadence detection (weekly, biweekly, monthly-nth-weekday), and refusal to infer with fewer than four documents or irregular dates.
- Each matching tier, including the protections in section 5 (no cross-body, no cross-type, Marc/Raymond-style near names, conflicting dates, archived copy, partial document).
- Each detector G1 to G8 on small hand-built snapshots: it fires exactly when specified and stays silent otherwise, including empty case, case with no runs, and one-document case.
- **Wording scan**: every generated string (HTML and text) is tested against the banned list and for the required "what was searched" and "what remains unknown" statements.
- Determinism and idempotence: same snapshot, same items in the same order; reviewer decisions change presentation only, never the evidence or other items.
- Escaping: hostile titles, quotes and addresses are escaped; only http(s) links.

**Answer-key fixtures (control and planted):**
- A **complete** series (every agenda has minutes; every annual document present; every citation held): **zero** gaps reported (no false "not held").
- The same series with **planted holes** (3 missing minutes, 1 skipped month, 1 missing fiscal year, 2 uncited-then-missing ordinances): **every planted hole is reported** and nothing else. Ambiguous planted cases (conflicting date, near-number) must land in "Possible match, needs review", never as a silent match or silent gap.
- Built on the existing Larkspur Falls acceptance corpus (`data/acceptance-test-corpus/`) and on the discovery test site run end to end (a real run's ledger feeding G4 and G7).
- The existing 12-question benchmark and Ask Chronium tests are unchanged and still pass.

**Integration:** discovery run on the local test site (including 404, 403, timeout, robots-blocked, partial and duplicate documents) then Records Recovery over the saved case: G4, G6, G7 items match the ledger one-to-one; re-running adds no duplicate items; export and import round trip of `recoveryReviews`; an older `.chronium.json` without it imports; database upgrade from version 11.

**Safety:** a test that fails if any module under `public/recovery/` touches `fetch`, `XMLHttpRequest`, `WebSocket`, `indexedDB` or `Math.random`/`Date.now` in a way that changes output (time is injected); reviewer decisions require a note for "Not applicable"; no write path from recovery to evidence, claims, relationships or findings.

**Performance:** 10,000 documents and a 2,000-row ledger computed in under two seconds in Node; UI render paginated by detector.

**UI (browser):** keyboard-only decisions, announced status, focus after each decision, axe at 320 to 1440 px in both schemes, text spacing, forced colors, reduced motion, tables scroll inside labelled regions; extension panel parity.

## 11. Phases and exit criteria

| Step | Scope | Exit |
|---|---|---|
| R1 | `facts.js`, `series.js` with unit tests | extraction and series tables pass |
| R2 | `match.js` | tier and protection tests pass |
| R3 | `detect.js` G1 to G8 | answer-key fixtures pass, wording scan passes |
| R4 | `model.js`, `report.js`, `recoveryReviews` store (DB v12), export/import | integration and round-trip tests pass |
| R5 | Big Picture / Deep Dive / Report surfaces, extension parity, Ask Chronium intents | UI and accessibility tests pass, manual checklist updated |
| R6 | Cost row, docs, handoff | local commit, stop for approval |

Each step ends with a local commit and test results, and nothing is pushed or deployed without Mari's explicit approval.

## 12. Decisions needed from Mari before implementation

1. Approve the **wording rules** (especially retiring the bare word "missing" in the interface in favor of "not held in this case").
2. Approve the four **decisions** a reviewer can record, and that "Not applicable" requires a note.
3. G2 cadence: is "at least four documents on a regular cadence" the right threshold, or should it be more cautious (five or six)?
4. Placement: Big Picture panel + Deep Dive section + Report appendix as above?

## 13. Release gate (separate from Records Recovery): the extension's real per-site permission prompt

Everything about the extension's access prompt tested so far is **simulated**: the automated test uses a copy of the extension with the test site pre-granted, so Chrome never shows its prompt. Before any production deployment or store submission the real prompt must be tested.

What cannot be automated with the current tools: the prompt is native browser UI that page-driving tools cannot click. Options: (a) a person runs the protocol below on ordinary Chrome and records the results (screen recording recommended); (b) later, an operating-system UI automation script that clicks the prompt, written and then used for repeat runs; (c) ask the Chrome Web Store reviewers' checklist for any extra evidence needed for broad optional host permissions.

**Protocol (also added to `docs/MANUAL_A11Y_TESTS.md`, section I):**
1. Load the real `extension/` folder (not the test copy) in ordinary Chrome. `chrome://extensions` shows no site access beyond the Chronium server addresses.
2. Open the panel, create a case, open Find public records, enter a public address you are allowed to read (for example `https://www.archives.gov/`), tick the terms box, press Start.
3. Expect: Chrome's prompt naming exactly that site. No other site, no "all sites". Nothing is requested before you answer (check the site's access log or Chrome's network log).
4. Choose **Don't allow**. Expect: a plain message in the panel ("Chronium needs your permission to read pages from that site ..."), focus returned to the address field, no request made, no rules installed (`chrome.declarativeNetRequest.getDynamicRules()` empty of Chronium rules).
5. Press Start again, choose **Allow**. Expect: the run proceeds; the site's log shows the Chronium User-Agent; a redirect to a private address is blocked (use the test fixture or a controlled redirect); `chrome://extensions` > Details > Site access lists only that site.
6. Run a second search on the same site: no prompt. Run one on `http://` of the same host or a different subdomain: a new prompt (origins are separate).
7. Revoke the site in `chrome://extensions`; Start again: the prompt returns.
8. Keyboard only: can the whole sequence be done without a mouse, and is the prompt's result announced in the panel?
9. Confirm the prompt is triggered by the click on **Start** (a user gesture) and works when the panel is narrow, in dark and light themes.
10. Record: Chrome version, date, tester, each expected/actual result.

Status: **NOT RUN.** The deployment checklist in `docs/CLAUDE_HANDOFF.md` lists this as a blocker.
