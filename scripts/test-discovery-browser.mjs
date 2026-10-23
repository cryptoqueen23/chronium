#!/usr/bin/env node
// Browser test for the Deep Discovery progress, coverage and status messaging:
// a harness page (served by the local test site, same origin) runs the real
// engine against that site in a real Chrome and renders the real UI pieces.
// Checks: live-region status updates, keyboard-only Pause / Resume / Cancel,
// accessible coverage and request-log tables, no horizontal page scroll, axe
// at 320 to 1280 px in both colour schemes, and focus visibility.
// Usage: node scripts/test-discovery-browser.mjs --chrome=<Chrome for Testing exe>
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startTestSite } from './lib/discovery-test-site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeArg = process.argv.find((a) => a.startsWith('--chrome='));
const chrome = chromeArg ? chromeArg.slice(9) : 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const AXE = fs.readFileSync(path.join(root, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failed = true; };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const axe = async (page) => { await page.evaluate(AXE); return page.evaluate((t) => axe.run(document, { runOnly: { type: 'tag', values: t } }).then((r) => r.violations.map((v) => `${v.id}[${v.nodes.length}]: ${v.nodes[0].target.join(' ')}`)), TAGS); };

const robots = 'User-agent: *\nCrawl-delay: 0.3\nDisallow: /private/\nDisallow: /search\nDisallow: /redirect-private\n';
const site = await startTestSite({ robots });
const b = await puppeteer.launch({ executablePath: chrome, headless: false, defaultViewport: null, args: ['--no-first-run', '--window-size=1280,900'] });
try {
  const page = await b.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${site.origin}/__harness`, { waitUntil: 'load' });

  const status = () => page.$eval('#dc-status', (e) => e.textContent);
  check('before a run: the status region says so and Pause and Cancel are disabled', /No run yet/.test(await status()) && await page.$eval('#dc-pause', (e) => e.disabled) && await page.$eval('#dc-cancel', (e) => e.disabled));
  check('the status text is in a polite live region', await page.$eval('#dc-status', (e) => e.getAttribute('role') === 'status' && e.getAttribute('aria-live') === 'polite'));
  check('the progress bar has a text label', await page.$eval('#dc-bar', (e) => !!document.querySelector(`label[for="${e.id}"]`)));

  // Keyboard only: focus Start, press Enter.
  await page.focus('#start');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Fetched \d+ of about/.test(document.querySelector('#dc-status').textContent), { timeout: 15000 });
  check('while running: the status updates in plain language', /Fetched \d+ of about \d+ pages; found \d+ document links?/.test(await status()), await status());
  check('while running: Pause and Cancel are enabled, Resume is not', await page.evaluate(() => !document.querySelector('#dc-pause').disabled && !document.querySelector('#dc-cancel').disabled && document.querySelector('#dc-resume').disabled));

  await page.focus('#dc-pause');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => /Paused/.test(document.querySelector('#dc-status').textContent), { timeout: 5000 });
  check('Pause (keyboard) announces "Paused" and enables Resume', await page.evaluate(() => !document.querySelector('#dc-resume').disabled && document.querySelector('#dc-pause').disabled));
  const before = site.log.length; await sleep(900);
  check('no request is made while paused', site.log.length === before, `${before} -> ${site.log.length}`);
  await page.focus('#dc-resume');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#results').hidden, { timeout: 30000 });
  const summary = await page.$eval('#summary', (e) => e.textContent);
  check('the run finishes and says what it found and that documents are not retrieved yet', /^Finished\./.test(summary) && /not retrieved yet/.test(summary), summary);
  check('after finishing: all three controls are disabled', await page.evaluate(() => ['pause', 'resume', 'cancel'].every((n) => document.querySelector(`#dc-${n}`).disabled)));

  const cov = await page.$eval('#coverage', (e) => e.innerText);
  check('the coverage table says where Chronium looked, in words', /Official website: 127\.0\.0\.1/.test(cov) && /(Searched|Partially searched)/.test(cov), cov.replace(/\s+/g, ' ').slice(0, 160));
  check('coverage table is a real table with caption, column and row headers', await page.evaluate(() => { const t = document.querySelector('#coverage table'); return !!t.querySelector('caption') && t.querySelectorAll('th[scope=col]').length === 3 && t.querySelectorAll('th[scope=row]').length >= 1; }));
  check('the legend explains that "not located" is not "does not exist"', /does not mean the record does not exist/.test(await page.$eval('#legend', (e) => e.textContent)));
  const ledgerText = await page.$eval('#ledger', (e) => e.innerText);
  check('the request log lists what was skipped and why', /robots-disallow/.test(ledgerText) && /Access restricted/.test(ledgerText));
  check('the request log is a keyboard-reachable scroll region', await page.$eval('#ledger', (e) => e.tabIndex === 0 && e.getAttribute('role') === 'region' && !!e.getAttribute('aria-label')));
  const paths = site.paths();
  check('the engine really obeyed robots.txt in the browser', !paths.includes('/private/secret.html') && !paths.includes('/redirect-private') && paths.filter((p) => p === '/robots.txt').length === 1);

  // Cancel via keyboard on a second run.
  await page.reload({ waitUntil: 'load' });
  await page.focus('#start'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Fetched \d+ of about/.test(document.querySelector('#dc-status').textContent), { timeout: 15000 });
  await page.focus('#dc-cancel'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#results').hidden, { timeout: 15000 });
  const cs = await page.$eval('#summary', (e) => e.textContent);
  check('Cancel (keyboard) ends the run and says the search is incomplete', /^Cancelled\./.test(cs) && /incomplete/.test(cs), cs);

  // Focus visibility, then axe in both colour schemes at the required widths.
  await page.focus('#start');
  const ring = await page.$eval('#start', (e) => { const c = getComputedStyle(e); return parseFloat(c.outlineWidth) >= 2 && c.outlineStyle !== 'none'; });
  check('the focused control shows a visible focus ring', ring);
  for (const scheme of ['dark', 'light']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    for (const w of [320, 375, 768, 1280]) {
      await page.setViewport({ width: w, height: 900 });
      await sleep(150);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const v = await axe(page);
      check(`${scheme} @${w}px: no horizontal page scroll and no axe violations`, over <= 1 && v.length === 0, `overflow=${over} ${v.join(' | ')}`);
    }
  }
  check('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('test ran without throwing', false, e.stack || e.message);
} finally {
  await b.close(); await site.close();
}
process.exit(failed ? 1 : 0);
