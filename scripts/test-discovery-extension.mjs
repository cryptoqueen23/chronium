#!/usr/bin/env node
// Extension test for Deep Discovery in the side panel (real Chrome for Testing).
// Runs the "Find public records" screen against the local test site, through the browser's own network stack:
//   - requests carry the identifying User-Agent (declarativeNetRequest header rule),
//   - a redirect to a loopback address is blocked by the network rule even when that address is permitted,
//   - documents are saved into the case, the coverage report is shown, layout holds at 320 px, axe is clean.
// The test site is reached as http://testsite.example/ (Chrome maps that name to the local site), because the
// engine rightly refuses IP addresses and odd ports. The extension is copied to a temp folder with two changes
// for the test only: host permissions for the test site (the real extension asks the person per site) and a
// shorter politeness delay.
// Needs the Worker for archive lookups:  npx wrangler dev --port 8791
// Usage: node scripts/test-discovery-extension.mjs [--chrome=<Chrome for Testing exe>] [--worker=http://127.0.0.1:8791]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startTestSite } from './lib/discovery-test-site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const chrome = arg('chrome', 'C:/Users/insur/.cache/puppeteer/chrome/win64-152.0.7977.75/chrome-win64/chrome.exe');
const worker = arg('worker', 'http://127.0.0.1:8791');
const AXE = fs.readFileSync(path.join(root, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failed = true; };

const PORT = 8790;
const site = await startTestSite({ robots: 'User-agent: *\nDisallow: /private/\nDisallow: /search\n', port: PORT });

// Test copy of the extension.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chronium-ext-'));
fs.cpSync(path.join(root, 'extension'), tmp, { recursive: true });
const mf = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8'));
mf.host_permissions.push('http://testsite.example/*', 'http://127.0.0.1/*');
fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(mf, null, 2));
let panelJs = fs.readFileSync(path.join(tmp, 'panel.js'), 'utf8');
if (!panelJs.includes("mode: 'extension',")) throw new Error('panel.js changed shape; update this test');
panelJs = panelJs.replace("mode: 'extension',", "mode: 'extension', limits: { minDelayMs: 150, requestTimeoutMs: 3000, maxRunsPerDay: 10 },");
fs.writeFileSync(path.join(tmp, 'panel.js'), panelJs);
// The test Worker listens on 8791 instead of the usual local development port 8787: allow that one port in the test copy.
let netJs = fs.readFileSync(path.join(tmp, 'network.js'), 'utf8');
if (!netJs.includes(':8787/')) throw new Error('network.js changed shape; update this test');
fs.writeFileSync(path.join(tmp, 'network.js'), netJs.replace(':8787/', ':8791/'));

