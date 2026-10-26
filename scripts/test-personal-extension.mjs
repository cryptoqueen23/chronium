#!/usr/bin/env node
// Real-Chrome test of the STABLE PERSONAL COPY of the extension, built the way you build it (scripts/make-personal-extension.mjs),
// loaded unpacked into Chrome for Testing, driven through the real panel page. It uses throwaway profiles, never your own.
//   node scripts/test-personal-extension.mjs --chrome=<Chrome for Testing exe>
// What it proves: the personal copy loads with its fixed ID; every panel view works; cases can be created, renamed, filled by hand,
// searched into, exported, backed up, deleted (with an automatic copy first), imported and restored; saved research survives a
// full Chrome restart; the database is not upgraded, deleted or overwritten behind your back; the start-up guard asks for a
// backup before any upgrade and refuses data from a newer version; declining a site permission prevents access; and the
// layout passes automated accessibility checks at phone and desktop widths in both colour schemes.
// No real website is contacted: the search answer is a local fixture, and the permission checks use example.com only as an
// address that is never fetched.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeArg = process.argv.find((a) => a.startsWith('--chrome='));
const chrome = chromeArg ? chromeArg.slice(9) : 'C:/Users/insur/.cache/puppeteer/chrome/win64-152.0.7977.75/chrome-win64/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AXE = fs.readFileSync(path.join(root, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failed = true; };

// ---- build the personal copy exactly as the person would ----
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chronium-personal-'));
const dest = path.join(work, 'ChroniumMind-Personal');
execFileSync(process.execPath, [path.join(root, 'scripts', 'make-personal-extension.mjs'), `--dest=${dest}`, '--allow-dirty'], { cwd: root, stdio: 'ignore' });
const { extensionIdForKey } = await import('./make-personal-extension.mjs');
const expectedId = extensionIdForKey(fs.readFileSync(path.join(root, 'scripts', 'personal-extension-public-key.txt'), 'utf8').trim());
const profile = (n) => fs.mkdtempSync(path.join(work, `profile-${n}-`));
const downloads = fs.mkdtempSync(path.join(work, 'downloads-'));

