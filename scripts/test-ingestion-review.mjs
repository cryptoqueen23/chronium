// Pure-logic tests for public/ingestionReview.js - no DOM, no IndexedDB,
// plain node:test/node:assert, mirroring test-entities.mjs/test-claims.mjs.
// Covers candidate/watchlist detection shape and the identity-safety
// guarantees; existence checks, migration, scale, and UI cases are
// covered by a live Puppeteer pass (see docs/CLAUDE_HANDOFF.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_STATUSES, ITEM_STATUSES, CANDIDATE_STATES, WATCHLIST_TYPES,
  WatchlistValidationError, validateWatchlistFields,
  findSubjectCandidates, findWatchlistMatches
} from '../public/ingestionReview.js';

const INV = 'inv-test-1';

// ---------------------------------------------------------------------------
// Watchlist validation
// ---------------------------------------------------------------------------

test('validateWatchlistFields: accepts a valid entry, defaults type to word', () => {
  const out = validateWatchlistFields({ investigationId: INV, term: 'Hotel Occupancy Tax' });
  assert.equal(out.term, 'Hotel Occupancy Tax');
  assert.equal(out.termNormalized, 'hotel occupancy tax');
  assert.equal(out.type, 'word');
});

test('validateWatchlistFields: rejects missing term', () => {
  assert.throws(() => validateWatchlistFields({ investigationId: INV, term: '' }), WatchlistValidationError);
});

test('validateWatchlistFields: rejects missing investigationId', () => {
  assert.throws(() => validateWatchlistFields({ term: 'EDC' }), WatchlistValidationError);
});

test('validateWatchlistFields: rejects an invalid type', () => {
  assert.throws(() => validateWatchlistFields({ investigationId: INV, term: 'X', type: 'nonsense' }), WatchlistValidationError);
});

test('validateWatchlistFields: every declared WATCHLIST_TYPES value is independently accepted', () => {
  for (const type of WATCHLIST_TYPES) {
    const out = validateWatchlistFields({ investigationId: INV, term: 'X', type });
    assert.equal(out.type, type);
  }
});

// ---------------------------------------------------------------------------
// Subject candidate detection - THE identity-safety guarantees
// ---------------------------------------------------------------------------

const marc = { id: 'ent-marc', type: 'PERSON', name: 'Marc Payne', aliases: [] };
const raymond = { id: 'ent-raymond', type: 'PERSON', name: 'Raymond Payne', aliases: ['Ray Payne'] };

test('findSubjectCandidates: strong match on a full registered name still requires confirmation (initialState UNVERIFIED-equivalent)', () => {
  const out = findSubjectCandidates('Councilmember Marc Payne recused himself.', [marc, raymond]);
  assert.equal(out.length, 1);
  assert.equal(out[0].matchedText, 'Marc Payne');
  assert.deepEqual(out[0].candidateEntityIds, ['ent-marc']);
  assert.equal(out[0].initialState, 'UNREVIEWED');
  assert.equal(out[0].matchStrength, 'strong');
});

test('findSubjectCandidates: strong match on a registered ALIAS surfaces the entity it belongs to, quoting the alias text', () => {
  const out = findSubjectCandidates('Ray Payne appeared before Council.', [marc, raymond]);
  assert.equal(out.length, 1);
  assert.equal(out[0].matchedText, 'Ray Payne');
  assert.deepEqual(out[0].candidateEntityIds, ['ent-raymond']);
});

test('THE PAYNE REGRESSION: a bare shared surname with no fuller match must come back AMBIGUOUS, never auto-assigned', () => {
  // Document C from the Phase 4 brief: "Payne addressed the council" -
  // neither full name nor the registered alias appears, only the bare
  // surname both people share.
  const out = findSubjectCandidates('Payne addressed the council on water rates.', [marc, raymond]);
  assert.equal(out.length, 1);
  assert.equal(out[0].matchedText, 'Payne');
  assert.equal(out[0].initialState, 'AMBIGUOUS');
  assert.equal(out[0].candidateEntityIds.length, 2);
  assert.ok(out[0].candidateEntityIds.includes('ent-marc'));
  assert.ok(out[0].candidateEntityIds.includes('ent-raymond'));
});

test('findSubjectCandidates: never returns a single pre-selected entity for an ambiguous surname - always the full candidate set', () => {
  const out = findSubjectCandidates('Payne was present.', [marc, raymond]);
  // The literal non-negotiable: "It must NOT pick one automatically."
  assert.notEqual(out[0].candidateEntityIds.length, 1);
});

test('findSubjectCandidates: weak surname match is skipped inside a strong full-name match (no redundant double candidate)', () => {
  const out = findSubjectCandidates('Marc Payne voted no.', [marc, raymond]);
  assert.equal(out.length, 1); // only the strong "Marc Payne" match, not also a weak "Payne" one
  assert.equal(out[0].matchStrength, 'strong');
});

