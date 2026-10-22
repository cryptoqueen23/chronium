# Manual accessibility tests (to be run by a person)

Automated checks (`scripts/test-a11y.mjs`, `test-a11y-deep.mjs`, the browser
tests) cannot replace these. **None of the sessions below has been run yet.**
Record date, tester, tool and version, browser, and result for each line in
the table at the bottom. Do not claim WCAG 2.2 AA conformance until they are done
and every applicable criterion has been evaluated.

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

## Results log

| Date | Tester | Tool / version | Browser / device | Section | Result | Notes |
|---|---|---|---|---|---|---|
| (none yet) | | | | | | |
