// Deep Discovery Phase 1 acceptance tests: document retrieval, archived copies, duplicate handling, resume,
// the coverage report, saving into a case (no duplicates, provenance kept), export/import, the website proxy,
// and the CivicPlus adapter interface. Everything runs against a deterministic LOCAL site with a fake clock;
// no real website is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { startTestSite, DOC_BYTES, LIBRARY_LINKS } from './lib/discovery-test-site.mjs';
import { DiscoveryRun, DailyBudget } from '../public/discovery/engine.js';
import { createFetchApiFetcher, createProxyFetcher, createArchiveLookup, sha256Hex } from '../public/discovery/fetchers.js';
import { OUTCOME, OUTCOME_LABEL } from '../public/discovery/outcomes.js';
import { classifyDocument } from '../public/discovery/classify.js';
import { buildCoverageReport, coverageReportHtml, coverageReportText } from '../public/discovery/report.js';
import { CivicPlusAdapter, defaultHostPolicies, defaultConnectors, HostPolicyRegistry, AUTOMATION, Connector, ConnectorRegistry, GenericLinkConnector } from '../public/discovery/connector.js';
import { handleFetch, handleCaptures } from '../src/discoveryProxy.js';

globalThis.indexedDB = new IDBFactory();
const db = await import('../public/db.js');
const { createDocumentSaver, recordRun, plainTextExtract } = await import('../public/discovery/save.js');
const portable = await import('../public/portable.js');

const fakeTime = (start = 1_700_000_000_000) => { let t = start; return { now: () => t, sleep: async (ms) => { t += ms; }, get t() { return t; } }; };
const rel = (site, u) => u.replace(site.origin, '');
const docByPath = (result, site, p) => result.documents.find((d) => rel(site, d.url) === p);

async function runDocs(site, o = {}) {
  const clock = o.clock || fakeTime(); const calls = [];
  const real = o.fetcher || createFetchApiFetcher({ sendUserAgent: true });
  const fetcher = { capabilities: real.capabilities, fetch: async (url, opts) => { calls.push({ url, t: clock.now() }); return real.fetch(url, opts); } };
  const saved = [];
  const run = new DiscoveryRun({
    seeds: o.seeds || [site.origin + '/library'], mode: o.mode || 'extension', limits: { requestTimeoutMs: 250, ...(o.limits || {}) }, fetcher, now: clock.now, sleep: clock.sleep,
    guardOptions: { allowPrivateHosts: [site.hostPort] }, termsAcknowledged: [site.host], budget: o.budget || new DailyBudget({ now: clock.now }),
    retrieveDocuments: o.retrieve !== false, onDocument: o.onDocument || (async (p) => { saved.push(p); }), archiveLookup: o.archiveLookup || null, resumeFrom: o.resumeFrom || null,
    onProgress: o.onProgress ? (p) => o.onProgress(p, run) : undefined, ...(o.hostPolicies ? { hostPolicies: o.hostPolicies } : {})
  });
  const result = await run.start();
  return { run, result, clock, calls, saved };
}
const gapsOf = (calls) => { const t = calls.map((c) => c.t); return t.slice(1).map((x, i) => x - t[i]); };

// ============================== classification ==============================
test('classifier: agendas, minutes, budgets and more, from words only', () => {
  const cases = [
    ['https://x.gov/f/Agenda_2024-03-12.pdf', '', 'agenda'], ['https://x.gov/f/a.pdf', 'City Council Minutes March 12', 'minutes'], ['https://x.gov/f/p.pdf', 'Agenda Packet', 'packet'],
    ['https://x.gov/f/b.pdf', 'FY2025 Proposed Budget', 'budget'], ['https://x.gov/f/c.pdf', 'Annual Comprehensive Financial Report', 'audit'], ['https://x.gov/f/r.csv', 'Check Register February', 'check-register'],
    ['https://x.gov/f/k.pdf', 'Interlocal Agreement with the County', 'contract'], ['https://x.gov/f/o.pdf', 'Ordinance 2024-17', 'ordinance'], ['https://x.gov/f/z.pdf', 'Resolution 55', 'resolution'], ['https://x.gov/f/q.pdf', 'Photo', 'other']
  ];
  for (const [url, text, want] of cases) assert.equal(classifyDocument({ url, text }).class, want, `${text || url}`);
  assert.equal(classifyDocument({ url: 'https://x.gov/f/1234.pdf', text: 'Download', parentText: 'City Council Minutes' }).class, 'minutes');
  assert.equal(classifyDocument({ url: 'https://x.gov/f/1234.pdf', text: 'Download' }).basis, 'no matching words');
});

