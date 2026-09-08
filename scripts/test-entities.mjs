// Pure-logic tests for public/entities.js - no DOM, no IndexedDB, no test
// runner dependency (node:assert + node:test, both built in). Covers the
// ENTITY, RELATIONSHIP, and (Phase 2) ENTITY MENTION validation-shape
// cases from the project's test plans that don't require a browser/
// IndexedDB; the evidence-existence, database-migration, identity-
// regression, and UI cases are covered separately by a live Puppeteer
// pass (see docs/CLAUDE_HANDOFF.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTITY_TYPES, RELATIONSHIP_STATUSES, DEFAULT_RELATIONSHIP_STATUS,
  EntityValidationError, RelationshipValidationError, RelationshipEvidenceRequiredError,
  MentionValidationError,
  normalizeName, normalizeForSearch, normalizeRelationshipType,
  validateEntityFields, validateRelationshipFields, validateEntityMentionFields
} from '../public/entities.js';

const INV = 'inv-test-1';

test('validateEntityFields: accepts a valid PERSON entity', () => {
  const out = validateEntityFields({ investigationId: INV, type: 'PERSON', name: 'Raymond Payne' });
  assert.equal(out.type, 'PERSON');
  assert.equal(out.name, 'Raymond Payne');
  assert.equal(out.nameNormalized, 'raymond payne');
  assert.deepEqual(out.metadata, {});
});

test('validateEntityFields: rejects missing name', () => {
  assert.throws(() => validateEntityFields({ investigationId: INV, type: 'PERSON', name: '' }), EntityValidationError);
  assert.throws(() => validateEntityFields({ investigationId: INV, type: 'PERSON', name: '   ' }), EntityValidationError);
  assert.throws(() => validateEntityFields({ investigationId: INV, type: 'PERSON' }), EntityValidationError);
});

test('validateEntityFields: rejects an invalid entity type', () => {
  assert.throws(() => validateEntityFields({ investigationId: INV, type: 'ALIEN', name: 'X' }), EntityValidationError);
  assert.throws(() => validateEntityFields({ investigationId: INV, type: '', name: 'X' }), EntityValidationError);
});

test('validateEntityFields: rejects a missing investigationId', () => {
  assert.throws(() => validateEntityFields({ type: 'PERSON', name: 'X' }), EntityValidationError);
});

test('validateEntityFields: every declared ENTITY_TYPES value is independently accepted', () => {
  for (const type of ENTITY_TYPES) {
    const out = validateEntityFields({ investigationId: INV, type, name: `Test ${type}` });
    assert.equal(out.type, type);
  }
});

test('validateEntityFields: rejects non-object metadata', () => {
  assert.throws(() => validateEntityFields({ investigationId: INV, type: 'PERSON', name: 'X', metadata: 'nope' }), EntityValidationError);
  assert.throws(() => validateEntityFields({ investigationId: INV, type: 'PERSON', name: 'X', metadata: [] }), EntityValidationError);
});

test('normalizeForSearch: two similarly-named people normalize independently (no forced collision)', () => {
  // This is the shape-level half of the Marc/Raymond Payne regression -
  // normalization must never make two distinct names compare equal.
  assert.notEqual(normalizeForSearch('Marc Payne'), normalizeForSearch('Raymond Payne'));
  assert.equal(normalizeForSearch('  Raymond   Payne '), normalizeForSearch('Raymond Payne'));
});

test('normalizeRelationshipType: normalizes free text to a stable canonical form', () => {
  assert.equal(normalizeRelationshipType('employed by'), 'EMPLOYED_BY');
  assert.equal(normalizeRelationshipType('Employed By'), 'EMPLOYED_BY');
  assert.equal(normalizeRelationshipType('  employed   by  '), 'EMPLOYED_BY');
  assert.equal(normalizeRelationshipType('employed-by!!'), 'EMPLOYED_BY');
  assert.equal(normalizeRelationshipType(''), '');
});

test('validateRelationshipFields: valid relationship with evidence normalizes and passes', () => {
  const out = validateRelationshipFields({
    investigationId: INV, sourceEntityId: 'ent-a', targetEntityId: 'ent-b',
    type: 'employed by', status: 'probable', evidenceIds: ['ev-1']
  });
  assert.equal(out.type, 'EMPLOYED_BY');
  assert.equal(out.status, 'PROBABLE');
  assert.deepEqual(out.evidenceIds, ['ev-1']);
});

