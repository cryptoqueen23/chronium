// Records Recovery: the model. A case snapshot goes in; gap items, request-versus-inventory results, counts and
// plain statements come out. Everything is recomputed from the snapshot each time (nothing calculated is stored),
// so results are reproducible; only a reviewer's decisions and the person's own request text are stored.
// Pure module: no clock, no randomness, no network, no storage.
import { extractFacts } from './facts.js';
import { groupSeries, detectCadence, longDate } from './series.js';
import { matchExpectation } from './match.js';
import { runDetectors, buildIndex } from './detect.js';
import { resolveOptions, NOTICE, STATUS_LABEL, RECOVERY_VERSION } from './config.js';
import { TYPE_LABEL } from './request.js';

export const DECISIONS = Object.freeze({ ACKNOWLEDGED: 'acknowledged', MATCH_CONFIRMED: 'match-confirmed', NOT_APPLICABLE: 'not-applicable', REOPENED: 'reopened' });
export const DECISION_LABEL = Object.freeze({ acknowledged: 'Acknowledged, still open', 'match-confirmed': 'Possible match confirmed', 'not-applicable': 'Not applicable', reopened: 'Reopened' });

const UNKNOWNS = [
  'Chronium compares what this case holds with patterns and citations found in it. It has no list of the meetings or records an agency was expected to produce.',
  'Dates, agencies and record types are read from words in the documents, file names and links; unusual wording is read as unknown rather than guessed.',
  'Citations are found by pattern; some will be missed and some will be wrong.',
  'Scanned pages and files whose text could not be read cannot take part in matching by their own words.',
  'A gap in this list is a question for a person to look into. It is not a finding.'
];

function latestDecisions(reviews) {
  const by = new Map();
  for (const r of [...(reviews || [])].sort((a, b) => (String(a.at) < String(b.at) ? -1 : String(a.at) > String(b.at) ? 1 : (a.id < b.id ? -1 : 1)))) by.set(r.itemKey, r);
  return by;
}

function applyDecision(it, d) {
  if (!d) return it;
  const out = { ...it, decision: { decision: d.decision, label: DECISION_LABEL[d.decision] || d.decision, note: d.note || '', recordId: d.recordId || null, by: d.investigatorName || d.investigatorId || null, at: d.at } };
  // Acknowledging changes how a gap is listed; it never changes what a request item found (that result stays as calculated).
  if (d.decision === DECISIONS.ACKNOWLEDGED) out.status = out.status === 'info' || it.detector === 'REQ' ? out.status : 'acknowledged';
  else if (d.decision === DECISIONS.MATCH_CONFIRMED) out.status = 'closed-by-review';
  else if (d.decision === DECISIONS.NOT_APPLICABLE) out.status = 'not-applicable';
  return out;
}

// ---------- request items versus the inventory ----------
function inRange(iso, from, to) { return !!iso && (!from || iso >= from) && (!to || iso <= to); }

