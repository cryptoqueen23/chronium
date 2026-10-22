#!/usr/bin/env node
// Smoke test for the Chromium side-panel extension (extension/).
// Loads it into a real Chrome, points it at a running `wrangler dev`, creates
// a case, runs a search, saves a result, builds the report, and checks for
// console errors and horizontal scroll at 320px.
// Usage: wrangler dev (port 8787) in another terminal, then
//   node scripts/test-extension.mjs [--chrome="C:/Program Files/Google/Chrome/Application/chrome.exe"]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const chromeArg = process.argv.find((a) => a.startsWith('--chrome='));
const chrome = chromeArg ? chromeArg.slice(9) : 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: chrome, headless: false, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--disable-features=DisableLoadExtensionCommandLineSwitch'] });
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failed = true; };
try {
  await sleep(3000);
  const sw = (await b.targets()).find((t) => t.type() === 'service_worker');
  check('extension service worker started', !!sw);
  const id = new URL(sw.url()).host;
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('dialog', (d) => d.accept());
  await p.setViewport({ width: 320, height: 700 });
  await p.goto(`chrome-extension://${id}/panel.html`);
  await p.evaluate(() => chrome.storage.local.set({ workerUrl: 'http://127.0.0.1:8787' }));
  await p.reload();

  const tabNames = await p.$$eval('[role=tab]', (t) => t.map((x) => x.textContent.trim()));
  check('four primary areas', tabNames.join('|') === 'Search|Compare|My Research|Reports', tabNames.join('|'));

  await p.click('#tab-research');
  await p.type('#newCaseName', 'Smoke test case');
  await p.click('#newCaseForm button');
  await sleep(600);
  check('case created', /Smoke test case/.test(await p.$eval('#caseList', (e) => e.innerText)));

  await p.click('#tab-search');
  await p.type('#q', 'copperas cove');
  await p.click('#searchForm button');
  await p.waitForFunction(() => /result|Could not/.test(document.querySelector('#status').textContent), { timeout: 60000 });
  const status = await p.$eval('#status', (e) => e.textContent);
  check('search completed against Worker', /result/.test(status), status);
  const statusBox = await p.$eval('#searchStatus', (e) => e.textContent);
  check('search status lists sources and the coverage caveat', /not the whole internet/.test(statusBox), statusBox.split('\n')[0]);

  const cards = await p.$$eval('#results article', (a) => a.length);
  if (cards) {
    await p.click('#results [data-save]');
    await sleep(600);
    check('result saved to case', (await p.$eval('#results [data-save]', (e) => e.textContent)) === 'Saved');
    await p.click('#tab-reports');
    await sleep(600);
    check('report lists saved source', /Original:/.test(await p.$eval('#reportBox', (e) => e.innerText)));
  } else {
    console.log('INFO  no result cards returned (sources may be unreachable from this machine); save/report not exercised');
  }
  check('no horizontal scroll at 320px', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  check('no console/page errors', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('test ran without throwing', false, e.message);
} finally {
  await b.close();
}
process.exit(failed ? 1 : 0);
