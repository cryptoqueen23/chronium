// Independent tests for Ask Chronium (public/askRouter.js), beyond the 12-question
// acceptance benchmark: ambiguity, contradictory evidence, incomplete records,
// empty investigations, and "never invent" cases. Pure functions over a
// hand-built snapshot - no IndexedDB, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion, routeQuestion, resolveSubject, subjectPhrases, documentDate } from '../public/askRouter.js';
import { answerHtml } from '../public/askRender.js';

const INV = 'inv1';
let n = 0;
const id = (p) => `${p}-${++n}`;
function rec(title, text, extra = {}) { return { id: id('rec'), title, extractedText: text, originalUrl: `https://example.gov/${title}`, sourceId: `CHR-${String(n).padStart(6, '0')}`, ...extra }; }
function snap(parts = {}) {
  return { records: [], evidenceItems: [], claims: [], claimEvidence: [], claimFindings: [], entities: [], entityAliases: [], relationships: [], entityMentions: [], ingestionItems: [], reviewCandidates: [], watchlistMatches: [], outlines: [], ...parts };
}
const ent = (type, name) => ({ id: id('ent'), investigationId: INV, type, name });

test('routing: investigative intents are recognised, plain searches fall through', () => {
  const cases = [
    ["What haven't we reviewed yet?", 'progress'],
    ['Which claims have contradictory evidence?', 'claims-contradicted'],
    ['What evidence contradicts that claim?', 'claim-evidence'],
    ['What changed before and after this vote?', 'before-after'],
    ['What organizations is Raymond Payne connected to?', 'relationships'],
    ['Show me evidence for each connection.', 'relationships'],
    ['Show me all payments involving the Historical Society.', 'financial'],
    ['Who repeatedly appears in EDC records?', 'frequency'],
    ['Did Raymond Payne serve on City Council?', 'verify'],
    ['Show me every record mentioning Raymond Payne.', 'discovery'],
    ['Show me everything involving Ordinance 2026-29.', 'discovery'],
    ['', 'empty']
  ];
  for (const [q, intent] of cases) assert.equal(routeQuestion(q).intent, intent, q);
});

test('empty investigation: every intent says there is nothing to search, never invents', () => {
  const empty = snap();
  for (const q of ['Show all payments to Acme', 'What changed before and after this vote?', 'Who repeatedly appears in EDC records?', 'Did Ana Cruz approve it?', 'Which claims have contradictory evidence?']) {
    const a = answerQuestion(q, empty, {});
    assert.equal(a.state, 'NO_EVIDENCE_LOCATED', q);
    assert.equal(a.items.length, 0, q);
    assert.ok(a.missing.length, q);
  }
  const progress = answerQuestion("What haven't we reviewed yet?", empty, {});
  assert.equal(progress.state, 'NO_EVIDENCE_LOCATED');
});

test('surname safety: a shared surname never resolves to one verified person', () => {
  const a = ent('PERSON', 'Raymond Payne'), b = ent('PERSON', 'Marc Payne');
  const s = snap({ entities: [a, b], records: [rec('m', 'Payne voted yes.')] });
  const ix = resolveFor(s, 'What organizations is Payne connected to?');
  assert.equal(ix.status, 'ambiguous');
  const ans = answerQuestion('What organizations is Payne connected to?', s, {});
  assert.equal(ans.state, 'NEEDS_CLARIFICATION');
  assert.equal(ans.clarification.options.length, 2);
  // Only one registered Payne: still "possible", with an explicit caveat.
  const solo = snap({ entities: [a], records: [rec('m', 'Payne voted yes.')] });
  const r = resolveFor(solo, 'Where is Payne mentioned in connections?');
  assert.equal(r.status, 'possible');
  assert.match(r.caveat, /not a verified identity/);
  // Full registered name is a registered match.
  assert.equal(resolveFor(s, 'connections of Raymond Payne').status, 'registered');
});
function resolveFor(s, q) {
  // Re-use the public API through a throwaway answer so the index is built the same way.
  const ix = { snap: s, aliasesByEntity: new Map(), entityById: new Map(s.entities.map((e) => [e.id, e])) };
  return resolveSubject(ix, q);
}

