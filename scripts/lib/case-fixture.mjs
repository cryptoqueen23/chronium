// Shared fixture for browser tests: builds a small but complete case (sources, evidence,
// subjects, evidence-backed relationships, claims with a contradiction, findings of three
// kinds) through a page's own db.js. Runs inside the page via page.evaluate(BUILD, dbPath, name).
export const BUILD = async (dbPath, name) => {
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
