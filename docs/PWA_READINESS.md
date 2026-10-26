# PWA readiness: can Chronium Mind be installed as an app today?

Checked 2026-10-26 against the website source (`public/`) and Chrome's published installability criteria (web.dev, "What does it take to be installable?"). **Nothing was changed or deployed.**

## Short answer

**No, not on any platform yet.** The site is served over HTTPS and is mobile-friendly, but it has **no web app manifest, no installable icons, no service worker, no theme colour and no iPhone home-screen icon**. Chrome, Edge and Android would not offer "Install"; an iPhone can still "Add to Home Screen" but gets a screenshot-style icon and a browser-like page.

## What exists

| Item | State |
|---|---|
| HTTPS | Yes (workers.dev; any real domain also needs HTTPS) |
| Responsive page | Yes: `<meta name="viewport">` present; mobile layouts tested at 320 to 1440 px |
| Favicon | One link to `/assets/brand/chronium-mind-mascot.png`, a **1774 x 887 wide logo** (not square) |
| Local-first data | Yes: cases live in the browser's IndexedDB; export/import works; this matters for installation (below) |
| Works without a connection | **No.** There is no service worker, so a page load needs the network. (Saved cases are local, but the app itself is not cached) |

## What is missing, by requirement

**Chrome and Edge on Windows, and Chrome on Android** (Chrome's criteria, quoted from web.dev): not already installed; the person has clicked the page and spent at least 30 seconds on it; HTTPS; and a **manifest** containing `short_name` or `name`, `icons` that include **a 192 px and a 512 px icon**, `start_url`, `display` set to `fullscreen`, `standalone`, `minimal-ui` or `window-controls-overlay`, and no `prefer_related_applications: true`.

| Missing | Needed |
|---|---|
| `manifest.webmanifest` (linked with `<link rel="manifest">`) | name, short name, `start_url` (for example `/`), `scope`, `display: standalone`, `background_color`, `theme_color`, `lang`, description |
| Square icons | PNGs at 192 px and 512 px (and a **maskable** 512 px version for Android's rounded shapes); the current brand art is wide, so a square crop is needed (the extension's square icons, made from the same art, show how: `scripts/make-extension-icons.mjs`) |
| `theme-color` meta tag | to colour the title bar / status bar |
| Service worker | **Not listed in Chrome's published criteria page.** Older guidance required a fetch handler; I could not confirm from an official page whether current Chrome still does, so treat as likely wanted. It is needed anyway for any offline use |
| Offline behaviour | decide what works with no connection (app shell and saved cases: yes; Search and Find Records: no, with a plain message) |

**iPhone (Safari, "Add to Home Screen")**
- Works for any site today, but the icon should be a **180 x 180 `apple-touch-icon`** (missing); without it iOS makes a thumbnail of the page.
- `apple-mobile-web-app-capable` / the manifest `display: standalone` give the full-screen app look; the status-bar style and title meta tags are missing.
- **Storage matters for a local-first app.** WebKit's policy (from secondary sources; I did not find Apple's own current wording) deletes script-writable storage, including IndexedDB, after about seven days of Safari use without interaction with a site, but treats a **home-screen web app** differently (it has its own counter and Apple has called deleting its data a serious bug). A bug report from iOS 15 says logouts still happened. **Conclusion: an iPhone user who keeps cases only in Safari tabs can lose them; installing to the home screen helps but should not be trusted; regular export backups are essential there.**
- iOS gives no install prompt; the person must use Share, then Add to Home Screen. The app would need to explain that.

**Android:** same manifest/icon/service-worker requirements as Chrome; with them, Chrome can install it as a WebAPK.

## Design points that need decisions before building

1. **Where the data lives.** An installed PWA uses the website's address, so on the same browser it shares storage with the website opened in a normal tab, but **not** with the Chrome extension (a different address) and not with another device. Moving cases between the PWA, the extension and a phone is by Export and Import; real sync is not planned.
2. **Update safety.** The Stage 0 start-up guard (backup prompt before the one-way database upgrade) is already in the website. A service worker adds a risk: an old cached page could open data that a newer page has upgraded. The service worker would need versioned caches and a rule that the page checks the database version before it starts (the guard already does).
3. **Production state.** Everything above would ship only with the Stage 0 website changes, which are **not deployed**. A PWA release is therefore after, not before, a production release is separately approved.
4. **Not part of this check:** push notifications, app-store packaging, and a custom domain (a domain would give a stable, shorter app address; none is purchased).

## Rough work list (not started)

1. Square icons 192, 512, 512 maskable, 180 apple-touch (from the dragon-and-hourglass crop).
2. `manifest.webmanifest`, `<link rel="manifest">`, `theme-color`, apple meta tags in `public/index.html`.
3. Minimal service worker: cache the app shell by version, network-first for `/api/*`, a plain offline page for Search; never cache `/api/fetch` or `/api/view-capture`.
4. Tests: manifest validity, installability via Chrome DevTools "Application" checks or Lighthouse, offline reload of the shell, upgrade-guard interaction.
5. Manual: install on Windows Chrome and Edge, a real Android phone, a real iPhone.