test('relationships: only evidence-backed connections are listed; co-occurrence is a lead, not a connection', () => {
  const ray = ent('PERSON', 'Raymond Payne'), org = ent('ORGANIZATION', 'LFEDC'), other = ent('ORGANIZATION', 'Historical Society');
  const r1 = rec('minutes.txt', 'Raymond Payne sits on the LFEDC board.');
  const r2 = rec('flyer.txt', 'Raymond Payne attended the Historical Society dinner.');
  const ev = { id: id('ev'), sourceRecordId: r1.id, excerptText: 'Raymond Payne sits on the LFEDC board.', location: 'p.1' };
  const rel = { id: id('rel'), sourceEntityId: ray.id, targetEntityId: org.id, type: 'BOARD_MEMBER_OF', status: 'CONFIRMED', evidenceIds: [ev.id] };
  const s = snap({ entities: [ray, org, other], records: [r1, r2], evidenceItems: [ev], relationships: [rel] });
  const a = answerQuestion('What organizations is Raymond Payne connected to?', s, {});
  assert.equal(a.state, 'DOCUMENTED_FACT');
  const recorded = a.items.filter((i) => i.state !== 'UNRESOLVED_QUESTION');
  assert.equal(recorded.length, 1);
  assert.ok(recorded[0].sources.length >= 1, 'every connection cites its evidence');
  const leads = a.items.filter((i) => i.state === 'UNRESOLVED_QUESTION');
  assert.ok(leads.some((l) => /Historical Society/.test(l.heading)));
  assert.ok(leads.every((l) => /lead, not a recorded relationship/.test(l.body)));
});

test('relationships: none recorded -> says so, does not infer from text', () => {
  const ray = ent('PERSON', 'Raymond Payne');
  const s = snap({ entities: [ray], records: [rec('a', 'Raymond Payne and Acme Corp signed.')] });
  const a = answerQuestion('What is Raymond Payne connected to?', s, {});
  assert.equal(a.state, 'NO_EVIDENCE_LOCATED');
  assert.equal(a.items.length, 0);
});

test('claims: contradictions are listed with both sides; "that claim" needs a referent', () => {
  const r1 = rec('minutes', 'Payne served on council.'), r2 = rec('roster', 'Payne was not on the council roster.');
  const e1 = { id: id('ev'), sourceRecordId: r1.id, excerptText: 'Payne served on council.' };
  const e2 = { id: id('ev'), sourceRecordId: r2.id, excerptText: 'Payne was not on the council roster.' };
  const c1 = { id: id('claim'), claimId: 'CHR-CLAIM-001', text: 'Payne served on the council.', status: 'UNVERIFIED' };
  const c2 = { id: id('claim'), claimId: 'CHR-CLAIM-002', text: 'The grant was approved.', status: 'UNVERIFIED' };
  const links = [
    { id: id('l'), claimId: c1.id, evidenceId: e1.id, stance: 'supports' },
    { id: id('l'), claimId: c1.id, evidenceId: e2.id, stance: 'contradicts' }
  ];
  const s = snap({ records: [r1, r2], evidenceItems: [e1, e2], claims: [c1, c2], claimEvidence: links });
  const list = answerQuestion('Which claims have contradictory evidence?', s, {});
  assert.equal(list.items.length, 1);
  assert.ok(list.items[0].sources.some((x) => x.stance === 'contradicts'));
  assert.ok(list.items[0].sources.some((x) => x.stance === 'supports'), 'both sides shown');

  // Two claims, no prior context: ask which one.
  const amb = answerQuestion('What evidence contradicts that claim?', s, {});
  assert.equal(amb.state, 'NEEDS_CLARIFICATION');
  // With context from the previous question, it resolves.
  const withCtx = answerQuestion('What evidence contradicts that claim?', s, list.context);
  assert.equal(withCtx.state, 'DOCUMENTED_FACT');
  assert.equal(withCtx.items[0].sources.length, 1);
  assert.match(withCtx.items[0].sources[0].excerpt, /not on the council roster/);
  // A claim with no contradicting link says so rather than guessing.
  const none = answerQuestion('What evidence contradicts that claim?', s, { lastClaimId: c2.id });
  assert.equal(none.state, 'NO_EVIDENCE_LOCATED');
  assert.ok(none.missing.some((m) => /linked evidence only/.test(m)));
});

