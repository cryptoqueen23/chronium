#!/usr/bin/env node
// A SMALL live validation of Deep Discovery against one real public site, run through the local Worker
// (website mode: engine -> /api/fetch -> site) with the site's own pacing. NOT part of any test suite.
//
// It refuses to run unless the host is named on the command line (--allow=<host>), so a live request is
// always a deliberate act. Before running, read the site's robots.txt and terms (docs/DEEP_DISCOVERY_PHASE1.md
// records what was checked for each source). Caps are deliberately tiny.
//
//   npx wrangler dev --port 8791        (in another terminal)
//   node scripts/live-validation.mjs --allow=www.archives.gov --seed=https://www.archives.gov/records-mgmt/policy/transfer-guidance
import { IDBFactory } from 'fake-indexeddb';
import { DiscoveryRun, DailyBudget } from '../public/discovery/engine.js';
import { createProxyFetcher, createArchiveLookup } from '../public/discovery/fetchers.js';
import { buildCoverageReport, coverageReportText } from '../public/discovery/report.js';

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const allow = arg('allow'); const seed = arg('seed'); const worker = arg('worker', 'http://127.0.0.1:8791');
if (!allow || !seed || new URL(seed).hostname !== allow) { console.error('Refusing to run: pass --allow=<host> and a --seed on that host.'); process.exit(2); }

globalThis.indexedDB = new IDBFactory();
const db = await import('../public/db.js');
const { createDocumentSaver, recordRun, plainTextExtract } = await import('../public/discovery/save.js');
const inv = await db.createInvestigation({ name: 'Live validation', description: '' });
const saver = createDocumentSaver({ investigationId: inv.id, runId: 'live', extract: plainTextExtract });

const calls = []; const real = createProxyFetcher({ base: worker });
const fetcher = { capabilities: real.capabilities, fetch: async (u, o) => { const t = Date.now(); const r = await real.fetch(u, o); calls.push({ url: u, status: r.status, ms: Date.now() - t, at: new Date().toISOString() }); console.log(`${new Date().toISOString().slice(11, 19)} ${r.status ?? r.error?.code} ${u}`); return r; } };
const lookups = []; const lookup = createArchiveLookup({ base: worker });
const run = new DiscoveryRun({
  seeds: [seed], mode: 'website', fetcher, termsAcknowledged: [allow], budget: new DailyBudget(),
  limits: { maxDepth: 1, maxPages: Number(arg('pages', 5)), maxDocuments: Number(arg('docs', 4)), maxTotalRequests: Number(arg('requests', 18)), maxWebsiteFetches: 20, maxArchiveLookups: 3 },
  retrieveDocuments: true, onDocument: (p) => saver.onDocument(p), archiveLookup: async (u) => { const r = await lookup(u); lookups.push({ url: u, status: r.status }); console.log(`archive lookup ${r.status} ${u}`); return r; }
});
const result = await run.start();
await saver.finish(result.state); await recordRun(inv.id, result, { seeds: [seed] });
const rep = buildCoverageReport(result);
const recs = await db.listInvestigationRecords(inv.id);
console.log('\n' + coverageReportText(rep));
console.log('\nJSON ' + JSON.stringify({
  state: result.state, stopReason: result.stopReason, message: result.message, usage: result.usage, counters: result.counters, stoppedHosts: result.stoppedHosts, blockedHosts: result.blockedHosts,
  workerRequests: { fetch: calls.length, captures: lookups.length }, requestsToSite: calls.map((c) => ({ url: c.url, status: c.status })),
  documents: result.documents.map((d) => ({ url: d.url, outcome: d.outcome, classification: d.classification, sha256: d.sha256, bytes: d.contentLength, retrievedAt: d.retrievedAt, archive: d.archive?.status })),
  savedRecords: recs.map((r) => ({ title: r.title, sourceType: r.sourceType, originalUrl: r.originalUrl, sha256: r.discovery?.sha256, retrievedAt: r.discovery?.retrievedAt })),
  ledgerRows: result.ledger.length, ledgerBytes: JSON.stringify(result.ledger).length
}, null, 1));
