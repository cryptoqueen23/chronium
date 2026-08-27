#!/usr/bin/env node
/**
 * Converts the Copperas Cove Phase 2 investigation CSV into the normalized
 * Chronium record/version shape (docs/ARCHITECTURE.md), so it can be bundled
 * into the Worker as a local-corpus connector. Node 18+, no dependencies.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(HERE, '..', 'data', 'copperas-cove', 'copperas-cove-phase2-investigation-dataset.csv');
const OUT_PATH = path.join(HERE, '..', 'data', 'copperas-cove', 'normalized.json');

const DOMAIN = 'copperascovetx.gov';
const ORGANIZATION = 'City of Copperas Cove';
const JURISDICTION = 'Copperas Cove, TX';

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.map(r => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ''])));
}

function toRecord(row, i) {
  const captureCount = Number(row.captures) || 0;
  const uniqueVersions = Number(row.unique_versions) || 0;
  const year = String(row.year || '').trim();
  const capturedAt = /^\d{14}$/.test((row.archive_exact.match(/\/web\/(\d{14})\//) || [])[1] || '')
    ? normalizeTimestamp(row.archive_exact.match(/\/web\/(\d{14})\//)[1])
    : (year ? `${year}-01-01T00:00:00Z` : null);

  return {
    id: `copperas-cove-${i + 1}`,
    canonicalKey: row.original,
    domain: DOMAIN,
    organization: ORGANIZATION,
    jurisdiction: JURISDICTION,
    category: row.system || null,
    title: row.project_document || row.original,
    description: row.why_it_matters || null,
    documentType: row.mime_type || null,
    originalUrl: row.original || null,
    currentUrl: null,
    firstSeen: capturedAt,
    lastSeen: capturedAt,
    tags: [row.priority].filter(Boolean),
    entities: [],
    relatedRecordIds: [],
    sourceType: 'government-record',
    sourceAuthority: 'primary',
    provenance: {
      ingestedVia: 'copperas-cove-phase2-csv',
      priority: row.priority || null,
      score: Number.isFinite(Number(row.score)) ? Number(row.score) : null,
      historyUrl: row.archive_history || null
    },
    // COMPUTED FACTS from the harvest — mechanically derived, not source content.
    captureCount,
    uniqueVersionCount: uniqueVersions,
    versions: [{
      id: `copperas-cove-${i + 1}-v1`,
      recordId: `copperas-cove-${i + 1}`,
      capturedAt,
      source: 'Wayback Machine',
      archiveUrl: row.archive_exact || null,
      originalUrl: row.original || null,
      mimeType: row.mime_type || null,
      digest: null,
      statusCode: null,
      extractedTextRef: null,
      provenance: { note: 'Most recent known capture; full capture list not retained in Phase 2 export.' }
    }]
  };
}

function normalizeTimestamp(ts) {
  const y = ts.slice(0, 4), m = ts.slice(4, 6), d = ts.slice(6, 8);
  const hh = ts.slice(8, 10) || '00', mm = ts.slice(10, 12) || '00', ss = ts.slice(12, 14) || '00';
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}Z`;
}

const csvText = await fs.readFile(CSV_PATH, 'utf8');
const rows = parseCsv(csvText);
const records = rows.map(toRecord);

await fs.writeFile(OUT_PATH, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'copperas-cove-phase2-investigation-dataset.csv',
  count: records.length,
  records
}, null, 2));

console.log(`Wrote ${records.length.toLocaleString()} normalized records to ${path.relative(process.cwd(), OUT_PATH)}`);
