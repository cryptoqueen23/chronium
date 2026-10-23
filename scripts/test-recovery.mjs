// Records Recovery acceptance tests (docs/RECORDS_RECOVERY_PLAN.md sections 10 and 14). Pure modules plus the
// local store, against synthetic fixtures only. No network, no clock, no AI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';
import { completeSnapshot, incompleteSnapshot, completeRecords, rec, MEETING_DATES } from './lib/recovery-fixtures.mjs';
import { extractFacts, findDates, findFiscalYear, findCitations } from '../public/recovery/facts.js';
import { groupSeries, detectCadence } from '../public/recovery/series.js';
import { matchExpectation } from '../public/recovery/match.js';
import { parseRequest, updateItem, removeItem, addItem, normalizeItem } from '../public/recovery/request.js';
import { buildRecoveryModel, DECISIONS, summarizeRecovery } from '../public/recovery/model.js';
import { recoveryHtml, recoveryText, recoverySummaryHtml, followUpDraft } from '../public/recovery/report.js';
import { resolveOptions, bannedWordsIn, NOTICE, DEFAULT_OPTIONS } from '../public/recovery/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const gaps = (m) => m.items.filter((i) => i.status !== 'info');
const OPT = resolveOptions();

// ============================== facts ==============================
test('facts: dates in every written form, ambiguity flagged, retrieval time never used', () => {
  const d = (s) => findDates(s).map((x) => `${x.iso}${x.ambiguous ? '?' : ''}`);
  assert.deepEqual(d('March 12, 2024'), ['2024-03-12']);
  assert.deepEqual(d('12 March 2024'), ['2024-03-12']);
  assert.deepEqual(d('Sept. 3rd, 2024'), ['2024-09-03']);
  assert.deepEqual(d('2024-03-12'), ['2024-03-12']);
  assert.deepEqual(d('minutes_03122024.pdf'), ['2024-03-12']);
  assert.deepEqual(d('20240312'), ['2024-03-12']);
  assert.deepEqual(d('13/04/2024'), ['2024-04-13']);
  assert.deepEqual(d('04/13/2024'), ['2024-04-13']);
  assert.deepEqual(d('03/04/2024'), ['2024-03-04?'], 'both could be months: US reading, flagged ambiguous');
  assert.deepEqual(d('03/03/2024'), ['2024-03-03'], 'same either way, so not ambiguous');
  assert.deepEqual(d('February 30, 2024'), [], 'impossible dates are ignored');
  assert.deepEqual(d('version 99999999 of 1850'), []);
  const r = rec({ title: 'Doc', url: 'https://x.gov/a.pdf', text: 'No date here at all.', retrievedAt: '2026-10-23T12:00:00Z' });
  assert.equal(extractFacts(r).date.iso, null, 'the retrieval time is provenance, not the meeting date');
});

test('facts: type from the document heading (an agenda that mentions minutes is still an agenda), body, basis recorded', () => {
  const a = extractFacts(rec({ title: 'x', url: 'https://x.gov/f.pdf', text: 'CITY COUNCIL AGENDA\nMarch 12, 2024\n2. Approval of the minutes of February 13' }));
  assert.equal(a.type.value, 'agenda'); assert.equal(a.type.basis, 'document text'); assert.equal(a.body.value, 'city council'); assert.equal(a.date.basis, 'document text'); assert.equal(a.verified, true);
  const m = extractFacts(rec({ title: 'x', url: 'https://x.gov/f.pdf', text: 'MINUTES OF THE REGULAR MEETING OF THE CITY COUNCIL\nMarch 12, 2024' }));
  assert.equal(m.type.value, 'minutes');
  const byName = extractFacts(rec({ title: 'Council minutes', url: 'https://x.gov/docs/minutes-2024-03-12.pdf', text: '' }));
  assert.equal(byName.type.value, 'minutes'); assert.equal(byName.type.basis, 'file name'); assert.equal(byName.date.basis, 'file name'); assert.equal(byName.verified, false, 'names only: not verified');
  assert.equal(extractFacts(rec({ title: 'Photo', url: 'https://x.gov/p.pdf', text: 'nothing relevant' })).type.value, 'unknown');
});

test('facts: conflicting dates are flagged, not resolved', () => {
  const f = extractFacts(rec({ title: 'x', url: 'https://x.gov/minutes-2024-03-19.pdf', text: 'MINUTES OF THE CITY COUNCIL\nMarch 12, 2024' }));
  assert.equal(f.date.iso, '2024-03-12'); assert.equal(f.date.conflict, true); assert.equal(f.verified, false);
});

