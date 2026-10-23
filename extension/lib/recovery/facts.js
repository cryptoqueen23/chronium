// Records Recovery: facts read from each document the case holds (type, body, date, fiscal year, citations,
// readability). Deterministic rules only. Every fact records WHERE it came from, because a fact read from the
// document's own text is stronger evidence than one guessed from a file name, and the matching rules use that
// difference. When two places disagree, the fact is marked conflicting instead of being resolved silently.
// Pure module.
import { classifyDocument, RULES } from '../discovery/classify.js';

const MONTHS = { january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12 };
const MONTH_RE = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)';

const pad = (n) => String(n).padStart(2, '0');
function validYmd(y, m, d) {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Finds every date written in `text`. Returns [{ iso, ambiguous, form }] in order of appearance.
export function findDates(text) {
  const s = String(text || '');
  const out = [];
  const push = (y, m, d, form, ambiguous = false, index = 0) => { if (validYmd(y, m, d)) out.push({ iso: iso(y, m, d), ambiguous, form, index }); };
  let m;
  const longRe = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s+(\\d{4})\\b`, 'gi');
  while ((m = longRe.exec(s))) push(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]), 'long', false, m.index);
  const dmyRe = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?,?\\s+(\\d{4})\\b`, 'gi');
  while ((m = dmyRe.exec(s))) push(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]), 'long', false, m.index);
  const isoRe = /(?<!\d)(\d{4})[-_.](\d{2})[-_.](\d{2})(?!\d)/g;
  while ((m = isoRe.exec(s))) push(Number(m[1]), Number(m[2]), Number(m[3]), 'iso', false, m.index);
  const numRe = /(?<!\d)(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?!\d)/g;
  while ((m = numRe.exec(s))) {
    const a = Number(m[1]); const b = Number(m[2]); const y = Number(m[3]);
    if (a > 12 && b <= 12) push(y, b, a, 'numeric-day-first', false, m.index);
    else if (b > 12 && a <= 12) push(y, a, b, 'numeric-month-first', false, m.index);
    else push(y, a, b, 'numeric', a !== b, m.index); // both could be months: US reading, flagged ambiguous
  }
  // 8 digits run together, as in file names: 03122024 (month-day-year) or 20240312 (year-month-day).
  const packed = /(?<!\d)(\d{8})(?!\d)/g;
  while ((m = packed.exec(s))) {
    const t = m[1];
    const y1 = Number(t.slice(0, 4));
    if (y1 >= 1990 && y1 <= 2100 && validYmd(y1, Number(t.slice(4, 6)), Number(t.slice(6, 8)))) push(y1, Number(t.slice(4, 6)), Number(t.slice(6, 8)), 'packed-ymd', false, m.index);
    else push(Number(t.slice(4, 8)), Number(t.slice(0, 2)), Number(t.slice(2, 4)), 'packed-mdy', false, m.index);
  }
  return out.sort((a, b) => a.index - b.index);
}

const BODY_PATTERNS = [
  /\bcity council\b/i, /\btown council\b/i, /\bvillage board\b/i, /\bboard of aldermen\b/i, /\bcommissioners'? court\b/i, /\bcity commission\b/i,
  /\bplanning\s+(?:and|&)\s+zoning\s+commission\b/i, /\bplanning commission\b/i, /\bzoning board of adjustment\b/i, /\bschool board\b/i, /\bboard of trustees\b/i,
  /\bboard of directors\b/i, /\beconomic development (?:corporation|board|commission)\b/i, /\blibrary board\b/i, /\bparks? (?:and recreation )?board\b/i,
  /\bhousing authority\b/i, /\bcounty commissioners\b/i
];
export function findBody(text) {
  for (const re of BODY_PATTERNS) { const m = re.exec(String(text || '')); if (m) return m[0].toLowerCase().replace(/\s+/g, ' ').replace('&', 'and').replace("commissioners' court", 'commissioners court'); }
  return null;
}

