#!/usr/bin/env node
// Deeper accessibility checks than test-a11y.mjs, for the website workspace and
// the extension side panel: light AND dark themes, keyboard-only walk with a
// visible-focus check, real browser zoom to 400% (chrome.tabs.setZoom, not just
// a narrow window), emulated touch taps, and the accessibility tree (heading
// order, landmarks, names). This is NOT screen-reader testing and NOT a WCAG
// conformance claim: NVDA / VoiceOver / a physical touch device are manual
// (docs/MANUAL_A11Y_TESTS.md).
// Usage: wrangler dev on :8787, then
//   node scripts/test-a11y-deep.mjs --chrome=<Chrome for Testing exe> [--shots=<dir>] [--only=themes,keyboard,zoom,touch,ax]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILD } from './lib/case-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const chrome = arg('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const shots = arg('shots', '');
const only = new Set(arg('only', 'themes,keyboard,zoom,touch,ax').split(','));
if (shots) fs.mkdirSync(shots, { recursive: true });
const ext = path.join(root, 'extension');
const AXE = fs.readFileSync(path.join(root, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const BASE = 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failed = true; };
const info = (m) => console.log(`INFO  ${m}`);
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const axe = async (page) => { await page.evaluate(AXE); return page.evaluate((t) => axe.run(document, { runOnly: { type: 'tag', values: t } }).then((r) => r.violations.map((v) => `${v.id}[${v.nodes.length}]: ${v.nodes[0].target.join(' ')}`)), TAGS); };
// The panel re-renders after some clicks; retry if the element was replaced under us.
const click = async (page, sel) => { for (let i = 0; i < 5; i++) { try { await page.bringToFront(); await page.waitForSelector(sel, { visible: true, timeout: 5000 }); await page.click(sel); return; } catch (e) { if (i === 4) throw e; await sleep(250); } } };
// Put the extension on My Research with the case open, whatever the previous section left behind.
const ensureViewer = async (page) => { await click(page, '#tab-research'); if (!(await page.$('#vpanel .vw-section'))) { await click(page, '[data-open]'); await page.waitForSelector('#vpanel .vw-section', { timeout: 8000 }); } };
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name) }); };