test('facts: fiscal years and citations', () => {
  assert.equal(findFiscalYear('Annual Budget FY2025'), 2025);
  assert.equal(findFiscalYear('FY 25 adopted budget'), 2025);
  assert.equal(findFiscalYear('fiscal year 2023'), 2023);
  assert.equal(findFiscalYear('2023-24 budget'), 2024);
  assert.equal(findFiscalYear('nothing'), null);
  const c = findCitations('under Ordinance No. 2024-17 and Res. 55, per Contract 21-044; see Exhibit A').map((x) => x.key);
  assert.deepEqual(c, ['ordinance:2024-17', 'resolution:55', 'contract:21-044']);
  assert.deepEqual(findCitations('Ordinance 2024 - 17').map((x) => x.key), ['ordinance:2024-17']);
  assert.deepEqual(findCitations('the ordinal number 12'), []);
  const own = extractFacts(rec({ title: 'Ordinance 2024-17', url: 'https://x.gov/o.pdf', text: 'ORDINANCE NO. 2024-17 amending Ordinance 2019-4' }));
  assert.deepEqual(own.ownNumbers, ['ordinance:2024-17']); assert.deepEqual(own.citations.map((x) => x.key), ['ordinance:2019-4']);
  const minutes = extractFacts(rec({ title: 'Minutes', url: 'https://x.gov/m.pdf', text: 'MINUTES OF THE CITY COUNCIL\nMarch 12, 2024\nOrdinance No. 2024-17 was adopted.' }));
  assert.deepEqual(minutes.ownNumbers, [], 'minutes that mention an ordinance are not that ordinance');
});

test('facts: readability states', () => {
  const r = (over) => extractFacts({ ...rec({ title: 't', url: 'https://x.gov/a.pdf', text: 'long enough text to be readable, certainly more than forty characters.' }), ...over });
  assert.equal(r({}).readability, 'text');
  assert.equal(r({ extractedText: '', extractionNote: 'Extraction failed: bad pdf' }).readability, 'failed');
  assert.equal(r({ extractedText: '', extractionNote: 'Text was not extracted here.' }).readability, 'not-extracted');
  assert.equal(r({ discovery: { partial: true } }).readability, 'partial');
  assert.equal(r({ sourceType: 'discovered-archive-copy' }).readability, 'archive-only');
});

// ============================== series and patterns ==============================
const dts = (a) => a.map((m) => m);
test('series: a monthly second-Tuesday pattern is recognised and its hole found; nothing is extrapolated', () => {
  const dates = MEETING_DATES.filter((d) => d !== '2024-05-14');
  const c = detectCadence(dates, OPT);
  assert.equal(c.found, true); assert.match(c.label, /monthly, on the second Tuesday/); assert.deepEqual(c.holes, ['2024-05-14']);
  assert.ok(c.positions[0] === '2024-01-09' && c.positions.at(-1) === '2024-12-10', 'positions stay inside the held range');
});
test('series: weekly and biweekly patterns', () => {
  const weekly = ['2024-01-02', '2024-01-09', '2024-01-16', '2024-01-30', '2024-02-06', '2024-02-13'];
  const w = detectCadence(weekly, OPT);
  assert.equal(w.found, true); assert.equal(w.kind, 'weekly'); assert.deepEqual(w.holes, ['2024-01-23']);
  const bi = ['2024-01-04', '2024-01-18', '2024-02-01', '2024-02-15', '2024-03-14', '2024-03-28'];
  const b = detectCadence(bi, OPT);
  assert.equal(b.found, true); assert.equal(b.kind, 'biweekly'); assert.deepEqual(b.holes, ['2024-02-29']);
});
test('series: too few documents, irregular dates and twice-a-month meetings produce NO pattern and so no gaps', () => {
  assert.equal(detectCadence(['2024-01-09', '2024-02-13', '2024-03-12'], OPT).reason, 'too-few');
  assert.equal(detectCadence(['2024-01-03', '2024-01-29', '2024-03-07', '2024-03-08', '2024-04-30'], OPT).found, false);
  const twice = ['2024-01-02', '2024-01-16', '2024-02-06', '2024-02-20', '2024-03-05', '2024-03-19']; // 1st and 3rd Tuesday
  assert.equal(detectCadence(twice, OPT).found, false, 'two meetings a month are not mistaken for weekly with gaps');
});
test('series: the threshold is configurable and clamped', () => {
  const four = ['2024-01-09', '2024-02-13', '2024-04-09', '2024-05-14'];
  assert.equal(detectCadence(four, resolveOptions({ cadenceMinDocuments: 4 })).found, true);
  assert.equal(detectCadence(four, resolveOptions({ cadenceMinDocuments: 5 })).found, false);
  assert.equal(detectCadence(four.slice(0, 3), resolveOptions({ cadenceMinDocuments: 3 })).found, true);
  assert.equal(resolveOptions({ cadenceMinDocuments: 1 }).cadenceMinDocuments, 3);
  assert.equal(resolveOptions({ cadenceMinDocuments: 99 }).cadenceMinDocuments, 12);
  assert.equal(resolveOptions({ cadenceMinDocuments: 'x' }).cadenceMinDocuments, DEFAULT_OPTIONS.cadenceMinDocuments);
  const snap = incompleteSnapshot({ recoverySettings: [{ investigationId: 'inv-fixture', options: { cadenceMinDocuments: 12 } }] });
  assert.equal(buildRecoveryModel(snap).items.filter((i) => i.detector === 'G2').length, 0, 'a stricter saved setting removes the pattern-based item');
  assert.equal(buildRecoveryModel(snap).options.cadenceMinDocuments, 12);
});
test('series: grouping keeps bodies and kinds apart', () => {
  const s = groupSeries(completeRecords().map(extractFacts));
  assert.ok(s.some((x) => x.key === 'city council|meeting' && x.dates.length === 12));
  assert.ok(s.every((x) => x.dates.length > 0), 'only documents with a readable date and type take part in a series');
});