export function findFiscalYear(text) {
  const s = String(text || '');
  let m = /\bFY\s?'?(\d{4}|\d{2})(?:\s?[-–/]\s?(\d{2,4}))?\b/i.exec(s);
  if (m) return fy(m[1], m[2], true);
  m = /\bfiscal\s+year\s+(\d{4})(?:\s?[-–/]\s?(\d{2,4}))?\b/i.exec(s);
  if (m) return fy(m[1], m[2], false);
  m = /\b(20\d{2})\s?[-–/]\s?(20\d{2}|\d{2})\s+(?:annual\s+)?(?:budget|audit|financial|tax)/i.exec(s);
  if (m) return fy(m[1], m[2], false);
  m = /\b(?:annual\s+)?budget\s+(?:for\s+)?(20\d{2})\b/i.exec(s) || /\b(20\d{2})\s+(?:annual\s+)?(?:budget|audit|acfr|cafr|tax rate)\b/i.exec(s);
  if (m) return Number(m[1]);
  return null;
}
function fy(a, b, twoDigitOk) {
  let y = Number(a);
  if (a.length === 2 && twoDigitOk) y = 2000 + y;
  if (b && String(b).length >= 2) { const end = String(b).length === 2 ? Number(String(Math.floor(y / 100)) + b) : Number(b); if (end === y + 1) return end; } // 2024-25 means the year ending in 2025
  return y >= 1990 && y <= 2100 ? y : null;
}

