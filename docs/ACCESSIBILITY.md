# Accessibility & Responsive Standard (binding)

Target: WCAG 2.2 Level AA for the website and the Chromium extension, built into every feature from the start (not added afterward). Mobile-first fluid layouts from 320 CSS px up to ultrawide; no horizontal page scroll (wide tables get a labelled, keyboard-reachable scroll region or a stacked view); usable at 400% zoom; extension side panel usable at narrow widths. Mobile Chrome does not run the extension, so the responsive website is the mobile experience.

Required: full keyboard operation with visible focus; semantic landmarks/headings; labelled inputs and icon buttons; contrast 4.5:1 text / 3:1 large text and UI; targets at least 24px (prefer 44px); accessible errors; announced async status (search); dialog focus management; reduced motion; light/dark themes; no information by color alone; no keyboard traps, hover-only, drag-only or timed essentials. Plain English by default with short explanations of terms (bond proceeds, fund transfer, actual expenditure, tax increment, source provenance, unverified allegation); English and Spanish with correct lang metadata; never mistranslate names, quotes or legal terms. Charts/diagrams always have text equivalents; HTML reports are the primary format; any PDF export must be tagged and accessible; OCR text is labelled unverified transcription. Optional Easy Reading mode (larger text, simpler explanations, less clutter) is planned.

Nav: Search / Compare / My Research / Reports; inside an investigation: Big Picture / Overview / Deep Dive (same underlying data), with breadcrumbs for deep navigation.

## Test log (a feature is not complete until these are documented)

Automated: `node scripts/test-a11y.mjs --chrome=<Chrome for Testing>` runs axe-core (WCAG 2.0-2.2 A/AA rules) at 320/375/430/768/1024/1280/1920 px over the website (home, investigations, settings) and the extension panel (search results, compare, my research, reports), and fails on horizontal scroll. **Automated passes do not establish conformance.**

- 2026-10-22: automated sweep run. One real failure found and fixed (website home `.examples-label` used the muted text color below 4.5:1). Sweep now clean. No horizontal scroll at any tested width.
- NOT yet done (manual, required): keyboard-only walkthrough, NVDA and VoiceOver, 200%/400% zoom, touch, reduced-motion, Spanish localization, Easy Reading mode, text equivalents for future charts.
- 2026-10-22 (Ask Chronium): axe-core over the Ask view on website and extension at 320px; keyboard-only asking and clarification; answer region gets focus; status text is announced (`role=status`). Manual checks still outstanding.
- 2026-10-22 (Investigation views): axe-core on Big Picture / Overview / Deep Dive at 320/375/768/1280/1920 (website) and 320/375/480/768 (side panel); no horizontal scroll; every control at least 24x24 px (measured); keyboard-only navigation of How-do-we-know links, arrow-key tabs, disclosures and Back; screenshots reviewed (found and fixed a misaligned breadcrumb). 320 CSS px width stands in for 400% zoom but is not the same. **Screen readers (NVDA/VoiceOver), real touch devices, true browser zoom, light theme still NOT tested.**

## Test log: 2026-10-22 (pre-deployment review of the investigation views)

Run with `node scripts/test-a11y-deep.mjs` (123+ checks), `test-a11y.mjs`, `test-views-browser.mjs`, `test-ask-browser.mjs`, `test-extension.mjs`, `test-portable-browser.mjs`. Machine: Windows 11, Chrome for Testing 152.

**Done and passing**
- Dark and light themes: axe-core WCAG 2.0 to 2.2 A/AA on the website home, investigations, settings, and every workspace tab (Big Picture, Overview, Deep Dive, Research, Review Queue, Subjects, Evidence, Findings, Report) at 375 and 1280 px, and on every extension tab and view at 375 px. A light theme did not exist before today: it was added (follows the system setting). Light was visually inspected in screenshots.
- Real browser zoom to 400% (`chrome.tabs.setZoom`, devicePixelRatio 4, innerWidth 320 CSS px; the extension page was widened to 1280 px first so that 400% gives the 320 CSS px reflow width): no horizontal scroll, no axe violations, "How do we know?" still opens its evidence, no clipped text, Tab never traps, focus visible and not hidden behind the header.
- Keyboard-only: Tab walk on Big Picture, Overview, Deep Dive (website) and all three views (extension): no traps, every focused control has a name and a visible focus indicator, focus is on screen and not covered by the sticky header (WCAG 2.4.11 check), How-do-we-know links and Deep Dive sections reachable; arrow-key tabs in the extension.
- Touch, **emulated** (Chrome touch emulation, not a device): taps on tabs, How-do-we-know, Back, section disclosure, extension tabs and links all work. Every control at least 24x24 px (measured); none under 44 px high in the views at 375 px.
- Accessibility tree: headings never skip a level; every link, button and tab has a name; tablist/tab roles with roving tabindex.
- Findings fixed during this pass: dark-theme contrast of the "Contradicts" tag (4.48:1, now above 4.5:1); source links in answers were 21 px high (now 44 px); breadcrumb misalignment; the three "unanswered" groups were visually identical (now separate edges and tags).