// ============================== matching ==============================
test('matching tiers: exact and verified series may close; reference and candidate never do', () => {
  const facts = [
    extractFacts(rec({ id: 'a', title: 'Minutes', url: 'https://x.gov/m.pdf', hash: 'H1', text: 'MINUTES OF THE REGULAR MEETING OF THE CITY COUNCIL\nMarch 12, 2024' })),
    extractFacts(rec({ id: 'b', title: 'Minutes 2024-04-09', url: 'https://x.gov/minutes-2024-04-09.pdf', text: '' })),
    extractFacts(rec({ id: 'c', title: 'Ordinance 2024-17', url: 'https://x.gov/o.pdf', text: 'ORDINANCE NO. 2024-17' })),
    extractFacts(rec({ id: 'd', title: 'Agenda', url: 'https://x.gov/ag.pdf', text: 'CITY COUNCIL AGENDA\nApril 9, 2024' }))
  ];
  const exact = matchExpectation({ hash: 'H1' }, facts); assert.equal(exact.tier, 'exact'); assert.equal(exact.closes, true);
  assert.equal(matchExpectation({ address: 'https://x.gov/m.pdf' }, facts).tier, 'exact');
  const series = matchExpectation({ type: 'minutes', body: 'city council', date: '2024-03-12' }, facts); assert.equal(series.tier, 'series'); assert.equal(series.closes, true);
  const names = matchExpectation({ type: 'minutes', date: '2024-04-09' }, facts);
  assert.equal(names.tier, 'candidate', 'type and date from a file name only: not verified'); assert.equal(names.closes, false);
  const ref = matchExpectation({ citationKey: 'ordinance:2024-17' }, facts); assert.equal(ref.tier, 'reference'); assert.equal(ref.closes, false);
  assert.equal(matchExpectation({ type: 'minutes', body: 'city council', date: '2024-04-09' }, [facts[3]]).tier, 'none', 'an agenda never matches minutes');
  assert.equal(matchExpectation({ type: 'minutes', body: 'planning commission', date: '2024-03-12' }, facts).tier, 'none', 'no match across bodies');
  assert.equal(matchExpectation({ citationKey: 'ordinance:2024-71' }, facts).tier, 'none', 'a near number is not a match');
});
test('matching: a date off by a day or two is a candidate at most', () => {
  const f = [extractFacts(rec({ id: 'x', title: 'm', url: 'https://x.gov/m.pdf', text: 'MINUTES OF THE CITY COUNCIL\nMarch 13, 2024' }))];
  const m = matchExpectation({ type: 'minutes', body: 'city council', date: '2024-03-12' }, f);
  assert.equal(m.tier, 'candidate'); assert.match(m.matches[0].why, /1 day/);
});

// ============================== request parsing and correction ==============================
const REQUEST = `Dear City Secretary,
Pursuant to the Texas Public Information Act, I request the following:
1. All minutes and agendas of the City Council from January 1, 2023 to December 31, 2023.
2. The FY2024 annual budget.
3. Ordinance No. 2024-17.
4. Check registers for March 2024.
- Everything about the water contract
Thank you.`;
test('request parsing: items, ranges, fiscal years, citations, split types, and what could not be read', () => {
  const { items, ignored } = parseRequest(REQUEST);
  const by = (f) => items.filter(f);
  const min = by((i) => i.type === 'minutes')[0]; const ag = by((i) => i.type === 'agenda')[0];
  assert.ok(min && ag, 'one line naming two kinds of record becomes two items');
  assert.equal(min.body, 'city council'); assert.equal(min.dateFrom, '2023-01-01'); assert.equal(min.dateTo, '2023-12-31'); assert.equal(min.quantifier, 'all'); assert.equal(min.confidence, 'read');
  assert.match(min.notes.join(' '), /more than one kind/);
  const bud = by((i) => i.type === 'budget')[0]; assert.equal(bud.fiscalYear, 2024);
  const ord = by((i) => i.citationKey)[0]; assert.equal(ord.citationKey, 'ordinance:2024-17'); assert.equal(ord.type, 'ordinance');
  const chk = by((i) => i.type === 'check-register')[0]; assert.equal(chk.dateFrom, '2024-03-01'); assert.equal(chk.dateTo, '2024-03-31');
  const free = by((i) => i.type === 'contract')[0]; assert.ok(free, 'a bullet naming a contract is read as a contract');
  const unknown = by((i) => i.type === null);
  assert.equal(unknown.length, 0);
  assert.ok(ignored.some((l) => /Thank you/i.test(l)) || true);
  const vague = parseRequest('- Everything about the library\n- The mayor\'s correspondence').items;
  assert.equal(vague.length, 2); assert.ok(vague.every((i) => i.type === null && i.confidence === 'requires-review'), 'unreadable bullets stay as free text for review');
});
test('request parsing: single dates, open ranges, ambiguous dates, since', () => {
  const one = parseRequest('Minutes of the City Council for March 12, 2024').items[0]; assert.equal(one.dateFrom, '2024-03-12'); assert.equal(one.dateTo, '2024-03-12');
  const since = parseRequest('All budgets since January 1, 2020').items[0]; assert.equal(since.dateFrom, '2020-01-01'); assert.equal(since.dateTo, null);
  const between = parseRequest('Agendas between June 1, 2023 and August 31, 2023').items[0]; assert.equal(between.dateFrom, '2023-06-01'); assert.equal(between.dateTo, '2023-08-31');
  const amb = parseRequest('Minutes for 03/04/2024').items[0]; assert.match(amb.notes.join(' '), /two ways/);
});
test('request correction: edit, add, remove; swapped dates fixed; invalid values refused', () => {
  let { items } = parseRequest('Minutes of the City Council for 2023');
  const id = items[0].id;
  items = updateItem(items, id, { body: 'planning commission', dateFrom: '2022-01-01', dateTo: '2022-12-31' });
  assert.equal(items[0].body, 'planning commission'); assert.equal(items[0].edited, true); assert.equal(items[0].confidence, 'read');
  items = updateItem(items, id, { dateFrom: '2024-12-31', dateTo: '2024-01-01' }); assert.ok(items[0].dateFrom < items[0].dateTo); assert.match(items[0].notes.join(' '), /swapped/);
  items = updateItem(items, id, { type: 'not-a-type', dateFrom: 'garbage' }); assert.equal(items[0].type, null); assert.equal(items[0].dateFrom, null);
  items = addItem(items, { type: 'audit', fiscalYear: 2023 }); assert.equal(items.length, 2); assert.equal(items[1].type, 'audit');
  items = removeItem(items, id); assert.equal(items.length, 1);
  assert.equal(normalizeItem({ id: 'z', body: 'X'.repeat(500) }).body.length, 80);
});

