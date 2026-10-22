// Ask Chronium: deterministic question router over ONE investigation's
// existing data. No AI, no network, no second database - it reads the same
// structures the rest of Chronium writes (sources, evidence passages,
// subjects, relationships, claims + evidence links + findings, review
// queue) from a snapshot (see readInvestigationForExport in portableDb.js).
//
// Contract: answerQuestion(question, snapshot, context) returns either
//   null                      - not an investigative-intent question; the
//                               caller falls back to ranked document search
//   an Answer object          - see below
// An Answer never states a conclusion without sources, never invents an
// amount/vote/identity/relationship, says what is missing, and asks for
// clarification instead of guessing when several events/people could match.
//
// Answer = {
//   intent, title, state, summary,           // state: see STATES
//   items: [{ heading, body, sources: [Source], note }],
//   missing: [string],                       // what the records do not establish
//   searched: string,                        // what was actually looked at
//   clarification: null | { question, options: [{ label, followUp }] },
//   context: { ... }                         // carried into the next question
// }
// Source = { recordId, sourceId, title, url, archiveUrl, date, location, excerpt, hash }

export const STATES = {
  DOCUMENTED_FACT: 'Documented fact',
  SUPPORTED_INFERENCE: 'Supported inference',
  ALLEGATION: 'Allegation',
  UNRESOLVED_QUESTION: 'Unresolved',
  NO_EVIDENCE_LOCATED: 'No evidence located',
  COMPUTED: 'Computed from your records',
  NEEDS_CLARIFICATION: 'Needs clarification'
};

const MAX_ITEMS = 12;
const MAX_OPTIONS = 8;

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}$.\- ]+/gu, ' ').replace(/\s+/g, ' ').trim();
// Matching form that ignores "No." in "Ordinance No. 2024-31".
const loose = (s) => norm(s).replace(/\bno\.? ?(?=\d)/g, '');
const clip = (s, n = 260) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const textOf = (r) => `${r.extractedText || ''}`;

const SENTENCE_OPENERS = new Set(['what', 'who', 'whom', 'which', 'where', 'when', 'why', 'how', 'did', 'does', 'do', 'is', 'are', 'was', 'were', 'show', 'find', 'list', 'tell', 'give', 'compare', 'has', 'have', 'can', 'could', 'please', 'any', 'all', 'every']);
const NOISE_WORDS = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'for', 'to', 'at', 'by', 'with', 'and', 'or', 'me', 'my', 'we', 'us', 'our', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'that', 'this', 'these', 'those', 'there', 'about', 'from', 'into', 'than', 'then',
  'all', 'any', 'every', 'each', 'some', 'show', 'find', 'list', 'tell', 'give', 'get', 'see', 'look', 'what', 'who', 'whom', 'which', 'where', 'when', 'why', 'how', 'did', 'does', 'do', 'has', 'have', 'had', 'can', 'could', 'please',
  'record', 'records', 'document', 'documents', 'source', 'sources', 'evidence', 'involving', 'involve', 'mentioning', 'mention', 'mentions', 'connected', 'connection', 'connections', 'relating', 'related', 'regarding',
  'payment', 'payments', 'paid', 'pay', 'vendor', 'vendors', 'money', 'repeatedly', 'frequently', 'often', 'appear', 'appears', 'appeared', 'changed', 'change', 'before', 'after', 'vote', 'voted', 'votes', 'organizations', 'organization', 'people', 'person', 'names']);

