// Tests for Big Picture / Overview / Deep Dive (public/views.js): one model,
// three presentations; findings navigate to their evidence; missing is not
// "not reviewed"; ambiguous identities stay unverified; export/import keeps
// every level identical; Ask Chronium and the views agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { buildModel, resolveTarget, bigPictureHtml, overviewHtml, deepDiveHtml, viewHtml } from '../public/views.js';
import { answerQuestion } from '../public/askRouter.js';

let n = 0;
const id = (p) => `${p}-${++n}`;
const INV = 'inv-1';

function fixture() {
  const minutes = { id: id('rec'), title: 'minutes-2024-03-12.txt', extractedText: 'LFEDC Board\nMotion by Smith, seconded by Lee, to approve Ordinance 2024-31 and a grant of $412,000 to Holt Construction LLC. Voted 4-1.', sourceId: 'CHR-000001', fileHash: 'abc123def4567890', sourceType: 'bulk-document', storageMode: 'local-only', originalUrl: null };
  const memo = { id: id('rec'), title: 'memo-2024-02-01.txt', extractedText: 'Staff memo recommends Ordinance 2024-31 at $400,000 for Holt Construction LLC.', sourceId: 'CHR-000002', sourceType: 'bulk-document', originalUrl: null };
  const undated = { id: id('rec'), title: 'notes.txt', extractedText: 'Ordinance 2024-31 notes.', sourceId: 'CHR-000003', originalUrl: 'https://example.gov/notes' };
  const e1 = { id: id('ev'), investigationId: INV, sourceRecordId: minutes.id, excerptText: 'Voted 4-1. Grant of $412,000 to Holt Construction LLC.', excerptType: 'quote', location: 'p.2' };
  const e2 = { id: id('ev'), investigationId: INV, sourceRecordId: memo.id, excerptText: 'recommends Ordinance 2024-31 at $400,000', excerptType: 'quote', location: 'p.1' };
  const ray = { id: id('ent'), investigationId: INV, type: 'PERSON', name: 'Raymond Payne' };
  const org = { id: id('ent'), investigationId: INV, type: 'ORGANIZATION', name: 'LFEDC' };
  const holt = { id: id('ent'), investigationId: INV, type: 'BUSINESS', name: 'Holt Construction LLC' };
  const rel1 = { id: id('rel'), sourceEntityId: ray.id, targetEntityId: org.id, type: 'BOARD_MEMBER_OF', status: 'CONFIRMED', evidenceIds: [e1.id] };
  const rel2 = { id: id('rel'), sourceEntityId: org.id, targetEntityId: holt.id, type: 'GRANT_AWARDED_TO', status: 'PROBABLE', evidenceIds: [e1.id] };
  const c1 = { id: id('claim'), claimId: 'CHR-CLAIM-001', text: 'The grant vote was unanimous.', status: 'UNVERIFIED' };
  const c2 = { id: id('claim'), claimId: 'CHR-CLAIM-002', text: 'The grant was recommended at $400,000.', status: 'SUPPORTED' };
  const c3 = { id: id('claim'), claimId: 'CHR-CLAIM-003', text: 'A second grant was awarded.', status: 'UNVERIFIED' };
  const links = [
    { id: id('l'), claimId: c1.id, evidenceId: e1.id, stance: 'contradicts' },
    { id: id('l'), claimId: c2.id, evidenceId: e2.id, stance: 'supports' }
  ];
  const f1 = { id: id('f'), investigationId: INV, claimId: c2.id, conclusion: 'Staff recommended $400,000 before the vote.', classification: 'DOCUMENTED_FACT', evidenceIds: [e2.id], updatedAt: '2024-05-01' };
  const f2 = { id: id('f'), investigationId: INV, claimId: c1.id, conclusion: 'The vote was not unanimous: it was 4-1.', classification: 'SUPPORTED_INFERENCE', evidenceIds: [e1.id], updatedAt: '2024-05-02' };
  const f3 = { id: id('f'), investigationId: INV, claimId: c3.id, conclusion: 'No second grant record was located.', classification: 'NO_EVIDENCE_LOCATED', evidenceIds: [], updatedAt: '2024-05-03' };
  const f4 = { id: id('f'), investigationId: INV, claimId: c3.id, conclusion: 'Whether the board knew of the earlier memo is unclear.', classification: 'UNRESOLVED_QUESTION', evidenceIds: [], updatedAt: '2024-05-04' };
  return {
    investigation: { id: INV, name: 'Grant review', description: 'Where the grant money went' },
    records: [minutes, memo, undated], investigationRecords: [], evidenceItems: [e1, e2], entities: [ray, org, holt], entityAliases: [],
    relationships: [rel1, rel2], claims: [c1, c2, c3], claimEvidence: links, claimFindings: [f1, f2, f3, f4],
    quantitativeFindings: [{ id: 'q1', statement: 'Awarded amount is $12,000 above the recommendation', formula: '412000 - 400000', method: 'Difference of two quoted amounts' }],
    outlines: [{ investigationId: INV, researchQuestion: 'Who approved the grant and for how much?', lanes: [{ id: 'lane1', label: 'Invoices' }] }],
    ingestionItems: [
      { id: 'i1', status: 'READY_FOR_REVIEW', sourceFilename: 'unread.txt' },
      { id: 'i2', status: 'FAILED', sourceFilename: 'scan.pdf' },
      { id: 'i3', status: 'SKIPPED', sourceFilename: 'copy.txt', metadata: { duplicateOccurrencePath: 'x/copy.txt' } }
    ],
    reviewCandidates: [{ id: 'rc1', investigationId: INV, state: 'AMBIGUOUS', matchedText: 'Payne', candidateEntityIds: [ray.id] }],
    watchlistMatches: [], reviewHistory: [{ id: 'h1', timestamp: '2024-05-05T10:00:00Z', action: 'FLAGGED', actorName: 'Investigator A', note: 'check vote count' }]
  };
}
const hrefs = (html) => [...html.matchAll(/href="#\/workspace\/deepdive\/([^"]+)"/g)].map((m) => decodeURIComponent(m[1].replace(/&amp;/g, '&')));

