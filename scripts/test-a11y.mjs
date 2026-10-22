#!/usr/bin/env node
// Automated accessibility + responsiveness sweep (axe-core, WCAG 2.0/2.1/2.2 A+AA
// rules) over the website and the extension side panel at the widths in
// docs/CANON.md "Accessibility & Responsive Standard". Also fails on any
// horizontal page scroll. THIS IS NOT A CONFORMANCE CLAIM: automated rules
// catch only a fraction of WCAG issues; keyboard-only, screen-reader (NVDA /
// VoiceOver), zoom and touch checks are manual (see docs/ACCESSIBILITY.md).
// Usage: wrangler dev on :8787, then
//   node scripts/test-a11y.mjs --chrome=<Chrome for Testing exe>
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeArg = process.argv.find((a) => a.startsWith('--chrome='));
const chrome = chromeArg ? chromeArg.slice(9) : 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ext = path.join(root, 'extension');
const BASE = 'http://127.0.0.1:8787';
const AXE = fs.readFileSync(path.join(root, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const WIDTHS = [320, 375, 430, 768, 1024, 1280, 1920];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

let failures = 0;
const seen = new Map(); // rule -> {impact, help, nodes:Set, where:Set}

async function audit(page, label, width) {
  await page.setViewport({ width, height: 800 });
  await sleep(250);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) { failures++; console.log(`FAIL  ${label} @${width}px: horizontal scroll (${overflow}px)`); }
  await page.evaluate(AXE);
  const res = await page.evaluate((tags) => axe.run(document, { runOnly: { type: 'tag', values: tags } }).then((r) => r.violations.map((v) => ({
    id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 4)
  }))), TAGS);
  for (const v of res) {
    failures++;
    const e = seen.get(v.id) || { impact: v.impact, help: v.help, where: new Set(), nodes: new Set() };
    e.where.add(`${label}@${width}`); v.nodes.forEach((n) => e.nodes.add(n));
    seen.set(v.id, e);
  }
  if (!res.length && overflow <= 1) console.log(`PASS  ${label} @${width}px`);
}

const b = await puppeteer.launch({
  executablePath: chrome, headless: false, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--disable-features=DisableLoadExtensionCommandLineSwitch']
});
try {
  await sleep(3000);
  const sw = (await b.targets()).find((t) => t.type() === 'service_worker');
  const extId = new URL(sw.url()).host;

  // ---- website ----
  const web = await b.newPage();
  for (const [route, label] of [['#/', 'web home'], ['#/investigations', 'web investigations'], ['#/settings', 'web settings']]) {
    await web.goto(`${BASE}/${route}`, { waitUntil: 'networkidle2' });
    for (const w of WIDTHS) await audit(web, label, w);
  }

  // ---- extension side panel ----
  const panel = await b.newPage();
  await panel.goto(`chrome-extension://${extId}/panel.html`);
  await panel.evaluate(() => chrome.storage.local.set({ workerUrl: 'http://127.0.0.1:8787' }));
  await panel.reload();
  await panel.click('#tab-research');
  await panel.type('#newCaseName', 'Accessibility check');
  await panel.click('#newCaseForm button');
  await sleep(500);
  await panel.click('#tab-search');
  await panel.type('#q', 'copperas cove');
  await panel.click('#searchForm button');
  await panel.waitForFunction(() => /result|Could not/.test(document.querySelector('#status').textContent), { timeout: 60000 });
  for (const w of WIDTHS.filter((x) => x <= 768)) await audit(panel, 'panel search results', w);
  for (const [tab, label] of [['#tab-compare', 'panel compare'], ['#tab-research', 'panel my research'], ['#tab-reports', 'panel reports']]) {
    await panel.click(tab);
    await sleep(400);
    for (const w of WIDTHS.filter((x) => x <= 768)) await audit(panel, label, w);
  }
} finally {
  await b.close();
}

console.log('\n==== axe violations (unique) ====');
for (const [id, e] of seen) {
  console.log(`[${e.impact}] ${id}: ${e.help}\n    where: ${[...e.where].slice(0, 6).join(', ')}${e.where.size > 6 ? ' ...' : ''}\n    e.g.: ${[...e.nodes].slice(0, 3).join(' | ')}`);
}
console.log(failures ? `\n${failures} failing check(s).` : '\nNo automated violations found. (Manual keyboard / screen reader / zoom checks are still required.)');
process.exit(failures ? 1 : 0);
