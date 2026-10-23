// Records Recovery: the gap detectors G1 to G8 (docs/RECORDS_RECOVERY_PLAN.md, section 6, as amended).
// Each item says what the case holds, what was searched, and what is NOT concluded. An item describes a gap in
// Chronium's evidence inventory; it never says the government lacks a record or mishandled a request.
// Pure module: facts and run data in, items out; no clock, no randomness, no network.
import { groupSeries, detectCadence, longDate, dayDiff, MEETING_TYPES } from './series.js';
import { matchExpectation } from './match.js';
import { DETECTORS } from './config.js';

const TYPE_WORD = { agenda: 'agenda', minutes: 'minutes', packet: 'agenda packet', budget: 'budget', audit: 'audit or financial report', 'check-register': 'check register', contract: 'contract', ordinance: 'ordinance', resolution: 'resolution', unknown: 'document' };
const bodyWords = (b) => (b && b !== '(body not stated)' ? `the ${b}` : 'a body that is not named in the documents');
const NOT_CONCLUDED_GENERIC = 'This does not show that the record exists elsewhere, that it was ever created, or why this case does not hold it. It describes this case only.';

function item(detector, key, fields) {
  return { detector, detectorTitle: DETECTORS[detector].title, basis: DETECTORS[detector].basis, key: `${detector}|${key}`, status: 'open', evidence: [], nextSteps: [], ...fields };
}
const ev = (f, role) => ({ recordId: f.recordId, title: f.title, date: f.date.iso, role, address: f.address });

// Look-up tables so a large case does not compare every expectation with every document.
export function buildIndex(facts) {
  const byDate = new Map(); const byAddr = new Map(); const byOwn = new Map();
  const add = (m, k, f) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(f); };
  for (const f of facts) { add(byDate, f.date.iso, f); add(byAddr, f.address, f); for (const a of f.alsoFoundAt) add(byAddr, a, f); for (const k of f.ownNumbers) add(byOwn, k, f); }
  const dayShift = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
  return {
    forDate(iso) { const out = []; for (let n = -3; n <= 3; n++) { const l = byDate.get(dayShift(iso, n)); if (l) out.push(...l); } return out; },
    forAddress(a) { return byAddr.get(a) || []; },
    forOwn(k) { return byOwn.get(k) || []; }
  };
}

const SEARCHED_NO_RUN = 'No automated search is recorded for this case, so this comparison rests only on the documents the case holds.';
function searchedText(ctx) {
  if (!ctx.runs.length) return SEARCHED_NO_RUN;
  const last = ctx.runs.reduce((a, r) => (String(r.startedAt) > String(a.startedAt) ? r : a));
  return `In the ${ctx.runs.length === 1 ? 'search' : `${ctx.runs.length} searches`} recorded for this case (most recent started ${String(last.startedAt).slice(0, 10)}), and in the ${ctx.facts.length} sources the case holds.`;
}

// ---------- G1: agenda and minutes pairs ----------
function g1(ctx) {
  const out = [];
  for (const s of ctx.series.filter((x) => x.kind === 'meeting')) {
    const newest = s.dates[s.dates.length - 1];
    for (const date of s.dates) {
      const here = s.members.filter((m) => m.date.iso === date);
      const has = (t) => here.some((m) => m.type.value === t);
      const wantType = has('agenda') && !has('minutes') ? 'minutes' : has('minutes') && !has('agenda') && !has('packet') ? 'agenda' : null;
      if (!wantType) continue;
      const bodyKey = s.body === '(body not stated)' ? null : s.body;
      const m = matchExpectation({ type: wantType, body: bodyKey, date }, ctx.idx.forDate(date));
      if (m.closes) continue;
      const have = here[0];
      const recent = wantType === 'minutes' && dayDiff(newest, date) <= ctx.options.recentMeetingDays;
      out.push(item('G1', `${s.key}|${wantType}|${date}`, {
        title: `${TYPE_WORD[wantType][0].toUpperCase()}${TYPE_WORD[wantType].slice(1)} for ${longDate(date)}: not held in this case`,
        summary: `The case holds ${TYPE_WORD[have.type.value]} for ${bodyWords(bodyKey)} dated ${longDate(date)} but no ${TYPE_WORD[wantType]} for the same date${m.matches.length ? ' that can be matched with confidence' : ''}.`,
        body: s.body, type: wantType, period: date, status: m.matches.length ? 'review' : 'open',
        evidence: [...here.map((f) => ev(f, 'held')), ...m.matches.map((x) => ({ ...ev(x.facts, 'possible match'), why: x.why }))],
        searched: searchedText(ctx),
        notConcluded: `${recent ? `This is among the most recent dates held; minutes are often approved at a later meeting, so they may not have been issued yet. ` : ''}${NOT_CONCLUDED_GENERIC}`,
        nextSteps: m.matches.length ? ['Open the possible match and confirm or reject it.'] : ['Search the source again later.', 'Select and capture the specific document yourself, if you can see it on the source site.', 'Ask the records office whether it exists, in a follow-up request (Records Recovery appendix).']
      }));
    }
  }
  return out;
}