async function launch(userDataDir) {
  const b = await puppeteer.launch({
    executablePath: chrome, headless: false, userDataDir, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${dest}`, `--load-extension=${dest}`, '--no-first-run', '--no-default-browser-check', '--disable-features=DisableLoadExtensionCommandLineSwitch']
  });
  let sw = null;
  for (let i = 0; i < 40 && !sw; i++) { sw = (await b.targets()).find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://')); if (!sw) await sleep(250); }
  const id = new URL(sw.url()).host;
  return { b, id, sw };
}
async function openPanel(b, id, { fixtures = true } = {}) {
  const page = await b.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const cdp = await page.createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  if (fixtures) {
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (r.url().includes('/api/search')) return r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ results: [{ title: 'Fixture result: council agenda', originalUrl: 'https://example.org/agenda-2024.pdf', archiveUrl: 'https://web.archive.org/web/2024/https://example.org/agenda-2024.pdf', source: 'Wayback', captureDate: '2024-05-14', snippet: 'A fixture, not a real search.' }], connectors: [{ source: 'Wayback', ok: true, count: 1 }] }) });
      if (/^https?:\/\/(?!127\.0\.0\.1)/.test(r.url()) && !r.url().includes('chrome-extension')) { page.__outside = (page.__outside || []).concat(r.url()); return r.abort(); }
      return r.continue();
    });
  }
  await page.goto(`chrome-extension://${id}/panel.html`);
  await page.waitForSelector('#tab-research');
  return { page, errors };
}
// The panel re-renders after most actions, so an element can be replaced between finding it and clicking it: retry on that.
const click = async (page, sel) => {
  for (let i = 0; i < 6; i++) {
    try { await page.waitForSelector(sel, { visible: true, timeout: 8000 }); await page.click(sel); return; }
    catch (e) { if (i === 5 || !/detached|not clickable|not an Element|Execution context/.test(String(e))) throw e; await sleep(250); }
  }
};
// Every finished download is MOVED out of the downloads folder as soon as it is seen, so the next download is always a new file
// (under test control Chrome overwrites a same-named file instead of adding "(1)", which would hide a second download).
const kept = fs.mkdtempSync(path.join(work, 'kept-'));
const jsonFiles = () => fs.readdirSync(downloads).filter((x) => x.endsWith('.json') && !fs.existsSync(path.join(downloads, x + '.crdownload')));
const markSeen = () => {};
let keptCount = 0;
async function waitForDownload(_ignored, ms = 10000) {
  for (let i = 0; i < ms / 200; i++) {
    const f = jsonFiles()[0];
    if (f) { await sleep(250); const to = path.join(kept, `${++keptCount}-${f}`); fs.renameSync(path.join(downloads, f), to); return to; }
    await sleep(200);
  }
  return null;
}
const waitText = (page, sel, re, ms = 8000) => page.waitForFunction((s, src) => new RegExp(src, 'i').test(document.querySelector(s)?.textContent || ''), { timeout: ms }, sel, re.source);
const waitVisible = (page, sel, ms = 8000) => page.waitForFunction((s) => { const e = document.querySelector(s); return e && !e.hidden && e.textContent.length > 0; }, { timeout: ms }, sel);
const dbInfo = (page) => page.evaluate(async () => {
  const db = await import('./lib/db.js'); const open = await new Promise((res) => { const r = indexedDB.open('chronium'); r.onsuccess = () => { const v = r.result.version; r.result.close(); res(v); }; r.onerror = () => res(-1); });
  const cases = await db.listInvestigations();
  const out = { version: open, cases: [] };
  for (const c of cases) out.cases.push({ id: c.id, name: c.name, sources: (await db.listInvestigationRecords(c.id)).length, evidence: (await db.listEvidenceItems(c.id)).length });
  return out;
});

try {
  // =============== installation ===============
  const U1 = profile(1);
  let { b, id, sw } = await launch(U1);
  check('the personal copy loads unpacked and is running (service worker started)', !!sw);
  check('its ID is the fixed ID from its key, not one derived from the folder path', id === expectedId, `${id} vs ${expectedId}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
  check('manifest: Manifest V3, side panel, key present, unlimitedStorage present, no localhost permission', manifest.manifest_version === 3 && !!manifest.side_panel && !!manifest.key && manifest.permissions.includes('unlimitedStorage') && !JSON.stringify(manifest).includes('127.0.0.1') && !JSON.stringify(manifest).includes('localhost'));
  check('manifest: no always-on access to every site (all-site access is only optional, asked per site)', !(manifest.host_permissions || []).some((h) => /\*:\/\/\*|https:\/\/\*\/|http:\/\/\*\//.test(h)) && manifest.optional_host_permissions.length > 0);
  // Icons: Chrome squashes a non-square image into its square slot, so every icon must be square and present.
  const iconFiles = [...new Set([...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {})])];
  const dims = (f) => { const d = fs.readFileSync(path.join(dest, f)); return [d.readUInt32BE(16), d.readUInt32BE(20)]; };
  check('every icon named in the manifest exists and is square (16, 32, 48 and 128 px)', iconFiles.length >= 4 && iconFiles.every((f) => { const [w, h] = dims(f); return w === h; }) && [16, 32, 48, 128].every((n) => dims(`icons/icon-${n}.png`)[0] === n), iconFiles.map((f) => dims(f).join('x')).join(' '));
  check('the personal copy does not carry the 2 MB oversized image any more', !fs.existsSync(path.join(dest, 'icons', 'icon.png')));
  check('PERSONAL-COPY.txt records the build and the ID', fs.readFileSync(path.join(dest, 'PERSONAL-COPY.txt'), 'utf8').includes(expectedId));
  check('the development folder was not changed by building the copy (no key in extension/manifest.json)', !JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8')).key);

  let { page, errors } = await openPanel(b, id);
  check('the panel opens and shows the four views', (await page.$$eval('[role=tab]', (t) => t.map((x) => x.textContent.trim()))).join('|') === 'Search|Compare|My Research|Reports');
  const swCheck = await (await sw.worker()).evaluate(async () => (await chrome.sidePanel.getPanelBehavior()).openPanelOnActionClick);
  check('clicking the toolbar icon is set to open the side panel', swCheck === true);
  await click(page, '#tab-compare');
  check('Compare says plainly that it is not built yet (it is a placeholder, not broken)', /not built yet/i.test(await page.$eval('#view-compare', (e) => e.textContent)));
  await click(page, '#tab-reports'); await waitText(page, '#reportBox', /Create a case/);
  check('Reports with no case says what to do next', /Create a case/i.test(await page.$eval('#reportBox', (e) => e.textContent)));

  // =============== create, rename, fill by hand ===============
  await click(page, '#tab-research');
  await page.type('#newCaseName', 'Test Case A'); await click(page, '#newCaseForm button[type=submit]');
  await page.waitForSelector('#caseList .badge');
  check('a case can be created and becomes the active case', /Test Case A/.test(await page.$eval('#caseList', (e) => e.textContent)) && /Active/.test(await page.$eval('#caseList', (e) => e.textContent)));
  await click(page, '#toolsDetails > summary');
  // validation first
  await click(page, '#addSourceForm button[type=submit]');
  check('adding a source with no title is refused with a spoken, associated error and focus on the field', (await page.$eval('#toolsError', (e) => !e.hidden && /title/i.test(e.textContent))) && await page.$eval('#srcTitle', (e) => e.getAttribute('aria-invalid') === 'true' && document.activeElement === e));
  await page.type('#srcTitle', 'Bad address test'); await page.type('#srcUrl', 'javascript:alert(1)'); await click(page, '#addSourceForm button[type=submit]');
  check('a javascript: address is refused', await page.$eval('#toolsError', (e) => !e.hidden && /https/i.test(e.textContent)));
  await page.$eval('#srcTitle', (e) => { e.value = ''; }); await page.$eval('#srcUrl', (e) => { e.value = ''; });
  // rename
  await page.$eval('#renameInput', (e) => { e.value = ''; }); await page.type('#renameInput', 'Test Case A (renamed)'); await click(page, '#renameForm button[type=submit]');
  await page.waitForFunction(() => /renamed/.test(document.querySelector('#caseList')?.textContent || ''));
  check('a case can be renamed and the new name shows in the list', /Test Case A \(renamed\)/.test(await page.$eval('#caseList', (e) => e.textContent)) && /renamed/.test(await page.$eval('#toolsStatus', (e) => e.textContent)));
  // add source by hand
  await click(page, '#toolsDetails > summary').catch(() => {});
  if (!(await page.$eval('#toolsDetails', (e) => e.open))) await click(page, '#toolsDetails > summary');
  await page.type('#srcTitle', 'Council minutes, May 2024'); await page.type('#srcUrl', 'https://example.org/minutes-2024.pdf'); await page.$eval('#srcDate', (e) => { e.value = '2024-05-14'; });
  await page.type('#srcFrom', 'City records office'); await page.type('#srcText', 'Councilmember Payne moved to approve the grant. The motion carried 5 to 2.');
  await click(page, '#addSourceForm button[type=submit]');
  await page.waitForFunction(() => /Added/.test(document.querySelector('#toolsStatus')?.textContent || ''));
  check('a document can be added by hand (title, address, date, origin and text)', true);
  await click(page, '#toolsDetails > summary').catch(() => {}); if (!(await page.$eval('#toolsDetails', (e) => e.open))) await click(page, '#toolsDetails > summary');
  await page.type('#srcTitle', 'Same address again'); await page.type('#srcUrl', 'https://example.org/minutes-2024.pdf'); await click(page, '#addSourceForm button[type=submit]');
  await waitText(page, '#toolsError', /already saved/);
  check('adding the same web address twice is refused instead of duplicating', await page.$eval('#toolsError', (e) => !e.hidden && /already saved/i.test(e.textContent)));
  await page.$eval('#srcTitle', (e) => { e.value = ''; }); await page.$eval('#srcUrl', (e) => { e.value = ''; });
  // evidence by hand
  await page.waitForSelector('#evSource');
  await page.type('#evText', 'The motion carried 5 to 2.'); await page.type('#evLocation', 'page 2, paragraph 3'); await click(page, '#addEvidenceForm button[type=submit]');
  await page.waitForFunction(() => /Saved the passage/.test(document.querySelector('#toolsStatus')?.textContent || ''));
  let info = await dbInfo(page);
  check('an evidence passage can be added by hand and is stored against its source', info.cases[0].sources === 1 && info.cases[0].evidence === 1, JSON.stringify(info.cases[0]));
  await click(page, '#addEvidenceForm button[type=submit]');
  check('saving an empty passage is refused with an error and focus on the field', await page.$eval('#toolsError', (e) => !e.hidden && /passage/i.test(e.textContent)));

  // =============== search, save, ask, reports ===============
  await click(page, '#tab-search'); await page.type('#q', 'council'); await click(page, '#searchForm button[type=submit]');
  await page.waitForSelector('#results [data-save]');
  check('Search shows results from the (fixture) server and says which sources answered', /Fixture result/.test(await page.$eval('#results', (e) => e.textContent)) && /Search status/.test(await page.$eval('#searchStatus', (e) => e.textContent)));
  await click(page, '#results [data-save]');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#results [data-save]')?.textContent || ''));
  info = await dbInfo(page);
  check('a search result can be saved into the active case', info.cases[0].sources === 2);
  await click(page, '#tab-research');
  await page.type('#askQ', 'who voted'); await click(page, '#askForm button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#askOut')?.textContent.length > 20);
  check('Ask Chronium answers from the case without any AI or network', !/Could not answer/.test(await page.$eval('#askOut', (e) => e.textContent)));
  await click(page, '[data-open]');
  await page.waitForSelector('#vpanel .vw-section');
  check('opening a case shows its Big Picture', /Test Case A \(renamed\)/.test(await page.$eval('#caseDetail', (e) => e.textContent)));
  await click(page, '#tab-reports'); await waitText(page, '#reportBox', /Council minutes/);
  const report = await page.$eval('#reportBox', (e) => e.textContent);
  check('Reports lists both sources, including the one added by hand', /Council minutes, May 2024/.test(report) && /Fixture result/.test(report));

  // =============== export, backup ===============
  await click(page, '#tab-research');
  markSeen(); let t0 = 0;
  await click(page, '[data-export]');
  const caseFile = await waitForDownload(t0);
  const caseJson = caseFile ? JSON.parse(fs.readFileSync(caseFile, 'utf8')) : null;
  check('Export saves a case file to Downloads, readable as JSON, with a plain-language confirmation', !!caseJson && /Saved .*\.chronium\.json/.test(await page.$eval('#importBox', (e) => e.textContent)), caseFile ? path.basename(caseFile) : 'no file');
  await page.evaluate(() => { document.querySelector('#backupDetails').open = true; });
  await click(page, '#backupAllBtn');
  const backupFile = await waitForDownload(t0);
  const backupJson = backupFile ? JSON.parse(fs.readFileSync(backupFile, 'utf8')) : null;
  check('"Back up everything" saves a whole-database backup with the right counts', !!backupJson && backupJson.format === 'chronium-raw-backup' && backupJson.counts.investigations === 1 && backupJson.counts.records === 2 && backupJson.counts.evidenceItems === 1, backupJson ? JSON.stringify(backupJson.counts) : 'no file');
  check('storage protection line is shown', (await page.$eval('#persistLine', (e) => e.textContent)).length > 10, await page.$eval('#persistLine', (e) => e.textContent));
  const before = await dbInfo(page);
  check('the database is at version 12 (nothing upgraded it)', before.version === 12, String(before.version));
  check('no page errors in the whole session', errors.length === 0, errors.slice(0, 3).join(' | '));
  const outside = page.__outside || [];
  check('during all of this the panel contacted no website other than the fixture server', outside.length === 0, outside.join(', '));
  await b.close();

  // =============== closing and reopening Chrome ===============
  ({ b, id, sw } = await launch(U1));
  check('after a full Chrome restart the extension has the same ID', id === expectedId);
  ({ page, errors } = await openPanel(b, id));
  await click(page, '#tab-research'); await page.waitForSelector('#caseList li');
  const after = await dbInfo(page);
  check('after restart the case, its name, both sources and the evidence passage are all still there', JSON.stringify(after.cases) === JSON.stringify(before.cases) && after.version === 12, JSON.stringify(after.cases));
  check('after restart the case is still the active one and no start-up guard dialog appeared', /Active/.test(await page.$eval('#caseList', (e) => e.textContent)) && !(await page.$('#startupGate .ug-box')));
  const stored = await (await sw.worker()).evaluate(async () => (await chrome.storage.local.get('activeCaseId')).activeCaseId);
  check('the chosen active case is remembered by Chrome', !!stored);

  // =============== delete is two steps: a copy first, then an explicit confirmation ===============
  await click(page, '[data-del]');
  const keepCopy = await waitForDownload();
  await page.waitForSelector('#keepCase');
  check('step 1 of deleting saves a copy to Downloads and deletes NOTHING yet', !!keepCopy && (await dbInfo(page)).cases.length === 1 && !!(await page.$('#confirmDelete')));
  check('the safe choice (Keep the case) has the focus, and the message names the file and the way back', await page.$eval('#keepCase', (e) => document.activeElement === e) && /Import case file/.test(await page.$eval('#importBox', (e) => e.textContent)));
  await click(page, '#keepCase'); await sleep(300);
  check('choosing Keep leaves the case exactly as it was', (await dbInfo(page)).cases.length === 1 && /kept/i.test(await page.$eval('#importBox', (e) => e.textContent)));
  await click(page, '[data-del]');
  const delCopy = await waitForDownload();
  await page.waitForSelector('#confirmDelete'); await click(page, '#confirmDelete');
  await page.waitForFunction(() => document.querySelectorAll('#caseList li').length === 0);
  check('only after confirming is the case deleted, and the copy is on disk', !!delCopy && (await dbInfo(page)).cases.length === 0);
  // import it back
  const input = await page.$('#caseFileInput'); await input.uploadFile(delCopy);
  await page.waitForSelector('#confirmImport'); await click(page, '#confirmImport');
  await page.waitForFunction(() => document.querySelectorAll('#caseList li').length === 1);
  const back = await dbInfo(page);
  check('importing the copy brings the case back with its sources and evidence', back.cases[0].sources === 2 && back.cases[0].evidence === 1 && back.cases[0].name === 'Test Case A (renamed)', JSON.stringify(back.cases));
  await input.uploadFile(delCopy); await page.waitForSelector('#confirmImport'); await click(page, '#confirmImport'); await sleep(600);
  const dup = await dbInfo(page);
  check('importing the same file again does not duplicate anything', dup.cases.length === 1 && dup.cases[0].sources === 2 && dup.cases[0].evidence === 1, JSON.stringify(dup.cases));
  await b.close();

  // =============== restore a whole backup into a brand-new profile ===============
  const U2 = profile(2);
  ({ b, id, sw } = await launch(U2));
  ({ page, errors } = await openPanel(b, id));
  await click(page, '#tab-research');
  await page.evaluate(() => { document.querySelector('#backupDetails').open = true; });
  const rin = await page.$('#restoreFileInput'); await rin.uploadFile(backupFile);
  await page.waitForSelector('#confirmRestore'); await click(page, '#confirmRestore');
  await page.waitForFunction(() => /Restored/.test(document.querySelector('#backupBox')?.textContent || ''));
  const restored = await dbInfo(page);
  check('restoring the backup into a fresh browser brings back the case, sources and evidence', restored.cases.length === 1 && restored.cases[0].sources === 2 && restored.cases[0].evidence === 1, JSON.stringify(restored.cases));
  await rin.uploadFile(backupFile); await page.waitForSelector('#confirmRestore'); await click(page, '#confirmRestore');
  await page.waitForFunction(() => /Restored/.test(document.querySelector('#backupBox')?.textContent || ''));
  const twice = await dbInfo(page);
  check('restoring the same backup again changes nothing (never overwrites, never duplicates)', JSON.stringify(twice.cases) === JSON.stringify(restored.cases));
  await rin.uploadFile(caseFile); await page.waitForSelector('#backupBox .notice');
  check('a file that is not a backup is refused in plain words', /not a Chronium backup/i.test(await page.$eval('#backupBox', (e) => e.textContent)));

  // =============== site permission: declining prevents access ===============
  const perm = await page.evaluate(async () => {
    const has = await chrome.permissions.contains({ origins: ['https://example.com/*'] });
    let fetched = 'no'; try { await fetch('https://example.com/', { cache: 'no-store' }); fetched = 'yes'; } catch { fetched = 'blocked'; }
    return { has, fetched };
  });
  check('without the site permission the extension holds no access to example.com and cannot read it', perm.has === false && perm.fetched === 'blocked', JSON.stringify(perm));
  await page.setRequestInterception(false); // from here on watch the network without answering fixtures
  const seen = []; page.on('request', (r) => seen.push(r.url()));
  await page.evaluate(() => { chrome.permissions.request = async () => false; }); // what Chrome returns when the person chooses "Deny"
  await page.type('#dc-url', 'https://example.com/'); await click(page, '#dc-ack'); await click(page, '#dc-start');
  await page.waitForFunction(() => !document.querySelector('#dc-url-err')?.hidden);
  check('if the person declines, the panel says it needs permission and does not start', /needs your permission/i.test(await page.$eval('#dc-url-err', (e) => e.textContent)) && !seen.some((u) => u.startsWith('https://example.com')), seen.filter((u) => !u.startsWith('chrome-extension')).join(','));
  await b.close();

  // =============== the start-up guard (a database from an older version) ===============
  const oldSrc = execFileSync('git', ['show', 'd80ef66:public/db.js'], { cwd: root, encoding: 'utf8' });
  // The August database code is placed in the THROWAWAY test copy (never the real extension) so an extension page may import it.
  fs.writeFileSync(path.join(dest, 'zz-test-old-db.js'), oldSrc);
  const U3 = profile(3);
  ({ b, id, sw } = await launch(U3));
  const seed = await b.newPage(); await seed.goto(`chrome-extension://${id}/manifest.json`);
  await seed.evaluate(async () => {
    const m = await import('/zz-test-old-db.js');
    const inv = await m.createInvestigation({ name: 'Case from an older version', description: '' });
    await m.saveRecordToInvestigation(inv.id, { title: 'Old source', originalUrl: 'https://example.org/old', source: 'Wayback' });
  });
  const ver = () => seed.evaluate(() => new Promise((res) => { const r = indexedDB.open('chronium'); r.onupgradeneeded = () => { r.transaction.abort(); res(0); }; r.onsuccess = () => { const v = r.result.version; r.result.close(); res(v); }; r.onerror = () => res(-1); }));
  check('setup: an older-version database (4) exists in the extension\'s storage', (await ver()) === 4);
  await seed.close();
  ({ page } = await openPanel(b, id));
  await page.waitForSelector('#ug-title', { timeout: 8000 });
  check('the guard asks BEFORE upgrading: the dialog is shown and the database is still version 4', (await ver2(page)) === 4);
  async function ver2(p) { return p.evaluate(() => new Promise((res) => { const r = indexedDB.open('chronium'); r.onupgradeneeded = () => { r.transaction.abort(); res(0); }; r.onsuccess = () => { const v = r.result.version; r.result.close(); res(v); }; r.onerror = () => res(-1); })); }
  check('the dialog is an accessible alert dialog with focus on its title and Update disabled until a backup exists', await page.$eval('.ug-box', (e) => e.getAttribute('role') === 'alertdialog' && e.getAttribute('aria-modal') === 'true' && document.activeElement.id === 'ug-title' && document.querySelector('#ug-go').disabled));
  await page.focus('#ug-backup'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#ug-go').disabled, { timeout: 15000 });
  const guardBackup = await waitForDownload(t0);
  const gb = guardBackup ? JSON.parse(fs.readFileSync(guardBackup, 'utf8')) : null;
  check('the backup is saved at the OLD version with the case in it, and the database is still not upgraded', !!gb && gb.dbVersion === 4 && gb.counts.investigations === 1 && gb.counts.records === 1 && (await ver2(page)) === 4);
  await page.focus('#ug-go'); await page.keyboard.press('Enter');
  await page.waitForSelector('#caseList li', { timeout: 10000 }).catch(async () => { await click(page, '#tab-research'); await page.waitForSelector('#caseList li'); });
  await sleep(400);
  const upg = await dbInfo(page);
  check('after choosing, the database is upgraded to 12 and the old case is intact', upg.version === 12 && upg.cases.length === 1 && upg.cases[0].sources === 1 && upg.cases[0].name === 'Case from an older version', JSON.stringify(upg));
  await b.close();

  // data from a NEWER version: refuse, change nothing
  const U4 = profile(4);
  ({ b, id, sw } = await launch(U4));
  const seed2 = await b.newPage(); await seed2.goto(`chrome-extension://${id}/manifest.json`);
  await seed2.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('chronium', 99); r.onupgradeneeded = () => { r.result.createObjectStore('investigations', { keyPath: 'id' }).add({ id: 'inv-future', name: 'Made by a future version' }); }; r.onsuccess = () => { r.result.close(); res(); }; r.onerror = () => rej(r.error); }));
  await seed2.close();
  ({ page } = await openPanel(b, id));
  await page.waitForSelector('#ug-title', { timeout: 8000 });
  check('data from a NEWER version is refused with a plain explanation, and the panel does not start', /newer version/i.test(await page.$eval('.ug-box', (e) => e.textContent)) && !(await page.$('#caseList li')));
  const fut = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('chronium'); r.onsuccess = () => { const db = r.result; const v = db.version; const q = db.transaction('investigations').objectStore('investigations').getAll(); q.onsuccess = () => { db.close(); res({ v, names: q.result.map((x) => x.name) }); }; }; }));
  check('...and that data is untouched (version and the case are exactly as they were)', fut.v === 99 && fut.names[0] === 'Made by a future version', JSON.stringify(fut));
  await b.close();

  // =============== layout and accessibility ===============
  const U5 = profile(5);
  ({ b, id, sw } = await launch(U5));
  ({ page } = await openPanel(b, id));
  await click(page, '#tab-research'); await page.type('#newCaseName', 'Layout case'); await click(page, '#newCaseForm button[type=submit]'); await page.waitForSelector('#caseList .badge');
  await click(page, '#toolsDetails > summary');
  await page.type('#srcTitle', 'A source'); await click(page, '#addSourceForm button[type=submit]'); await page.waitForSelector('#evSource');
  await page.$eval('#toolsDetails', (e) => { e.open = true; }); await page.evaluate(() => { document.querySelector('#backupDetails').open = true; document.querySelector('.foot details').open = true; });
  const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
  for (const scheme of ['dark', 'light']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    for (const w of [320, 400, 1000]) {
      await page.setViewport({ width: w, height: 900 }); await sleep(150);
      await page.evaluate(AXE);
      const v = await page.evaluate((t) => axe.run(document, { runOnly: { type: 'tag', values: t } }).then((r) => r.violations.map((x) => `${x.id}[${x.nodes.length}] ${x.nodes[0].target.join(' ')}`)), TAGS);
      const m = await page.evaluate(() => ({ h: document.documentElement.scrollWidth - innerWidth, small: [...document.querySelectorAll('button, input:not([type=file]), select, textarea, summary')].filter((e) => { const r = e.getBoundingClientRect(); if (!r.width) return false;
      // A checkbox is a 24 px box (WCAG 2.2 target size) inside a row at least 44 px tall whose label is also clickable; everything else must itself be 44 px tall.
      if (e.type === 'checkbox') return r.width < 23.5 || r.height < 23.5 || (e.closest('p')?.getBoundingClientRect().height || 0) < 43.5;
      return r.height < 43.5; }).map((e) => e.id || e.tagName).slice(0, 4) }));
      check(`${scheme} ${w}px: no automated accessibility violations, no sideways scrolling, all controls 44px tall (checkboxes: 24px box in a 44px row)`, v.length === 0 && m.h <= 1 && m.small.length === 0, v.join(' ; ') + ' ' + JSON.stringify(m));
    }
  }
  await b.close();
} catch (e) {
  check('test ran without throwing', false, e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
}
try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); } catch { /* a profile folder still held by a closing Chrome: it is in the temp folder and harmless */ }
console.log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
