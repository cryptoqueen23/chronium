// Bulk investigation ingestion. Runs entirely in the browser (see
// docs/CANON.md Cost Principle - the browser does local processing so a
// large production never has to be uploaded anywhere to be unzipped/hashed).
//
// Two entry points share one per-file pipeline:
//   ingestZip(file, investigationId, onProgress)  - a .zip, streamed via fflate
//   ingestFiles(fileList, investigationId, onProgress) - a plain multi-file pick
//
// Phase 4 addition (docs/INVESTIGATION_WORKSPACE_PLAN.md): each processed
// file now also gets an `ingestionItem` review-queue row, and successfully
// extracted text is scanned for subject candidates / watchlist hits via
// scanRecordForReview() - itself a thin wrapper over the PURE detectors in
// ingestionReview.js. This file still only ever SURFACES what that scan
// finds; it never creates a mention, relationship, or claim - see
// db.js's "Bulk Ingestion Review Queue" section header for the full rule.
import { extractContent } from './adapters.js';
import {
  saveRecordToInvestigation, saveBlob, getRecordByCanonicalKey, updateRecord,
  createIngestionBatch, updateIngestionBatch, getIngestionBatch, getNextSourceId,
  createIngestionItem, updateIngestionItem, scanRecordForReview
} from '../db.js';

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function guessMimeType(filename) {
  const ext = (/\.([a-z0-9]+)$/i.exec(filename) || [, ''])[1].toLowerCase();
  return {
    pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', json: 'application/json',
    md: 'text/markdown', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
    eml: 'message/rfc822'
  }[ext] || 'application/octet-stream';
}

// Processes one already-read file end to end: hash -> dedupe check -> extract
// -> save as a record linked to the investigation. Per docs/CANON.md Storage
// Modes, original bytes are Local Only by default: Chronium indexes the file
// (hash, extracted text, metadata) but does NOT copy the bytes into its own
// storage unless preserveOriginals is explicitly turned on for this batch.
async function processFile({ investigationId, batchId, filePath, fileName, bytes, preserveOriginals }) {
  // Captured up front: some extractors (pdf.js hands its buffer to an
  // internal worker) can transfer/detach the underlying ArrayBuffer, which
  // would make bytes.byteLength read back as 0 if checked afterward.
  const size = bytes.byteLength;
  const hash = await sha256Hex(bytes);
  const mimeType = guessMimeType(fileName);
  const existingByHash = await getRecordByCanonicalKey(hash);

  if (preserveOriginals) {
    await saveBlob({ hash, blob: new Blob([bytes], { type: mimeType }), mimeType, size });
  }

  if (existingByHash) {
    // Same content already a source in the library. Still link it into this
    // investigation (if not already) so "inventory every file" holds even for
    // duplicates, without re-extracting text again. If this run preserved the
    // bytes but an earlier ingestion of the same content didn't, upgrade the
    // existing record to reflect that a local copy now genuinely exists.
    let record = existingByHash;
    if (preserveOriginals && record.storageMode !== 'local-copy') {
      record = await updateRecord(record.id, {
        storageMode: 'local-copy',
        preservation: { ...record.preservation, original: true }
      });
    }
    await saveRecordToInvestigation(investigationId, record);
    // Phase 4: a SKIPPED review-queue row, not a re-scanned one - the
    // record was already scanned for candidates the first time it was
    // ingested (possibly in a different batch, or under a different
    // filename/path). Re-scanning identical text would just create
    // duplicate reviewCandidates for content already surfaced, without
    // losing this occurrence's own provenance: the batch/filename/path
    // of THIS encounter is preserved on the item itself (Phase 4 brief
    // §9: "record the duplicate source occurrence in ingestion metadata").
    await createIngestionItem(investigationId, {
      jobId: batchId, recordId: record.id, sourceFilename: fileName, mimeType,
      status: 'SKIPPED', metadata: { duplicateOccurrencePath: filePath }
    });
    return { status: 'duplicate', filePath, fileName, hash, size, record };
  }

  const { text, metadata, note } = await extractContent(fileName, mimeType, bytes);
  const sourceId = await getNextSourceId();

  const record = {
    sourceId,
    source: 'Bulk import',
    sourceKind: 'personal-library',
    sourceType: 'bulk-document',
    title: fileName,
    originalUrl: null,
    archiveUrl: null,
    captureDate: null,
    mime: mimeType,
    snippet: text ? text.slice(0, 450) : (note || 'No extractable text.'),
    matchType: 'bulk-document',
    canonicalKey: hash,
    fileHash: hash,
    fileSize: size,
    filePath,
    ingestionBatchId: batchId,
    extractedText: text,
    extractionNote: note,
    metadata,
    isDuplicateOf: null,
    storageMode: preserveOriginals ? 'local-copy' : 'reference-only',
    preservation: { original: !!preserveOriginals, wayback: false, alternateArchive: false, r2: false }
  };

  const saved = await saveRecordToInvestigation(investigationId, record);
  const status = note && !text ? 'unsupported' : 'ingested';

  // Phase 4: a review-queue row for every genuinely new document, plus -
  // ONLY when there's real extracted text - the assistive candidate/
  // watchlist scan (ingestionReview.js's pure detectors via
  // scanRecordForReview). A file Chronium couldn't parse still gets a
  // queue row (Phase 4 brief §8: "ingest metadata and mark content
  // extraction unavailable") so a human can open and read it directly;
  // it just has nothing automated to show.
  const item = await createIngestionItem(investigationId, {
    jobId: batchId, recordId: saved.id, sourceFilename: fileName, mimeType,
    status: 'READY_FOR_REVIEW', metadata: status === 'unsupported' ? { extractionUnavailable: true, extractionNote: note } : {}
  });
  if (text) {
    try {
      await scanRecordForReview(investigationId, { recordId: saved.id, text });
    } catch (e) {
      // A scan failure must never take down the whole item - the document
      // itself ingested fine and is still fully reviewable by hand.
      await updateIngestionItem(item.id, { metadata: { ...item.metadata, scanError: e.message } });
    }
  }

  return { status, filePath, fileName, hash, size, record: saved, note };
}

