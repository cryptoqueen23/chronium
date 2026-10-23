// Deep Discovery: saving what a run found into the existing investigation
// workspace, and recording the run itself.
//
// Rules:
//  - No duplicate records. A retrieved document's canonicalKey is its SHA-256 (the same key bulk import uses), so
//    the same file found twice, at two addresses, or already imported by hand, is one record; the other address
//    is kept on it as `discovery.alsoFoundAt`. A document that was not retrieved but has an archived copy is keyed
//    by its original address. Saving the same run twice changes nothing.
//  - Provenance is never dropped: original address, final address, archive address, capture/retrieval time,
//    hash, HTTP details, the page it was linked from, and the engine version are stored on the record.
//  - Original files are NOT copied by default (Storage Modes: local only). Text and fingerprint are kept;
//    preserveOriginals is an explicit opt-in.
//  - Discovered documents are ordinary sources (`sourceType: 'bulk-document'`), so the Big Picture, Overview,
//    Deep Dive, Ask Chronium and exports see them with no special cases.
import {
  saveRecordToInvestigation, getRecordByCanonicalKey, getNextSourceId, updateRecord, saveBlob,
  createIngestionBatch, updateIngestionBatch, createIngestionItem, scanRecordForReview,
  saveDiscoveryRun, saveDiscoveryLedger
} from '../db.js';

const MIME_BY_EXT = {
  pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', rtf: 'application/rtf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

function fileNameOf(url, fallback = 'document') {
  try { const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || ''); return last || fallback; } catch { return fallback; }
}

// A small extractor for plain text types, for places that cannot load the full ingestion adapters
// (the extension side panel). Anything else is saved with metadata and fingerprint, and says so.
export async function plainTextExtract(filename, mimeType, bytes) {
  if (/\.(txt|csv)$/i.test(filename) || /^text\/(plain|csv)/.test(mimeType)) {
    return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes), metadata: {}, note: null };
  }
  return { text: null, metadata: {}, note: 'Text was not extracted here. The file is recorded with its address and fingerprint.' };
}

export function provenanceOf(result, extra = {}) {
  return {
    runId: result.runId || extra.runId || null, originalUrl: result.originalUrl || result.url, finalUrl: result.finalUrl || result.url,
    parentUrl: result.parent || null, linkText: result.linkText || '', depth: result.depth ?? null,
    classification: result.classification || 'other', classificationBasis: result.classificationBasis || '',
    retrievedAt: result.retrievedAt || null, httpStatus: result.httpStatus ?? null, contentType: result.contentType || null,
    contentLength: result.contentLength ?? null, etag: result.etag || null, lastModified: result.lastModified || null,
    sha256: result.sha256 || null, partial: !!result.partial, redirects: result.redirects || 0, robots: 'allowed',
    fetcher: result.fetcher || null, engineVersion: result.engineVersion || null, alsoFoundAt: [], ...extra
  };
}

