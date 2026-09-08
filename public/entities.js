// Entity/relationship vocabulary and pure validation logic for the
// Investigation Workspace "Subjects" layer (docs/INVESTIGATION_WORKSPACE_PLAN.md
// Phase 1). No DOM, no IndexedDB - this file only decides whether a shape
// is valid, so it can be tested directly (scripts/test-entities.mjs) and
// reused identically by both public/db.js (the enforcement boundary) and
// public/app.js (the UI).
//
// The hard rule this file exists to protect (docs/CANON.md Product
// Principles #3 "Never Lose the Receipt", #11 "Separate Fact From
// Interpretation"): a relationship is an assertion, and Chronium must
// never persist an assertion with nothing behind it. validateRelationshipFields
// throws RelationshipEvidenceRequiredError before a relationship with no
// evidence ever reaches storage - see public/db.js createRelationship()
// for the second half of the enforcement (confirming the cited evidence
// actually exists), which this file can't do since it has no store access.

export const ENTITY_TYPES = [
  'PERSON', 'ORGANIZATION', 'GOVERNMENT_BODY', 'BUSINESS', 'PROPERTY',
  'CONTRACT', 'CAMPAIGN', 'MEETING', 'DOCUMENT', 'PAYMENT', 'EVENT', 'LOCATION'
];
export const ENTITY_TYPE_LABELS = {
  PERSON: 'Person', ORGANIZATION: 'Organization', GOVERNMENT_BODY: 'Government Body',
  BUSINESS: 'Business', PROPERTY: 'Property', CONTRACT: 'Contract', CAMPAIGN: 'Campaign',
  MEETING: 'Meeting', DOCUMENT: 'Document', PAYMENT: 'Payment', EVENT: 'Event', LOCATION: 'Location'
};

// Relationship confidence - deliberately a different axis from the five
// Ask Sources fact states (askCommands.js classifyAskAnswer), which
// classify an *answer*, not a researcher's *assertion*. Default is
// UNKNOWN, never CONFIRMED - promotion to CONFIRMED/REFUTED is always an
// explicit researcher action, never inferred.
export const RELATIONSHIP_STATUSES = ['CONFIRMED', 'PROBABLE', 'POSSIBLE', 'DISPUTED', 'REFUTED', 'UNKNOWN'];
export const RELATIONSHIP_STATUS_LABELS = {
  CONFIRMED: 'Confirmed', PROBABLE: 'Probable', POSSIBLE: 'Possible',
  DISPUTED: 'Disputed', REFUTED: 'Refuted', UNKNOWN: 'Unknown'
};
export const DEFAULT_RELATIONSHIP_STATUS = 'UNKNOWN';

// A relationship's `type` stays a free, normalized value (CANON.md
// Product Principle #8 "One Research Engine, Any Subject" - no
// hard-coded domain vocabulary) so a researcher is never blocked from
// typing a type this list doesn't anticipate. This is suggested
// vocabulary for the UI's <datalist>, not an enum the data layer enforces.
export const SUGGESTED_RELATIONSHIP_TYPES = [
  'EMPLOYED_BY', 'REPRESENTED', 'MEMBER_OF', 'APPOINTED_TO', 'CONTRACTED_WITH',
  'RECEIVED_PAYMENT_FROM', 'APPEARED_BEFORE', 'DONATED_TO', 'OWNS', 'LOCATED_AT',
  'PARTICIPATED_IN', 'MENTIONED_IN'
];

export class EntityValidationError extends Error {
  constructor(message) { super(message); this.name = 'EntityValidationError'; }
}
export class RelationshipValidationError extends Error {
  constructor(message) { super(message); this.name = 'RelationshipValidationError'; }
}
// Thrown when evidenceIds is missing, not an array, or empty - "no
// evidence at all." Distinct from RelationshipEvidenceInvalidError
// (public/db.js), which is a cited ID that doesn't actually exist -
// callers that only care about "did this get rejected for lacking
// evidence" can catch this one specifically.
export class RelationshipEvidenceRequiredError extends RelationshipValidationError {
  constructor(message = 'A relationship must cite at least one evidence item — Chronium never records an unsupported connection.') {
    super(message);
    this.name = 'RelationshipEvidenceRequiredError';
  }
}

