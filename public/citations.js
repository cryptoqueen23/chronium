// Deterministic citation formatting over already-stored source metadata.
// docs/CANON.md: citations must never be invented by AI - a missing field
// renders using that style's own real "no data" convention (APA "(n.d.)",
// MLA/Chicago "n.d.", legal "[date not available]"), never fabricated.
// Every formatted citation carries the source record's id so it stays
// traceable back to the exact record it came from.

// Works on both investigation records (biblio.* fields, set by the
// researcher) and not-yet-saved Discover Sources hits (no biblio object
// at all yet - falls back to whatever the discovery result itself
// carries: captureDate, source/provider name). Citing a discovered
// source never requires saving it first (explicit product requirement) -
// this is what makes that true without a separate code path.
function fieldsOf(record) {
  const b = record.biblio || {};
  return {
    title: (record.title || record.originalUrl || 'Untitled source').trim(),
    publisher: (b.publisher || b.sourceType || record.source || '').trim(),
    sourceType: (b.sourceType || '').trim(),
    pubDate: String(b.publicationDate || record.captureDate || '').trim(),
    url: record.originalUrl || record.currentUrl || record.archiveUrl || '',
    retrievedAt: record.addedAt || record.savedAt || record.captureDate || null,
    sourceId: record.sourceId || record.id
  };
}

function formatRetrieved(retrievedAt) {
  if (!retrievedAt) return '';
  const d = new Date(retrievedAt);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function yearOf(pubDate) {
  if (!pubDate) return 'n.d.';
  const m = pubDate.match(/\d{4}/);
  return m ? m[0] : pubDate;
}

function apa(record) {
  const f = fieldsOf(record);
  const author = f.publisher || f.sourceType || 'Unknown author';
  const retrieved = formatRetrieved(f.retrievedAt);
  const retrievedClause = retrieved && f.url ? ` Retrieved ${retrieved}, from ${f.url}` : (f.url ? ` ${f.url}` : '');
  return `${author}. (${yearOf(f.pubDate)}). ${f.title}.${retrievedClause}`.trim();
}

function mla(record) {
  const f = fieldsOf(record);
  const publisher = f.publisher || 'n.p.';
  const date = f.pubDate || 'n.d.';
  const urlPart = f.url ? `, ${f.url.replace(/^https?:\/\//, '')}` : '';
  return `"${f.title}." ${publisher}, ${date}${urlPart}.`;
}

function chicago(record) {
  const f = fieldsOf(record);
  const publisher = f.publisher || 'n.p.';
  const date = f.pubDate || 'n.d.';
  const accessed = formatRetrieved(f.retrievedAt);
  const accessedClause = accessed ? ` Accessed ${accessed}.` : '';
  const urlClause = f.url ? ` ${f.url}.` : '';
  return `${publisher}. "${f.title}." ${date}.${accessedClause}${urlClause}`;
}

function legal(record) {
  const f = fieldsOf(record);
  const publisher = f.publisher || 'source publisher not recorded';
  const date = f.pubDate || '[date not available]';
  const urlClause = f.url ? `, ${f.url}` : '';
  return `${f.title}, ${publisher} (${date})${urlClause} [Chronium source ${f.sourceId}].`;
}

const STYLE_FNS = { apa, mla, chicago, turabian: chicago, legal };

export const CITATION_STYLES = ['apa', 'mla', 'chicago', 'turabian', 'legal'];
export const CITATION_STYLE_LABELS = { apa: 'APA', mla: 'MLA', chicago: 'Chicago', turabian: 'Turabian', legal: 'Legal/source-style' };

export function formatCitation(record, style = 'apa', location = '') {
  const key = STYLE_FNS[style] ? style : 'apa';
  let text = STYLE_FNS[key](record);
  // Page/passage-level locator, when the evidence that prompted this
  // citation carries one (e.g. an Evidence Item's "p.12") - appended
  // uniformly before the trailing period, never invented if absent.
  if (location) text = text.replace(/\.\s*$/, '') + `, ${location}.`;
  return { style: key, text, recordId: record.id, sourceId: record.sourceId || record.id };
}

export function formatInlineCitation(record, style = 'apa') {
  const f = fieldsOf(record);
  if (style === 'legal') return `(${f.sourceId})`;
  if (style === 'mla' || style === 'chicago' || style === 'turabian') return `(${f.publisher || f.title.slice(0, 30)})`;
  return `(${f.publisher || f.sourceType || f.title.slice(0, 30)}, ${yearOf(f.pubDate)})`;
}

// Numbered footnotes/endnotes over a list of records, in first-appearance
// order, deduped by record id - Product Principles #14 ("Footnotes" as a
// distinct output) and #3 ("Never Lose the Receipt": every footnote still
// carries recordId/sourceId via formatCitation). `locationOf(record)` is
// an optional accessor for a per-record page/passage locator.
export function buildFootnotes(records, style = 'chicago', locationOf = () => '') {
  const seen = new Map();
  const list = [];
  (records || []).forEach((r) => {
    if (!r || seen.has(r.id)) return;
    const number = list.length + 1;
    seen.set(r.id, number);
    list.push({ number, recordId: r.id, ...formatCitation(r, style, locationOf(r) || '') });
  });
  return { numberOf: (id) => seen.get(id) || null, list };
}