test('one model feeds all three views: the same findings and counts appear at every level', () => {
  const m = buildModel(fixture());
  const bp = bigPictureHtml(m), ov = overviewHtml(m), dd = deepDiveHtml(m, null);
  assert.equal(m.counts.findings, 4);
  assert.match(bp, /4 findings/);
  assert.match(bp, /3 claims/);
  assert.match(dd, /Claims and their evidence <span class="vw-count">\(3\)/);
  assert.match(dd, /Evidence passages <span class="vw-count">\(2\)/);
  assert.match(dd, /Source documents <span class="vw-count">\(3\)/);
  // The same discrepancy is named in all three levels.
  for (const html of [bp, ov, dd]) assert.match(html, /The grant vote was unanimous/);
  // The same relationships appear in Overview and resolve in Deep Dive.
  assert.match(ov, /Raymond Payne — board member of — LFEDC/);
  for (const r of m.relationships) assert.ok(resolveTarget(m, `relationship/${r.id}`));
});

test('every "How do we know?" link resolves to real evidence in Deep Dive', () => {
  const m = buildModel(fixture());
  const all = [...hrefs(bigPictureHtml(m)), ...hrefs(overviewHtml(m))];
  assert.ok(all.length >= 8, `expected many links, got ${all.length}`);
  for (const t of all) {
    const r = resolveTarget(m, t);
    assert.ok(r, `target ${t} did not resolve`);
    const html = deepDiveHtml(m, t);
    assert.match(html, /id="howWeKnow"/);
    assert.match(html, /How do we know\?/);
  }
});

