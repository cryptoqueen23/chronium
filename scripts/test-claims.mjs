// Pure-logic tests for public/claims.js - no DOM, no IndexedDB, plain
// node:test/node:assert (no new dependency), mirroring
// scripts/test-entities.mjs's pattern. Covers the CLAIM, CLAIM-EVIDENCE,
// and FINDING validation-shape cases that don't require a browser/
// IndexedDB; existence checks, migration, identity/co-occurrence
// regressions, and UI cases are covered by a live Puppeteer pass (see
// docs/CLAUDE_HANDOFF.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAIM_STATUSES, DEFAULT_CLAIM_STATUS, EVIDENCE_STANCES, DEFAULT_EVIDENCE_STANCE,
  FINDING_CLASSIFICATIONS, FINDING_CLASSIFICATIONS_REQUIRING_EVIDENCE,
  ClaimValidationError, ClaimEvidenceValidationError, FindingValidationError, FindingEvidenceRequiredError,
  validateClaimFields, validateClaimEvidenceFields, validateFindingFields
} from '../public/claims.js';

const INV = 'inv-test-1';

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

test('validateClaimFields: accepts a valid claim with no evidence/subjects (a bare lead)', () => {
  const out = validateClaimFields({ investigationId: INV, text: 'Raymond Payne served on Copperas Cove City Council.' });
  assert.equal(out.text, 'Raymond Payne served on Copperas Cove City Council.');
  assert.equal(out.status, DEFAULT_CLAIM_STATUS);
  assert.equal(out.status, 'UNVERIFIED');
  assert.deepEqual(out.subjectEntityIds, []);
});

test('validateClaimFields: an unsupported claim may remain UNVERIFIED - no evidence requirement at the claim level', () => {
  // This is the key asymmetry vs. Relationships/Mentions: a Claim is
  // something being TESTED, so it may legitimately exist with nothing
  // behind it yet.
  const out = validateClaimFields({ investigationId: INV, text: 'Person X received a City contract.' });
  assert.equal(out.status, 'UNVERIFIED');
});

test('validateClaimFields: rejects missing statement text', () => {
  assert.throws(() => validateClaimFields({ investigationId: INV, text: '' }), ClaimValidationError);
  assert.throws(() => validateClaimFields({ investigationId: INV, text: '   ' }), ClaimValidationError);
  assert.throws(() => validateClaimFields({ investigationId: INV }), ClaimValidationError);
});

test('validateClaimFields: rejects a missing investigationId', () => {
  assert.throws(() => validateClaimFields({ text: 'X' }), ClaimValidationError);
});

test('validateClaimFields: rejects an invalid status', () => {
  assert.throws(() => validateClaimFields({ investigationId: INV, text: 'X', status: 'VERY_TRUE' }), ClaimValidationError);
});

test('validateClaimFields: every declared CLAIM_STATUSES value is independently accepted', () => {
  for (const status of CLAIM_STATUSES) {
    const out = validateClaimFields({ investigationId: INV, text: 'X', status });
    assert.equal(out.status, status);
  }
});

test('validateClaimFields: subjectEntityIds is deduped and filtered to non-empty strings', () => {
  const out = validateClaimFields({ investigationId: INV, text: 'X', subjectEntityIds: ['ent-a', 'ent-b', 'ent-a', '', null, 42] });
  assert.deepEqual(out.subjectEntityIds, ['ent-a', 'ent-b']);
});

test('validateClaimFields: rejects non-object metadata', () => {
  assert.throws(() => validateClaimFields({ investigationId: INV, text: 'X', metadata: 'nope' }), ClaimValidationError);
});

// ---------------------------------------------------------------------------
// Claim-Evidence links (support/contradict/contextualize)
// ---------------------------------------------------------------------------

test('validateClaimEvidenceFields: accepts a valid support link', () => {
  const out = validateClaimEvidenceFields({ investigationId: INV, claimId: 'claim-a', evidenceId: 'ev-1', stance: 'supports' });
  assert.equal(out.stance, 'supports');
});

test('validateClaimEvidenceFields: accepts contradicts and contextualizes stances', () => {
  const contra = validateClaimEvidenceFields({ investigationId: INV, claimId: 'claim-a', evidenceId: 'ev-1', stance: 'contradicts' });
  assert.equal(contra.stance, 'contradicts');
  const ctx = validateClaimEvidenceFields({ investigationId: INV, claimId: 'claim-a', evidenceId: 'ev-1', stance: 'contextualizes' });
  assert.equal(ctx.stance, 'contextualizes');
});

test('validateClaimEvidenceFields: defaults stance to supports, not inferred from anything', () => {
  const out = validateClaimEvidenceFields({ investigationId: INV, claimId: 'claim-a', evidenceId: 'ev-1' });
  assert.equal(out.stance, DEFAULT_EVIDENCE_STANCE);
});

test('validateClaimEvidenceFields: rejects an invalid stance', () => {
  assert.throws(() => validateClaimEvidenceFields({ investigationId: INV, claimId: 'claim-a', evidenceId: 'ev-1', stance: 'maybe' }), ClaimEvidenceValidationError);
});