test('financial: amounts are quoted with sources, never summed; absence is not proof', () => {
  const r1 = rec('minutes.txt', 'Item 4\nApproved payment of $12,500.00 to Holt Construction LLC for the plaza.\nItem 5');
  const r2 = rec('invoice.txt', 'Invoice HC-0091\nHolt Construction LLC\nAmount due: $12,500.00');
  const r3 = rec('agenda.txt', 'Historical Society tour of the museum.');
  const s = snap({ records: [r1, r2, r3] });
  const a = answerQuestion('Show me all payments involving Holt Construction.', s, {});
  assert.equal(a.state, 'DOCUMENTED_FACT');
  assert.ok(a.items.length >= 1);
  assert.ok(a.items.every((i) => i.sources.length === 1 && /\$12,500/.test(i.heading)));
  assert.ok(a.missing.some((m) => /not added together/.test(m)));
  const none = answerQuestion('Show me all payments involving the Historical Society.', s, {});
  assert.equal(none.state, 'NO_EVIDENCE_LOCATED');
  assert.ok(none.missing.some((m) => /does not show that no payment was made/.test(m)));
  const absent = answerQuestion('Show me all payments involving Acme Roofing.', s, {});
  assert.equal(absent.state, 'NO_EVIDENCE_LOCATED');
  assert.match(absent.summary, /does not appear in any saved document/);
});

test('before/after: several votes -> clarification; none -> refuses; one -> dated comparison', () => {
  const v1 = rec('minutes-2024-03-12.txt', 'LFEDC Board\nMotion by Smith, seconded by Lee, to approve Ordinance 2024-31. Voted 5-0.');
  const v2 = rec('minutes-2024-05-14.txt', 'LFEDC Board\nMotion to approve the budget amendment, seconded. Voted 4-1.');
  const before = rec('memo-2024-02-01.txt', 'Staff memo recommends Ordinance 2024-31 at $400,000.');
  const after = rec('invoice-2024-04-20.txt', 'Invoice referencing Ordinance 2024-31 for $412,000.');
  const noVotes = snap({ records: [before, after] });
  const refuse = answerQuestion('What changed before and after this vote?', noVotes, {});
  assert.equal(refuse.state, 'NO_EVIDENCE_LOCATED');
  assert.match(refuse.summary, /needs a specific vote/);
  assert.equal(refuse.items.length, 0, 'no comparison is invented');

  const both = snap({ records: [v1, v2, before, after] });
  const ask = answerQuestion('What changed before and after this vote?', both, {});
  assert.equal(ask.state, 'NEEDS_CLARIFICATION');
  assert.equal(ask.clarification.options.length, 2);
  assert.equal(ask.items.length, 0);

  const follow = answerQuestion(ask.clarification.options[0].followUp, both, {});
  assert.equal(follow.state, 'DOCUMENTED_FACT');
  const headings = follow.items.map((i) => i.heading).join(' | ');
  assert.match(headings, /memo-2024-02-01/);
  assert.match(headings, /invoice-2024-04-20/);
  assert.ok(follow.items.find((i) => /memo-2024-02-01/.test(i.heading)).body.startsWith('Before the vote'));
  assert.ok(follow.items.find((i) => /invoice-2024-04-20/.test(i.heading)).body.startsWith('After the vote'));
  assert.match(follow.summary, /does not conclude that the vote caused/);

  // Naming the item in the question narrows to one vote without asking.
  const named = answerQuestion('What changed before and after the vote on Ordinance 2024-31?', both, {});
  assert.equal(named.state, 'DOCUMENTED_FACT');
});

