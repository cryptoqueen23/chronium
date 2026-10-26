// Stage 0 / B3: the production database (version 4) must never be upgraded merely to show a backup prompt; a backup
// made before the upgrade must restore after it; an upgrade that fails part-way must leave the old data untouched
// and retryable; and the old application cannot reopen the upgraded database (documented, tested).
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
const tmp = path.join(root, 'public', '_db_production_safety_test.js');
const skip = !oldSrc;
const rawVersion = (factory) => new Promise((resolve) => { const r = factory.open('chronium'); r.onupgradeneeded = () => { r.transaction.abort(); resolve(0); }; r.onsuccess = () => { const v = r.result.version; r.result.close(); resolve(v); }; r.onerror = () => resolve(0); });

async function makeProductionDb() {
  fs.writeFileSync(tmp, `${oldSrc}\nexport const _close = async () => { if (dbPromise) { (await dbPromise).close(); dbPromise = null; } };\nexport const _open = () => openDb();\n`);
  globalThis.indexedDB = new IDBFactory();
  const old = await import(pathToFileURL(tmp).href + `?${Math.random()}`);
  const inv = await old.createInvestigation({ name: 'Case on the live site', description: 'x' });
  const rec = await old.saveRecordToInvestigation(inv.id, { title: 'Council minutes', originalUrl: 'https://example.gov/m.pdf', source: 'Wayback', snippet: 'Raymond Payne voted yes.' });
  await old.saveBlob({ hash: 'hash-1', blob: new Blob(['original file bytes']), mimeType: 'application/pdf', size: 19 });
  const ev = await old.createEvidenceItem(inv.id, { sourceRecordId: rec.id, excerptType: 'quote', excerptText: 'Raymond Payne voted yes.', location: 'p.2' });
  await old.createClaim(inv.id, { text: 'Payne voted to approve.', links: [{ evidenceItemId: ev.id, stance: 'supports' }] });
  await old._close();
  return { inv, rec, ev };
}

test('inspecting the production database does NOT upgrade it, and a missing database is not created', { skip }, async () => {
  try {
    const { pendingUpgrade } = await import('../public/upgrade.js');
    globalThis.indexedDB = new IDBFactory();
    const none = await pendingUpgrade();
    assert.equal(none.pending, false); assert.equal(none.hasData, false);
    assert.equal(await rawVersion(globalThis.indexedDB), 0, 'no database was created by looking');
    await makeProductionDb();
    assert.equal(await rawVersion(globalThis.indexedDB), 4);
    const info = await pendingUpgrade();
    assert.equal(info.pending, true); assert.equal(info.fromVersion, 4); assert.equal(info.toVersion, 12); assert.equal(info.hasData, true);
    assert.equal(info.counts.investigations, 1); assert.equal(info.counts.records, 1); assert.equal(info.counts.evidenceItems, 1);
    assert.equal(await rawVersion(globalThis.indexedDB), 4, 'still version 4 after inspecting: the prompt does not upgrade');
  } finally { fs.rmSync(tmp, { force: true }); }
});

test('backup, upgrade, loss and restore: nothing is lost', { skip }, async () => {
  try {
    const { buildRawBackup, parseBackupText, restoreRawBackup, backupFileName } = await import('../public/upgrade.js');
    const made = await makeProductionDb();
    const backup = await buildRawBackup();
    assert.equal(backup.dbVersion, 4); assert.equal(backup.counts.investigations, 1); assert.equal(backup.counts.records, 1); assert.equal(backup.counts.blobs, 1);
    assert.equal(await rawVersion(globalThis.indexedDB), 4, 'making the backup did not upgrade');
    assert.match(backupFileName(backup), /^chronium-backup-\d{4}-\d{2}-\d{2}-v4\.json$/);
    const parsed = parseBackupText(JSON.stringify(backup)); // exactly what is written to the file
    const db = await import('../public/db.js'); db.resetDbConnection();
    const opened = await db.openDb(); assert.equal(opened.version, 12); opened.close(); db.resetDbConnection();
    const portableDb = await import('../public/portableDb.js');
    const after = await portableDb.readInvestigationForExport(made.inv.id);
    assert.equal(after.records.length, 1); assert.equal(after.evidenceItems.length, 1);
    // lose everything (a cleared browser), then restore from the file
    await new Promise((resolve) => { const r = globalThis.indexedDB.deleteDatabase('chronium'); r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve; });
    db.resetDbConnection();
    const report = await restoreRawBackup(parsed, { openCurrentDb: () => db.openDb() });
    assert.equal(report.added.investigations, 1); assert.equal(report.added.records, 1); assert.equal(report.added.blobs, 1);
    const restored = await portableDb.readInvestigationForExport(made.inv.id);
    assert.equal(restored.investigation.name, 'Case on the live site'); assert.equal(restored.records[0].title, 'Council minutes'); assert.equal(restored.evidenceItems[0].excerptText, 'Raymond Payne voted yes.');
    const blob = await db.getBlob('hash-1'); assert.equal(await blob.blob.text(), 'original file bytes', 'stored files come back byte for byte');
    const again = await restoreRawBackup(parsed, { openCurrentDb: () => db.openDb() });
    assert.equal(Object.values(again.added).reduce((a, b) => a + b, 0), 0, 'restoring twice adds nothing'); assert.equal(again.kept.records, 1);
    const { buildModel } = await import('../public/views.js'); assert.ok(buildModel(restored), 'the restored data works with the current features');
  } finally { fs.rmSync(tmp, { force: true }); }
});