export function evaluateRequestItem(it, ctx) {
  const base = { item: it, key: `REQ|${ctx.requestId}|${it.id}` };
  const searched = ctx.searched;
  const noteNo = 'This describes what this case holds. It does not show what the agency holds or how it handled the request.';
  const done = (status, extra) => ({ ...base, status, label: STATUS_LABEL[status], searched, notConcluded: noteNo, held: [], ...extra });
  if (it.citationKey) {
    const m = matchExpectation({ citationKey: it.citationKey }, ctx.facts);
    return m.matches.length ? done('review', { held: m.matches.map(brief), basis: 'A document carrying that number is held; confirm that it is the one requested.' }) : done('not-held', { basis: `No document in this case carries ${it.citationKey.replace(':', ' ')}.` });
  }
  if (!it.type || it.type === 'other') return done('cannot-assess', { basis: 'The kind of record could not be matched to a type this tool can compare. Review it by hand.' });

  const wantBody = it.body || null;
  const docs = ctx.facts.filter((f) => f.type.value === it.type && (!wantBody || f.body.value === wantBody || f.body.value === null));
  const fyDocs = it.fiscalYear ? docs.filter((f) => f.fiscalYear.value === it.fiscalYear) : null;
  // A document with no date of its own (a budget, for example) belongs to the period when its fiscal year falls inside it.
  const fyIn = (f) => f.fiscalYear.value && (!it.dateFrom || f.fiscalYear.value >= Number(it.dateFrom.slice(0, 4))) && (!it.dateTo || f.fiscalYear.value <= Number(it.dateTo.slice(0, 4)));
  const inPeriod = fyDocs || (it.dateFrom || it.dateTo ? docs.filter((f) => (f.date.iso && !f.date.ambiguous ? inRange(f.date.iso, it.dateFrom, it.dateTo) : fyIn(f))) : docs);
  const verifiedOf = (f) => (it.fiscalYear || (!f.date.iso && fyIn(f)) ? f.fiscalYear.basis === 'document text' && f.type.basis === 'document text' : f.type.basis === 'document text' && (f.date.basis === 'document text' || !(it.dateFrom || it.dateTo)) && !f.date.conflict) && (!wantBody || f.body.basis === 'document text');
  const verified = inPeriod.filter(verifiedOf); const unverified = inPeriod.filter((f) => !verifiedOf(f));
  const periodWords = it.fiscalYear ? `fiscal year ${it.fiscalYear}` : it.dateFrom || it.dateTo ? `${it.dateFrom ? longDate(it.dateFrom) : 'the start'} to ${it.dateTo ? longDate(it.dateTo) : 'the present'}` : 'any date';
  if (!inPeriod.length) return done('not-held', { basis: `No ${TYPE_LABEL[it.type].toLowerCase()} for ${wantBody ? `the ${wantBody}` : 'any body'} dated in ${periodWords} is held in this case.` });
  if (!verified.length) return done('review', { held: unverified.map(brief), basis: 'Documents that might fit are held, but their dates, bodies or types come from file names or links, not from their own text. Review them.' });

  // A single date, or one fiscal year: held and verified means located.
  if (it.fiscalYear || (it.dateFrom && it.dateFrom === it.dateTo)) return done('located', { held: verified.map(brief), basis: 'Matched on type, body and date or fiscal year, read from the documents\' own text.' });

  // A period: compare with the recurring pattern when one was recognised, otherwise say completeness cannot be told.
  const series = ctx.series.find((s) => s.kind === (['agenda', 'minutes', 'packet'].includes(it.type) ? 'meeting' : it.type) && (!wantBody || s.body === wantBody || s.body === '(body not stated)'));
  const cad = series ? detectCadence(series.dates, ctx.options) : null;
  const heldTypeDates = new Set(verified.map((f) => f.date.iso));
  if (cad && cad.found && it.dateFrom && it.dateTo) {
    const lo = series.dates[0]; const hi = series.dates[series.dates.length - 1];
    const inside = cad.positions.filter((p) => inRange(p, it.dateFrom, it.dateTo));
    const expectedHoles = inside.filter((p) => ![...heldTypeDates].some((d) => Math.abs((Date.parse(d) - Date.parse(p)) / 86400000) <= ctx.options.dateToleranceDays));
    // The requested period only reaches beyond the held dates if another expected date could fall in it: allow one step of the pattern.
    const slack = cad.kind === 'weekly' ? 10 : cad.kind === 'biweekly' ? 17 : 35;
    const shift = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
    const outside = it.dateFrom < shift(lo, -slack) || it.dateTo > shift(hi, slack);
    if (!expectedHoles.length && !outside) return done('located', { held: verified.map(brief), basis: `Every date in the period that the recognised pattern (${cad.label}) expects has a document of this type, read from its own text.` });
    return done('partly', { held: verified.map(brief), expected: expectedHoles, basis: `${verified.length} held. ${expectedHoles.length ? `Dates the recognised pattern (${cad.label}) expects, with no document of this type held: ${expectedHoles.map(longDate).join('; ')}. ` : ''}${outside ? 'Part of the period lies outside the dates this case holds. ' : ''}The pattern does not show that a record exists for those dates.` });
  }
  return done('partly', { held: verified.map(brief), basis: `${verified.length} held for ${periodWords}. Whether that is all of them cannot be told from this case (no regular pattern is established).` });
}
function brief(m) { const f = m.facts || m; return { recordId: f.recordId, title: f.title, date: f.date.iso, address: f.address, tier: m.tier || null, why: m.why || null }; }

