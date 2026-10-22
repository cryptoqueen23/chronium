# Ask Chronium (deterministic question router)

Built 2026-10-22. Code: `public/askRouter.js` (routing + answers), `public/askRender.js`
(accessible HTML, shared by website and extension). No AI, no network, no second
database: it reads one investigation through `readInvestigationForExport`
(`public/portableDb.js`), the same snapshot used for case export.

## What it does

`answerQuestion(question, snapshot, context)` returns `null` (not an investigative
question: the caller runs ranked document search) or an Answer with: a title, a
state, a plain-language summary, items that each cite sources (title, date,
location, excerpt, links, file fingerprint), **what the records do not
establish**, **what was searched**, and, when needed, a clarification question
with choices.

| Intent | Reads | Behaviour |
|---|---|---|
| progress | import items, name matches, watch terms, claims, findings, outline | Counts straight from the case; duplicates reported as duplicates, unreadable files as unsearchable. |
| claims-contradicted | claims, claim-evidence links | Claims with contradicting evidence, both sides shown. |
| claim-evidence | claims, links | Evidence for/against one claim; "that claim" resolved from the previous question, else asks which. |
| relationships | relationships (evidence-backed), subjects | Recorded connections with their evidence. Documents that merely mention two names are shown only as leads. |
| frequency | sources, subjects | Document counts. Registered people vs name-shaped phrases (labelled unverified). |
| financial | sources | Dollar amounts quoted with their source line. Never summed, never invented. |
| decision / before-after | sources | Finds vote records (motion/seconded/ayes before weaker "passed"); several candidates -> asks which; none -> refuses; one -> related documents dated before/after. |
| verify ("Did X ...?") | claims, sources | Shows claims and passages; never answers yes/no itself. |
| (anything else) | ranked document search | Half the words minimum, best coverage first; **a term with a digit (2026-29) must be present**. |

States shown to the user: Documented fact, Supported inference, Allegation,
Unresolved, No evidence located, Computed from your records, Needs clarification.

## Safeguards (each has a test in `scripts/test-ask-router.mjs`)

- Surname-only never verifies identity: several registered people with the
  surname -> clarification; one -> "possible match, not verified".
- No vote identified -> no comparison is produced. Several -> asks. No readable date -> not compared.
- No data / no match -> "No evidence located" plus what that does not prove. A failed or empty search is never described as proof that a record does not exist.
- Every item cites at least one source; all output is HTML-escaped.

## Benchmark (original 12 questions, unchanged)

Harness: `scripts/run-acceptance-test.mjs`. Only additive change: it now also
records the router's intent, state and answer text.

Harness's own classification: **7 WORKS, 2 PARTIALLY WORKS, 3 DOES NOT WORK**
(baseline before this phase was reported as 6/12). Median answer time 520 ms,
max 609 ms (one earlier run showed 17 s on two questions because they also
ran outward Discover Sources over the network).

That count undersells and, in one place, overstated, so each answer was also
read and graded by hand (corpus checked directly with grep for the two
"nothing found" questions):

| # | Question | Routed to | Graded |
|---|---|---|---|
| 1 | Show me every record mentioning Raymond Payne. | document search | Correct (14 sources) |
| 2 | Where does Ray Payne appear? | document search | Correct (5 sources) |
| 3 | What organizations is Raymond Payne connected to? | relationships | Correct: 1 evidence-backed connection + a lead labelled as not a relationship |
| 4 | Show me evidence for each connection. | relationships | Correct (uses previous question's person) |
| 5 | Did Raymond Payne serve on City Council? | verify | Correct: passages + claim shown, no yes/no, says no finding recorded |
| 6 | What evidence contradicts that claim? | claim-evidence | **Partial**: resolved the claim from context and reports none is linked as contradicting; cannot find contradicting text on its own |
| 7 | Show me all payments involving the Historical Society. | financial | Correct "No evidence located": "Historical Society" is in none of the 222 documents (grep-verified). Harness scores this as not working. |
| 8 | Who repeatedly appears in EDC records? | frequency | Correct (50 EDC documents; registered subjects and unverified name patterns separated) |
| 9 | Show me everything involving Ordinance 2026-29. | document search | Correct "nothing in the case": no document contains 2026-29 (grep-verified). The earlier "WORKS" for this question was **a false positive**: it returned 23 other ordinances. Fixed by requiring identifier terms. Harness scores this as not working. |
| 10 | What changed before and after this vote? | before-after | **Partial**: correctly asks which of 3 votes; the before/after list is produced once one is chosen (verified on the corpus and in the browser test) |
| 11 | Which claims have contradictory evidence? | claims-contradicted | Correct: the one claim with a contradicting passage (vote 4-1 vs "unanimous"); harness shows "partial" only because there is one row |
| 12 | What haven't we reviewed yet? | progress | Correct (an early version wrongly called 222 duplicates "unreadable"; fixed) |

Hand-graded: **10 correct, 2 partial, 0 incorrect.** Not 12 of 12, and not
claimed as such. Questions 7 and 9 are correct because the records are not there.

## Tests

- `npm test` (103): includes 17 router tests (ambiguity, contradictions, incomplete records, empty case, surname safety, vote clarification, escaping, identifier search).
- `node scripts/test-ask-browser.mjs --chrome=<Chrome for Testing>`: Ask Chronium on the website and the extension, keyboard-only (type, Enter, Tab to a clarification button, Enter), 320px width, axe-core on the answer view.
- `node scripts/test-a11y.mjs`, `test-extension.mjs`, `test-portable-browser.mjs`: unchanged and passing.

## Limitations

- Deterministic: understands the intents above and phrasing patterns, not arbitrary language. Unrecognised questions fall back to document search.
- Contradicting text is found only when it has been linked to a claim. It cannot read two passages and decide they conflict.
- Financial answers need dollar amounts written with `$` in readable text. Scanned images, tables whose cells are split across lines, and figures without `$` are missed (and reported as "not established").
- Votes are recognised by wording (motion, seconded, ayes/nays). Documents with unusual wording, or no readable date, are not placed.
- Before/after lists related documents by shared identifiers (ordinance number, company, fund). It shows what each says; it does not decide causation or compare numbers across documents.
- "Archived snapshot before/after" (same page at two dates) is not part of this router; that is the Compare tab, still a placeholder.
- The snapshot loads the whole case into memory per question; fine for hundreds of documents, untested at tens of thousands.
- English only (Spanish localization is a standing requirement, not done).
- Manual accessibility checks (screen reader, 400% zoom, touch) are still outstanding; see `docs/ACCESSIBILITY.md`.
