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
// Mentions" section below).

import {
  validateEntityFields, validateRelationshipFields, validateEntityMentionFields,
  normalizeName, normalizeForSearch, RelationshipValidationError, MentionValidationError
} from './entities.js';

const DB_NAME = 'chronium';
const DB_VERSION = 8;
let dbPromise = null;

function openDb() {
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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, stores, mode, work) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(work(t)).then((r) => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

function reqToPromise(req) {
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
  await tx(db, ['investigations', 'investigationRecords'], 'readwrite', async (t) => {
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
  const matches = [];
  for (const r of rows) {
    const extractedText = r.extractedText || '';
    const haystack = `${r.title || ''} ${r.description || r.snippet || ''} ${r.category || ''} ${r.originalUrl || ''} ${extractedText}`.toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) continue;

    // Find the first search term that actually hits inside the document body
    // (not just the title/category) so the passage points at real content.
    const textLower = extractedText.toLowerCase();
    let matchOffset = -1, matchTerm = null;
    for (const term of terms) {
      const idx = textLower.indexOf(term);
      if (idx >= 0) { matchOffset = idx; matchTerm = term; break; }
    }

    if (matchOffset < 0) { matches.push(r); continue; } // matched only title/category/url - no in-document passage to show
    const { raw, display } = buildPassage(extractedText, matchOffset, matchTerm.length);
    matches.push({
      ...r,
      matchPassage: display,
      matchPassageRaw: raw,
      matchOffset,
      matchTerm,
      matchPage: pageForOffset(r.metadata?.pageOffsets, matchOffset)
    });
  }
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

export async function createIngestionBatch({ investigationId, label }) {
  const db = await openDb();
  const batch = {
    id: genId('batch'), investigationId, label, createdAt: new Date().toISOString(),
    completedAt: null, fileCount: 0, byteTotal: 0, skipped: [], errors: [], duplicates: []
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

// Cascade-deletes entityMentions pointing at this evidence item (Phase 2
// addition) for the same "no orphan mentions" reason as deleteEntity()
// above - a mention with no evidence behind it is meaningless, worse than
// a Claim/Relationship left pointing at a removed reference (which stay,
// rendered as "removed," because THEY are the factual record). Deleting a
// mention never deletes evidence or an entity - see deleteEntityMention().
export async function deleteEvidenceItem(evidenceItemId) {
  const db = await openDb();
  await tx(db, ['evidenceItems', 'entityMentions'], 'readwrite', async (t) => {
    t.objectStore('evidenceItems').delete(evidenceItemId);
    const mentionIdx = t.objectStore('entityMentions').index('evidenceId');
    const mentions = await reqToPromise(mentionIdx.getAll(evidenceItemId));
    for (const m of mentions) t.objectStore('entityMentions').delete(m.id);
  });
}

// ---------------------------------------------------------------------------
// Claims: a specific factual assertion an Evidence Item supports or
// contradicts - what findings and reports actually reason over. Carries a
// human-readable CHR-CLAIM-NNN id (parallel to Source's CHR-NNNNNN) so a
// claim can be cited independent of any one investigation.
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

export async function createClaim(investigationId, { text, links }) {
  const db = await openDb();
  const claimId = await getNextClaimId();
  const claim = {
    id: genId('claim'), claimId, investigationId, text: text.trim(),
    links: (links || []).map((l) => ({ evidenceItemId: l.evidenceItemId, stance: l.stance === 'contradicts' ? 'contradicts' : 'supports' })),
    createdAt: new Date().toISOString()
  };
  await tx(db, ['claims'], 'readwrite', (t) => t.objectStore('claims').add(claim));
  return claim;
}

export async function deleteClaim(claimId) {
  const db = await openDb();
  await tx(db, ['claims'], 'readwrite', (t) => t.objectStore('claims').delete(claimId));
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
// Claim updates - so far only used for excludedFromReport (a Claim can be
// kept, with its Evidence intact, while being left out of the generated
// Report - "remove this from the report but keep it as evidence"). Additive
// optional field: an existing claim with no excludedFromReport key is
// treated as included (see renderReportPanel, public/app.js).
// ---------------------------------------------------------------------------
export async function updateClaim(claimId, patch) {
  const db = await openDb();
  return tx(db, ['claims'], 'readwrite', async (t) => {
    const store = t.objectStore('claims');
    const existing = await reqToPromise(store.get(claimId));
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    await reqToPromise(store.put(updated));
    return updated;
  });
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