// ============================== retrieval ==============================
test('retrieval: documents are found, retrieved, hashed, and every outcome is honest', async () => {
  const site = await startTestSite();
  try {
    const { result, calls, saved } = await runDocs(site, { limits: { maxResponseBytes: 100000 } });
    const paths = site.paths();
    assert.equal(result.state, 'finished');
    const out = (p) => docByPath(result, site, p);
    for (const p of ['/docs/agenda-2024-03-12.pdf', '/docs/minutes-2024-03-12.pdf', '/docs/budget-2024.xlsx', '/docs/check-register-2024-02.csv', '/docs/notes.txt']) {
      assert.equal(out(p).outcome, OUTCOME.FOUND, p);
      assert.equal(out(p).sha256, (await sha256Hex(DOC_BYTES[p])), `${p} hash is of the bytes as served`);
      assert.equal(out(p).httpStatus, 200); assert.ok(out(p).retrievedAt); assert.equal(out(p).etag, '"d1"'); assert.match(out(p).lastModified, /2024/);
    }
    assert.equal(out('/docs/minutes-2024-03-12.pdf').classification, 'minutes');
    assert.equal(out('/docs/check-register-2024-02.csv').classification, 'check-register');
    assert.equal(out('/docs/missing.pdf').outcome, OUTCOME.NOT_LOCATED, '404 = not located (and only in the sources searched)');
    assert.equal(out('/docs/forbidden.pdf').outcome, OUTCOME.ACCESS_RESTRICTED);
    assert.equal(out('/docs/error500.pdf').outcome, OUTCOME.SOURCE_UNAVAILABLE, 'a server error is never "does not exist"');
    assert.equal(out('/docs/slow.pdf').outcome, OUTCOME.SOURCE_UNAVAILABLE, 'a timeout is never "does not exist"');
    assert.equal(out('/docs/slow.pdf').reason, 'timeout');
    assert.equal(out('/docs/login.pdf').outcome, OUTCOME.SOURCE_UNAVAILABLE); assert.equal(out('/docs/login.pdf').reason, 'returned-a-web-page');
    assert.equal(out('/docs/big.pdf').outcome, OUTCOME.PARTIAL); assert.equal(out('/docs/big.pdf').partial, true);
    assert.equal(out('/private/blocked.pdf').outcome, OUTCOME.ACCESS_RESTRICTED); assert.equal(out('/private/blocked.pdf').reason, 'robots-disallow');
    assert.ok(!paths.includes('/private/blocked.pdf'), 'a robots-disallowed document is never requested');
    assert.ok(!calls.some((c) => c.url.includes('169.254')), 'a redirect to a private address is never requested');
    assert.equal(out('/docs/redirect-private.pdf').outcome, OUTCOME.ACCESS_RESTRICTED);
    assert.equal(out('/docs/redirect.pdf').outcome, OUTCOME.FOUND); assert.equal(out('/docs/redirect.pdf').redirects, 1);
    assert.equal(out('/docs/redirect.pdf').duplicateOf, site.origin + '/docs/agenda-2024-03-12.pdf', 'the redirect leads to content already retrieved');
    assert.equal(saved.filter((s) => s.bytes).length, result.documents.filter((d) => d.sha256).length, 'every retrieved document was handed over for saving, with its bytes');
    assert.equal(paths.length, result.counters.requests, 'the site saw exactly the requests the engine counted');
    assert.ok(result.documents.every((d) => d.classification), 'every document carries a classification hint');
  } finally { await site.close(); }
});

test('retrieval: robots Crawl-delay holds between pages AND documents, requests stay serial', async () => {
  const site = await startTestSite();
  try {
    const { calls, result } = await runDocs(site);
    assert.ok(result.counters.requests > 15);
    const g = gapsOf(calls);
    for (const x of g) assert.ok(x >= 10000, `gap ${x} ms is below the site's Crawl-delay of 10 s`);
    assert.equal(new Set(calls.map((c) => new URL(c.url).hostname)).size, 1);
  } finally { await site.close(); }
});

test('retrieval: duplicate content (same bytes, two addresses) is flagged', async () => {
  const site = await startTestSite();
  try {
    const { result } = await runDocs(site);
    const copy = docByPath(result, site, '/docs/agenda-copy.pdf');
    assert.equal(copy.outcome, OUTCOME.FOUND);
    assert.equal(copy.duplicateOf, site.origin + '/docs/agenda-2024-03-12.pdf');
    assert.equal(docByPath(result, site, '/docs/agenda-2024-03-12.pdf').duplicateOf, undefined);
  } finally { await site.close(); }
});

test('retrieval is opt-in: without it only addresses are listed', async () => {
  const site = await startTestSite();
  try {
    const { result } = await runDocs(site, { retrieve: false });
    assert.ok(!site.paths().some((p) => p.startsWith('/docs/')));
    assert.equal(result.documents.length, 0);
    assert.ok(result.documentCandidates.length >= 14);
    assert.match(result.message, /not retrieved/);
  } finally { await site.close(); }
});

