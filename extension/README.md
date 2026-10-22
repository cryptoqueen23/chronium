# Chronium Mind side panel (Chromium, Manifest V3)

Load unpacked: `chrome://extensions` -> Developer mode -> Load unpacked -> this `extension/` folder. Click the toolbar icon to open the side panel.

- Talks to the Chronium Worker (default: the live workers.dev address; change under Settings in the panel, `http://127.0.0.1:8787` works for `wrangler dev`).
- My Cases use the same `db.js` workspace code as the web app, copied into `lib/` by `node scripts/sync-extension.mjs` (run it after changing `public/db.js`, `entities.js`, `claims.js` or `ingestionReview.js`).
- **The panel's saved cases live in the extension's own browser storage, separate from the web app's.** They are not shared with cases made at the website yet.
- Test: start `wrangler dev`, then `node scripts/test-extension.mjs --chrome=<path to Chrome for Testing>`. Branded Chrome 137+ ignores `--load-extension`; use Chrome for Testing (puppeteer's cache).
- Not built yet: Compare (What Changed?), Ask Chronium inside the panel, new connectors.
