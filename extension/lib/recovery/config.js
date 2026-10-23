// Records Recovery: settings, the required notice, and the words this module may not use.
// Pure module (no DOM, no storage, no network).
//
// The central rule: a gap in Chronium's evidence inventory is not necessarily a gap in the government's
// records, or in its response to a public information request. Everything generated here says so.

export const RECOVERY_VERSION = '0.1.0';

export const NOTICE = 'This list describes what this case holds. It is not a statement about what the government holds, and a gap here is not evidence that the government lacks a record or that a request was handled wrongly.';

export const DEFAULT_OPTIONS = Object.freeze({
  cadenceMinDocuments: 4,      // initial heuristic; the person can change it (3 to 12) and it is saved with the case
  cadenceMinDensity: 0.6,      // share of expected dates in the held range that must be held before a cadence is trusted
  cadenceOnLatticeShare: 0.8,  // share of dated documents that must sit on the cadence
  dateToleranceDays: 3,        // a document within this many days of an expected date counts as that date
  recentMeetingDays: 45        // the newest agenda dates this close to the newest document may simply not have minutes yet
});

const LIMITS = { cadenceMinDocuments: [3, 12], cadenceMinDensity: [0.3, 0.95], cadenceOnLatticeShare: [0.5, 1], dateToleranceDays: [0, 7], recentMeetingDays: [0, 120] };

export function resolveOptions(overrides = {}) {
  const out = { ...DEFAULT_OPTIONS };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    if (!Object.prototype.hasOwnProperty.call(overrides, k)) continue;
    const v = Number(overrides[k]);
    if (Number.isFinite(v)) out[k] = Math.min(Math.max(k === 'cadenceMinDocuments' || k === 'dateToleranceDays' || k === 'recentMeetingDays' ? Math.floor(v) : v, lo), hi);
  }
  return Object.freeze(out);
}

// Words that must never appear in generated text (the tests scan every string). Phrases that would claim a
// record does not exist, or attribute fault or motive to an agency, are refused.
export const BANNED_PATTERNS = [
  /\bdoes not exist\b/i, /\bdoesn't exist\b/i, /\bno such (record|document)s?\b/i, /\bnever existed\b(?!\.)/i,
  /\bfailed to (produce|provide|respond|release|disclose)\b/i, /\brefused to (produce|provide|release|disclose)\b/i, /\bdid not respond\b/i,
  /\bwithheld\b/i, /\bwithholding\b/i, /\bhidden\b/i, /\bhiding\b/i, /\bsuspicious\b/i, /\bdeleted\b/i, /\bdestroyed\b/i, /\bcover[- ]?up\b/i,
  /\bnon-?complian/i, /\bviolat(ion|ed|es|ing)\b/i, /\bshould have (been|produced|provided|existed)\b/i, /\bwas required to\b/i, /\bunlawful/i, /\billegal/i,
  /\bmissing\b/i
];
// "missing" is banned as a verdict. The one allowed use is the person's own recorded words, which are quoted
// inside quotation marks and attributed to them; generated sentences never use it.

export function bannedWordsIn(text) {
  return BANNED_PATTERNS.filter((re) => re.test(String(text))).map((re) => re.source);
}

// Words the report uses for what a case does not hold.
export const STATUS_LABEL = Object.freeze({
  located: 'Located in this case',
  partly: 'Partly located in this case',
  review: 'Possible match, requires review',
  'not-held': 'Not held in this case',
  'cannot-assess': 'Cannot assess automatically, requires review'
});

export const ITEM_STATUS_LABEL = Object.freeze({
  open: 'Open',
  'closed-by-match': 'Closed: matching record located',
  'closed-by-review': 'Closed by a reviewer',
  acknowledged: 'Acknowledged, still open',
  'not-applicable': 'Marked not applicable by a reviewer',
  review: 'Requires review'
});

export const DETECTORS = Object.freeze({
  G1: { id: 'G1', title: 'Agenda and minutes pairs', basis: 'Pairing-based' },
  G2: { id: 'G2', title: 'Recurring series: dates with no document', basis: 'Pattern-based' },
  G3: { id: 'G3', title: 'Annual documents: years with no document', basis: 'Pattern-based' },
  G4: { id: 'G4', title: 'Linked in a search, not retrieved', basis: 'Search-based' },
  G5: { id: 'G5', title: 'Cited by a document in this case, not held', basis: 'Citation-based' },
  G6: { id: 'G6', title: 'Held, cannot be searched yet', basis: 'Inventory-based' },
  G7: { id: 'G7', title: 'Limits of the searches made', basis: 'Search-based' },
  G8: { id: 'G8', title: 'Changed between retrievals (information only)', basis: 'Comparison-based' }
});
