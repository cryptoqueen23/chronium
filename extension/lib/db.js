// Local-first investigation workspace storage. IndexedDB, no dependencies.
// Stores: investigations, records (deduped evidence/sources), investigationRecords
// (join), blobs (original evidence bytes, deduped by content hash),
// ingestionBatches (one row per bulk import), meta (small counters),
// outlines (one per investigation: research question + method + sections,
// each section with its own method/status/coverage), evidenceItems (excerpts
// pulled from a source), claims (assertions an Evidence Item supports/
// contradicts) - the Source -> Evidence Item -> Claim model from
// docs/RESEARCH_METHOD.md - quantitativeFindings/qualitativeFindings
// (researcher-asserted findings with their inputs/formula/method or
// supporting passages/methodology preserved), crossValidations (mixed-method
// agreement/discrepancy judgments between one of each),
// qualitativeAnalysis (the last AI-assisted analysis result per
// investigation, so revisiting the tab doesn't require re-running a paid AI
// call), entities/relationships/entityAliases (docs/INVESTIGATION_WORKSPACE_PLAN.md
// Phase 1 - the Subjects tab's case-file layer: PERSON/ORGANIZATION/etc.
// entities, evidence-backed relationships between them, and researcher-
// asserted alternate names that never auto-merge into an entity - see the
// "Entities / Relationships" section below for the enforcement rule),
// entityMentions (Phase 2 - "this evidence item uses the exact string X to
// refer to entity Y," never a relationship by itself - see the "Entity
// Mentions" section below), claimEvidence/claimFindings/claimHistory
// (Phase 3 - docs/INVESTIGATION_WORKSPACE_PLAN.md: claimEvidence is the
// proper join table for the pre-existing `claims` store's supports/
// contradicts/contextualizes links, replacing that store's old inline
// `links` array going forward (old records' `links` field is left as
// inert legacy data, never deleted - see the migration note below);
// claimFindings is the investigator's evidence-backed CONCLUSION about a
// claim (named claimFindings, not `findings`, specifically to avoid
// collision with the pre-existing, unrelated quantitativeFindings/
// qualitativeFindings stores from docs/RESEARCH_METHOD.md's mixed-methods
// workflow); claimHistory is a lightweight status-change audit trail. See
// the "Claims / Claim Evidence / Findings" section below for the
// enforcement rule. ingestionItems/reviewCandidates/watchlists/
// watchlistMatches/reviewHistory/investigators (Phase 4 -
// docs/INVESTIGATION_WORKSPACE_PLAN.md: the bulk-ingestion review queue.
// `ingestionBatches` above is extended, not duplicated, into the "job"
// concept the brief asks for - see the "Bulk Ingestion Review Queue"
// section below for why, and for the hard rule this phase protects:
// candidate detection may only ever SURFACE possibilities, never pick one
// or create a mention/relationship/claim on its own).

import {
  validateEntityFields, validateRelationshipFields, validateEntityMentionFields,
  normalizeName, normalizeForSearch, RelationshipValidationError, MentionValidationError
} from './entities.js';
import {
  validateClaimFields, validateClaimEvidenceFields, validateFindingFields,
  CLAIM_STATUSES, FINDING_CLASSIFICATIONS_REQUIRING_EVIDENCE,
  ClaimValidationError, ClaimEvidenceValidationError, FindingValidationError, FindingEvidenceRequiredError
} from './claims.js';
import {
  validateWatchlistFields, findSubjectCandidates, findWatchlistMatches,
  JOB_STATUSES, ITEM_STATUSES, CANDIDATE_STATES,
  IngestionValidationError, WatchlistValidationError, ReviewCandidateValidationError
} from './ingestionReview.js';

