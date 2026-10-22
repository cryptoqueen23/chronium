#!/usr/bin/env node
// Takes the review screenshots for the investigation views (real pages, real
// browser; no mockups): website and extension, dark and light, a case with
// findings and a case with sources but no findings (empty state), the
// Missing / Not reviewed / Unresolved section, Overview, and Deep Dive.
// Usage: wrangler dev on :8787, then
//   node scripts/screenshots-views.mjs --chrome=<Chrome for Testing exe> --out=<dir>
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILD } from './lib/case-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const chrome = arg('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const out = arg('out', path.join(root, 'docs', 'screenshots'));
fs.mkdirSync(out, { recursive: true });
const ext = path.join(root, 'extension');
const BASE = 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const saved = [];

const BUILD_SOURCES_ONLY = async (dbPath, name) => {
  const db = await import(dbPath);
  const inv = await db.createInvestigation({ name, description: 'Documents imported, nothing concluded yet' });
  await db.saveRecordToInvestigation(inv.id, { title: 'council-agenda-2024-03-26.txt', originalUrl: 'https://example.gov/agenda', extractedText: 'Council agenda. Item 7: LFEDC grant, Ordinance 2024-31.' });
  await db.saveRecordToInvestigation(inv.id, { title: 'budget-2024.csv', originalUrl: 'https://example.gov/budget', extractedText: 'Fund,Amount\nRiverwalk,$412000' });
  return inv.id;
};

const b = await puppeteer.launch({
  executablePath: chrome, headless: false, defaultViewport: null, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--window-size=1400,1000', '--disable-features=DisableLoadExtensionCommandLineSwitch']
});
const shot = async (page, name, opts = {}) => { await sleep(300); const p = path.join(out, name); await page.screenshot({ path: p, ...opts }); saved.push(name); };
try {
  await sleep(3000);
  const extId = new URL((await b.targets()).find((t) => t.type() === 'service_worker').url()).host;

  const web = await b.newPage();
  await web.setViewport({ width: 1280, height: 900 });
  await web.goto(`${BASE}/#/investigations`, { waitUntil: 'networkidle2' });
  await web.evaluate(BUILD, '/db.js', 'Grant review');
  const emptyId = await web.evaluate(BUILD_SOURCES_ONLY, '/db.js', 'Sources only (no findings yet)');
  const open = async (name) => {
    await web.evaluate(() => { location.hash = '#/settings'; }); await sleep(250);
    await web.evaluate(() => { location.hash = '#/investigations'; });
    await web.waitForSelector('[data-open-investigation]');
    await web.evaluate((n) => [...document.querySelectorAll('[data-open-investigation]')].find((a) => a.textContent.trim() === n).click(), name);
    await web.waitForSelector('#tab-bigpicture');
    await sleep(500);
  };
  const go = async (route) => { await web.evaluate((r) => { location.hash = r; }, route); await sleep(600); };

  for (const theme of ['dark', 'light']) {
    await web.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await web.setViewport({ width: 1280, height: 900 });
    await open('Grant review');
    // Landing (opening an investigation) is Big Picture.
    await shot(web, `site-landing-bigpicture-${theme}-1280.png`);
    await web.evaluate(() => document.querySelector('#vw-open').scrollIntoView({ block: 'start' }));
    await shot(web, `site-missing-notreviewed-unresolved-${theme}-1280.png`);
    await go('#/workspace/overview');
    await shot(web, `site-overview-${theme}-1280.png`);
    await web.setViewport({ width: 375, height: 800 });
    await go('#/workspace/bigpicture');
    await shot(web, `site-bigpicture-${theme}-375.png`);
    await go('#/workspace/overview');
    await shot(web, `site-overview-${theme}-375.png`);
  }
  await web.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await web.setViewport({ width: 1280, height: 900 });
  await open('Sources only (no findings yet)');
  await shot(web, 'site-empty-state-no-findings-dark-1280.png');
  await open('Grant review');
  await go('#/workspace/deepdive');
  await web.evaluate(() => document.querySelectorAll('#viewBody-deepdive .vw-details').forEach((d) => { d.open = true; }));
  await shot(web, 'site-deepdive-sections-open-dark-1280.png', { fullPage: false });

  const panel = await b.newPage();
  await panel.setViewport({ width: 375, height: 900 });
  await panel.goto(`chrome-extension://${extId}/panel.html`);
  await panel.evaluate(BUILD, './lib/db.js', 'Grant review');
  await panel.evaluate(BUILD_SOURCES_ONLY, './lib/db.js', 'Sources only (no findings yet)');
  await panel.reload();
  await panel.bringToFront();
  const pOpen = async (name) => {
    await panel.click('#tab-research'); await sleep(300);
    await panel.evaluate((n) => { const li = [...document.querySelectorAll('#caseList li')].find((x) => x.textContent.includes(n)); li.querySelector('[data-open]').click(); }, name);
    await panel.waitForSelector('#vpanel .vw-section'); await sleep(400);
  };
  for (const theme of ['dark', 'light']) {
    await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await pOpen('Grant review');
    await panel.evaluate(() => document.querySelector('#caseDetail').scrollIntoView());
    await shot(panel, `panel-bigpicture-${theme}-375.png`);
    await panel.evaluate(() => document.querySelector('#vw-open').scrollIntoView({ block: 'start' }));
    await shot(panel, `panel-missing-notreviewed-unresolved-${theme}-375.png`);
    await panel.click('#vt-overview'); await sleep(300);
    await panel.evaluate(() => document.querySelector('#caseDetail').scrollIntoView());
    await shot(panel, `panel-overview-${theme}-375.png`);
  }
  await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await pOpen('Sources only');
  await panel.evaluate(() => document.querySelector('#caseDetail').scrollIntoView());
  await shot(panel, 'panel-empty-state-no-findings-dark-375.png');
  await pOpen('Grant review');
  await panel.evaluate(() => { const a = document.querySelector('#vpanel .how-link'); a.click(); });
  await panel.waitForSelector('#howWeKnow'); await sleep(300);
  await shot(panel, 'panel-how-do-we-know-dark-375.png');
} finally {
  await b.close();
}
console.log(saved.length + ' screenshots written to ' + out + ':\n' + saved.join('\n'));