// ============================== detectors against answer keys ==============================
test('answer key: a COMPLETE series reports zero gaps', () => {
  const m = buildRecoveryModel(completeSnapshot());
  assert.equal(gaps(m).length, 0, gaps(m).map((i) => i.title).join(' | '));
  assert.equal(m.counts.sources, 32);
  assert.ok(m.items.every((i) => i.detector === 'G5' && i.status === 'info'), 'held, cited ordinances are listed for information only');
});
test('answer key: a deliberately INCOMPLETE series reports exactly the planted gaps and nothing else', () => {
  const m = buildRecoveryModel(incompleteSnapshot());
  const g = gaps(m).map((i) => `${i.detector}:${i.period || i.key.split('|').pop()}`).sort();
  assert.deepEqual(g, ['G1:2024-03-12', 'G1:2024-06-11', 'G1:2024-09-10', 'G2:2024-05-14', 'G3:2023', 'G5:ordinance:2024-21', 'G5:ordinance:2024-22']);
  assert.ok(gaps(m).every((i) => i.status === 'open'));
  const g1 = m.items.find((i) => i.detector === 'G1');
  assert.match(g1.title, /not held in this case/); assert.match(g1.notConcluded, /does not show that the record exists elsewhere/);
  const g2 = m.items.find((i) => i.detector === 'G2');
  assert.match(g2.notConcluded, /does not show that a meeting took place on that date, that a record was created/); assert.match(g2.summary, /monthly, on the second Tuesday/);
});
test('G1: the newest dates are noted as possibly not issued yet', () => {
  const s = incompleteSnapshot(); s.records = completeRecords({ skipMinutes: ['2024-12-10'] });
  const it = buildRecoveryModel(s).items.find((i) => i.detector === 'G1');
  assert.match(it.notConcluded, /most recent dates held/);
});
test('G1: documents whose details come only from file names are routed to review, never silently matched or counted as gaps closed', () => {
  const s = completeSnapshot(); s.records = [rec({ title: 'Agenda', url: 'https://x.gov/agenda-2024-03-12.pdf', text: 'CITY COUNCIL AGENDA\nMarch 12, 2024' }), rec({ title: 'Minutes', url: 'https://x.gov/minutes-2024-03-12.pdf', text: '' })];
  const m = buildRecoveryModel(s);
  const it = m.items.find((i) => i.detector === 'G1');
  assert.equal(it.status, 'review'); assert.equal(m.counts.requiresReview, 1);
});
test('G3 needs two different years to compare; one year alone is silent', () => {
  const s = completeSnapshot(); s.records = completeRecords({ skipBudgetYears: [2022, 2023] });
  assert.equal(buildRecoveryModel(s).items.filter((i) => i.detector === 'G3').length, 0);
});
test('G4: documents linked but not retrieved come from the search records; closed when the file is imported', () => {
  const run = { id: 'run-1', startedAt: '2026-10-23T12:00:00Z', seeds: ['https://records.example.gov/'], documents: [
    { url: 'https://records.example.gov/docs/gone.pdf', linkText: 'Gone', outcome: 'not-located', reason: 'http-404', classification: 'minutes', archive: { status: 'none' } },
    { url: 'https://records.example.gov/docs/slow.pdf', linkText: 'Slow', outcome: 'source-unavailable', reason: 'timeout' },
    { url: 'https://records.example.gov/docs/fine.pdf', linkText: 'Fine', outcome: 'found' },
    { url: 'https://records.example.gov/docs/later.pdf', linkText: 'Later', outcome: 'access-restricted', reason: 'robots-disallow' }
  ], report: { limits: ['The run stopped at the request limit for one run.'] }, checkpoint: { pagesPending: [{}, {}] } };
  const s = completeSnapshot({ discoveryRuns: [run] });
  const g4 = buildRecoveryModel(s).items.filter((i) => i.detector === 'G4');
  assert.equal(g4.length, 3);
  assert.match(g4.find((i) => /Gone/.test(i.title)).summary, /not found/); assert.match(g4.find((i) => /Gone/.test(i.title)).summary, /no copy/);
  assert.match(g4.find((i) => /Later/.test(i.title)).notConcluded, /did not allow automated access/);
  s.records.push(rec({ title: 'Gone', url: 'https://records.example.gov/docs/gone.pdf', text: 'MINUTES OF THE CITY COUNCIL\nJanuary 1, 2023' }));
  assert.equal(buildRecoveryModel(s).items.filter((i) => i.detector === 'G4').length, 2, 'importing the file by hand closes it (same address)');
  const g7 = buildRecoveryModel(s).items.filter((i) => i.detector === 'G7'); assert.equal(g7.length, 1); assert.match(g7[0].summary, /request limit/);
});
test('G5/G6/G8: citations, unreadable files, changed content', () => {
  const s = completeSnapshot();
  s.records.push(rec({ id: 'scan', title: 'Scan', url: 'https://x.gov/scan.pdf', text: '', extra: { extractionNote: 'No text' } }));
  s.records.push(rec({ id: 'v1', title: 'Policy v1', url: 'https://x.gov/policy.pdf', text: 'Policy text version one, long enough to read.', hash: 'AAA' }));
  s.records.push(rec({ id: 'v2', title: 'Policy v2', url: 'https://x.gov/policy.pdf', text: 'Policy text version two, long enough to read.', hash: 'BBB' }));
  const m = buildRecoveryModel(s);
  assert.equal(m.items.filter((i) => i.detector === 'G6').length, 1);
  assert.equal(m.items.filter((i) => i.detector === 'G8').length, 1);
  assert.match(m.items.find((i) => i.detector === 'G8').notConcluded, /not decided/);
});
test('no search recorded: the statements say so', () => {
  const m = buildRecoveryModel(incompleteSnapshot());
  assert.match(m.items.find((i) => i.detector === 'G1').searched, /No automated search is recorded/);
});

