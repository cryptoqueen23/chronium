// Records Recovery: reading a records request (the text a person sent, or intends to send) into a list of
// requested items they can correct. Deterministic: no AI, no network. Every field says what words it came from
// and how sure the reading is; anything that cannot be understood stays as free text marked "requires review".
// Pure module.
import { findDates, findBody, findFiscalYear, findCitations } from './facts.js';
import { RULES } from '../discovery/classify.js';

export const REQUEST_TYPES = ['agenda', 'minutes', 'packet', 'budget', 'audit', 'check-register', 'contract', 'ordinance', 'resolution', 'other'];
export const TYPE_LABEL = Object.freeze({ agenda: 'Agenda', minutes: 'Minutes', packet: 'Agenda packet or attachments', budget: 'Budget', audit: 'Audit or financial report', 'check-register': 'Check register or expenditure report', contract: 'Contract or agreement', ordinance: 'Ordinance', resolution: 'Resolution', other: 'Other record (not classified)' });

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON_RE = '(january|february|march|april|may|june|july|august|september|october|november|december)';
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// Date-like expressions in order, each with a start and end (a year covers the whole year, a month the whole month).
export function findPeriods(text) {
  const s = String(text || '');
  const found = [];
  let m;
  for (const d of findDates(s)) found.push({ index: d.index, start: d.iso, end: d.iso, kind: 'date', ambiguous: d.ambiguous });
  const taken = found.map((f) => f.index);
  const monthYear = new RegExp(`\\b${MON_RE}\\s+(\\d{4})\\b(?!\\s*,?\\s*\\d)`, 'gi');
  while ((m = monthYear.exec(s))) {
    if (found.some((f) => Math.abs(f.index - m.index) < 14 && f.kind === 'date')) continue;
    const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1; const y = Number(m[2]);
    found.push({ index: m.index, start: `${y}-${pad(mo)}-01`, end: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}`, kind: 'month' });
  }
  const year = /\b((?:19|20)\d{2})\b/g;
  while ((m = year.exec(s))) {
    if (found.some((f) => m.index >= f.index - 1 && m.index <= f.index + 24 && f.kind !== 'year')) continue;
    if (/^fy\s?$/i.test(s.slice(Math.max(0, m.index - 3), m.index)) || /fiscal year\s+$/i.test(s.slice(Math.max(0, m.index - 14), m.index))) continue;
    found.push({ index: m.index, start: `${m[1]}-01-01`, end: `${m[1]}-12-31`, kind: 'year' });
  }
  return found.sort((a, b) => a.index - b.index);
}

// Types named in a segment, in order of appearance (a segment can ask for minutes AND agendas).
function typesIn(s) {
  const low = s.toLowerCase().replace(/\b(budget|audit|contract|ordinance|resolution|agenda|packet|agreement|register|acfr)s\b/g, '$1');
  const hits = [];
  for (const [cls, re] of RULES) { const m = re.exec(low); if (m) hits.push({ cls, index: m.index }); }
  hits.sort((a, b) => a.index - b.index);
  const seen = new Set(); const out = [];
  for (const h of hits) { if (!seen.has(h.cls)) { seen.add(h.cls); out.push(h.cls); } }
  return out;
}

const SKIP_LINE = /^(dear|to whom|sincerely|regards|thank|respectfully|pursuant|under the|this is a request|i am writing|please (?:send|provide|produce|respond)|i request|i would like|my name|date:|re:|subject:)/i;

export function splitRequest(text) {
  const lines = String(text || '').split(/\r?\n/);
  const segs = [];
  for (const raw of lines) {
    const bullet = /^\s*(?:\d{1,2}[.)]|[a-z][.)]|[-*•])\s+/i.test(raw);
    const line = raw.replace(/^\s*(?:\d{1,2}[.)]|[a-z][.)]|[-*•])\s+/i, '').trim();
    if (line.length < 4) continue;
    const parts = line.length > 240 ? line.split(/;\s+|(?<=\.)\s+(?=[A-Z])/) : [line];
    for (const p of parts) { const t = p.trim(); if (t.length >= 4) segs.push({ text: t, bullet }); }
  }
  return segs;
}

let counter = 0;
const newId = (n) => `item-${n}`;

export function parseRequest(text) {
  counter = 0;
  const items = []; const ignored = [];
  for (const seg of splitRequest(text)) {
    const s = seg.text;
    const cites = findCitations(s);
    let types = typesIn(s);
    const body = findBody(s);
    const periods = findPeriods(s);
    const fy = findFiscalYear(s);
    const quantifier = /\b(all|each|every)\b/i.test(s) ? 'all' : null;
    if (!types.length && !cites.length) {
      if (seg.bullet || periods.length || body) {
        items.push({ id: newId(++counter), text: s, type: null, body: body || null, dateFrom: null, dateTo: null, fiscalYear: fy || null, citationKey: null, quantifier, confidence: 'requires-review', notes: ['The kind of record could not be read from these words. Choose one, or leave it for review.'], edited: false });
      } else ignored.push(s);
      continue;
    }
    // Period: two expressions joined by a range word make a range; one makes itself; "since" leaves the end open.
    let dateFrom = null; let dateTo = null; const notes = [];
    if (periods.length >= 2 && /\b(to|through|thru|until|and|-|–)\b/i.test(s.slice(periods[0].index, periods[1].index + 1)) && !periods[0].ambiguous && !periods[1].ambiguous) {
      dateFrom = periods[0].start < periods[1].start ? periods[0].start : periods[1].start;
      dateTo = periods[0].end > periods[1].end ? periods[0].end : periods[1].end;
    } else if (periods.length >= 1) {
      dateFrom = periods[0].start; dateTo = /\bsince\b/i.test(s.slice(Math.max(0, periods[0].index - 12), periods[0].index)) ? null : periods[0].end;
      if (periods[0].ambiguous) notes.push('A numeric date could be read two ways; it was read month first. Check it.');
      if (periods.length > 2) notes.push('More than two dates appear; the first was used. Check the period.');
    }
    if (cites.length) {
      for (const c of cites) items.push({ id: newId(++counter), text: s, type: c.kind, body: body || null, dateFrom: null, dateTo: null, fiscalYear: null, citationKey: c.key, quantifier: null, confidence: 'read', notes: [`Read as ${c.kind} number ${c.number}.`], edited: false });
      continue;
    }
    if (types.length > 1) notes.push('This line names more than one kind of record; it was split into one item for each.');
    for (const t of types) {
      const conf = (dateFrom || fy) && body ? 'read' : (dateFrom || fy || body) ? 'inferred' : 'requires-review';
      const n = [...notes];
      if (!dateFrom && !fy) n.push('No date or period was found; all held records of this kind will be listed.');
      if (!body) n.push('No agency or body was named; any body will match.');
      items.push({ id: newId(++counter), text: s, type: t, body: body || null, dateFrom, dateTo, fiscalYear: fy || null, citationKey: null, quantifier, confidence: conf, notes: n, edited: false });
    }
  }
  return { items, ignored };
}

// ---- user correction (pure helpers; the screen calls these and saves the result) ----
const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export function normalizeItem(raw) {
  const it = { id: raw.id, text: String(raw.text || '').slice(0, 600), type: REQUEST_TYPES.includes(raw.type) ? raw.type : null, body: raw.body ? String(raw.body).toLowerCase().trim().slice(0, 80) : null, dateFrom: isIso(raw.dateFrom) ? raw.dateFrom : null, dateTo: isIso(raw.dateTo) ? raw.dateTo : null, fiscalYear: Number.isInteger(raw.fiscalYear) ? raw.fiscalYear : null, citationKey: raw.citationKey ? String(raw.citationKey).slice(0, 60) : null, quantifier: raw.quantifier === 'all' ? 'all' : null, confidence: raw.confidence || 'read', notes: Array.isArray(raw.notes) ? raw.notes.slice(0, 6) : [], edited: !!raw.edited };
  if (it.dateFrom && it.dateTo && it.dateFrom > it.dateTo) { const t = it.dateFrom; it.dateFrom = it.dateTo; it.dateTo = t; it.notes = [...it.notes, 'The two dates were in the wrong order and were swapped.']; }
  return it;
}
export function updateItem(items, id, patch) { return items.map((it) => (it.id === id ? normalizeItem({ ...it, ...patch, edited: true, confidence: 'read' }) : it)); }
export function removeItem(items, id) { return items.filter((it) => it.id !== id); }
export function addItem(items, patch = {}) {
  const n = items.reduce((m, it) => Math.max(m, Number(String(it.id).replace(/\D/g, '')) || 0), 0) + 1;
  return [...items, normalizeItem({ id: newId(n), text: '', ...patch, edited: true, confidence: 'read' })];
}