const b = await puppeteer.launch({
  executablePath: chrome, headless: false, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${tmp}`, `--load-extension=${tmp}`, '--no-first-run', '--disable-features=DisableLoadExtensionCommandLineSwitch', `--host-resolver-rules=MAP testsite.example:80 127.0.0.1:${PORT}`]
});
try {
  await sleep(3000);
  const sw = (await b.targets()).find((t) => t.type() === 'service_worker');
  check('extension service worker started', !!sw);
  const id = new URL(sw.url()).host;
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); // failed-load lines are the fixture's deliberate 404, 403 and 500 documents
    if (m.type() === 'warning' && /Chronium:/.test(m.text())) errs.push(m.text()); });
  await p.setViewport({ width: 360, height: 800 });
  // Archive lookups are answered by a stub: tests never send their fixture addresses to a real archive.
  await p.setRequestInterception(true);
  p.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(worker + '/api/captures')) {
      const target = new URL(u).searchParams.get('url') || '';
      const found = /missing\.pdf$/.test(target);
      r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(found ? { status: 'found', copies: [{ provider: 'Wayback Machine (stub)', archiveUrl: 'https://web.archive.org/web/20230101000000/' + target, captureDate: '2023-01-01T00:00:00Z' }], checked: [] } : { status: 'none', copies: [], checked: [] }) });
    } else r.continue();
  });
  await p.goto(`chrome-extension://${id}/panel.html`);
  await p.evaluate((w) => chrome.storage.local.set({ workerUrl: w }), worker);
  await p.reload();
  await p.click('#tab-research');
  await p.type('#newCaseName', 'Extension discovery case');
  await p.click('#newCaseForm button');
  await p.waitForFunction(() => /Extension discovery case/.test(document.querySelector('#caseList')?.textContent || ''));
  await p.waitForSelector('#dc-url');
  check('the screen is in My Research, after the case list', await p.evaluate(() => document.querySelector('#view-research #discoveryMount .dc-root') !== null));
  check('the panel still has exactly four main areas', (await p.$$eval('[role=tab]', (t) => t.length)) === 4);
  check('it names the case', /Extension discovery case/.test(await p.$eval('#dc-case', (e) => e.textContent)));

  // dynamic rules installed on first use
  await p.type('#dc-url', 'http://testsite.example/library');
  await p.click('#dc-ack');
  const siteAtStart = site.log.length;
  await p.focus('#dc-start'); await p.keyboard.press('Enter');
  await p.waitForFunction(() => /Retrieving documents|Fetched \d+ of about/.test(document.querySelector('#dc-p-status')?.textContent || ''), { timeout: 30000 });
  await p.focus('#dc-p-pause'); await p.keyboard.press('Space');
  await p.waitForFunction(() => /Paused/.test(document.querySelector('#dc-p-status').textContent), { timeout: 5000 });
  const n0 = site.log.length; await sleep(800);
  check('Pause: nothing is requested while paused', site.log.length === n0);
  await p.focus('#dc-p-resume'); await p.keyboard.press('Enter');
  await p.waitForSelector('.dc-report #dc-report-h', { timeout: 120000 });
  const mine = site.log.slice(siteAtStart);
  console.log(`MEASURED  requests the site received from the extension: ${mine.length}; Worker requests: archive lookups only (no /api/fetch in extension mode)`);
  check('requests reached the site by its public-looking name', mine.every((l) => l.host === 'testsite.example'), [...new Set(mine.map((l) => l.host))].join(','));
  check('every request carried the Chronium User-Agent (header rule works)', mine.length > 5 && mine.every((l) => /^ChroniumMind\//.test(l.ua)), [...new Set(mine.map((l) => l.ua))].join(' | ').slice(0, 140));
  check('a redirect to a loopback address was blocked by the network rule (nothing arrived)', !mine.some((l) => l.host.startsWith('127.0.0.1')), mine.filter((l) => l.host.startsWith('127.0.0.1')).map((l) => l.path).join(','));
  check('the robots-disallowed document was never requested', !mine.some((l) => l.path.startsWith('/private/')));
  const report = await p.$eval('.dc-report', (e) => e.innerText);
  check('the coverage report is shown with its unknowns', /fully searched of/.test(report) && /What remains unknown/.test(report));
  const loop = await p.evaluate(() => [...document.querySelectorAll('.dc-report tr')].map((r) => r.innerText).find((t) => /redirect-local/.test(t)) || '');
  check('the blocked redirect is reported as not retrieved, in words', /Access restricted|Search incomplete|Source unavailable/.test(loop) || loop === '', loop.replace(/\s+/g, ' ').slice(0, 160));
  const saved = await p.evaluate(async () => { const db = await import('./lib/db.js'); const cases = await db.listInvestigations(); const recs = await db.listInvestigationRecords(cases[0].id); return { n: recs.length, discovered: recs.filter((r) => r.origin === 'deep-discovery').length, hashed: recs.filter((r) => r.discovery?.sha256).length, text: recs.filter((r) => r.extractedText).length }; });
  console.log('SAVED', JSON.stringify(saved));
  check('documents were saved into the case', saved.discovered >= 5 && saved.hashed >= 5, JSON.stringify(saved));
  check('plain-text documents have their text; others say it was not extracted', saved.text >= 1);

  for (const scheme of ['dark', 'light']) {
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    for (const w of [320, 360, 480]) {
      await p.setViewport({ width: w, height: 800 }); await sleep(150);
      const m = await p.evaluate(() => {
        const de = document.documentElement; const root = document.querySelector('.dc-root');
        const small = [...root.querySelectorAll('button, input[type=url], summary')].filter((e) => e.offsetParent).filter((e) => { const r = e.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((e) => e.id || e.tagName);
        return { hscroll: de.scrollWidth > de.clientWidth + 1, small };
      });
      check(`${scheme} ${w}px: no horizontal scroll`, !m.hscroll);
      check(`${scheme} ${w}px: 44px touch targets`, m.small.length === 0, m.small.join(','));
    }
    await p.setViewport({ width: 320, height: 800 });
    await p.evaluate(AXE);
    const v = await p.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }).then((r) => r.violations.map((x) => `${x.id}[${x.nodes.length}]: ${x.nodes[0].target.join(' ')}`)));
    check(`${scheme}: axe WCAG 2.2 AA finds no violations in the panel`, v.length === 0, v.join(' ; '));
  }
  check('no script or console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) { console.log('FAIL  test crashed :: ' + (e && e.stack || e)); failed = true; }
finally { await b.close(); await site.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
