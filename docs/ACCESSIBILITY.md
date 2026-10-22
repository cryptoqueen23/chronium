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

