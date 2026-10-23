#!/usr/bin/env node
// Measures what a Deep Discovery run costs the machine running it, against a
// synthetic site served locally (no real website is contacted). Uses a fake
// clock, so the 10-second Crawl-delay is computed, not waited for. Prints JSON.
// Usage: node scripts/discovery-measure.mjs
import http from 'node:http';
import { DiscoveryRun, DailyBudget } from '../public/discovery/engine.js';
import { createFetchApiFetcher } from '../public/discovery/fetchers.js';

const PAGES = 400;
const filler = 'Lorem ipsum dolor sit amet. '.repeat(100); // about 2.8 KB of text per page
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nCrawl-delay: 10\n'); }
  const m = u.pathname.match(/^\/p\/(\d+)$/);
  const n = m ? Number(m[1]) : 0;
  const links = Array.from({ length: 12 }, (_, i) => 12 * n + 1 + i).filter((x) => x < PAGES).map((x) => `<a href="/p/${x}">Page ${x}</a>`).join(' ');
  const docs = `<a href="/files/doc-${n}.pdf">Agenda ${n}</a>`;
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<html><body>${links} ${docs}<p>${filler}</p></body></html>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
let t = 1_700_000_000_000;
const before = process.memoryUsage();
const cpu0 = process.cpuUsage();
const t0 = performance.now();
const run = new DiscoveryRun({
  seeds: [`http://127.0.0.1:${port}/p/0`], fetcher: createFetchApiFetcher({ sendUserAgent: true }), now: () => t, sleep: async (ms) => { t += ms; },
  guardOptions: { allowPrivateHosts: [`127.0.0.1:${port}`] }, termsAcknowledged: ['127.0.0.1'], budget: new DailyBudget({ now: () => t }), limits: { maxRequestsPerHostPerDay: 800 }
});
const r = await run.start();
const wall = performance.now() - t0; const cpu = process.cpuUsage(cpu0); const after = process.memoryUsage();
server.close();
console.log(JSON.stringify({
  note: 'synthetic local site, default limits, Crawl-delay 10; fake clock for delays',
  state: r.state, pagesFetched: r.counters.pagesFetched, requests: r.counters.requests, documentLinksFound: r.documentCandidates.length,
  downloadedMB: Math.round(r.counters.bytes / 1048576 * 100) / 100, estimatedMinutesAtCrawlDelay: Math.round((t - 1_700_000_000_000) / 60000 * 10) / 10,
  engineCpuMs: Math.round((cpu.user + cpu.system) / 1000), engineWallMsExcludingDelays: Math.round(wall), heapGrowthMB: Math.round((after.heapUsed - before.heapUsed) / 1048576 * 10) / 10,
  ledgerEntries: r.ledger.length, ledgerKB: Math.round(JSON.stringify(r.ledger).length / 1024), pagesProvenanceKB: Math.round(JSON.stringify(r.pages).length / 1024), stopReason: r.stopReason
}, null, 2));