const DB_NAME = 'chronium';
const DB_VERSION = 12;
let dbPromise = null;
// Drops the cached connection so the next call reopens the database. Used by
// tests that swap in a fresh IndexedDB to simulate a second device.
export function resetDbConnection() { dbPromise = null; }

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('investigations')) {
        db.createObjectStore('investigations', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('records')) {
        const records = db.createObjectStore('records', { keyPath: 'id' });
        records.createIndex('canonicalKey', 'canonicalKey', { unique: true });
      }
      if (!db.objectStoreNames.contains('investigationRecords')) {
        const links = db.createObjectStore('investigationRecords', { keyPath: 'id', autoIncrement: true });
        links.createIndex('investigationId', 'investigationId', { unique: false });
        links.createIndex('recordId', 'recordId', { unique: false });
        links.createIndex('byPair', ['investigationId', 'recordId'], { unique: true });
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'hash' });
      }
      if (!db.objectStoreNames.contains('ingestionBatches')) {
        const batches = db.createObjectStore('ingestionBatches', { keyPath: 'id' });
        batches.createIndex('investigationId', 'investigationId', { unique: false });
      }
      // Phase 4: ingestionBatches IS the "Ingestion Job" model the brief
      // asks for - extended with a status index here rather than
      // duplicated into a parallel `ingestionJobs` store, same "extend a
      // pre-existing store" decision as Phase 3's claims. Old batch rows
      // have no `status` field; read as COMPLETED (their only prior
      // meaning - the pipeline always ran a batch to completion before
      // this phase) by the read-side "absent means default" convention.
      {
        const batchesStore = req.transaction.objectStore('ingestionBatches');
        if (!batchesStore.indexNames.contains('status')) batchesStore.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('outlines')) {
        // One outline per investigation - investigationId IS the key.
        db.createObjectStore('outlines', { keyPath: 'investigationId' });
      }
      if (!db.objectStoreNames.contains('evidenceItems')) {
        const evidence = db.createObjectStore('evidenceItems', { keyPath: 'id' });
        evidence.createIndex('investigationId', 'investigationId', { unique: false });
        evidence.createIndex('sourceRecordId', 'sourceRecordId', { unique: false });
      }
      if (!db.objectStoreNames.contains('claims')) {
        const claims = db.createObjectStore('claims', { keyPath: 'id' });
        claims.createIndex('investigationId', 'investigationId', { unique: false });
      }
      // Phase 3: new indexes on the PRE-EXISTING `claims` store, added
      // during this same upgrade - IndexedDB allows adding an index to an
      // existing store inside a version-change transaction; older claim
      // records simply have `status`/`subjectEntityIds` as undefined until
      // read with the same "absent means default" convention already used
      // for `excludedFromReport` (see createClaim/updateClaim below).
      {
        const claimsStore = req.transaction.objectStore('claims');
        if (!claimsStore.indexNames.contains('status')) claimsStore.createIndex('status', 'status', { unique: false });
        if (!claimsStore.indexNames.contains('subjectEntityIds')) claimsStore.createIndex('subjectEntityIds', 'subjectEntityIds', { unique: false, multiEntry: true });
      }
      if (!db.objectStoreNames.contains('qualitativeAnalysis')) {
        // One cached result per investigation - investigationId IS the key.
        db.createObjectStore('qualitativeAnalysis', { keyPath: 'investigationId' });
      }
      if (!db.objectStoreNames.contains('quantitativeFindings')) {
        const qf = db.createObjectStore('quantitativeFindings', { keyPath: 'id' });
        qf.createIndex('investigationId', 'investigationId', { unique: false });
      }
      if (!db.objectStoreNames.contains('qualitativeFindings')) {
        const qlf = db.createObjectStore('qualitativeFindings', { keyPath: 'id' });
        qlf.createIndex('investigationId', 'investigationId', { unique: false });
      }
      if (!db.objectStoreNames.contains('crossValidations')) {
        const xv = db.createObjectStore('crossValidations', { keyPath: 'id' });
        xv.createIndex('investigationId', 'investigationId', { unique: false });
      }
      if (!db.objectStoreNames.contains('askSourcesHistory')) {
        const ask = db.createObjectStore('askSourcesHistory', { keyPath: 'id' });
        ask.createIndex('investigationId', 'investigationId', { unique: false });
      }
      if (!db.objectStoreNames.contains('entities')) {
        const entities = db.createObjectStore('entities', { keyPath: 'id' });
        entities.createIndex('investigationId', 'investigationId', { unique: false });
        entities.createIndex('byInvestigationAndType', ['investigationId', 'type'], { unique: false });
        entities.createIndex('nameNormalized', 'nameNormalized', { unique: false });
        entities.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('relationships')) {
        const relationships = db.createObjectStore('relationships', { keyPath: 'id' });
        relationships.createIndex('investigationId', 'investigationId', { unique: false });
        relationships.createIndex('sourceEntityId', 'sourceEntityId', { unique: false });
        relationships.createIndex('targetEntityId', 'targetEntityId', { unique: false });
        relationships.createIndex('type', 'type', { unique: false });
        relationships.createIndex('status', 'status', { unique: false });
        relationships.createIndex('updatedAt', 'updatedAt', { unique: false });
        // multiEntry: lets a future "what relationships cite this evidence
        // item" query (e.g. warning before deleting evidence still in use)
        // hit an index instead of a full scan. Standard IndexedDB feature,
        // supported everywhere this app runs - low-risk to add now per
        // docs/INVESTIGATION_WORKSPACE_PLAN.md's "add useful indexes where
        // low-risk."
        relationships.createIndex('evidenceIds', 'evidenceIds', { unique: false, multiEntry: true });
      }
      if (!db.objectStoreNames.contains('entityAliases')) {
        const aliases = db.createObjectStore('entityAliases', { keyPath: 'id' });
        aliases.createIndex('entityId', 'entityId', { unique: false });
        aliases.createIndex('investigationId', 'investigationId', { unique: false });
        aliases.createIndex('aliasNormalized', 'aliasNormalized', { unique: false });
      }
      if (!db.objectStoreNames.contains('entityMentions')) {
        const mentions = db.createObjectStore('entityMentions', { keyPath: 'id' });
        mentions.createIndex('investigationId', 'investigationId', { unique: false });
        mentions.createIndex('entityId', 'entityId', { unique: false });
        mentions.createIndex('evidenceId', 'evidenceId', { unique: false });
        mentions.createIndex('quotedNameNormalized', 'quotedNameNormalized', { unique: false });
        mentions.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('claimEvidence')) {
        const claimEvidence = db.createObjectStore('claimEvidence', { keyPath: 'id' });
        claimEvidence.createIndex('investigationId', 'investigationId', { unique: false });
        claimEvidence.createIndex('claimId', 'claimId', { unique: false });
        claimEvidence.createIndex('evidenceId', 'evidenceId', { unique: false });
        claimEvidence.createIndex('stance', 'stance', { unique: false });
      }
      if (!db.objectStoreNames.contains('claimFindings')) {
        const findings = db.createObjectStore('claimFindings', { keyPath: 'id' });
        findings.createIndex('investigationId', 'investigationId', { unique: false });
        findings.createIndex('claimId', 'claimId', { unique: false });
        findings.createIndex('classification', 'classification', { unique: false });
        findings.createIndex('updatedAt', 'updatedAt', { unique: false });
        findings.createIndex('evidenceIds', 'evidenceIds', { unique: false, multiEntry: true });
      }
      if (!db.objectStoreNames.contains('claimHistory')) {
        const history = db.createObjectStore('claimHistory', { keyPath: 'id' });
        history.createIndex('investigationId', 'investigationId', { unique: false });
        history.createIndex('claimId', 'claimId', { unique: false });
      }
      if (!db.objectStoreNames.contains('ingestionItems')) {
        const items = db.createObjectStore('ingestionItems', { keyPath: 'id' });
        items.createIndex('investigationId', 'investigationId', { unique: false });
        items.createIndex('jobId', 'jobId', { unique: false });
        items.createIndex('recordId', 'recordId', { unique: false });
        items.createIndex('status', 'status', { unique: false });
        items.createIndex('byInvestigationAndStatus', ['investigationId', 'status'], { unique: false });
        items.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('reviewCandidates')) {
        // Keyed by recordId, not ingestionItemId - a candidate belongs to
        // a record's text, and the review queue navigates record-first
        // (one ingestionItem <-> one recordId already; joining through
        // recordId is sufficient and avoids a redundant second FK).
        const candidates = db.createObjectStore('reviewCandidates', { keyPath: 'id' });
        candidates.createIndex('investigationId', 'investigationId', { unique: false });
        candidates.createIndex('recordId', 'recordId', { unique: false });
        candidates.createIndex('state', 'state', { unique: false });
        candidates.createIndex('candidateEntityIds', 'candidateEntityIds', { unique: false, multiEntry: true });
      }
      if (!db.objectStoreNames.contains('watchlists')) {
        const watchlists = db.createObjectStore('watchlists', { keyPath: 'id' });
        watchlists.createIndex('investigationId', 'investigationId', { unique: false });
        watchlists.createIndex('termNormalized', 'termNormalized', { unique: false });
      }
      if (!db.objectStoreNames.contains('watchlistMatches')) {
        const wMatches = db.createObjectStore('watchlistMatches', { keyPath: 'id' });
        wMatches.createIndex('investigationId', 'investigationId', { unique: false });
        wMatches.createIndex('watchlistId', 'watchlistId', { unique: false });
        wMatches.createIndex('recordId', 'recordId', { unique: false });
        wMatches.createIndex('state', 'state', { unique: false });
      }
      if (!db.objectStoreNames.contains('reviewHistory')) {
        const reviewHistory = db.createObjectStore('reviewHistory', { keyPath: 'id' });
        reviewHistory.createIndex('investigationId', 'investigationId', { unique: false });
        reviewHistory.createIndex('objectId', 'objectId', { unique: false });
        reviewHistory.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('investigators')) {
        // Deliberately NOT scoped to one investigation - a small team's
        // identities are shared across cases, same as a real login would
        // be. Explicitly NOT an auth system (brief §10): no password, no
        // session, just a display name a reviewer can attribute their own
        // actions to.
        db.createObjectStore('investigators', { keyPath: 'id' });
      }
      // Deep Discovery Phase 1 (additive): one row per discovery run, and the run's ledger of every address
      // requested or skipped. Both carry investigationId so they travel in .chronium.json.
      if (!db.objectStoreNames.contains('discoveryRuns')) {
        const runs = db.createObjectStore('discoveryRuns', { keyPath: 'id' });
        runs.createIndex('investigationId', 'investigationId', { unique: false });
      }
      if (!db.objectStoreNames.contains('discoveryLedger')) {
        const ledger = db.createObjectStore('discoveryLedger', { keyPath: 'id' });
        ledger.createIndex('investigationId', 'investigationId', { unique: false });
        ledger.createIndex('runId', 'runId', { unique: false });
      }
      // Records Recovery (additive). Calculated results are never stored; only a reviewer's decisions (append-only,
      // latest wins), the person's records requests with their corrections and follow-up drafts, and the per-case
      // settings. All carry investigationId so they travel in .chronium.json.
      if (!db.objectStoreNames.contains('recoveryReviews')) {
        const rv = db.createObjectStore('recoveryReviews', { keyPath: 'id' });
        rv.createIndex('investigationId', 'investigationId', { unique: false });
        rv.createIndex('itemKey', 'itemKey', { unique: false });
      }
      if (!db.objectStoreNames.contains('recoveryRequests')) {
        const rq = db.createObjectStore('recoveryRequests', { keyPath: 'id' });
        rq.createIndex('investigationId', 'investigationId', { unique: false });
      }
      if (!db.objectStoreNames.contains('recoverySettings')) {
        db.createObjectStore('recoverySettings', { keyPath: 'investigationId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).then(async (db) => { await ensureClaimEvidenceBackfill(db); return db; });
  return dbPromise;
}

// One-time data backfill: copies the pre-existing `claims` store's inline
// `links` array (the old supports/contradicts model) into the new
// `claimEvidence` join table, so nothing already recorded is lost when
// the UI/Report switch to reading claimEvidence exclusively. The old
// `links` field is left on those claim records untouched (never deleted -
// CANON.md "never lose the receipt"), just no longer read. Gated by a
// `meta` flag so it runs exactly once per database, ever - safe to call
// on every openDb() (including on a brand-new database, where it's a
// harmless no-op since there are no legacy `links` to copy).
async function ensureClaimEvidenceBackfill(db) {
  const already = await tx(db, ['meta'], 'readonly', (t) => reqToPromise(t.objectStore('meta').get('claimEvidenceBackfillDone')));
  if (already?.value) return;
  await tx(db, ['claims', 'claimEvidence', 'meta'], 'readwrite', async (t) => {
    const claims = await reqToPromise(t.objectStore('claims').getAll());
    const claimEvidenceStore = t.objectStore('claimEvidence');
    for (const claim of claims) {
      for (const link of claim.links || []) {
        if (!link?.evidenceItemId) continue;
        await reqToPromise(claimEvidenceStore.add({
          id: genId('cev'), investigationId: claim.investigationId, claimId: claim.id, evidenceId: link.evidenceItemId,
          stance: link.stance === 'contradicts' ? 'contradicts' : 'supports',
          notes: '', createdAt: claim.createdAt || new Date().toISOString()
        }));
      }
    }
    await reqToPromise(t.objectStore('meta').put({ key: 'claimEvidenceBackfillDone', value: true }));
  });
}

export function tx(db, stores, mode, work) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(work(t)).then((r) => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

export function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function genId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listInvestigations() {
  const db = await openDb();
  return tx(db, ['investigations'], 'readonly', (t) =>
    reqToPromise(t.objectStore('investigations').getAll())
  ).then((rows) => rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
}

export async function createInvestigation({ name, description }) {
  const db = await openDb();
  const now = new Date().toISOString();
  const investigation = { id: genId('inv'), name: name.trim(), description: (description || '').trim(), createdAt: now, updatedAt: now };
  await tx(db, ['investigations'], 'readwrite', (t) => t.objectStore('investigations').add(investigation));
  return investigation;
}

export async function deleteInvestigation(investigationId) {
  const db = await openDb();
  await tx(db, ['investigations', 'investigationRecords', 'discoveryRuns', 'discoveryLedger', 'recoveryReviews', 'recoveryRequests', 'recoverySettings'], 'readwrite', async (t) => {
    t.objectStore('recoverySettings').delete(investigationId);
    for (const name of ['discoveryRuns', 'discoveryLedger', 'recoveryReviews', 'recoveryRequests']) {
      for (const row of await reqToPromise(t.objectStore(name).index('investigationId').getAll(investigationId))) t.objectStore(name).delete(row.id);
    }
    t.objectStore('investigations').delete(investigationId);
    const idx = t.objectStore('investigationRecords').index('investigationId');
    const links = await reqToPromise(idx.getAll(investigationId));
    for (const link of links) t.objectStore('investigationRecords').delete(link.id);
  });
}

export async function saveRecordToInvestigation(investigationId, record) {
  const db = await openDb();
  return tx(db, ['records', 'investigationRecords'], 'readwrite', async (t) => {
    const records = t.objectStore('records');
    const canonicalKey = record.canonicalKey || record.originalUrl || record.archiveUrl || record.id;
    const existing = await reqToPromise(records.index('canonicalKey').get(canonicalKey));
    let stored = existing;
    if (!stored) {
      stored = { ...record, id: genId('rec'), canonicalKey, savedAt: new Date().toISOString() };
      await reqToPromise(records.add(stored));
    }
    const links = t.objectStore('investigationRecords');
    const pairIndex = links.index('byPair');
    const already = await reqToPromise(pairIndex.get([investigationId, stored.id]));
    if (!already) {
      await reqToPromise(links.add({ investigationId, recordId: stored.id, addedAt: new Date().toISOString(), note: '' }));
    }
    return stored;
  });
}

export async function removeRecordFromInvestigation(investigationId, recordId) {
  const db = await openDb();
  await tx(db, ['investigationRecords'], 'readwrite', async (t) => {
    const links = t.objectStore('investigationRecords');
    const match = await reqToPromise(links.index('byPair').get([investigationId, recordId]));
    if (match) links.delete(match.id);
  });
}

export async function listInvestigationRecords(investigationId) {
  const db = await openDb();
  return tx(db, ['records', 'investigationRecords'], 'readonly', async (t) => {
    const links = await reqToPromise(t.objectStore('investigationRecords').index('investigationId').getAll(investigationId));
    const records = t.objectStore('records');
    const out = [];
    for (const link of links) {
      const record = await reqToPromise(records.get(link.recordId));
      if (record) out.push({ ...record, addedAt: link.addedAt, note: link.note });
    }
    return out.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
  });
}

export async function getSavedCanonicalKeys(investigationId) {
  const rows = await listInvestigationRecords(investigationId);
  return new Set(rows.map((r) => r.canonicalKey));
}

// Maps a character offset in extracted text back to a 1-based page number,
// using the PdfAdapter's pageOffsets (see public/ingest/adapters.js). Returns
// null when the source has no page metadata (non-PDF, or extraction predates
// this field).
function pageForOffset(pageOffsets, offset) {
  if (!Array.isArray(pageOffsets) || !pageOffsets.length || offset == null) return null;
  let page = 1;
  for (let i = 0; i < pageOffsets.length; i++) {
    if (offset >= pageOffsets[i]) page = i + 1;
    else break;
  }
  return page;
}

// Builds a passage centered on a match offset instead of returning the whole
// document - `raw` is the exact excerpt (safe to save as Evidence verbatim),
// `display` adds ellipsis markers when the passage was truncated (for UI only).
function buildPassage(text, offset, termLength, radius = 180) {
  const start = Math.max(0, offset - radius);
  const end = Math.min(text.length, offset + termLength + radius);
  const raw = text.slice(start, end).replace(/\s+/g, ' ').trim();
  const display = (start > 0 ? '…' : '') + raw + (end < text.length ? '…' : '');
  return { raw, display };
}

export async function searchInvestigation(investigationId, query, limit = 50) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = await listInvestigationRecords(investigationId);
  if (!terms.length) return rows.slice(0, limit);
  const identifierTerms = terms.filter((t) => /\d/.test(t) && t.length >= 4);
  const matches = [];
  for (const r of rows) {
    const extractedText = r.extractedText || '';
    const haystack = `${r.title || ''} ${r.description || r.snippet || ''} ${r.category || ''} ${r.originalUrl || ''} ${extractedText}`.toLowerCase();
    // Ranked, not all-or-nothing: a natural-language question rarely has
    // every extracted word in one document. Require at least half the
    // terms (min 1), then sort best-covered first below.
    const matchedTerms = terms.filter((term) => haystack.includes(term));
    if (matchedTerms.length < Math.max(1, Math.ceil(terms.length / 2))) continue;
    // A term with a digit is a specific identifier (2026-29, 2021, HC-0091):
    // a document that lacks it is not an answer, however well it matches the
    // other words (Ordinance 2024-31 is not Ordinance 2026-29).
    if (identifierTerms.some((term) => !haystack.includes(term))) continue;
    const titleLower = `${r.title || ''}`.toLowerCase();
    const rankScore = matchedTerms.length * 10 + matchedTerms.filter((term) => titleLower.includes(term)).length;

    // Find the first search term that actually hits inside the document body
    // (not just the title/category) so the passage points at real content.
    const textLower = extractedText.toLowerCase();
    let matchOffset = -1, matchTerm = null;
    for (const term of matchedTerms) {
      const idx = textLower.indexOf(term);
      if (idx >= 0) { matchOffset = idx; matchTerm = term; break; }
    }

    if (matchOffset < 0) { matches.push({ ...r, rankScore, matchedTermCount: matchedTerms.length, queryTermCount: terms.length }); continue; } // matched only title/category/url - no in-document passage to show
    const { raw, display } = buildPassage(extractedText, matchOffset, matchTerm.length);
    matches.push({
      ...r,
      matchPassage: display,
      matchPassageRaw: raw,
      matchOffset,
      matchTerm,
      matchPage: pageForOffset(r.metadata?.pageOffsets, matchOffset),
      rankScore, matchedTermCount: matchedTerms.length, queryTermCount: terms.length
    });
  }
  matches.sort((a, b) => (b.rankScore || 0) - (a.rankScore || 0));
  return matches.slice(0, limit);
}

export async function searchLibrary(query, limit = 25) {
  const db = await openDb();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const all = await tx(db, ['records'], 'readonly', (t) => reqToPromise(t.objectStore('records').getAll()));
  const matches = all.filter((r) => {
    const haystack = `${r.title || ''} ${r.description || r.snippet || ''} ${r.category || ''} ${r.originalUrl || ''}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  return matches.slice(0, limit).map((r) => ({ ...r, sourceKind: 'personal-library', matchType: 'personal-library' }));
}

export async function updateRecord(recordId, patch) {
  const db = await openDb();
  return tx(db, ['records'], 'readwrite', async (t) => {
    const store = t.objectStore('records');
    const existing = await reqToPromise(store.get(recordId));
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    await reqToPromise(store.put(updated));
    return updated;
  });
}

export async function getRecordByCanonicalKey(canonicalKey) {
  const db = await openDb();
  return tx(db, ['records'], 'readonly', (t) =>
    reqToPromise(t.objectStore('records').index('canonicalKey').get(canonicalKey))
  );
}

// Human-readable Source ID per docs/RESEARCH_METHOD.md (CHR-000184 style).
// A small counter in `meta`, incremented inside its own transaction.
export async function getNextSourceId() {
  const db = await openDb();
  return tx(db, ['meta'], 'readwrite', async (t) => {
    const store = t.objectStore('meta');
    const row = await reqToPromise(store.get('sourceIdCounter'));
    const next = (row?.value || 0) + 1;
    await reqToPromise(store.put({ key: 'sourceIdCounter', value: next }));
    return `CHR-${String(next).padStart(6, '0')}`;
  });
}

// Original-evidence preservation, deduped globally by content hash. Returns
// {isNew} so callers (the ingestion pipeline) can report duplicate counts
// without guessing from the record layer.
export async function saveBlob({ hash, blob, mimeType, size }) {
  const db = await openDb();
  return tx(db, ['blobs'], 'readwrite', async (t) => {
    const store = t.objectStore('blobs');
    const existing = await reqToPromise(store.get(hash));
    if (existing) return { isNew: false };
    await reqToPromise(store.add({ hash, blob, mimeType, size, firstSeenAt: new Date().toISOString() }));
    return { isNew: true };
  });
}

export async function getBlob(hash) {
  const db = await openDb();
  return tx(db, ['blobs'], 'readonly', (t) => reqToPromise(t.objectStore('blobs').get(hash)));
}

// Phase 4 addition: `status`/`sourceType`/`documentCount`/`processedCount`/
// `failedCount`/`startedAt`/`metadata` are new, optional fields - existing
// callers that only pass {investigationId, label} keep working unchanged.
// `status` defaults to RUNNING (this function has always meant "a batch is
// starting right now" - the pipeline calls it immediately before its
// processing loop) rather than QUEUED, since nothing in this codebase
// defers a batch's start yet.
export async function createIngestionBatch({ investigationId, label, sourceType, documentCount }) {
  const db = await openDb();
  const now = new Date().toISOString();
  const batch = {
    id: genId('batch'), investigationId, label, sourceType: sourceType || 'bulk-files', createdAt: now, startedAt: now,
    status: 'RUNNING', completedAt: null, fileCount: 0, byteTotal: 0,
    documentCount: documentCount ?? null, processedCount: 0, failedCount: 0,
    skipped: [], errors: [], duplicates: [], metadata: {}
  };
  await tx(db, ['ingestionBatches'], 'readwrite', (t) => t.objectStore('ingestionBatches').add(batch));
  return batch;
}

export async function updateIngestionBatch(batchId, patch) {
  const db = await openDb();
  return tx(db, ['ingestionBatches'], 'readwrite', async (t) => {
    const store = t.objectStore('ingestionBatches');
    const batch = await reqToPromise(store.get(batchId));
    if (!batch) return null;
    const updated = { ...batch, ...patch };
    await reqToPromise(store.put(updated));
    return updated;
  });
}

export async function getIngestionBatch(batchId) {
  const db = await openDb();
  return tx(db, ['ingestionBatches'], 'readonly', (t) => reqToPromise(t.objectStore('ingestionBatches').get(batchId)));
}

export async function listIngestionBatches(investigationId) {
  const db = await openDb();
  return tx(db, ['ingestionBatches'], 'readonly', (t) =>
    reqToPromise(t.objectStore('ingestionBatches').index('investigationId').getAll(investigationId))
  ).then((rows) => rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
}

export async function addUserUrl(investigationId, { url, title, note }) {
  const record = {
    id: genId('rec'),
    source: 'User-submitted',
    sourceKind: 'personal-library',
    title: title?.trim() || url,
    originalUrl: url,
    archiveUrl: null,
    captureDate: null,
    mime: null,
    snippet: note || '',
    matchType: 'user-submitted',
    sourceType: 'user-submitted'
  };
  return saveRecordToInvestigation(investigationId, record);
}

// ---------------------------------------------------------------------------
// Bibliography: user-asserted metadata layered onto an existing source
// record (Publisher/Creator, Source Class, Document Type, Publication Date,
// Date Coverage, Reliability, Relevant-Pages Note, Research Notes - the
// judgment-call fields from docs/RESEARCH_METHOD.md's Target Source Record
// Shape). No new store: these are just additional fields on `records`,
// written through the existing updateRecord(). Everything else in that
// target shape (retrieval date, original location, archive/capture info,
// version/hash, relevant pages actually cited, investigation usage,
// preservation status) is a fact Chronium already knows or can compute from
// `records`/`evidenceItems`/`claims` - see computeBiblioDerived() below,
// never duplicated into stored state.
// ---------------------------------------------------------------------------
export async function updateBibliographyDetails(recordId, { publisher, sourceType, documentType, publicationDate, dateCoverage, reliability, relevantPagesNote, researchNotes }) {
  return updateRecord(recordId, {
    biblio: {
      publisher: publisher || '',
      sourceType: sourceType || '',
      documentType: documentType || '',
      publicationDate: publicationDate || '',
      dateCoverage: dateCoverage || '',
      reliability: reliability || '',
      relevantPagesNote: relevantPagesNote || '',
      researchNotes: researchNotes || ''
    }
  });
}

// Derives the rest of the Target Source Record Shape from facts Chronium
// already has - never asked of the researcher, never stored twice. Returns
// null-safe strings/arrays so the UI never has to guess about a missing
// field (CANON.md: "don't require every field when unknown").
export function computeBiblioDerived(record, evidenceItems, claims) {
  const items = (evidenceItems || []).filter((e) => e.sourceRecordId === record.id);
  const evidenceLocations = [...new Set(items.map((e) => e.location).filter(Boolean))];
  const evidenceIds = new Set(items.map((e) => e.id));
  const citingClaims = (claims || []).filter((c) => (c.links || []).some((l) => evidenceIds.has(l.evidenceItemId)));
  const alternates = Array.isArray(record.alternateArchiveUrls) ? record.alternateArchiveUrls : [];
  return {
    retrievedAt: record.addedAt || record.savedAt || null,
    originalLocation: record.originalUrl || null,
    archive: record.archiveUrl ? { url: record.archiveUrl, source: record.source || null, captureDate: record.captureDate || null, alternateCount: alternates.length } : null,
    versionHash: record.fileHash || null,
    pageCount: record.metadata?.pageCount ?? null,
    relevantPages: evidenceLocations,
    usage: { evidenceCount: items.length, claimCount: citingClaims.length, claimIds: citingClaims.map((c) => c.claimId) },
    preservation: {
      originalAvailable: !!record.originalUrl,
      archived: !!record.archiveUrl,
      alternateArchiveCount: alternates.length,
      localCopy: record.storageMode === 'local-copy'
    }
  };
}

// ---------------------------------------------------------------------------
// Research Outline: one per investigation - a research question, a method,
// and coverage lanes. Coverage percentage is the researcher's own estimate
// (never computed/fabricated) per CANON.md's SOURCE FACT / COMPUTED FACT /
// AI ANALYSIS separation - Chronium only adds the real, countable evidence
// item total per lane alongside it.
// ---------------------------------------------------------------------------
export async function getOutline(investigationId) {
  const db = await openDb();
  const existing = await tx(db, ['outlines'], 'readonly', (t) => reqToPromise(t.objectStore('outlines').get(investigationId)));
  return existing || { investigationId, researchQuestion: '', method: 'mixed', lanes: [], updatedAt: null };
}

export async function saveOutline(investigationId, { researchQuestion, method }) {
  const db = await openDb();
  return tx(db, ['outlines'], 'readwrite', async (t) => {
    const store = t.objectStore('outlines');
    const existing = await reqToPromise(store.get(investigationId));
    const outline = { investigationId, researchQuestion: researchQuestion ?? existing?.researchQuestion ?? '', method: method ?? existing?.method ?? 'mixed', lanes: existing?.lanes || [], updatedAt: new Date().toISOString() };
    await reqToPromise(store.put(outline));
    return outline;
  });
}

export async function addOutlineLane(investigationId, { label, coveragePct, method, status }) {
  const db = await openDb();
  return tx(db, ['outlines'], 'readwrite', async (t) => {
    const store = t.objectStore('outlines');
    const existing = await reqToPromise(store.get(investigationId)) || { investigationId, researchQuestion: '', method: 'mixed', lanes: [] };
    const lane = {
      id: genId('lane'), label: label.trim(), coveragePct: coveragePct == null ? null : clampPct(coveragePct), notes: '',
      method: method || 'mixed', status: status || 'not-started'
    };
    existing.lanes = [...(existing.lanes || []), lane];
    existing.updatedAt = new Date().toISOString();
    await reqToPromise(store.put(existing));
    return existing;
  });
}

export async function updateOutlineLane(investigationId, laneId, patch) {
  const db = await openDb();
  return tx(db, ['outlines'], 'readwrite', async (t) => {
    const store = t.objectStore('outlines');
    const existing = await reqToPromise(store.get(investigationId));
    if (!existing) return null;
    existing.lanes = (existing.lanes || []).map((l) => l.id === laneId ? { ...l, ...patch, coveragePct: patch.coveragePct !== undefined ? (patch.coveragePct == null ? null : clampPct(patch.coveragePct)) : l.coveragePct } : l);
    existing.updatedAt = new Date().toISOString();
    await reqToPromise(store.put(existing));
    return existing;
  });
}

export async function deleteOutlineLane(investigationId, laneId) {
  const db = await openDb();
  return tx(db, ['outlines'], 'readwrite', async (t) => {
    const store = t.objectStore('outlines');
    const existing = await reqToPromise(store.get(investigationId));
    if (!existing) return null;
    existing.lanes = (existing.lanes || []).filter((l) => l.id !== laneId);
    existing.updatedAt = new Date().toISOString();
    await reqToPromise(store.put(existing));
    return existing;
  });
}

function clampPct(n) { return Math.min(100, Math.max(0, Math.round(Number(n) || 0))); }

// ---------------------------------------------------------------------------
// Evidence Items: a specific excerpt (paragraph/table row/figure/quote)
// pulled from a Source that bears on the investigation. Always cites back
// to the source record it came from - the "never lose the receipt" link.
// ---------------------------------------------------------------------------
export async function listEvidenceItems(investigationId) {
  const db = await openDb();
  const items = await tx(db, ['evidenceItems'], 'readonly', (t) =>
    reqToPromise(t.objectStore('evidenceItems').index('investigationId').getAll(investigationId))
  );
  return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function createEvidenceItem(investigationId, { sourceRecordId, excerptType, excerptText, location, outlineLaneId, notes }) {
  const db = await openDb();
  const item = {
    id: genId('ev'), investigationId, sourceRecordId, excerptType: excerptType || 'paragraph',
    excerptText: excerptText.trim(), location: (location || '').trim(), outlineLaneId: outlineLaneId || null,
    notes: (notes || '').trim(), createdAt: new Date().toISOString()
  };
  await tx(db, ['evidenceItems'], 'readwrite', (t) => t.objectStore('evidenceItems').add(item));
  return item;
}

// Cascade-deletes entityMentions (Phase 2) and claimEvidence links
// (Phase 3) pointing at this evidence item, for the same "no orphan
// pointer records" reason as deleteEntity() above - a mention or a
// support/contradict/contextualize LINK has no meaning without the
// evidence it points at, unlike a Relationship or a Finding, which are
// themselves the factual record (Relationships stay, rendered as
// "removed"; Findings get the conservative treatment below, per Phase 3
// brief §13's explicit "BLOCK THE DELETE... do not silently preserve a
// false appearance of support").
//
// THE HARD RULE, referential-integrity half (Phase 3 brief §13): if this
// evidence item is the ONLY evidence keeping a DOCUMENTED_FACT/
// SUPPORTED_INFERENCE/ALLEGATION finding non-empty, the ENTIRE deletion
// is refused - checked for every affected finding BEFORE any mutation is
// issued, so a refusal never leaves a partial delete behind. Chosen over
// the alternative (auto-downgrading the finding) because silently
// changing what a finding asserts is itself an editorial act Chronium
// has no business taking on the investigator's behalf - refusing and
// telling them to reclassify/delete the finding first keeps that
// decision explicitly human. If this evidence is one of SEVERAL cited by
// a finding, the deletion proceeds and that finding's evidenceIds is
// simply trimmed of the now-gone reference - it still has real evidence
// left, so nothing false is implied.
export async function deleteEvidenceItem(evidenceItemId) {
  const db = await openDb();
  await tx(db, ['evidenceItems', 'entityMentions', 'claimEvidence', 'claimFindings'], 'readwrite', async (t) => {
    const findingsStore = t.objectStore('claimFindings');
    const allFindings = await reqToPromise(findingsStore.getAll());
    const affected = allFindings.filter((f) => (f.evidenceIds || []).includes(evidenceItemId));
    for (const f of affected) {
      const remaining = f.evidenceIds.filter((id) => id !== evidenceItemId);
      if (!remaining.length && FINDING_CLASSIFICATIONS_REQUIRING_EVIDENCE.includes(f.classification)) {
        throw new FindingEvidenceRequiredError(`Cannot delete this evidence item - it is the only evidence behind the ${f.classification} finding "${f.conclusion.slice(0, 80)}${f.conclusion.length > 80 ? '…' : ''}". Delete or reclassify that finding first.`);
      }
    }

    // Nothing above threw - safe to actually mutate now.
    t.objectStore('evidenceItems').delete(evidenceItemId);
    const mentionIdx = t.objectStore('entityMentions').index('evidenceId');
    const mentions = await reqToPromise(mentionIdx.getAll(evidenceItemId));
    for (const m of mentions) t.objectStore('entityMentions').delete(m.id);
    const cevIdx = t.objectStore('claimEvidence').index('evidenceId');
    const cevRows = await reqToPromise(cevIdx.getAll(evidenceItemId));
    for (const c of cevRows) t.objectStore('claimEvidence').delete(c.id);
    for (const f of affected) {
      const remaining = f.evidenceIds.filter((id) => id !== evidenceItemId);
      await reqToPromise(findingsStore.put({ ...f, evidenceIds: remaining, updatedAt: new Date().toISOString() }));
    }
  });
}

// ---------------------------------------------------------------------------
// Claims (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 3): a specific
// factual assertion being TESTED - what Findings and Reports reason over.
// Carries a human-readable CHR-CLAIM-NNN id (parallel to Source's
// CHR-NNNNNN) so a claim can be cited independent of any one
// investigation.
//
// UNLIKE Relationships/Mentions, a Claim does NOT require evidence to
// exist - it may legitimately sit at UNVERIFIED as an investigative lead
// with nothing behind it yet (Phase 3 brief §3/§11: "an unsupported
// question/lead may remain in the claim ledger"). The hard evidence
// requirement in this phase lives on Claim FINDINGS instead (see below) -
// a Claim is the question, a Finding is the evidence-backed answer.
// `status` is always an explicit investigator decision - nothing in this
// file ever derives it from a supporting/contradicting evidence count.
//
// `subjectEntityIds` existence IS checked at write time (an entity id
// must be real if provided, same as Relationships/Mentions), but is a
// SOFT reference on delete (matching Relationships' convention): if a
// referenced entity is later deleted, the claim keeps existing and the
// UI renders "(subject removed)" for that id - a claim's statement text
// is self-contained prose that stays meaningful even if the entity
// record naming it is gone.
// ---------------------------------------------------------------------------
export async function getNextClaimId() {
  const db = await openDb();
  return tx(db, ['meta'], 'readwrite', async (t) => {
    const store = t.objectStore('meta');
    const row = await reqToPromise(store.get('claimIdCounter'));
    const next = (row?.value || 0) + 1;
    await reqToPromise(store.put({ key: 'claimIdCounter', value: next }));
    return `CHR-CLAIM-${String(next).padStart(3, '0')}`;
  });
}

export async function listClaims(investigationId) {
  const db = await openDb();
  const claims = await tx(db, ['claims'], 'readonly', (t) =>
    reqToPromise(t.objectStore('claims').index('investigationId').getAll(investigationId))
  );
  return claims.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getClaim(claimId) {
  const db = await openDb();
  return tx(db, ['claims'], 'readonly', (t) => reqToPromise(t.objectStore('claims').get(claimId)));
}

// "Claims involving this subject" (Phase 3 brief §8) - explicit entity
// IDs only, never plain-text name matching.
export async function listClaimsForEntity(investigationId, entityId) {
  const db = await openDb();
  const rows = await tx(db, ['claims'], 'readonly', (t) => reqToPromise(t.objectStore('claims').index('subjectEntityIds').getAll(entityId)));
  return rows.filter((c) => c.investigationId === investigationId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function assertClaimSubjectsExist(t, investigationId, subjectEntityIds) {
  const entities = t.objectStore('entities');
  for (const entityId of subjectEntityIds) {
    const entity = await reqToPromise(entities.get(entityId));
    if (!entity || entity.investigationId !== investigationId) {
      throw new ClaimValidationError(`Subject entity "${entityId}" was not found in this investigation.`);
    }
  }
}

export async function createClaim(investigationId, fields) {
  const shaped = validateClaimFields({ investigationId, ...fields });
  const db = await openDb();
  const claimId = await getNextClaimId();
  return tx(db, ['entities', 'claims'], 'readwrite', async (t) => {
    await assertClaimSubjectsExist(t, investigationId, shaped.subjectEntityIds);
    const now = new Date().toISOString();
    const claim = { id: genId('claim'), claimId, ...shaped, createdAt: now, updatedAt: now };
    await reqToPromise(t.objectStore('claims').add(claim));
    return claim;
  });
}

// Blocks deletion if any Finding still cites this claim (a Finding is a
// standing conclusion ABOUT a specific claim - deleting the claim out
// from under it would leave the finding pointing at nothing, the same
// "don't silently preserve a false appearance of support" concern as
// evidence deletion below). Cascades claimEvidence links (safe - they're
// just supports/contradicts/contextualizes pointers, not conclusions
// themselves) and claimHistory rows (same reasoning as the aliases/
// mentions cascade in Phase 1/2 - meaningless without their claim).
export async function deleteClaim(claimId) {
  const db = await openDb();
  await tx(db, ['claims', 'claimEvidence', 'claimFindings', 'claimHistory'], 'readwrite', async (t) => {
    const findingsIdx = t.objectStore('claimFindings').index('claimId');
    const relatedFindings = await reqToPromise(findingsIdx.getAll(claimId));
    if (relatedFindings.length) {
      throw new ClaimValidationError(`Cannot delete this claim - ${relatedFindings.length} finding${relatedFindings.length === 1 ? '' : 's'} still cite${relatedFindings.length === 1 ? 's' : ''} it. Delete those findings first.`);
    }
    t.objectStore('claims').delete(claimId);
    const cevIdx = t.objectStore('claimEvidence').index('claimId');
    const cevRows = await reqToPromise(cevIdx.getAll(claimId));
    for (const c of cevRows) t.objectStore('claimEvidence').delete(c.id);
    const histIdx = t.objectStore('claimHistory').index('claimId');
    const histRows = await reqToPromise(histIdx.getAll(claimId));
    for (const h of histRows) t.objectStore('claimHistory').delete(h.id);
  });
}

// ---------------------------------------------------------------------------
// Qualitative Analysis result cache - one per investigation, so revisiting
// the Analysis tab shows the last AI result instantly instead of either
// re-running a paid call or showing nothing. The server independently
// caches by content hash too (src/index.js), so even an explicit re-run on
// unchanged evidence is usually free within its cache window.
// ---------------------------------------------------------------------------
export async function getQualitativeAnalysis(investigationId) {
  const db = await openDb();
  return tx(db, ['qualitativeAnalysis'], 'readonly', (t) => reqToPromise(t.objectStore('qualitativeAnalysis').get(investigationId)));
}

export async function saveQualitativeAnalysis(investigationId, { result, model }) {
  const db = await openDb();
  const row = { investigationId, result, model: model || null, createdAt: new Date().toISOString() };
  await tx(db, ['qualitativeAnalysis'], 'readwrite', (t) => t.objectStore('qualitativeAnalysis').put(row));
  return row;
}

// ---------------------------------------------------------------------------
// Quantitative Findings: a specific numeric conclusion the researcher draws
// from evidence, with its formula/method and the exact inputs preserved -
// docs/RESEARCH_METHOD.md Analysis Modes: "must preserve their methodology
// and source/evidence citations." `inputs` values are mechanically summed
// for display (a Computed Fact per CANON.md's Evidence Rules) but the
// `formula`/`method` text is what actually describes what was done - the
// sum is informational, not a substitute for it.
// ---------------------------------------------------------------------------
export async function listQuantitativeFindings(investigationId) {
  const db = await openDb();
  const rows = await tx(db, ['quantitativeFindings'], 'readonly', (t) =>
    reqToPromise(t.objectStore('quantitativeFindings').index('investigationId').getAll(investigationId))
  );
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function createQuantitativeFinding(investigationId, { statement, formula, method, inputs, outlineLaneId }) {
  const db = await openDb();
  const finding = {
    id: genId('qf'), investigationId, statement: statement.trim(), formula: (formula || '').trim(), method: (method || '').trim(),
    inputs: (inputs || []).map((i) => ({ label: (i.label || '').trim(), value: i.value == null || i.value === '' ? null : Number(i.value), evidenceItemId: i.evidenceItemId || null })),
    outlineLaneId: outlineLaneId || null, createdAt: new Date().toISOString()
  };
  await tx(db, ['quantitativeFindings'], 'readwrite', (t) => t.objectStore('quantitativeFindings').add(finding));
  return finding;
}

export async function deleteQuantitativeFinding(id) {
  const db = await openDb();
  await tx(db, ['quantitativeFindings'], 'readwrite', (t) => t.objectStore('quantitativeFindings').delete(id));
}

// ---------------------------------------------------------------------------
// Qualitative Findings: a specific interpretive conclusion the researcher
// draws from narrative evidence, with the supporting passages and
// methodology preserved alongside it - distinct from the AI-assisted
// Qualitative Analysis synthesis (qualitativeAnalysis store), which is a
// cached AI opinion, not a researcher-asserted finding.
// ---------------------------------------------------------------------------
export async function listQualitativeFindings(investigationId) {
  const db = await openDb();
  const rows = await tx(db, ['qualitativeFindings'], 'readonly', (t) =>
    reqToPromise(t.objectStore('qualitativeFindings').index('investigationId').getAll(investigationId))
  );
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function createQualitativeFinding(investigationId, { statement, methodology, evidenceItemIds, outlineLaneId }) {
  const db = await openDb();
  const finding = {
    id: genId('qlf'), investigationId, statement: statement.trim(), methodology: (methodology || '').trim(),
    evidenceItemIds: (evidenceItemIds || []).filter(Boolean), outlineLaneId: outlineLaneId || null, createdAt: new Date().toISOString()
  };
  await tx(db, ['qualitativeFindings'], 'readwrite', (t) => t.objectStore('qualitativeFindings').add(finding));
  return finding;
}

export async function deleteQualitativeFinding(id) {
  const db = await openDb();
  await tx(db, ['qualitativeFindings'], 'readwrite', (t) => t.objectStore('qualitativeFindings').delete(id));
}

// ---------------------------------------------------------------------------
// Mixed-method cross-validation: does a Quantitative Finding agree with a
// Qualitative Finding? This is a researcher judgment call (like Reliability
// in Bibliography), not a computed fact - Chronium never infers agreement
// itself. A 'discrepancy' verdict is surfaced as a review item, never
// auto-promoted to a Claim or a conclusion (docs/RESEARCH_METHOD.md:
// "Never turn a correlation, discrepancy... into a factual conclusion").
// ---------------------------------------------------------------------------
export async function listCrossValidations(investigationId) {
  const db = await openDb();
  const rows = await tx(db, ['crossValidations'], 'readonly', (t) =>
    reqToPromise(t.objectStore('crossValidations').index('investigationId').getAll(investigationId))
  );
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function createCrossValidation(investigationId, { quantitativeFindingId, qualitativeFindingId, verdict, note }) {
  const db = await openDb();
  const entry = {
    id: genId('xv'), investigationId, quantitativeFindingId, qualitativeFindingId,
    verdict: ['consistent', 'discrepancy', 'unclear'].includes(verdict) ? verdict : 'unclear',
    note: (note || '').trim(), createdAt: new Date().toISOString()
  };
  await tx(db, ['crossValidations'], 'readwrite', (t) => t.objectStore('crossValidations').add(entry));
  return entry;
}

export async function deleteCrossValidation(id) {
  const db = await openDb();
  await tx(db, ['crossValidations'], 'readwrite', (t) => t.objectStore('crossValidations').delete(id));
}

// ---------------------------------------------------------------------------
// Claim updates - originally only used for excludedFromReport (a Claim
// can be kept, with its Evidence intact, while being left out of the
// generated Report - "remove this from the report but keep it as
// evidence"). Additive optional field: an existing claim with no
// excludedFromReport key is treated as included (see renderReportPanel,
// public/app.js). Same "absent means default" convention now also covers
// `status` (absent = UNVERIFIED, see validateClaimFields) and
// `subjectEntityIds` (absent = []).
//
// Phase 3 addition: whenever `patch.status` actually changes the status,
// this is the ONE code path that can happen through (there is no
// separate "set status" function to accidentally bypass), so it's also
// the one place a claimHistory row gets written - the lightweight audit
// trail from docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 3 §14.
// ---------------------------------------------------------------------------
export async function updateClaim(claimId, patch) {
  const db = await openDb();
  return tx(db, ['claims', 'entities', 'claimHistory'], 'readwrite', async (t) => {
    const store = t.objectStore('claims');
    const existing = await reqToPromise(store.get(claimId));
    if (!existing) return null;

    const previousStatus = existing.status || 'UNVERIFIED';
    let nextStatus = previousStatus;
    if (patch.status !== undefined) {
      nextStatus = String(patch.status).trim().toUpperCase();
      if (!CLAIM_STATUSES.includes(nextStatus)) {
        throw new ClaimValidationError(`Unknown claim status "${patch.status}". Must be one of: ${CLAIM_STATUSES.join(', ')}.`);
      }
    }

    if (patch.subjectEntityIds !== undefined) {
      const cleanSubjects = Array.isArray(patch.subjectEntityIds) ? [...new Set(patch.subjectEntityIds.filter((id) => typeof id === 'string' && id.trim()))] : [];
      await assertClaimSubjectsExist(t, existing.investigationId, cleanSubjects);
      patch = { ...patch, subjectEntityIds: cleanSubjects };
    }

    const updated = { ...existing, ...patch, status: nextStatus, updatedAt: new Date().toISOString() };
    await reqToPromise(store.put(updated));

    if (nextStatus !== previousStatus) {
      await reqToPromise(t.objectStore('claimHistory').add({
        id: genId('chist'), investigationId: existing.investigationId, claimId,
        previousStatus, newStatus: nextStatus, timestamp: new Date().toISOString()
      }));
    }
    return updated;
  });
}

export async function listClaimHistory(investigationId, claimId) {
  const db = await openDb();
  const rows = await tx(db, ['claimHistory'], 'readonly', (t) => reqToPromise(t.objectStore('claimHistory').index('claimId').getAll(claimId)));
  return rows.filter((h) => h.investigationId === investigationId).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

// ---------------------------------------------------------------------------
// Ask Sources history - one row per question asked in the Research tab's
// conversational query box, so past Q&A stays visible as a running log
// (docs/CANON.md AI-last-resort rule: most rows never touch AI at all -
// resultSummary/aiAnswer just capture what was actually shown, not a
// transcript to feed back into future prompts - see docs/RESEARCH_METHOD.md
// scoping note on single-turn Q&A for this first version).
// ---------------------------------------------------------------------------
export async function listAskSourcesHistory(investigationId) {
  const db = await openDb();
  const rows = await tx(db, ['askSourcesHistory'], 'readonly', (t) =>
    reqToPromise(t.objectStore('askSourcesHistory').index('investigationId').getAll(investigationId))
  );
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function createAskSourcesHistoryEntry(investigationId, { question, intent, factState, resultSummary, aiAnswer }) {
  const db = await openDb();
  const entry = {
    id: genId('ask'), investigationId, question: (question || '').trim(), intent: intent || 'search',
    factState: factState || null, // Source Fact/Computed Fact/Investigative Lead/Unresolved/AI Analysis - public/askCommands.js classifyAskAnswer()
    resultSummary: resultSummary || null, aiAnswer: aiAnswer || null, createdAt: new Date().toISOString()
  };
  await tx(db, ['askSourcesHistory'], 'readwrite', (t) => t.objectStore('askSourcesHistory').add(entry));
  return entry;
}

// ---------------------------------------------------------------------------
// Entities / Relationships (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 1):
// the Subjects tab's case-file layer. An Entity is a subject the
// investigation is tracking (PERSON/ORGANIZATION/etc. - public/entities.js
// ENTITY_TYPES). A Relationship is a directed, typed edge between two
// entities.
//
// THE HARD RULE, enforced here (not just in the UI - see
// public/entities.js's file header and the plan doc's "Hard rules the
// code must enforce, not merely document"): a relationship cannot be
// persisted without at least one evidence item that actually exists in
// this investigation. createRelationship()/updateRelationship() are the
// only way to write to the `relationships` store, and both run the full
// check - shape (public/entities.js validateRelationshipFields) AND
// existence (every cited evidenceId, plus both entity ids, looked up
// inside the SAME readwrite transaction as the eventual write) - so a
// caller that bypasses the UI and calls these functions directly with
// evidenceIds: [] or a fabricated evidence id gets the write rejected,
// not silently downgraded to UNKNOWN or partially saved.
//
// Aliases are their own store, not a field on the entity: "Ray Payne" is
// a claim about a name, not a fact about the entity object, and keeping
// it separate (same join-don't-duplicate pattern as evidenceItems/records
// elsewhere in this file) means adding an alias is a small additive
// write, never a read-modify-write race on the entity itself. Aliases
// never merge entities - see addEntityAlias() below.
// ---------------------------------------------------------------------------

export async function createEntity(investigationId, { type, name, description, metadata }) {
  const fields = validateEntityFields({ investigationId, type, name, description, metadata });
  const db = await openDb();
  const now = new Date().toISOString();
  const entity = { id: genId('ent'), ...fields, createdAt: now, updatedAt: now };
  await tx(db, ['entities'], 'readwrite', (t) => t.objectStore('entities').add(entity));
  return entity;
}

export async function updateEntity(entityId, patch) {
  const db = await openDb();
  return tx(db, ['entities'], 'readwrite', async (t) => {
    const store = t.objectStore('entities');
    const existing = await reqToPromise(store.get(entityId));
    if (!existing) return null;
    // Re-validate the merged result, not just the patch - a patch that
    // clears `name` must fail the same way a create with no name would.
    const merged = { ...existing, ...patch };
    const fields = validateEntityFields({
      investigationId: merged.investigationId, type: merged.type, name: merged.name,
      description: merged.description, metadata: merged.metadata
    });
    const updated = { ...existing, ...fields, updatedAt: new Date().toISOString() };
    await reqToPromise(store.put(updated));
    return updated;
  });
}

export async function getEntity(entityId) {
  const db = await openDb();
  return tx(db, ['entities'], 'readonly', (t) => reqToPromise(t.objectStore('entities').get(entityId)));
}

export async function listEntities(investigationId) {
  const db = await openDb();
  const rows = await tx(db, ['entities'], 'readonly', (t) =>
    reqToPromise(t.objectStore('entities').index('investigationId').getAll(investigationId))
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

// Deliberately simple substring search over name + normalized aliases -
// no fuzzy matching, no similarity scoring (that's identity resolution,
// a later phase per the plan doc). This is what lets "Payne" surface
// BOTH "Marc Payne" and "Raymond Payne" as separate results without
// implying any relationship between them.
export async function findEntities(investigationId, queryText) {
  const q = normalizeForSearch(queryText);
  const [entities, aliases] = await Promise.all([listEntities(investigationId), listEntityAliasesForInvestigation(investigationId)]);
  if (!q) return entities;
  const aliasesByEntity = new Map();
  for (const a of aliases) {
    if (!aliasesByEntity.has(a.entityId)) aliasesByEntity.set(a.entityId, []);
    aliasesByEntity.get(a.entityId).push(a);
  }
  return entities.filter((e) => {
    if (e.nameNormalized.includes(q)) return true;
    const entityAliases = aliasesByEntity.get(e.id) || [];
    return entityAliases.some((a) => a.aliasNormalized.includes(q));
  });
}

// Deletes an entity. Does NOT cascade-delete its relationships - a
// relationship is an evidence-backed factual record (CANON.md "Never
// Lose the Receipt"); silently deleting one because an entity got
// deleted would itself lose a receipt. Relationships pointing at a
// deleted entity render "Entity removed" in the UI, the same convention
// already used for a removed Evidence Item in the Claims panel
// (public/app.js renderClaimsList). Aliases ARE deleted, since they have
// no independent meaning once their entity is gone.
// Mentions are cascade-deleted alongside aliases (Phase 2 addition to
// this Phase 1 function): a mention's entire meaning is "this entity
// appears here" - like an alias, it has no independent meaning once its
// entity is gone, so leaving it behind would be an orphan record, not a
// preserved receipt. Relationships are still NOT cascaded (unchanged from
// Phase 1) - a relationship is itself an evidence-backed factual record,
// so it renders "Entity removed" instead of disappearing.
export async function deleteEntity(entityId) {
  const db = await openDb();
  await tx(db, ['entities', 'entityAliases', 'entityMentions'], 'readwrite', async (t) => {
    t.objectStore('entities').delete(entityId);
    const aliasIdx = t.objectStore('entityAliases').index('entityId');
    const aliases = await reqToPromise(aliasIdx.getAll(entityId));
    for (const a of aliases) t.objectStore('entityAliases').delete(a.id);
    const mentionIdx = t.objectStore('entityMentions').index('entityId');
    const mentions = await reqToPromise(mentionIdx.getAll(entityId));
    for (const m of mentions) t.objectStore('entityMentions').delete(m.id);
  });
}

// The single write path for relationships. See the section header above
// for the full enforcement rule; this function is the enforcement.
export async function createRelationship(investigationId, fields) {
  const shaped = validateRelationshipFields({ investigationId, ...fields });
  const db = await openDb();
  return tx(db, ['entities', 'evidenceItems', 'relationships'], 'readwrite', async (t) => {
    await assertRelationshipReferencesExist(t, shaped);
    const now = new Date().toISOString();
    const relationship = { id: genId('rel'), ...shaped, createdAt: now, updatedAt: now };
    await reqToPromise(t.objectStore('relationships').add(relationship));
    return relationship;
  });
}

export async function updateRelationship(relationshipId, patch) {
  const db = await openDb();
  return tx(db, ['entities', 'evidenceItems', 'relationships'], 'readwrite', async (t) => {
    const store = t.objectStore('relationships');
    const existing = await reqToPromise(store.get(relationshipId));
    if (!existing) return null;
    // Re-validate the FULL merged result every time, not just the changed
    // fields - an update that sets evidenceIds: [] must be rejected
    // exactly like a create would be. "No evidence = no relationship"
    // holds for the entire lifetime of a relationship, not just at
    // creation.
    const merged = { ...existing, ...patch };
    const shaped = validateRelationshipFields({
      investigationId: merged.investigationId, sourceEntityId: merged.sourceEntityId, targetEntityId: merged.targetEntityId,
      type: merged.type, status: merged.status, evidenceIds: merged.evidenceIds,
      dateStart: merged.dateStart, dateEnd: merged.dateEnd, notes: merged.notes, metadata: merged.metadata
    });
    await assertRelationshipReferencesExist(t, shaped);
    const updated = { ...existing, ...shaped, updatedAt: new Date().toISOString() };
    await reqToPromise(store.put(updated));
    return updated;
  });
}

// Existence half of the enforcement rule, run inside the caller's own
// transaction so the check and the write are atomic - no window where a
// referenced evidence item could be deleted between "looks valid" and
// "actually saved." Throws RelationshipValidationError (not a generic
// Error) so callers can distinguish "this is malformed" from "IndexedDB
// itself failed."
async function assertRelationshipReferencesExist(t, { investigationId, sourceEntityId, targetEntityId, evidenceIds }) {
  const entities = t.objectStore('entities');
  const [source, target] = await Promise.all([reqToPromise(entities.get(sourceEntityId)), reqToPromise(entities.get(targetEntityId))]);
  if (!source || source.investigationId !== investigationId) throw new RelationshipValidationError('Source entity not found in this investigation.');
  if (!target || target.investigationId !== investigationId) throw new RelationshipValidationError('Target entity not found in this investigation.');

  const evidenceStore = t.objectStore('evidenceItems');
  for (const evidenceId of evidenceIds) {
    const item = await reqToPromise(evidenceStore.get(evidenceId));
    if (!item || item.investigationId !== investigationId) {
      throw new RelationshipValidationError(`Evidence item "${evidenceId}" was not found in this investigation - a relationship can only cite evidence that actually exists.`);
    }
  }
}

export async function getRelationship(relationshipId) {
  const db = await openDb();
  return tx(db, ['relationships'], 'readonly', (t) => reqToPromise(t.objectStore('relationships').get(relationshipId)));
}

// Returns every relationship touching this entity, each tagged with
// `direction` so the UI can render Outgoing/Incoming as clearly separate
// lists (docs/INVESTIGATION_WORKSPACE_PLAN.md Part 4 "Relationship
// Display": never flatten both directions into one ambiguous list).
export async function listRelationshipsForEntity(investigationId, entityId) {
  const db = await openDb();
  return tx(db, ['relationships'], 'readonly', async (t) => {
    const [asSource, asTarget] = await Promise.all([
      reqToPromise(t.objectStore('relationships').index('sourceEntityId').getAll(entityId)),
      reqToPromise(t.objectStore('relationships').index('targetEntityId').getAll(entityId))
    ]);
    const outgoing = asSource.filter((r) => r.investigationId === investigationId).map((r) => ({ ...r, direction: 'outgoing' }));
    const incoming = asTarget.filter((r) => r.investigationId === investigationId).map((r) => ({ ...r, direction: 'incoming' }));
    return [...outgoing, ...incoming].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  });
}

export async function deleteRelationship(relationshipId) {
  const db = await openDb();
  await tx(db, ['relationships'], 'readwrite', (t) => t.objectStore('relationships').delete(relationshipId));
}

// Alternate names for an entity - "Ray Payne" alongside "Raymond Payne."
// Recording an alias is never identity certainty by itself and never
// merges/renames the entity (docs/INVESTIGATION_WORKSPACE_PLAN.md
// section 3.2 "Entity merging is never automatic"). The original
// human-readable text is preserved; aliasNormalized only supports search
// (findEntities() above).
export async function addEntityAlias(investigationId, entityId, alias) {
  const cleanAlias = normalizeName(alias);
  if (!cleanAlias) throw new RelationshipValidationError('An alias requires text.');
  const db = await openDb();
  return tx(db, ['entities', 'entityAliases'], 'readwrite', async (t) => {
    const entity = await reqToPromise(t.objectStore('entities').get(entityId));
    if (!entity || entity.investigationId !== investigationId) throw new RelationshipValidationError('Entity not found in this investigation.');
    const record = {
      id: genId('alias'), investigationId, entityId, alias: cleanAlias,
      aliasNormalized: normalizeForSearch(cleanAlias), createdAt: new Date().toISOString()
    };
    await reqToPromise(t.objectStore('entityAliases').add(record));
    return record;
  });
}

export async function listEntityAliases(entityId) {
  const db = await openDb();
  const rows = await tx(db, ['entityAliases'], 'readonly', (t) => reqToPromise(t.objectStore('entityAliases').index('entityId').getAll(entityId)));
  return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

async function listEntityAliasesForInvestigation(investigationId) {
  const db = await openDb();
  return tx(db, ['entityAliases'], 'readonly', (t) => reqToPromise(t.objectStore('entityAliases').index('investigationId').getAll(investigationId)));
}

export async function deleteEntityAlias(aliasId) {
  const db = await openDb();
  await tx(db, ['entityAliases'], 'readwrite', (t) => t.objectStore('entityAliases').delete(aliasId));
}

// ---------------------------------------------------------------------------
// Entity Mentions (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 2): "this
// evidence item uses the exact string quotedName to refer to entityId."
// The researcher establishes the link explicitly - Chronium never derives
// one from an alias, from two entities sharing a surname, or from two
// entities merely appearing in the same evidence item.
//
// CRITICAL, non-negotiable per the Phase 2 brief: A MENTION IS NOT A
// RELATIONSHIP. createEntityMention()/updateEntityMention() below must
// NEVER call createRelationship()/updateRelationship(), and never will -
// linking two entities to the same evidence item creates two independent
// mention rows, nothing else. "Mentioned in the same document" stays
// exactly that: co-occurrence, not a claim about a connection between the
// two entities.
//
// Enforcement shape mirrors Relationships exactly: validateEntityMentionFields
// (public/entities.js) checks the shape (quotedName present, ids present);
// assertMentionReferencesExist below checks EXISTENCE (the entity and the
// evidence item are both real, in this investigation) inside the SAME
// transaction as the write - so a direct-call bypass with a fabricated
// entityId/evidenceId is rejected exactly like a bypassed Relationship
// evidence check would be, not silently accepted.
// ---------------------------------------------------------------------------

async function assertMentionReferencesExist(t, { investigationId, entityId, evidenceId }) {
  const entity = await reqToPromise(t.objectStore('entities').get(entityId));
  if (!entity || entity.investigationId !== investigationId) throw new MentionValidationError('Entity not found in this investigation.');
  const evidence = await reqToPromise(t.objectStore('evidenceItems').get(evidenceId));
  if (!evidence || evidence.investigationId !== investigationId) throw new MentionValidationError('Evidence item not found in this investigation.');
}

export async function createEntityMention(investigationId, fields) {
  const shaped = validateEntityMentionFields({ investigationId, ...fields });
  const db = await openDb();
  return tx(db, ['entities', 'evidenceItems', 'entityMentions'], 'readwrite', async (t) => {
    await assertMentionReferencesExist(t, shaped);
    const now = new Date().toISOString();
    const mention = { id: genId('mention'), ...shaped, createdAt: now, updatedAt: now };
    await reqToPromise(t.objectStore('entityMentions').add(mention));
    return mention;
  });
}

export async function updateEntityMention(mentionId, patch) {
  const db = await openDb();
  return tx(db, ['entities', 'evidenceItems', 'entityMentions'], 'readwrite', async (t) => {
    const store = t.objectStore('entityMentions');
    const existing = await reqToPromise(store.get(mentionId));
    if (!existing) return null;
    // Re-validate the full merged result, not just the patch - same
    // discipline as updateRelationship(): an update that clears
    // quotedName or repoints entityId/evidenceId at nothing must be
    // rejected exactly like a create would be.
    const merged = { ...existing, ...patch };
    const shaped = validateEntityMentionFields({
      investigationId: merged.investigationId, entityId: merged.entityId, evidenceId: merged.evidenceId,
      quotedName: merged.quotedName, snippet: merged.snippet, page: merged.page,
      location: merged.location, notes: merged.notes, metadata: merged.metadata
    });
    await assertMentionReferencesExist(t, shaped);
    const updated = { ...existing, ...shaped, updatedAt: new Date().toISOString() };
    await reqToPromise(store.put(updated));
    return updated;
  });
}

export async function getEntityMention(mentionId) {
  const db = await openDb();
  return tx(db, ['entityMentions'], 'readonly', (t) => reqToPromise(t.objectStore('entityMentions').get(mentionId)));
}

export async function listMentionsForEntity(investigationId, entityId) {
  const db = await openDb();
  const rows = await tx(db, ['entityMentions'], 'readonly', (t) => reqToPromise(t.objectStore('entityMentions').index('entityId').getAll(entityId)));
  return rows.filter((m) => m.investigationId === investigationId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function listMentionsForEvidence(investigationId, evidenceId) {
  const db = await openDb();
  const rows = await tx(db, ['entityMentions'], 'readonly', (t) => reqToPromise(t.objectStore('entityMentions').index('evidenceId').getAll(evidenceId)));
  return rows.filter((m) => m.investigationId === investigationId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// Deletes exactly one mention row - never the entity, never the evidence
// item. "Be especially careful not to delete the underlying evidence
// merely because a subject link is removed" is true by construction here:
// this function never touches the `entities` or `evidenceItems` stores.
export async function deleteEntityMention(mentionId) {
  const db = await openDb();
  await tx(db, ['entityMentions'], 'readwrite', (t) => t.objectStore('entityMentions').delete(mentionId));
}

// ---------------------------------------------------------------------------
// Claim Evidence (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 3): the
// proper join table for a Claim's supports/contradicts/contextualizes
// links - replaces the pre-existing `claims.links` inline array as the
// thing new code reads/writes (see ensureClaimEvidenceBackfill above for
// how existing `links` data was carried forward, once, into this store).
//
// This is NOT the evidence-requirement enforcement point - a Claim is
// allowed zero evidence (see the Claims section above). What IS enforced
// here, exactly like Phase 1/2's pattern: a link can only be created
// between a claim and an evidence item that both actually exist in this
// investigation, checked inside the same transaction as the write.
// Multiple positions on the same claim can coexist by design - e.g. two
// supporting rows and one contradicting row, all visible at once, never
// collapsed into a single verdict (Phase 3 brief §2/§10: "Chronium must
// preserve conflicting records").
// ---------------------------------------------------------------------------
async function assertClaimEvidenceReferencesExist(t, { investigationId, claimId, evidenceId }) {
  const claim = await reqToPromise(t.objectStore('claims').get(claimId));
  if (!claim || claim.investigationId !== investigationId) throw new ClaimEvidenceValidationError('Claim not found in this investigation.');
  const evidence = await reqToPromise(t.objectStore('evidenceItems').get(evidenceId));
  if (!evidence || evidence.investigationId !== investigationId) throw new ClaimEvidenceValidationError('Evidence item not found in this investigation.');
}

export async function createClaimEvidence(investigationId, fields) {
  const shaped = validateClaimEvidenceFields({ investigationId, ...fields });
  const db = await openDb();
  return tx(db, ['claims', 'evidenceItems', 'claimEvidence'], 'readwrite', async (t) => {
    await assertClaimEvidenceReferencesExist(t, shaped);
    const link = { id: genId('cev'), ...shaped, createdAt: new Date().toISOString() };
    await reqToPromise(t.objectStore('claimEvidence').add(link));
    return link;
  });
}

export async function listClaimEvidenceForClaim(investigationId, claimId) {
  const db = await openDb();
  const rows = await tx(db, ['claimEvidence'], 'readonly', (t) => reqToPromise(t.objectStore('claimEvidence').index('claimId').getAll(claimId)));
  return rows.filter((c) => c.investigationId === investigationId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// "USED IN CLAIMS" evidence-view integration (Phase 3 brief §7).
export async function listClaimEvidenceForEvidence(investigationId, evidenceId) {
  const db = await openDb();
  const rows = await tx(db, ['claimEvidence'], 'readonly', (t) => reqToPromise(t.objectStore('claimEvidence').index('evidenceId').getAll(evidenceId)));
  return rows.filter((c) => c.investigationId === investigationId).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// Removing a link never touches the claim or the evidence item, and
// never touches any Finding - a Finding cites its own independent
// evidenceIds (see below), not claimEvidence rows, so this is always
// safe to delete without a blocking check.
export async function deleteClaimEvidence(id) {
  const db = await openDb();
  await tx(db, ['claimEvidence'], 'readwrite', (t) => t.objectStore('claimEvidence').delete(id));
}

// ---------------------------------------------------------------------------
// Claim Findings (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 3): the
// investigator's current evidence-backed CONCLUSION about a claim. Named
// `claimFindings` (store and functions) rather than `findings`
// specifically to avoid any confusion with the pre-existing, unrelated
// quantitativeFindings/qualitativeFindings stores (docs/RESEARCH_METHOD.md
// mixed-methods workflow, tied to outline lanes, not claims).
//
// THE HARD RULE for this phase lives here, not on the Claim itself (see
// the Claims section above for why): createClaimFinding()/
// updateClaimFinding() are the only write path, and both run the same
// two-part check as every other hard rule in this app - shape
// (public/claims.js validateFindingFields, which throws
// FindingEvidenceRequiredError for a DOCUMENTED_FACT/SUPPORTED_INFERENCE/
// ALLEGATION with no evidenceIds) then existence (the claim and every
// cited evidence id are real, in this investigation, checked inside the
// same transaction as the write).
// ---------------------------------------------------------------------------
async function assertFindingReferencesExist(t, { investigationId, claimId, evidenceIds }) {
  const claim = await reqToPromise(t.objectStore('claims').get(claimId));
  if (!claim || claim.investigationId !== investigationId) throw new FindingValidationError('Claim not found in this investigation.');
  const evidenceStore = t.objectStore('evidenceItems');
  for (const evidenceId of evidenceIds) {
    const evidence = await reqToPromise(evidenceStore.get(evidenceId));
    if (!evidence || evidence.investigationId !== investigationId) {
      throw new FindingValidationError(`Evidence item "${evidenceId}" was not found in this investigation - a finding can only cite evidence that actually exists.`);
    }
  }
}

export async function createClaimFinding(investigationId, fields) {
  const shaped = validateFindingFields({ investigationId, ...fields });
  const db = await openDb();
  return tx(db, ['claims', 'evidenceItems', 'claimFindings'], 'readwrite', async (t) => {
    await assertFindingReferencesExist(t, shaped);
    const now = new Date().toISOString();
    const finding = { id: genId('finding'), ...shaped, createdAt: now, updatedAt: now };
    await reqToPromise(t.objectStore('claimFindings').add(finding));
    return finding;
  });
}

export async function updateClaimFinding(findingId, patch) {
  const db = await openDb();
  return tx(db, ['claims', 'evidenceItems', 'claimFindings'], 'readwrite', async (t) => {
    const store = t.objectStore('claimFindings');
    const existing = await reqToPromise(store.get(findingId));
    if (!existing) return null;
    // Re-validate the FULL merged result, exactly like updateRelationship/
    // updateEntityMention - an update that drops evidenceIds to [] while
    // keeping classification: DOCUMENTED_FACT must be rejected exactly
    // like a create would be, not silently accepted because it's "just
    // an edit."
    const merged = { ...existing, ...patch };
    const shaped = validateFindingFields({
      investigationId: merged.investigationId, claimId: merged.claimId, conclusion: merged.conclusion,
      classification: merged.classification, evidenceIds: merged.evidenceIds, notes: merged.notes, metadata: merged.metadata
    });
    await assertFindingReferencesExist(t, shaped);
    const updated = { ...existing, ...shaped, updatedAt: new Date().toISOString() };
    await reqToPromise(store.put(updated));
    return updated;
  });
}

export async function getClaimFinding(findingId) {
  const db = await openDb();
  return tx(db, ['claimFindings'], 'readonly', (t) => reqToPromise(t.objectStore('claimFindings').get(findingId)));
}

export async function listClaimFindings(investigationId) {
  const db = await openDb();
  const rows = await tx(db, ['claimFindings'], 'readonly', (t) => reqToPromise(t.objectStore('claimFindings').index('investigationId').getAll(investigationId)));
  return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function listClaimFindingsForClaim(investigationId, claimId) {
  const db = await openDb();
  const rows = await tx(db, ['claimFindings'], 'readonly', (t) => reqToPromise(t.objectStore('claimFindings').index('claimId').getAll(claimId)));
  return rows.filter((f) => f.investigationId === investigationId).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// "FINDINGS INVOLVING THIS SUBJECT" (Phase 3 brief §8) - findings don't
// carry their own subjectEntityIds; they inherit subjects through their
// claim, so this composes listClaimsForEntity + listClaimFindingsForClaim
// rather than duplicating subjectEntityIds onto every finding.
export async function listClaimFindingsForEntity(investigationId, entityId) {
  const claims = await listClaimsForEntity(investigationId, entityId);
  const findingLists = await Promise.all(claims.map((c) => listClaimFindingsForClaim(investigationId, c.id)));
  return findingLists.flat().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// No cascade concerns - nothing else references a finding by id.
export async function deleteClaimFinding(findingId) {
  const db = await openDb();
  await tx(db, ['claimFindings'], 'readwrite', (t) => t.objectStore('claimFindings').delete(findingId));
}

// ---------------------------------------------------------------------------
// Bulk Ingestion Review Queue (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase
// 4): turns "thousands of dumped-in documents" into a triage queue instead
// of a wall of unread text. `ingestionBatches` (above) IS the Job model -
// extended, not duplicated (see the file header). Everything below is the
// Item/Candidate/Watchlist/History/Investigator layer on top of it.
//
// THE HARD RULE this phase protects: automation may only ever SURFACE a
// possibility. scanRecordForReview() below calls the pure detectors in
// ingestionReview.js and persists their output as-is - it NEVER calls
// createEntityMention()/createRelationship()/createClaim() itself. Those
// only happen from confirmReviewCandidate(), which is always triggered by
// an explicit investigator action, and even then goes through the SAME
// existing, validated Phase 1-3 APIs (createEvidenceItem then
// createEntityMention) - never a shortcut around them.
// ---------------------------------------------------------------------------

// recordId is nullable - a FAILED item (extraction/hashing threw before a
// record could be created) legitimately has no record yet. That IS what
// "failed to ingest" means; requiring one would make failures unrepresentable.
export async function createIngestionItem(investigationId, { jobId, recordId, sourceFilename, sourceUrl, documentDate, mimeType, status, error, metadata }) {
  if (!investigationId || !jobId) throw new IngestionValidationError('An ingestion item requires an investigation and a job.');
  const db = await openDb();
  const now = new Date().toISOString();
  const item = {
    id: genId('item'), investigationId, jobId, recordId: recordId || null,
    sourceFilename: sourceFilename || null, sourceUrl: sourceUrl || null, documentDate: documentDate || null,
    mimeType: mimeType || null, status: ITEM_STATUSES.includes(status) ? status : 'PENDING',
    error: error || null, flagged: false, reviewNotes: '', reviewedAt: null, reviewedBy: null,
    metadata: metadata || {}, createdAt: now, updatedAt: now
  };
  await tx(db, ['ingestionItems'], 'readwrite', (t) => t.objectStore('ingestionItems').add(item));
  return item;
}

export async function updateIngestionItem(itemId, patch) {
  const db = await openDb();
  return tx(db, ['ingestionItems'], 'readwrite', async (t) => {
    const store = t.objectStore('ingestionItems');
    const existing = await reqToPromise(store.get(itemId));
    if (!existing) return null;
    if (patch.status !== undefined && !ITEM_STATUSES.includes(patch.status)) {
      throw new IngestionValidationError(`Unknown ingestion item status "${patch.status}". Must be one of: ${ITEM_STATUSES.join(', ')}.`);
    }
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await reqToPromise(store.put(updated));
    return updated;
  });
}

export async function getIngestionItem(itemId) {
  const db = await openDb();
  return tx(db, ['ingestionItems'], 'readonly', (t) => reqToPromise(t.objectStore('ingestionItems').get(itemId)));
}

// Paginated by design (Phase 4 brief §17 - the queue must not freeze at
// scale): callers pass a cursor key (an ingestionItem id) to continue from,
// not an offset, so paging stays cheap regardless of how deep into a
// 1,000+ item queue the investigator has gone. `statusFilter` narrows via
// the byInvestigationAndStatus compound index when given, otherwise scans
// the plain investigationId index.
export async function listIngestionItemsPage(investigationId, { statusFilter, limit = 50, afterId } = {}) {
  const db = await openDb();
  return tx(db, ['ingestionItems'], 'readonly', async (t) => {
    const store = t.objectStore('ingestionItems');
    const index = statusFilter ? store.index('byInvestigationAndStatus') : store.index('investigationId');
    const range = statusFilter ? IDBKeyRange.only([investigationId, statusFilter]) : IDBKeyRange.only(investigationId);
    const rows = [];
    let skipping = !!afterId;
    await new Promise((resolve, reject) => {
      // 'prev': for a fixed-value range on a non-unique index, the cursor
      // walks in DESCENDING primary-key order - since genId() embeds a
      // Date.now() prefix, that's newest-first, matching the order the
      // queue actually displays. Walking and displaying in the SAME order
      // is what makes `afterId` a valid continuation cursor across pages;
      // sorting the page after the fact (as an earlier version of this
      // function did) would silently break that continuity.
      const cursorReq = index.openCursor(range, 'prev');
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || rows.length >= limit) { resolve(); return; }
        if (skipping) {
          if (cursor.value.id === afterId) skipping = false;
          cursor.continue();
          return;
        }
        rows.push(cursor.value);
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    return rows;
  });
}

export async function countIngestionItemsByStatus(investigationId) {
  const db = await openDb();
  const rows = await tx(db, ['ingestionItems'], 'readonly', (t) => reqToPromise(t.objectStore('ingestionItems').index('investigationId').getAll(investigationId)));
  const counts = {};
  for (const s of ITEM_STATUSES) counts[s] = 0;
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  counts.TOTAL = rows.length;
  counts.FLAGGED = rows.filter((r) => r.flagged).length;
  return counts;
}

// Search-in-queue (Phase 4 brief §14: "search should return queue items,
// not just global evidence results"). Deliberately NOT the same code path
// as listIngestionItemsPage() above: that one only ever looks at whatever
// page the investigator has already scrolled into, which is correct for
// normal browsing but would make a search silently miss anything not yet
// paged in - a real correctness gap at scale, not just a performance one,
// found via this phase's own 1,000-record scale test. This one walks the
// FULL (optionally status-filtered) set via a cursor, matching against
// sourceFilename and the linked record's title/snippet/extractedText,
// stopping once `limit` matches are found or the store is exhausted -
// bounded, but a real search over everything, not just what's on screen.
export async function searchIngestionItems(investigationId, query, { statusFilter, limit = 100 } = {}) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const db = await openDb();
  return tx(db, ['ingestionItems', 'records'], 'readonly', async (t) => {
    const itemStore = t.objectStore('ingestionItems');
    const index = statusFilter ? itemStore.index('byInvestigationAndStatus') : itemStore.index('investigationId');
    const range = statusFilter ? IDBKeyRange.only([investigationId, statusFilter]) : IDBKeyRange.only(investigationId);
    const recordsStore = t.objectStore('records');
    const matches = [];
    await new Promise((resolve, reject) => {
      const cursorReq = index.openCursor(range, 'prev');
      cursorReq.onsuccess = async () => {
        const cursor = cursorReq.result;
        if (!cursor || matches.length >= limit) { resolve(); return; }
        const item = cursor.value;
        const record = item.recordId ? await reqToPromise(recordsStore.get(item.recordId)) : null;
        const haystack = `${item.sourceFilename || ''} ${record?.title || ''} ${record?.snippet || ''} ${record?.extractedText || ''}`.toLowerCase();
        if (haystack.includes(q)) matches.push(item);
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    return matches;
  });
}

export async function listIngestionItemsForJob(jobId) {
  const db = await openDb();
  const rows = await tx(db, ['ingestionItems'], 'readonly', (t) => reqToPromise(t.objectStore('ingestionItems').index('jobId').getAll(jobId)));
  return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// Runs the pure detectors (ingestionReview.js) over one record's extracted
// text against the investigation's already-registered entities and
// watchlist terms, and persists the results as reviewCandidates/
// watchlistMatches rows - UNREVIEWED or AMBIGUOUS, never CONFIRMED. This
// is the ENTIRE extent of what automation does in this phase; see the
// section header above.
export async function scanRecordForReview(investigationId, { recordId, text }) {
  const db = await openDb();
  const [entities, aliasRows, watchlistTerms] = await Promise.all([
    listEntities(investigationId),
    tx(db, ['entityAliases'], 'readonly', (t) => reqToPromise(t.objectStore('entityAliases').index('investigationId').getAll(investigationId))),
    listWatchlists(investigationId)
  ]);
  const aliasesByEntity = new Map();
  for (const a of aliasRows) {
    if (!aliasesByEntity.has(a.entityId)) aliasesByEntity.set(a.entityId, []);
    aliasesByEntity.get(a.entityId).push(a.alias);
  }
  const entitiesWithAliases = entities.map((e) => ({ id: e.id, type: e.type, name: e.name, aliases: aliasesByEntity.get(e.id) || [] }));

  const candidates = findSubjectCandidates(text, entitiesWithAliases);
  const watchlistMatchesFound = findWatchlistMatches(text, watchlistTerms);

  const now = new Date().toISOString();
  await tx(db, ['reviewCandidates', 'watchlistMatches'], 'readwrite', async (t) => {
    for (const c of candidates) {
      await reqToPromise(t.objectStore('reviewCandidates').add({
        id: genId('cand'), investigationId, recordId, matchedText: c.matchedText, offset: c.offset, snippet: c.snippet,
        candidateEntityIds: c.candidateEntityIds, matchStrength: c.matchStrength,
        state: c.initialState, confirmedEntityId: null, confirmedEvidenceId: null, reviewedAt: null, reviewedBy: null,
        createdAt: now, updatedAt: now
      }));
    }
    for (const m of watchlistMatchesFound) {
      await reqToPromise(t.objectStore('watchlistMatches').add({
        id: genId('wmatch'), investigationId, watchlistId: m.watchlistId,
        recordId, matchedText: m.matchedText, offset: m.offset, snippet: m.snippet,
        state: 'UNREVIEWED', reviewedAt: null, reviewedBy: null, createdAt: now, updatedAt: now
      }));
    }
  });
  return { candidateCount: candidates.length, watchlistMatchCount: watchlistMatchesFound.length };
}

export async function listReviewCandidatesForRecord(investigationId, recordId) {
  const db = await openDb();
  const rows = await tx(db, ['reviewCandidates'], 'readonly', (t) => reqToPromise(t.objectStore('reviewCandidates').index('recordId').getAll(recordId)));
  return rows.filter((r) => r.investigationId === investigationId).sort((a, b) => a.offset - b.offset);
}

export async function listWatchlistMatchesForRecord(investigationId, recordId) {
  const db = await openDb();
  const rows = await tx(db, ['watchlistMatches'], 'readonly', (t) => reqToPromise(t.objectStore('watchlistMatches').index('recordId').getAll(recordId)));
  return rows.filter((r) => r.investigationId === investigationId).sort((a, b) => a.offset - b.offset);
}

// The ONLY place a review candidate turns into a real entityMention - and
// even here, only because the investigator explicitly picked ONE entity
// id out of the candidate's (possibly multi-entity) list. Goes through
// the exact same createEvidenceItem()/createEntityMention() APIs a human
// would use from the Evidence tab - "the review queue must use the
// existing APIs, not bypass them" (Phase 4 brief §4). A quote-worthy
// excerpt (the candidate's own snippet) becomes a real, citable Evidence
// Item first, since a Mention must point at one (Phase 2's rule, still
// enforced by createEntityMention itself regardless of this call site).
export async function confirmReviewCandidate(investigationId, candidateId, { entityId, reviewedBy } = {}) {
  const db = await openDb();
  const candidate = await tx(db, ['reviewCandidates'], 'readonly', (t) => reqToPromise(t.objectStore('reviewCandidates').get(candidateId)));
  if (!candidate || candidate.investigationId !== investigationId) throw new ReviewCandidateValidationError('Review candidate not found in this investigation.');
  if (!candidate.candidateEntityIds.includes(entityId)) {
    throw new ReviewCandidateValidationError('The chosen entity is not one of this candidate\'s possibilities - Chronium never lets a confirmation silently pick something the detector did not actually surface.');
  }

  const evidence = await createEvidenceItem(investigationId, {
    sourceRecordId: candidate.recordId, excerptType: 'quote', excerptText: candidate.snippet,
    location: '', notes: 'Created from a confirmed review-queue candidate.'
  });
  const mention = await createEntityMention(investigationId, {
    entityId, evidenceId: evidence.id, quotedName: candidate.matchedText, snippet: candidate.snippet
  });

  const updated = await tx(db, ['reviewCandidates'], 'readwrite', async (t) => {
    const store = t.objectStore('reviewCandidates');
    const now = new Date().toISOString();
    // confirmedEvidenceId is what lets a caller later offer "link this
    // evidence to a claim" for a confirmed candidate - without it, the
    // real Evidence Item created above would be undiscoverable from the
    // candidate row itself.
    const row = { ...candidate, state: 'CONFIRMED', confirmedEntityId: entityId, confirmedEvidenceId: evidence.id, reviewedAt: now, reviewedBy: reviewedBy || null, updatedAt: now };
    await reqToPromise(store.put(row));
    return row;
  });
  await recordReviewHistory(investigationId, { action: 'candidate_confirmed', actor: reviewedBy || null, objectType: 'reviewCandidate', objectId: candidateId, newValue: entityId });
  return { candidate: updated, evidence, mention };
}

export async function rejectReviewCandidate(investigationId, candidateId, { reviewedBy } = {}) {
  const db = await openDb();
  return tx(db, ['reviewCandidates'], 'readwrite', async (t) => {
    const store = t.objectStore('reviewCandidates');
    const existing = await reqToPromise(store.get(candidateId));
    if (!existing || existing.investigationId !== investigationId) return null;
    const now = new Date().toISOString();
    const updated = { ...existing, state: 'REJECTED', reviewedAt: now, reviewedBy: reviewedBy || null, updatedAt: now };
    await reqToPromise(store.put(updated));
    return updated;
  }).then(async (updated) => {
    if (updated) await recordReviewHistory(investigationId, { action: 'candidate_rejected', actor: reviewedBy || null, objectType: 'reviewCandidate', objectId: candidateId });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Watchlists
// ---------------------------------------------------------------------------
export async function createWatchlist(investigationId, fields) {
  const shaped = validateWatchlistFields({ investigationId, ...fields });
  const db = await openDb();
  const now = new Date().toISOString();
  const entry = { id: genId('watch'), ...shaped, createdAt: now, updatedAt: now };
  await tx(db, ['watchlists'], 'readwrite', (t) => t.objectStore('watchlists').add(entry));
  return entry;
}

export async function listWatchlists(investigationId) {
  const db = await openDb();
  const rows = await tx(db, ['watchlists'], 'readonly', (t) => reqToPromise(t.objectStore('watchlists').index('investigationId').getAll(investigationId)));
  return rows.sort((a, b) => String(a.term).localeCompare(String(b.term)));
}

export async function deleteWatchlist(watchlistId) {
  const db = await openDb();
  await tx(db, ['watchlists'], 'readwrite', (t) => t.objectStore('watchlists').delete(watchlistId));
}

export async function confirmWatchlistMatch(investigationId, matchId, { reviewedBy } = {}) {
  return updateWatchlistMatchState(investigationId, matchId, 'CONFIRMED', reviewedBy);
}
export async function dismissWatchlistMatch(investigationId, matchId, { reviewedBy } = {}) {
  return updateWatchlistMatchState(investigationId, matchId, 'REJECTED', reviewedBy);
}
async function updateWatchlistMatchState(investigationId, matchId, state, reviewedBy) {
  const db = await openDb();
  const updated = await tx(db, ['watchlistMatches'], 'readwrite', async (t) => {
    const store = t.objectStore('watchlistMatches');
    const existing = await reqToPromise(store.get(matchId));
    if (!existing || existing.investigationId !== investigationId) return null;
    const now = new Date().toISOString();
    const row = { ...existing, state, reviewedAt: now, reviewedBy: reviewedBy || null, updatedAt: now };
    await reqToPromise(store.put(row));
    return row;
  });
  if (updated) await recordReviewHistory(investigationId, { action: state === 'CONFIRMED' ? 'watchlist_match_confirmed' : 'watchlist_match_rejected', actor: reviewedBy || null, objectType: 'watchlistMatch', objectId: matchId });
  return updated;
}

// ---------------------------------------------------------------------------
// Review History - the simplest reliable audit-log model (Phase 4 brief
// §11: "do not build a complicated event-sourcing system"). One row per
// meaningful action; write-only from the app's perspective, read by
// listReviewHistory for an activity feed if/when that's wanted.
// ---------------------------------------------------------------------------
export async function recordReviewHistory(investigationId, { action, actor, objectType, objectId, previousValue, newValue }) {
  const db = await openDb();
  const entry = {
    id: genId('rhist'), investigationId, action, actor: actor || null, objectType, objectId,
    previousValue: previousValue ?? null, newValue: newValue ?? null, timestamp: new Date().toISOString()
  };
  await tx(db, ['reviewHistory'], 'readwrite', (t) => t.objectStore('reviewHistory').add(entry));
  return entry;
}

export async function listReviewHistory(investigationId, { limit = 100 } = {}) {
  const db = await openDb();
  const rows = await tx(db, ['reviewHistory'], 'readonly', (t) => reqToPromise(t.objectStore('reviewHistory').index('investigationId').getAll(investigationId)));
  return rows.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Investigators - a lightweight identity a reviewer can attribute their
// own actions to. Explicitly NOT authentication (Phase 4 brief §10): no
// password, no session, no server round-trip, nothing stopping anyone from
// picking any name. `chronium.activeInvestigator` in localStorage (see
// public/app.js) remembers the current browser's choice, mirroring the
// existing `chronium.activeInvestigation` convention.
// ---------------------------------------------------------------------------
export async function createInvestigator({ displayName }) {
  const clean = normalizeName(displayName);
  if (!clean) throw new IngestionValidationError('An investigator profile requires a display name.');
  const db = await openDb();
  const investigator = { id: genId('investigator'), displayName: clean, createdAt: new Date().toISOString() };
  await tx(db, ['investigators'], 'readwrite', (t) => t.objectStore('investigators').add(investigator));
  return investigator;
}

export async function listInvestigators() {
  const db = await openDb();
  const rows = await tx(db, ['investigators'], 'readonly', (t) => reqToPromise(t.objectStore('investigators').getAll()));
  return rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ---------------------------------------------------------------------------
// Deep Discovery runs and ledger (Phase 1). A run row holds what is needed to
// show the coverage report again and to continue a stopped run (the
// checkpoint); the ledger rows are the addresses requested or skipped. Neither
// holds page text, document text or search queries.
// ---------------------------------------------------------------------------
export async function saveDiscoveryRun(investigationId, run) {
  const db = await openDb();
  const row = { ...run, id: run.id, investigationId, savedAt: new Date().toISOString() };
  await tx(db, ['discoveryRuns'], 'readwrite', (t) => t.objectStore('discoveryRuns').put(row));
  return row;
}
export async function listDiscoveryRuns(investigationId) {
  const db = await openDb();
  const rows = await tx(db, ['discoveryRuns'], 'readonly', (t) => reqToPromise(t.objectStore('discoveryRuns').index('investigationId').getAll(investigationId)));
  return rows.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}
export async function getDiscoveryRun(runId) {
  const db = await openDb();
  return tx(db, ['discoveryRuns'], 'readonly', (t) => reqToPromise(t.objectStore('discoveryRuns').get(runId)));
}
export async function saveDiscoveryLedger(investigationId, runId, entries) {
  const db = await openDb();
  await tx(db, ['discoveryLedger'], 'readwrite', (t) => {
    const store = t.objectStore('discoveryLedger');
    for (const e of entries) store.put({ ...e, id: runId + ':' + e.seq, investigationId, runId });
  });
}
export async function listDiscoveryLedger(investigationId, runId) {
  const db = await openDb();
  const rows = await tx(db, ['discoveryLedger'], 'readonly', (t) => reqToPromise(t.objectStore('discoveryLedger').index('runId').getAll(runId)));
  return rows.filter((r) => r.investigationId === investigationId).sort((a, b) => a.seq - b.seq);
}
