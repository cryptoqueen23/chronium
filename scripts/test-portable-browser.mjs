#!/usr/bin/env node
// Real-browser two-way case transfer: the website (wrangler dev) and the
// extension side panel each have their own IndexedDB. A case is built on one,
// exported through the real Export buttons (browser download), imported on the
// other through the real Import UI (preview, confirm), and checked there; then
// the same in the other direction, plus a second import to prove no duplicates
// and a corrupt file to prove the error message. Runs with the network cut off
// after the pages have loaded.
// Usage: wrangler dev on :8787, then
//   node scripts/test-portable-browser.mjs --chrome=<Chrome for Testing exe>
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const chromeArg = process.argv.find((a) => a.startsWith('--chrome='));
const chrome = chromeArg ? chromeArg.slice(9) : 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const BASE = 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'chronium-dl-'));

let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failed = true; };

const b = await puppeteer.launch({
  executablePath: chrome, headless: false, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--disable-features=DisableLoadExtensionCommandLineSwitch']
});

// Builds a small but complete case through whichever page's own db.js.
const BUILD = async (dbPath, name) => {
  const db = await import(dbPath);
  const inv = await db.createInvestigation({ name, description: 'transfer test' });
  const rec = await db.saveRecordToInvestigation(inv.id, { title: 'Minutes', originalUrl: `https://example.gov/${name}.pdf`, archiveUrl: 'https://web.archive.org/web/2024/x', source: 'Wayback', captureDate: '2024-05-14', fileHash: 'h1', extractedText: 'Payne voted yes.' });
  const ev = await db.createEvidenceItem(inv.id, { sourceRecordId: rec.id, excerptType: 'quote', excerptText: 'Payne voted yes.', location: 'p.2' });
  const a = await db.createEntity(inv.id, { type: 'PERSON', name: 'Raymond Payne' });
  const o = await db.createEntity(inv.id, { type: 'ORGANIZATION', name: 'LFEDC' });
  await db.createRelationship(inv.id, { sourceEntityId: a.id, targetEntityId: o.id, type: 'BOARD_MEMBER_OF', evidenceIds: [ev.id] });
  const claim = await db.createClaim(inv.id, { text: 'Payne approved the grant.', subjectEntityIds: [a.id] });
  await db.createClaimEvidence(inv.id, { claimId: claim.id, evidenceId: ev.id, stance: 'supports' });
  await db.createClaimFinding(inv.id, { claimId: claim.id, conclusion: 'Minutes record a yes vote.', classification: 'DOCUMENTED_FACT', evidenceIds: [ev.id] });
  return inv.id;
};
const COUNTS = async (dbPath, invId) => {
  const db = await import(dbPath);
  return JSON.stringify({
    cases: (await db.listInvestigations()).length,
    sources: (await db.listInvestigationRecords(invId)).length, evidence: (await db.listEvidenceItems(invId)).length,
    claims: (await db.listClaims(invId)).length, entities: (await db.listEntities(invId)).length, findings: (await db.listClaimFindings(invId)).length
  });
};

async function newDownloadDir(page) {
  const dir = fs.mkdtempSync(path.join(dl, 'd-'));
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  return dir;
}
async function waitForFile(dir) {
  for (let i = 0; i < 60; i++) {
    const f = fs.readdirSync(dir).filter((x) => x.endsWith('.chronium.json'));
    if (f.length) return path.join(dir, f[0]);
    await sleep(250);
  }
  return null;
}