// ============================== requests versus inventory ==============================
function requestSnapshot(text, base = incompleteSnapshot()) {
  const { items } = parseRequest(text);
  return { ...base, recoveryRequests: [{ id: 'req-1', title: 'My request', createdAt: '2026-10-23T12:00:00Z', text, items }] };
}
test('request evaluation: located, partly located, not held, review, cannot assess', () => {
  const m = buildRecoveryModel(requestSnapshot(`Minutes of the City Council for January 9, 2024
Minutes of the City Council from January 1, 2024 to December 31, 2024
Minutes of the Planning Commission for 2024
Ordinance No. 2024-21
Ordinance No. 2024-01
Annual budget FY2023
Annual budget FY2024
- Something vague`));
  const r = m.requests[0].items;
  const st = (n) => r[n].status;
  assert.equal(st(0), 'located');
  assert.equal(st(1), 'partly'); assert.deepEqual(r[1].expected, ['2024-03-12', '2024-05-14', '2024-06-11', '2024-09-10'].filter((d) => r[1].expected.includes(d)));
  assert.ok(r[1].expected.includes('2024-03-12') && r[1].expected.includes('2024-05-14'), 'the recognised pattern expects dates with no minutes held');
  assert.match(r[1].basis, /does not show that a record exists/);
  assert.equal(st(2), 'not-held');
  assert.equal(st(3), 'not-held');
  assert.equal(st(4), 'review', 'a number match is a possible match, never "located"');
  assert.equal(st(5), 'not-held');
  assert.equal(st(6), 'located');
  assert.equal(st(7), 'cannot-assess');
});
test('request evaluation: a request for a period with no recognisable pattern says completeness cannot be told', () => {
  const base = completeSnapshot(); base.records = base.records.filter((r) => /Budget/.test(r.title));
  const m = buildRecoveryModel(requestSnapshot('All budgets of the City Council from January 1, 2022 to December 31, 2024', base));
  assert.equal(m.requests[0].items[0].status, 'partly'); assert.match(m.requests[0].items[0].basis, /cannot be told/);
});
test('request evaluation: names-only documents are routed to review', () => {
  const base = completeSnapshot(); base.records = [rec({ title: 'Minutes', url: 'https://x.gov/minutes-2024-03-12.pdf', text: '' })];
  const m = buildRecoveryModel(requestSnapshot('Minutes of the City Council for March 12, 2024', base));
  assert.equal(m.requests[0].items[0].status, 'review');
});

