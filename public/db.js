// Local-first investigation workspace storage. IndexedDB, no dependencies.
// Stores: investigations, records (deduped evidence/sources), investigationRecords
// (join), blobs (original evidence bytes, deduped by content hash),
// ingestionBatches (one row per bulk import), meta (small counters),
// outlines (one per investigation: research question + coverage lanes),
// evidenceItems (excerpts pulled from a source), claims (assertions an
// Evidence Item supports/contradicts) - the Source -> Evidence Item -> Claim
// model from docs/RESEARCH_METHOD.md - and qualitativeAnalysis (the last
// AI-assisted analysis result per investigation, so revisiting the tab
// doesn't require re-running a paid AI call).

const DB_NAME = 'chronium';
const DB_VERSION = 4;
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

export async function searchInvestigation(investigationId, query, limit = 50) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = await listInvestigationRecords(investigationId);
  if (!terms.length) return rows.slice(0, limit);
  const matches = rows.filter((r) => {
    const haystack = `${r.title || ''} ${r.description || r.snippet || ''} ${r.category || ''} ${r.originalUrl || ''} ${r.extractedText || ''}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
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
// record (Publisher, Source Type, Reliability, Research Notes - the
// judgment-call fields from docs/RESEARCH_METHOD.md's Target Source Record
// Shape). No new store: these are just additional fields on `records`,
// written through the existing updateRecord().
// ---------------------------------------------------------------------------
export async function updateBibliographyDetails(recordId, { publisher, sourceType, reliability, researchNotes }) {
  return updateRecord(recordId, {
    biblio: { publisher: publisher || '', sourceType: sourceType || '', reliability: reliability || '', researchNotes: researchNotes || '' }
  });
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

export async function addOutlineLane(investigationId, { label, coveragePct }) {
  const db = await openDb();
  return tx(db, ['outlines'], 'readwrite', async (t) => {
    const store = t.objectStore('outlines');
    const existing = await reqToPromise(store.get(investigationId)) || { investigationId, researchQuestion: '', method: 'mixed', lanes: [] };
    const lane = { id: genId('lane'), label: label.trim(), coveragePct: coveragePct == null ? null : clampPct(coveragePct), notes: '' };
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

export async function deleteEvidenceItem(evidenceItemId) {
  const db = await openDb();
  await tx(db, ['evidenceItems'], 'readwrite', (t) => t.objectStore('evidenceItems').delete(evidenceItemId));
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