export function normalizeName(s) { return String(s ?? '').trim().replace(/\s+/g, ' '); }
export function normalizeForSearch(s) { return normalizeName(s).toLowerCase(); }

// "employed by" / "Employed By" / "employed  by" all normalize to the
// same EMPLOYED_BY - keeps the free-vocabulary type field from silently
// fragmenting into near-duplicate strings.
export function normalizeRelationshipType(s) {
  return String(s ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function isPlainObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }

// Validates and normalizes the fields for a new/updated entity. Pure
// shape validation only - existence of `investigationId` as a real
// investigation is the caller's (public/db.js) concern, same division of
// labor as the rest of this file.
export function validateEntityFields({ investigationId, type, name, description, metadata } = {}) {
  if (!investigationId) throw new EntityValidationError('An entity must belong to an investigation.');
  if (!ENTITY_TYPES.includes(type)) {
    throw new EntityValidationError(`Unknown entity type "${type}". Must be one of: ${ENTITY_TYPES.join(', ')}.`);
  }
  const trimmedName = normalizeName(name);
  if (!trimmedName) throw new EntityValidationError('An entity requires a name.');
  if (metadata !== undefined && !isPlainObject(metadata)) throw new EntityValidationError('metadata must be a plain object.');
  return {
    investigationId, type, name: trimmedName, nameNormalized: normalizeForSearch(trimmedName),
    description: normalizeName(description || ''), metadata: metadata || {}
  };
}

// Validates and normalizes the fields for a new/updated relationship.
// This is the shape half of the evidence-enforcement rule - see the file
// header. `evidenceIds` is deduped and filtered to non-empty strings here,
// but existence-in-store is checked by public/db.js inside the same
// transaction as the write, which this file has no way to do.
export function validateRelationshipFields({
  investigationId, sourceEntityId, targetEntityId, type, status,
  evidenceIds, dateStart, dateEnd, notes, metadata
} = {}) {
  if (!investigationId) throw new RelationshipValidationError('A relationship must belong to an investigation.');
  if (!sourceEntityId || !targetEntityId) throw new RelationshipValidationError('A relationship requires both a source and a target entity.');
  if (sourceEntityId === targetEntityId) throw new RelationshipValidationError('An entity cannot have a relationship with itself.');

  const normType = normalizeRelationshipType(type);
  if (!normType) throw new RelationshipValidationError('A relationship requires a type (e.g. EMPLOYED_BY, REPRESENTED).');

  const normStatus = status == null || status === '' ? DEFAULT_RELATIONSHIP_STATUS : String(status).trim().toUpperCase();
  if (!RELATIONSHIP_STATUSES.includes(normStatus)) {
    throw new RelationshipValidationError(`Unknown relationship status "${status}". Must be one of: ${RELATIONSHIP_STATUSES.join(', ')}.`);
  }

  // THE hard rule: no evidence = no relationship. Checked before anything
  // else about evidence shape, so a caller catching just this class knows
  // exactly what happened.
  if (!Array.isArray(evidenceIds)) throw new RelationshipEvidenceRequiredError();
  const cleanEvidenceIds = [...new Set(evidenceIds.filter((id) => typeof id === 'string' && id.trim()))];
  if (!cleanEvidenceIds.length) throw new RelationshipEvidenceRequiredError();

  if (metadata !== undefined && !isPlainObject(metadata)) throw new RelationshipValidationError('metadata must be a plain object.');

  return {
    investigationId, sourceEntityId, targetEntityId, type: normType, status: normStatus,
    evidenceIds: cleanEvidenceIds, dateStart: dateStart || null, dateEnd: dateEnd || null,
    notes: normalizeName(notes || ''), metadata: metadata || {}
  };
}