// The topic of a question: quoted text first, then runs of capitalised words
// and identifiers (Ordinance 2026-29, Holt Construction LLC, EDC), then
// whatever content words remain.
export function subjectPhrases(question) {
  const q = String(question || '');
  const out = [];
  for (const m of q.matchAll(/"([^"]{2,80})"/g)) out.push(m[1].trim());
  const words = q.replace(/[?!,;:()]/g, ' ').split(/\s+/).filter(Boolean);
  let run = [];
  const flush = () => { if (run.length) { out.push(run.join(' ')); run = []; } };
  words.forEach((w, i) => {
    const bare = w.replace(/[.'’]s$/, '').replace(/\.$/, '');
    const lower = bare.toLowerCase();
    const isCap = /^[A-Z][\p{L}&'-]*$/u.test(bare) && !(i === 0 && SENTENCE_OPENERS.has(lower)) && !SENTENCE_OPENERS.has(lower);
    const isId = /^\d{2,4}-\d+$/.test(bare) || /^(No\.?|#)$/i.test(bare) || /^[A-Z]{2,}[-\d]+$/.test(bare);
    if (isCap || (run.length && isId)) run.push(bare); else flush();
  });
  flush();
  const seen = new Set();
  const phrases = out.map((p) => p.replace(/\s+(No\.?|#)\s*$/i, '').trim()).filter((p) => p && !NOISE_WORDS.has(p.toLowerCase()) && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
  if (phrases.length) return phrases;
  const content = norm(q).split(' ').filter((w) => w.length > 2 && !NOISE_WORDS.has(w));
  return content.length ? [content.join(' ')] : [];
}

function occurrences(haystackLower, needleLower, max = 400) {
  const out = [];
  if (!needleLower) return out;
  let i = haystackLower.indexOf(needleLower);
  while (i !== -1 && out.length < max) { out.push(i); i = haystackLower.indexOf(needleLower, i + needleLower.length); }
  return out;
}

// ---------------------------------------------------------------------------
// Snapshot indexes
// ---------------------------------------------------------------------------
function indexSnapshot(snap) {
  const records = snap.records || [];
  const recordById = new Map(records.map((r) => [r.id, r]));
  const evidenceById = new Map((snap.evidenceItems || []).map((e) => [e.id, e]));
  const entityById = new Map((snap.entities || []).map((e) => [e.id, e]));
  const aliasesByEntity = new Map();
  for (const a of snap.entityAliases || []) {
    if (!aliasesByEntity.has(a.entityId)) aliasesByEntity.set(a.entityId, []);
    aliasesByEntity.get(a.entityId).push(a.alias);
  }
  return { snap, records, recordById, evidenceById, entityById, aliasesByEntity };
}

const dateRe = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const longDateRe = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
// The document's own date when it can be read (file name, then body); the
// archive capture date otherwise. Returns ISO yyyy-mm-dd or null.
export function documentDate(r) {
  const fromName = String(r.title || r.filePath || '').match(dateRe);
  if (fromName) return fromName[0];
  const body = textOf(r).slice(0, 4000);
  const iso = body.match(dateRe);
  if (iso) return iso[0];
  const long = body.match(longDateRe);
  if (long) return `${long[3]}-${String(MONTHS.indexOf(long[1].toLowerCase()) + 1).padStart(2, '0')}-${String(long[2]).padStart(2, '0')}`;
  const cap = r.publicationDate || r.captureDate;
  if (cap) { const d = new Date(cap); if (!isNaN(d)) return d.toISOString().slice(0, 10); }
  return null;
}

function sourceFor(ix, record, { excerpt = '', location = '' } = {}) {
  return {
    recordId: record.id, sourceId: record.sourceId || null, title: record.title || record.originalUrl || 'Untitled source',
    url: record.originalUrl || null, archiveUrl: record.archiveUrl || null, date: documentDate(record),
    location: location || '', excerpt: clip(excerpt, 300), hash: record.fileHash || null
  };
}
function sourceForEvidence(ix, ev) {
  const rec = ix.recordById.get(ev.sourceRecordId);
  if (!rec) return { recordId: null, sourceId: null, title: 'Source no longer in this case', url: null, archiveUrl: null, date: null, location: ev.location || '', excerpt: clip(ev.excerptText, 300), hash: null };
  return sourceFor(ix, rec, { excerpt: ev.excerptText, location: ev.location });
}

// Passages of `phrase` in a record's text, with surrounding context.
function passagesIn(record, phraseLower, radius = 140, max = 2) {
  const text = textOf(record);
  const lower = text.toLowerCase();
  return occurrences(lower, phraseLower, max).map((i) => text.slice(Math.max(0, i - radius), Math.min(text.length, i + phraseLower.length + radius)));
}
function recordsContaining(ix, phraseLower) {
  const out = [];
  for (const r of ix.records) {
    const hay = `${r.title || ''} ${textOf(r)}`.toLowerCase();
    if (hay.includes(phraseLower)) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Identity: who does a name in the question refer to?
// Full registered name or alias = verified-by-registration. A first-name
// variant ("Ray Payne") or a bare surname is NEVER treated as verified:
// it yields a possible match with a caveat, or a clarification when several
// people share the surname.
// ---------------------------------------------------------------------------
export function resolveSubject(ix, question) {
  const qn = ` ${norm(question)} `;
  const people = (ix.snap.entities || []);
  const exact = [];
  for (const e of people) {
    const names = [e.name, ...(ix.aliasesByEntity.get(e.id) || [])].filter(Boolean);
    if (names.some((n) => qn.includes(` ${norm(n)} `))) exact.push(e);
  }
  if (exact.length) return { status: 'registered', entities: exact, caveat: null };

  const qTokens = norm(question).split(' ').filter((t) => t.length > 2);
  const surnameHits = new Map();
  for (const e of people.filter((p) => p.type === 'PERSON')) {
    const parts = norm(e.name).split(' ');
    const sur = parts[parts.length - 1];
    const first = parts[0];
    if (!qTokens.includes(sur)) continue;
    const hasFirstPrefix = qTokens.some((t) => t !== sur && (first.startsWith(t) || t.startsWith(first.slice(0, 3))));
    surnameHits.set(e.id, { entity: e, firstNameAlsoMatches: hasFirstPrefix });
  }
  const hits = [...surnameHits.values()];
  if (!hits.length) return { status: 'none', entities: [], caveat: null };
  if (hits.length > 1) {
    const narrowed = hits.filter((h) => h.firstNameAlsoMatches);
    if (narrowed.length === 1) {
      return { status: 'possible', entities: [narrowed[0].entity], caveat: `The question says a shortened or different name; Chronium is treating it as a possible match for ${narrowed[0].entity.name}. This is not a verified identity.` };
    }
    return { status: 'ambiguous', entities: hits.map((h) => h.entity), caveat: null };
  }
  const only = hits[0];
  return {
    status: 'possible', entities: [only.entity],
    caveat: only.firstNameAlsoMatches
      ? `The question uses a shortened or different form of the name; Chronium is treating it as a possible match for ${only.entity.name}. This is not a verified identity.`
      : `Only a surname matched ${only.entity.name}. A shared surname does not show it is the same person, so this is not a verified identity.`
  };
}

function clarifyPerson(subject, followUpFor) {
  return {
    intent: 'clarify-person', title: 'Which person do you mean?', state: 'NEEDS_CLARIFICATION',
    summary: 'More than one registered person could match this name. Chronium will not guess.',
    items: [], missing: [], searched: 'Registered subjects in this case.',
    clarification: { question: 'Choose the person you mean:', options: subject.entities.slice(0, MAX_OPTIONS).map((e) => ({ label: e.name, followUp: followUpFor(e) })) },
    context: {}
  };
}

// ---------------------------------------------------------------------------
// Intent routing
// ---------------------------------------------------------------------------
const RULES = [
  { intent: 'progress', test: (q) => /\b(haven'?t|have not|not (yet )?|still (need|have|to)).{0,12}review|\bunreviewed\b|\bleft to review\b|\bwhat('?s| is) (still )?(missing|unresolved|outstanding|left)\b|\bmissing (records?|evidence|documents?)\b|\bwhat (evidence|records?|documents?).{0,20}missing\b|\binvestigation (gaps?|progress)\b|\bwhat('?s| is) next\b/.test(q) },
  { intent: 'claims-contradicted', test: (q) => /\bwhich claims?\b.{0,40}\b(contradict|conflict|disput|refut)|\bclaims? (with|that have|having) (contradict|conflict)|\bcontradictory (evidence|claims?)\b|\bconflicting (claims?|records?|evidence)\b/.test(q) },
  { intent: 'claim-evidence', test: (q) => /\b(evidence|records?|documents?|sources?|passages?)\b.{0,40}\b(contradict|disprove|conflict|refute|against|support|back up|confirm)|\bwhat (contradicts|supports|disproves|confirms)\b|\b(contradict|support)(s|ing)? (that|this|the) claim\b/.test(q) },
  { intent: 'before-after', test: (q) => /\bbefore and after\b|\bwhat changed\b|\bchanged (before|after|since|between)\b|\bdifference between\b|\bcompare .{1,60}\b(with|to|and)\b.{0,30}\b(19|20)\d\d\b|\bsince the vote\b|\bafter the (vote|decision|meeting)\b|\bbefore the (vote|decision|meeting)\b/.test(q) },
  { intent: 'relationships', test: (q) => /\b(connected|connections?|related|relationships?|associated|affiliated|linked|links?) (to|with|between)?\b|\bevidence for (each|every|all) (connection|relationship|link)|\bwhich (organi[sz]ations?|businesses|companies|officials|people)\b.{0,40}\b(connected|related|linked|tied)/.test(q) },
  { intent: 'frequency', test: (q) => /\brepeatedly\b|\bfrequently\b|\bmost often\b|\bhow often\b|\bwho (keeps|appears|shows up)\b|\btop (names|people|vendors)\b|\brecurring\b/.test(q) },
  { intent: 'financial', test: (q) => /\bpayments?\b|\bpaid\b|\bvendors?\b|\binvoices?\b|\bchecks?\b|\bwarrants?\b|\bdisbursements?\b|\bspen[dt]\b|\bspending\b|\bexpenditures?\b|\bbudgets?\b|\bgrants?\b|\bcontracts?\b|\bbonds?\b|\bfund transfers?\b|\bhow much\b|\bmoney\b|\bfunds?\b/.test(q) },
  { intent: 'decision', test: (q) => /\bwho voted\b|\bhow did .{1,40} vote\b|\bvoted (for|against|to)\b|\bwhat did (the )?(council|board|commission)\b.{0,30}\b(decide|approve|vote)/.test(q) },
  { intent: 'verify', test: (q) => /^(did|does|was|were|is|are|has|have|had)\b/.test(q.trim()) }
];

export function routeQuestion(question) {
  const q = String(question || '').toLowerCase().trim();
  if (!q) return { intent: 'empty' };
  for (const r of RULES) if (r.test(q)) return { intent: r.intent };
  return { intent: 'discovery' };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export function answerQuestion(question, snapshot, context = {}) {
  const route = routeQuestion(question);
  if (route.intent === 'empty' || route.intent === 'discovery') return null;
  const ix = indexSnapshot(snapshot);
  const handler = HANDLERS[route.intent];
  if (!handler) return null;
  const answer = handler(ix, question, context || {});
  return answer ? { ...answer, intent: answer.intent || route.intent } : null;
}

const HANDLERS = {
  'progress': answerProgress,
  'claims-contradicted': answerClaimsContradicted,
  'claim-evidence': answerClaimEvidence,
  'before-after': answerBeforeAfter,
  'relationships': answerRelationships,
  'frequency': answerFrequency,
  'financial': answerFinancial,
  'decision': answerDecision,
  'verify': answerVerify
};

const emptyCase = (ix) => ix.records.length === 0 && (ix.snap.evidenceItems || []).length === 0 && (ix.snap.claims || []).length === 0;
function noDataAnswer(intent, what) {
  return {
    intent, title: 'There is nothing to search yet', state: 'NO_EVIDENCE_LOCATED',
    summary: 'This case has no saved sources, evidence, or claims yet, so there is nothing to answer from.',
    items: [], missing: [`Add documents or save sources to this case, then ask again about ${what}.`], searched: 'Nothing: the case is empty.', clarification: null, context: {}
  };
}

// ---------------------------------------------------------------------------
// Claims and contradictions
// ---------------------------------------------------------------------------
function claimLinks(ix, claim) {
  return (ix.snap.claimEvidence || []).filter((l) => l.claimId === claim.id);
}
function claimItem(ix, claim, stances = ['supports', 'contradicts', 'contextualizes']) {
  const links = claimLinks(ix, claim).filter((l) => stances.includes(l.stance));
  const sources = links.map((l) => {
    const ev = ix.evidenceById.get(l.evidenceId);
    return ev ? { ...sourceForEvidence(ix, ev), stance: l.stance } : null;
  }).filter(Boolean);
  const finding = (ix.snap.claimFindings || []).filter((f) => f.claimId === claim.id).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  return {
    heading: `${claim.claimId || 'Claim'}: ${claim.text}`,
    body: `Status: ${String(claim.status || 'UNVERIFIED').toLowerCase().replace(/_/g, ' ')}.${finding ? ` Finding: ${finding.conclusion} (${STATES[finding.classification] || finding.classification}).` : ' No finding recorded yet.'}`,
    sources, claimId: claim.id,
    state: finding ? finding.classification : 'UNRESOLVED_QUESTION'
  };
}

function answerClaimsContradicted(ix) {
  const claims = ix.snap.claims || [];
  if (!claims.length) return noDataAnswer('claims-contradicted', 'claims');
  const hit = claims.filter((c) => claimLinks(ix, c).some((l) => l.stance === 'contradicts') || ['CONTRADICTED', 'REFUTED'].includes(c.status));
  if (!hit.length) {
    return {
      title: 'No claims have contradicting evidence recorded', state: 'NO_EVIDENCE_LOCATED',
      summary: `None of the ${claims.length} claim${claims.length === 1 ? '' : 's'} in this case has evidence linked as contradicting it.`,
      items: [], missing: ['This only reflects evidence that has been linked to claims. It does not show that no contradicting records exist.'],
      searched: `${claims.length} claims and their linked evidence.`, clarification: null, context: {}
    };
  }
  return {
    title: `${hit.length} claim${hit.length === 1 ? ' has' : 's have'} contradicting evidence`, state: 'DOCUMENTED_FACT',
    summary: 'These claims each have at least one piece of evidence linked as contradicting them. Both sides are shown; Chronium does not decide which is right.',
    items: hit.slice(0, MAX_ITEMS).map((c) => claimItem(ix, c, ['contradicts', 'supports'])),
    missing: hit.length > MAX_ITEMS ? [`${hit.length - MAX_ITEMS} more claims not shown.`] : [],
    searched: `${claims.length} claims and ${(ix.snap.claimEvidence || []).length} evidence links.`, clarification: null,
    context: { lastClaimId: hit[0].id }
  };
}

function matchClaims(ix, question) {
  const claims = ix.snap.claims || [];
  const phrases = subjectPhrases(question).map(norm);
  const words = norm(question).split(' ').filter((w) => w.length > 3 && !NOISE_WORDS.has(w));
  return claims.map((c) => {
    const t = norm(c.text);
    const phraseHit = phrases.some((p) => p && t.includes(p));
    const wordHits = words.filter((w) => t.includes(w)).length;
    return { claim: c, score: (phraseHit ? 3 : 0) + wordHits };
  }).filter((x) => x.score >= 2).sort((a, b) => b.score - a.score).map((x) => x.claim);
}

function answerClaimEvidence(ix, question, ctx) {
  const claims = ix.snap.claims || [];
  if (!claims.length) return noDataAnswer('claim-evidence', 'claims');
  const wantsSupport = /\bsupport|back up|confirm/.test(question.toLowerCase()) && !/contradict|disprove|conflict|refute|against/.test(question.toLowerCase());
  const stance = wantsSupport ? 'supports' : 'contradicts';
  let claim = null;
  const refersBack = /\b(that|this|the same|it)\b.{0,12}\bclaim\b|\bclaim\b/.test(question.toLowerCase());
  const named = matchClaims(ix, question);
  if (named.length === 1) claim = named[0];
  else if (named.length > 1) return pickClaim(named, question, 'Several claims match. Which one do you mean?');
  else if (ctx.lastClaimId && claims.find((c) => c.id === ctx.lastClaimId)) claim = claims.find((c) => c.id === ctx.lastClaimId);
  else if (claims.length === 1 && refersBack) claim = claims[0];
  else if (claims.length > 1) return pickClaim(claims, question, 'Which claim do you mean? Chronium has no earlier question to refer back to.');
  if (!claim) return null;
  const item = claimItem(ix, claim, [stance, 'contextualizes']);
  const direct = item.sources.filter((s) => s.stance === stance);
  const other = claimLinks(ix, claim).filter((l) => l.stance !== stance && l.stance !== 'contextualizes').length;
  if (!direct.length) {
    return {
      title: `No ${stance === 'contradicts' ? 'contradicting' : 'supporting'} evidence is linked to this claim`, state: 'NO_EVIDENCE_LOCATED',
      summary: `Claim ${claim.claimId}: "${claim.text}" has no evidence linked as ${stance === 'contradicts' ? 'contradicting' : 'supporting'} it${other ? ` (it has ${other} ${stance === 'contradicts' ? 'supporting' : 'contradicting'} link${other === 1 ? '' : 's'})` : ''}.`,
      items: [item], missing: ['This reflects linked evidence only. Records that contradict the claim may exist in documents that have not been reviewed or linked.'],
      searched: `Evidence links for claim ${claim.claimId}.`, clarification: null, context: { lastClaimId: claim.id }
    };
  }
  return {
    title: `${direct.length} piece${direct.length === 1 ? '' : 's'} of ${stance === 'contradicts' ? 'contradicting' : 'supporting'} evidence`, state: 'DOCUMENTED_FACT',
    summary: `For claim ${claim.claimId}: "${claim.text}". These passages were linked as ${stance === 'contradicts' ? 'contradicting' : 'supporting'} it. The passages are quoted from the sources; whether they settle the claim is a judgment recorded in the claim's finding.`,
    items: [{ ...item, sources: direct }], missing: [], searched: `Evidence links for claim ${claim.claimId}.`, clarification: null, context: { lastClaimId: claim.id }
  };
}
function pickClaim(claims, question, prompt) {
  return {
    intent: 'clarify-claim', title: 'Which claim do you mean?', state: 'NEEDS_CLARIFICATION', summary: prompt, items: [], missing: [],
    searched: 'Claims in this case.',
    clarification: { question: 'Choose a claim:', options: claims.slice(0, MAX_OPTIONS).map((c) => ({ label: `${c.claimId || ''} ${clip(c.text, 90)}`.trim(), followUp: `${question.replace(/\?*$/, '')} "${clip(c.text, 80)}"?` })) },
    context: {}
  };
}

// "Did X ...?" - show what the records say; never answer yes/no ourselves.
function answerVerify(ix, question) {
  if (emptyCase(ix)) return noDataAnswer('verify', 'this question');
  const subject = resolveSubject(ix, question);
  if (subject.status === 'ambiguous') return clarifyPerson(subject, (e) => question.replace(/\?*$/, '') + ` (${e.name})?`);
  const claims = matchClaims(ix, question);
  const phrases = subjectPhrases(question);
  const key = norm(phrases[0] || '');
  const topicWords = norm(question).split(' ').filter((w) => w.length > 3 && !NOISE_WORDS.has(w) && !(key && key.split(' ').includes(w)));
  const hits = [];
  for (const r of ix.records) {
    const text = textOf(r).toLowerCase();
    const nameHit = key && (text.includes(key) || (subject.entities[0] && text.includes(norm(subject.entities[0].name))));
    if (!nameHit) continue;
    const topicHit = topicWords.filter((w) => text.includes(w));
    if (topicWords.length && !topicHit.length) continue;
    const idx = text.indexOf(topicHit[0] || key);
    hits.push({ r, score: topicHit.length, idx });
  }
  hits.sort((a, b) => b.score - a.score);
  const items = [];
  for (const c of claims.slice(0, 3)) items.push(claimItem(ix, c));
  for (const h of hits.slice(0, MAX_ITEMS)) {
    const text = textOf(h.r);
    const p = text.slice(Math.max(0, h.idx - 140), Math.min(text.length, h.idx + 200));
    items.push({ heading: h.r.title || 'Source', body: 'A passage from this source:', sources: [sourceFor(ix, h.r, { excerpt: p })], state: 'UNRESOLVED_QUESTION' });
  }
  const notes = subject.caveat ? [subject.caveat] : [];
  if (!items.length) {
    return {
      title: 'No evidence located for this question', state: 'NO_EVIDENCE_LOCATED',
      summary: 'Nothing in the saved sources matches this question. That does not show it did not happen: only that these records do not say so.',
      items: [], missing: ['Records that would answer this have not been added to the case, or they use different wording.', ...notes],
      searched: `${ix.records.length} sources and ${(ix.snap.claims || []).length} claims in this case.`, clarification: null, context: {}
    };
  }
  const hasFinding = items.some((i) => i.state && i.state !== 'UNRESOLVED_QUESTION');
  return {
    title: 'What your records say', state: hasFinding ? 'SUPPORTED_INFERENCE' : 'UNRESOLVED_QUESTION',
    summary: `Chronium found ${hits.length} source${hits.length === 1 ? '' : 's'} and ${claims.length} claim${claims.length === 1 ? '' : 's'} that touch on this. It does not answer yes or no by itself: read the passages${claims.length ? ' and the finding on the claim' : ''}, then record a finding.`,
    items, missing: [...notes, ...(claims.length ? [] : ['No claim has been created for this question yet, so there is no recorded finding.'])],
    searched: `${ix.records.length} sources and ${(ix.snap.claims || []).length} claims in this case.`, clarification: null,
    context: { lastClaimId: claims[0]?.id, lastEntityIds: subject.entities.map((e) => e.id) }
  };
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------
function relItem(ix, rel) {
  const a = ix.entityById.get(rel.sourceEntityId), b = ix.entityById.get(rel.targetEntityId);
  const sources = (rel.evidenceIds || []).map((id) => ix.evidenceById.get(id)).filter(Boolean).map((ev) => sourceForEvidence(ix, ev));
  return {
    heading: `${a?.name || 'Unknown'} — ${String(rel.type || '').replace(/_/g, ' ').toLowerCase()} — ${b?.name || 'Unknown'}`,
    body: `Status: ${String(rel.status || 'UNKNOWN').toLowerCase()}.`,
    sources, state: rel.status === 'CONFIRMED' ? 'DOCUMENTED_FACT' : rel.status === 'REFUTED' ? 'ALLEGATION' : 'SUPPORTED_INFERENCE'
  };
}

function answerRelationships(ix, question, ctx) {
  const rels = ix.snap.relationships || [];
  const subject = resolveSubject(ix, question);
  if (subject.status === 'ambiguous') return clarifyPerson(subject, (e) => `${question.replace(/\?*$/, '')} (${e.name})?`);
  let focus = subject.entities;
  if (!focus.length && ctx.lastEntityIds?.length && /\b(each|every|all|those|these|them)\b/i.test(question) === false) focus = ctx.lastEntityIds.map((id) => ix.entityById.get(id)).filter(Boolean);
  const eachConnection = /\b(each|every|all)\b.{0,20}\b(connection|relationship|link)/i.test(question);
  if (!focus.length && eachConnection && ctx.lastEntityIds?.length) focus = ctx.lastEntityIds.map((id) => ix.entityById.get(id)).filter(Boolean);
  const ids = new Set(focus.map((e) => e.id));
  const chosen = ids.size ? rels.filter((r) => ids.has(r.sourceEntityId) || ids.has(r.targetEntityId)) : rels;
  const wantOrgs = /\borgani[sz]ations?|businesses|companies|agenc/i.test(question);
  const filtered = wantOrgs && ids.size
    ? chosen.filter((r) => { const other = ix.entityById.get(ids.has(r.sourceEntityId) ? r.targetEntityId : r.sourceEntityId); return other && ['ORGANIZATION', 'GOVERNMENT_BODY', 'BUSINESS'].includes(other.type); })
    : chosen;
  const notes = subject.caveat ? [subject.caveat] : [];
  const label = focus.length ? focus.map((e) => e.name).join(', ') : 'this case';
  // Leads only: organizations whose names appear in the same documents as the
  // person. Co-occurrence is NOT a relationship.
  const leads = [];
  if (focus.length === 1 && focus[0].type === 'PERSON') {
    const name = norm(focus[0].name);
    const docs = recordsContaining(ix, name);
    const orgs = (ix.snap.entities || []).filter((e) => ['ORGANIZATION', 'GOVERNMENT_BODY', 'BUSINESS'].includes(e.type) && !filtered.some((r) => r.sourceEntityId === e.id || r.targetEntityId === e.id));
    for (const o of orgs) {
      const shared = docs.filter((d) => textOf(d).toLowerCase().includes(norm(o.name)));
      if (shared.length) leads.push({ heading: `${o.name} (appears in ${shared.length} of the same document${shared.length === 1 ? '' : 's'})`, body: 'Appearing in the same document is a lead, not a recorded relationship.', sources: shared.slice(0, 2).map((d) => sourceFor(ix, d, { excerpt: passagesIn(d, norm(o.name), 120, 1)[0] || '' })), state: 'UNRESOLVED_QUESTION' });
    }
  }
  if (!filtered.length && !leads.length) {
    return {
      title: `No recorded connections for ${label}`, state: 'NO_EVIDENCE_LOCATED',
      summary: rels.length ? 'No relationship with evidence has been recorded for this.' : 'No relationships have been recorded in this case yet. A relationship needs at least one evidence passage.',
      items: [], missing: ['Connections must be recorded with evidence before they are shown here. Documents that merely mention two names are not treated as a connection.', ...notes],
      searched: `${rels.length} recorded relationships and ${(ix.snap.entities || []).length} subjects.`, clarification: null, context: { lastEntityIds: [...ids] }
    };
  }
  return {
    title: filtered.length ? `${filtered.length} recorded connection${filtered.length === 1 ? '' : 's'} for ${label}` : `No recorded connections for ${label}, but there are leads`,
    state: filtered.length ? 'DOCUMENTED_FACT' : 'UNRESOLVED_QUESTION',
    summary: filtered.length ? 'Each connection below was recorded with evidence. Its status shows how firmly it is established.' : 'Nothing has been recorded as a connection. The leads below are only organizations named in the same documents.',
    items: [...filtered.slice(0, MAX_ITEMS).map((r) => relItem(ix, r)), ...leads.slice(0, 6)],
    missing: [...notes, ...(filtered.some((r) => !(r.evidenceIds || []).length) ? ['A connection is missing its evidence.'] : [])],
    searched: `${rels.length} recorded relationships and ${(ix.snap.entities || []).length} subjects.`, clarification: null, context: { lastEntityIds: [...ids] }
  };
}

// ---------------------------------------------------------------------------
// Who appears repeatedly
// ---------------------------------------------------------------------------
const NAME_STOP = new Set(['city', 'board', 'council', 'fund', 'development', 'corporation', 'texas', 'economic', 'redevelopment', 'riverwalk', 'minutes', 'agenda', 'meeting', 'regular', 'special', 'public', 'notice', 'ordinance', 'resolution', 'section', 'item', 'page', 'director', 'mayor', 'chair', 'chairman', 'vice', 'secretary', 'treasurer', 'manager', 'attorney', 'budget', 'grant', 'agreement', 'invoice', 'check', 'payment', 'project', 'construction', 'services', 'department', 'county', 'state', 'general', 'account', 'approved', 'motion', 'second', 'seconded', 'roll', 'call', 'present', 'absent', 'yes', 'no', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'the', 'and', 'for', 'of', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'this', 'that', 'subject', 'date', 'from:', 'sent', 'dear', 'sincerely', 'thank', 'regards', 'historical', 'society', 'falls', 'larkspur', 'llc', 'inc', 'company', 'office', 'street', 'avenue', 'road', 'park', 'library', 'police', 'fire', 'water', 'court', 'municipal', 'finance', 'committee', 'commission', 'members', 'member', 'staff', 'report', 'review', 'discussion', 'action', 'adjournment', 'call', 'order', 'citizens', 'comments', 'consent', 'new', 'old', 'business']);
function personLikeNames(text) {
  const out = new Set();
  for (const m of text.matchAll(/\b([A-Z][a-z]{2,}(?:\s[A-Z]\.)?\s[A-Z][a-z]{2,})\b/g)) {
    const parts = m[1].split(/\s+/).map((p) => p.replace('.', '').toLowerCase());
    if (parts.some((p) => NAME_STOP.has(p))) continue;
    out.add(m[1]);
  }
  return out;
}

function answerFrequency(ix, question) {
  if (emptyCase(ix)) return noDataAnswer('frequency', 'who appears');
  const phrases = subjectPhrases(question);
  if (!phrases.length) {
    return { intent: 'clarify-topic', title: 'Whose records do you mean?', state: 'NEEDS_CLARIFICATION', summary: 'Say which organization or topic to look at, for example "Who repeatedly appears in city council records?"', items: [], missing: [], searched: '', clarification: null, context: {} };
  }
  const key = norm(phrases[0]);
  const docs = recordsContaining(ix, key);
  if (!docs.length) {
    return { title: `No saved documents mention "${phrases[0]}"`, state: 'NO_EVIDENCE_LOCATED', summary: 'Without documents on this topic there is nothing to count.', items: [], missing: ['Documents that use a different spelling or abbreviation would not be found.'], searched: `${ix.records.length} sources.`, clarification: null, context: {} };
  }
  const registered = (ix.snap.entities || []).filter((e) => e.type === 'PERSON').map((e) => {
    const names = [e.name, ...(ix.aliasesByEntity.get(e.id) || [])].map(norm);
    const inDocs = docs.filter((d) => names.some((n) => textOf(d).toLowerCase().includes(n)));
    return { e, inDocs };
  }).filter((x) => x.inDocs.length >= 2).sort((a, b) => b.inDocs.length - a.inDocs.length);
  const counts = new Map();
  for (const d of docs) for (const n of personLikeNames(textOf(d))) {
    if (!counts.has(n)) counts.set(n, []);
    counts.get(n).push(d);
  }
  const regNames = new Set(registered.map((x) => norm(x.e.name)));
  const textual = [...counts.entries()].filter(([n, ds]) => ds.length >= 3 && !regNames.has(norm(n))).sort((a, b) => b[1].length - a[1].length).slice(0, 10);
  const items = [
    ...registered.slice(0, 8).map((x) => ({ heading: `${x.e.name}: in ${x.inDocs.length} of ${docs.length} documents`, body: 'A registered subject whose full name appears in these documents.', sources: x.inDocs.slice(0, 3).map((d) => sourceFor(ix, d, { excerpt: passagesIn(d, norm(x.e.name), 120, 1)[0] || '' })), state: 'DOCUMENTED_FACT' })),
    ...textual.map(([n, ds]) => ({ heading: `${n}: in ${ds.length} of ${docs.length} documents`, body: 'A name-shaped phrase found by pattern, not a verified person. Check the passages before relying on it.', sources: ds.slice(0, 2).map((d) => sourceFor(ix, d, { excerpt: passagesIn(d, norm(n), 120, 1)[0] || '' })), state: 'UNRESOLVED_QUESTION' }))
  ];
  if (!items.length) {
    return { title: `No name appears repeatedly in the ${docs.length} "${phrases[0]}" documents`, state: 'NO_EVIDENCE_LOCATED', summary: 'No registered subject appears in two or more of them, and no other name-like phrase appears in three or more.', items: [], missing: ['Names that are written differently from one document to the next would be counted separately.'], searched: `${docs.length} documents mentioning "${phrases[0]}".`, clarification: null, context: {} };
  }
  return {
    title: `Names that appear repeatedly in "${phrases[0]}" documents`, state: 'COMPUTED',
    summary: `Counted across the ${docs.length} documents that mention "${phrases[0]}". Counts are how many documents a name appears in, not how many times.`,
    items, missing: ['Counting names does not identify people. Two people can share a name, and one person can appear under several.'],
    searched: `${docs.length} of ${ix.records.length} sources mention "${phrases[0]}".`, clarification: null, context: { lastEntityIds: registered.map((x) => x.e.id) }
  };
}

// ---------------------------------------------------------------------------
// Financial records
// ---------------------------------------------------------------------------
const AMOUNT_RE = /\$\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?(?:million|billion|thousand|[kKmM])\b)?/g;
const PAY_WORDS = /\b(paid|payment|pay|check|cheque|invoice|warrant|disburse\w*|expenditure|expense|grant|award\w*|contract|bond\w*|transfer\w*|fund\w*|budget\w*|reimburs\w*|purchase|appropriat\w*|approved)\b/i;

function amountLines(record, subjectLower) {
  const lines = textOf(record).split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const window = [lines[i - 1], lines[i], lines[i + 1]].filter(Boolean).join(' ');
    const amounts = lines[i].match(AMOUNT_RE);
    if (!amounts) continue;
    if (subjectLower && !window.toLowerCase().includes(subjectLower)) continue;
    if (!PAY_WORDS.test(window) && !subjectLower) continue;
    out.push({ line: clip(lines[i].trim(), 240), amounts: [...new Set(amounts.map((a) => a.replace(/\s+/g, '')))], context: clip(window, 300) });
  }
  return out;
}

function answerFinancial(ix, question) {
  if (emptyCase(ix)) return noDataAnswer('financial', 'payments and budgets');
  const phrases = subjectPhrases(question).filter((p) => !/^(show|list)$/i.test(p));
  const subject = phrases[0] ? norm(phrases[0]) : '';
  const docsWithSubject = subject ? recordsContaining(ix, subject) : ix.records;
  const rows = [];
  for (const d of docsWithSubject) for (const l of amountLines(d, subject)) rows.push({ d, ...l });
  const notes = [];
  const searched = subject
    ? `${ix.records.length} sources; ${docsWithSubject.length} mention "${phrases[0]}".`
    : `${ix.records.length} sources, looking for dollar amounts near payment words.`;
  if (!rows.length) {
    return {
      title: subject ? `No payment amounts located for "${phrases[0]}"` : 'No payment amounts located', state: 'NO_EVIDENCE_LOCATED',
      summary: subject
        ? (docsWithSubject.length ? `"${phrases[0]}" appears in ${docsWithSubject.length} document${docsWithSubject.length === 1 ? '' : 's'}, but none has a dollar amount next to it.` : `"${phrases[0]}" does not appear in any saved document.`)
        : 'No dollar amounts near payment words were found in the saved documents.',
      items: docsWithSubject.slice(0, 5).map((d) => ({ heading: d.title || 'Source', body: 'Mentions the name, but no dollar amount was found next to it.', sources: [sourceFor(ix, d, { excerpt: passagesIn(d, subject, 120, 1)[0] || '' })], state: 'UNRESOLVED_QUESTION' })),
      missing: ['This does not show that no payment was made. Payment records (check registers, ledgers, invoices) may not be in the case, may be scanned images that could not be read, or may use a different name.', 'Searching only finds amounts written with a dollar sign.'],
      searched, clarification: null, context: {}
    };
  }
  const byDoc = new Map();
  for (const r of rows) { if (!byDoc.has(r.d.id)) byDoc.set(r.d.id, []); byDoc.get(r.d.id).push(r); }
  const items = rows.slice(0, MAX_ITEMS).map((r) => ({
    heading: `${r.amounts.join(', ')}`, body: r.line,
    sources: [sourceFor(ix, r.d, { excerpt: r.context })], state: 'DOCUMENTED_FACT'
  }));
  notes.push('The same payment can appear in more than one document (a vote, an invoice, a check), so these amounts are not added together.');
  if (rows.length > MAX_ITEMS) notes.push(`${rows.length - MAX_ITEMS} more amounts not shown.`);
  return {
    title: `${rows.length} dollar amount${rows.length === 1 ? '' : 's'} in ${byDoc.size} document${byDoc.size === 1 ? '' : 's'}${subject ? ` involving "${phrases[0]}"` : ''}`,
    state: 'DOCUMENTED_FACT',
    summary: 'Each amount is quoted from the document line where it appears. Chronium shows what the records say; it does not decide whether money actually moved.',
    items, missing: notes, searched, clarification: null, context: {}
  };
}

// ---------------------------------------------------------------------------
// Government decisions and before/after
// ---------------------------------------------------------------------------
const VOTE_STRONG = /\b(voted|vote of|motion|moved by|seconded|roll call|ayes?|nays?)\b/i;
const VOTE_WEAK = /\b(passed|approved by|carried)\b/i;
function voteEvents(ix, filterPhrase) {
  const collect = (re) => {
    const events = [];
    for (const r of ix.records) {
      const lines = textOf(r).split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        const window = [lines[i - 1], lines[i], lines[i + 1]].filter(Boolean).join(' ');
        // The item (e.g. an ordinance number) is usually named elsewhere in the
        // same document, not on the vote line itself, so test the whole document.
        if (filterPhrase && !loose(`${r.title || ''} ${textOf(r)}`).includes(loose(filterPhrase))) continue;
        events.push({ record: r, line: clip(lines[i].trim() || window, 220), window: clip(window, 320), date: documentDate(r) });
        break; // one event per document keeps the choice list short
      }
    }
    return events;
  };
  // Records of an actual vote (motion, ayes/nays) win over documents that
  // merely say "passed and approved" (e.g. adopted ordinance text).
  const strong = collect(VOTE_STRONG);
  const events = strong.length ? strong : collect(VOTE_WEAK);
  return events.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

function answerDecision(ix, question) {
  if (emptyCase(ix)) return noDataAnswer('decision', 'votes and decisions');
  const phrases = subjectPhrases(question);
  const filter = phrases[0] ? norm(phrases[0]) : '';
  const events = voteEvents(ix, filter);
  if (!events.length) {
    return { title: 'No vote or decision located', state: 'NO_EVIDENCE_LOCATED', summary: filter ? `No saved document has voting language near "${phrases[0]}".` : 'No saved document has voting language (motion, voted, seconded, ayes/nays).', items: [], missing: ['Minutes may not be in the case, or may be scanned images that could not be read.'], searched: `${ix.records.length} sources.`, clarification: null, context: {} };
  }
  return {
    title: `${events.length} document${events.length === 1 ? '' : 's'} with voting language`, state: 'DOCUMENTED_FACT',
    summary: 'These are the passages where votes or motions are recorded. Chronium has not interpreted the outcome; read each passage.',
    items: events.slice(0, MAX_ITEMS).map((e) => ({ heading: `${e.record.title || 'Source'}${e.date ? ` (${e.date})` : ''}`, body: 'Voting language in this document:', sources: [sourceFor(ix, e.record, { excerpt: e.window })], state: 'DOCUMENTED_FACT' })),
    missing: events.length > MAX_ITEMS ? [`${events.length - MAX_ITEMS} more not shown.`] : [], searched: `${ix.records.length} sources.`, clarification: null, context: {}
  };
}

function identifiersIn(text) {
  const ids = new Set();
  for (const m of text.matchAll(/\b(?:Ordinance|Resolution|Agreement|Contract)\s+(?:No\.?\s*)?[A-Z0-9][\w-]*\d[\w-]*/g)) ids.add(m[0].replace(/\s+/g, ' '));
  for (const m of text.matchAll(/\b[A-Z]{2,}-\d{2,4}-\d+\b/g)) ids.add(m[0]);
  for (const m of text.matchAll(/\b([A-Z][\p{L}&]+(?:\s[A-Z][\p{L}&]+){1,3}\s(?:LLC|Inc\.?|Corp\.?|Company|Construction|Fund|Corporation))\b/gu)) ids.add(m[1]);
  return [...ids].slice(0, 6);
}

function answerBeforeAfter(ix, question) {
  if (emptyCase(ix)) return noDataAnswer('before-after', 'what changed');
  const quoted = [...question.matchAll(/"([^"]{3,160})"/g)].map((m) => m[1]);
  const isRecordTitle = (p) => ix.records.some((r) => (r.title || '').toLowerCase() === p.toLowerCase());
  const phrases = subjectPhrases(question).filter((p) => !/^(what|vote)$/i.test(p) && !isRecordTitle(p));
  let events = voteEvents(ix, '');
  const named = quoted.length ? events.filter((e) => quoted.some((qt) => (e.record.title || '').includes(qt) || e.window.includes(qt))) : [];
  if (named.length) events = named;
  else if (phrases.length) {
    const narrowed = voteEvents(ix, phrases[0]);
    if (narrowed.length) events = narrowed;
  }
  if (!events.length) {
    return {
      title: 'Cannot compare: no vote or decision was identified', state: 'NO_EVIDENCE_LOCATED',
      summary: 'A before-and-after comparison needs a specific vote or decision with a date. None of the saved documents has voting language.',
      items: [], missing: ['Add the minutes or agenda for the vote, then ask again.', 'Chronium will not invent a comparison without an identified event.'],
      searched: `${ix.records.length} sources.`, clarification: null, context: {}
    };
  }
  if (events.length > 1) {
    return {
      intent: 'clarify-vote', title: 'Which vote do you mean?', state: 'NEEDS_CLARIFICATION',
      summary: `${events.length} documents contain voting language, so Chronium cannot tell which vote "this vote" refers to. Pick one, or name the ordinance or item in your question.`,
      items: [], missing: events.length > MAX_OPTIONS ? [`Showing ${MAX_OPTIONS} of ${events.length}. Name the item (for example an ordinance number) to narrow the list.`] : [],
      searched: `${ix.records.length} sources; ${events.length} with voting language.`,
      clarification: {
        question: 'Choose a vote:',
        options: events.slice(0, MAX_OPTIONS).map((e) => ({ label: `${e.record.title || 'Source'}${e.date ? ` (${e.date})` : ''}: ${clip(e.line, 80)}`, followUp: `What changed before and after the vote in "${e.record.title}"?` }))
      },
      context: {}
    };
  }
  const ev = events[0];
  if (!ev.date) {
    return { title: 'Cannot compare: the vote has no readable date', state: 'UNRESOLVED_QUESTION', summary: `Found voting language in "${ev.record.title}", but no date could be read from it, so documents cannot be placed before or after it.`, items: [{ heading: ev.record.title, body: 'The vote passage:', sources: [sourceFor(ix, ev.record, { excerpt: ev.window })], state: 'DOCUMENTED_FACT' }], missing: ['A date for this document.'], searched: `${ix.records.length} sources.`, clarification: null, context: {} };
  }
  const ids = identifiersIn(ev.window.length > 40 ? textOf(ev.record).slice(0, 6000) : ev.window).slice(0, 4);
  const keys = (phrases.length ? phrases.map(norm) : []).concat(ids.map(norm)).filter(Boolean);
  if (!keys.length) {
    return { title: 'Found the vote, but not what to compare it with', state: 'UNRESOLVED_QUESTION', summary: `The vote is in "${ev.record.title}" (${ev.date}). No ordinance, agreement, or named item could be read from it to find related documents.`, items: [{ heading: ev.record.title, body: 'The vote passage:', sources: [sourceFor(ix, ev.record, { excerpt: ev.window })], state: 'DOCUMENTED_FACT' }], missing: ['Name the item in your question, for example "before and after the vote on Ordinance 2024-31".'], searched: `${ix.records.length} sources.`, clarification: null, context: {} };
  }
  const related = ix.records.filter((r) => r.id !== ev.record.id && keys.some((k) => loose(`${r.title || ''} ${textOf(r)}`).includes(loose(k))));
  const before = [], after = [], undated = [];
  for (const r of related) {
    const d = documentDate(r);
    if (!d) undated.push(r); else if (d < ev.date) before.push([d, r]); else if (d > ev.date) after.push([d, r]); else undated.push(r);
  }
  const mk = ([d, r]) => ({ heading: `${r.title || 'Source'} (${d})`, body: 'Mentions the same item.', sources: [sourceFor(ix, r, { excerpt: passagesIn(r, keys.find((k) => textOf(r).toLowerCase().includes(k) || (r.title || '').toLowerCase().includes(k)) || '', 130, 1)[0] || '' })], state: 'DOCUMENTED_FACT' });
  before.sort((a, b) => a[0].localeCompare(b[0])); after.sort((a, b) => a[0].localeCompare(b[0]));
  const items = [
    { heading: `The vote: ${ev.record.title} (${ev.date})`, body: 'The vote passage:', sources: [sourceFor(ix, ev.record, { excerpt: ev.window })], state: 'DOCUMENTED_FACT' },
    ...before.slice(-4).map(mk).map((i) => ({ ...i, body: 'Before the vote. ' + i.body })),
    ...after.slice(0, 4).map(mk).map((i) => ({ ...i, body: 'After the vote. ' + i.body }))
  ];
  return {
    title: `Related documents before and after the vote on ${ids[0] || phrases[0]}`, state: 'DOCUMENTED_FACT',
    summary: `${before.length} related document${before.length === 1 ? '' : 's'} are dated before ${ev.date} and ${after.length} after. They are listed in date order. Chronium shows what each says about the item; it does not conclude that the vote caused any change.`,
    items,
    missing: [...(undated.length ? [`${undated.length} related document${undated.length === 1 ? ' has' : 's have'} no readable date and ${undated.length === 1 ? 'is' : 'are'} not placed.`] : []), ...(!before.length ? ['No related document dated before the vote was found.'] : []), ...(!after.length ? ['No related document dated after the vote was found.'] : [])],
    searched: `${ix.records.length} sources; matched on ${keys.map((k) => `"${k}"`).join(', ')}.`, clarification: null, context: {}
  };
}

// ---------------------------------------------------------------------------
// Investigation progress
// ---------------------------------------------------------------------------
function answerProgress(ix, question) {
  const snap = ix.snap;
  const items = [];
  const missing = [];
  const ing = snap.ingestionItems || [];
  const unreviewedDocs = ing.filter((i) => i.status === 'READY_FOR_REVIEW');
  const isDup = (i) => i.status === 'SKIPPED' && !!i.metadata?.duplicateOccurrencePath;
  const dupDocs = ing.filter(isDup);
  const failedDocs = ing.filter((i) => i.status === 'FAILED' || (i.status === 'SKIPPED' && !isDup(i)));
  const cands = (snap.reviewCandidates || []);
  const openCands = cands.filter((c) => c.state === 'UNREVIEWED' || c.state === 'AMBIGUOUS');
  const ambiguous = cands.filter((c) => c.state === 'AMBIGUOUS');
  const hits = (snap.watchlistMatches || []).filter((m) => m.state === 'UNREVIEWED');
  const claims = snap.claims || [];
  const bare = claims.filter((c) => c.status === 'UNVERIFIED' && !claimLinks(ix, c).length);
  const lanes = (snap.outlines?.[0]?.lanes || snap.outlines?.[0]?.sections || []);
  const emptyLanes = lanes.filter((l) => !(snap.evidenceItems || []).some((e) => e.outlineLaneId === l.id));
  const findings = snap.claimFindings || [];
  const open = findings.filter((f) => f.classification === 'UNRESOLVED_QUESTION' || f.classification === 'NO_EVIDENCE_LOCATED');
  const titleOf = (i) => i.sourceFilename || i.title || ix.recordById.get(i.recordId)?.title || 'Untitled';
  const list = (rows, f) => rows.slice(0, 8).map(f);

  if (emptyCase(ix) && !ing.length) return noDataAnswer('progress', 'progress');
  if (ing.length || unreviewedDocs.length) {
    items.push({ heading: `${unreviewedDocs.length} imported document${unreviewedDocs.length === 1 ? '' : 's'} not reviewed yet`, body: unreviewedDocs.length ? `Waiting in Needs Review, for example: ${list(unreviewedDocs, titleOf).join('; ')}${unreviewedDocs.length > 8 ? '…' : ''}.` : 'Every imported document has been reviewed.', sources: [], state: 'COMPUTED' });
  }
  if (cands.length) {
    items.push({ heading: `${openCands.length} possible name match${openCands.length === 1 ? '' : 'es'} not decided yet${ambiguous.length ? ` (${ambiguous.length} could be more than one person)` : ''}`, body: openCands.length ? `Each needs you to confirm or reject it; Chronium never decides identity. For example: ${list(openCands, (c) => `"${c.matchedText}"`).join(', ')}.` : 'All name matches have been decided.', sources: [], state: 'COMPUTED' });
  }
  if (hits.length) items.push({ heading: `${hits.length} watch-term hit${hits.length === 1 ? '' : 's'} not reviewed`, body: 'Watch-term hits are leads until you review them.', sources: [], state: 'COMPUTED' });
  if (claims.length) items.push({ heading: `${bare.length} of ${claims.length} claim${claims.length === 1 ? '' : 's'} have no evidence linked`, body: bare.length ? list(bare, (c) => `${c.claimId}: ${clip(c.text, 80)}`).join('; ') : 'Every claim has evidence linked.', sources: [], state: 'COMPUTED' });
  if (open.length) items.push({ heading: `${open.length} finding${open.length === 1 ? ' is' : 's are'} marked unresolved or no evidence located`, body: list(open, (f) => clip(f.conclusion, 90)).join('; '), sources: [], state: 'COMPUTED' });
  if (emptyLanes.length) items.push({ heading: `${emptyLanes.length} outline section${emptyLanes.length === 1 ? ' has' : 's have'} no evidence`, body: list(emptyLanes, (l) => l.label || l.name || l.id).join('; '), sources: [], state: 'COMPUTED' });
  if (dupDocs.length) {
    items.push({ heading: `${dupDocs.length} duplicate file${dupDocs.length === 1 ? '' : 's'} skipped`, body: 'These had exactly the same content as a file already in the case, so they were not added again. Nothing is lost.', sources: [], state: 'COMPUTED' });
  }
  if (failedDocs.length) {
    missing.push(`${failedDocs.length} imported file${failedDocs.length === 1 ? ' was' : 's were'} skipped or could not be read, so ${failedDocs.length === 1 ? 'its' : 'their'} contents are not searchable: ${list(failedDocs, titleOf).join('; ')}.`);
  }
  if (/missing/i.test(question)) {
    if (!claims.length) missing.push('No claims have been written yet, so there is nothing to test against the records.');
    if (!(snap.relationships || []).length) missing.push('No evidence-backed relationships have been recorded.');
  }
  const total = unreviewedDocs.length + openCands.length + hits.length + bare.length + open.length + emptyLanes.length;
  return {
    title: total ? 'What still needs attention' : 'Nothing is waiting for review', state: 'COMPUTED',
    summary: total
      ? 'These counts come straight from your case. "Not reviewed" means no one has looked yet; it does not mean the records are missing.'
      : 'Everything Chronium tracks has been reviewed. This does not mean the investigation is complete: records may still be missing.',
    items, missing, searched: 'Imported documents, name matches, watch terms, claims, findings, and the outline.', clarification: null, context: {}
  };
}