function nextStepsFor(status) {
  return status === 'located' ? [] : status === 'partly' ? ['Search the source for the remaining dates.', 'Ask the records office to confirm what exists.'] : status === 'review' ? ['Open the possible matches and confirm or reject them.'] : ['Search the source again.', 'Select and capture the specific document yourself.', 'Ask the records office, in a follow-up request.'];
}

export function buildRecoveryModel(snapshot, overrides = {}) {
  const snap = snapshot || {};
  const saved = (snap.recoverySettings || [])[0]?.options || {};
  const options = resolveOptions({ ...saved, ...overrides });
  const records = snap.records || [];
  const facts = records.map(extractFacts).sort((a, b) => (a.recordId < b.recordId ? -1 : 1));
  const series = groupSeries(facts);
  const runs = [...(snap.discoveryRuns || [])].sort((a, b) => (String(a.startedAt) < String(b.startedAt) ? -1 : 1));
  const ctx = { facts, series, runs, options, cadenceNotes: [], idx: buildIndex(facts) };
  const decisions = latestDecisions(snap.recoveryReviews);
  const items = runDetectors(ctx).map((it) => applyDecision(it, decisions.get(it.key)));

  const searched = (() => {
    if (!runs.length) return `No automated search is recorded for this case; the comparison uses the ${facts.length} sources the case holds.`;
    const last = runs[runs.length - 1];
    return `The ${facts.length} sources this case holds, and ${runs.length} recorded search${runs.length === 1 ? '' : 'es'} (most recent started ${String(last.startedAt).slice(0, 10)}).`;
  })();
  const requests = (snap.recoveryRequests || []).slice().sort((a, b) => (String(a.createdAt) < String(b.createdAt) ? -1 : 1)).map((rq) => ({
    id: rq.id, title: rq.title || 'Records request', createdAt: rq.createdAt, text: rq.text || '', followUpDraft: rq.followUpDraft || null,
    items: (rq.items || []).map((it) => {
      const ev = evaluateRequestItem(it, { facts, series, options, searched, requestId: rq.id });
      const withDecision = applyDecision({ ...ev, detector: 'REQ' }, decisions.get(ev.key));
      return { ...withDecision, nextSteps: nextStepsFor(withDecision.status === 'closed-by-review' ? 'located' : ev.status) };
    })
  }));

  const open = (it) => ['open', 'review', 'acknowledged'].includes(it.status);
  const counts = {
    sources: facts.length, datedSources: facts.filter((f) => f.date.iso).length, searches: runs.length,
    notHeld: items.filter((i) => ['G1', 'G2', 'G3', 'G5'].includes(i.detector) && i.status === 'open').length,
    requiresReview: items.filter((i) => i.status === 'review').length + requests.flatMap((r) => r.items).filter((i) => i.status === 'review' || i.status === 'cannot-assess').length,
    couldNotRetrieve: items.filter((i) => i.detector === 'G4' && open(i)).length,
    notReadable: items.filter((i) => i.detector === 'G6').length,
    searchLimits: items.filter((i) => i.detector === 'G7').length,
    byDetector: Object.fromEntries(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8'].map((d) => [d, items.filter((i) => i.detector === d).length])),
    reviewed: items.filter((i) => i.decision).length
  };
  const types = {}; for (const f of facts) types[f.type.value] = (types[f.type.value] || 0) + 1;
  const dates = facts.map((f) => f.date.iso).filter(Boolean).sort();
  return {
    version: RECOVERY_VERSION, notice: NOTICE, options, counts, items, requests, series: series.map((s) => ({ key: s.key, body: s.body, kind: s.kind, documents: s.members.length, dates: s.dates.length, first: s.dates[0], last: s.dates[s.dates.length - 1], cadence: s.cadence ? (s.cadence.found ? { found: true, label: s.cadence.label, density: s.cadence.density } : { found: false, reason: s.cadence.reason }) : null })),
    inventory: { sources: facts.length, byType: types, firstDate: dates[0] || null, lastDate: dates[dates.length - 1] || null }, searched, unknowns: UNKNOWNS.slice()
  };
}

// Short summary for the Big Picture panel and for Ask Chronium.
export function summarizeRecovery(model) {
  const c = model.counts;
  return { notHeld: c.notHeld, requiresReview: c.requiresReview, couldNotRetrieve: c.couldNotRetrieve, notReadable: c.notReadable, searchLimits: c.searchLimits, sources: c.sources, requests: model.requests.length };
}
