# Manual accessibility tests (to be run by a person)

Automated checks (`scripts/test-a11y.mjs`, `test-a11y-deep.mjs`, the browser
tests) cannot replace these. **None of the sessions below has been run yet.**
Record date, tester, tool and version, browser, and result for each line in
the table at the bottom. Do not claim WCAG 2.2 AA conformance until they are done
and every applicable criterion has been evaluated.

## Status at a glance

| Test | Status |
|---|---|
| **NVDA (Windows)** | **NOT TESTED**: not installed; cannot be operated from the build environment |
| **VoiceOver (macOS / iOS)** | **NOT TESTED**: no Apple device available |
| **Real touch device** | **NOT TESTED**: only Chrome's touch emulation was run |
| Windows High Contrast on a real machine | NOT TESTED (forced-colors was emulated in Chrome) |
| Browser zoom to 400% | Automated with real browser zoom; a person should still look |
| Keyboard-only | Automated Tab walks done; a person should do section E |

**WCAG 2.2 AA conformance is NOT claimed.** Automated and emulated checks pass; the human evaluation above has not been done.

Test pages: the website (`#/investigations`, then open an investigation: it
opens on **Big Picture**), and the extension side panel (My Research, **Open**
a case). Use a case with findings, a contradicted claim, a vote, and at least
one imported file that could not be read.

## A. NVDA on Windows (with Chrome, then Firefox for the website)

1. Start NVDA; open the website. Does the page title announce? Press `H` repeatedly: do headings read in a sensible order (investigation name, view title, section titles)?
2. `D` through landmarks (navigation, main). Is "You are here" breadcrumb announced as navigation, and the current page marked?
3. `Tab` to the view tabs. Is each announced as "tab, selected / not selected, n of 12"? Do Left/Right arrows move between extension tabs and announce the change?
4. On Big Picture, `Tab` to each **How do we know?** link. Is the announced name specific (it carries the finding text), not just "How do we know?" repeated?
5. Activate one. After it opens Deep Dive, does NVDA read the "How do we know?" panel first (focus lands on it)? Is the source, passage, date, location read? Are the "Limits to keep in mind" read?
6. Press the **Back to Big Picture** button. Is your position kept?
7. Are the three groups (Missing, Not reviewed yet, Unresolved) distinguishable by listening alone (headings plus the tag word in each item)?
8. Deep Dive: open and close a section with Space/Enter. Is "expanded/collapsed" announced? Are the counts "(4)" read sensibly?
9. Ask Chronium: type a question and press Enter. Is "Answer ready: ..." announced? Does focus move to the answer in the extension? Is a clarification question's button list announced as a list of buttons?
10. Import case file: choose a file; is the preview text announced; is an error announced?
11. Anything read twice, not at all, or in a confusing order: write it down.

## B. VoiceOver (macOS Safari/Chrome, or iOS Safari for the website)

Repeat A1 to A10 with VoiceOver (rotor for headings and landmarks). On iOS use
swipe navigation and the website only (the extension does not run on mobile Chrome).

## C. Real touch device (phone and tablet, website)

1. Portrait and landscape. Tap every view tab, a **How do we know?** link, **Back**, a Deep Dive section, the investigation menu.
2. Any mis-taps? Any control hard to hit (target comfortably 44 px)? Anything needing a long press, drag, or pinch? (There should be none.)
3. Rotate the device with the Deep Dive evidence panel open: is anything cut off?
4. Browser text size set to largest: still usable?

## D. Zoom and reflow, by hand

1. Chrome `Ctrl +` to 400% on a 1280-px-wide window, website Big Picture / Overview / Deep Dive: no sideways scrolling, nothing clipped, tab strip still reachable, **How do we know?** usable. (Automated check done with `chrome.tabs.setZoom`; a person should still look.)
2. Same in the extension side panel at 200% and 400% with the panel dragged as wide as it goes. At very narrow panel widths combined with high zoom (about 94 CSS px) the layout cannot fit; note what happens.
3. Windows "Increase text size" and high-contrast / forced-colors mode: is everything still visible, including the focus ring and tag borders?