// `control` (optional): { cancelled, paused } - a plain mutable object the
// CALLER can flip mid-run (see public/app.js's Cancel/Pause buttons) so
// this loop can stop between files without needing the source generator
// itself to be abortable/resumable. Checked once per file - a large
// in-flight file finishes before the loop notices, never interrupted
// mid-extraction (extraction has no natural cancellation point of its own).
async function runBatch(entries, investigationId, label, onProgress, preserveOriginals, { sourceType, documentCount, existingBatchId, control } = {}) {
  const batch = existingBatchId
    ? await getIngestionBatch(existingBatchId)
    : await createIngestionBatch({ investigationId, label, sourceType, documentCount });
  if (existingBatchId) await updateIngestionBatch(batch.id, { status: 'RUNNING' });

  let fileCount = existingBatchId ? (batch.fileCount || 0) : 0;
  let byteTotal = existingBatchId ? (batch.byteTotal || 0) : 0;
  let processedCount = existingBatchId ? (batch.processedCount || 0) : 0;
  let failedCount = existingBatchId ? (batch.failedCount || 0) : 0;
  const skipped = existingBatchId ? [...(batch.skipped || [])] : [];
  const errors = existingBatchId ? [...(batch.errors || [])] : [];
  const duplicates = existingBatchId ? [...(batch.duplicates || [])] : [];
  let stoppedEarly = null; // 'CANCELLED' | 'PAUSED'
  let fatalError = null;

  try {
    for await (const entry of entries) {
      if (control?.cancelled) { stoppedEarly = 'CANCELLED'; break; }
      if (control?.paused) { stoppedEarly = 'PAUSED'; break; }
      processedCount++;
      try {
        // entry.bytes (zip - already read while decompressing) or
        // entry.file (plain files - deferred here, see ingestFiles' entries()
        // above) - a read failure on the latter is now a normal per-item
        // failure, caught below, exactly like an extraction failure.
        const bytes = entry.bytes || new Uint8Array(await entry.file.arrayBuffer());
        const result = await processFile({
          investigationId, batchId: batch.id,
          filePath: entry.path, fileName: entry.name, bytes, preserveOriginals
        });
        fileCount++;
        byteTotal += result.size;
        if (result.status === 'unsupported') skipped.push({ path: entry.path, reason: result.note || 'Unsupported file type' });
        if (result.status === 'duplicate') duplicates.push({ path: entry.path, matchedRecordId: result.record.id, matchedTitle: result.record.title });
        onProgress?.({ processed: processedCount, byteTotal, current: entry.name, status: result.status });
      } catch (e) {
        // One bad document must not kill the batch (Phase 4 brief §18) -
        // already true here structurally: the catch swallows this file's
        // failure and the for-await loop continues to the next entry.
        failedCount++;
        errors.push({ path: entry.path, message: e.message });
        await createIngestionItem(investigationId, { jobId: batch.id, sourceFilename: entry.name, status: 'FAILED', error: e.message });
        onProgress?.({ processed: processedCount, byteTotal, current: entry.name, status: 'error', error: e.message });
      }
    }
  } catch (e) {
    // Only reachable for a failure in the ENTRIES SOURCE itself, not a
    // per-file failure (those are caught above and never escape here) -
    // in practice this means a corrupted zip STREAM (ingestZip), which
    // can't be skipped past to reach later entries the way one bad plain
    // file can be. Documented limitation, not silently swallowed: the
    // batch is marked FAILED with the real error, not left stuck at
    // RUNNING forever.
    fatalError = e.message;
  }

  const status = fatalError ? 'FAILED' : stoppedEarly || (failedCount > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED');
  return updateIngestionBatch(batch.id, {
    fatalError,
    fileCount, byteTotal, processedCount, failedCount, skipped, errors, duplicates, status,
    completedAt: stoppedEarly ? null : new Date().toISOString()
  });
}

// Plain multi-file / folder picker input, or drag-and-drop items. Each item is
// either a File (from an <input>) or a { file, path } wrapper (from walking a
// dropped folder's FileSystemEntry tree, which knows the real relative path).
// preserveOriginals defaults to false: Local Only per docs/CANON.md - index
// the content, don't copy the bytes into Chronium storage unless the caller
// opts in.
// `existingBatchId` + `control` (Phase 4): resuming a paused run means
// re-calling this with the REMAINING slice of the original fileList and
// the same batch id - true mid-generator resume isn't attempted (the
// generator itself isn't restartable), but since `fileList` here is a
// concrete, indexable array (unlike the zip stream below), a caller can
// always compute "what's left" from `processedCount` and slice it. `control`
// (`{ cancelled, paused }`) lets a Cancel/Pause button in the UI stop the
// loop between files - see runBatch() above for the exact semantics.
export async function ingestFiles(fileList, investigationId, onProgress, { label = 'Bulk file import', preserveOriginals = false, sourceType = 'bulk-files', existingBatchId, control } = {}) {
  // Yields the raw File, NOT its read bytes - reading happens inside
  // runBatch's per-item try/catch instead (see there). A file that fails
  // to even read (permission error, browser I/O error, a truncated
  // drag-and-drop entry) must be recorded as a failed item and skipped,
  // not abort the whole batch - deferring the read is what makes that
  // true (Phase 4 brief §18 "one bad document must not kill the batch").
  async function* entries() {
    for (const item of fileList) {
      const file = item instanceof File ? item : item.file;
      const path = item instanceof File ? (file.webkitRelativePath || file.name) : (item.path || file.name);
      yield { path, name: file.name, file };
    }
  }
  return runBatch(entries(), investigationId, label, onProgress, preserveOriginals, { sourceType, documentCount: fileList.length, existingBatchId, control });
}

// Streams a .zip via fflate so a large archive is never fully decompressed
// into memory at once - only one file's bytes are held at a time.
// `control` (Phase 4) works the same as in ingestFiles above. True
// pause/resume is NOT supported for zip streams specifically - the
// stream can't be re-seeked to an arbitrary mid-archive position, so a
// pause here behaves as an effective cancel (documented limitation, not
// silently glossed over - see docs/INVESTIGATION_WORKSPACE_PLAN.md Phase
// 4's as-built section). Cancel works normally.
export async function ingestZip(file, investigationId, onProgress, { label, preserveOriginals = false, control } = {}) {
  const fflate = await import('/vendor/fflate/fflate.mjs');

  async function* entries() {
    const pending = [];
    let resolveNext = null;
    let doneReading = false;
    let readError = null;

    const unzipper = new fflate.Unzip();
    unzipper.register(fflate.UnzipInflate);
    unzipper.onfile = (zf) => {
      if (zf.originalSize === 0 && /\/$/.test(zf.name)) return; // directory entry
      const chunks = [];
      zf.ondata = (err, chunk, final) => {
        if (err) { readError = err; return; }
        chunks.push(chunk);
        if (final) {
          const total = chunks.reduce((n, c) => n + c.length, 0);
          const bytes = new Uint8Array(total);
          let offset = 0;
          for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
          const item = { path: zf.name, name: zf.name.split('/').pop(), bytes };
          if (resolveNext) { const r = resolveNext; resolveNext = null; r(item); }
          else pending.push(item);
        }
      };
      zf.start();
    };

    const reader = file.stream().getReader();
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          unzipper.push(value ? new Uint8Array(value) : new Uint8Array(0), done);
          if (done) break;
        }
      } catch (e) {
        readError = e;
      } finally {
        doneReading = true;
        if (resolveNext) { const r = resolveNext; resolveNext = null; r(null); }
      }
    })();

    while (true) {
      if (pending.length) { yield pending.shift(); continue; }
      if (doneReading) { if (readError) throw readError; return; }
      const next = await new Promise((resolve) => { resolveNext = resolve; });
      if (next) yield next;
      else return;
    }
  }

  return runBatch(entries(), investigationId, label || file.name, onProgress, preserveOriginals, { sourceType: 'bulk-zip', control });
}