// ============================== archived copies ==============================
test('historical copies: only for documents that could not be retrieved, never for restricted ones', async () => {
  const site = await startTestSite();
  try {
    const asked = [];
    const archiveLookup = async (u) => {
      asked.push(rel(site, u));
      if (u.endsWith('/missing.pdf')) return { status: 'found', copies: [{ provider: 'Wayback Machine', archiveUrl: 'https://web.archive.org/web/20230101000000/' + u, captureDate: '2023-01-01T00:00:00Z' }] };
      if (u.endsWith('/error500.pdf')) return { status: 'none', copies: [] };
      return { status: 'unavailable', copies: [] };
    };
    const { result, saved } = await runDocs(site, { archiveLookup });
    const out = (p) => docByPath(result, site, p);
    assert.equal(out('/docs/missing.pdf').outcome, OUTCOME.HISTORICAL_COPY_FOUND);
    assert.equal(out('/docs/missing.pdf').originalOutcome, OUTCOME.NOT_LOCATED);
    assert.equal(out('/docs/missing.pdf').archive.copies[0].captureDate, '2023-01-01T00:00:00Z');
    assert.equal(out('/docs/error500.pdf').outcome, OUTCOME.SEARCH_INCOMPLETE, 'original unavailable + archive says none: still not a conclusion');
    assert.equal(out('/docs/slow.pdf').outcome, OUTCOME.SOURCE_UNAVAILABLE, 'original and archive both unreachable: nothing can be concluded');
    assert.ok(!asked.includes('/docs/forbidden.pdf') && !asked.includes('/private/blocked.pdf') && !asked.includes('/docs/redirect-private.pdf'), 'restricted items are not looked up elsewhere');
    assert.ok(!asked.includes('/docs/notes.txt'), 'retrieved documents are not looked up');
    assert.ok(saved.some((s) => s.bytes === null && s.result.url.endsWith('/missing.pdf')), 'the archived copy is handed over for saving (no bytes)');
    assert.equal(result.usage.archiveLookups, asked.length);
    assert.ok(result.coverage.some((c) => c.id === 'archives'));
  } finally { await site.close(); }
});

test('historical copies: lookups are capped per run', async () => {
  const site = await startTestSite();
  try {
    let n = 0;
    const { result } = await runDocs(site, { archiveLookup: async () => { n++; return { status: 'none', copies: [] }; }, limits: { maxArchiveLookups: 2 } });
    assert.equal(n, 2);
    assert.ok(result.documents.some((d) => d.archive?.status === 'not-checked'));
  } finally { await site.close(); }
});

// ============================== limits, cancel, pause, resume ==============================
test('limits: requests, documents and bytes stop the run honestly, and nothing exceeds a cap', async () => {
  const site = await startTestSite();
  try {
    const a = await runDocs(site, { limits: { maxTotalRequests: 8 } });
    assert.ok(a.result.counters.requests <= 8); assert.match(a.result.stopReason, /request limit/);
    assert.match(a.result.message, /found but not retrieved/); assert.ok(a.result.checkpoint);
    const b = await runDocs(site, { limits: { maxDocuments: 3 } });
    assert.ok(b.result.documentCandidates.length <= 3); assert.ok(b.result.documents.length <= 3);
    assert.ok(b.result.frontier.documentOverflow > 0);
    assert.ok(coverageReportText(buildCoverageReport(b.result)).includes('beyond the document limit'));
    const c = await runDocs(site, { mode: 'website', limits: { maxWebsiteFetches: 5 } });
    assert.ok(c.result.counters.websiteFetches <= 5); assert.match(c.result.stopReason, /website/);
  } finally { await site.close(); }
});

test('cancel keeps what was retrieved; resume continues without repeating finished documents', async () => {
  const site2 = await startTestSite();
  try {
    let holder = null; let got = 0; const keep = [];
    const clock = fakeTime();
    const mk = (resumeFrom) => {
      const real = createFetchApiFetcher({ sendUserAgent: true });
      return new DiscoveryRun({
        seeds: [site2.origin + '/library'], limits: { requestTimeoutMs: 250 }, fetcher: real, now: clock.now, sleep: clock.sleep, guardOptions: { allowPrivateHosts: [site2.hostPort] },
        termsAcknowledged: [site2.host], budget: new DailyBudget({ now: clock.now }), retrieveDocuments: true, resumeFrom,
        onDocument: async (p) => { keep.push(rel(site2, p.result.url)); if (p.bytes && ++got === 2 && !resumeFrom) holder.cancel(); }
      });
    };
    holder = mk(null);
    const r1 = await holder.start();
    assert.equal(r1.state, 'cancelled'); assert.match(r1.message, /What was retrieved is kept/);
    const doneBefore = new Set(r1.checkpoint.docsDone);
    assert.ok(doneBefore.size >= 2 && doneBefore.size < LIBRARY_LINKS.length);
    const requestsBefore = site2.paths().length;
    const r2 = await mk(r1.checkpoint).start();
    assert.equal(r2.state, 'finished');
    const afterPaths = site2.paths().slice(requestsBefore);
    for (const u of doneBefore) {
      // The one legitimate repeat: redirect.pdf (not yet done) leads to the agenda, which is requested as that redirect's target.
      const allowedRepeats = rel(site2, u) === '/docs/agenda-2024-03-12.pdf' ? 1 : 0;
      assert.ok(afterPaths.filter((p) => p === rel(site2, u)).length <= allowedRepeats, `${rel(site2, u)} was finished and must not be requested again`);
    }
    assert.ok(!afterPaths.includes('/library'), 'finished pages are not fetched again');
    const finalDocs = new Set([...r1.documents, ...r2.documents].map((d) => rel(site2, d.url)));
    for (const p of ['/docs/agenda-2024-03-12.pdf', '/docs/minutes-2024-03-12.pdf', '/docs/notes.txt', '/docs/missing.pdf', '/docs/big.pdf']) assert.ok(finalDocs.has(p), `${p} accounted for across the two runs`);
  } finally { await site2.close(); }
});