test('a finding opens its own source, passage, date, location and limits', () => {
  const m = buildModel(fixture());
  const f = m.findings.find((x) => x.classification === 'DOCUMENTED_FACT');
  const html = deepDiveHtml(m, `finding/${f.id}`);
  assert.match(html, /memo-2024-02-01\.txt/);
  assert.match(html, /recommends Ordinance 2024-31 at \$400,000/);
  assert.match(html, /p\.1/);
  assert.match(html, /2024-02-01/);
  // the vote finding's source is a file Chronium does not keep a copy of
  const vote = m.findings.find((x) => x.classification === 'SUPPORTED_INFERENCE');
  const vh = deepDiveHtml(m, `finding/${vote.id}`);
  assert.match(vh, /does not keep a copy/);
  assert.match(vh, /inference drawn from the evidence/);
  assert.match(vh, /contradicts the related claim/);
});

test('missing, not reviewed yet, and unresolved are kept apart', () => {
  const m = buildModel(fixture());
  assert.ok(m.questions.missing.some((q) => /No second grant record/.test(q.text)));
  assert.ok(m.questions.missing.some((q) => /scan\.pdf/.test(q.text)), 'unreadable file counts as missing content');
  assert.ok(m.questions.missing.some((q) => /Invoices/.test(q.text)), 'empty outline section counts as missing');
  assert.ok(m.questions.notReviewed.some((q) => /1 imported document/.test(q.text)));
  assert.ok(m.questions.notReviewed.some((q) => /could be more than one person/.test(q.text)));
  assert.ok(m.questions.unresolved.some((q) => /unclear/.test(q.text)));
  assert.ok(!m.questions.missing.some((q) => /unclear/.test(q.text)) && !m.questions.unresolved.some((q) => /No second grant/.test(q.text)));
  const bp = bigPictureHtml(m);
  assert.match(bp, /Missing: nothing was located/);
  assert.match(bp, /Not reviewed yet: material exists, nobody has looked/);
  assert.match(bp, /Unresolved: looked at, evidence is not enough/);
  // duplicates are not reported as unreadable
  assert.ok(!m.questions.missing.some((q) => /copy\.txt/.test(q.text)));
  assert.equal(m.coverage.duplicates, 1);
});

test('ambiguous identities stay unverified: a name match is never shown as a person or a connection', () => {
  const snap = fixture();
  const m = buildModel(snap);
  const bp = bigPictureHtml(m), ov = overviewHtml(m), dd = deepDiveHtml(m, null);
  assert.match(bp, /1 possible name match is unconfirmed, 1 of which could be more than one person/);
  assert.match(bp, /does not identify a person/);
  assert.equal(m.people.ambiguousMatches, 1);
  // The candidate text "Payne" produced no relationship, timeline entry, or finding.
  assert.ok(!/Payne/.test(ov.replace(/Raymond Payne/g, '')), 'only the full registered name appears');
  assert.ok(!m.relationships.some((r) => r.from === 'Payne' || r.to === 'Payne'));
  assert.ok(!/Payne/.test(dd.replace(/Raymond Payne/g, '')));
});

test('money and people connections are separate, evidence-backed, and carry their status', () => {
  const m = buildModel(fixture());
  const ov = overviewHtml(m);
  assert.match(ov, /Money connections[\s\S]*LFEDC — grant awarded to — Holt Construction LLC[\s\S]*Status: probable/);
  assert.ok(m.relationships.every((r) => r.sources.length >= 1));
  const noEvidence = fixture();
  noEvidence.relationships[0].evidenceIds = [];
  const x = resolveTarget(buildModel(noEvidence), `relationship/${noEvidence.relationships[0].id}`);
  assert.match(x.limitations.join(' '), /No evidence passage is attached/);
});

