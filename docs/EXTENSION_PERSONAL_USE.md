# Chronium Mind extension: personal use guide

Written for Mari, for private daily use on Windows with Chrome. Not a public release. Everything you save stays on this computer, in this Chrome profile. Nothing needs a paid service, an account or AI.

## 1. Use the stable personal copy, not the development folder

| | Personal copy | Development folder |
|---|---|---|
| Location | `C:\Users\insur\ChroniumMind-Personal` (outside the project, never edited by hand) | `C:\Users\insur\chronium\extension` (changes whenever code changes) |
| Extension ID | `eabmjgghjpgpncnmlkboplfbclcjcpfn`, fixed forever | Different, derived from the folder path |
| Where your research lives | Under its own ID | Under a different ID, so **the two never see each other's data** |
| Changes | Only when you ask for an update | Any time |

Chrome keeps an extension's saved research under its ID. The personal copy has a fixed ID, so it survives updates and folder changes. Testing or developing in the other folder can never touch your research. **Do not** load both and expect them to share cases; they cannot.

## 2. Install (Windows, Chrome), once

The folder to select is **`C:\Users\insur\ChroniumMind-Personal`**. It is the folder that directly contains the files `manifest.json` and `panel.html`.

1. Open Chrome.
2. Click the address bar, type `chrome://extensions`, press **Enter**.
3. In the top-right corner, switch **Developer mode** on.
4. Click **Load unpacked** (top-left).
5. In the window that opens, click through to `C:\Users\insur\ChroniumMind-Personal` so you are **inside** it (you should see `manifest.json` in the list). Click **Select Folder**.
6. A card named **Chronium Mind** (version 0.2.0 personal) appears. Its **ID** should read `eabmjgghjpgpncnmlkboplfbclcjcpfn`.
7. Click the **puzzle-piece** icon next to the address bar, then the **pin** beside Chronium Mind, so its icon (a small dragon and hourglass) stays visible.
8. Click that icon. The **side panel** opens on the right with the title "Chronium Mind" and four tabs: Search, Compare, My Research, Reports.

**How to recognise a problem**

- A red **Errors** button on the card, or a red banner at the top of the page: click it and read the message.
- "Manifest file is missing or unreadable": you selected the wrong folder (probably the folder above it). Go back to step 5.
- The panel opens but is blank or shows a message in a box: that box is the extension telling you what is wrong in words. Read it. Nothing has been changed.
- "Service worker (Inactive)" on the card is normal. It wakes up when needed.
- Chrome may show a pop-up at start-up about "developer mode extensions". Choose to keep the extension (do not disable it).

**Never click "Remove" on the extension's card.** Removing an extension deletes the research stored under it. (Back up first if you ever need to remove it.)

## 3. Your first test, in this order

Do each step. Stop and tell me if anything differs from what is written.

**Test 1: installation.** Steps 1 to 8 above. Pass: the side panel opens and shows the four tabs.

**Test 2: create a case.**
1. Click **My Research**.
2. Type a name in "New case name", for example `Test case`, press **Create**.
3. Pass: the case is listed with an **Active** badge.
4. Click **Edit this case and add material by hand** to open it. Change the name in "Case name" and press **Save name**. Pass: the list shows the new name.

**Test 3: save evidence.**
1. In the same section, under **Add a document or source by hand**, type a title (required), optionally a web address starting with `https://`, a date, where it came from, and some text. Press **Add to this case**. Pass: "Added ... to this case".
2. Under **Add an evidence passage by hand**, choose the source, paste a sentence from it, add the page if you like, press **Save passage**. Pass: "Saved the passage".
3. Also try **Search**: type a topic, press Search, and press **Save** on a result. Pass: the button changes to "Saved".
4. Click **Open** beside the case. Pass: you see the case's Big Picture, with your source and passage counted.
5. Click **Reports**. Pass: your sources are listed.

**Test 4: close and reopen Chrome.**
1. Close **all** Chrome windows completely. Open Chrome again.
2. Click the Chronium Mind icon, then **My Research**.
3. Pass: your case, its new name, the sources and the passage are all still there, and the same case is marked Active.

**Test 5: export a backup.**
1. In **My Research**, press **Export** beside the case. Pass: a file ending `.chronium.json` appears in your **Downloads** folder.
2. At the bottom of the panel open **Back up or restore all my research** and press **Back up everything**. Pass: a file named like `chronium-backup-2026-...-v12.json` appears in Downloads, and the panel says how many cases, sources and passages it holds.
3. **Copy both files to a second place** (a different folder, a USB stick, or OneDrive). A backup in Downloads on the same computer protects against mistakes, not against losing the computer.

Only after Tests 1 to 5 pass, go on to the next section.

## 4. The real Chrome permission prompt (an approved safe test site)

The extension can read a website's public pages only after **you** allow that one site in Chrome's own prompt. The safe test site is **https://example.com/**: a page run by IANA, the internet's naming authority, that exists for documentation and tests. It has no documents. **Do not use Copperas Cove or CivicPlus**: the extension refuses both in any case.

1. **My Research**, scroll to **Find public records**.
2. In "Website or document library address" type `https://example.com/`.
3. Tick the box "I have read this site's terms of use...".
4. Press **Start search**.
5. Chrome shows its own pop-up asking whether Chronium Mind may **read and change your data on example.com**, with **Allow** and **Deny**.