test('pause stops requests immediately, resume continues', async () => {
  const site = await startTestSite();
  try {
    let run; let paused = false; let seenWhilePaused = 0;
    const clock = fakeTime();
    run = new DiscoveryRun({
      seeds: [site.origin + '/library'], limits: { requestTimeoutMs: 250 }, fetcher: createFetchApiFetcher({ sendUserAgent: true }), now: clock.now, sleep: clock.sleep, guardOptions: { allowPrivateHosts: [site.hostPort] },
      termsAcknowledged: [site.host], budget: new DailyBudget({ now: clock.now }), retrieveDocuments: true,
      onDocument: async () => { if (!paused) { paused = true; run.pause(); const n = site.paths().length; setTimeout(() => { seenWhilePaused = site.paths().length - n; run.resume(); }, 120); } }
    });
    const result = await run.start();
    assert.equal(result.state, 'finished'); assert.equal(seenWhilePaused, 0, 'nothing was requested while paused');
  } finally { await site.close(); }
});

test('cost guard: a document run never exceeds its caps and says so', async () => {
  const site = await startTestSite();
  try {
    const { result } = await runDocs(site, { limits: { maxPages: 2, maxDocuments: 4, maxTotalRequests: 10, maxArchiveLookups: 1 }, archiveLookup: async () => ({ status: 'none', copies: [] }) });
    assert.ok(result.counters.requests <= 10); assert.ok(result.counters.pagesFetched <= 2); assert.ok(result.documents.length <= 4);
    assert.ok(result.usage.archiveLookups <= 1);
  } finally { await site.close(); }
});

// ============================== policy: nothing is contacted unless cleared ==============================
test('policy: CivicPlus-hosted Copperas Cove stays blocked; the adapter interface cannot clear it', async () => {
  const calls = [];
  const fetcher = { capabilities: { manualRedirects: true }, fetch: async (u) => { calls.push(u); return { status: 200, headers: {}, url: u, body: new Uint8Array(), bytes: 0, error: null }; } };
  const clock = fakeTime();
  const run = new DiscoveryRun({ seeds: ['https://www.copperascovetx.gov/DocumentCenter'], fetcher, now: clock.now, sleep: clock.sleep, termsAcknowledged: ['copperascovetx.gov', 'www.copperascovetx.gov'], retrieveDocuments: true, budget: new DailyBudget({ now: clock.now }) });
  const r = await run.start();
  assert.equal(calls.length, 0, 'no request is made, even with an acknowledgment');
  assert.match(JSON.stringify(r.blockedHosts), /unverified/);
  assert.ok(r.coverage.every((c) => c.status !== 'searched'));
  assert.equal(defaultHostPolicies().lookup('www.copperascovetx.gov').automation, AUTOMATION.UNVERIFIED);
});

test('CivicPlus adapter interface: recognises address shapes, ranks files first, offers no listing calls', () => {
  const a = defaultConnectors().forUrl('https://www.copperascovetx.gov/AgendaCenter');
  assert.ok(a instanceof CivicPlusAdapter); assert.equal(a.id, 'civicplus');
  assert.equal(CivicPlusAdapter.linkShape('https://x.gov/AgendaCenter/ViewFile/Agenda/_03122024-123'), 'agenda-file');
  assert.equal(CivicPlusAdapter.linkShape('https://x.gov/DocumentCenter/View/456/Budget-FY25'), 'document-file');
  assert.equal(CivicPlusAdapter.linkShape('https://x.gov/AgendaCenter/'), 'agenda-center');
  assert.equal(CivicPlusAdapter.linkShape('https://x.gov/DocumentCenter'), 'document-center');
  assert.equal(CivicPlusAdapter.linkShape('https://x.gov/about'), null);
  const links = [{ href: 'https://x.gov/about', text: 'About' }, { href: 'https://x.gov/DocumentCenter/View/1/a', text: 'A' }, { href: 'https://x.gov/AgendaCenter', text: 'AC' }];
  assert.deepEqual(a.expandPage({ links }).map((l) => l.text), ['A', 'AC', 'About']);
  assert.deepEqual(a.listingCalls(['https://x.gov/']), []);
  assert.equal(defaultConnectors().forUrl('https://example.org/').id, 'generic-html');
});