const b = await puppeteer.launch({
  executablePath: chrome, headless: false, defaultViewport: null, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--window-size=1280,900', '--disable-features=DisableLoadExtensionCommandLineSwitch']
});
const errs = [];
try {
  await sleep(3000);
  const swT = (await b.targets()).find((t) => t.type() === 'service_worker');
  const extId = new URL(swT.url()).host;
  const sw = await swT.worker();

  // ---- website with a rich case ----
  const web = await b.newPage();
  web.on('pageerror', (e) => errs.push('web: ' + e.message));
  await web.setViewport({ width: 1280, height: 900 });
  await web.goto(`${BASE}/#/investigations`, { waitUntil: 'networkidle2' });
  const webInv = await web.evaluate(BUILD, '/db.js', 'Grant review');
  await web.evaluate(() => { location.hash = '#/settings'; });
  await sleep(300);
  await web.evaluate(() => { location.hash = '#/investigations'; });
  await web.waitForSelector('[data-open-investigation]');
  await web.evaluate(() => document.querySelector('[data-open-investigation]').click()); // make it the open investigation
  await web.waitForSelector('#tab-bigpicture');

  // ---- extension with the same case ----
  const panel = await b.newPage();
  panel.on('pageerror', (e) => errs.push('ext: ' + e.message));
  await panel.setViewport({ width: 375, height: 900 });
  await panel.goto(`chrome-extension://${extId}/panel.html`);
  await panel.evaluate(BUILD, './lib/db.js', 'Grant review');
  await panel.reload();
  await click(panel, '#tab-research');
  await panel.waitForSelector('[data-open]');
  await click(panel, '[data-open]');
  await panel.waitForSelector('#vpanel .vw-section');

  const openWeb = async (route) => { await web.bringToFront(); await web.evaluate((r) => { location.hash = r; }, route); await sleep(500); };

  // ===================== themes =====================
  if (only.has('themes')) {
    const webRoutes = [['#/', 'home'], ['#/investigations', 'investigations'], ['#/settings', 'settings'], ['#/workspace/bigpicture', 'big picture'], ['#/workspace/overview', 'overview'], ['#/workspace/deepdive', 'deep dive'], ['#/workspace/research', 'research'], ['#/workspace/review', 'review queue'], ['#/workspace/subjects', 'subjects'], ['#/workspace/evidence', 'evidence'], ['#/workspace/findings/claims', 'findings'], ['#/workspace/report', 'report']];
    for (const theme of ['dark', 'light']) {
      await web.bringToFront();
      await web.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
      for (const w of [375, 1280]) {
        await web.setViewport({ width: w, height: 900 });
        for (const [route, label] of webRoutes) {
          await openWeb(route);
          const bg = await web.evaluate(() => getComputedStyle(document.body).backgroundColor);
          const v = await axe(web);
          check(`website ${label} @${w}px ${theme}: no axe violations`, v.length === 0, `${v.join(' | ')}`);
          if (route === '#/workspace/bigpicture' && w === 1280) { await shot(web, `website-bigpicture-${theme}-1280.png`); info(`website body background in ${theme}: ${bg}`); }
          if (route === '#/workspace/bigpicture' && w === 1280) check(`website ${theme} theme is actually applied`, theme === 'dark' ? /^rgb\((\d+), (\d+), (\d+)\)$/.test(bg) && Number(bg.match(/\d+/)[0]) < 40 : Number(bg.match(/\d+/)[0]) > 220, bg);
        }
      }
    }
    await web.setViewport({ width: 1280, height: 900 });
    await panel.bringToFront();
    for (const theme of ['dark', 'light']) {
      await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
      for (const tab of ['search', 'compare', 'research', 'reports']) {
        await click(panel, `#tab-${tab}`);
        await sleep(200);
        const v = await axe(panel);
        check(`extension ${tab} @375px ${theme}: no axe violations`, v.length === 0, v.join(' | '));
      }
      await click(panel, '#tab-research');
      for (const view of ['bigpicture', 'overview', 'deepdive']) {
        await click(panel, `#vt-${view}`);
        await sleep(200);
        const v = await axe(panel);
        check(`extension ${view} @375px ${theme}: no axe violations`, v.length === 0, v.join(' | '));
        if (view === 'bigpicture') await shot(panel, `extension-bigpicture-${theme}-375.png`);
      }
    }
    await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await web.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  }

  // ===================== keyboard-only walk =====================
  const walk = async (page, label, max = 150) => {
    await page.bringToFront();
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    const seen = [];
    let run = 1, trap = false, noIndicator = [], unnamed = [], offscreen = [], covered = [];
    for (let i = 0; i < max; i++) {
      await page.keyboard.press('Tab');
      const d = await page.evaluate(() => {
        const e = document.activeElement;
        if (!e || e === document.body || e === document.documentElement) return null;
        const cs = getComputedStyle(e), r = e.getBoundingClientRect();
        const name = (e.getAttribute('aria-label') || e.innerText || e.getAttribute('title') || e.getAttribute('placeholder') || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
        const shadow = cs.boxShadow && cs.boxShadow !== 'none';
        const labelledBy = e.labels?.length || e.getAttribute('aria-labelledby');
        // WCAG 2.4.11 Focus Not Obscured: the centre of the focused control must not sit under a sticky header or other overlay.
        const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), cy = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
        const top = document.elementFromPoint(cx, cy);
        const obscured = !(top && (top === e || e.contains(top) || top.contains(e)));
        return { key: `${e.tagName}#${e.id}.${(e.className || '').toString().slice(0, 30)}|${name}`, name: name || (labelledBy ? '(labelled)' : ''), visible: outline || shadow, inView: r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth, obscured, tag: e.tagName.toLowerCase(), text: name };
      });
      if (!d) { if (i > 3) break; continue; }
      if (seen.length && seen[seen.length - 1].key === d.key) { run++; if (run >= 6) { trap = true; break; } } else run = 1;
      seen.push(d);
      if (!d.visible) noIndicator.push(d.name || d.key);
      if (!d.name) unnamed.push(d.key);
      if (!d.inView) offscreen.push(d.name || d.key);
      if (d.obscured) covered.push(d.name || d.key);
    }
    return { seen, trap, noIndicator, unnamed, offscreen, covered, how: seen.filter((s) => /How do we know/.test(s.text)).length, summaries: seen.filter((s) => s.tag === 'summary').length };
  };
  if (only.has('keyboard')) {
    for (const [route, label] of [['#/workspace/bigpicture', 'Big Picture'], ['#/workspace/overview', 'Overview'], ['#/workspace/deepdive', 'Deep Dive']]) {
      await openWeb(route);
      const r = await walk(web, label);
      check(`website ${label}: Tab never traps focus (${r.seen.length} stops)`, !r.trap && r.seen.length > 10);
      check(`website ${label}: every focused control shows a visible focus indicator`, r.noIndicator.length === 0, [...new Set(r.noIndicator)].slice(0, 5).join(' | '));
      check(`website ${label}: every focused control has a name`, r.unnamed.length === 0, [...new Set(r.unnamed)].slice(0, 3).join(' | '));
      check(`website ${label}: focused controls are on screen`, r.offscreen.length === 0, [...new Set(r.offscreen)].slice(0, 3).join(' | '));
      check(`website ${label}: focus is not hidden behind the sticky header (WCAG 2.4.11)`, r.covered.length === 0, [...new Set(r.covered)].slice(0, 3).join(' | '));
      if (label !== 'Deep Dive') check(`website ${label}: "How do we know?" links are reachable by Tab`, r.how >= 3, `${r.how}`);
      else check('website Deep Dive: disclosure sections are reachable by Tab', r.summaries >= 5, `${r.summaries}`);
    }
    // Shift+Tab goes back through the same controls (no one-way trap).
    await panel.bringToFront();
    await ensureViewer(panel);
    for (const view of ['bigpicture', 'overview', 'deepdive']) {
      await click(panel, `#vt-${view}`);
      await sleep(200);
      const r = await walk(panel, view);
      check(`extension ${view}: Tab never traps focus (${r.seen.length} stops)`, !r.trap && r.seen.length >= 6);
      check(`extension ${view}: visible focus indicator on every control`, r.noIndicator.length === 0, [...new Set(r.noIndicator)].slice(0, 5).join(' | '));
      check(`extension ${view}: every focused control has a name`, r.unnamed.length === 0, [...new Set(r.unnamed)].slice(0, 3).join(' | '));
    }
  }

  // ===================== real browser zoom to 400% =====================
  if (only.has('zoom')) {
    const zoomTo = async (page, factor) => {
      await page.bringToFront();
      const url = page.url();
      if (url.startsWith('chrome-extension://')) {
        // An extension page can find its own tab; the tab list hides its URL.
        const ok = await page.evaluate(async (f) => { const t = await chrome.tabs.getCurrent(); await chrome.tabs.setZoom(t.id, f); return 'ok'; }, factor).catch((e) => String(e));
        await sleep(800);
        return ok;
      }
      const res = await sw.evaluate(async (u, f) => {
        const tabs = await chrome.tabs.query({});
        const t = tabs.find((x) => (x.url || '').startsWith(u.split('#')[0].slice(0, 40)));
        if (!t) return 'no tab';
        await chrome.tabs.setZoom(t.id, f);
        return 'ok';
      }, url, factor);
      await sleep(800);
      return res;
    };
    for (const [page, label, openFn] of [[web, 'website', async () => openWeb('#/workspace/bigpicture')], [panel, 'extension', async () => { await panel.setViewport({ width: 1280, height: 900 }); await ensureViewer(panel); await click(panel, '#vt-bigpicture'); }]]) {
      await openFn(); // (the extension page is widened to 1280px so 400% zoom gives the 320 CSS px reflow width WCAG 1.4.10 specifies)
      const r = await zoomTo(page, 4);
      const m = await page.evaluate(() => ({ w: innerWidth, dpr: devicePixelRatio, over: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      check(`${label}: browser zoom set to 400%`, r === 'ok' && Math.abs(m.dpr - 4) < 0.3, `${r} innerWidth=${m.w} devicePixelRatio=${m.dpr}`);
      const offenders = m.over > 1 ? await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && e.offsetParent).slice(0, 6).map((e) => `${e.tagName.toLowerCase()}#${e.id}.${String(e.className).slice(0, 30)} right=${Math.round(e.getBoundingClientRect().right)}`)) : [];
      check(`${label} @400% zoom: no horizontal page scroll`, m.over <= 1, `overflow=${m.over} ${offenders.join(' | ')} innerWidth=${m.w}`);
      const v = await axe(page);
      check(`${label} @400% zoom: no axe violations`, v.length === 0, v.join(' | '));
      // Essential function still works: follow a How-do-we-know link by keyboard and see the evidence.
      await page.evaluate(() => { const a = document.querySelector('.how-link'); a.focus(); });
      await page.keyboard.press('Enter');
      await page.waitForSelector('#howWeKnow', { visible: true, timeout: 8000 }).catch(() => {});
      const ok = await page.evaluate(() => document.activeElement?.id === 'howWeKnow');
      const text = ok ? await page.$eval('#howWeKnow', (e) => e.innerText) : '';
      check(`${label} @400% zoom: "How do we know?" still opens its evidence`, ok && /How do we know\?/.test(text) && text.length > 60);
      const clipped = await page.evaluate(() => [...document.querySelectorAll('#howWeKnow *, .vw-title, h1, h2')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX !== 'visible').length);
      check(`${label} @400% zoom: no text clipped by its container`, clipped === 0, `${clipped}`);
      await shot(page, `${label}-deepdive-400pct-zoom.png`);
      const wz = await walk(page, label, 70);
      check(`${label} @400% zoom: Tab never traps focus; focus is visible and not hidden behind the header (${wz.seen.length} stops)`, !wz.trap && wz.covered.length === 0 && wz.noIndicator.length === 0, `trap=${wz.trap} covered=${[...new Set(wz.covered)].slice(0, 3).join(' | ')} noIndicator=${[...new Set(wz.noIndicator)].slice(0, 3).join(' | ')}`);
      await zoomTo(page, 1);
    }
  }

  // ===================== touch =====================
  if (only.has('touch')) {
    await web.bringToFront();
    await web.setViewport({ width: 375, height: 800, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await openWeb('#/workspace/bigpicture');
    const center = async (sel) => { await web.waitForSelector(sel, { timeout: 8000 }); await web.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center', behavior: 'instant' }), sel); await sleep(250); return web.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel); };
    let p = await center('#tab-overview');
    await web.touchscreen.tap(p.x, p.y);
    await web.waitForFunction(() => location.hash === '#/workspace/overview', { timeout: 5000 }).then(() => check('touch (emulated): tapping the Overview tab switches view', true), () => check('touch (emulated): tapping the Overview tab switches view', false));
    p = await center('#viewBody-overview .how-link');
    await web.touchscreen.tap(p.x, p.y);
    await web.waitForFunction(() => location.hash.startsWith('#/workspace/deepdive/'), { timeout: 5000 }).then(() => check('touch (emulated): tapping "How do we know?" opens Deep Dive', true), () => check('touch (emulated): tapping "How do we know?" opens Deep Dive', false));
    p = await center('#viewCrumbs-deepdive [data-goto]');
    await web.touchscreen.tap(p.x, p.y);
    await web.waitForFunction(() => /#\/workspace\/(overview|bigpicture)$/.test(location.hash), { timeout: 5000 }).then(() => check('touch (emulated): tapping Back returns to the previous view', true), () => check('touch (emulated): tapping Back returns to the previous view', false));
    await openWeb('#/workspace/deepdive');
    p = await center('#viewBody-deepdive .vw-details > summary');
    await web.touchscreen.tap(p.x, p.y);
    await sleep(300);
    check('touch (emulated): tapping a section opens it', await web.evaluate(() => document.querySelector('#viewBody-deepdive .vw-details').open));
    const under44 = await web.evaluate(() => [...document.querySelectorAll('#view-workspace a, #view-workspace button, #view-workspace summary')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.h < 44));
    info(`website @375px touch targets under 44px high (advisory; 24px is the AA minimum): ${under44.length}${under44.length ? ' e.g. ' + JSON.stringify(under44.slice(0, 4)) : ''}`);
    check('touch: every website control is at least 24px (WCAG 2.2 AA)', under44.every((x) => x.h >= 24 && x.w >= 24));
    await web.setViewport({ width: 1280, height: 900, hasTouch: false, isMobile: false });

    await panel.bringToFront();
    await panel.setViewport({ width: 375, height: 800, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await sleep(800); // enabling touch emulation reloads the page: reopen the case
    await click(panel, '#tab-research');
    await click(panel, '[data-open]');
    await panel.waitForSelector('#vpanel .vw-section', { timeout: 8000 });
    await click(panel, '#vt-bigpicture').catch(() => {});
    const pc = async (sel) => { await panel.waitForSelector(sel, { timeout: 8000 }); await panel.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center', behavior: 'instant' }), sel); await sleep(250); return panel.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel); };
    let q = await pc('#vt-overview');
    await panel.touchscreen.tap(q.x, q.y);
    await sleep(500);
    info('extension tap: element at point = ' + await panel.evaluate((x, y) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '#' + e.id : 'none'; }, q.x, q.y) + ' selected=' + await panel.evaluate(() => document.querySelector('#vt-overview')?.getAttribute('aria-selected')));
    await panel.waitForFunction(() => document.querySelector('#vt-overview')?.getAttribute('aria-selected') === 'true', { timeout: 5000 }).then(() => check('touch (emulated): extension tab tap switches view', true), () => check('touch (emulated): extension tab tap switches view', false));
    q = await pc('#vpanel .how-link');
    await panel.touchscreen.tap(q.x, q.y);
    await panel.waitForSelector('#howWeKnow', { visible: true, timeout: 5000 }).then(() => check('touch (emulated): extension "How do we know?" tap opens evidence', true), () => check('touch (emulated): extension "How do we know?" tap opens evidence', false));
    const extUnder = await panel.evaluate(() => [...document.querySelectorAll('#caseDetail a, #caseDetail button, #caseDetail summary')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.innerText || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.h < 44));
    info(`extension @375px targets under 44px high (advisory): ${extUnder.length}${extUnder.length ? ' e.g. ' + JSON.stringify(extUnder.slice(0, 4)) : ''}`);
    check('touch: every extension control is at least 24px (WCAG 2.2 AA)', extUnder.every((x) => x.h >= 24 && x.w >= 24));
    await panel.setViewport({ width: 375, height: 900, hasTouch: false, isMobile: false });
  }

  // ===================== accessibility tree =====================
  if (only.has('ax')) {
    const outline = async (page, rootSel) => {
      const snap = await page.accessibility.snapshot({ interestingOnly: true, root: rootSel ? await page.$(rootSel) : undefined });
      const heads = [], landmarks = [], bad = [];
      const walkNode = (n) => {
        if (!n) return;
        if (n.role === 'heading') heads.push(n.level || 0);
        if (['main', 'navigation', 'banner', 'contentinfo', 'search', 'region'].includes(n.role)) landmarks.push(n.role);
        if (['link', 'button', 'tab', 'textbox', 'searchbox'].includes(n.role) && !(n.name || '').trim()) bad.push(n.role);
        (n.children || []).forEach(walkNode);
      };
      walkNode(snap);
      const skips = heads.filter((h, i) => i > 0 && h - heads[i - 1] > 1);
      return { heads, landmarks, bad, skips };
    };
    for (const [route, label] of [['#/workspace/bigpicture', 'Big Picture'], ['#/workspace/overview', 'Overview'], ['#/workspace/deepdive', 'Deep Dive']]) {
      await openWeb(route);
      const o = await outline(web);
      check(`website ${label}: accessibility tree has main and navigation landmarks`, o.landmarks.includes('main') || o.landmarks.includes('navigation'), [...new Set(o.landmarks)].join(','));
      check(`website ${label}: headings never skip a level`, o.skips.length === 0, `levels=${o.heads.join('')}`);
      check(`website ${label}: every link, button and tab has an accessible name`, o.bad.length === 0, o.bad.join(','));
    }
    await panel.bringToFront();
    await ensureViewer(panel);
    for (const view of ['bigpicture', 'overview', 'deepdive']) {
      await click(panel, `#vt-${view}`);
      await sleep(200);
      const o = await outline(panel);
      check(`extension ${view}: headings never skip a level`, o.skips.length === 0, `levels=${o.heads.join('')}`);
      check(`extension ${view}: every link, button and tab has an accessible name`, o.bad.length === 0, o.bad.join(','));
    }
    const tl = await panel.evaluate(() => ({ role: document.querySelector('.vw-tabs')?.getAttribute('role'), tabs: [...document.querySelectorAll('.vw-tabs [role=tab]')].map((t) => `${t.getAttribute('aria-selected')}/${t.tabIndex}`) }));
    check('extension: view tabs use tablist/tab with roving tabindex', tl.role === 'tablist' && tl.tabs.filter((t) => t.endsWith('/0')).length === 1, JSON.stringify(tl));
  }

  check('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('test ran without throwing', false, e.stack || e.message);
} finally {
  await b.close();
}
process.exit(failed ? 1 : 0);