**Could not be tested here, and therefore NOT claimed**
- **NVDA**: not installed on this machine, and it cannot be operated or listened to from this environment. No screen-reader result exists.
- **VoiceOver**: no Apple device available.
- **A real touch device**: only emulation was possible.
- Windows forced-colors / high-contrast mode, text-spacing overrides (1.4.12), and reduced-motion were not exercised.
- Spanish, Easy Reading mode: not built.
- Several WCAG 2.2 AA criteria need human judgment (for example 1.3.1 information and relationships as heard, 2.4.6 headings and labels, 3.3.x error suggestions, plain-language quality). A checklist for a person is in `docs/MANUAL_A11Y_TESTS.md`.

**Known limitations**
- Input and card borders in the dark theme are about 1.4:1 against the background. Where a border is the only thing marking an input, WCAG 1.4.11 (non-text contrast, 3:1) is probably not met. Not changed in this pass.
- At very narrow side-panel widths combined with 400% zoom (about 94 CSS px) the layout cannot fit; reflow was verified at the 320 CSS px width WCAG specifies.

**Conformance:** not claimed. Automated and emulated checks pass; the human evaluation has not been done.

## Test log: 2026-10-22 (accessibility corrections after review)

New and changed:
- **Non-text contrast (1.4.11)**: dark-theme control boundaries were about 1.3 to 1.5:1; a `--control-border` token (website) / `--control` (extension) now gives 4.5 to 5.1:1 on every surface in dark and 4.7 to 5.5:1 in light. Method, decision rule for what is essential vs decorative, and all measured ratios: `docs/CONTRAST_REPORT.md` (`node scripts/test-contrast.mjs`, 132 measurements, 0 below 3:1; before the change 84 of 112 were below).
- **`scripts/test-a11y-modes.mjs`** (146 checks): forced-colors (Windows High Contrast emulation) and prefers-contrast; increased text spacing (1.4.12) alone and combined with real 400% zoom; reduced motion; focus visibility measured from pixels (ring visible and at least 3:1 against what it replaces, both themes); form error identification; reflow at 320 to 1920 px in both themes.
- Fixed because of those tests: forced-colors made every tab underlined (now only the selected one, via system `Highlight`); no reduced-motion rule existed (added); no `prefers-contrast: more` support (added); the extension used `alert()` for an invalid server address (now inline error text, announced, tied to the field with `aria-invalid`/`aria-describedby`, focus returned); error toasts are now `role=alert`; the website's Add URL field got an alert region and a try/catch.
- Existing keyboard and emulated-touch tests, the 400% zoom checks, axe sweeps and tab-walk (`test-a11y.mjs`, `test-a11y-deep.mjs`) are unchanged and pass.

**Still NOT tested, and not claimed** (unchanged): NVDA, VoiceOver, a real touch device, Windows High Contrast on a real machine. See `docs/MANUAL_A11Y_TESTS.md`. WCAG 2.2 AA conformance is not claimed.

**Remaining limitations**
- Decorative borders (cards, panels, tag and badge outlines, dividers) are about 1.2 to 1.5:1 in dark and deliberately left as they are: the text carries the meaning. A reviewer who disagrees for a specific element can add it to the list in `scripts/test-contrast.mjs`.
- Controls that only appear after an interaction (the claim form's evidence picker, file preview button) were not rendered on a real page in the contrast audit; they use the same token.
- Website form errors from the investigation forms (subjects, claims, findings, relationships) are reported through an announced alert toast, not next to the field with `aria-describedby`. Native `required` validation (a labelled field that is named and focused) is used for blank fields. Per-field association for those forms is not done.
- Forced-colors and contrast preferences were emulated in Chrome only.


## Test log: 2026-10-23 (Deep Discovery Phase 1: Find public records)

Run with `node scripts/test-discovery-ui.mjs` (74 checks, website) and `node scripts/test-discovery-extension.mjs` (28 checks, side panel), Chrome for Testing 152 on Windows 11.

**Done and passing (automated or emulated)**
- Website "Find Records" tab and extension panel: axe-core WCAG 2.0 to 2.2 A/AA clean in dark and light themes (website at 320 and 1440 px; panel at 320 px).
- No horizontal page scroll at 320, 375, 768, 1024 and 1440 px (panel: 320, 360, 480 px) in both themes; nothing clipped; every button, field and disclosure at least 44 x 44 px.
- Text spacing (WCAG 1.4.12 values) at 320 px: nothing clipped, no horizontal scroll. Forced colors emulated: controls keep a visible boundary. Reduced motion: nothing animates.
- Keyboard only: Start, Pause, Resume, Cancel and Continue all work from the keyboard. Focus moves to the field on an error, to the progress heading when a search starts, and to the report heading when it ends. Errors are text, tied to the field with aria-describedby, announced as alerts, and set aria-invalid.
- Progress text sits in a polite status region and is throttled to one update every ten seconds (plus every state change). The progress bar has a visible text label. State is never carried by colour alone (every status is a word).
- Wide tables scroll inside focusable, labelled regions (the page itself never scrolls sideways). Report tables have captions, column headers and row headers.

**Not tested here, not claimed**: NVDA, VoiceOver, a real touch device, real Windows High Contrast, the browser's per-site permission prompt in ordinary Chrome. The new checklist is section H of `docs/MANUAL_A11Y_TESTS.md`. **Conformance: not claimed.**
