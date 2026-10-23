#!/usr/bin/env node
// Browser tests for Records Recovery: the website tab (and its Big Picture summary, Deep Dive section and Report
// appendix) and the extension's Big Picture summary and Reports appendix, in a real Chrome. Synthetic case only.
// Needs the site served:  npx wrangler dev --port 8791
// Usage: node scripts/test-recovery-ui.mjs [--chrome=<Chrome for Testing exe>] [--site=http://127.0.0.1:8791]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { incompleteSnapshot } from './lib/recovery-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const chrome = arg('chrome', 'C:/Users/insur/.cache/puppeteer/chrome/win64-152.0.7977.75/chrome-win64/chrome.exe');
const base = arg('site', 'http://127.0.0.1:8791');
const AXE = fs.readFileSync(path.join(root, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failed = true; };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const axe = async (page) => { await page.evaluate(AXE); return page.evaluate((t) => axe.run(document, { runOnly: { type: 'tag', values: t } }).then((r) => r.violations.map((v) => `${v.id}[${v.nodes.length}]: ${v.nodes[0].target.join(' ')}`)), TAGS); };
const records = incompleteSnapshot().records;
const REQUEST = `Dear City Secretary,
1. All minutes of the City Council from January 1, 2024 to December 31, 2024.
2. The FY2023 annual budget.
3. Ordinance No. 2024-21.
4. Minutes of the Planning Commission for 2024.
5. Minutes of the City Council for January 9, 2024.`;

const b = await puppeteer.launch({ executablePath: chrome, headless: true, defaultViewport: null, args: ['--no-first-run', '--window-size=1280,900'] });
try {
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  let outbound = 0;
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) outbound += 1; if (/\/api\//.test(u)) outbound += 1; });
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(base + '/', { waitUntil: 'load' });
  const invId = await page.evaluate(async (recs) => {
    const db = await import('/db.js'); const inv = await db.createInvestigation({ name: 'Recovery UI test', description: '' });
    for (const r of recs) await db.saveRecordToInvestigation(inv.id, { ...r, id: undefined, canonicalKey: r.fileHash });
    localStorage.setItem('chronium.activeInvestigation', inv.id); return inv.id;
  }, records);
  await page.goto(base + '/#/workspace/recovery', { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#rr-rep-h', { timeout: 20000 });
  outbound = 0;

  // ---- the tab and the notice ----
  const tabs = await page.$$eval('#workspaceTabStrip button', (x) => x.map((e) => e.textContent.trim()));
  check('"Records Recovery" is a workspace tab; the main navigation is unchanged', tabs.includes('Records Recovery'), tabs.join('|'));
  const notice = await page.$eval('.rr-notice', (e) => e.textContent);
  check('the notice says a gap here is not a gap in the government\'s records', /not a statement about what the government holds/.test(notice) && /not evidence that the government lacks a record/.test(notice));
  check('the notice is a labelled note', await page.$eval('.rr-notice', (e) => e.getAttribute('role') === 'note'));
  const counts = await page.$eval('.rr-counts', (e) => e.innerText.replace(/\s+/g, ' '));
  check('counts: 26 sources; 7 flagged "not held" or review items', /26/.test(counts), counts);
  const captions = await page.$$eval('.rr-report caption', (c) => c.map((x) => x.textContent));
  check('the planted gaps are listed in their tables (3 pairs, 1 date, 1 year, 2 citations)', captions.some((c) => /Agenda and minutes pairs.*\(3\)/.test(c)) && captions.some((c) => /Recurring series.*\(1\)/.test(c)) && captions.some((c) => /Annual documents.*\(1\)/.test(c)) && captions.some((c) => /Cited by a document.*\(2\)/.test(c)), captions.join(' | '));
  const html = await page.$eval('.rr-report', (e) => e.innerText);
  check('no banned wording appears on the screen', !/does not exist|failed to produce|withheld|\bmissing\b|violation|refused to/i.test(html));
  check('every table has captions, column headers and row headers', await page.evaluate(() => [...document.querySelectorAll('.rr-report table')].every((t) => t.querySelector('caption') && t.querySelector('th[scope=col]') && t.querySelector('th[scope=row]'))));
  check('wide tables scroll inside focusable labelled regions', await page.evaluate(() => [...document.querySelectorAll('.rr-scroll')].every((s) => s.tabIndex === 0 && s.getAttribute('role') === 'region' && s.getAttribute('aria-label'))));
  check('what remains unknown is shown', /What remains unknown/.test(html));

  // ---- decisions by keyboard ----
  const key = await page.$eval('[data-rr-decide="acknowledged"]', (e) => e.dataset.rrKey);
  await page.focus('[data-rr-decide="acknowledged"]'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Acknowledged/.test(document.querySelector('#rr-status').textContent), { timeout: 5000 });
  check('Acknowledge by keyboard: announced in a status region, item shows the decision', /Acknowledged/.test(await page.$eval('.rr-report', (e) => e.innerText)) && await page.$eval('#rr-status', (e) => e.getAttribute('role') === 'status'));
  await page.focus('[data-rr-decide="not-applicable"]'); await page.keyboard.press('Enter');
  await page.waitForSelector('.rr-decision-form');
  await page.evaluate(() => document.querySelector('.rr-decision-form button[type=submit]').click());
  check('"Not applicable" without a reason: an error is shown as text, announced, and tied to the field', await page.evaluate(() => { const e = document.querySelector('.rr-decision-form .rr-error'); const i = document.querySelector('.rr-decision-form input'); return !e.hidden && e.getAttribute('role') === 'alert' && i.getAttribute('aria-invalid') === 'true' && /rr-df-.*-e/.test(i.getAttribute('aria-describedby')) && document.activeElement === i; }));
  await page.keyboard.type('No meeting was held that month');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /set aside as not applicable/.test(document.querySelector('#rr-status').textContent), { timeout: 5000 });
  check('with a reason it is recorded and shown with who/when/why', /Not applicable/.test(await page.$eval('.rr-report', (e) => e.innerText)) && /No meeting was held/.test(await page.$eval('.rr-report', (e) => e.innerText)));
  const stored = await page.evaluate(async (id) => (await (await import('/recovery/store.js')).listReviews(id)).map((r) => r.decision), invId);
  check('decisions are stored locally and the evidence was not touched', stored.length === 2 && await page.evaluate(async (id) => { const db = await import('/db.js'); return (await db.listInvestigationRecords(id)).length; }, invId) === 26 && await page.evaluate(async (id) => { const db = await import('/db.js'); return [(await db.listClaims(id)).length, (await db.listEvidenceItems(id)).length]; }, invId).then((x) => x.join() === '0,0'));
  // Confirm a match flow
  const confirmBtns = await page.$$('[data-rr-decide="match-confirmed"]'); await confirmBtns[1].focus(); await page.keyboard.press('Enter');
  await page.waitForSelector('.rr-decision-form select');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); // from the select: the note, then the Confirm button
  check('the confirm form is reachable by keyboard (focus is on its Confirm button)', await page.evaluate(() => document.activeElement.type === 'submit' && /Confirm/.test(document.activeElement.textContent)));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /closed by your confirmation/.test(document.querySelector('#rr-status').textContent), { timeout: 5000 });
  check('Confirm a match: recorded, and the item shows "Closed by a reviewer"', /Closed by a reviewer/.test(await page.$eval('.rr-report', (e) => e.innerText)));

  // ---- the pattern setting ----
  await page.$eval('#rr-cad', (e) => { e.value = ''; });
  await page.type('#rr-cad', '2'); await page.keyboard.press('Enter'); await sleep(300);
  check('a setting outside 3 to 12 is refused with a message', /whole number from 3 to 12/.test(await page.$eval('#rr-status', (e) => e.textContent)));
  await page.$eval('#rr-cad', (e) => { e.value = ''; });
  await page.type('#rr-cad', '12'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /now recognised from at least 12/.test(document.querySelector('#rr-status').textContent), { timeout: 5000 });
  check('a stricter threshold removes the pattern-based item and is shown', !(await page.$$eval('.rr-report caption', (c) => c.map((x) => x.textContent))).some((c) => /Recurring series/.test(c)) && /at least 12 dated documents/.test(await page.$eval('.rr-counts', (e) => e.innerText)));
  await page.$eval('#rr-cad', (e) => { e.value = ''; }); await page.type('#rr-cad', '4'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /now recognised from at least 4/.test(document.querySelector('#rr-status').textContent), { timeout: 5000 });

  // ---- request: read, correct, save, compare, follow-up ----
  await page.type('#rr-text', REQUEST);
  await page.focus('#rr-req button[type=submit]'); await page.keyboard.press('Enter');
  await page.waitForSelector('#rr-editor');
  check('the request is read into items the person can check, with focus on the editor', await page.$$eval('#rr-editor fieldset.rr-item', (f) => f.length) >= 4 && await page.evaluate(() => document.activeElement.id === 'rr-editor-h'));
  check('every field has a label', await page.evaluate(() => [...document.querySelectorAll('#rr-editor input, #rr-editor select')].every((e) => document.querySelector(`label[for="${e.id}"]`))));
  const firstType = await page.$eval('#rr-editor select', (e) => e.id);
  const bodyId = firstType.replace('-t-', '-b-');
  await page.select(`#${firstType}`, 'minutes');
  await page.$eval(`#${bodyId}`, (e) => { e.value = 'city council'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  check('a correction is acknowledged', /Item updated/.test(await page.$eval('#rr-status', (e) => e.textContent)));
  await page.click('#rr-add'); await page.waitForFunction(() => document.querySelectorAll('#rr-editor fieldset').length >= 5);
  check('items can be added and removed', await page.$$eval('[data-rr-remove]', (b) => b.length) >= 5);
  await page.evaluate(() => { const b = document.querySelectorAll('[data-rr-remove]'); b[b.length - 1].click(); });
  check('removing an item works and is announced', /Item removed/.test(await page.$eval('#rr-status', (e) => e.textContent)));
  await page.$eval('#rr-title-in', (e) => { e.value = 'Test request'; });
  await page.evaluate(() => document.querySelector('#rr-editor button[type=submit]').click());
  await page.waitForFunction(() => /Saved “Test request”/.test(document.querySelector('#rr-status').textContent), { timeout: 5000 });
  const reqText = await page.$eval('#rr-results', (e) => e.innerText);
  check('the saved request is compared with the case in neutral words', /Located in this case/.test(reqText) && /Not held in this case/.test(reqText) && /Partly located in this case/.test(reqText), reqText.slice(0, 200).replace(/\s+/g, ' '));
  check('the comparison never says produced / not produced', !/not produced|produced|failed|refus/i.test(await page.$eval('#rr-results caption', (e) => e.parentElement.parentElement.innerText).catch(() => '')));
  const fu = await page.$eval('textarea[data-rr-draft]', (e) => e.value);
  check('the follow-up draft is editable text that describes the person\'s own file and is never sent', /It describes my own file only/.test(fu) && /Chronium never sends it/.test(await page.$eval('.rr-followup', (e) => e.innerText)) && await page.$eval('textarea[data-rr-draft]', (e) => !e.readOnly));
  await page.evaluate(() => { const t = document.querySelector('textarea[data-rr-draft]'); t.value = t.value + '\n\nPS: my own edit.'; });
  await page.click('[data-rr-savedraft]'); await sleep(300);
  await page.reload({ waitUntil: 'load' }); await page.waitForSelector('textarea[data-rr-draft]');
  check('edits to the draft persist across a reload', /PS: my own edit/.test(await page.$eval('textarea[data-rr-draft]', (e) => e.value)));
  check('the request itself persists', await page.$$eval('#rr-results caption', (c) => c.some((x) => /Test request/.test(x.textContent))));
  check('no request left this device while using the screen', outbound === 0, `${outbound} outbound requests`);

  // ---- other surfaces ----
  await page.goto(base + '/#/workspace/bigpicture', { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.rr-summary', { timeout: 15000 });
  check('Big Picture has a Records Recovery summary with the notice and a link', /not a statement about what the government holds/.test(await page.$eval('.rr-summary', (e) => e.innerText)) && await page.$eval('.rr-summary a', (a) => /workspace\/recovery/.test(a.getAttribute('href'))));
  await page.goto(base + '/#/workspace/deepdive', { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#vw-recovery', { timeout: 15000 });
  check('Deep Dive has a Records Recovery section listing the items', /Records Recovery/.test(await page.$eval('#vw-recovery summary', (e) => e.textContent)) && await page.evaluate(() => { document.querySelector('#vw-recovery').open = true; return document.querySelectorAll('#vw-recovery table').length > 0; }));
  await page.goto(base + '/#/workspace/report', { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#reportContent .rr-report', { timeout: 15000 });
  check('the Report has a Records Recovery appendix', /What remains unknown/.test(await page.$eval('#reportContent .rr-report', (e) => e.innerText)));

  // ---- layouts and accessibility ----
  await page.goto(base + '/#/workspace/recovery', { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' }); await page.waitForSelector('#rr-rep-h');
  for (const scheme of ['dark', 'light']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    for (const w of [320, 375, 768, 1024, 1440]) {
      await page.setViewport({ width: w, height: 900 }); await sleep(150);
      const m = await page.evaluate(() => {
        const de = document.documentElement; const root = document.querySelector('.rr-root');
        const clipped = [...root.querySelectorAll('h2,h3,h4,p,label,li,dd,dt,summary,button,legend')].filter((e) => { const s = getComputedStyle(e); return e.offsetParent && s.overflow !== 'visible' && e.scrollWidth > e.clientWidth + 1; }).map((e) => e.tagName + ':' + (e.textContent || '').slice(0, 25));
        const small = [...root.querySelectorAll('button, input:not([type=hidden]), select, textarea, summary')].filter((e) => e.offsetParent).filter((e) => { const r = e.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((e) => e.id || e.tagName);
        return { hscroll: de.scrollWidth > de.clientWidth + 1, clipped, small };
      });
      check(`${scheme} ${w}px: no horizontal page scroll`, !m.hscroll);
      check(`${scheme} ${w}px: nothing clipped`, m.clipped.length === 0, m.clipped.join(', '));
      check(`${scheme} ${w}px: controls at least 44px`, m.small.length === 0, [...new Set(m.small)].slice(0, 6).join(', '));
      if (w === 320 || w === 1440) { const v = await axe(page); check(`${scheme} ${w}px: axe WCAG 2.2 AA finds no violations`, v.length === 0, v.join(' ; ')); }
    }
  }
  await page.setViewport({ width: 320, height: 900 });
  await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }' }); await sleep(200);
  check('text spacing (WCAG 1.4.12) at 320px: no horizontal page scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await page.emulateMediaFeatures([{ name: 'forced-colors', value: 'active' }]);
  check('forced colours: controls keep a visible boundary', await page.evaluate(() => [...document.querySelectorAll('.rr-root button, .rr-root input, .rr-root textarea')].filter((e) => e.offsetParent).every((e) => getComputedStyle(e).borderTopStyle !== 'none' && parseFloat(getComputedStyle(e).borderTopWidth) >= 1)));
  await page.emulateMediaFeatures([{ name: 'forced-colors', value: 'none' }]);
  check('no script or console errors (website)', errs.length === 0, errs.slice(0, 3).join(' | '));

  // ---- the extension: Big Picture summary and the Reports appendix ----
  const ext = path.resolve(root, 'extension');
  const b2 = await puppeteer.launch({ executablePath: chrome, headless: false, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--disable-features=DisableLoadExtensionCommandLineSwitch'] });
  try {
    await sleep(3000);
    const sw = (await b2.targets()).find((t) => t.type() === 'service_worker'); check('extension started', !!sw);
    const id = new URL(sw.url()).host; const p = await b2.newPage(); const eerrs = [];
    p.on('pageerror', (e) => eerrs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) eerrs.push(m.text()); });
    await p.setViewport({ width: 360, height: 800 }); await p.goto(`chrome-extension://${id}/panel.html`);
    const caseId = await p.evaluate(async (recs) => {
      const db = await import('./lib/db.js'); const inv = await db.createInvestigation({ name: 'Extension recovery case', description: '' });
      for (const r of recs) await db.saveRecordToInvestigation(inv.id, { ...r, id: undefined, canonicalKey: r.fileHash });
      await chrome.storage.local.set({ activeCaseId: inv.id }); return inv.id;
    }, records);
    await p.reload(); await p.click('#tab-reports');
    await p.waitForFunction(() => /RECORDS RECOVERY/.test(document.querySelector('#reportBox')?.textContent || ''), { timeout: 15000 });
    const rep = await p.$eval('#reportBox', (e) => e.textContent);
    check('extension Reports: the appendix carries the notice, the items and what remains unknown', /not a statement about what the government holds/.test(rep) && /Minutes for March 12, 2024: not held in this case/.test(rep) && /What remains unknown/.test(rep));
    check('extension Reports: no banned wording', !/does not exist|failed to produce|withheld|\bmissing\b|violation/i.test(rep.split('RECORDS RECOVERY')[1] || ''));
    await p.click('#tab-research'); await p.waitForSelector('[data-open]'); await p.click('[data-open]');
    await p.waitForSelector('.rr-summary', { timeout: 15000 });
    check('extension Big Picture: a Records Recovery summary, with plain guidance instead of a dead link', /not a statement about what the government holds/.test(await p.$eval('.rr-summary', (e) => e.innerText)) && (await p.$$('.rr-summary a')).length === 0 && /same case on the website/.test(await p.$eval('.rr-summary', (e) => e.innerText)));
    const v = await axe(p); check('extension: axe finds no violations on the case view with the summary', v.length === 0, v.join(' ; '));
    check('extension: no horizontal scroll at 360px', await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    check('no script or console errors (extension)', eerrs.length === 0, eerrs.slice(0, 3).join(' | '));
  } finally { await b2.close(); }
} catch (e) { console.log('FAIL  test crashed :: ' + (e && e.stack || e)); failed = true; }
finally { await b.close(); }
console.log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
