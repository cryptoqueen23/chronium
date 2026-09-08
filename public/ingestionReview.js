// Bulk ingestion + review-queue vocabulary and pure detection/validation
// logic (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 4). No DOM, no
// IndexedDB - same division of labor as entities.js/claims.js: this file
// decides what to SURFACE, public/db.js decides what to PERSIST and
// enforces existence, public/app.js and public/reviewQueue.js render it.
//
// THE CORE PRINCIPLE this file exists to protect: Chronium may surface
// candidates. It must never pick one automatically. findSubjectCandidates()
// below NEVER returns a single confirmed entity id - only a list of
// possibilities (length 1 = "one likely match, still needs confirming",
// length >1 = genuinely ambiguous, e.g. the Marc/Raymond Payne surname
// collision this project is named after avoiding). Nothing in this file
// creates an entityMention, a relationship, or a claim - those still only
// ever happen through the existing Phase 1-3 APIs, called by an explicit
// investigator action, never by the detector itself.

export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED'];
export const JOB_STATUS_LABELS = {
  QUEUED: 'Queued', RUNNING: 'Running', PAUSED: 'Paused', COMPLETED: 'Completed',
  COMPLETED_WITH_ERRORS: 'Completed with errors', FAILED: 'Failed', CANCELLED: 'Cancelled'
};

export const ITEM_STATUSES = ['PENDING', 'PROCESSING', 'READY_FOR_REVIEW', 'REVIEWED', 'FAILED', 'SKIPPED'];
export const ITEM_STATUS_LABELS = {
  PENDING: 'Pending', PROCESSING: 'Processing', READY_FOR_REVIEW: 'Ready for review',
  REVIEWED: 'Reviewed', FAILED: 'Failed', SKIPPED: 'Skipped (duplicate)'
};

// CONFIRMED/REJECTED are always an explicit investigator choice.
// AMBIGUOUS is set automatically ONLY as a starting state when a single
// text occurrence plausibly names more than one registered entity - it is
// never a resting state Chronium expects to stay in; the investigator
// resolves it to CONFIRMED (picking one) or REJECTED (neither).
export const CANDIDATE_STATES = ['UNREVIEWED', 'CONFIRMED', 'REJECTED', 'AMBIGUOUS'];
export const WATCHLIST_MATCH_STATES = ['UNREVIEWED', 'CONFIRMED', 'REJECTED'];

export const WATCHLIST_TYPES = ['word', 'phrase', 'entity', 'organization', 'contract_number', 'ordinance_number', 'address', 'vendor_id'];
export const WATCHLIST_TYPE_LABELS = {
  word: 'Word', phrase: 'Phrase', entity: 'Entity', organization: 'Organization',
  contract_number: 'Contract number', ordinance_number: 'Ordinance number', address: 'Address', vendor_id: 'Account/vendor ID'
};

function normalizeName(s) { return String(s ?? '').trim().replace(/\s+/g, ' '); }
function normalizeForSearch(s) { return normalizeName(s).toLowerCase(); }

export class IngestionValidationError extends Error {
  constructor(message) { super(message); this.name = 'IngestionValidationError'; }
}
export class WatchlistValidationError extends Error {
  constructor(message) { super(message); this.name = 'WatchlistValidationError'; }
}
export class ReviewCandidateValidationError extends Error {
  constructor(message) { super(message); this.name = 'ReviewCandidateValidationError'; }
}

export function validateWatchlistFields({ investigationId, term, type, notes } = {}) {
  if (!investigationId) throw new WatchlistValidationError('A watchlist entry must belong to an investigation.');
  const cleanTerm = normalizeName(term);
  if (!cleanTerm) throw new WatchlistValidationError('A watchlist entry requires a term.');
  const normType = type == null || type === '' ? 'word' : String(type).trim().toLowerCase();
  if (!WATCHLIST_TYPES.includes(normType)) {
    throw new WatchlistValidationError(`Unknown watchlist type "${type}". Must be one of: ${WATCHLIST_TYPES.join(', ')}.`);
  }
  return { investigationId, term: cleanTerm, termNormalized: normalizeForSearch(cleanTerm), type: normType, notes: normalizeName(notes || '') };
}

// Safety caps so one pathological document (a term repeated hundreds of
// times) can't blow up storage or freeze the scan - Phase 4 brief §17/18's
// "document obvious bottlenecks" instinct applied proactively. Each is a
// per-document, per-match-string limit, not a global one.
const MAX_OCCURRENCES_PER_MATCH_STRING = 5;
const MAX_CANDIDATES_PER_DOCUMENT = 200;
const MAX_WATCHLIST_MATCHES_PER_DOCUMENT = 200;
const SNIPPET_RADIUS = 120;

function snippetAround(text, offset, length) {
  const start = Math.max(0, offset - SNIPPET_RADIUS);
  const end = Math.min(text.length, offset + length + SNIPPET_RADIUS);
  const raw = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + raw + (end < text.length ? '…' : '');
}

// Finds every occurrence of `needle` in `haystackLower` (already
// lowercased), case-insensitively, up to the cap. Returns raw char offsets
// into the ORIGINAL text (needle.length is the same in both cases since
// this is a plain substring search, not regex).
function findOccurrences(haystackLower, needleLower, cap) {
  const offsets = [];
  let from = 0;
  while (offsets.length < cap) {
    const idx = haystackLower.indexOf(needleLower, from);
    if (idx < 0) break;
    offsets.push(idx);
    from = idx + needleLower.length;
  }
  return offsets;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && bStart < aEnd; }