test('restoring never overwrites newer work done after the backup', { skip }, async () => {
  try {
    const { buildRawBackup, parseBackupText, restoreRawBackup } = await import('../public/upgrade.js');
    const made = await makeProductionDb();
    const backup = parseBackupText(JSON.stringify(await buildRawBackup()));
    const db = await import('../public/db.js'); db.resetDbConnection();
    await db.updateRecord(made.rec.id, { title: 'Edited after the backup' });
    await restoreRawBackup(backup, { openCurrentDb: () => db.openDb() });
    const rows = await db.listInvestigationRecords(made.inv.id);
    assert.equal(rows[0].title, 'Edited after the backup');
  } finally { fs.rmSync(tmp, { force: true }); }
});

test('backup files are validated: damaged, foreign and newer files are refused with a plain message', async () => {
  const { parseBackupText, BackupFileError } = await import('../public/upgrade.js');
  for (const bad of ['', 'not json', '{}', '{"format":"other"}', JSON.stringify({ format: 'chronium-raw-backup', backupVersion: 99, stores: {} }), JSON.stringify({ format: 'chronium-raw-backup', backupVersion: 1 }), JSON.stringify({ format: 'chronium-raw-backup', backupVersion: 1, stores: { records: { rows: 'x' } } })]) {
    assert.throws(() => parseBackupText(bad), BackupFileError, bad.slice(0, 40));
  }
  let msg = ''; try { parseBackupText(JSON.stringify({ format: 'chronium-raw-backup', backupVersion: 99, stores: {} })); } catch (e) { msg = e.message; }
  assert.match(msg, /newer version/);
});

test('an interrupted upgrade leaves the old data untouched and can be retried', { skip }, async () => {
  try {
    const made = await makeProductionDb();
    const db = await import('../public/db.js'); db.resetDbConnection();
    const sample = await new Promise((res) => { const r = globalThis.indexedDB.open('probe'); r.onsuccess = () => { const d = r.result; d.close(); res(d); }; });
    const proto = Object.getPrototypeOf(sample);
    const original = proto.createObjectStore;
    proto.createObjectStore = function patched(name, opts) { if (name === 'recoveryRequests') throw new Error('simulated crash during the upgrade'); return original.call(this, name, opts); };
    try { await assert.rejects(() => db.openDb(), 'the upgrade fails'); } finally { proto.createObjectStore = original; }
    assert.equal(await rawVersion(globalThis.indexedDB), 4, 'a failed upgrade leaves the database at version 4');
    const { pendingUpgrade, buildRawBackup } = await import('../public/upgrade.js');
    const info = await pendingUpgrade(); assert.equal(info.pending, true); assert.equal(info.counts.records, 1, 'the data is all still there');
    assert.equal((await buildRawBackup()).counts.evidenceItems, 1);
    db.resetDbConnection();
    const ok = await db.openDb(); assert.equal(ok.version, 12, 'the retry succeeds'); ok.close(); db.resetDbConnection();
    const portableDb = await import('../public/portableDb.js');
    assert.equal((await portableDb.readInvestigationForExport(made.inv.id)).records.length, 1);
  } finally { fs.rmSync(tmp, { force: true }); }
});

test('an old application cannot reopen the upgraded database (one-way door, documented)', { skip }, async () => {
  try {
    await makeProductionDb();
    const db = await import('../public/db.js'); db.resetDbConnection(); (await db.openDb()).close(); db.resetDbConnection();
    const old2 = await import(pathToFileURL(tmp).href + '?again');
    await assert.rejects(() => old2._open(), (e) => /version/i.test(String(e && (e.name || e.message))));
    assert.equal(await rawVersion(globalThis.indexedDB), 12, 'the data is intact at version 12');
  } finally { fs.rmSync(tmp, { force: true }); }
});
