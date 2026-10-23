// IndexedDB side of portable investigation files (.chronium.json) - see
// portable.js for the pure parts (format tag, validation, filename) and
// docs/ROADMAP.md "Case portability". Reads one investigation out as a plain
// object, and merges one back in. Merging NEVER overwrites: a row whose id
// already exists locally is kept as-is (counted as identical or as a
// conflict), so importing the same file twice is a no-op.
import { openDb, tx, reqToPromise } from './db.js';

// Stores whose rows each carry an `investigationId` and a string `id`.
export const PORTABLE_ID_STORES = [
  'ingestionBatches', 'evidenceItems', 'claims', 'quantitativeFindings', 'qualitativeFindings',
  'crossValidations', 'askSourcesHistory', 'entities', 'relationships', 'entityAliases', 'entityMentions',
  'claimEvidence', 'claimFindings', 'claimHistory', 'ingestionItems', 'reviewCandidates', 'watchlists',
  'watchlistMatches', 'reviewHistory', 'discoveryRuns', 'discoveryLedger', 'recoveryReviews', 'recoveryRequests'
];
// Stores keyed by investigationId itself (one row per investigation).
export const PORTABLE_SINGLETON_STORES = ['outlines', 'qualitativeAnalysis', 'recoverySettings'];
// Fields holding a global `records` id that must follow a record remap.
const RECORD_REF_FIELDS = { evidenceItems: 'sourceRecordId', ingestionItems: 'recordId', reviewCandidates: 'recordId', watchlistMatches: 'recordId' };

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function base64ToBlob(b64, mimeType) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}
function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function counterOf(id, prefix) {
  const s = String(id || '');
  if (!s.startsWith(prefix)) return 0;
  const n = Number(s.slice(prefix.length));
  return Number.isInteger(n) ? n : 0;
}

// Returns a plain-JSON-safe object for one investigation. Only the
// whitelisted stores above are read, so nothing outside the case (settings,
// keys, other cases) can leak into an export. includeFiles also embeds the
// stored original-file bytes (base64) for records kept as a local copy.
export async function readInvestigationForExport(investigationId, { includeFiles = false } = {}) {
  const db = await openDb();
  const stores = ['investigations', 'records', 'investigationRecords', 'blobs', ...PORTABLE_ID_STORES, ...PORTABLE_SINGLETON_STORES];
  const raw = await tx(db, stores, 'readonly', async (t) => {
    const investigation = await reqToPromise(t.objectStore('investigations').get(investigationId));
    if (!investigation) return null;
    const links = await reqToPromise(t.objectStore('investigationRecords').index('investigationId').getAll(investigationId));
    const records = [];
    for (const l of links) {
      const r = await reqToPromise(t.objectStore('records').get(l.recordId));
      if (r) records.push(r);
    }
    const out = {
      investigation, records,
      investigationRecords: links.map(({ recordId, addedAt, note }) => ({ recordId, addedAt, note })),
      blobs: []
    };
    for (const name of PORTABLE_ID_STORES) out[name] = await reqToPromise(t.objectStore(name).index('investigationId').getAll(investigationId));
    for (const name of PORTABLE_SINGLETON_STORES) {
      const row = await reqToPromise(t.objectStore(name).get(investigationId));
      out[name] = row ? [row] : [];
    }
    if (includeFiles) {
      for (const r of records) {
        if (!r.fileHash || out.blobs.some((b) => b.hash === r.fileHash)) continue;
        const b = await reqToPromise(t.objectStore('blobs').get(r.fileHash));
        if (b) out.blobs.push(b);
      }
    }
    return out;
  });
  if (!raw) return null;
  raw.blobs = await Promise.all(raw.blobs.map(async (b) => ({
    hash: b.hash, mimeType: b.mimeType, size: b.size, firstSeenAt: b.firstSeenAt, dataBase64: await blobToBase64(b.blob)
  })));
  return raw;
}

