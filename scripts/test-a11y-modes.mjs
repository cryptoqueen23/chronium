#!/usr/bin/env node
// Accessibility under user-preference modes, for the website and the extension:
//   - forced-colors (Windows High Contrast) and prefers-contrast: more
//   - increased text spacing (WCAG 1.4.12), alone and combined with 400% zoom
//   - reduced motion
//   - focus visibility, measured from pixels (what changes on screen, and how
//     strongly the ring contrasts with what it replaced)
//   - form error identification (text, announced, tied to the field, focus)
//   - responsive reflow with those modes on
// Automated emulation only: not a substitute for a person using Windows High
// Contrast, NVDA, or a real device (docs/MANUAL_A11Y_TESTS.md).
// Usage: wrangler dev on :8787, then
//   node scripts/test-a11y-modes.mjs --chrome=<Chrome for Testing exe> [--shots=<dir>] [--only=forced,contrast,spacing,motion,focus,errors,reflow]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILD } from './lib/case-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const chrome = arg('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const shots = arg('shots', '');
const only = new Set(arg('only', 'forced,contrast,spacing,motion,focus,errors,reflow').split(','));
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
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name) }); };
const click = async (page, sel) => { for (let i = 0; i < 5; i++) { try { await page.bringToFront(); await page.waitForSelector(sel, { visible: true, timeout: 5000 }); await page.click(sel); return; } catch (e) { if (i === 4) throw e; await sleep(250); } } };

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

  const web = await b.newPage();
  web.on('pageerror', (e) => errs.push('web: ' + e.message));
  await web.setViewport({ width: 1280, height: 900 });
  await web.goto(`${BASE}/#/investigations`, { waitUntil: 'networkidle2' });
  await web.evaluate(BUILD, '/db.js', 'Modes check');
  await web.evaluate(() => { location.hash = '#/settings'; });
  await sleep(300);
  await web.evaluate(() => { location.hash = '#/investigations'; });
  await web.waitForSelector('[data-open-investigation]');
  await web.evaluate(() => document.querySelector('[data-open-investigation]').click());
  await web.waitForSelector('#tab-bigpicture');

  const panel = await b.newPage();
  panel.on('pageerror', (e) => errs.push('ext: ' + e.message));
  await panel.setViewport({ width: 420, height: 900 });
  await panel.goto(`chrome-extension://${extId}/panel.html`);
  await panel.evaluate(BUILD, './lib/db.js', 'Modes check');
  await panel.reload();
  const ensureViewer = async () => { await click(panel, '#tab-research'); if (!(await panel.$('#vpanel .vw-section'))) { await click(panel, '[data-open]'); await panel.waitForSelector('#vpanel .vw-section', { timeout: 8000 }); } };
  await ensureViewer();
  const go = async (route) => { await web.bringToFront(); await web.evaluate((r) => { location.hash = r; }, route); await sleep(550); };
  const webViews = [['#/workspace/bigpicture', 'Big Picture'], ['#/workspace/overview', 'Overview'], ['#/workspace/deepdive', 'Deep Dive'], ['#/workspace/research', 'Research']];

  // ---------- pixel helpers ----------
  const decodeDiff = (page, a64, b64) => page.evaluate(async (a64, b64) => {
    const load = async (s) => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height); };
    const A = await load(a64), B = await load(b64);
    const lum = (r, g, bl) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl); };
    let changed = 0, best = 1;
    for (let i = 0; i < A.data.length; i += 4) {
      const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
      if (d > 24) { changed++; const l1 = lum(A.data[i], A.data[i + 1], A.data[i + 2]), l2 = lum(B.data[i], B.data[i + 1], B.data[i + 2]); const r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); if (r > best) best = r; }
    }
    return { changed, best };
  }, a64, b64);
  // How much the screen changes when `sel` takes keyboard focus, and the strongest contrast of a changed pixel against what it replaced.
  const focusDelta = async (page, sel) => {
    await page.bringToFront();
    await page.waitForSelector(sel, { timeout: 8000 });
    await page.evaluate((s) => { const e = document.querySelector(s); e.scrollIntoView({ block: 'center', behavior: 'instant' }); document.activeElement?.blur(); }, sel);
    await sleep(250);
    const rect = await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.max(0, r.x + scrollX - 10), y: Math.max(0, r.y + scrollY - 10), width: r.width + 20, height: r.height + 20 }; }, sel); // screenshot clips are page coordinates
    const before = await page.screenshot({ clip: rect, encoding: 'base64' });
    await page.evaluate((s) => document.querySelector(s).focus({ focusVisible: true }), sel); // as if reached by keyboard, so :focus-visible applies
    await sleep(250);
    const after = await page.screenshot({ clip: rect, encoding: 'base64' });
    await page.evaluate(() => document.activeElement?.blur());
    return decodeDiff(page, before, after);
  };

  // ============ forced colors / prefers-contrast ============
  if (only.has('forced')) {
    for (const [page, where] of [[web, 'website'], [panel, 'extension']]) {
      await page.bringToFront();
      await page.emulateMediaFeatures([{ name: 'forced-colors', value: 'active' }, { name: 'prefers-color-scheme', value: 'dark' }]);
      if (where === 'website') await go('#/workspace/bigpicture'); else await ensureViewer();
      const on = await page.evaluate(() => matchMedia('(forced-colors: active)').matches);
      check(`${where}: forced-colors mode is active in the browser`, on);
      // Selected tab must still look different from an unselected one.
      const tabSel = where === 'website' ? ['#tab-bigpicture', '#tab-overview'] : ['#vt-bigpicture', '#vt-overview'];
      const cap = async (s) => { const r = await page.evaluate((x) => { const e = document.querySelector(x); e.scrollIntoView({ block: 'center', behavior: 'instant' }); const q = e.getBoundingClientRect(); return { x: q.x + scrollX, y: q.y + scrollY, width: q.width, height: q.height }; }, s); await sleep(200); return page.screenshot({ clip: r, encoding: 'base64' }); };
      const a = await cap(tabSel[0]); const c = await cap(tabSel[1]);
      const d = await page.evaluate(() => 0);
      const diff = await decodeDiff(page, a, c.length === a.length ? c : c);
      check(`${where} forced-colors: the selected tab still looks different from the others`, diff.changed > 20, `changed pixels=${diff.changed}`);
      // Focus ring visible in forced colors.
      for (const [sel, label] of where === 'website' ? [['.how-link', 'How do we know? link'], ['#tab-overview', 'tab'], ['#view-workspace .workspace-head-actions .btn', 'button']] : [['.how-link', 'How do we know? link'], ['#vt-overview', 'tab'], ['#caseDetail button, .askbox button', 'button']]) {
        if (!(await page.$(sel))) { info(`${where}: ${label} (${sel}) not present`); continue; }
        const f = await focusDelta(page, sel.split(',')[0]);
        check(`${where} forced-colors: focus on ${label} is visible`, f.changed > 30, `changed pixels=${f.changed} contrast=${f.best.toFixed(1)}`);
      }
      // Control boundaries survive: borders are system colours, so check the controls still have a border or outline.
      const bare = await page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea, .btn, button:not([role=tab])')].filter((e) => e.offsetParent).filter((e) => { const cs = getComputedStyle(e); return !(parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.outlineWidth) > 0) && !e.closest('.search'); }).slice(0, 5).map((e) => e.tagName + '#' + e.id + '.' + String(e.className).slice(0, 25)));
      check(`${where} forced-colors: every visible control keeps a border or sits in a bordered wrapper`, bare.length === 0, bare.join(' | '));
      const hidden = await page.evaluate(() => [...document.querySelectorAll('svg[aria-hidden]')].filter((s) => s.offsetParent && getComputedStyle(s).stroke === 'none' && getComputedStyle(s).fill === 'none').length);
      check(`${where} forced-colors: icons still draw (use currentColor)`, hidden === 0, `${hidden}`);
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${where} forced-colors: no horizontal scroll`, ov <= 1, `${ov}`);
      await shot(page, `${where}-forced-colors.png`);
      await page.emulateMediaFeatures([{ name: 'forced-colors', value: 'none' }]);
    }
  }
  if (only.has('contrast')) {
    for (const theme of ['dark', 'light']) {
      for (const [page, where] of [[web, 'website'], [panel, 'extension']]) {
        await page.bringToFront();
        await page.emulateMediaFeatures([{ name: 'prefers-contrast', value: 'more' }, { name: 'prefers-color-scheme', value: theme }]);
        if (where === 'website') await go('#/workspace/bigpicture'); else await ensureViewer();
        const v = await axe(page);
        check(`${where} ${theme} prefers-contrast:more: no axe violations`, v.length === 0, v.join(' | '));
        const r = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); const g = (n) => cs.getPropertyValue(n).trim(); return { bg: g('--bg'), border: g('--border') || g('--line'), control: g('--control-border') || g('--control') }; });
        const hexRgb = (s) => { s = s.trim(); const h = s.length === 4 ? [...s.slice(1)].map((x) => x + x).join('') : s.slice(1); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
        const L = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const rt = (a, b2) => { const [x, y] = [L(a), L(b2)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        check(`${where} ${theme} prefers-contrast:more: even dividers reach 3:1`, rt(hexRgb(r.border), hexRgb(r.bg)) >= 3, `${r.border} on ${r.bg} = ${rt(hexRgb(r.border), hexRgb(r.bg)).toFixed(2)}`);
        await page.emulateMediaFeatures([{ name: 'prefers-contrast', value: 'no-preference' }, { name: 'prefers-color-scheme', value: 'dark' }]);
      }
    }
  }

  // ============ increased text spacing (WCAG 1.4.12) ============
  const SPACING = 'html *, html *::before, html *::after { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p, li, dd { margin-bottom: 2em !important; }';
  const spacingProblems = async (page) => page.evaluate(() => {
    const clipped = [], over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    for (const e of document.querySelectorAll('body *')) {
      if (!e.offsetParent || !(e.textContent || '').trim()) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'inline') continue;
      const clips = ['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowY) || ['hidden', 'clip'].includes(cs.overflowX);
      if (clips && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll' && (e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2) && e.clientHeight > 0 && !e.closest('svg, #__probe, .sr-only') && !e.classList.contains('sr-only') && e.tagName !== 'HTML' && e.tagName !== 'BODY') clipped.push(`${e.tagName.toLowerCase()}#${e.id}.${String(e.className).slice(0, 25)} (${e.scrollWidth}x${e.scrollHeight} in ${e.clientWidth}x${e.clientHeight})`);
      if (cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 2) clipped.push(`ellipsis ${e.tagName.toLowerCase()}#${e.id}`);
    }
    return { over, clipped: clipped.slice(0, 6) };
  });
  if (only.has('spacing')) {
    for (const w of [375, 1280]) {
      await web.bringToFront();
      await web.setViewport({ width: w, height: 900 });
      for (const [route, label] of webViews) {
        await go(route);
        const h = await web.addStyleTag({ content: SPACING });
        await sleep(300);
        const p = await spacingProblems(web);
        check(`website ${label} @${w}px with increased text spacing: no clipped text, no horizontal scroll`, p.over <= 1 && p.clipped.length === 0, `overflow=${p.over} ${p.clipped.join(' | ')}`);
        const v = await axe(web);
        check(`website ${label} @${w}px with increased text spacing: no axe violations`, v.length === 0, v.join(' | '));
        if (w === 375 && label === 'Big Picture') await shot(web, 'website-text-spacing-375.png');
        await web.evaluate((el) => el?.remove(), h);
      }
    }
    await web.setViewport({ width: 1280, height: 900 });
    await panel.bringToFront();
    for (const w of [320, 420]) {
      await panel.setViewport({ width: w, height: 900 });
      await ensureViewer();
      for (const view of ['bigpicture', 'overview', 'deepdive']) {
        await click(panel, `#vt-${view}`);
        const h = await panel.addStyleTag({ content: SPACING });
        await sleep(300);
        const p = await spacingProblems(panel);
        check(`extension ${view} @${w}px with increased text spacing: no clipped text, no horizontal scroll`, p.over <= 1 && p.clipped.length === 0, `overflow=${p.over} ${p.clipped.join(' | ')}`);
        if (w === 320 && view === 'bigpicture') await shot(panel, 'extension-text-spacing-320.png');
        await panel.evaluate((el) => el?.remove(), h);
      }
    }
    // The hardest combination: 400% zoom (320 CSS px) AND increased spacing.
    await web.bringToFront();
    await web.setViewport({ width: 1280, height: 900 });
    await go('#/workspace/deepdive');
    const z = await sw.evaluate(async () => { const tabs = await chrome.tabs.query({}); const t = tabs.find((x) => (x.url || '').startsWith('http://127.0.0.1:8787')); if (!t) return 'no tab'; await chrome.tabs.setZoom(t.id, 4); return 'ok'; });
    await sleep(800);
    const hz = await web.addStyleTag({ content: SPACING });
    await sleep(300);
    const pz = await spacingProblems(web);
    const m = await web.evaluate(() => ({ w: innerWidth, dpr: devicePixelRatio }));
    check('website Deep Dive at 400% zoom AND increased text spacing: no clipped text, no horizontal scroll', z === 'ok' && pz.over <= 1 && pz.clipped.length === 0, `zoom=${z} innerWidth=${m.w} dpr=${m.dpr} overflow=${pz.over} ${pz.clipped.join(' | ')}`);
    await web.evaluate((el) => el?.remove(), hz);
    await sw.evaluate(async () => { const tabs = await chrome.tabs.query({}); const t = tabs.find((x) => (x.url || '').startsWith('http://127.0.0.1:8787')); if (t) await chrome.tabs.setZoom(t.id, 1); });
    await sleep(500);
  }

  // ============ reduced motion ============
  if (only.has('motion')) {
    for (const [page, where] of [[web, 'website'], [panel, 'extension']]) {
      await page.bringToFront();
      if (where === 'website') await go('#/workspace/bigpicture'); else await ensureViewer();
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      const normal = await page.evaluate(() => ({ trans: [...document.querySelectorAll('*')].filter((e) => parseFloat(getComputedStyle(e).transitionDuration) > 0.05).length, smooth: getComputedStyle(document.documentElement).scrollBehavior }));
      info(`${where}: with no motion preference there are ${normal.trans} elements with transitions longer than 50ms`);
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await sleep(200);
      const reduced = await page.evaluate(() => ({
        longTrans: [...document.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e); return parseFloat(cs.transitionDuration) > 0.01 || parseFloat(cs.animationDuration) > 0.01; }).length,
        smooth: getComputedStyle(document.documentElement).scrollBehavior,
        running: document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity).length
      }));
      check(`${where} reduced motion: no transition or animation longer than 10ms remains`, reduced.longTrans === 0, `${reduced.longTrans}`);
      check(`${where} reduced motion: smooth scrolling is off`, reduced.smooth !== 'smooth', reduced.smooth);
      check(`${where} reduced motion: nothing animates forever`, reduced.running === 0, `${reduced.running}`);
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    }
  }

  // ============ focus visibility, measured from pixels ============
  if (only.has('focus')) {
    for (const theme of ['dark', 'light']) {
      await web.bringToFront();
      await web.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
      await go('#/workspace/bigpicture');
      for (const [sel, label] of [['#tab-overview', 'view tab'], ['.how-link', 'How do we know? link'], ['#view-workspace .workspace-head-actions .btn-primary', 'primary button'], ['#viewCrumbs-bigpicture a', 'breadcrumb link']]) {
        const f = await focusDelta(web, sel);
        check(`website ${theme}: focus ring on ${label} is visible and at least 3:1 against what it replaces`, f.changed > 30 && f.best >= 3, `changed=${f.changed} contrast=${f.best.toFixed(2)}`);
      }
      await go('#/workspace/deepdive');
      let f = await focusDelta(web, '#viewBody-deepdive .vw-details > summary');
      check(`website ${theme}: focus ring on a Deep Dive section header is visible and at least 3:1`, f.changed > 30 && f.best >= 3, `changed=${f.changed} contrast=${f.best.toFixed(2)}`);
      await go('#/workspace/research');
      f = await focusDelta(web, '#investigationQuery');
      check(`website ${theme}: focus on the Ask box is visible and at least 3:1`, f.changed > 30 && f.best >= 3, `changed=${f.changed} contrast=${f.best.toFixed(2)}`);
      await go('#/investigations');
      f = await focusDelta(web, '[data-open-investigation]');
      check(`website ${theme}: focus on an investigation link is visible and at least 3:1`, f.changed > 30 && f.best >= 3, `changed=${f.changed} contrast=${f.best.toFixed(2)}`);

      await panel.bringToFront();
      await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
      await ensureViewer();
      for (const [sel, label] of [['#tab-search', 'main tab'], ['#vt-overview', 'view tab'], ['#askQ', 'Ask box'], ['.askbox button.primary', 'Ask button'], ['#vpanel .how-link', 'How do we know? link'], ['#importCaseBtn', 'Import button']]) {
        const e = await focusDelta(panel, sel);
        check(`extension ${theme}: focus ring on ${label} is visible and at least 3:1`, e.changed > 30 && e.best >= 3, `changed=${e.changed} contrast=${e.best.toFixed(2)}`);
      }
    }
    await web.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  }

  // ============ form error identification (WCAG 3.3.1 / 3.3.3) ============
  if (only.has('errors')) {
    // Website: required field left empty -> native validation names the field and focuses it.
    await web.bringToFront();
    await go('#/investigations');
    await click(web, '[data-action="new-investigation"]');
    await web.waitForSelector('#newInvestigationName', { visible: true });
    await web.evaluate(() => { document.querySelector('#newInvestigationName').value = ''; });
    await click(web, '#newInvestigationForm button[type=submit]');
    await sleep(300);
    const v = await web.evaluate(() => { const i = document.querySelector('#newInvestigationName'); return { invalid: !i.checkValidity(), msg: i.validationMessage, focused: document.activeElement === i, label: !!document.querySelector('label[for=newInvestigationName]') }; });
    check('website: leaving a required field empty identifies it (native message) and returns focus to it', v.invalid && v.msg.length > 0 && v.focused && v.label, JSON.stringify(v));
    await web.keyboard.press('Escape');
    await sleep(300);
    // Website: the Add URL field is wired for error text (describedby points at an alert region) and rejects a malformed address with the browser's message.
    await go('#/workspace/research');
    await web.evaluate(() => { document.querySelector('[data-action="import-research"]')?.click(); });
    await web.waitForSelector('#addUrlInput', { visible: true, timeout: 5000 }).catch(() => {});
    const wired = await web.evaluate(() => { const i = document.querySelector('#addUrlInput'); const d = document.getElementById(i.getAttribute('aria-describedby') || ''); i.value = 'not a web address'; return { described: !!d && d.getAttribute('role') === 'alert', invalid: !i.checkValidity(), msg: i.validationMessage }; });
    check('website: Add URL field has an alert region tied to it and rejects a malformed address with a message', wired.described && wired.invalid && wired.msg.length > 0, JSON.stringify(wired));
    await web.keyboard.press('Escape');
    // Website: error toasts are announced immediately (role=alert).
    const toastRole = await web.evaluate(() => { const t = document.querySelector('#toast'); return { role: t.getAttribute('role'), live: t.getAttribute('aria-live') }; });
    info(`website toast region currently: role=${toastRole.role} aria-live=${toastRole.live} (switches to alert/assertive for errors)`);

    // Extension: bad case file -> plain-language error in a live region.
    await panel.bringToFront();
    await click(panel, '#tab-research');
    const bad = path.join(root, 'data', '_bad-case-file.json');
    fs.writeFileSync(bad, '{ not a case file');
    await (await panel.$('#caseFileInput')).uploadFile(bad);
    await sleep(700);
    fs.rmSync(bad, { force: true });
    const imp = await panel.evaluate(() => { const b = document.querySelector('#importBox'); return { text: b.innerText.trim(), live: b.getAttribute('aria-live'), role: b.getAttribute('role') }; });
    check('extension: a bad case file produces a plain-language error in a live region', /not a Chronium case file/.test(imp.text) && imp.live === 'polite', JSON.stringify(imp));
    // Extension: invalid server address -> inline error tied to the field, focus returned, no alert() popup.
    let dialogs = 0;
    panel.on('dialog', (d) => { dialogs++; d.dismiss(); });
    await panel.evaluate(() => { document.querySelector('.foot details').open = true; });
    await panel.evaluate(() => { document.querySelector('#workerUrl').value = 'not a web address'; });
    await click(panel, '#saveWorkerUrl');
    await sleep(300);
    const s = await panel.evaluate(() => { const i = document.querySelector('#workerUrl'); const e = document.querySelector('#workerUrlError'); return { shown: !e.hidden, text: e.textContent, role: e.getAttribute('role'), invalid: i.getAttribute('aria-invalid'), described: i.getAttribute('aria-describedby'), focused: document.activeElement === i }; });
    check('extension: an invalid server address gets inline error text, announced, tied to the field, with focus returned', s.shown && /https:\/\//.test(s.text) && s.role === 'alert' && s.invalid === 'true' && s.described === 'workerUrlError' && s.focused, JSON.stringify(s));
    check('extension: no alert() popup is used for validation', dialogs === 0, `${dialogs}`);
    // Extension: blank case name is blocked by the required field.
    await click(panel, '#tab-research');
    const nm = await panel.evaluate(() => { const i = document.querySelector('#newCaseName'); i.value = ''; i.form.requestSubmit(); return { invalid: !i.checkValidity(), msg: i.validationMessage, label: !!document.querySelector('label[for=newCaseName]') }; });
    check('extension: a blank case name is identified by a labelled required field', nm.invalid && nm.msg.length > 0 && nm.label, JSON.stringify(nm));
  }

  // ============ responsive reflow under the modes ============
  if (only.has('reflow')) {
    for (const mode of ['dark', 'light']) {
      await web.bringToFront();
      await web.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: mode }, { name: 'forced-colors', value: 'none' }]);
      for (const w of [320, 375, 768, 1024, 1280, 1920]) {
        await web.setViewport({ width: w, height: 900 });
        for (const [route, label] of webViews.slice(0, 3)) {
          await go(route);
          const o = await web.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          const v = await axe(web);
          check(`website ${label} @${w}px ${mode}: reflows without horizontal scroll and passes axe`, o <= 1 && v.length === 0, `overflow=${o} ${v.join(' | ')}`);
        }
      }
    }
    await web.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await web.setViewport({ width: 1280, height: 900 });
    await panel.bringToFront();
    for (const mode of ['dark', 'light']) {
      await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: mode }]);
      for (const w of [320, 375, 480, 768]) {
        await panel.setViewport({ width: w, height: 900 });
        await ensureViewer();
        for (const view of ['bigpicture', 'overview', 'deepdive']) {
          await click(panel, `#vt-${view}`);
          const o = await panel.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          const v = await axe(panel);
          check(`extension ${view} @${w}px ${mode}: reflows without horizontal scroll and passes axe`, o <= 1 && v.length === 0, `overflow=${o} ${v.join(' | ')}`);
        }
      }
    }
  }
  check('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('test ran without throwing', false, e.stack || e.message);
} finally {
  await b.close();
}
process.exit(failed ? 1 : 0);
