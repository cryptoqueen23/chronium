#!/usr/bin/env node
// Ask Chronium end to end in a real browser, on BOTH the website and the
// extension side panel: keyboard-only asking, answers with cited sources, a
// clarification the user answers with the keyboard, no horizontal scroll at
// 320px, and an axe-core pass over the rendered answer.
// Usage: wrangler dev on :8787, then
//   node scripts/test-ask-browser.mjs --chrome=<Chrome for Testing exe>
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeArg = process.argv.find((a) => a.startsWith('--chrome='));
const chrome = chromeArg ? chromeArg.slice(9) : 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ext = path.join(root, 'extension');
const AXE = fs.readFileSync(path.join(root, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const BASE = 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failed = true; };

// A small case with: two claims (one contradicted), an evidence-backed
// relationship, two votes, dated related documents, and a payment.
const BUILD = async (dbPath, name) => {
  const db = await import(dbPath);
  const inv = await db.createInvestigation({ name, description: '' });
  const mk = (title, text) => db.saveRecordToInvestigation(inv.id, { title, originalUrl: `https://example.gov/${title}`, extractedText: text, sourceId: null });
  const minutes1 = await mk('minutes-2024-03-12.txt', 'LFEDC Board\nMotion by Smith, seconded by Lee, to approve Ordinance 2024-31 and a grant of $412,000 to Holt Construction LLC. Voted 4-1.');
  const minutes2 = await mk('minutes-2024-05-14.txt', 'LFEDC Board\nMotion to amend the budget, seconded. Voted 5-0.');
  await mk('memo-2024-02-01.txt', 'Staff memo recommends Ordinance 2024-31 at $400,000.');
  await mk('invoice-2024-04-20.txt', 'Invoice referencing Ordinance 2024-31. Amount due: $412,000 to Holt Construction LLC.');
  const e1 = await db.createEvidenceItem(inv.id, { sourceRecordId: minutes1.id, excerptType: 'quote', excerptText: 'Voted 4-1.', location: 'p.1' });
  const a = await db.createEntity(inv.id, { type: 'PERSON', name: 'Raymond Payne' });
  const o = await db.createEntity(inv.id, { type: 'ORGANIZATION', name: 'LFEDC' });
  await db.createRelationship(inv.id, { sourceEntityId: a.id, targetEntityId: o.id, type: 'BOARD_MEMBER_OF', evidenceIds: [e1.id] });
  const claim = await db.createClaim(inv.id, { text: 'The grant vote was unanimous.', subjectEntityIds: [] });
  await db.createClaimEvidence(inv.id, { claimId: claim.id, evidenceId: e1.id, stance: 'contradicts' });
  return inv.id;
};

const ASK = async (page, inputSel, q) => {
  await page.focus(inputSel);
  await page.evaluate((s) => { document.querySelector(s).value = ''; }, inputSel);
  await page.keyboard.type(q);
  await page.keyboard.press('Enter'); // keyboard only: no mouse click on the Ask button
};
const axeViolations = async (page) => {
  await page.evaluate(AXE);
  return page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }).then((r) => r.violations.map((v) => `${v.id}: ${v.nodes[0].target.join(' ')}`)));
};

