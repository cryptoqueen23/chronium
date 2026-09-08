// Claim/Finding vocabulary and pure validation logic
// (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 3). No DOM, no IndexedDB -
// same division of labor as public/entities.js: this file decides
// whether a shape is valid (testable directly, scripts/test-entities.mjs),
// public/db.js checks existence and enforces referential integrity.
//
// THE CORE MODEL this phase protects (docs/CANON.md Product Principle
// #11 "Separate Fact From Interpretation", #12 "Missing Evidence Is
// Information, Not Proof"):
//
//   SOURCE -> EVIDENCE -> ENTITY MENTION -> ENTITY/RELATIONSHIP -> CLAIM -> FINDING -> REPORT
//
// A Claim is something being TESTED - it may legitimately exist with zero
// evidence (an investigative lead, status UNVERIFIED). A Finding is the
// investigator's CONCLUSION about a claim at this point in the
// investigation, and a Finding classified as an actual assertion of fact
// (DOCUMENTED_FACT/SUPPORTED_INFERENCE/ALLEGATION) MUST cite real
// evidence - Chronium must never let "no evidence" quietly become
// "established." UNRESOLVED_QUESTION and NO_EVIDENCE_LOCATED are the
// only classifications allowed with zero evidence, because they ARE the
// honest statement that nothing was found - see CANON's "Never Confuse
// Absence of Evidence With Evidence of Absence".
//
// CRITICAL: claim/evidence stance (supports/contradicts/contextualizes)
// is always investigator-asserted, never inferred from claim status, and
// evidence count never determines status automatically (Phase 3 brief
// §3: "Five social-media posts must not automatically outweigh one
// authoritative primary record"). Nothing in this file computes a status
// or classification from a count - every status/classification value is
// something a human explicitly chose.

export const CLAIM_STATUSES = ['UNVERIFIED', 'SUPPORTED', 'STRONGLY_SUPPORTED', 'CONFIRMED', 'CONTRADICTED', 'REFUTED'];
export const CLAIM_STATUS_LABELS = {
  UNVERIFIED: 'Unverified', SUPPORTED: 'Supported', STRONGLY_SUPPORTED: 'Strongly Supported',
  CONFIRMED: 'Confirmed', CONTRADICTED: 'Contradicted', REFUTED: 'Refuted'
};
export const DEFAULT_CLAIM_STATUS = 'UNVERIFIED';

export const EVIDENCE_STANCES = ['supports', 'contradicts', 'contextualizes'];
export const EVIDENCE_STANCE_LABELS = { supports: 'Supports', contradicts: 'Contradicts', contextualizes: 'Contextualizes' };
export const DEFAULT_EVIDENCE_STANCE = 'supports';

export const FINDING_CLASSIFICATIONS = ['DOCUMENTED_FACT', 'SUPPORTED_INFERENCE', 'ALLEGATION', 'UNRESOLVED_QUESTION', 'NO_EVIDENCE_LOCATED'];
export const FINDING_CLASSIFICATION_LABELS = {
  DOCUMENTED_FACT: 'Documented Fact', SUPPORTED_INFERENCE: 'Supported Inference', ALLEGATION: 'Allegation',
  UNRESOLVED_QUESTION: 'Unresolved Question', NO_EVIDENCE_LOCATED: 'No Evidence Located'
};
// The three classifications that assert something as true (in varying
// degrees of confidence) - these are the ones a Finding may NEVER carry
// without real cited evidence. The other two ARE the honest "nothing
// established yet" states and are exempt by design, not by omission.
export const FINDING_CLASSIFICATIONS_REQUIRING_EVIDENCE = ['DOCUMENTED_FACT', 'SUPPORTED_INFERENCE', 'ALLEGATION'];

function normalizeName(s) { return String(s ?? '').trim().replace(/\s+/g, ' '); }
function isPlainObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function cleanIdArray(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.filter((id) => typeof id === 'string' && id.trim()))];
}

export class ClaimValidationError extends Error {
  constructor(message) { super(message); this.name = 'ClaimValidationError'; }
}
export class ClaimEvidenceValidationError extends Error {
  constructor(message) { super(message); this.name = 'ClaimEvidenceValidationError'; }
}
export class FindingValidationError extends Error {
  constructor(message) { super(message); this.name = 'FindingValidationError'; }
}
// Thrown when a Finding's classification asserts something as true but
// cites no real evidence - the Phase 3 equivalent of Phase 1's
// RelationshipEvidenceRequiredError, applied to conclusions rather than
// connections.
export class FindingEvidenceRequiredError extends FindingValidationError {
  constructor(message = 'A finding classified as DOCUMENTED_FACT, SUPPORTED_INFERENCE, or ALLEGATION must cite at least one evidence item — Chronium never presents an unsupported assertion as established.') {
    super(message);
    this.name = 'FindingEvidenceRequiredError';
  }
}

