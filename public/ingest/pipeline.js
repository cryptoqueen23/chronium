// Bulk investigation ingestion. Runs entirely in the browser (see
// docs/CANON.md Cost Principle - the browser does local processing so a
// large production never has to be uploaded anywhere to be unzipped/hashed).
//
// Two entry points share one per-file pipeline:
//   ingestZip(file, investigationId, onProgress)  - a .zip, streamed via fflate
//   ingestFiles(fileList, investigationId, onProgress) - a plain multi-file pick
import { extractContent } from './adapters.js';
import {
  saveRecordToInvestigation, saveBlob, getRecordByCanonicalKey, updateRecord,
  createIngestionBatch, updateIngestionBatch, getNextSourceId
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
  return { status: note && !text ? 'unsupported' : 'ingested', filePath, fileName, hash, size, record: saved, note };
}

async function runBatch(entries, investigationId, label, onProgress, preserveOriginals) {
  const batch = await createIngestionBatch({ investigationId, label });
  let fileCount = 0, byteTotal = 0;
  const skipped = [];
  const errors = [];

  for await (const entry of entries) {
    try {
      const result = await processFile({
        investigationId, batchId: batch.id,
        filePath: entry.path, fileName: entry.name, bytes: entry.bytes, preserveOriginals
      });
      fileCount++;
      byteTotal += result.size;
      if (result.status === 'unsupported') skipped.push({ path: entry.path, reason: result.note || 'Unsupported file type' });
      onProgress?.({ processed: fileCount, byteTotal, current: entry.name, status: result.status });
    } catch (e) {
      errors.push({ path: entry.path, message: e.message });
      onProgress?.({ processed: fileCount, byteTotal, current: entry.name, status: 'error', error: e.message });
    }
  }

  return updateIngestionBatch(batch.id, { fileCount, byteTotal, skipped, errors, completedAt: new Date().toISOString() });
}

// Plain multi-file / folder picker input (a FileList or File[]). preserveOriginals
// defaults to false: Local Only per docs/CANON.md - index the content, don't
// copy the bytes into Chronium storage unless the caller opts in.
export async function ingestFiles(fileList, investigationId, onProgress, { label = 'Bulk file import', preserveOriginals = false } = {}) {
  async function* entries() {
    for (const file of fileList) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      yield { path: file.webkitRelativePath || file.name, name: file.name, bytes };
    }
  }
  return runBatch(entries(), investigationId, label, onProgress, preserveOriginals);
}

// Streams a .zip via fflate so a large archive is never fully decompressed
// into memory at once - only one file's bytes are held at a time.
export async function ingestZip(file, investigationId, onProgress, { label, preserveOriginals = false } = {}) {
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

  return runBatch(entries(), investigationId, label || file.name, onProgress, preserveOriginals);
}