**First, test Deny.**
6. Press **Deny**.
7. Pass: the panel shows a red message saying Chronium needs your permission to read pages from that site, and nothing starts.
8. Check the permission really is not held: on `chrome://extensions` press **Details** on the Chronium Mind card, find **Site access**. It must **not** list example.com.

**Then, if you wish, test Allow.**
9. Press **Start search** again and press **Allow**.
10. Pass: a short progress message, then a **coverage report** ("where Chronium looked"). It will say it found no documents on example.com. It makes a handful of requests, paced.
11. Remove the permission again: **Details** → **Site access** → remove example.com (or choose "On click").

Automatic tests already confirm that without the permission the extension cannot read a site, and that the panel handles a refusal correctly. Only you can confirm the look and wording of Chrome's own prompt.

## 5. Protecting your research

- **Where it lives:** in this Chrome profile on this PC. A different Chrome profile, a different computer, or Chrome's "Clear browsing data" on extension data would not have it. The website's saved cases are separate (different address): move cases between them with **Export** and **Import case file**.
- **Backups:** make one after any session with new work: **Back up everything**, then copy the file somewhere else. **Restoring** adds what is missing and never overwrites what you already have, so a restore cannot damage current work.
- **Deleting a case is two steps.** Pressing **Delete** first saves a copy to Downloads and deletes nothing. The panel names the file and asks you to check it is there; **Keep the case** is the default. Only **Delete the case** removes it, and **Import case file** brings it back.
- **No silent upgrades.** If a future version needs to change how your research is stored, the panel stops first and asks you to save a backup. If you ever open an older copy of the extension on research saved by a newer one, it refuses and changes nothing.
- **Storage:** the personal copy asks Chrome for unlimited storage so the browser does not apply a quota to your saved research. Chrome does not always mark such storage "protected"; the panel tells you what Chrome says. It is cleared only if you clear this extension's data or remove it.
- **Local-first and free:** nothing here needs an account, a payment or AI. Search asks the Chronium server (the free public one) for results; everything you save stays on your computer.

## 6. Updating the personal copy safely (only when you ask)

1. Make a backup (section 5) and copy it elsewhere.
2. Ask Claude to update the personal copy (`npm run extension:personal -- --update`). It rebuilds the same folder from a committed version and keeps the same ID.
3. In `chrome://extensions` press the **reload** arrow on the Chronium Mind card.
4. Open the panel. Your cases must all be listed. If the new version changes how research is stored, the panel will ask for a backup before it does anything.

Do not move or rename `ChroniumMind-Personal` while it is loaded, and do not edit its files.

## 7. What was tested, and what was not

**Tested automatically in real Chrome (Chrome for Testing 152) on the personal copy, 59 checks, `npm run test:extension:personal`:** loading unpacked with the fixed ID; the manifest (side panel, no always-on site access, no localhost, square icons); all four tabs; creating, renaming, using, opening, exporting, importing, deleting and restoring cases; adding sources and evidence by hand, with errors for missing title, bad address, duplicate address, empty passage; Search with save (answered by a local stand-in, no real website); Ask Chronium; Reports; a full Chrome restart keeping everything; two-step delete; export then import (no duplicates); whole-backup restore into a fresh browser (twice, no duplicates); refusal of a non-backup file; no access without site permission; the panel's behaviour when permission is refused; the start-up guard with a real older-version database (asks first, backup saved at the old version, then upgrades with the case intact); refusal of data from a newer version (untouched); automated accessibility (axe, WCAG 2.2 AA) in dark and light at 320, 400 and 1000 px; no page errors.

**Not tested, or only partly:**
- **Your own Chrome build** (the tests ran on Chrome for Testing; Load unpacked in your Chrome is the real check, and Test 1 is exactly that).
- **Chrome's own permission prompt** (cannot be automated; section 4) and the **Allow** path against a live site. The Allow path is covered by 28 older automated checks against a local test site.
- **Large cases** (hundreds of saved documents or big files) and **memory use over weeks**.
- **Screen readers and Windows High Contrast by hand.** Automated checks pass; the manual list in `docs/MANUAL_A11Y_TESTS.md` still applies. At 320 px the panel can scroll sideways by 1 pixel.
- **Other browsers** (Edge, Brave, Opera) and other computers.
- **Compare** is not built (the tab says so). Claims, relationships, the timeline and the Records Recovery editor are on the **website** only; the extension shows their summaries.
- PDF text extraction inside the extension is not built, so documents found by Find public records may need review.

## 8. Risks, plainly

| Risk | What reduces it |
|---|---|
| Losing research by removing the extension, clearing its data, losing the profile or the PC | Regular **Back up everything** copied to a second place; never press Remove |
| An update changing how research is stored | Stable copy updated only on request; the start-up guard stops and asks for a backup first; older copy refuses newer data |
| Deleting a case by mistake | Two-step delete with an automatic copy; Import brings it back |
| Chrome silently blocking the backup download | The panel does not delete until you confirm the file is in Downloads |
| The extension reading a site you did not choose | Each site needs your explicit Allow; all-site access is optional and per site; private addresses are blocked; Copperas Cove and CivicPlus are refused by the program |
| A stranger with access to your Windows account reading the research | It is not encrypted; use a Windows password and a locked screen |
| The extension's address list includes the live Chronium server | Search sends your search words to that server (it does not receive your saved cases) |