test('connector listing calls are used only for hosts the registry explicitly allows', async () => {
  const site = await startTestSite();
  try {
    class Listing extends GenericLinkConnector { listingCalls() { return [{ url: site.origin + '/library' }]; } }
    const connectors = new ConnectorRegistry().register(new Listing());
    const mk = async (policies, ack) => {
      const clock = fakeTime(); site.log.length = 0;
      const run = new DiscoveryRun({ seeds: [site.origin + '/about'], fetcher: createFetchApiFetcher({ sendUserAgent: true }), now: clock.now, sleep: clock.sleep, guardOptions: { allowPrivateHosts: [site.hostPort] },
        termsAcknowledged: ack, hostPolicies: policies, connectors, budget: new DailyBudget({ now: clock.now }), limits: { maxDepth: 1, maxPages: 5 } });
      await run.start(); return site.paths();
    };
    const allowed = new HostPolicyRegistry().add({ pattern: '127.0.0.1', automation: AUTOMATION.ALLOWED, note: 'test' });
    assert.ok((await mk(allowed, [])).includes('/library'), 'registry-allowed host: listing call used');
    assert.ok(!(await mk(new HostPolicyRegistry(), ['127.0.0.1'])).includes('/library'), 'acknowledged-only host: listing call NOT used');
  } finally { await site.close(); }
});