test('validateRelationshipFields: rejects a relationship with NO evidenceIds field at all', () => {
  assert.throws(
    () => validateRelationshipFields({ investigationId: INV, sourceEntityId: 'ent-a', targetEntityId: 'ent-b', type: 'EMPLOYED_BY' }),
    RelationshipEvidenceRequiredError
  );
});

test('validateRelationshipFields: rejects a relationship with an EMPTY evidenceIds array', () => {
  assert.throws(
    () => validateRelationshipFields({ investigationId: INV, sourceEntityId: 'ent-a', targetEntityId: 'ent-b', type: 'EMPLOYED_BY', evidenceIds: [] }),
    RelationshipEvidenceRequiredError
  );
});

test('validateRelationshipFields: rejects evidenceIds that is not an array', () => {
  assert.throws(
    () => validateRelationshipFields({ investigationId: INV, sourceEntityId: 'ent-a', targetEntityId: 'ent-b', type: 'EMPLOYED_BY', evidenceIds: 'ev-1' }),
    RelationshipEvidenceRequiredError
  );
});

test('validateRelationshipFields: accepts and dedupes multiple evidence IDs', () => {
  const out = validateRelationshipFields({
    investigationId: INV, sourceEntityId: 'ent-a', targetEntityId: 'ent-b', type: 'EMPLOYED_BY',
    evidenceIds: ['ev-1', 'ev-2', 'ev-1', '', '  ', 42]
  });
  assert.deepEqual(out.evidenceIds, ['ev-1', 'ev-2']);
});

test('validateRelationshipFields: defaults status to UNKNOWN, never CONFIRMED', () => {
  const out = validateRelationshipFields({ investigationId: INV, sourceEntityId: 'ent-a', targetEntityId: 'ent-b', type: 'EMPLOYED_BY', evidenceIds: ['ev-1'] });
  assert.equal(out.status, DEFAULT_RELATIONSHIP_STATUS);
  assert.equal(out.status, 'UNKNOWN');
});

test('validateRelationshipFields: rejects an invalid status value', () => {
  assert.throws(
    () => validateRelationshipFields({ investigationId: INV, sourceEntityId: 'ent-a', targetEntityId: 'ent-b', type: 'EMPLOYED_BY', evidenceIds: ['ev-1'], status: 'VERY_SURE' }),
    RelationshipValidationError
  );
});

test('validateRelationshipFields: every declared RELATIONSHIP_STATUSES value is independently accepted', () => {
  for (const status of RELATIONSHIP_STATUSES) {
    const out = validateRelationshipFields({ investigationId: INV, sourceEntityId: 'ent-a', targetEntityId: 'ent-b', type: 'EMPLOYED_BY', evidenceIds: ['ev-1'], status });
    assert.equal(out.status, status);
  }
});

test('validateRelationshipFields: rejects a relationship with no type', () => {
  assert.throws(
    () => validateRelationshipFields({ investigationId: INV, sourceEntityId: 'ent-a', targetEntityId: 'ent-b', type: '', evidenceIds: ['ev-1'] }),
    RelationshipValidationError
  );
  assert.throws(
    () => validateRelationshipFields({ investigationId: INV, sourceEntityId: 'ent-a', targetEntityId: 'ent-b', type: '!!!', evidenceIds: ['ev-1'] }),
    RelationshipValidationError
  );
});

test('validateRelationshipFields: rejects a self-relationship', () => {
  assert.throws(
    () => validateRelationshipFields({ investigationId: INV, sourceEntityId: 'ent-a', targetEntityId: 'ent-a', type: 'EMPLOYED_BY', evidenceIds: ['ev-1'] }),
    RelationshipValidationError
  );
});

test('validateRelationshipFields: rejects missing source/target entity ids', () => {
  assert.throws(
    () => validateRelationshipFields({ investigationId: INV, sourceEntityId: '', targetEntityId: 'ent-b', type: 'EMPLOYED_BY', evidenceIds: ['ev-1'] }),
    RelationshipValidationError
  );
  assert.throws(
    () => validateRelationshipFields({ investigationId: INV, sourceEntityId: 'ent-a', targetEntityId: '', type: 'EMPLOYED_BY', evidenceIds: ['ev-1'] }),
    RelationshipValidationError
  );
});