const b = await puppeteer.launch({
  executablePath: chrome, headless: false, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--disable-features=DisableLoadExtensionCommandLineSwitch']
});
try {
  await sleep(3000);
  const sw = (await b.targets()).find((t) => t.type() === 'service_worker');
  const extId = new URL(sw.url()).host;

  // ================= extension =================
  const panel = await b.newPage();
  const errs = [];
  panel.on('pageerror', (e) => errs.push('ext: ' + e.message));
  await panel.setViewport({ width: 320, height: 800 });
  await panel.goto(`chrome-extension://${extId}/panel.html`);
  await panel.evaluate(BUILD, './lib/db.js', 'Ask test case');
  await panel.reload();
  await panel.click('#tab-research');
  await panel.waitForSelector('#askQ');
  const out = () => panel.$eval('#askOut', (e) => e.innerText);

  await ASK(panel, '#askQ', 'Which claims have contradictory evidence?');
  await panel.waitForFunction(() => /contradicting evidence/i.test(document.querySelector('#askOut').innerText), { timeout: 10000 });
  let text = await out();
  check('extension: contradicted claim listed with its source', /The grant vote was unanimous/.test(text) && /minutes-2024-03-12/.test(text) && /Voted 4-1/.test(text));
  check('extension: answer is labelled with a fact state', /Documented fact/.test(text));
  check('extension: focus moves to the answer for screen readers', await panel.evaluate(() => document.activeElement.id === 'askOut'));

  await ASK(panel, '#askQ', 'What changed before and after this vote?');
  await panel.waitForFunction(() => /Which vote do you mean/i.test(document.querySelector('#askOut').innerText), { timeout: 10000 });
  check('extension: ambiguous vote asks for clarification instead of guessing', /Needs clarification/.test(await out()) && (await panel.$$('#askOut [data-ask-followup]')).length === 2);
  // Answer the clarification with the keyboard only.
  await panel.focus('#askOut [data-ask-followup]');
  await panel.keyboard.press('Enter');
  await panel.waitForFunction(() => /related documents before and after/i.test(document.querySelector('#askOut').innerText), { timeout: 10000 });
  text = await out();
  check('extension: chosen vote gives a dated before/after list', /memo-2024-02-01/.test(text) && /invoice-2024-04-20/.test(text) && /does not conclude that the vote caused/.test(text));

  await ASK(panel, '#askQ', 'Show me all payments involving Acme Roofing.');
  await panel.waitForFunction(() => /No payment amounts located/i.test(document.querySelector('#askOut').innerText), { timeout: 10000 });
  text = await out();
  check('extension: no evidence says what is not established', /No evidence located/.test(text) && /does not show that no payment was made/.test(text));

  await ASK(panel, '#askQ', 'Show me every record mentioning Holt Construction.');
  await panel.waitForFunction(() => /mention this/i.test(document.querySelector('#askOut').innerText), { timeout: 10000 });
  check('extension: plain document search still works', /minutes-2024-03-12/.test(await out()));

  check('extension: no horizontal scroll at 320px with an answer shown', !(await panel.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  const v1 = await axeViolations(panel);
  check('extension: axe finds no WCAG A/AA violations in the Ask view', v1.length === 0, v1.join(' | '));

  // ================= website =================
  const web = await b.newPage();
  web.on('pageerror', (e) => errs.push('web: ' + e.message));
  await web.setViewport({ width: 320, height: 800 });
  await web.goto(`${BASE}/#/investigations`, { waitUntil: 'networkidle2' });
  await web.evaluate(BUILD, '/db.js', 'Ask test case');
  await web.evaluate(() => { location.hash = '#/settings'; });
  await sleep(300);
  await web.evaluate(() => { location.hash = '#/investigations'; });
  await web.waitForSelector('[data-open-investigation]');
  await web.evaluate(() => document.querySelector('[data-open-investigation]').click());
  await web.waitForSelector('#investigationQuery', { visible: true });
  const wout = () => web.$eval('#askRouterBox', (e) => e.innerText);

  await ASK(web, '#investigationQuery', 'Which claims have contradictory evidence?');
  await web.waitForFunction(() => /contradicting evidence/i.test(document.querySelector('#askRouterBox')?.innerText || ''), { timeout: 15000 });
  check('website: contradicted claim answered from the case', /Documented fact/.test(await wout()) && /The grant vote was unanimous/.test(await web.$eval('#investigationSearchResults', (e) => e.innerText)));

  await ASK(web, '#investigationQuery', 'What changed before and after this vote?');
  await web.waitForFunction(() => /Which vote do you mean/i.test(document.querySelector('#askRouterBox')?.innerText || ''), { timeout: 15000 });
  check('website: ambiguous vote asks for clarification', (await web.$$('#askRouterBox [data-ask-followup]')).length === 2);
  await web.focus('#askRouterBox [data-ask-followup]');
  await web.keyboard.press('Enter');
  await web.waitForFunction(() => /related documents before and after/i.test(document.querySelector('#askRouterBox')?.innerText || ''), { timeout: 15000 });
  check('website: keyboard-selected vote gives before/after list', /invoice-2024-04-20/.test(await web.$eval('#investigationSearchResults', (e) => e.innerText)));

  await ASK(web, '#investigationQuery', "What haven't we reviewed yet?");
  await web.waitForFunction(() => /still needs attention|Nothing is waiting/i.test(document.querySelector('#askRouterBox')?.innerText || ''), { timeout: 15000 });
  check('website: progress question answered from case counts', /Computed from your records/.test(await wout()) && /not reviewed yet|possible name match|claim/i.test(await web.$eval('#investigationSearchResults', (e) => e.innerText)));

  check('website: no horizontal scroll at 320px with an answer shown', !(await web.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  const v2 = await axeViolations(web);
  check('website: axe finds no WCAG A/AA violations in the Ask view', v2.length === 0, v2.join(' | '));

  check('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('test ran without throwing', false, e.stack || e.message);
} finally {
  await b.close();
}
process.exit(failed ? 1 : 0);