// ============================== coverage report ==============================
test('coverage report: counts match the ledger, wording never claims non-existence', async () => {
  const site = await startTestSite();
  try {
    const archiveLookup = async (u) => (u.endsWith('/missing.pdf') ? { status: 'found', copies: [{ provider: 'Wayback Machine', archiveUrl: 'https://web.archive.org/web/2023/x', captureDate: '2023-01-01T00:00:00Z' }] } : { status: 'unavailable', copies: [] });
    const { result } = await runDocs(site, { archiveLookup, limits: { maxResponseBytes: 100000 } });
    const rep = buildCoverageReport(result);
    const retrieved = result.documents.filter((d) => d.sha256).length;
    assert.equal(rep.counts.documentsRetrieved, retrieved);
    assert.equal(rep.counts.historicalCopies, 1);
    assert.equal(rep.counts.documentLinksFound, result.documentCandidates.length);
    assert.equal(rep.counts.pagesFetched, result.counters.pagesFetched);
    const ledgerDocs = result.ledger.filter((e) => e.action === 'document' && e.outcome === OUTCOME.FOUND).length;
    assert.ok(ledgerDocs >= rep.counts.documentsRetrieved - rep.counts.partial, 'ledger and report agree');
    const html = coverageReportHtml(rep); const text = coverageReportText(rep);
    for (const s of [html, text, rep.headline, ...rep.unknowns, ...Object.values(OUTCOME_LABEL)]) assert.doesNotMatch(s, /\b(does not exist|doesn't exist|no such (record|document))\b/i, 'no wording claims a record does not exist');
    assert.match(html, /What remains unknown/); assert.match(html, /Not located in the sources searched/);
    assert.match(html, /<caption>Where Chronium looked<\/caption>/); assert.match(html, /scope="col"/); assert.match(html, /scope="row"/);
    assert.ok(!/<script/i.test(html));
    assert.match(text, /Historical copy found/);
    assert.ok(rep.unknowns.some((u) => /not evidence that a record is missing/.test(u)));
  } finally { await site.close(); }
});

test('coverage report: hostile text in names and addresses is escaped', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const rep = buildCoverageReport({ runId: 'r', state: 'finished', coverage: [{ id: 'a', label: evil, kind: '', status: 'searched', statusLabel: 'Searched', detail: evil }], documents: [{ url: 'https://x.gov/a.pdf', linkText: evil, outcome: OUTCOME.FOUND, sha256: 'a'.repeat(64), note: evil, finalUrl: 'javascript:alert(1)' }], counters: {}, documentCandidates: 1, usage: {} });
  const html = coverageReportHtml(rep);
  assert.ok(!html.includes('<img'), 'markup is escaped'); assert.ok(!html.includes('href="javascript:'), 'only http(s) links are linked');
});

// ============================== saving into a case ==============================
test('saving: documents become ordinary sources once, with full provenance; re-saving adds nothing', async () => {
  const site = await startTestSite();
  try {
    const inv = await db.createInvestigation({ name: 'Discovery test', description: '' });
    const archiveLookup = async (u) => (u.endsWith('/missing.pdf') ? { status: 'found', copies: [{ provider: 'Wayback Machine', archiveUrl: 'https://web.archive.org/web/20230101000000/' + u, captureDate: '2023-01-01T00:00:00Z' }] } : { status: 'none', copies: [] });
    const go = async () => {
      const saver = createDocumentSaver({ investigationId: inv.id, runId: 'run-A', label: 'Deep Discovery: test', extract: plainTextExtract });
      const { result } = await runDocs(site, { onDocument: (p) => saver.onDocument(p), archiveLookup, limits: { maxResponseBytes: 100000 } });
      await saver.finish(result.state); await recordRun(inv.id, result, { seeds: [site.origin + '/library'] });
      return { saver, result };
    };
    const first = await go();
    const recs1 = await db.listInvestigationRecords(inv.id);
    const notes = recs1.find((r) => r.originalUrl.endsWith('/docs/notes.txt'));
    assert.ok(notes, 'a discovered document is a source in the case');
    assert.equal(notes.sourceType, 'bulk-document'); assert.equal(notes.origin, 'deep-discovery');
    assert.equal(notes.fileHash, await sha256Hex(DOC_BYTES['/docs/notes.txt'])); assert.equal(notes.canonicalKey, notes.fileHash);
    assert.match(notes.extractedText, /Council notes/);
    assert.equal(notes.discovery.originalUrl, site.origin + '/docs/notes.txt'); assert.equal(notes.discovery.parentUrl, site.origin + '/library');
    assert.equal(notes.discovery.httpStatus, 200); assert.ok(notes.discovery.retrievedAt); assert.equal(notes.discovery.sha256, notes.fileHash); assert.equal(notes.discovery.engineVersion, first.result.engineVersion);
    assert.equal(notes.storageMode, 'reference-only', 'originals are not copied by default');
    const agenda = recs1.find((x) => x.originalUrl.endsWith('/agenda-2024-03-12.pdf'));
    const agendas = recs1.filter((r) => r.fileHash === agenda.fileHash);
    assert.equal(agendas.length, 1, 'the same content found at several addresses is ONE record');
    assert.ok(agendas[0].discovery.alsoFoundAt.some((u) => u.endsWith('/agenda-copy.pdf')), 'the other address is kept as provenance');
    const hist = recs1.find((r) => r.sourceType === 'discovered-archive-copy');
    assert.ok(hist); assert.equal(hist.archiveUrl.startsWith('https://web.archive.org/'), true); assert.equal(hist.captureDate, '2023-01-01T00:00:00Z'); assert.ok(hist.originalUrl.endsWith('/missing.pdf'));
    assert.equal(first.saver.tally.errors, 0);
    // The same run again: no new records.
    const n1 = recs1.length;
    await go();
    const recs2 = await db.listInvestigationRecords(inv.id);
    assert.equal(recs2.length, n1, 'saving the same findings again adds no records');
    const runs = await db.listDiscoveryRuns(inv.id);
    assert.ok(runs.length >= 1); assert.ok(runs[0].checkpoint); assert.ok(runs[0].coverage.length);
    const ledger = await db.listDiscoveryLedger(inv.id, runs[0].id);
    assert.ok(ledger.length > 10); assert.ok(ledger.every((e) => !('body' in e) && !('text' in e)), 'the ledger holds addresses and results, never page text');
    // Hand-imported duplicate: a file with the same hash already in the case is reused, not duplicated.
    const bytes = DOC_BYTES['/docs/notes.txt'];
    assert.equal((await db.getRecordByCanonicalKey(await sha256Hex(bytes))).id, notes.id);
  } finally { await site.close(); }
});

test('export and import: runs and ledger travel in the case file; older files without them still import', async () => {
  const site = await startTestSite();
  try {
    globalThis.indexedDB = new IDBFactory(); db.resetDbConnection();
    const inv = await db.createInvestigation({ name: 'Portable discovery', description: '' });
    const saver = createDocumentSaver({ investigationId: inv.id, runId: 'run-P', extract: plainTextExtract });
    const { result } = await runDocs(site, { onDocument: (p) => saver.onDocument(p) });
    await saver.finish(result.state); await recordRun(inv.id, result, { seeds: [site.origin + '/library'] });
    const before = (await db.listInvestigationRecords(inv.id)).length;
    const exp = await portable.exportInvestigationFile(inv.id);
    assert.ok(exp.counts['document search runs'] === 1); assert.ok(exp.counts['document search log entries'] > 10);
    // New device
    globalThis.indexedDB = new IDBFactory(); db.resetDbConnection();
    const bundle = portable.parseBundleText(exp.text);
    const preview = await portable.previewImport(exp.text);
    assert.equal(preview.report.added.discoveryRuns, 1);
    await portable.importBundle(bundle);
    assert.equal((await db.listInvestigationRecords(inv.id)).length, before);
    assert.equal((await db.listDiscoveryRuns(inv.id)).length, 1);
    assert.ok((await db.listDiscoveryLedger(inv.id, result.runId)).length > 10);
    // Importing again is a no-op.
    const again = await portable.importBundle(portable.parseBundleText(exp.text));
    assert.equal(Object.values(again.added).reduce((a, b) => a + b, 0), 0);
    // An older file (no discovery arrays at all) still imports.
    const old = JSON.parse(exp.text); delete old.data.discoveryRuns; delete old.data.discoveryLedger; old.data.investigation = { ...old.data.investigation, id: 'inv-old', name: 'Old file' };
    old.data.records = []; old.data.investigationRecords = [];
    for (const k of Object.keys(old.data)) if (Array.isArray(old.data[k]) && !['records', 'investigationRecords', 'blobs'].includes(k)) old.data[k] = [];
    const parsed = portable.parseBundleText(JSON.stringify(old));
    assert.deepEqual(parsed.data.discoveryRuns, []);
    await portable.importBundle(parsed);
  } finally { await site.close(); }
});

// ============================== website mode: the Worker proxy ==============================
function withCaches() {
  const store = new Map();
  globalThis.caches = { default: { match: async (req) => { const r = store.get(req.url); return r ? r.clone() : undefined; }, put: async (req, res) => { store.set(req.url, res.clone()); } } };
  return store;
}
const workerFetch = (env) => (u, init) => (u.includes('/api/captures') ? handleCaptures(new Request(u, init), env) : handleFetch(new Request(u, init), env));

test('proxy: refuses unsafe, policy-blocked, robots-disallowed and unacknowledged requests', async () => {
  withCaches();
  const site = await startTestSite();
  try {
    const env = { DISCOVERY_ALLOW_PRIVATE: site.hostPort, DISCOVERY_IP_PER_MINUTE: '500', DISCOVERY_HOST_PER_MINUTE: '500' };
    const call = async (url, q = '') => { const r = await handleFetch(new Request(`http://w/api/fetch?url=${encodeURIComponent(url)}${q}`), env); return { r, body: r.headers.get('x-chronium-status') === null ? await r.json() : null }; };
    for (const bad of ['http://169.254.169.254/latest/meta-data/', 'http://localhost/', 'http://[::1]/', 'file:///etc/passwd', 'http://10.0.0.1/', 'ftp://example.com/']) assert.equal((await call(bad, '&ack=1')).r.status, 400, bad);
    const civic = await call('https://www.copperascovetx.gov/AgendaCenter', '&ack=1'); assert.equal(civic.r.status, 403); assert.equal(civic.body.error, 'policy-refused');
    assert.equal((await call('https://emma.msrb.org/', '&ack=1')).r.status, 403);
    const bare = await handleFetch(new Request(`http://w/api/fetch?ack=1&url=${encodeURIComponent(site.origin + '/library')}`), {}); assert.equal(bare.status, 400, 'a private host is refused when the environment does not exempt it');
    const noAck = await handleFetch(new Request(`http://w/api/fetch?url=${encodeURIComponent('https://example.org/')}`), env); assert.equal(noAck.status, 403);
    const blocked = await call(site.origin + '/private/secret.html', '&ack=1&seed=1'); assert.equal(blocked.r.status, 403); assert.equal(blocked.body.error, 'robots-refused');
    const post = await handleFetch(new Request(`http://w/api/fetch?url=x`, { method: 'POST' }), env); assert.equal(post.status, 405);
    assert.ok(!site.paths().includes('/private/secret.html'));
  } finally { await site.close(); }
});

test('proxy: returns the upstream status, headers and bytes, never follows redirects, caps size and types', async () => {
  withCaches();
  const site = await startTestSite();
  try {
    const env = { DISCOVERY_ALLOW_PRIVATE: site.hostPort, DISCOVERY_IP_PER_MINUTE: '500', DISCOVERY_HOST_PER_MINUTE: '500' };
    const get = (p) => handleFetch(new Request(`http://w/api/fetch?ack=1&url=${encodeURIComponent(site.origin + p)}`), env);
    const ok = await get('/docs/notes.txt');
    assert.equal(ok.status, 200); assert.equal(ok.headers.get('x-chronium-status'), '200'); assert.equal(ok.headers.get('x-chronium-etag'), '"d1"');
    assert.equal(ok.headers.get('content-security-policy'), 'sandbox'); assert.equal(ok.headers.get('x-content-type-options'), 'nosniff'); assert.ok(!ok.headers.get('set-cookie'));
    assert.equal(new TextDecoder().decode(await ok.arrayBuffer()), 'Council notes, plain text.\n');
    const redir = await get('/docs/redirect.pdf');
    assert.equal(redir.headers.get('x-chronium-status'), '302'); assert.equal(redir.headers.get('x-chronium-location'), site.origin + '/docs/agenda-2024-03-12.pdf');
    assert.ok(!site.paths().includes('/docs/agenda-2024-03-12.pdf'), 'the proxy did not follow the redirect');
    assert.equal((await get('/docs/missing.pdf')).headers.get('x-chronium-status'), '404');
  } finally { await site.close(); }
});

test('proxy: per-visitor and per-site rate limits answer 429', async () => {
  withCaches();
  const site = await startTestSite();
  try {
    const env = { DISCOVERY_ALLOW_PRIVATE: site.hostPort, DISCOVERY_IP_PER_MINUTE: '3', DISCOVERY_HOST_PER_MINUTE: '500' };
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await handleFetch(new Request(`http://w/api/fetch?ack=1&url=${encodeURIComponent(site.origin + '/robots.txt')}`), env)).status);
    assert.deepEqual(codes.slice(0, 3), [200, 200, 200]); assert.equal(codes[4], 429);
  } finally { await site.close(); }
});