// Shape validation for a Claim. Deliberately does NOT require evidence -
// a claim is something being tested and may exist at UNVERIFIED with
// nothing behind it yet (Phase 3 brief §3/§11). `text` is the stored
// field name (matches the existing pre-Phase-1 `claims` store, which
// already shipped before this phase); the brief's "statement" is the
// same field under a different name in the spec, not a schema change.
export function validateClaimFields({ investigationId, text, status, subjectEntityIds, notes, metadata } = {}) {
  if (!investigationId) throw new ClaimValidationError('A claim must belong to an investigation.');
  const cleanText = normalizeName(text);
  if (!cleanText) throw new ClaimValidationError('A claim requires a statement.');

  const normStatus = status == null || status === '' ? DEFAULT_CLAIM_STATUS : String(status).trim().toUpperCase();
  if (!CLAIM_STATUSES.includes(normStatus)) {
    throw new ClaimValidationError(`Unknown claim status "${status}". Must be one of: ${CLAIM_STATUSES.join(', ')}.`);
  }

  if (subjectEntityIds !== undefined && !Array.isArray(subjectEntityIds)) throw new ClaimValidationError('subjectEntityIds must be an array.');
  if (metadata !== undefined && !isPlainObject(metadata)) throw new ClaimValidationError('metadata must be a plain object.');

  return {
    investigationId, text: cleanText, status: normStatus,
    subjectEntityIds: cleanIdArray(subjectEntityIds),
    notes: normalizeName(notes || ''), metadata: metadata || {}
  };
}

export function validateClaimEvidenceFields({ investigationId, claimId, evidenceId, stance, notes } = {}) {
  if (!investigationId) throw new ClaimEvidenceValidationError('A claim-evidence link must belong to an investigation.');
  if (!claimId) throw new ClaimEvidenceValidationError('A claim-evidence link requires a claim.');
  if (!evidenceId) throw new ClaimEvidenceValidationError('A claim-evidence link requires an evidence item.');

  const normStance = stance == null || stance === '' ? DEFAULT_EVIDENCE_STANCE : String(stance).trim().toLowerCase();
  if (!EVIDENCE_STANCES.includes(normStance)) {
    throw new ClaimEvidenceValidationError(`Unknown stance "${stance}". Must be one of: ${EVIDENCE_STANCES.join(', ')}.`);
  }

  return { investigationId, claimId, evidenceId, stance: normStance, notes: normalizeName(notes || '') };
}

// Shape validation for a Finding - THE hard rule lives here (see file
// header). classification is required with no default: silently
// defaulting to any of the three evidence-requiring classifications
// would be exactly the "manufacture an answer" failure this file exists
// to prevent, and defaulting to one of the two exempt classifications
// would silently misrepresent an omitted choice as "nothing found."
export function validateFindingFields({ investigationId, claimId, conclusion, classification, evidenceIds, notes, metadata } = {}) {
  if (!investigationId) throw new FindingValidationError('A finding must belong to an investigation.');
  if (!claimId) throw new FindingValidationError('A finding must be attached to a claim.');
  const cleanConclusion = normalizeName(conclusion);
  if (!cleanConclusion) throw new FindingValidationError('A finding requires a conclusion.');

  const normClassification = String(classification || '').trim().toUpperCase();
  if (!FINDING_CLASSIFICATIONS.includes(normClassification)) {
    throw new FindingValidationError(`A finding requires a valid classification. Must be one of: ${FINDING_CLASSIFICATIONS.join(', ')}.`);
  }

  const cleanEvidenceIds = cleanIdArray(evidenceIds);
  if (FINDING_CLASSIFICATIONS_REQUIRING_EVIDENCE.includes(normClassification) && !cleanEvidenceIds.length) {
    throw new FindingEvidenceRequiredError();
  }

  if (metadata !== undefined && !isPlainObject(metadata)) throw new FindingValidationError('metadata must be a plain object.');

  return {
    investigationId, claimId, conclusion: cleanConclusion, classification: normClassification,
    evidenceIds: cleanEvidenceIds, notes: normalizeName(notes || ''), metadata: metadata || {}
  };
}
