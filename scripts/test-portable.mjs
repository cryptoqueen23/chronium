// Round-trip tests for portable investigation files (public/portable.js +
// public/portableDb.js). Two "devices" are two separate in-memory IndexedDB
// factories running the SAME shipped modules the website and the extension
// both load, so passing here means a file made by one opens in the other.
// No network is touched: fetch is replaced with a function that fails the
// test if anything calls it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

globalThis.fetch = () => { throw new Error('portable import/export must work offline'); };
const web = new IDBFactory();   // "website" device
const ext = new IDBFactory();   // "extension" device
const useDevice = (factory) => { globalThis.indexedDB = factory; resetDbConnection(); };

globalThis.indexedDB = web;
const db = await import('../public/db.js');
const { resetDbConnection } = db;
const portable = await import('../public/portable.js');
const { PortableFileError } = portable;

async function buildCase(name) {
  const inv = await db.createInvestigation({ name, description: 'test case' });
  const rec = await db.saveRecordToInvestigation(inv.id, {
    title: 'Council minutes 2024-05-14', originalUrl: `https://example.gov/${name}/minutes.pdf`, archiveUrl: 'https://web.archive.org/web/2024/x',
    source: 'Wayback', captureDate: '2024-05-14', fileHash: 'hash-abc', storageMode: 'local-copy', extractedText: 'Raymond Payne voted yes.',
    sourceId: await db.getNextSourceId()
  });
  const ev = await db.createEvidenceItem(inv.id, { sourceRecordId: rec.id, excerptType: 'quote', excerptText: 'Raymond Payne voted yes.', location: 'p.2' });
  const a = await db.createEntity(inv.id, { type: 'PERSON', name: 'Raymond Payne' });
  const b = await db.createEntity(inv.id, { type: 'ORGANIZATION', name: 'LFEDC' });
  const rel = await db.createRelationship(inv.id, { sourceEntityId: a.id, targetEntityId: b.id, type: 'BOARD_MEMBER_OF', evidenceIds: [ev.id] });
  const claim = await db.createClaim(inv.id, { text: 'Payne voted to approve the grant.', subjectEntityIds: [a.id] });
  await db.createClaimEvidence(inv.id, { claimId: claim.id, evidenceId: ev.id, stance: 'supports' });
  const finding = await db.createClaimFinding(inv.id, { claimId: claim.id, conclusion: 'Minutes record a yes vote.', classification: 'DOCUMENTED_FACT', evidenceIds: [ev.id] });
  await db.saveBlob({ hash: 'hash-abc', blob: new Blob(['original file bytes']), mimeType: 'application/pdf', size: 19 });
  return { inv, rec, ev, a, b, rel, claim, finding };
}

async function snapshot(invId) {
  return {
    sources: (await db.listInvestigationRecords(invId)).length,
    evidence: (await db.listEvidenceItems(invId)).length,
    claims: (await db.listClaims(invId)).length,
    entities: (await db.listEntities(invId)).length,
    findings: (await db.listClaimFindings(invId)).length
  };
}

let fileText, original;

test('website -> extension: everything survives', async () => {
  useDevice(web);
  original = await buildCase('Larkspur');
  const exported = await portable.exportInvestigationFile(original.inv.id, { includeFiles: true });
  fileText = exported.text;
  assert.match(exported.filename, /^Larkspur\.chronium\.json$/);
  assert.equal(JSON.parse(fileText).version, 1);

  useDevice(ext);
  const local = await db.createInvestigation({ name: 'Existing local case', description: '' });
  const preview = await portable.previewImport(fileText);
  assert.equal(preview.report.investigationExisted, false);
  assert.equal((await db.listInvestigations()).length, 1, 'preview must not write anything');

  const result = await portable.importBundle(preview.bundle);
  assert.equal(result.added.claims, 1);
  assert.deepEqual(await snapshot(original.inv.id), { sources: 1, evidence: 1, claims: 1, entities: 2, findings: 1 });

  const claim = (await db.listClaims(original.inv.id))[0];
  assert.equal(claim.text, 'Payne voted to approve the grant.');
  const links = await db.listClaimEvidenceForClaim(original.inv.id, claim.id);
  assert.equal(links.length, 1);
  assert.equal(links[0].stance, 'supports');
  const rels = await db.listRelationshipsForEntity(original.inv.id, original.a.id);
  assert.equal(rels.length, 1);
  assert.deepEqual(rels[0].evidenceIds, [original.ev.id]);
  const finding = (await db.listClaimFindings(original.inv.id))[0];
  assert.equal(finding.classification, 'DOCUMENTED_FACT');
  const rec = (await db.listInvestigationRecords(original.inv.id))[0];
  assert.equal(rec.fileHash, 'hash-abc');
  assert.equal(rec.archiveUrl, 'https://web.archive.org/web/2024/x');
  const blob = await db.getBlob('hash-abc');
  assert.equal(await blob.blob.text(), 'original file bytes');

  const cases = await db.listInvestigations();
  assert.equal(cases.length, 2, 'existing local case remains');
  assert.ok(cases.find((c) => c.id === local.id && c.name === 'Existing local case'));
});

test('importing the same file twice adds nothing', async () => {
  useDevice(ext);
  const before = await snapshot(original.inv.id);
  const again = await portable.previewImport(fileText);
  const total = Object.values(again.report.added).reduce((x, y) => x + y, 0);
  assert.equal(total, 0, JSON.stringify(again.report.added));
  const res = await portable.importBundle(again.bundle);
  assert.equal(Object.values(res.added).reduce((x, y) => x + y, 0), 0);
  assert.deepEqual(await snapshot(original.inv.id), before);
  assert.equal((await db.listInvestigations()).length, 2);
});

