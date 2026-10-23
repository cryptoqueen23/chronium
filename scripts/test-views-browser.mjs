#!/usr/bin/env node
// Big Picture / Overview / Deep Dive in a real browser: website and extension
// side panel. Checks navigation ("How do we know?" lands on the right evidence,
// Back restores your place), consistency between levels and between devices
// (a case exported from the website renders the same Big Picture in the
// extension), keyboard use, no horizontal scroll at every width, axe-core,
// and touch-target sizes. Saves screenshots to --shots=<dir>.
// Usage: wrangler dev on :8787, then
//   node scripts/test-views-browser.mjs --chrome=<Chrome for Testing exe> [--shots=<dir>]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const chrome = arg('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const shots = arg('shots', '');
if (shots) fs.mkdirSync(shots, { recursive: true });
const ext = path.join(root, 'extension');
const AXE = fs.readFileSync(path.join(root, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const BASE = 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failed = true; };

const BUILD = async (dbPath, name) => {
  const db = await import(dbPath);
  const inv = await db.createInvestigation({ name, description: 'Where the grant money went' });
  await db.saveOutline(inv.id, { researchQuestion: 'Who approved the grant and for how much?' });
  const mk = (title, text, extra = {}) => db.saveRecordToInvestigation(inv.id, { title, originalUrl: `https://example.gov/${title}`, extractedText: text, sourceId: null, ...extra });
  const minutes = await mk('minutes-2024-03-12.txt', 'LFEDC Board\nMotion by Smith, seconded by Lee, to approve Ordinance 2024-31 and a grant of $412,000 to Holt Construction LLC. Voted 4-1.', { fileHash: 'abc123def4567890', archiveUrl: 'https://web.archive.org/web/2024/https://example.gov/minutes' });
  const memo = await mk('memo-2024-02-01.txt', 'Staff memo recommends Ordinance 2024-31 at $400,000 for Holt Construction LLC.');
  await mk('invoice-2024-04-20.txt', 'Invoice referencing Ordinance 2024-31. Amount due: $412,000 to Holt Construction LLC.');
  const e1 = await db.createEvidenceItem(inv.id, { sourceRecordId: minutes.id, excerptType: 'quote', excerptText: 'Voted 4-1. Grant of $412,000 to Holt Construction LLC.', location: 'p.2' });
  const e2 = await db.createEvidenceItem(inv.id, { sourceRecordId: memo.id, excerptType: 'quote', excerptText: 'recommends Ordinance 2024-31 at $400,000', location: 'p.1' });
  const a = await db.createEntity(inv.id, { type: 'PERSON', name: 'Raymond Payne' });
  const o = await db.createEntity(inv.id, { type: 'ORGANIZATION', name: 'LFEDC' });
  const h = await db.createEntity(inv.id, { type: 'BUSINESS', name: 'Holt Construction LLC' });
  await db.createRelationship(inv.id, { sourceEntityId: a.id, targetEntityId: o.id, type: 'BOARD_MEMBER_OF', evidenceIds: [e1.id], status: 'CONFIRMED' });
  await db.createRelationship(inv.id, { sourceEntityId: o.id, targetEntityId: h.id, type: 'GRANT_AWARDED_TO', evidenceIds: [e1.id], status: 'PROBABLE' });
  const c1 = await db.createClaim(inv.id, { text: 'The grant vote was unanimous.' });
  const c2 = await db.createClaim(inv.id, { text: 'Staff recommended $400,000.' });
  const c3 = await db.createClaim(inv.id, { text: 'A second grant was awarded.' });
  await db.createClaimEvidence(inv.id, { claimId: c1.id, evidenceId: e1.id, stance: 'contradicts' });
  await db.createClaimEvidence(inv.id, { claimId: c2.id, evidenceId: e2.id, stance: 'supports' });
  await db.createClaimFinding(inv.id, { claimId: c2.id, conclusion: 'Staff recommended $400,000 before the vote.', classification: 'DOCUMENTED_FACT', evidenceIds: [e2.id] });
  await db.createClaimFinding(inv.id, { claimId: c1.id, conclusion: 'The vote was not unanimous: it was 4-1.', classification: 'SUPPORTED_INFERENCE', evidenceIds: [e1.id] });
  await db.createClaimFinding(inv.id, { claimId: c3.id, conclusion: 'No second grant record was located.', classification: 'NO_EVIDENCE_LOCATED', evidenceIds: [] });
  await db.saveRecordToInvestigation(inv.id, { title: 'filler.txt', originalUrl: 'https://example.gov/filler', extractedText: 'Filler text. '.repeat(400) });
  return inv.id;
};
const axeViolations = async (page) => {
  await page.evaluate(AXE);
  return page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }).then((r) => r.violations.map((v) => `${v.id}: ${v.nodes[0].target.join(' ')}`)));
};
const smallTargets = (page, scope) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} a, ${sel} button, ${sel} summary`)].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.h < 24 || (x.w < 24)), scope);
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name), fullPage: false }); };

const b = await puppeteer.launch({
  executablePath: chrome, headless: false, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--disable-features=DisableLoadExtensionCommandLineSwitch']
});
const errs = [];
try {
  await sleep(3000);
  const sw = (await b.targets()).find((t) => t.type() === 'service_worker');
  const extId = new URL(sw.url()).host;

  // ===================== website =====================
  const web = await b.newPage();
  web.on('pageerror', (e) => errs.push('web: ' + e.message));
  await web.setViewport({ width: 1280, height: 900 });
  await web.goto(`${BASE}/#/investigations`, { waitUntil: 'networkidle2' });
  const webInv = await web.evaluate(BUILD, '/db.js', 'Grant review');
  await web.evaluate(() => { location.hash = '#/settings'; });
  await sleep(300);
  await web.evaluate(() => { location.hash = '#/investigations'; });
  await web.waitForSelector('[data-open-investigation]');
  await web.evaluate(() => document.querySelector('[data-open-investigation]').click());
  await web.waitForSelector('#tab-bigpicture');
  await web.waitForFunction(() => document.querySelector('#viewBody-bigpicture')?.innerText.length > 50);
  check('website: opening an investigation lands on Big Picture', await web.evaluate(() => location.hash === '#/workspace/bigpicture' && document.querySelector('#tab-bigpicture').getAttribute('aria-selected') === 'true'));
  const tabs = await web.$$eval('#workspaceTabStrip button', (bs) => bs.map((x) => x.textContent.trim()));
  check('website: the three views are tabs inside the investigation', tabs.slice(0, 3).join('|') === 'Big Picture|Overview|Deep Dive', tabs.join('|'));

  // Research stays one click away, and the browser Back button returns to the view you came from.
  await web.click('#tab-research');
  await web.waitForSelector('#investigationQuery', { visible: true });
  check('website: Research is still available as its own tab', await web.evaluate(() => location.hash === '#/workspace/research'));
  await web.goBack();
  const backOk = await web.waitForFunction(() => location.hash === '#/workspace/bigpicture' && document.querySelector('#viewBody-bigpicture')?.innerText.length > 50, { timeout: 8000 }).then(() => true, () => false);
  check('website: browser Back returns to Big Picture', backOk);
  await web.click('#tab-bigpicture');
  await web.waitForFunction(() => /What the records document/.test(document.querySelector('#viewBody-bigpicture')?.innerText || ''), { timeout: 10000 });
  let bp = await web.$eval('#viewBody-bigpicture', (e) => e.innerText);
  check('website: Big Picture states the subject and question', /Grant review/.test(bp) && /Who approved the grant and for how much/.test(bp));
  check('website: documented findings listed with a state label', /Staff recommended \$400,000 before the vote/.test(bp) && /Documented fact/.test(bp));
  check('website: figures and dates shown with source', /\$412,000/.test(bp) && /2024-03-12/.test(bp));
  check('website: disagreement surfaced', /Records disagree/.test(bp) && /The grant vote was unanimous/.test(bp));
  check('website: missing / not reviewed / unresolved are separate headings', /Missing: nothing was located/.test(bp) && /Not reviewed yet/.test(bp) && /Unresolved: looked at/.test(bp));
  check('website: names are not treated as verified', /does not identify a person/.test(bp));
  await shot(web, 'website-bigpicture-1280.png');

  // Keep-your-place: scroll, follow a "How do we know?" link by keyboard, come back.
  await web.evaluate(() => window.scrollTo(0, 420));
  await sleep(200);
  const scrolled = await web.evaluate(() => Math.round(window.scrollY));
  check('website: page is long enough to test place-keeping', scrolled > 100, String(scrolled));
  await web.evaluate(() => { const a = [...document.querySelectorAll('#viewBody-bigpicture .how-link')].find((x) => x.closest('.vw-item')?.innerText.includes('Staff recommended $400,000')); a.focus(); });
  await web.keyboard.press('Enter');
  await web.waitForFunction(() => location.hash.startsWith('#/workspace/deepdive/finding/'), { timeout: 10000 });
  await web.waitForSelector('#howWeKnow', { visible: true });
  check('website: "How do we know?" moves focus to the evidence', await web.evaluate(() => document.activeElement.id === 'howWeKnow'));
  const how = await web.$eval('#howWeKnow', (e) => e.innerText);
  check('website: shows the right source, passage, date and location', /memo-2024-02-01\.txt/.test(how) && /recommends Ordinance 2024-31 at \$400,000/.test(how) && /2024-02-01/.test(how) && /p\.1/.test(how), how.replace(/\s+/g, ' ').slice(0, 140));
  const crumbs = await web.$eval('#viewCrumbs-deepdive', (e) => e.innerText);
  check('website: breadcrumb shows where you are', /My Research/.test(crumbs) && /Grant review/.test(crumbs) && /Deep Dive/.test(crumbs) && /Back to Big Picture/.test(crumbs), crumbs.replace(/\s+/g, ' '));
  await shot(web, 'website-deepdive-howdoweknow-1280.png');
  await web.evaluate(() => document.querySelector('#viewCrumbs-deepdive [data-goto]').focus());
  await web.keyboard.press('Enter');
  await web.waitForFunction(() => location.hash === '#/workspace/bigpicture', { timeout: 10000 });
  await sleep(500);
  const restored = await web.evaluate(() => Math.round(window.scrollY));
  check('website: Back returns to the same place in Big Picture', Math.abs(restored - scrolled) <= 40, `${scrolled} -> ${restored}`);

  // Vote link, relationship link, discrepancy link all land on something real.
  for (const [view, needle] of [['overview', 'Vote'], ['overview', 'LFEDC — grant awarded to'], ['bigpicture', 'The grant vote was unanimous']]) {
    await web.evaluate((v) => { location.hash = `#/workspace/${v}`; }, view);
    await web.waitForFunction((v) => document.querySelector(`#viewBody-${v} .how-link`), {}, view);
    await web.evaluate((v, n) => { const a = [...document.querySelectorAll(`#viewBody-${v} .how-link`)].find((x) => x.closest('.vw-item')?.innerText.includes(n)); a.click(); }, view, needle);
    await web.waitForSelector('#howWeKnow', { visible: true, timeout: 10000 });
    const txt = await web.$eval('#howWeKnow', (e) => e.innerText);
    check(`website: link from ${view} ("${needle.slice(0, 22)}") opens evidence`, /How do we know\?/.test(txt) && !/No source is attached/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 90));
  }

  // Consistency between levels.
  await web.evaluate(() => { location.hash = '#/workspace/bigpicture'; });
  await web.waitForFunction(() => /passages/.test(document.querySelector('#viewBody-bigpicture')?.innerText || ''));
  const counts = await web.$eval('#viewBody-bigpicture', (e) => (e.innerText.match(/(\d+) sources? · (\d+) saved passages? · (\d+) claims? · (\d+) findings?/) || []).slice(1).map(Number));
  await web.evaluate(() => { location.hash = '#/workspace/deepdive'; });
  await web.waitForFunction(() => document.querySelector('#viewBody-deepdive .vw-details'));
  const dd = await web.$$eval('#viewBody-deepdive .vw-details > summary', (s) => Object.fromEntries(s.map((x) => [x.textContent.trim().replace(/\s*\(\d+\)$/, ''), Number((x.textContent.match(/\((\d+)\)/) || [])[1])])));
  check('website: counts agree between Big Picture and Deep Dive', counts[0] === dd['Source documents'] && counts[1] === dd['Evidence passages'] && counts[2] === dd['Claims and their evidence'], `bp=${counts} dd=${JSON.stringify(dd)}`);
  await web.focus('#viewBody-deepdive .vw-details > summary');
  await web.keyboard.press('Enter'); // keyboard-open the Source documents section
  await sleep(200);
  const text = await web.$eval('#viewBody-deepdive', (e) => e.innerText);
  check('website: Deep Dive shows file fingerprint and archive link', /abc123def4567890/.test(text) && /Open archived copy/.test(text));

  // Widths, accessibility, touch targets for each view.
  for (const w of [320, 375, 768, 1280, 1920]) {
    await web.setViewport({ width: w, height: 900 });
    for (const view of ['bigpicture', 'overview', 'deepdive']) {
      await web.evaluate((v) => { location.hash = `#/workspace/${v}`; }, view);
      await web.waitForFunction((v) => document.querySelector(`#viewBody-${v}`)?.innerText.length > 80, {}, view);
      await sleep(150);
      const over = await web.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const v = await axeViolations(web);
      check(`website ${view} @${w}px: no horizontal scroll, no axe violations`, over <= 1 && v.length === 0, `overflow=${over} ${v.join(' | ')}`);
    }
    if ([320, 768].includes(w)) { await web.evaluate(() => { location.hash = '#/workspace/bigpicture'; }); await sleep(300); await shot(web, `website-bigpicture-${w}.png`); }
  }
  await web.setViewport({ width: 375, height: 800 });
  await web.evaluate(() => { location.hash = '#/workspace/bigpicture'; });
  await sleep(400);
  const small = await smallTargets(web, '#view-workspace');
  check('website: every control is at least 24x24 CSS px (WCAG 2.2 target size)', small.length === 0, JSON.stringify(small.slice(0, 4)));

  // ===================== transfer to extension =====================
  const exported = await web.evaluate(async (id) => { const p = await import('/portable.js'); return (await p.exportInvestigationFile(id)).text; }, webInv);
  const file = path.join(os.tmpdir(), 'views-transfer.chronium.json');
  fs.writeFileSync(file, exported);
  await web.setViewport({ width: 1280, height: 900 });
  await web.evaluate(() => { location.hash = '#/workspace/bigpicture'; });
  await sleep(500);
  // The Records Recovery summary differs by design (the website links to its tab; the panel explains where to go), so it is compared separately.
  const stripRR = (e) => { const c = e.cloneNode(true); c.querySelectorAll('.rr-summary').forEach((x) => x.remove()); return c.innerText.replace(/\s+/g, ' ').trim(); };
  const rrCounts = (e) => (e.querySelector('.rr-summary li') ? e.querySelector('.rr-summary li').innerText.replace(/\s+/g, ' ').trim() : '');
  const webBigPicture = await web.$eval('#viewBody-bigpicture', stripRR);
  const webRR = await web.$eval('#viewBody-bigpicture', rrCounts);

  const panel = await b.newPage();
  panel.on('pageerror', (e) => errs.push('ext: ' + e.message));
  await panel.setViewport({ width: 320, height: 800 });
  await panel.goto(`chrome-extension://${extId}/panel.html`);
  await panel.click('#tab-research');
  await (await panel.$('#caseFileInput')).uploadFile(file);
  await panel.waitForSelector('#confirmImport');
  await panel.click('#confirmImport');
  await panel.waitForFunction(() => /was added/.test(document.querySelector('#importBox').innerText));
  await panel.waitForSelector('[data-open]');
  await panel.click('[data-open]');
  await panel.waitForSelector('#vpanel .vw-section');
  const extBigPicture = await panel.$eval('#vpanel', (e) => { const c = e.cloneNode(true); c.querySelectorAll('.rr-summary').forEach((x) => x.remove()); return c.innerText.replace(/\s+/g, ' ').trim(); });
  const extRR = await panel.$eval('#vpanel', (e) => (e.querySelector('.rr-summary li') ? e.querySelector('.rr-summary li').innerText.replace(/\s+/g, ' ').trim() : ''));
  check('extension: the Records Recovery summary shows the same counts as the website', extRR === webRR, `web: ${webRR} | ext: ${extRR}`);
  check('extension: a case imported from the website shows the identical Big Picture', extBigPicture === webBigPicture, extBigPicture === webBigPicture ? '' : `\nweb: ${webBigPicture.slice(0, 160)}\next: ${extBigPicture.slice(0, 160)}`);
  await shot(panel, 'extension-bigpicture-320.png');

  // ===================== extension navigation =====================
  await panel.evaluate(() => window.scrollTo(0, 380));
  await sleep(200);
  await panel.evaluate(() => { const a = [...document.querySelectorAll('#vpanel .how-link')].find((x) => x.closest('.vw-item')?.innerText.includes('Staff recommended $400,000')); a.focus(); });
  await sleep(200);
  const extScrolled = await panel.evaluate(() => Math.round(window.scrollY)); // where the reader is when they follow the link
  await panel.keyboard.press('Enter');
  await panel.waitForSelector('#howWeKnow', { visible: true, timeout: 10000 });
  check('extension: "How do we know?" moves focus to the evidence', await panel.evaluate(() => document.activeElement.id === 'howWeKnow'));
  const extHow = await panel.$eval('#howWeKnow', (e) => e.innerText);
  check('extension: shows the right source, passage, date and location', /memo-2024-02-01\.txt/.test(extHow) && /recommends Ordinance 2024-31 at \$400,000/.test(extHow) && /2024-02-01/.test(extHow) && /p\.1/.test(extHow));
  await shot(panel, 'extension-deepdive-howdoweknow-320.png');
  await panel.evaluate(() => document.querySelector('[data-goto="bigpicture"]').focus());
  await panel.keyboard.press('Enter');
  await panel.waitForFunction(() => document.querySelector('#vt-bigpicture')?.getAttribute('aria-selected') === 'true' && document.querySelector('#vpanel .vw-section'));
  await sleep(300);
  const extRestored = await panel.evaluate(() => Math.round(window.scrollY));
  check('extension: Back returns to the same place', Math.abs(extRestored - extScrolled) <= 40, `${extScrolled} -> ${extRestored}`);
  // Arrow keys move between the three views.
  await panel.focus('#vt-bigpicture');
  await panel.keyboard.press('ArrowRight');
  await panel.waitForFunction(() => document.querySelector('#vt-overview')?.getAttribute('aria-selected') === 'true');
  check('extension: arrow keys switch views and keep focus on the tab', await panel.evaluate(() => document.activeElement.id === 'vt-overview'));

  for (const w of [320, 375, 480, 768]) {
    await panel.setViewport({ width: w, height: 800 });
    for (const view of ['bigpicture', 'overview', 'deepdive']) {
      await panel.click(`#vt-${view}`);
      await panel.waitForFunction((v) => document.querySelector(`#vt-${v}`).getAttribute('aria-selected') === 'true', {}, view);
      await sleep(150);
      const over = await panel.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const v = await axeViolations(panel);
      check(`extension ${view} @${w}px: no horizontal scroll, no axe violations`, over <= 1 && v.length === 0, `overflow=${over} ${v.join(' | ')}`);
    }
  }
  const extSmall = await smallTargets(panel, '#caseDetail');
  check('extension: every control is at least 24x24 CSS px', extSmall.length === 0, JSON.stringify(extSmall.slice(0, 4)));

  // Existing Ask Chronium still works next to the views.
  await panel.setViewport({ width: 375, height: 800 });
  await panel.focus('#askQ');
  await panel.keyboard.type('Which claims have contradictory evidence?');
  await panel.keyboard.press('Enter');
  await panel.waitForFunction(() => /contradicting evidence/i.test(document.querySelector('#askOut').innerText), { timeout: 10000 });
  check('extension: Ask Chronium still answers', /The grant vote was unanimous/.test(await panel.$eval('#askOut', (e) => e.innerText)));
  check('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('test ran without throwing', false, e.stack || e.message);
} finally {
  await b.close();
}
process.exit(failed ? 1 : 0);