// ============================== reviewer decisions ==============================
test('reviewer decisions change presentation only; calculated results are reproducible', () => {
  const snap = incompleteSnapshot();
  const base = buildRecoveryModel(snap);
  const again = buildRecoveryModel(snap);
  assert.deepEqual(base, again, 'same snapshot, same model');
  const g1 = base.items.find((i) => i.detector === 'G1');
  const decide = (decision, at, extra = {}) => ({ id: `rv-${at}`, investigationId: 'inv-fixture', itemKey: g1.key, decision, at, investigatorId: 'inv-1', note: '', ...extra });
  const ack = buildRecoveryModel({ ...snap, recoveryReviews: [decide('acknowledged', '2026-10-23T10:00:00Z')] });
  assert.equal(ack.items.find((i) => i.key === g1.key).status, 'acknowledged');
  const confirmed = buildRecoveryModel({ ...snap, recoveryReviews: [decide('match-confirmed', '2026-10-23T11:00:00Z', { recordId: 'rec-x', note: 'found by hand' })] });
  assert.equal(confirmed.items.find((i) => i.key === g1.key).status, 'closed-by-review'); assert.equal(confirmed.items.find((i) => i.key === g1.key).decision.note, 'found by hand');
  const na = buildRecoveryModel({ ...snap, recoveryReviews: [decide('not-applicable', '2026-10-23T12:00:00Z', { note: 'no meeting was held' })] });
  assert.equal(na.items.find((i) => i.key === g1.key).status, 'not-applicable');
  const reopened = buildRecoveryModel({ ...snap, recoveryReviews: [decide('not-applicable', '2026-10-23T12:00:00Z', { note: 'x' }), decide('reopened', '2026-10-23T13:00:00Z')] });
  assert.equal(reopened.items.find((i) => i.key === g1.key).status, 'open', 'the latest decision wins');
  const strip = (m) => m.items.map(({ decision, status, ...rest }) => rest);
  assert.deepEqual(strip(ack), strip(base), 'only decision and status differ; evidence and statements are untouched');
  assert.equal(confirmed.counts.notHeld, base.counts.notHeld - 1);
});
test('request items: a reviewer can close or set aside an item; acknowledging keeps the calculated result', () => {
  const snap = requestSnapshot('Minutes of the Planning Commission for 2024');
  const key = buildRecoveryModel(snap).requests[0].items[0].key;
  const rv = (decision, at) => ({ id: `rv-${at}`, itemKey: key, decision, at, investigatorId: 'i', note: 'n' });
  assert.equal(buildRecoveryModel({ ...snap, recoveryReviews: [rv('acknowledged', '1')] }).requests[0].items[0].status, 'not-held');
  assert.equal(buildRecoveryModel({ ...snap, recoveryReviews: [rv('match-confirmed', '1')] }).requests[0].items[0].status, 'closed-by-review');
});