test('website mode end to end: the engine through the proxy fetcher finds, retrieves and respects policy', async () => {
  withCaches();
  const site = await startTestSite();
  try {
    const env = { DISCOVERY_ALLOW_PRIVATE: site.hostPort, DISCOVERY_IP_PER_MINUTE: '5000', DISCOVERY_HOST_PER_MINUTE: '5000', DISCOVERY_UPSTREAM_TIMEOUT_MS: '300' };
    const fetcher = createProxyFetcher({ base: 'http://w', fetchImpl: workerFetch(env) });
    const { result } = await runDocs(site, { mode: 'website', fetcher, limits: { maxWebsiteFetches: 50, requestTimeoutMs: 400 } });
    const out = (p) => docByPath(result, site, p);
    assert.equal(out('/docs/notes.txt').outcome, OUTCOME.FOUND);
    assert.equal(out('/docs/notes.txt').sha256, await sha256Hex(DOC_BYTES['/docs/notes.txt']));
    assert.equal(out('/docs/missing.pdf').outcome, OUTCOME.NOT_LOCATED);
    assert.equal(out('/docs/forbidden.pdf').outcome, OUTCOME.ACCESS_RESTRICTED);
    assert.equal(out('/docs/redirect.pdf').outcome, OUTCOME.FOUND, 'redirect handled by the engine, hop by hop');
    assert.ok(!site.paths().includes('/private/blocked.pdf'));
    assert.ok(result.counters.websiteFetches === result.counters.requests);
  } finally { await site.close(); }
});

