// A browser that already holds data from the PRODUCTION app (database version 4, commit d80ef66) must open it
// with the current code (version 12) with nothing lost, and the current features must work on it. Also records
// what happens if the website is rolled back after that upgrade (it is a one-way door).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let oldSrc = null;
try { oldSrc = execFileSync('git', ['show', 'd80ef66:public/db.js'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* no history */ }
const tmp = path.join(root, 'public', '_db_production_for_test.js');

test('upgrade from the production database (version 4) to the current one (version 12)', { skip: !oldSrc }, async () => {
  assert.match(oldSrc, /DB_VERSION = 4/);
  // The production module does not export its connection; the test copy gains two helpers so the test can close it and try to reopen it.
  fs.writeFileSync(tmp, `${oldSrc}\nexport const _open = () => openDb();\nexport const _close = async () => { if (dbPromise) { (await dbPromise).close(); dbPromise = null; } };\n`);
  try {
    globalThis.indexedDB = new IDBFactory();
    const old = await import(pathToFileURL(tmp).href);
    const inv = await old.createInvestigation({ name: 'Case made on the live site', description: 'before the upgrade' });
    const rec = await old.saveRecordToInvestigation(inv.id, { title: 'Council minutes', originalUrl: 'https://example.gov/m.pdf', archiveUrl: 'https://web.archive.org/web/2024/x', source: 'Wayback', captureDate: '2024-05-14', snippet: 'Raymond Payne voted yes.' });
    const made = { evidence: null, claim: null };
    if (old.createEvidenceItem) made.evidence = await old.createEvidenceItem(inv.id, { sourceRecordId: rec.id, excerptType: 'quote', excerptText: 'Raymond Payne voted yes.', location: 'p.2' });
    made.claim = await old.createClaim(inv.id, { text: 'Payne voted to approve.', links: [{ evidenceItemId: made.evidence.id, stance: 'supports' }] });
    if (old.saveOutline) await old.saveOutline(inv.id, { researchQuestion: 'Who voted?', method: 'mixed' });
    await old._close();

    const db = await import('../public/db.js');
    db.resetDbConnection();
    const portableDb = await import('../public/portableDb.js');
    const snap = await portableDb.readInvestigationForExport(inv.id);
    assert.ok(snap, 'the case opens');
    assert.equal(snap.investigation.name, 'Case made on the live site');
    assert.equal(snap.records.length, 1); assert.equal(snap.records[0].title, 'Council minutes'); assert.equal(snap.records[0].archiveUrl, 'https://web.archive.org/web/2024/x');
    if (made.evidence) assert.equal(snap.evidenceItems.length, 1);
    if (made.claim) assert.equal(snap.claims.length, 1);
    assert.equal((snap.outlines[0] || {}).researchQuestion, 'Who voted?');
    // The current features work on that old data.
    const { buildModel } = await import('../public/views.js');
    const { buildRecoveryModel } = await import('../public/recovery/model.js');
    const model = buildModel(snap); const rec2 = buildRecoveryModel(snap);
    assert.ok(model && rec2.counts.sources === 1);
    assert.deepEqual(snap.discoveryRuns, []); assert.deepEqual(snap.recoveryReviews, []);
    const store = await import('../public/recovery/store.js');
    await store.addReview(inv.id, { itemKey: 'G1|x', decision: 'acknowledged', note: '', investigatorId: 'i' });
    assert.equal((await store.listReviews(inv.id)).length, 1);
    const portable = await import('../public/portable.js');
    const exp = await portable.exportInvestigationFile(inv.id);
    assert.ok(exp.text.includes('Case made on the live site'));
    (await db.openDb()).close(); db.resetDbConnection();

    // Rolling the website back to the production code AFTER this upgrade is refused by the browser (a database
    // cannot be opened at a lower version than it has). The data is untouched; the old app just cannot open it.
    const old2 = await import(pathToFileURL(tmp).href + '?second');
    await assert.rejects(() => old2._open(), (e) => /version/i.test(String(e && (e.name || e.message))), 'the old code cannot open a version-12 database');
  } finally { fs.rmSync(tmp, { force: true }); }
});
