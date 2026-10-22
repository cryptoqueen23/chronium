# Investigation views: Big Picture, Overview, Deep Dive

Built 2026-10-22. One investigation, three levels of understanding, every
statement traceable to its evidence. Code: `public/views.js` (model + HTML,
shared by website and extension), wired into the website's investigation
workspace (`public/app.js`, `public/index.html`) and the extension's My
Research tab (`extension/panel.js`).

## One model, three presentations

`buildModel(snapshot)` derives everything from the same snapshot Ask Chronium
and case export use (`readInvestigationForExport`). The three renderers read
that single model: nothing is stored separately, there is no new database, and
a count or finding in one level is the same object in the others. "What still
needs attention" is `progressCounts()` in `askRouter.js`, shared with Ask
Chronium so their numbers cannot differ.

Where they live: inside the investigation (website) / My Research (extension),
not as new top-level navigation. The four primary areas are unchanged.

| Level | Purpose | Contents |
|---|---|---|
| Big Picture | Understand it quickly | What it is about (name, description, research question); documented findings and inferences; allegations and open findings kept separate; important figures and dates; where records disagree; what is unanswered (Missing / Not reviewed yet / Unresolved); how complete the search is; names (undecided matches stay unverified) |
| Overview | How it connects | Timeline (ordered text list, grouped by year); votes found by wording; documents that mention the same item; evidence-backed people/organization connections; money connections; conflicting claims; progress |
| Deep Dive | Examine the evidence | Source documents (type, date, source number, file fingerprint, archive/original links, whether a copy is kept); evidence passages with page/location; claims with supporting/contradicting/context evidence; contradictory records; financial amounts, recorded calculations, formulas and assumptions; review history |

## "How do we know?"

Every key statement (finding, figure, vote, connection, disagreement, open item
with a source) has a **How do we know?** link. It opens Deep Dive on that item
and moves keyboard/screen-reader focus to it: the original source, the exact
passage, its date and page/location, links to the original and archived copy,
and **limits to keep in mind** (no evidence attached; allegation; inference
only; evidence contradicts the claim; source has no readable date; Chronium
does not keep a copy of the file; connection not confirmed).

## Keeping your place

Each level remembers its scroll position; following a link into Deep Dive and
pressing **Back to Big Picture** returns to where you were. A breadcrumb
(My Research > case > level > item) shows where you are.

## Honesty rules (each has a test)

- Missing (nothing located), Not reviewed yet (material exists), and Unresolved (looked at, not enough) are different headings and never merged.
- Undecided or ambiguous name matches are counted as unconfirmed and never appear as people, connections, or timeline entries.
- Connections need at least one evidence passage; names that merely appear together are not connections.
- Amounts are quoted from saved evidence, never added together, and the assumption is stated.
- Votes are found by wording; outcomes are not interpreted.
- Documents grouped by a shared identifier "mention the same item", nothing more.
- Timeline and relationships are text lists, so there is no information that exists only as a picture.
- Every item cites a source or says none is attached; all case text is HTML-escaped.

## Tests

- `scripts/test-views.mjs` (12, part of `npm test`): same counts and findings at every level; every How-do-we-know link resolves; a finding opens its source/passage/date/location/limits; missing vs not reviewed vs unresolved; ambiguous identities unverified; money vs people connections; ordered timeline; figures never totalled; empty case and missing target; escaping; agreement with Ask Chronium; **export then import gives identical output at all three levels**.
- `scripts/test-views-browser.mjs` (53 checks, real Chrome): website and extension; links land on the right evidence; focus moves to the evidence; Back restores scroll; breadcrumb; a case exported from the website shows an identical Big Picture in the extension; arrow-key tab switching; no horizontal scroll and no axe-core violations at 320/375/768/1280/1920 (website) and 320/375/480/768 (side panel) for each view; every control at least 24x24 CSS px; Ask Chronium still works beside the views.
- Screenshots: `docs/screenshots/` (website Big Picture 320/768/1280, Deep Dive "How do we know?" 1280, extension Big Picture and Deep Dive at 320).

## Review changes (pre-deployment)

- Landing: opening an investigation now opens Big Picture; sidebar links added for the three views.
- Missing / Not reviewed yet / Unresolved are visually separate groups (own edge colour and a text tag in each item), never colour alone.
- Timeline: a document that records a vote and supplies saved evidence is one row with both tags.
- Light theme added for the website and the extension (follows the system setting).
- Screenshots: 20 real screenshots in `docs/screenshots/` (`scripts/screenshots-views.mjs`) plus two real 400%-zoom shots.

## Accessibility status: automated and emulated checks only (see docs/ACCESSIBILITY.md and docs/MANUAL_A11Y_TESTS.md)

Done: axe-core (WCAG 2.0 to 2.2 A/AA rules) on every view at the widths above; no horizontal scroll; 24 px minimum target size verified by measurement; keyboard-only use of links, tabs (arrow keys), disclosures, and Back; visible focus; focus management after navigation; breadcrumb landmark; dark theme contrast through axe.

**Not done, and therefore not claimed:** screen reader testing (NVDA, VoiceOver), real touch-device testing, true browser zoom to 400% (320 CSS px width was used as the equivalent layout, which is not the same as zooming), light theme, Spanish, Easy Reading mode. Automated passes do not establish WCAG conformance.

## Limitations

- Needs a case with data to be useful: findings, claims, and evidence are written by the investigator; the views summarize and cross-link them and do not generate conclusions. A case with only imported files shows sources, votes and groups but few findings.
- "Search coverage" shows what is in the case (sources, unreadable files, duplicates). Which web archives responded to a search is not stored in the case, so it is not shown here.
- Conflicting claims come from evidence linked as contradicting. Conflicting figures are not detected automatically; two amounts are shown side by side only when a claim has both.
- Votes and shared-item groups are found by wording and shared identifiers; unusual wording is missed.
- The model loads the whole case per view; fine for hundreds of documents, untested at tens of thousands.
- The Overview is lists, not diagrams or charts. A visual timeline or relationship map could be added later but must keep these lists as the primary form.
- Opening an investigation lands on Big Picture (`#/workspace/bigpicture`). Research, Review Queue, Subjects, Evidence, Findings and Report remain separate tabs, and the browser Back button returns to the view you came from. Creating a new investigation, or finishing an import, still goes to Research because that is where files are added.
- Not deployed; not pushed.