test('validateRelationshipFields: rejects a missing investigationId', () => {
  assert.throws(
    () => validateRelationshipFields({ sourceEntityId: 'ent-a', targetEntityId: 'ent-b', type: 'EMPLOYED_BY', evidenceIds: ['ev-1'] }),
    RelationshipValidationError
  );
});

test('normalizeName: collapses whitespace without altering distinct strings', () => {
  assert.equal(normalizeName('  Ray   Payne  '), 'Ray Payne');
  assert.equal(normalizeName(null), '');
  assert.equal(normalizeName(undefined), '');
});

// ---------------------------------------------------------------------------
// Entity Mentions (Phase 2)
// ---------------------------------------------------------------------------

test('validateEntityMentionFields: accepts a valid mention', () => {
  const out = validateEntityMentionFields({ investigationId: INV, entityId: 'ent-a', evidenceId: 'ev-1', quotedName: 'Ray Payne' });
  assert.equal(out.quotedName, 'Ray Payne');
  assert.equal(out.quotedNameNormalized, 'ray payne');
  assert.equal(out.snippet, '');
  assert.deepEqual(out.metadata, {});
});

test('validateEntityMentionFields: rejects a missing entity', () => {
  assert.throws(
    () => validateEntityMentionFields({ investigationId: INV, evidenceId: 'ev-1', quotedName: 'Ray Payne' }),
    MentionValidationError
  );
});

test('validateEntityMentionFields: rejects a missing evidence item', () => {
  assert.throws(
    () => validateEntityMentionFields({ investigationId: INV, entityId: 'ent-a', quotedName: 'Ray Payne' }),
    MentionValidationError
  );
});

test('validateEntityMentionFields: rejects an empty quotedName', () => {
  assert.throws(
    () => validateEntityMentionFields({ investigationId: INV, entityId: 'ent-a', evidenceId: 'ev-1', quotedName: '' }),
    MentionValidationError
  );
  assert.throws(
    () => validateEntityMentionFields({ investigationId: INV, entityId: 'ent-a', evidenceId: 'ev-1', quotedName: '   ' }),
    MentionValidationError
  );
  assert.throws(
    () => validateEntityMentionFields({ investigationId: INV, entityId: 'ent-a', evidenceId: 'ev-1' }),
    MentionValidationError
  );
});

test('validateEntityMentionFields: rejects a missing investigationId', () => {
  assert.throws(
    () => validateEntityMentionFields({ entityId: 'ent-a', evidenceId: 'ev-1', quotedName: 'Ray Payne' }),
    MentionValidationError
  );
});

test('validateEntityMentionFields: quotedName survives verbatim - never rewritten toward the entity\'s canonical name', () => {
  // The whole point of quotedName: Chronium must never "correct" a source
  // quote to match the entity it's attached to. This is what would have
  // caught the real Marc/Ray Payne research error.
  const out = validateEntityMentionFields({ investigationId: INV, entityId: 'ent-raymond-payne', evidenceId: 'ev-1', quotedName: 'Marc Payne' });
  assert.equal(out.quotedName, 'Marc Payne');
  assert.notEqual(out.quotedName, 'Raymond Payne');
});

test('validateEntityMentionFields: only trims outer whitespace, preserves internal text exactly', () => {
  const out = validateEntityMentionFields({ investigationId: INV, entityId: 'ent-a', evidenceId: 'ev-1', quotedName: '  Councilmember Marc Payne  ' });
  assert.equal(out.quotedName, 'Councilmember Marc Payne');
});

test('validateEntityMentionFields: rejects non-object metadata', () => {
  assert.throws(
    () => validateEntityMentionFields({ investigationId: INV, entityId: 'ent-a', evidenceId: 'ev-1', quotedName: 'X', metadata: 'nope' }),
    MentionValidationError
  );
});

test('validateEntityMentionFields: optional fields (snippet/page/location/notes) default to empty string, not undefined', () => {
  const out = validateEntityMentionFields({ investigationId: INV, entityId: 'ent-a', evidenceId: 'ev-1', quotedName: 'X' });
  assert.equal(out.snippet, '');
  assert.equal(out.page, '');
  assert.equal(out.location, '');
  assert.equal(out.notes, '');
});