test('extension -> website: a case made in the extension opens on the website', async () => {
  useDevice(ext);
  const made = await buildCase('Extension case');
  const exported = await portable.exportInvestigationFile(made.inv.id);
  useDevice(web);
  const res = await portable.importBundle((await portable.previewImport(exported.text)).bundle);
  assert.equal(res.added.evidenceItems, 1);
  assert.deepEqual(await snapshot(made.inv.id), { sources: 1, evidence: 1, claims: 1, entities: 2, findings: 1 });
  assert.equal(res.added.blobs, undefined, 'no file copies unless requested');
});

test('round trip back to the origin duplicates nothing', async () => {
  useDevice(ext);
  const back = await portable.exportInvestigationFile(original.inv.id);
  useDevice(web);
  const before = await snapshot(original.inv.id);
  const res = await portable.importBundle((await portable.previewImport(back.text)).bundle);
  assert.equal(Object.values(res.added).reduce((x, y) => x + y, 0), 0);
  assert.deepEqual(await snapshot(original.inv.id), before);
});

test('existing local edits are never overwritten (conflict reported, local kept)', async () => {
  useDevice(ext);
  const claim = (await db.listClaims(original.inv.id))[0];
  await db.updateClaim(claim.id, { notes: 'edited on extension' });
  const pv = await portable.previewImport(fileText);
  assert.equal(pv.report.conflicts.claims, 1);
  await portable.importBundle(pv.bundle);
  assert.equal((await db.getClaim(claim.id)).notes, 'edited on extension');
  assert.ok(portable.describeReport(pv.report).join(' ').includes('Your version'));
});

test('clashing source and claim numbers are renumbered, not merged', async () => {
  useDevice(new IDBFactory());
  const local = await buildCase('Other local');         // takes CHR-000001 / CHR-CLAIM-001 here
  const pv = await portable.previewImport(fileText);    // incoming also uses CHR-000001 for a different source
  assert.equal(pv.report.sourceIdsReassigned, 1);
  assert.equal(pv.report.claimIdsReassigned, 1);
  await portable.importBundle(pv.bundle);
  const ids = [...(await db.listInvestigationRecords(local.inv.id)), ...(await db.listInvestigationRecords(original.inv.id))].map((r) => r.sourceId);
  assert.equal(new Set(ids).size, 2);
  const next = await db.getNextSourceId();
  assert.ok(!ids.includes(next), 'next locally issued number is ahead of imported ones');
});

test('same source in two cases is stored once and re-linked', async () => {
  useDevice(new IDBFactory());
  const mine = await db.createInvestigation({ name: 'Mine', description: '' });
  const known = await db.saveRecordToInvestigation(mine.id, { title: 'Minutes', originalUrl: 'https://example.gov/Larkspur/minutes.pdf', sourceId: await db.getNextSourceId() });
  const res = await portable.importBundle((await portable.previewImport(fileText)).bundle);
  assert.equal(res.identical.records, 1);
  const ev = (await db.listEvidenceItems(original.inv.id))[0];
  assert.equal(ev.sourceRecordId, known.id, 'evidence follows the already-known source');
  const linked = await db.listInvestigationRecords(original.inv.id);
  assert.equal(linked.length, 1);
});

test('bad files give understandable errors and change nothing', async () => {
  useDevice(new IDBFactory());
  const cases = [
    ['', /empty/i],
    ['not json {{', /not a Chronium case file/i],
    [JSON.stringify({ hello: 'world' }), /not a Chronium case file/i],
    [JSON.stringify({ format: 'chronium-investigation', version: 99, data: {} }), /newer version/i],
    [JSON.stringify({ format: 'chronium-investigation', version: 1, data: {} }), /missing its case information/i],
    [JSON.stringify({ format: 'chronium-investigation', version: 1, data: { investigation: { id: 'a', name: 'n' }, claims: 'oops' } }), /damaged/i],
    [JSON.stringify({ format: 'chronium-investigation', version: 1, data: { investigation: { id: 'a', name: 'n' }, claims: [{ id: 'c', investigationId: 'OTHER' }] } }), /another case/i],
    [JSON.stringify({ format: 'chronium-investigation', version: 1, data: { investigation: { id: 'a', name: 'n' }, entities: [{ name: 'no id', investigationId: 'a' }] } }), /no id/i]
  ];
  for (const [text, pattern] of cases) {
    await assert.rejects(portable.previewImport(text), (e) => e instanceof PortableFileError && pattern.test(e.message), `case: ${text.slice(0, 40)}`);
  }
  assert.equal((await db.listInvestigations()).length, 0);
});

test('export contains only the case: no other cases, no settings or keys', async () => {
  useDevice(web);
  const { text } = await portable.exportInvestigationFile(original.inv.id);
  const parsed = JSON.parse(text);
  assert.equal(parsed.data.investigation.id, original.inv.id);
  assert.ok(!/Extension case/.test(text), 'other cases must not leak');
  assert.ok(!/api[_-]?key|ANTHROPIC|secret/i.test(text));
  assert.deepEqual(Object.keys(parsed).sort(), ['data', 'exportedAt', 'format', 'includesStoredFiles', 'version']);
});