test('validateClaimEvidenceFields: rejects missing claim or evidence id', () => {
  assert.throws(() => validateClaimEvidenceFields({ investigationId: INV, evidenceId: 'ev-1' }), ClaimEvidenceValidationError);
  assert.throws(() => validateClaimEvidenceFields({ investigationId: INV, claimId: 'claim-a' }), ClaimEvidenceValidationError);
});

test('validateClaimEvidenceFields: multiple evidence positions can coexist (shape allows independent supports/contradicts rows)', () => {
  const supports = validateClaimEvidenceFields({ investigationId: INV, claimId: 'claim-x', evidenceId: 'ev-a', stance: 'supports' });
  const contradicts = validateClaimEvidenceFields({ investigationId: INV, claimId: 'claim-x', evidenceId: 'ev-b', stance: 'contradicts' });
  assert.notEqual(supports.stance, contradicts.stance);
  assert.equal(supports.claimId, contradicts.claimId);
});

// ---------------------------------------------------------------------------
// Findings - the hard rule
// ---------------------------------------------------------------------------

test('validateFindingFields: DOCUMENTED_FACT with valid evidence saves', () => {
  const out = validateFindingFields({ investigationId: INV, claimId: 'claim-a', conclusion: 'Official records identify Marc Payne as the Council member.', classification: 'DOCUMENTED_FACT', evidenceIds: ['ev-1'] });
  assert.equal(out.classification, 'DOCUMENTED_FACT');
  assert.deepEqual(out.evidenceIds, ['ev-1']);
});

test('validateFindingFields: DOCUMENTED_FACT without evidence is rejected', () => {
  assert.throws(
    () => validateFindingFields({ investigationId: INV, claimId: 'claim-a', conclusion: 'X happened.', classification: 'DOCUMENTED_FACT' }),
    FindingEvidenceRequiredError
  );
});

test('validateFindingFields: SUPPORTED_INFERENCE without evidence is rejected', () => {
  assert.throws(
    () => validateFindingFields({ investigationId: INV, claimId: 'claim-a', conclusion: 'X likely happened.', classification: 'SUPPORTED_INFERENCE', evidenceIds: [] }),
    FindingEvidenceRequiredError
  );
});

test('validateFindingFields: ALLEGATION without evidence is rejected', () => {
  assert.throws(
    () => validateFindingFields({ investigationId: INV, claimId: 'claim-a', conclusion: 'It is alleged that X.', classification: 'ALLEGATION' }),
    FindingEvidenceRequiredError
  );
});

test('validateFindingFields: UNRESOLVED_QUESTION is allowed with zero evidence', () => {
  const out = validateFindingFields({ investigationId: INV, claimId: 'claim-a', conclusion: 'Did Raymond Payne ever serve on a City-appointed board?', classification: 'UNRESOLVED_QUESTION' });
  assert.deepEqual(out.evidenceIds, []);
});

test('validateFindingFields: NO_EVIDENCE_LOCATED is allowed with zero evidence', () => {
  const out = validateFindingFields({ investigationId: INV, claimId: 'claim-a', conclusion: 'No evidence of a Raymond Payne City Council appointment was located in the sources searched.', classification: 'NO_EVIDENCE_LOCATED' });
  assert.deepEqual(out.evidenceIds, []);
});

test('validateFindingFields: rejects a missing/invalid classification (no silent default)', () => {
  assert.throws(() => validateFindingFields({ investigationId: INV, claimId: 'claim-a', conclusion: 'X.' }), FindingValidationError);
  assert.throws(() => validateFindingFields({ investigationId: INV, claimId: 'claim-a', conclusion: 'X.', classification: 'PROBABLY_TRUE' }), FindingValidationError);
});

test('validateFindingFields: rejects a missing conclusion', () => {
  assert.throws(() => validateFindingFields({ investigationId: INV, claimId: 'claim-a', classification: 'UNRESOLVED_QUESTION', conclusion: '' }), FindingValidationError);
});

test('validateFindingFields: rejects a missing claimId', () => {
  assert.throws(() => validateFindingFields({ investigationId: INV, conclusion: 'X.', classification: 'UNRESOLVED_QUESTION' }), FindingValidationError);
});

test('validateFindingFields: rejects a missing investigationId', () => {
  assert.throws(() => validateFindingFields({ claimId: 'claim-a', conclusion: 'X.', classification: 'UNRESOLVED_QUESTION' }), FindingValidationError);
});

test('validateFindingFields: every declared FINDING_CLASSIFICATIONS value is independently accepted with appropriate evidence', () => {
  for (const classification of FINDING_CLASSIFICATIONS) {
    const needsEvidence = FINDING_CLASSIFICATIONS_REQUIRING_EVIDENCE.includes(classification);
    const out = validateFindingFields({
      investigationId: INV, claimId: 'claim-a', conclusion: 'Test conclusion.', classification,
      evidenceIds: needsEvidence ? ['ev-1'] : []
    });
    assert.equal(out.classification, classification);
  }
});

test('validateFindingFields: dedupes evidenceIds', () => {
  const out = validateFindingFields({ investigationId: INV, claimId: 'claim-a', conclusion: 'X.', classification: 'DOCUMENTED_FACT', evidenceIds: ['ev-1', 'ev-1', 'ev-2'] });
  assert.deepEqual(out.evidenceIds, ['ev-1', 'ev-2']);
});