try {
  await sleep(3000);
  const sw = (await b.targets()).find((t) => t.type() === 'service_worker');
  const extId = new URL(sw.url()).host;

  const web = await b.newPage();
  const errs = [];
  web.on('pageerror', (e) => errs.push('web: ' + e.message));
  web.on('dialog', (d) => d.accept());
  await web.goto(`${BASE}/#/investigations`);
  await web.waitForSelector('#allInvestigationsList');

  const panel = await b.newPage();
  panel.on('pageerror', (e) => errs.push('ext: ' + e.message));
  panel.on('dialog', (d) => d.accept());
  await panel.goto(`chrome-extension://${extId}/panel.html`);
  await panel.click('#tab-research');

  // Everything below must work with no network.
  await web.setOfflineMode(true); await panel.setOfflineMode(true);

  // ---- website -> extension (export via the website's real menu) ----
  const webInv = await web.evaluate(BUILD, '/db.js', 'WebCase');
  const webDir = await newDownloadDir(web);
  // Background tabs do not run animation frames, which stalls clicks.
  await web.bringToFront();
  // Real UI path: open the case from the Investigations list, then use the
  // investigation menu's "Export case file..." item.
  await web.evaluate(() => { location.hash = '#/settings'; });
  await sleep(300);
  await web.evaluate(() => { location.hash = '#/investigations'; });
  await web.waitForSelector('[data-open-investigation]', { timeout: 10000 });
  await web.evaluate((id) => document.querySelector(`[data-open-investigation="${id}"]`).click(), webInv);
  await web.waitForSelector('#workspaceKebabBtn', { visible: true, timeout: 10000 });
  await web.click('#workspaceKebabBtn');
  await web.waitForSelector('[data-action="export-active-investigation"]', { visible: true });
  const menuLabel = await web.$eval('[data-action="export-active-investigation"]', (e) => e.textContent.trim());
  check('website menu has an "Export case file…" item', /Export case file/.test(menuLabel), menuLabel);
  await web.click('[data-action="export-active-investigation"]');
  const webExport = 'WebCase.chronium.json';
  const webFile = await waitForFile(webDir);
  check('website exported a .chronium.json file', !!webFile && webExport.endsWith('.chronium.json'), webExport);

  await panel.bringToFront();
  const input = await panel.$('#caseFileInput');
  await input.uploadFile(webFile);
  await panel.waitForSelector('#confirmImport', { timeout: 10000 });
  const previewText = await panel.$eval('#importBox', (e) => e.innerText);
  check('extension shows a preview before importing', /Import this case\?/.test(previewText) && /will be added as a new case/.test(previewText), previewText.split('\n').slice(0, 3).join(' | '));
  check('preview wrote nothing yet', JSON.parse(await panel.evaluate(COUNTS, './lib/db.js', webInv)).cases === 0);
  await panel.click('#confirmImport');
  await panel.waitForFunction(() => /was added/.test(document.querySelector('#importBox').innerText), { timeout: 10000 });
  const extCounts = await panel.evaluate(COUNTS, './lib/db.js', webInv);
  check('case arrived in extension with all parts', extCounts === JSON.stringify({ cases: 1, sources: 1, evidence: 1, claims: 1, entities: 2, findings: 1 }), extCounts);
  check('case shows in My Cases', /WebCase/.test(await panel.$eval('#caseList', (e) => e.innerText)));

  // ---- importing again adds nothing ----
  await (await panel.$('#caseFileInput')).uploadFile(webFile);
  await panel.waitForSelector('#confirmImport');
  check('second import previews "nothing new"', /Nothing new to add/.test(await panel.$eval('#importBox', (e) => e.innerText)));
  await panel.click('#confirmImport');
  await sleep(800);
  check('no duplicates after second import', (await panel.evaluate(COUNTS, './lib/db.js', webInv)) === extCounts);

  // ---- extension -> website (export via the extension's real Export button) ----
  await panel.bringToFront();
  const extInv = await panel.evaluate(BUILD, './lib/db.js', 'ExtCase');
  await panel.reload({ waitUntil: 'domcontentloaded' });
  await panel.click('#tab-research');
  await panel.waitForSelector('[data-export]');
  const extDir = await newDownloadDir(panel);
  const buttons = await panel.$$('[data-export]');
  const ids = await Promise.all(buttons.map((h) => h.evaluate((e) => e.dataset.export)));
  await buttons[ids.indexOf(extInv)].click();
  const extFile = await waitForFile(extDir);
  check('extension exported a .chronium.json file', !!extFile && /ExtCase/.test(extFile), extFile && path.basename(extFile));

  await web.bringToFront();
  const webInput = await web.$('#caseFileInput');
  await webInput.uploadFile(extFile);
  await web.waitForSelector('#confirmDialog:not(.hidden)', { timeout: 10000 }).catch(async (e) => { throw new Error(e.message + ' | toast: ' + (await web.$eval('#toast', (t) => t.textContent).catch(() => '?'))); });
  const webPreview = await web.$eval('#confirmDialogMessage', (e) => e.innerText);
  check('website shows a preview before importing', /will be added as a new case/.test(webPreview), webPreview.split('\n')[0]);
  await web.click('#confirmDialogConfirm');
  await sleep(1500);
  const webCounts = await web.evaluate(COUNTS, '/db.js', extInv);
  check('case arrived on website with all parts', webCounts === JSON.stringify({ cases: 2, sources: 1, evidence: 1, claims: 1, entities: 2, findings: 1 }), webCounts);

  // ---- corrupt file ----
  await panel.bringToFront();
  const bad = path.join(dl, 'broken.json');
  fs.writeFileSync(bad, '{ this is not a case file');
  await (await panel.$('#caseFileInput')).uploadFile(bad);
  await sleep(800);
  const msg = await panel.$eval('#importBox', (e) => e.innerText);
  check('corrupt file gives a plain-language error', /not a Chronium case file/.test(msg), msg);
  check('existing cases still intact after bad import', /WebCase/.test(await panel.$eval('#caseList', (e) => e.innerText)));

  check('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('test ran without throwing', false, e.stack || e.message);
} finally {
  await b.close();
}
process.exit(failed ? 1 : 0);