// ---------- G2: recurring series ----------
function g2(ctx) {
  const out = []; const notes = [];
  for (const s of ctx.series) {
    const c = detectCadence(s.dates, ctx.options);
    const label = `${bodyWords(s.body === '(body not stated)' ? null : s.body)} ${s.kind === 'meeting' ? 'meeting documents' : `${TYPE_WORD[s.kind] || s.kind} documents`}`;
    s.cadence = c;
    if (!c.found) { notes.push({ series: s.key, reason: c.reason, have: c.have, need: c.need }); continue; }
    for (const hole of c.holes) {
      const before = [...s.dates].reverse().find((d) => d < hole); const after = s.dates.find((d) => d > hole);
      out.push(item('G2', `${s.key}|${hole}`, {
        title: `No ${s.kind === 'meeting' ? 'agenda, minutes or packet' : TYPE_WORD[s.kind] || s.kind} held for ${longDate(hole)}`,
        summary: `${label[0].toUpperCase()}${label.slice(1)}: ${s.dates.length} dated documents in this case follow a pattern (${c.label}). The case holds nothing within ${ctx.options.dateToleranceDays} days of ${longDate(hole)}.`,
        body: s.body, type: s.kind, period: hole,
        evidence: [...s.members.filter((m) => m.date.iso === before || m.date.iso === after).map((f) => ev(f, f.date.iso === before ? 'held, just before' : 'held, just after'))],
        searched: searchedText(ctx),
        notConcluded: `A series gap does not show that a meeting took place on that date, that a record was created, or why the case holds nothing for it (meetings are cancelled and moved). The pattern was recognised from at least ${ctx.options.cadenceMinDocuments} dated documents, and that number can be changed.`,
        nextSteps: ['Check the source for that date.', 'Select and capture a specific document yourself, if one is published.', 'Mark it "not applicable" if you know no meeting was held.'],
        cadence: { label: c.label, documents: s.dates.length }
      }));
    }
  }
  ctx.cadenceNotes = notes;
  return out;
}

// ---------- G3: annual documents ----------
function g3(ctx) {
  const out = [];
  const groups = new Map();
  for (const f of ctx.facts) {
    if (!['budget', 'audit'].includes(f.type.value) || !f.fiscalYear.value) continue;
    const key = `${f.body.value || '(body not stated)'}|${f.type.value}`;
    if (!groups.has(key)) groups.set(key, { body: f.body.value || '(body not stated)', type: f.type.value, years: new Map() });
    const g = groups.get(key); if (!g.years.has(f.fiscalYear.value)) g.years.set(f.fiscalYear.value, []); g.years.get(f.fiscalYear.value).push(f);
  }
  for (const g of [...groups.values()].sort((a, b) => (a.body + a.type < b.body + b.type ? -1 : 1))) {
    const years = [...g.years.keys()].sort((a, b) => a - b);
    if (years.length < 2) continue;
    for (let y = years[0]; y <= years[years.length - 1]; y++) {
      if (g.years.has(y)) continue;
      out.push(item('G3', `${g.body}|${g.type}|${y}`, {
        title: `${TYPE_WORD[g.type][0].toUpperCase()}${TYPE_WORD[g.type].slice(1)} for fiscal year ${y}: not held in this case`,
        summary: `The case holds ${TYPE_WORD[g.type]} documents for fiscal years ${years.join(', ')} but none for ${y}.`,
        body: g.body, type: g.type, period: String(y),
        evidence: years.flatMap((yy) => g.years.get(yy).slice(0, 1).map((f) => ev(f, `held, fiscal year ${yy}`))),
        searched: searchedText(ctx),
        notConcluded: `This does not show that one was adopted or published for ${y}. ${NOT_CONCLUDED_GENERIC}`,
        nextSteps: ['Search the source for that year.', 'Select and capture the specific document yourself.', 'Ask the records office, in a follow-up request.']
      }));
    }
  }
  return out;
}