export function createDocumentSaver({ investigationId, runId, label = 'Deep Discovery', extract = plainTextExtract, preserveOriginals = false, now = () => new Date().toISOString() } = {}) {
  let batch = null;
  const tally = { added: 0, linkedExisting: 0, duplicateAddresses: 0, archiveRecords: 0, unchanged: 0, errors: 0 };
  const ensureBatch = async () => { if (!batch) batch = await createIngestionBatch({ investigationId, label, sourceType: 'discovery', documentCount: null }); return batch; };

  async function saveRetrieved({ result, bytes }) {
    const b = await ensureBatch();
    const hash = result.sha256;
    const name = fileNameOf(result.finalUrl || result.url, result.linkText || 'document');
    const mime = (result.contentType || '').split(';')[0].trim() || MIME_BY_EXT[result.ext] || 'application/octet-stream';
    const prov = provenanceOf(result, { runId });
    const existing = await getRecordByCanonicalKey(hash);
    if (existing) {
      const known = [existing.originalUrl, ...(existing.discovery?.alsoFoundAt || [])].filter(Boolean);
      let record = existing;
      if (!known.includes(prov.originalUrl)) {
        record = await updateRecord(existing.id, { discovery: { ...(existing.discovery || prov), alsoFoundAt: [...(existing.discovery?.alsoFoundAt || []), prov.originalUrl] } });
        tally.duplicateAddresses += 1;
      } else tally.unchanged += 1;
      await saveRecordToInvestigation(investigationId, record);
      await createIngestionItem(investigationId, { jobId: b.id, recordId: record.id, sourceFilename: name, sourceUrl: prov.originalUrl, mimeType: mime, status: 'SKIPPED', metadata: { duplicateOccurrenceUrl: prov.originalUrl } });
      tally.linkedExisting += 1;
      return { status: 'duplicate', record };
    }
    if (preserveOriginals) await saveBlob({ hash, blob: new Blob([bytes], { type: mime }), mimeType: mime, size: bytes.byteLength });
    const { text, metadata, note } = await extract(name, mime, bytes);
    const sourceId = await getNextSourceId();
    const record = {
      sourceId, source: 'Deep Discovery', sourceKind: 'personal-library', sourceType: 'bulk-document', origin: 'deep-discovery',
      title: result.linkText && result.linkText.length > 3 ? result.linkText : name, originalUrl: prov.originalUrl, archiveUrl: null, captureDate: prov.retrievedAt,
      mime, snippet: text ? text.slice(0, 450) : (note || 'No extractable text.'), matchType: 'bulk-document', canonicalKey: hash,
      fileHash: hash, fileSize: bytes.byteLength, filePath: prov.originalUrl, ingestionBatchId: b.id, extractedText: text, extractionNote: note, metadata,
      isDuplicateOf: null, storageMode: preserveOriginals ? 'local-copy' : 'reference-only',
      preservation: { original: !!preserveOriginals, wayback: false, alternateArchive: false, r2: false }, discovery: prov
    };
    const saved = await saveRecordToInvestigation(investigationId, record);
    const item = await createIngestionItem(investigationId, { jobId: b.id, recordId: saved.id, sourceFilename: name, sourceUrl: prov.originalUrl, mimeType: mime, status: 'READY_FOR_REVIEW', metadata: text ? {} : { extractionUnavailable: true, extractionNote: note } });
    if (text) { try { await scanRecordForReview(investigationId, { recordId: saved.id, text }); } catch (e) { void item; } }
    tally.added += 1;
    return { status: 'new', record: saved };
  }

  async function saveArchiveOnly({ result }) {
    const copy = (result.archive?.copies || [])[0];
    if (!copy) return { status: 'skipped' };
    const key = `archive:${result.originalUrl || result.url}`;
    const existing = await getRecordByCanonicalKey(key);
    if (existing) { await saveRecordToInvestigation(investigationId, existing); tally.unchanged += 1; return { status: 'duplicate', record: existing }; }
    const prov = provenanceOf(result, { runId, originalOutcome: result.originalOutcome || null, originalReason: result.originalReason || null });
    const record = {
      source: copy.provider || 'Web archive', sourceKind: 'archive-connector', sourceType: 'discovered-archive-copy', origin: 'deep-discovery',
      title: result.linkText || fileNameOf(result.url), originalUrl: result.originalUrl || result.url, archiveUrl: copy.archiveUrl, captureDate: copy.captureDate || null,
      mime: MIME_BY_EXT[result.ext] || null, snippet: 'Historical copy: the original address did not return the document. This is the archived copy found.', matchType: 'url-history',
      canonicalKey: key, discovery: prov
    };
    const saved = await saveRecordToInvestigation(investigationId, record);
    tally.archiveRecords += 1;
    return { status: 'new', record: saved };
  }

  return {
    tally,
    // Passed to the engine as onDocument.
    async onDocument(payload) {
      try { return payload.bytes ? await saveRetrieved(payload) : await saveArchiveOnly(payload); }
      catch (e) { tally.errors += 1; throw e; }
    },
    async finish(state) {
      if (!batch) return null;
      return updateIngestionBatch(batch.id, { status: state === 'cancelled' ? 'CANCELLED' : 'COMPLETED', fileCount: tally.added + tally.linkedExisting, processedCount: tally.added + tally.linkedExisting, failedCount: tally.errors, completedAt: now(), metadata: { discoveryRunId: runId, ...tally } });
    }
  };
}

const slimDoc = (d) => ({
  url: d.url, ext: d.ext, linkText: d.linkText, parent: d.parent, classification: d.classification, outcome: d.outcome, reason: d.reason, originalOutcome: d.originalOutcome,
  httpStatus: d.httpStatus, finalUrl: d.finalUrl, retrievedAt: d.retrievedAt, sha256: d.sha256, contentType: d.contentType, contentLength: d.contentLength, partial: d.partial,
  duplicateOf: d.duplicateOf, archive: d.archive, skipped: d.skipped, note: d.note
});

// Stores the run (coverage, counts, checkpoint, slim document list) and its ledger. Idempotent: same run id, same rows.
export async function recordRun(investigationId, result, { seeds = [], options = {}, report = null } = {}) {
  await saveDiscoveryRun(investigationId, {
    id: result.runId, startedAt: result.startedAt, finishedAt: result.finishedAt, state: result.state, mode: result.mode, engineVersion: result.engineVersion,
    seeds, options, limits: { ...result.limits, clamped: undefined }, counters: result.counters, usage: result.usage, stopReason: result.stopReason,
    warnings: result.warnings, blockedHosts: result.blockedHosts, stoppedHosts: result.stoppedHosts, coverage: result.coverage, ledgerSummary: result.ledgerSummary,
    documents: (result.documents || []).map(slimDoc), documentCandidates: (result.documentCandidates || []).length, checkpoint: result.checkpoint, report: report ? { headline: report.headline, counts: report.counts, limits: report.limits } : null
  });
  await saveDiscoveryLedger(investigationId, result.runId, result.ledger || []);
}