test('before/after: a vote with no readable date is not compared', () => {
  const v = rec('minutes', 'Motion to approve Ordinance 9. Voted 3-0.');
  const a = answerQuestion('What changed before and after the vote on Ordinance 9?', snap({ records: [v, rec('other', 'Ordinance 9 text')] }), {});
  assert.equal(a.state, 'UNRESOLVED_QUESTION');
  assert.match(a.summary, /no date could be read/);
});

test('progress: counts come from the case, failed files are reported as unsearchable', () => {
  const r = rec('a', 'text');
  const s = snap({
    records: [r],
    ingestionItems: [{ id: 'i1', status: 'READY_FOR_REVIEW', title: 'a.txt', recordId: r.id }, { id: 'i2', status: 'REVIEWED', title: 'b.txt' }, { id: 'i3', status: 'FAILED', title: 'scan.pdf' }],
    reviewCandidates: [{ id: 'c1', state: 'AMBIGUOUS', matchedText: 'Payne' }, { id: 'c2', state: 'CONFIRMED', matchedText: 'Lee' }],
    claims: [{ id: 'cl1', claimId: 'CHR-CLAIM-001', text: 'X happened', status: 'UNVERIFIED' }]
  });
  const a = answerQuestion("What haven't we reviewed yet?", s, {});
  assert.equal(a.state, 'COMPUTED');
  const text = JSON.stringify(a);
  assert.match(text, /1 imported document/);
  assert.match(text, /1 possible name match/);
  assert.match(text, /1 of 1 claim/);
  assert.match(a.missing.join(' '), /scan\.pdf/);
});

test('frequency: registered people are verified-by-registration; pattern names are labelled unverified', () => {
  const ana = ent('PERSON', 'Ana Ruiz');
  const docs = ['a', 'b', 'c'].map((t, i) => rec(`edc-${t}.txt`, `EDC meeting. Present: Ana Ruiz, Tom Baker. Item ${i}.`));
  const other = rec('parks.txt', 'Parks board. Ana Ruiz attended.');
  const a = answerQuestion('Who repeatedly appears in EDC records?', snap({ entities: [ana], records: [...docs, other] }), {});
  assert.equal(a.state, 'COMPUTED');
  const reg = a.items.find((i) => /Ana Ruiz/.test(i.heading));
  assert.match(reg.heading, /3 of 3/, 'counts only EDC documents');
  const pat = a.items.find((i) => /Tom Baker/.test(i.heading));
  assert.match(pat.body, /not a verified person/);
});

test('verify: never answers yes/no on its own; reports passages and missing finding', () => {
  const ray = ent('PERSON', 'Raymond Payne');
  const r = rec('roster.txt', 'City Council roster: Raymond Payne, Place 3, sworn in 2021.');
  const a = answerQuestion('Did Raymond Payne serve on City Council?', snap({ entities: [ray], records: [r] }), {});
  assert.notEqual(a.state, 'DOCUMENTED_FACT');
  assert.ok(a.items.length >= 1 && a.items[0].sources[0].excerpt.includes('Raymond Payne'));
  assert.ok(a.missing.some((m) => /No claim has been created/.test(m)));
  const miss = answerQuestion('Did Nora Webb serve on City Council?', snap({ entities: [ray], records: [r] }), {});
  assert.equal(miss.state, 'NO_EVIDENCE_LOCATED');
  assert.match(miss.summary, /does not show it did not happen/);
});

test('every substantive answer item cites at least one source, and HTML is escaped', () => {
  const r = rec('<script>x</script>.txt', 'Approved payment of $5,000 to <b>Acme</b> LLC.');
  const a = answerQuestion('Show payments to Acme', snap({ records: [r] }), {});
  assert.ok(a.items.length);
  for (const item of a.items) assert.ok(item.sources.length >= 1);
  const html = answerHtml(a);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<b>Acme'));
});