// The last whitespace-separated token of a PERSON entity's name - a weak,
// deliberately fuzzy surname-like signal, used ONLY to surface a
// possible/ambiguous candidate, never to select one. "Raymond Payne" and
// "Marc Payne" both derive the token "payne" - if source text contains
// only the bare word "Payne" (no fuller registered name/alias matched at
// that location), this is exactly the case that must come back ambiguous.
function surnameToken(name) {
  const parts = normalizeForSearch(name).split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

// Detects possible subject occurrences in `text` against the
// investigation's already-registered entities (each with their aliases
// pre-joined by the caller, since alias lookup needs IndexedDB access
// this pure function doesn't have). Returns a list of candidate
// occurrences, each carrying ALL entities that could plausibly be meant -
// never a single pre-selected one.
//
// entities: [{ id, type, name, aliases: [string, ...] }]
export function findSubjectCandidates(text, entities) {
  if (!text || !entities?.length) return [];
  const textLower = text.toLowerCase();
  const strongRanges = []; // [{start, end}] - to exclude weak matches inside them
  const byOffsetKey = new Map(); // `${start}:${end}` -> candidate, so identical strings shared by 2+ entities merge into one ambiguous row

  // Strong pass: exact registered name/alias, verbatim.
  for (const entity of entities) {
    const matchStrings = [entity.name, ...(entity.aliases || [])].filter(Boolean);
    for (const matchString of matchStrings) {
      const needle = matchString.toLowerCase();
      if (!needle) continue;
      for (const offset of findOccurrences(textLower, needle, MAX_OCCURRENCES_PER_MATCH_STRING)) {
        const end = offset + matchString.length;
        strongRanges.push({ start: offset, end });
        const key = `${offset}:${end}`;
        const existing = byOffsetKey.get(key);
        if (existing) {
          if (!existing.candidateEntityIds.includes(entity.id)) existing.candidateEntityIds.push(entity.id);
        } else {
          byOffsetKey.set(key, {
            matchedText: text.slice(offset, end), offset, snippet: snippetAround(text, offset, matchString.length),
            candidateEntityIds: [entity.id], matchStrength: 'strong'
          });
        }
      }
    }
  }

  // Weak pass: bare surname token, PERSON entities only, skipped anywhere
  // it falls inside an already-found strong match (a full name match
  // already accounts for that occurrence - no need for a redundant weaker
  // one saying the same words are "possibly" that same person).
  const tokenToEntityIds = new Map();
  for (const entity of entities) {
    if (entity.type !== 'PERSON') continue;
    const token = surnameToken(entity.name);
    if (!token || token.length < 3) continue; // too short to be a meaningful signal on its own
    if (!tokenToEntityIds.has(token)) tokenToEntityIds.set(token, []);
    if (!tokenToEntityIds.get(token).includes(entity.id)) tokenToEntityIds.get(token).push(entity.id);
  }
  for (const [token, entityIds] of tokenToEntityIds) {
    for (const offset of findOccurrences(textLower, token, MAX_OCCURRENCES_PER_MATCH_STRING)) {
      const end = offset + token.length;
      // Word-boundary check so "payne" doesn't match inside "Champayne" -
      // cheap and worth it given this is the fuzzy pass.
      const before = offset > 0 ? text[offset - 1] : ' ';
      const after = end < text.length ? text[end] : ' ';
      if (/[a-z0-9]/i.test(before) || /[a-z0-9]/i.test(after)) continue;
      if (strongRanges.some((r) => rangesOverlap(offset, end, r.start, r.end))) continue;
      const key = `${offset}:${end}`;
      if (byOffsetKey.has(key)) continue; // already covered
      byOffsetKey.set(key, {
        matchedText: text.slice(offset, end), offset, snippet: snippetAround(text, offset, token.length),
        candidateEntityIds: [...entityIds], matchStrength: 'weak'
      });
    }
  }

  const all = [...byOffsetKey.values()].sort((a, b) => a.offset - b.offset);
  return all.slice(0, MAX_CANDIDATES_PER_DOCUMENT).map((c) => ({
    ...c,
    // A single-entity result still requires confirmation (never
    // auto-assigned) - AMBIGUOUS is reserved for when there is genuinely
    // more than one registered entity this text could be naming.
    initialState: c.candidateEntityIds.length > 1 ? 'AMBIGUOUS' : 'UNREVIEWED'
  }));
}

// Watchlist matching - investigator-defined terms, no entity-selection
// ambiguity involved (a keyword either occurs or it doesn't), so this is
// simpler than subject-candidate detection. Never itself creates a
// Finding - see the file header.
//
// watchlistTerms: [{ id, termNormalized, term }]
export function findWatchlistMatches(text, watchlistTerms) {
  if (!text || !watchlistTerms?.length) return [];
  const textLower = text.toLowerCase();
  const out = [];
  for (const w of watchlistTerms) {
    if (!w.termNormalized) continue;
    for (const offset of findOccurrences(textLower, w.termNormalized, MAX_OCCURRENCES_PER_MATCH_STRING)) {
      if (out.length >= MAX_WATCHLIST_MATCHES_PER_DOCUMENT) return out;
      out.push({
        watchlistId: w.id, matchedText: text.slice(offset, offset + w.term.length), offset,
        snippet: snippetAround(text, offset, w.term.length)
      });
    }
  }
  return out.sort((a, b) => a.offset - b.offset);
}