// ---------- G4: linked in a search, not retrieved ----------
const REASON = { 'http-404': 'the site answered "not found" (HTTP 404)', 'http-410': 'the site answered "gone" (HTTP 410)', timeout: 'the site did not answer in time', network: 'the connection failed', 'robots-disallow': 'robots.txt asks automated tools not to fetch it', 'http-403': 'the site refused access (HTTP 403)', 'returned-a-web-page': 'a web page came back instead of the document', 'redirect-blocked': 'a redirect led somewhere that is not allowed', 'rate-limited': 'the site asked for fewer requests' };
function g4(ctx) {
  const latest = new Map();
  for (const run of ctx.runs) for (const d of run.documents || []) { const prev = latest.get(d.url); if (!prev || String(run.startedAt) > String(prev.run.startedAt)) latest.set(d.url, { d, run }); }
  const out = [];
  for (const { d, run } of [...latest.values()].sort((a, b) => (a.d.url < b.d.url ? -1 : 1))) {
    if (!['not-located', 'source-unavailable', 'access-restricted', 'search-incomplete'].includes(d.outcome)) continue;
    const m = matchExpectation({ address: d.url }, ctx.idx.forAddress(d.url));
    if (m.closes) continue;
    const why = REASON[d.originalReason || d.reason] || (d.reason ? `reason recorded: ${d.reason}` : 'no reason was recorded');
    const arch = d.archive?.status === 'none' ? 'The web archive consulted had no copy.' : d.archive?.status === 'unavailable' ? 'The web archive could not be reached.' : '';
    out.push(item('G4', d.url, {
      title: `${d.linkText || d.url}: linked on the site, not retrieved`,
      summary: `A search (started ${String(run.startedAt).slice(0, 10)}) found this address linked, but it was not retrieved: ${why}. ${arch}`.trim(),
      body: null, type: d.classification || 'unknown', period: null,
      evidence: [{ runId: run.id, address: d.url, role: `search outcome: ${d.outcome}` }],
      searched: `Searched on ${String(run.startedAt).slice(0, 10)} (search ${run.id}); outcome "${d.outcome}".`,
      notConcluded: `This does not show whether the document is still published or was ever taken down. ${d.outcome === 'access-restricted' ? 'The site did not allow automated access to it. ' : ''}${NOT_CONCLUDED_GENERIC}`,
      nextSteps: d.outcome === 'access-restricted' ? ['Open it yourself in your browser, and import the file if you can see it.', 'Ask the records office.'] : ['Search again later.', 'Open it yourself and import the file.', 'Ask the records office.']
    }));
  }
  return out;
}

