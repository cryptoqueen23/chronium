// Portable investigation file (.chronium.json): format, validation, and the
// export/import entry points used by BOTH the website and the extension side
// panel. Pure parts here; IndexedDB reading/merging is in portableDb.js.
//
// Rules (docs/ROADMAP.md "Case portability"):
//  - Versioned; unsupported versions are refused with a plain message.
//  - Import always previews first and never overwrites an existing row.
//  - Only the investigation's own data is exported: no keys, settings, or
//    other cases. Enforced by the whitelist in portableDb.js.
import { readInvestigationForExport, mergeInvestigationData, PORTABLE_ID_STORES, PORTABLE_SINGLETON_STORES } from './portableDb.js';

export const FORMAT = 'chronium-investigation';
export const FORMAT_VERSION = 1;
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

export class PortableFileError extends Error {}

const LABELS = {
  investigations: 'case', records: 'sources', investigationRecords: 'source links', ingestionBatches: 'import batches',
  evidenceItems: 'evidence passages', claims: 'claims', quantitativeFindings: 'quantitative findings',
  qualitativeFindings: 'qualitative findings', crossValidations: 'cross-checks', askSourcesHistory: 'saved questions',
  entities: 'subjects', relationships: 'relationships', entityAliases: 'alternate names', entityMentions: 'name matches',
  claimEvidence: 'claim-evidence links', claimFindings: 'findings', claimHistory: 'claim history', ingestionItems: 'imported files',
  reviewCandidates: 'review items', watchlists: 'watch terms', watchlistMatches: 'watch-term hits', reviewHistory: 'review history',
  discoveryRuns: 'document search runs', discoveryLedger: 'document search log entries', outlines: 'outline', qualitativeAnalysis: 'saved analysis', blobs: 'stored file copies'
};
export const labelFor = (store) => LABELS[store] || store;

export function safeFilename(name) {
  const base = String(name || 'case').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'case';
  return `${base}.chronium.json`;
}

// Builds the export file contents for one case.
export async function exportInvestigationFile(investigationId, { includeFiles = false } = {}) {
  const data = await readInvestigationForExport(investigationId, { includeFiles });
  if (!data) throw new PortableFileError('That case no longer exists.');
  const bundle = { format: FORMAT, version: FORMAT_VERSION, exportedAt: new Date().toISOString(), includesStoredFiles: !!includeFiles, data };
  return { filename: safeFilename(data.investigation.name), text: JSON.stringify(bundle), counts: countsOf(data) };
}

function countsOf(data) {
  const c = { sources: data.records.length };
  for (const n of [...PORTABLE_ID_STORES, ...PORTABLE_SINGLETON_STORES]) c[labelFor(n)] = data[n].length;
  return c;
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Parses and validates file text. Throws PortableFileError with a message a
// non-technical person can act on. Returns the bundle on success.
export function parseBundleText(text) {
  if (typeof text !== 'string' || !text.trim()) throw new PortableFileError('This file is empty.');
  if (text.length > MAX_IMPORT_BYTES) throw new PortableFileError('This file is too large to import (over 200 MB).');
  let bundle;
  try { bundle = JSON.parse(text); } catch { throw new PortableFileError('This is not a Chronium case file. It could not be read as JSON; the file may be damaged or a different kind of file.'); }
  if (!isObj(bundle) || bundle.format !== FORMAT) throw new PortableFileError('This is not a Chronium case file.');
  if (!Number.isInteger(bundle.version) || bundle.version > FORMAT_VERSION) {
    throw new PortableFileError(`This case file is from a newer version of Chronium (file version ${bundle.version}). Update Chronium, then try again.`);
  }
  if (bundle.version < 1) throw new PortableFileError('This case file version is not supported.');
  const d = bundle.data;
  if (!isObj(d) || !isObj(d.investigation) || typeof d.investigation.id !== 'string' || typeof d.investigation.name !== 'string') {
    throw new PortableFileError('This case file is missing its case information, so it was not imported.');
  }
  const invId = d.investigation.id;
  const lists = ['records', 'investigationRecords', 'blobs', ...PORTABLE_ID_STORES, ...PORTABLE_SINGLETON_STORES];
  for (const name of lists) {
    if (d[name] === undefined) d[name] = [];
    if (!Array.isArray(d[name])) throw new PortableFileError(`This case file is damaged (the "${labelFor(name)}" section is not a list).`);
  }
  for (const rec of d.records) {
    if (!isObj(rec) || typeof rec.id !== 'string') throw new PortableFileError('This case file is damaged (a source is missing its id).');
  }
  for (const l of d.investigationRecords) {
    if (!isObj(l) || typeof l.recordId !== 'string') throw new PortableFileError('This case file is damaged (a source link is incomplete).');
  }
  for (const name of PORTABLE_ID_STORES) {
    for (const row of d[name]) {
      if (!isObj(row) || typeof row.id !== 'string') throw new PortableFileError(`This case file is damaged (an item in "${labelFor(name)}" has no id).`);
      if (row.investigationId !== invId) throw new PortableFileError(`This case file mixes in data from another case (in "${labelFor(name)}"), so it was not imported.`);
    }
  }
  for (const name of PORTABLE_SINGLETON_STORES) {
    for (const row of d[name]) {
      if (!isObj(row) || row.investigationId !== invId) throw new PortableFileError(`This case file is damaged (in "${labelFor(name)}").`);
    }
  }
  for (const b of d.blobs) {
    if (!isObj(b) || typeof b.hash !== 'string' || typeof b.dataBase64 !== 'string') throw new PortableFileError('This case file is damaged (a stored file copy is incomplete).');
  }
  return bundle;
}

// Dry run: what would happen if this file were imported now. Writes nothing.
export async function previewImport(text) {
  const bundle = parseBundleText(text);
  const report = await mergeInvestigationData(bundle.data, { dryRun: true });
  return { bundle, report };
}

// Merges the file. Existing rows are never overwritten.
export async function importBundle(bundle) {
  return mergeInvestigationData(bundle.data, { dryRun: false });
}

// One plain-language summary of a merge report, for the preview/result box.
export function describeReport(report, { done = false } = {}) {
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const added = report.added, lines = [];
  const parts = Object.entries(added).filter(([k]) => k !== 'investigations' && k !== 'investigationRecords').map(([k, n]) => `${n} ${labelFor(k)}`);
  lines.push(report.investigationExisted
    ? `"${report.investigationName}" is already on this device. Only items you do not have yet ${done ? 'were' : 'will be'} added.`
    : `"${report.investigationName}" ${done ? 'was' : 'will be'} added as a new case.`);
  lines.push(parts.length ? `${done ? 'Added' : 'Will add'}: ${parts.join(', ')}.` : 'Nothing new to add.');
  const same = sum(report.identical);
  if (same) lines.push(`${same} item${same === 1 ? '' : 's'} already here and unchanged.`);
  const conflicts = sum(report.conflicts);
  if (conflicts) lines.push(`${conflicts} item${conflicts === 1 ? '' : 's'} exist here with different content. Your version ${done ? 'was' : 'will be'} kept; the file's version is ignored.`);
  if (report.sourceIdsReassigned) lines.push(`${report.sourceIdsReassigned} source number${report.sourceIdsReassigned === 1 ? '' : 's'} renumbered to avoid clashing with sources already here.`);
  if (report.claimIdsReassigned) lines.push(`${report.claimIdsReassigned} claim number${report.claimIdsReassigned === 1 ? '' : 's'} renumbered to avoid clashing with claims already here.`);
  return lines;
}