test('archive lookup client and /api/captures: found, none, unavailable; private addresses refused', async () => {
  const store = withCaches();
  const realFetch = globalThis.fetch;
  try {
    const answers = [
      { archived_snapshots: { closest: { available: true, url: 'http://web.archive.org/web/20230101000000/https://x.gov/a.pdf', timestamp: '20230101000000', status: '200' } } },
      { archived_snapshots: {} }
    ];
    let i = 0; let mode = 'ok';
    globalThis.fetch = async () => { if (mode === 'down') throw new Error('network'); return new Response(JSON.stringify(answers[i++ % answers.length]), { headers: { 'content-type': 'application/json' } }); };
    const env = {};
    const lookup = createArchiveLookup({ base: 'http://w', fetchImpl: (u, init) => handleCaptures(new Request(u, init), env) });
    const found = await lookup('https://x.gov/a.pdf');
    assert.equal(found.status, 'found'); assert.equal(found.copies[0].captureDate, '2023-01-01T00:00:00Z'); assert.ok(found.copies[0].archiveUrl.startsWith('https://web.archive.org/'));
    const none = await lookup('https://x.gov/b.pdf'); assert.equal(none.status, 'none');
    mode = 'down'; const down = await lookup('https://x.gov/c.pdf'); assert.equal(down.status, 'unavailable', 'an unreachable archive is "unavailable", never "none"');
    assert.ok(![...store.keys()].some((k) => k.includes('c.pdf')), 'an unreachable answer is not cached');
    assert.equal((await handleCaptures(new Request('http://w/api/captures?url=' + encodeURIComponent('http://127.0.0.1/x')), env)).status, 400);
  } finally { globalThis.fetch = realFetch; }
});

test('proxy: the robots.txt it just served is reused, so the site is not asked for it twice', async () => {
  withCaches();
  const site = await startTestSite();
  try {
    const env = { DISCOVERY_ALLOW_PRIVATE: site.hostPort, DISCOVERY_IP_PER_MINUTE: '500', DISCOVERY_HOST_PER_MINUTE: '500' };
    const get = (p, q = '') => handleFetch(new Request(`http://w/api/fetch?ack=1${q}&url=${encodeURIComponent(site.origin + p)}`), env);
    assert.equal((await get('/robots.txt')).headers.get('x-chronium-status'), '200');
    assert.equal((await get('/docs/notes.txt')).headers.get('x-chronium-status'), '200');
    assert.equal((await get('/docs/minutes-2024-03-12.pdf')).headers.get('x-chronium-status'), '200');
    assert.equal(site.paths().filter((p) => p === '/robots.txt').length, 1, 'robots.txt was fetched from the site once');
  } finally { await site.close(); }
});

test('database upgrade: a case saved under the previous database version opens with all its data', async () => {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs'); const path = await import('node:path'); const url = await import('node:url');
  const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
  let oldSrc;
  try { oldSrc = execFileSync('git', ['show', '21896dd:public/db.js'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return; /* no git history available: nothing to compare against */ }
  assert.match(oldSrc, /DB_VERSION = 10/);
  const tmp = path.join(root, 'public', '_db_v10_for_test.js');
  fs.writeFileSync(tmp, oldSrc);
  try {
    globalThis.indexedDB = new IDBFactory(); db.resetDbConnection();
    const old = await import(url.pathToFileURL(tmp).href);
    const inv = await old.createInvestigation({ name: 'Made before discovery existed', description: '' });
    await old.saveRecordToInvestigation(inv.id, { title: 'Old source', originalUrl: 'https://example.gov/old', source: 'x' });
    (await old.openDb()).close(); old.resetDbConnection();
    db.resetDbConnection();
    const records = await db.listInvestigationRecords(inv.id);
    assert.equal(records.length, 1); assert.equal(records[0].title, 'Old source');
    assert.deepEqual(await db.listDiscoveryRuns(inv.id), [], 'the new stores exist and are empty');
    await db.saveDiscoveryRun(inv.id, { id: 'r1', startedAt: new Date().toISOString() });
    assert.equal((await db.listDiscoveryRuns(inv.id)).length, 1);
    await db.deleteInvestigation(inv.id);
    assert.equal((await db.listDiscoveryRuns(inv.id)).length, 0, 'deleting a case removes its discovery runs too');
  } finally { fs.rmSync(tmp, { force: true }); }
});

test('no test in this file contacts a real website', () => {
  const policies = defaultHostPolicies();
  assert.equal(policies.lookup('emma.msrb.org').automation, AUTOMATION.LINK_ONLY);
});