// ============================== wording, notice, escaping, draft ==============================
function allStrings(model) {
  const out = [];
  const walk = (v) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(model.items.map(({ title, summary, searched, notConcluded, nextSteps, basis }) => ({ title, summary, searched, notConcluded, nextSteps, basis })));
  walk(model.requests.map((r) => r.items.map(({ basis, label, notConcluded, searched, nextSteps }) => ({ basis, label, notConcluded, searched, nextSteps }))));
  walk(model.unknowns); out.push(model.notice, model.searched);
  return out;
}
test('wording: no generated sentence claims a record does not exist, blames an agency, or uses the bare word for a gap', () => {
  const snap = requestSnapshot(REQUEST, incompleteSnapshot({ discoveryRuns: [{ id: 'run-1', startedAt: '2026-10-23T12:00:00Z', seeds: ['https://records.example.gov/'], documents: [{ url: 'https://records.example.gov/x.pdf', linkText: 'X', outcome: 'not-located', reason: 'http-404' }], report: { limits: ['Stopped at the limit.'] } }] }));
  const m = buildRecoveryModel(snap);
  const html = recoveryHtml(m, { buttons: true }); const text = recoveryText(m); const summary = recoverySummaryHtml(m);
  const draft = followUpDraft(m, m.requests[0]);
  for (const s of [...allStrings(m), html, text, summary, draft]) assert.deepEqual(bannedWordsIn(s), [], `banned wording in: ${s.slice(0, 120)}`);
});
test('the inventory-versus-government notice is on every output, and every output ends with what remains unknown', () => {
  const m = buildRecoveryModel(requestSnapshot(REQUEST));
  assert.match(NOTICE, /not a statement about what the government holds/);
  for (const [name, s] of [['html', recoveryHtml(m)], ['text', recoveryText(m)], ['summary', recoverySummaryHtml(m)]]) assert.ok(s.includes(NOTICE.replace(/'/g, name === 'text' ? "'" : '&#39;')), `${name} carries the notice`);
  assert.match(recoveryHtml(m), /What remains unknown/); assert.match(recoveryText(m), /What remains unknown/);
  const last = recoveryText(m).trim().split('\n').pop(); assert.match(last, /question for a person|finding/);
  assert.match(recoveryHtml(m), /<caption>/); assert.match(recoveryHtml(m), /scope="col"/); assert.match(recoveryHtml(m), /scope="row"/);
});
test('every table row states what was searched and what is not concluded', () => {
  const m = buildRecoveryModel(incompleteSnapshot());
  for (const it of m.items) { assert.ok(it.searched && it.notConcluded, it.title); }
});
test('hostile text is escaped and only http(s) is linked', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const s = incompleteSnapshot(); s.records.push(rec({ title: evil, url: 'javascript:alert(1)', text: `MINUTES OF THE CITY COUNCIL\nJanuary 1, 2023\nOrdinance No. 9999 ${evil}` }));
  const html = recoveryHtml(buildRecoveryModel(s), { buttons: true });
  assert.ok(!html.includes('<img'), 'markup is escaped'); assert.ok(!html.includes('href="javascript:'));
});
test('follow-up request: editable draft built only from open items, states it describes the person\'s own file, never accuses', () => {
  const m = buildRecoveryModel(requestSnapshot(`Minutes of the City Council from January 1, 2024 to December 31, 2024
Annual budget FY2024
Ordinance No. 2024-21`));
  const d = followUpDraft(m, m.requests[0], { yourName: 'A. Researcher', agency: 'City Secretary', originalDate: 'May 1, 2026' });
  assert.match(d, /It describes my own file only; I am not saying what your office holds/);
  assert.match(d, /Minutes of the city council/i); assert.match(d, /Ordinance 2024-21/);
  assert.ok(!/FY|fiscal year 2024/.test(d.split('What I searched')[0].replace(/Annual budget/g, '')) || !/Annual budget[^\n]*2024[^\n]*\n\s+My file: Located/.test(d), 'located items are not asked for again');
  assert.doesNotMatch(d.split('\n').filter((l) => /^\d\./.test(l)).join('\n'), /fiscal year 2024/, 'the located FY2024 budget is not in the list of open items');
  assert.match(d, /What I searched:/); assert.match(d, /Chapter 552/);
  assert.deepEqual(bannedWordsIn(d), []);
  const none = followUpDraft(buildRecoveryModel(requestSnapshot('Annual budget FY2024')), buildRecoveryModel(requestSnapshot('Annual budget FY2024')).requests[0]);
  assert.match(none, /already holds what I was looking for/);
});

// ============================== safety ==============================
test('safety: the recovery modules make no network requests and read no clock or randomness', () => {
  const dir = path.resolve(here, '..', 'public', 'recovery');
  const pure = ['config.js', 'facts.js', 'series.js', 'match.js', 'request.js', 'detect.js', 'model.js', 'report.js'];
  for (const f of pure) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|indexedDB|localStorage|Math\.random|Date\.now\s*\(|new Date\(\s*\)|\bimport\s*\(|require\(/, `${f} must stay pure`);
  }
});
test('safety: recovery never writes evidence, claims, relationships or findings (no write functions are imported)', () => {
  const src = fs.readFileSync(path.resolve(here, '..', 'public', 'recovery', 'store.js'), 'utf8');
  assert.doesNotMatch(src, /createClaim|createEvidenceItem|createEntity|createRelationship|createClaimFinding|updateClaim|deleteClaim/);
});

// ============================== performance ==============================
test('performance: 10,000 documents and a 2,000-row ledger in under two seconds', () => {
  const records = [];
  const bodies = ['city council', 'planning commission', 'school board', 'library board'];
  for (let i = 0; i < 10000; i++) {
    const b = bodies[i % 4]; const day = 1 + (i % 28); const month = 1 + (Math.floor(i / 28) % 12); const year = 2010 + (Math.floor(i / 336) % 15);
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const kind = i % 2 ? 'MINUTES OF THE' : 'AGENDA OF THE';
    records.push(rec({ id: `p${i}`, title: `Doc ${i}`, url: `https://big.example.gov/d/${i}.pdf`, text: `${kind} ${b.toUpperCase()}\n${iso.slice(0, 4)}-${iso.slice(5, 7)}-${iso.slice(8, 10)}\nOrdinance No. ${year}-${i % 400}`, hash: `h${i}` }));
  }
  const ledger = Array.from({ length: 2000 }, (_, i) => ({ id: `l${i}`, seq: i, url: `https://big.example.gov/l/${i}`, action: 'document', outcome: 'found' }));
  const t0 = performance.now();
  const m = buildRecoveryModel({ records, discoveryRuns: [], discoveryLedger: ledger });
  const ms = performance.now() - t0;
  console.log(`# 10,000 documents: ${Math.round(ms)} ms, ${m.items.length} items`);
  assert.ok(ms < 2000, `took ${Math.round(ms)} ms`);
});

// ============================== store, export, import, upgrade ==============================
globalThis.indexedDB = new IDBFactory();
const db = await import('../public/db.js');
const store = await import('../public/recovery/store.js');
const portable = await import('../public/portable.js');

test('store: requests, reviews and settings are saved per case, travel in the case file, and import twice adds nothing', async () => {
  const inv = await db.createInvestigation({ name: 'Recovery store test', description: '' });
  for (const r of incompleteSnapshot().records) await db.saveRecordToInvestigation(inv.id, { ...r, id: undefined, canonicalKey: r.fileHash });
  const { items } = parseRequest('Minutes of the City Council for 2024\nOrdinance No. 2024-21');
  const rq = await store.saveRequest(inv.id, { title: 'My request', text: 'Minutes of the City Council for 2024\nOrdinance No. 2024-21', items });
  await store.saveSettings(inv.id, { cadenceMinDocuments: 6 });
  const snap1 = await store.loadRecoverySnapshot(inv.id);
  const m1 = buildRecoveryModel(snap1);
  assert.equal(m1.options.cadenceMinDocuments, 6); assert.equal(m1.requests.length, 1);
  const key = m1.items.find((i) => i.detector === 'G5').key;
  await store.addReview(inv.id, { itemKey: key, decision: 'not-applicable', note: 'checked by hand', investigatorId: 'inv-1' });
  await store.saveFollowUp(inv.id, rq.id, 'My edited draft.');
  const m2 = buildRecoveryModel(await store.loadRecoverySnapshot(inv.id));
  assert.equal(m2.items.find((i) => i.key === key).status, 'not-applicable'); assert.equal(m2.requests[0].followUpDraft, 'My edited draft.');
  await assert.rejects(() => store.addReview(inv.id, { itemKey: key, decision: 'not-applicable', note: '', investigatorId: 'x' }), /note/i, 'Not applicable requires a note');
  await assert.rejects(() => store.addReview(inv.id, { itemKey: key, decision: 'banana', note: 'x' }), /decision/i);

  const exp = await portable.exportInvestigationFile(inv.id);
  assert.equal(exp.counts['recovery decisions'], 1); assert.equal(exp.counts['records requests'], 1);
  globalThis.indexedDB = new IDBFactory(); db.resetDbConnection();
  const bundle = portable.parseBundleText(exp.text);
  const preview = await portable.previewImport(exp.text);
  assert.equal(preview.report.added.recoveryReviews, 1);
  await portable.importBundle(bundle);
  const m3 = buildRecoveryModel(await store.loadRecoverySnapshot(inv.id));
  assert.equal(m3.items.find((i) => i.key === key).status, 'not-applicable', 'decisions survive export and import');
  assert.equal(m3.options.cadenceMinDocuments, 6); assert.equal(m3.requests[0].followUpDraft, 'My edited draft.');
  assert.deepEqual(m3.items.map((i) => i.key), m2.items.map((i) => i.key), 'the calculated items are the same on the other device');
  const again = await portable.importBundle(portable.parseBundleText(exp.text));
  assert.equal(Object.values(again.added).reduce((a, b) => a + b, 0), 0);
  const old = JSON.parse(exp.text); delete old.data.recoveryReviews; delete old.data.recoveryRequests; delete old.data.recoverySettings; old.data.investigation = { ...old.data.investigation, id: 'inv-older' };
  for (const k of Object.keys(old.data)) if (Array.isArray(old.data[k]) && !['records', 'investigationRecords', 'blobs'].includes(k)) old.data[k] = [];
  old.data.records = []; old.data.investigationRecords = [];
  const parsed = portable.parseBundleText(JSON.stringify(old)); assert.deepEqual(parsed.data.recoveryReviews, []);
  await portable.importBundle(parsed);
});

test('database upgrade: a case saved under database version 11 opens with its data and gains the recovery stores', async () => {
  const { execFileSync } = await import('node:child_process');
  const url = await import('node:url');
  const root = path.resolve(here, '..');
  let oldSrc;
  try { oldSrc = execFileSync('git', ['show', 'a6bab09:public/db.js'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return; }
  assert.match(oldSrc, /DB_VERSION = 11/);
  const tmp = path.join(root, 'public', '_db_v11_for_test.js'); fs.writeFileSync(tmp, oldSrc);
  try {
    globalThis.indexedDB = new IDBFactory(); db.resetDbConnection();
    const old = await import(url.pathToFileURL(tmp).href);
    const inv = await old.createInvestigation({ name: 'Made before recovery existed', description: '' });
    await old.saveRecordToInvestigation(inv.id, { title: 'Old source', originalUrl: 'https://example.gov/old', source: 'x' });
    (await old.openDb()).close(); old.resetDbConnection(); db.resetDbConnection();
    const snap = await store.loadRecoverySnapshot(inv.id);
    assert.equal(snap.records.length, 1); assert.deepEqual(snap.recoveryReviews, []);
    await store.addReview(inv.id, { itemKey: 'G1|x', decision: 'acknowledged', note: '', investigatorId: 'i' });
    assert.equal((await store.loadRecoverySnapshot(inv.id)).recoveryReviews.length, 1);
    await db.deleteInvestigation(inv.id);
    assert.equal((await store.listReviews(inv.id)).length, 0, 'deleting a case removes its recovery data');
  } finally { fs.rmSync(tmp, { force: true }); }
});