// Merges a validated bundle's `data` (see portable.js) into this database.
// dryRun computes the identical report without writing - that is the import
// preview. Never overwrites an existing row.
export async function mergeInvestigationData(d, { dryRun = false } = {}) {
  const db = await openDb();
  const inv = d.investigation;
  const stores = ['investigations', 'records', 'investigationRecords', 'blobs', 'meta', ...PORTABLE_ID_STORES, ...PORTABLE_SINGLETON_STORES];
  return tx(db, stores, dryRun ? 'readonly' : 'readwrite', async (t) => {
    const report = {
      investigationName: inv.name, investigationExisted: false,
      added: {}, identical: {}, conflicts: {}, sourceIdsReassigned: 0, claimIdsReassigned: 0
    };
    const bump = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };

    const existingInv = await reqToPromise(t.objectStore('investigations').get(inv.id));
    if (existingInv) {
      report.investigationExisted = true;
      if (sameJson(existingInv, inv)) bump(report.identical, 'investigations'); else bump(report.conflicts, 'investigations');
    } else {
      bump(report.added, 'investigations');
      if (!dryRun) await reqToPromise(t.objectStore('investigations').add(inv));
    }

    // Records are global and deduped by canonicalKey: a record already known
    // locally under another id is reused, and every reference follows it.
    const recStore = t.objectStore('records');
    const allLocal = await reqToPromise(recStore.getAll());
    const usedSourceIds = new Set(allLocal.map((r) => r.sourceId).filter(Boolean));
    const remap = new Map();
    let maxSource = 0;
    for (const rec of d.records) {
      const byKey = rec.canonicalKey ? await reqToPromise(recStore.index('canonicalKey').get(rec.canonicalKey)) : null;
      const byId = await reqToPromise(recStore.get(rec.id));
      if (byKey) { remap.set(rec.id, byKey.id); bump(report.identical, 'records'); continue; }
      if (byId) { remap.set(rec.id, rec.id); bump(report.conflicts, 'records'); continue; }
      let row = rec;
      if (rec.sourceId && usedSourceIds.has(rec.sourceId)) {
        // Another local source already uses this display number; keep the
        // original as importedFromSourceId and issue a fresh one.
        row = { ...rec, importedFromSourceId: rec.sourceId, sourceId: null };
        report.sourceIdsReassigned++;
        if (!dryRun) {
          const meta = t.objectStore('meta');
          const c = await reqToPromise(meta.get('sourceIdCounter'));
          const next = Math.max(c?.value || 0, maxSource) + 1;
          maxSource = next;
          await reqToPromise(meta.put({ key: 'sourceIdCounter', value: next }));
          row.sourceId = `CHR-${String(next).padStart(6, '0')}`;
        }
      }
      if (row.sourceId) { usedSourceIds.add(row.sourceId); maxSource = Math.max(maxSource, counterOf(row.sourceId, 'CHR-')); }
      remap.set(rec.id, rec.id);
      bump(report.added, 'records');
      if (!dryRun) await reqToPromise(recStore.add(row));
    }

    const linkStore = t.objectStore('investigationRecords');
    for (const l of d.investigationRecords) {
      const recordId = remap.get(l.recordId) || l.recordId;
      const have = await reqToPromise(linkStore.index('byPair').get([inv.id, recordId]));
      if (have) { bump(report.identical, 'investigationRecords'); continue; }
      bump(report.added, 'investigationRecords');
      if (!dryRun) await reqToPromise(linkStore.add({ investigationId: inv.id, recordId, addedAt: l.addedAt, note: l.note || '' }));
    }

    const claimsLocal = await reqToPromise(t.objectStore('claims').getAll());
    const usedClaimIds = new Set(claimsLocal.map((c) => c.claimId).filter(Boolean));
    let maxClaim = 0;
    for (const name of PORTABLE_ID_STORES) {
      const store = t.objectStore(name);
      for (const row of d[name] || []) {
        let next = row;
        const field = RECORD_REF_FIELDS[name];
        if (field && row[field] && remap.has(row[field])) next = { ...row, [field]: remap.get(row[field]) };
        const have = await reqToPromise(store.get(next.id));
        if (have) { if (sameJson(have, next)) bump(report.identical, name); else bump(report.conflicts, name); continue; }
        if (name === 'claims' && next.claimId) {
          if (usedClaimIds.has(next.claimId)) {
            next = { ...next, importedFromClaimId: next.claimId };
            report.claimIdsReassigned++;
            if (!dryRun) {
              const meta = t.objectStore('meta');
              const c = await reqToPromise(meta.get('claimIdCounter'));
              const n = Math.max(c?.value || 0, maxClaim) + 1;
              maxClaim = n;
              await reqToPromise(meta.put({ key: 'claimIdCounter', value: n }));
              next.claimId = `CHR-CLAIM-${String(n).padStart(3, '0')}`;
            }
          }
          usedClaimIds.add(next.claimId);
          maxClaim = Math.max(maxClaim, counterOf(next.claimId, 'CHR-CLAIM-'));
        }
        bump(report.added, name);
        if (!dryRun) await reqToPromise(store.add(next));
      }
    }
    for (const name of PORTABLE_SINGLETON_STORES) {
      const store = t.objectStore(name);
      for (const row of d[name] || []) {
        const have = await reqToPromise(store.get(row.investigationId));
        if (have) { if (sameJson(have, row)) bump(report.identical, name); else bump(report.conflicts, name); continue; }
        bump(report.added, name);
        if (!dryRun) await reqToPromise(store.add(row));
      }
    }
    const blobStore = t.objectStore('blobs');
    for (const b of d.blobs || []) {
      if (await reqToPromise(blobStore.get(b.hash))) { bump(report.identical, 'blobs'); continue; }
      bump(report.added, 'blobs');
      if (!dryRun) await reqToPromise(blobStore.add({
        hash: b.hash, blob: base64ToBlob(b.dataBase64, b.mimeType), mimeType: b.mimeType, size: b.size, firstSeenAt: b.firstSeenAt
      }));
    }
    if (!dryRun) {
      // Keep future locally-issued ids ahead of any imported ones.
      const meta = t.objectStore('meta');
      for (const [key, max] of [['sourceIdCounter', maxSource], ['claimIdCounter', maxClaim]]) {
        const c = await reqToPromise(meta.get(key));
        if ((c?.value || 0) < max) await reqToPromise(meta.put({ key, value: max }));
      }
    }
    return report;
  });
}