// ---------- G5: cited, not held ----------
function g5(ctx) {
  const by = new Map();
  for (const f of ctx.facts) for (const c of f.citations) { if (!by.has(c.key)) by.set(c.key, { c, citing: [] }); by.get(c.key).citing.push({ f, quote: c.quote }); }
  const out = [];
  for (const [key, { c, citing }] of [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const m = matchExpectation({ citationKey: key }, ctx.idx.forOwn(key));
    const word = { ordinance: 'Ordinance', resolution: 'Resolution', contract: 'Contract' }[c.kind];
    out.push(item('G5', key, {
      title: `${word} ${c.number}: cited in this case, ${m.matches.length ? 'a document with that number is held (not independently verified)' : 'not held in this case'}`,
      summary: `${citing.length} document${citing.length === 1 ? '' : 's'} in the case ${citing.length === 1 ? 'cites' : 'cite'} ${word.toLowerCase()} ${c.number}.${m.matches.length ? ' A document that carries that number is held. A matching number does not by itself show it is the item cited, so this is listed for information and is not counted as closed.' : ' No document in the case carries that number.'}`,
      body: null, type: c.kind, period: null, status: m.matches.length ? 'info' : 'open',
      evidence: [...citing.slice(0, 5).map((x) => ({ ...ev(x.f, 'cites it'), quote: x.quote })), ...m.matches.map((x) => ({ ...ev(x.facts, 'possible match'), why: x.why }))],
      searched: searchedText(ctx),
      notConcluded: `Citations are found by pattern and can be wrong. This shows only that this case does not hold the cited item. ${NOT_CONCLUDED_GENERIC}`,
      nextSteps: m.matches.length ? ['Open the held document and confirm that it is the item cited, if it matters.'] : ['Search the source for that number.', 'Select and capture the specific document yourself.', 'Ask the records office for it by number.']
    }));
  }
  return out;
}

// ---------- G6: held, cannot be searched yet ----------
function g6(ctx) {
  const why = { partial: 'only part of the file was retrieved', failed: 'text could not be read from it', 'not-extracted': 'text was not extracted in this app', 'no-text': 'no text is available (it may be a scan)', 'archive-only': 'only an archived copy is held, not the original' };
  const out = [];
  for (const f of ctx.facts) {
    if (!why[f.readability] || (!f.address && !f.hash)) continue;
    out.push(item('G6', f.recordId, {
      title: `${f.title || f.address}: held, cannot be searched yet`,
      summary: `This source is in the case, but ${why[f.readability]}.`,
      body: f.body.value, type: f.type.value, period: f.date.iso, status: 'info',
      evidence: [ev(f, 'held')],
      searched: 'Inventory of the case.',
      notConcluded: 'Nothing is concluded about the content. Until the text can be read, it cannot take part in matching by its own words.',
      nextSteps: ['Open the original and read it.', 'Add a text version if you have one.']
    }));
  }
  return out;
}

// ---------- G7: limits of the searches ----------
function g7(ctx) {
  const out = [];
  for (const run of ctx.runs) {
    const lines = [...(run.report?.limits || [])];
    for (const [h, w] of Object.entries(run.stoppedHosts || {})) lines.push(`${h} was stopped: ${w}.`);
    for (const [h, w] of Object.entries(run.blockedHosts || {})) lines.push(`${h} was not contacted: ${w}.`);
    const pending = (run.checkpoint?.pagesPending || []).length;
    if (pending && !lines.some((l) => /stopped at|cancelled/i.test(l))) lines.push(`${pending} page${pending === 1 ? '' : 's'} found but not requested.`);
    if (!lines.length) continue;
    out.push(item('G7', run.id, {
      title: `Search of ${(run.seeds || [])[0] || 'a site'} (${String(run.startedAt).slice(0, 10)}): limits that applied`,
      summary: lines.join(' '), body: null, type: 'search', period: null, status: 'info',
      evidence: [{ runId: run.id, role: 'search' }], searched: `Search ${run.id}, started ${String(run.startedAt).slice(0, 16).replace('T', ' ')} UTC.`,
      notConcluded: 'Whatever this search did not look at is unknown, not absent.',
      nextSteps: ['Continue the search from its report, or start another.']
    }));
  }
  return out;
}

// ---------- G8: changed between retrievals ----------
function g8(ctx) {
  const by = new Map();
  for (const f of ctx.facts) { if (!f.address || !f.hash) continue; if (!by.has(f.address)) by.set(f.address, []); by.get(f.address).push(f); }
  const out = [];
  for (const [addr, list] of [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (new Set(list.map((f) => f.hash)).size < 2) continue;
    out.push(item('G8', addr, {
      title: `${addr}: different content retrieved at different times`,
      summary: `This address was retrieved ${list.length} times with different content (${list.map((f) => `${(f.retrievedAt || 'time not recorded').slice(0, 10)}, ${f.hash.slice(0, 10)}`).join('; ')}).`,
      body: null, type: 'comparison', period: null, status: 'info', evidence: list.map((f) => ev(f, 'version')),
      searched: 'Inventory of the case.', notConcluded: 'Which version is current, correct or complete is not decided. Both versions are kept.', nextSteps: ['Compare the versions.']
    }));
  }
  return out;
}

export function runDetectors(ctx) {
  const items = [...g1(ctx), ...g2(ctx), ...g3(ctx), ...g4(ctx), ...g5(ctx), ...g6(ctx), ...g7(ctx), ...g8(ctx)];
  return items.sort((a, b) => (a.detector < b.detector ? -1 : a.detector > b.detector ? 1 : ((a.period || '') < (b.period || '') ? -1 : (a.period || '') > (b.period || '') ? 1 : (a.key < b.key ? -1 : 1))));
}
export { groupSeries, MEETING_TYPES };