## E. Keyboard only, no screen reader

Unplug the mouse. Complete: open an investigation, read Big Picture, follow a
**How do we know?**, come back, open Overview, ask Chronium a question, export
the case. Watch for: lost focus, focus on invisible things, traps, the
Escape key not closing menus.

## F. Themes and preferences

Switch the operating system between light and dark: both themes load without a
flash of the wrong one? Reduced-motion on: any motion left? Windows
high-contrast on: see D3.

## G. Language

Spanish is **not implemented**. When it is: language switch reachable by keyboard, `lang` attribute changes, names and quotations are not translated.

## H. Find public records (Deep Discovery), website tab "Find Records" and the extension's My Research

None of these has been run by a person.

1. Screen reader: is "Find public records" found as a heading, and are the address field, its hint and its error read together? After pressing Start with an empty field, is the error announced and is focus on the field?
2. Start a small search. Is the progress status announced, without being flooded (it is limited to one update every ten seconds and on each state change)? Does the progress bar read "n of about m pages" or "n of m documents"?
3. Pause, Resume and Cancel by keyboard only: are their states (disabled, enabled) clear when listened to? When the search ends, does focus land on the "Coverage report" heading and is it read?
4. Coverage report: are the tables read with their captions, column headers and row headers? Is "Not located in the sources searched" understandable without sight? Does "What remains unknown" read as a list?
5. The wide tables scroll inside a labelled region: can that region be reached and scrolled by keyboard, and is its label read?
6. Phone and tablet, real touch: can the fields, the three tick boxes and every button be tapped without mistakes? Does the report stay readable at 320 px with large text?
7. Extension only: the browser's permission prompt for reading a new site, using ordinary Chrome (not the test copy): is the prompt understandable, and does choosing "Don't allow" leave a clear message (it reads "Chronium needs your permission ...")?
8. High Contrast on a real machine, 400% zoom: any control that loses its boundary, any clipped text?

## I. Extension per-site permission prompt (RELEASE GATE before any production deployment or store submission)

**NOT RUN.** The automated extension test pre-grants its test site, so Chrome's real prompt has never been shown to a test. Full protocol and expected results: `docs/RECORDS_RECOVERY_PLAN.md`, section 13. In short: load the real `extension/` in ordinary Chrome; press Start on a new site; the prompt must name exactly that site; "Don't allow" must leave a plain message, return focus to the address field, make no request and install no rules; "Allow" must run the search with the Chronium User-Agent and the private-address block active; a second search on the same site must not prompt; another origin must prompt; revoking must bring the prompt back; the sequence must work by keyboard. Record Chrome version, date, tester and each result.

## J. Records Recovery (website tab, Big Picture summary, Deep Dive section, report appendix)

None of these has been run by a person.

1. Screen reader: is "Records Recovery" found as a heading, and is the note about inventory versus the government's records read before the counts? Are the counts read as a list?
2. Each table: are the caption, column headers and row headers read, and is the status ("Status: Open") heard with the item? Do the wide tables scroll by keyboard inside their labelled region?
3. Decisions: Acknowledge, Confirm a match, Not applicable, Reopen. Is the result announced in the status line? When "Not applicable" is submitted without a reason, is the error read and does focus land in the field?
4. Request box: after "Read my request", does focus move to the "Check how your request was read" heading, and is each item's fieldset and legend read with its fields? Are the notes ("partly inferred", "requires your review") understood?
5. Follow-up text: is the box labelled, editable, and is it clear that Chronium never sends it?
6. Wording: is any sentence confusing, or does any read as blaming an agency? (The automated scan covers fixed words only.)
7. Phone and tablet, real touch: every button and field tappable; the tables usable at 320 px with large text.
8. High Contrast and 400% zoom: boundaries kept, nothing clipped.

## Results log

| Date | Tester | Tool / version | Browser / device | Section | Result | Notes |
|---|---|---|---|---|---|---|
| (none yet) | | | | | | |