test('timeline is an ordered text list with real dates; votes are found by wording only', () => {
  const m = buildModel(fixture());
  const ov = overviewHtml(m);
  assert.match(ov, /<ul class="vw-list">/);
  const dates = [...ov.matchAll(/<time datetime="([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(dates, [...dates].sort());
  assert.ok(dates.includes('2024-03-12') && dates.includes('2024-02-01'));
  assert.equal(m.votes.length, 1);
  assert.match(ov, /Chronium does not interpret outcomes/);
  assert.ok(!/<svg|<canvas|<img/.test(bigPictureHtml(m) + ov + deepDiveHtml(m, null)), 'no graphic-only content');
});

test('figures are quoted, labelled, and never totalled; calculations show formula and assumptions', () => {
  const m = buildModel(fixture());
  const bp = bigPictureHtml(m), dd = deepDiveHtml(m, null);
  assert.match(bp, /\$412,000/);
  assert.match(bp, /not added together/);
  assert.match(dd, /412000 - 400000/);
  assert.match(dd, /Method and assumptions: Difference of two quoted amounts/);
  assert.ok(!/\$812,000/.test(bp + dd));
});

test('empty case and missing target are handled plainly', () => {
  const empty = buildModel({ investigation: { id: 'e', name: 'New' }, records: [], evidenceItems: [], claims: [] });
  assert.equal(empty.empty, true);
  for (const v of ['bigpicture', 'overview', 'deepdive']) assert.match(viewHtml(v, empty, null), /nothing in it yet/);
  const m = buildModel(fixture());
  assert.match(deepDiveHtml(m, 'finding/does-not-exist'), /no longer in this case/);
});

test('all text from the case is escaped', () => {
  const snap = fixture();
  snap.claimFindings[0].conclusion = '<img src=x onerror=alert(1)> Staff recommended';
  snap.records[0].title = '<script>x</script>.txt';
  const m = buildModel(snap);
  const all = bigPictureHtml(m) + overviewHtml(m) + deepDiveHtml(m, `finding/${snap.claimFindings[0].id}`);
  assert.ok(!all.includes('<img src=x') && !all.includes('<script>'));
});

test('Ask Chronium and the views agree on what still needs attention', () => {
  const snap = fixture();
  const m = buildModel(snap);
  const ask = answerQuestion("What haven't we reviewed yet?", snap, {});
  const askText = JSON.stringify(ask);
  assert.match(askText, /1 imported document/);
  assert.match(askText, /1 possible name match/);
  assert.match(askText, /1 duplicate file/);
  assert.ok(m.questions.notReviewed.some((q) => /1 imported document/.test(q.text)));
  assert.equal(m.coverage.duplicates, 1);
  const contradicted = answerQuestion('Which claims have contradictory evidence?', snap, {});
  assert.equal(contradicted.items.length, m.discrepancies.length);
});

test('export then import into a fresh device gives identical views at every level', async () => {
  globalThis.indexedDB = new IDBFactory();
  const db = await import('../public/db.js');
  const portable = await import('../public/portable.js');
  const portableDb = await import('../public/portableDb.js');
  const inv = await db.createInvestigation({ name: 'Round trip', description: 'check' });
  const rec = await db.saveRecordToInvestigation(inv.id, { title: 'minutes-2024-03-12.txt', originalUrl: 'https://example.gov/m', sourceId: await db.getNextSourceId(), fileHash: 'h1', extractedText: 'Motion seconded. Voted 4-1. Grant of $412,000 to Holt Construction LLC under Ordinance 2024-31.' });
  const ev = await db.createEvidenceItem(inv.id, { sourceRecordId: rec.id, excerptType: 'quote', excerptText: 'Voted 4-1. Grant of $412,000.', location: 'p.2' });
  const claim = await db.createClaim(inv.id, { text: 'The vote was unanimous.' });
  await db.createClaimEvidence(inv.id, { claimId: claim.id, evidenceId: ev.id, stance: 'contradicts' });
  await db.createClaimFinding(inv.id, { claimId: claim.id, conclusion: 'It was 4-1.', classification: 'DOCUMENTED_FACT', evidenceIds: [ev.id] });
  const before = buildModel(await portableDb.readInvestigationForExport(inv.id));
  const { text } = await portable.exportInvestigationFile(inv.id);

  globalThis.indexedDB = new IDBFactory();
  db.resetDbConnection();
  await portable.importBundle((await portable.previewImport(text)).bundle);
  const after = buildModel(await portableDb.readInvestigationForExport(inv.id));
  assert.deepEqual(JSON.parse(JSON.stringify(after)), JSON.parse(JSON.stringify(before)));
  for (const v of ['bigpicture', 'overview', 'deepdive']) assert.equal(viewHtml(v, after, null), viewHtml(v, before, null), v);
  assert.equal(before.counts.findings, 1);
});
