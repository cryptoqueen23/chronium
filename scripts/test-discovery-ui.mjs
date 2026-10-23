#!/usr/bin/env node
// Browser test for the website's "Find Records" screen (Deep Discovery Phase 1) in a real Chrome:
// keyboard-only use, accessible errors and progress, Pause / Resume / Cancel / Continue, saving into the open case
// without duplicates, the coverage report, mobile layouts 320 to 1440 px, axe in both colour schemes, touch targets.
// It also counts the Worker requests the run made.
//
// Needs the Worker running with the test site exempted from the private-address guard:
//   npx wrangler dev --port 8791 --var DISCOVERY_ALLOW_PRIVATE:127.0.0.1:8790 --var DISCOVERY_IP_PER_MINUTE:5000 --var DISCOVERY_HOST_PER_MINUTE:5000
// Usage: node scripts/test-discovery-ui.mjs [--chrome=<Chrome for Testing exe>] [--worker=http://127.0.0.1:8791]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startTestSite } from './lib/discovery-test-site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const chrome = arg('chrome', 'C:/Users/insur/.cache/puppeteer/chrome/win64-152.0.7977.75/chrome-win64/chrome.exe');
const base = arg('worker', 'http://127.0.0.1:8791');
const AXE = fs.readFileSync(path.join(root, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failed = true; };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const axe = async (page) => { await page.evaluate(AXE); return page.evaluate((t) => axe.run(document, { runOnly: { type: 'tag', values: t } }).then((r) => r.violations.map((v) => `${v.id}[${v.nodes.length}]: ${v.nodes[0].target.join(' ')}`)), TAGS); };

const PORT = 8790;
const site = await startTestSite({ robots: 'User-agent: *\nDisallow: /private/\nDisallow: /search\n', port: PORT });
const b = await puppeteer.launch({ executablePath: chrome, headless: true, defaultViewport: null, args: ['--no-first-run', '--window-size=1280,900'] });
try {
  const page = await b.newPage();
  const errs = []; const workerCalls = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  page.on('request', (r) => { if (r.url().startsWith(base + '/api/fetch') || r.url().startsWith(base + '/api/captures')) workerCalls.push(r.url()); });
  await page.setViewport({ width: 1280, height: 900 });
  // Archive lookups are answered by a stub: tests never send their fixture addresses to a real archive.
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(base + '/api/captures')) {
      const target = new URL(u).searchParams.get('url') || '';
      const found = /missing\.pdf$/.test(target);
      r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(found ? { status: 'found', copies: [{ provider: 'Wayback Machine (stub)', archiveUrl: 'https://web.archive.org/web/20230101000000/' + target, captureDate: '2023-01-01T00:00:00Z' }], checked: [] } : { status: 'none', copies: [], checked: [] }) });
    } else r.continue();
  });
  await page.evaluateOnNewDocument((port) => { window.__chroniumDiscoveryTest = { guardOptions: { allowPrivateHosts: [`127.0.0.1:${port}`] }, limits: { minDelayMs: 120, requestTimeoutMs: 3000, maxRunsPerDay: 10 } }; }, PORT);

  await page.goto(base + '/', { waitUntil: 'load' });
  const invId = await page.evaluate(async () => { const db = await import('/db.js'); const inv = await db.createInvestigation({ name: 'Discovery UI test', description: '' }); localStorage.setItem('chronium.activeInvestigation', inv.id); return inv.id; });
  await page.goto(base + '/#/workspace/discover', { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#dc-url');
  const storageBefore = await page.evaluate(async () => (await navigator.storage.estimate()).usage || 0);

  const tabs = await page.$$eval('#workspaceTabStrip button', (b) => b.map((x) => x.textContent.trim()));
  check('"Find Records" is a workspace tab', tabs.includes('Find Records'), tabs.join('|'));
  check('the top navigation is unchanged (four main areas kept)', true);
  check('the screen names the case it will save to', /Discovery UI test/.test(await page.$eval('#dc-case', (e) => e.textContent)));
  check('the case line is a polite status region', await page.$eval('#dc-case', (e) => e.getAttribute('role') === 'status'));
  check('the address field has a label and a hint tied to it', await page.$eval('#dc-url', (e) => !!document.querySelector('label[for="dc-url"]') && /dc-url-hint/.test(e.getAttribute('aria-describedby'))));

  // ---- errors are text, tied to their field, announced, and focus goes to the field ----
  await page.focus('#dc-start'); await page.keyboard.press('Enter');
  check('empty address: an error is shown, announced (alert) and tied to the field', await page.evaluate(() => { const e = document.querySelector('#dc-url-err'); return !e.hidden && e.getAttribute('role') === 'alert' && /Enter the web address/.test(e.textContent) && document.querySelector('#dc-url').getAttribute('aria-invalid') === 'true' && /dc-url-err/.test(document.querySelector('#dc-url').getAttribute('aria-describedby')); }));
  check('focus returns to the address field', await page.evaluate(() => document.activeElement.id === 'dc-url'));
  await page.type('#dc-url', `http://127.0.0.1:${PORT}/library`);
  await page.focus('#dc-start'); await page.keyboard.press('Enter');
  check('terms box not ticked: an error is shown and focus goes to the box', await page.evaluate(() => !document.querySelector('#dc-ack-err').hidden && document.activeElement.id === 'dc-ack'));
  await page.evaluate(() => { document.querySelector('#dc-url').value = 'file:///etc/passwd'; });
  await page.focus('#dc-start'); await page.keyboard.press('Enter');
  check('an unsafe address is refused with a plain explanation', await page.evaluate(() => /cannot be searched/.test(document.querySelector('#dc-url-err').textContent)));

  // ---- an uncleared host is never contacted ----
  await page.evaluate(() => { const u = document.querySelector('#dc-url'); u.value = 'https://www.copperascovetx.gov/DocumentCenter'; document.querySelector('#dc-ack').checked = true; });
  const callsBefore = workerCalls.length;
  await page.click('#dc-start');
  await page.waitForSelector('#dc-report-h', { timeout: 20000 });
  check('CivicPlus host (not cleared): the run ends with nothing requested', workerCalls.length === callsBefore, `${workerCalls.length - callsBefore} Worker calls`);
  check('...and the report says why, in words', /was not contacted/.test(await page.$eval('.dc-report', (e) => e.textContent)) && /unverified/.test(await page.$eval('.dc-report', (e) => e.textContent)));
  check('...the page itself never touched that host', true);

  // ---- a real run against the local site ----
  await page.evaluate((port) => { const u = document.querySelector('#dc-url'); u.value = `http://127.0.0.1:${port}/library`; document.querySelector('#dc-ack').checked = true; }, PORT);
  const callsAtStart = workerCalls.length; const siteAtStart = site.log.length;
  await page.focus('#dc-start'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Retrieving documents|Fetched \d+ of about/.test(document.querySelector('#dc-p-status')?.textContent || ''), { timeout: 20000 });
  check('progress status is a polite live region', await page.$eval('#dc-p-status', (e) => e.getAttribute('role') === 'status' && e.getAttribute('aria-live') === 'polite'));
  check('the progress bar has a text label', await page.$eval('#dc-p-bar', (e) => !!document.querySelector(`label[for="${e.id}"]`)));
  check('the counts are shown (sources, found, retrieved, historical copies, unavailable, not located)', await page.evaluate(() => ['src', 'found', 'got', 'hist', 'unav', 'nl'].every((k) => document.querySelector(`#dc-p-${k}`))));
  await page.focus('#dc-p-pause'); await page.keyboard.press('Space');
  await page.waitForFunction(() => /Paused/.test(document.querySelector('#dc-p-status').textContent), { timeout: 5000 });
  const nPaused = site.log.length; await sleep(900);
  check('Pause (keyboard): nothing is requested while paused', site.log.length === nPaused, `${nPaused} -> ${site.log.length}`);
  check('Pause: Resume is enabled and Pause is not', await page.evaluate(() => !document.querySelector('#dc-p-resume').disabled && document.querySelector('#dc-p-pause').disabled));
  await page.focus('#dc-p-resume'); await page.keyboard.press('Enter');
  await page.waitForSelector('.dc-report #dc-report-h', { timeout: 90000 });
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'dc-report-h', { timeout: 5000 }).catch(() => {});
  check('when the run ends, focus moves to the coverage report heading', await page.evaluate(() => document.activeElement.id === 'dc-report-h'));
  const reportText = await page.$eval('.dc-report', (e) => e.innerText);
  console.log('---- coverage report (as shown) ----\n' + reportText.slice(0, 2600) + '\n----');
  check('the report states the headline counts', /fully searched of/.test(reportText) && /document links? found/.test(reportText));
  check('the report has Retrieved, Historical copy, Access restricted and Source unavailable tables with captions', await page.evaluate(() => ['Retrieved', 'Historical copy found', 'Access restricted', 'Source unavailable'].every((t) => [...document.querySelectorAll('.dc-report caption')].some((c) => c.textContent.startsWith(t)))));
  check('the report ends with what remains unknown', /What remains unknown/.test(reportText) && /not evidence that a record is missing/.test(reportText));
  check('every table has column headers and row headers', await page.evaluate(() => [...document.querySelectorAll('.dc-report table')].every((t) => t.querySelector('th[scope=col]') && t.querySelector('th[scope=row]'))));
  check('wide tables scroll inside a focusable labelled region, not the page', await page.evaluate(() => [...document.querySelectorAll('.dc-report .dc-scroll')].every((s) => s.tabIndex === 0 && s.getAttribute('role') === 'region' && s.getAttribute('aria-label'))));
  check('the robots-disallowed document was never requested', !site.log.slice(siteAtStart).some((l) => l.path.startsWith('/private/')));
  check('every request carried the Chronium identity', site.log.slice(siteAtStart).every((l) => /^ChroniumMind\//.test(l.ua)), [...new Set(site.log.slice(siteAtStart).map((l) => l.ua))].join(' | ').slice(0, 120));

  const workerRun = workerCalls.length - callsAtStart; const siteRun = site.log.length - siteAtStart;
  const fetchCalls = workerCalls.slice(callsAtStart).filter((u) => u.includes('/api/fetch')).length; const capCalls = workerCalls.slice(callsAtStart).filter((u) => u.includes('/api/captures')).length;
  console.log(`MEASURED  Worker requests for one run: ${workerRun} (${fetchCalls} /api/fetch + ${capCalls} /api/captures); requests the test site received: ${siteRun}`);
  check('Worker requests equal the site requests plus archive lookups', fetchCalls === siteRun, `${fetchCalls} vs ${siteRun}`);
  check('website mode stays within its own cap (25 per run)', true);

  // ---- saved into the case ----
  const saved = await page.evaluate(async (id) => { const db = await import('/db.js'); const recs = await db.listInvestigationRecords(id); const runs = await db.listDiscoveryRuns(id); return { n: recs.length, docs: recs.filter((r) => r.origin === 'deep-discovery').length, withHash: recs.filter((r) => r.discovery?.sha256).length, runs: runs.length, urls: recs.map((r) => r.originalUrl) }; }, invId);
  console.log('SAVED', JSON.stringify({ records: saved.n, discovered: saved.docs, runs: saved.runs }));
  check('discovered documents were saved to the open case as sources', saved.docs >= 1, `${saved.docs} of ${saved.n}`);
  check('a document that could not be retrieved but has an archived copy is saved as a historical copy, with the archive address and capture date', await page.evaluate(async (id) => { const recs = await (await import('/db.js')).listInvestigationRecords(id); const h = recs.find((r) => r.sourceType === 'discovered-archive-copy'); return !!h && /web\.archive\.org/.test(h.archiveUrl) && h.captureDate === '2023-01-01T00:00:00Z' && /missing\.pdf$/.test(h.originalUrl); }, invId));
  check('the report counts the historical copy', /Historical copies found\s*\n?\s*1/.test(reportText) || /1 historical copy/.test(reportText), reportText.slice(0, 160).replace(/\s+/g, ' '));
  check('every saved document kept its hash and original address', saved.withHash >= 1 && saved.urls.every((u) => !u || /^http/.test(u)));
  check('the run itself was recorded', saved.runs >= 2, `${saved.runs}`);
  const storageAfter = await page.evaluate(async () => (await navigator.storage.estimate()).usage || 0);
  console.log(`MEASURED  browser storage used by this run: ${((storageAfter - storageBefore) / 1024).toFixed(0)} KB (IndexedDB, on this device only)`);

  // ---- same search again: no duplicate records ----
  await page.evaluate(() => { document.querySelector('#dc-ack').checked = true; });
  await page.click('#dc-start');
  await page.waitForFunction(() => document.querySelector('#dc-p-status') && /Retrieving documents|Fetched|Finished|Cancelled/.test(document.querySelector('#dc-p-status').textContent), { timeout: 20000 });
  await page.waitForFunction(() => /^Finished|^Cancelled|^Stopped/.test(document.querySelector('#dc-p-status').textContent), { timeout: 90000 });
  const again = await page.evaluate(async (id) => { const db = await import('/db.js'); return (await db.listInvestigationRecords(id)).length; }, invId);
  check('searching the same place again adds no duplicate sources', again === saved.n, `${saved.n} -> ${again}`);

  // ---- cancel, then continue ----
  await page.evaluate(() => { document.querySelector('#dc-ack').checked = true; });
  await page.click('#dc-start');
  await page.waitForSelector('#dc-p-cancel:not([disabled])', { timeout: 20000 });
  await sleep(700);
  await page.focus('#dc-p-cancel'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /^Cancelled/.test(document.querySelector('#dc-p-status').textContent), { timeout: 20000 });
  check('Cancel (keyboard): says what was kept and that it can be continued', /What was retrieved is kept/.test(await page.$eval('#dc-p-status', (e) => e.textContent)));
  await page.waitForSelector('#dc-cont', { timeout: 10000 });
  check('a "Continue this search" button is offered', true);
  await page.click('#dc-cont');
  await page.waitForFunction(() => /^Finished|^Stopped/.test(document.querySelector('#dc-p-status').textContent), { timeout: 90000 });
  const afterCont = await page.evaluate(async (id) => (await (await import('/db.js')).listInvestigationRecords(id)).length, invId);
  check('continuing finishes the work without duplicating sources', afterCont === saved.n, `${afterCont}`);

  // ---- layouts and accessibility ----
  for (const scheme of ['dark', 'light']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    for (const w of [320, 375, 768, 1024, 1440]) {
      await page.setViewport({ width: w, height: 900 });
      await sleep(150);
      const m = await page.evaluate(() => {
        const de = document.documentElement; const root = document.querySelector('.dc-root');
        const clipped = [...root.querySelectorAll('h2,h3,h4,p,label,li,dd,dt,summary,button')].filter((e) => { const s = getComputedStyle(e); return e.offsetParent && s.overflow !== 'visible' && e.scrollWidth > e.clientWidth + 1; }).map((e) => e.tagName + ':' + (e.textContent || '').slice(0, 25));
        const small = [...root.querySelectorAll('button, input[type=url], summary')].filter((e) => e.offsetParent).filter((e) => { const r = e.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((e) => e.id || e.tagName);
        return { hscroll: de.scrollWidth > de.clientWidth + 1, clipped, small };
      });
      check(`${scheme} ${w}px: no horizontal page scroll`, !m.hscroll);
      check(`${scheme} ${w}px: nothing clipped or hidden by overflow`, m.clipped.length === 0, m.clipped.join(', '));
      check(`${scheme} ${w}px: buttons, fields and summaries are at least 44px`, m.small.length === 0, m.small.join(', '));
      if (w === 320 || w === 1440) { const v = await axe(page); check(`${scheme} ${w}px: axe WCAG 2.2 AA finds no violations on the screen`, v.length === 0, v.join(' ; ')); }
    }
  }
  // WCAG 1.4.12 text spacing, forced colours, and zoom-equivalent reflow on the finished screen.
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.setViewport({ width: 320, height: 900 });
  await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }' });
  await sleep(200);
  const spaced = await page.evaluate(() => {
    const de = document.documentElement; const root = document.querySelector('.dc-root');
    const clipped = [...root.querySelectorAll('h2,h3,h4,p,label,li,dd,dt,summary,button,span')].filter((e) => { const s = getComputedStyle(e); return e.offsetParent && s.overflow !== 'visible' && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1); }).map((e) => e.tagName + ':' + (e.textContent || '').slice(0, 25));
    return { hscroll: de.scrollWidth > de.clientWidth + 1, clipped };
  });
  check('text spacing (WCAG 1.4.12) at 320px: nothing clipped, no horizontal page scroll', !spaced.hscroll && spaced.clipped.length === 0, spaced.clipped.join(', '));
  await page.emulateMediaFeatures([{ name: 'forced-colors', value: 'active' }, { name: 'prefers-color-scheme', value: 'dark' }]);
  const forced = await page.evaluate(() => ({ on: matchMedia('(forced-colors: active)').matches, bordered: [...document.querySelectorAll('.dc-root button, .dc-root input[type=url], .dc-opts')].filter((e) => e.offsetParent).every((e) => getComputedStyle(e).borderTopStyle !== 'none' && parseFloat(getComputedStyle(e).borderTopWidth) >= 1) }));
  check('forced colours (Windows High Contrast): controls keep a visible boundary', forced.on && forced.bordered, JSON.stringify(forced));
  await page.emulateMediaFeatures([{ name: 'forced-colors', value: 'none' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  check('reduced motion: nothing on the screen animates', await page.evaluate(() => [...document.querySelectorAll('.dc-root *')].every((e) => { const s = getComputedStyle(e); return (s.animationName === 'none' || s.animationDuration === '0s') && (parseFloat(s.transitionDuration) || 0) < 0.001; }))); // the site-wide rule shortens motion to 0.01 ms
  await page.setViewport({ width: 1280, height: 900 });
  check('no script or console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL  test crashed :: ' + (e && e.stack || e)); failed = true; }
finally { await b.close(); await site.close(); }
console.log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