// Numbers a document cites: ordinances, resolutions, contracts. Exhibits and attachments are deliberately not
// tracked as citations (they name parts of the same packet, not separate records).
const CITE_RES = [
  ['ordinance', /\bord(?:inance)?s?\.?\s*(?:no\.?|number|#)?\s*(\d{2,4}\s?[-–]\s?\d{1,4}|\d{1,5})\b/gi],
  ['resolution', /\bres(?:olution)?s?\.?\s*(?:no\.?|number|#)?\s*(\d{2,4}\s?[-–]\s?\d{1,4}|\d{1,5})\b/gi],
  ['contract', /\bcontract\s*(?:no\.?|number|#)?\s*([A-Z0-9]{1,6}(?:[-–][A-Z0-9]{1,6}){1,3})\b/gi]
];
const normNumber = (n) => String(n).replace(/\s+/g, '').replace('–', '-').toUpperCase();
export function findCitations(text) {
  const s = String(text || '');
  const out = []; const seen = new Set();
  for (const [kind, re] of CITE_RES) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(s))) {
      const key = `${kind}:${normNumber(m[1])}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const from = Math.max(0, m.index - 70); const to = Math.min(s.length, m.index + m[0].length + 70);
      out.push({ key, kind, number: normNumber(m[1]), quote: s.slice(from, to).replace(/\s+/g, ' ').trim() });
    }
  }
  return out;
}

// The document's own number: "ORDINANCE NO. 2024-17" near the start of its text or in its title.
// Only a document that is itself an ordinance, resolution or contract has an own number; a set of minutes that
// mentions ordinance 2024-17 near its top does not.
export function ownNumbers(title, text, type) {
  const kinds = { ordinance: 'ordinance:', resolution: 'resolution:', contract: 'contract:' };
  const prefix = kinds[type];
  if (!prefix) return [];
  const head = `${title || ''}\n${String(text || '').slice(0, 200)}`;
  return findCitations(head).map((c) => c.key).filter((k) => k.startsWith(prefix)).slice(0, 1);
}

const fileNameOf = (u) => { try { return decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || ''); } catch { return String(u || '').split('/').pop() || ''; } };
const clean = (s) => String(s || '').replace(/[_+]+/g, ' ');

/**
 * Reads the facts for one record (as stored in the case). `basis` values: 'document text', 'file name', 'link text', 'title', 'none'.
 * `verified` is true only when type, body and date were each read from the document's own text.
 */
export function extractFacts(record) {
  const text = String(record.extractedText || '');
  const head = text.slice(0, 2000);
  const top = text.slice(0, 600);
  const file = fileNameOf(record.originalUrl || record.filePath || '');
  const link = record.discovery?.linkText || '';
  const title = record.title || '';

  // Type: the document's own heading first (the earliest type word near the top, so an agenda that mentions
  // "approval of the minutes" is still an agenda), then names.
  const typeFromHeading = (str) => {
    for (const span of [300, 600]) {
      let best = null;
      for (const [cls, re] of RULES) { const m = re.exec(str.slice(0, span).toLowerCase()); if (m && (best === null || m.index < best.index)) best = { cls, index: m.index }; }
      if (best) return best.cls;
    }
    return null;
  };
  const typeFromName = (str) => { if (!str) return null; const c = classifyDocument({ url: 'https://x.invalid/' + encodeURIComponent(str), text: str }); return c.class !== 'other' ? c.class : null; };
  let type = null;
  const th = typeFromHeading(top); if (th) type = { value: th, basis: 'document text' };
  for (const [src, label] of [[file, 'file name'], [link, 'link text'], [title, 'title']]) { if (type) break; const t = typeFromName(clean(src)); if (t) type = { value: t, basis: label }; }
  if (!type) { const c = record.discovery?.classification; type = c && c !== 'other' ? { value: c, basis: 'link text' } : { value: 'unknown', basis: 'none' }; }
  const bodyHit = (str, label) => { const b = findBody(str); return b ? { value: b, basis: label } : null; };
  let body = bodyHit(head, 'document text');
  for (const [src, label] of [[clean(file), 'file name'], [link, 'link text'], [title, 'title']]) { if (!body) body = bodyHit(src, label); }
  if (!body) body = { value: null, basis: 'none' };

  // Date: authority order is document text, file name, link text, title. Retrieval time is never used.
  const sources = [];
  for (const [src, label] of [[head, 'document text'], [clean(file), 'file name'], [link, 'link text'], [title, 'title']]) {
    const ds = findDates(src);
    if (ds.length) sources.push({ label, date: ds[0] });
  }
  let date = { iso: null, basis: 'none', ambiguous: false, conflict: false, others: [] };
  if (sources.length) {
    const first = sources[0];
    const disagree = sources.slice(1).filter((s) => s.date.iso !== first.date.iso && !s.date.ambiguous && !first.date.ambiguous);
    date = { iso: first.date.iso, basis: first.label, ambiguous: first.date.ambiguous, conflict: disagree.length > 0, others: disagree.map((s) => ({ iso: s.date.iso, basis: s.label })) };
  }

  const fiscalYear = (() => {
    for (const [src, label] of [[head, 'document text'], [clean(file), 'file name'], [link, 'link text'], [title, 'title']]) { const y = findFiscalYear(src); if (y) return { value: y, basis: label }; }
    return { value: null, basis: 'none' };
  })();

  const archiveOnly = record.sourceType === 'discovered-archive-copy';
  const readability = archiveOnly ? 'archive-only' : record.discovery?.partial ? 'partial' : text.trim().length >= 40 ? 'text' : (record.extractionNote && /fail/i.test(record.extractionNote)) ? 'failed' : record.extractionNote ? 'not-extracted' : 'no-text';

  const own = ownNumbers(title, text, type.value);
  const citations = findCitations(text.slice(0, 200000)).filter((c) => !own.includes(c.key));
  return {
    recordId: record.id, title, address: record.originalUrl || null, archiveAddress: record.archiveUrl || null, hash: record.fileHash || null,
    alsoFoundAt: record.discovery?.alsoFoundAt || [], type, body, date, fiscalYear, citations, ownNumbers: own, readability,
    retrievedAt: record.discovery?.retrievedAt || null,
    verified: type.basis === 'document text' && body.basis === 'document text' && date.basis === 'document text' && !date.ambiguous && !date.conflict
  };
}