test('helpers: subject phrases and document dates', () => {
  assert.deepEqual(subjectPhrases('Show me all payments involving the Historical Society.'), ['Historical Society']);
  assert.ok(subjectPhrases('Show me everything involving Ordinance 2026-29.')[0].startsWith('Ordinance'));
  assert.equal(documentDate({ title: 'minutes-2024-03-12.txt' }), '2024-03-12');
  assert.equal(documentDate({ title: 'x', extractedText: 'Held on March 5, 2023 at city hall' }), '2023-03-05');
  assert.equal(documentDate({ title: 'x', extractedText: 'nothing' }), null);
});

test('progress: duplicate files are reported as duplicates, not as unreadable', () => {
  const s = snap({
    records: [rec('a', 'text')],
    ingestionItems: [
      { id: 'i1', status: 'SKIPPED', sourceFilename: 'a.txt', metadata: { duplicateOccurrencePath: 'copy/a.txt' } },
      { id: 'i2', status: 'SKIPPED', sourceFilename: 'b.txt', metadata: { duplicateOccurrencePath: 'copy/b.txt' } },
      { id: 'i3', status: 'FAILED', sourceFilename: 'scan.pdf', error: 'no text layer' }
    ]
  });
  const a = answerQuestion("What haven't we reviewed yet?", s, {});
  assert.ok(a.items.some((i) => /2 duplicate files skipped/.test(i.heading)));
  assert.match(a.missing.join(' '), /1 imported file was skipped or could not be read.*scan\.pdf/);
  assert.ok(!/a\.txt/.test(a.missing.join(' ')), 'duplicates are not listed as unreadable');
});

test('ranked search: a specific identifier must be present, not just similar words', async () => {
  await import('fake-indexeddb/auto');
  const db = await import('../public/db.js');
  const inv = await db.createInvestigation({ name: 'Search test', description: '' });
  await db.saveRecordToInvestigation(inv.id, { title: 'ordinance-2024-31.txt', originalUrl: 'u1', extractedText: 'Ordinance No. 2024-31 establishes the fund.' });
  await db.saveRecordToInvestigation(inv.id, { title: 'ordinance-2026-29.txt', originalUrl: 'u2', extractedText: 'Ordinance No. 2026-29 sets the tax rate.' });
  const hit = await db.searchInvestigation(inv.id, 'ordinance 2026-29');
  assert.deepEqual(hit.map((r) => r.title), ['ordinance-2026-29.txt']);
  const none = await db.searchInvestigation(inv.id, 'ordinance 2031-77');
  assert.equal(none.length, 0, 'similar ordinances are not an answer for a different number');
  // Without an identifier, partial matches still rank rather than vanish.
  const loose = await db.searchInvestigation(inv.id, 'ordinance tax rate');
  assert.equal(loose[0].title, 'ordinance-2026-29.txt');
});

test('before/after: item named as "Ordinance 2024-31" matches "Ordinance No. 2024-31" in a document that names it away from the vote line', () => {
  const v1 = rec('board-2024-03-12.txt', 'Agenda item 4: Ordinance No. 2024-31 (Riverwalk grant)\n\nMotion by Smith, seconded by Lee. Voted 4-1.');
  const v2 = rec('board-2024-05-14.txt', 'Treasurer report\nMotion to accept. Seconded. Voted 5-0.');
  const after = rec('invoice-2024-04-20.txt', 'Ordinance No. 2024-31 invoice, $412,000.');
  const a = answerQuestion('What changed before and after the vote on Ordinance 2024-31?', snap({ records: [v1, v2, after] }), {});
  assert.equal(a.state, 'DOCUMENTED_FACT');
  assert.match(a.items[0].heading, /board-2024-03-12/);
  // A quoted record title chosen from a clarification list is the vote, not a search key.
  const b = answerQuestion('What changed before and after the vote in "board-2024-03-12.txt"?', snap({ records: [v1, v2, after] }), {});
  assert.equal(b.state, 'DOCUMENTED_FACT');
  assert.ok(!/board-2024-03-12\.txt"/.test(b.searched), 'the title itself is not used as a search key');
});
