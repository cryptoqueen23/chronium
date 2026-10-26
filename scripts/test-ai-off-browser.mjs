#!/usr/bin/env node
// Real-Chrome test of the "paid AI switched off" release, run against a LOCAL copy of the package (never the live site: it presses the
// live page's real "Run AI analysis" button, which would call the paid route if that route were still on):
//   cd .release/ai-off-package && node ..\..\node_modules\wrangler\bin\wrangler.js dev --port 8794
//   node scripts/test-ai-off-browser.mjs --base=http://127.0.0.1:8794 --chrome=<Chrome for Testing exe> [--expect=off|on]
// It uses the page's OWN production code (database version 4) in a throwaway Chrome profile and proves, in a real browser, that with
// the AI routes switched off: the database stays at version 4 through loading, navigating, pressing the AI button and reloading; the
// saved case and evidence are untouched; the button fails politely; no newer front-end file is ever requested; nothing leaves the page's
// own origin. `--expect=on` runs the same steps against the unpatched production package as a control (locally it has no key, so it
// cannot reach any AI provider: the call fails inside the Worker before any network request).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const base = arg('base', '').replace(/\/$/, '');
const expectState = arg('expect', 'off');
const chrome = arg('chrome', 'C:/Users/insur/.cache/puppeteer/chrome/win64-152.0.7977.75/chrome-win64/chrome.exe');
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) { console.error('This test only runs against a local server (http://127.0.0.1:<port>), never a public site.'); process.exit(2); }
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failed = true; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-off-'));
const b = await puppeteer.launch({ executablePath: chrome, headless: false, userDataDir: profile, args: ['--no-first-run', '--no-default-browser-check'] });
try {
  const page = await b.newPage();
  const requests = []; const errors = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
  page.on('pageerror', (e) => errors.push(e.message));
  const responses = []; page.on('response', (r) => responses.push({ url: r.url(), status: r.status() }));
  page.on('dialog', (d) => d.accept());
  const dbVersion = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('chronium'); r.onupgradeneeded = () => { r.transaction.abort(); res(0); }; r.onsuccess = () => { const v = r.result.version; r.result.close(); res(v); }; r.onerror = () => res(-1); }));

  await page.goto(`${base}/#/investigations`); await page.waitForSelector('#allInvestigationsList');
  // The page's own code (production's db.js) creates the saved research, exactly as a visitor's browser would.
  const seeded = await page.evaluate(async () => {
    const db = await import('/db.js');
    const inv = await db.createInvestigation({ name: 'My saved research', description: '' });
    const rec = await db.saveRecordToInvestigation(inv.id, { title: 'Council minutes', originalUrl: 'https://example.org/minutes.pdf', source: 'Wayback' });
    await db.createEvidenceItem(inv.id, { sourceRecordId: rec.id, excerptType: 'quote', excerptText: 'The motion carried 5 to 2.', location: 'p.2' });
    await db.createEvidenceItem(inv.id, { sourceRecordId: rec.id, excerptType: 'quote', excerptText: 'Payne moved to approve.', location: 'p.3' });
    return inv.id;
  });
  check('setup: the page\'s own code created a case in a version-4 database', (await dbVersion()) === 4, String(await dbVersion()));

  await page.reload(); await page.waitForSelector('[data-open-investigation]');
  check('after a reload the database is still version 4', (await dbVersion()) === 4);
  await page.evaluate((id) => document.querySelector(`[data-open-investigation="${id}"]`).click(), seeded);
  await page.waitForSelector('#workspaceTitle');
  await page.evaluate(() => { location.hash = '#/workspace/analysis'; });
  await page.waitForSelector('#runQualAnalysisBtn', { visible: true });
  await page.waitForFunction(() => !document.querySelector('#runQualAnalysisBtn').disabled, { timeout: 8000 });
  check('the Analysis tab opens and the AI button is enabled (two evidence items)', true);

  responses.length = 0;
  await page.click('#runQualAnalysisBtn');
  await page.waitForFunction(() => /not-available|temporarily unavailable|Analysis failed/i.test(document.querySelector('#qualAnalysisStatus')?.textContent || ''), { timeout: 10000 });
  const status = await page.$eval('#qualAnalysisStatus', (e) => e.textContent);
  const post = responses.find((r) => r.url.endsWith('/api/analyze/qualitative'));
  if (expectState === 'off') {
    check('the AI call is answered 404 (switched off) and the page says so plainly', post?.status === 404 && /not-available/.test(status), `${post?.status} "${status}"`);
  } else {
    check('control (switch not applied): the unpatched Worker answers (here 502: no key exists locally, so no provider is reached)', post?.status === 502, `${post?.status} "${status}"`);
  }
  check('the page is still alive after the failed call (button usable, no uncaught error)', await page.$eval('#runQualAnalysisBtn', (e) => !e.disabled) && errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.evaluate(() => { location.hash = '#/investigations'; }); await page.waitForSelector('[data-open-investigation]');
  await page.evaluate(() => { location.hash = '#/workspace/evidence'; }); await sleep(500);
  await page.reload(); await page.waitForSelector('#workspaceTitle'); // a reload keeps the page on the workspace route
  await page.evaluate(() => { location.hash = '#/investigations'; }); await page.waitForSelector('[data-open-investigation]');

  check('after pressing the AI button, navigating and reloading, the database is STILL version 4', (await dbVersion()) === 4, String(await dbVersion()));
  const after = await page.evaluate(async (id) => { const db = await import('/db.js'); return { cases: (await db.listInvestigations()).map((c) => c.name), evidence: (await db.listEvidenceItems(id)).length, sources: (await db.listInvestigationRecords(id)).length }; }, seeded);
  check('the saved case, its source and both evidence passages are untouched', after.cases.length === 1 && after.cases[0] === 'My saved research' && after.evidence === 2 && after.sources === 1, JSON.stringify(after));
  const urls = requests.map((r) => r.url);
  check('no newer front-end file was ever requested (boot.js, upgrade.js)', !urls.some((u) => /\/(boot|upgrade)\.js/.test(u)));
  check('every request stayed on the site\'s own origin', urls.every((u) => u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')), urls.filter((u) => !u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')).slice(0, 3).join(', '));
  check('the only API requests the page made were the AI call (and nothing that could reach another service)', requests.filter((r) => r.url.includes('/api/')).every((r) => r.url.endsWith('/api/analyze/qualitative') && r.method === 'POST'), requests.filter((r) => r.url.includes('/api/')).map((r) => r.method + ' ' + r.url.replace(base, '')).join(', '));
} catch (e) {
  check('test ran without throwing', false, e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
}
await b.close();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); } catch { /* temp folder, harmless */ }
console.log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