test('findSubjectCandidates: a lone person with a shared-elsewhere surname is a normal single candidate, not ambiguous, when only they are registered', () => {
  const out = findSubjectCandidates('Payne spoke at the meeting.', [raymond]); // marc not registered here
  assert.equal(out.length, 1);
  assert.equal(out[0].initialState, 'UNREVIEWED');
  assert.deepEqual(out[0].candidateEntityIds, ['ent-raymond']);
});

test('findSubjectCandidates: word-boundary check - "payne" inside a longer word is not matched', () => {
  const out = findSubjectCandidates('The champayne reception was well attended.', [marc]);
  assert.equal(out.length, 0);
});

test('findSubjectCandidates: returns [] for no entities or no text', () => {
  assert.deepEqual(findSubjectCandidates('Marc Payne', []), []);
  assert.deepEqual(findSubjectCandidates('', [marc]), []);
  assert.deepEqual(findSubjectCandidates(null, [marc]), []);
});

test('findSubjectCandidates: ORGANIZATION entities never get weak surname matching (last word of an org name is not a person surname)', () => {
  const org = { id: 'ent-org', type: 'ORGANIZATION', name: 'Copperas Cove Historical Society', aliases: [] };
  const out = findSubjectCandidates('The Society met on Tuesday.', [org]);
  assert.equal(out.length, 0); // "Society" alone never matches - no weak pass for non-PERSON types
});

test('findSubjectCandidates: co-occurrence - two unrelated people in one document each surface as independent single candidates', () => {
  const sheena = { id: 'ent-sheena', type: 'PERSON', name: 'Sheena Tanner', aliases: [] };
  const out = findSubjectCandidates('Raymond Payne and Sheena Tanner both provided public comment.', [raymond, sheena]);
  assert.equal(out.length, 2);
  const rayCandidate = out.find((c) => c.matchedText === 'Raymond Payne');
  const sheenaCandidate = out.find((c) => c.matchedText === 'Sheena Tanner');
  assert.deepEqual(rayCandidate.candidateEntityIds, ['ent-raymond']);
  assert.deepEqual(sheenaCandidate.candidateEntityIds, ['ent-sheena']);
  // Neither candidate references the other - co-occurrence in the same
  // document must never imply a connection between them.
});

test('findSubjectCandidates: caps occurrences of the same match string per document (scale safeguard)', () => {
  const text = new Array(50).fill('Marc Payne was mentioned.').join(' ');
  const out = findSubjectCandidates(text, [marc]);
  assert.ok(out.length <= 5, `expected capped occurrences, got ${out.length}`);
});

// ---------------------------------------------------------------------------
// Watchlist matching
// ---------------------------------------------------------------------------

test('findWatchlistMatches: finds a term and preserves matched text/snippet', () => {
  const out = findWatchlistMatches('The budget includes Hotel Occupancy Tax funding for FY2025.', [{ id: 'w1', term: 'Hotel Occupancy Tax', termNormalized: 'hotel occupancy tax' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].watchlistId, 'w1');
  assert.equal(out[0].matchedText, 'Hotel Occupancy Tax');
  assert.ok(out[0].snippet.includes('Hotel Occupancy Tax'));
});

test('findWatchlistMatches: never converts a match into anything but a match (no side data implying a finding)', () => {
  const out = findWatchlistMatches('EDC funds were discussed.', [{ id: 'w2', term: 'EDC', termNormalized: 'edc' }]);
  assert.equal(out.length, 1);
  assert.deepEqual(Object.keys(out[0]).sort(), ['matchedText', 'offset', 'snippet', 'watchlistId'].sort());
});

test('findWatchlistMatches: returns [] for no terms or no text', () => {
  assert.deepEqual(findWatchlistMatches('text', []), []);
  assert.deepEqual(findWatchlistMatches('', [{ id: 'w1', term: 'X', termNormalized: 'x' }]), []);
});

test('findWatchlistMatches: multiple distinct terms all surface independently', () => {
  const out = findWatchlistMatches('Ordinance 2026-29 addresses water rates and the EDC budget.', [
    { id: 'w1', term: 'water rates', termNormalized: 'water rates' },
    { id: 'w2', term: 'EDC', termNormalized: 'edc' }
  ]);
  assert.equal(out.length, 2);
});

// ---------------------------------------------------------------------------
// Vocabulary sanity
// ---------------------------------------------------------------------------

test('vocabulary: job/item/candidate state enums are exactly what the brief specifies', () => {
  assert.deepEqual(JOB_STATUSES, ['QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED']);
  assert.deepEqual(ITEM_STATUSES, ['PENDING', 'PROCESSING', 'READY_FOR_REVIEW', 'REVIEWED', 'FAILED', 'SKIPPED']);
  assert.deepEqual(CANDIDATE_STATES, ['UNREVIEWED', 'CONFIRMED', 'REJECTED', 'AMBIGUOUS']);
});
