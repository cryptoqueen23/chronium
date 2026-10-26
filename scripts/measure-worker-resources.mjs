#!/usr/bin/env node
// Stage 0 / B6 measurement: what one proxied document costs the Worker, on the local Workers runtime (workerd), using
// local fixtures only (no public site is contacted, no load test).
//   - wall time, bytes returned and the CPU time the workerd process used, for bodies of 1, 5, 10 MB and a body over the limit
//   - a request that times out upstream, and 6 simultaneous slow requests (how many are served, how many are told "busy")
//   - memory of the workerd process before and after
// Local numbers are NOT Cloudflare edge numbers. Real edge CPU time and memory can only be read from the dashboard / Workers
// metrics once a staging Worker exists (Stage 1). See docs/STAGE0_SECURITY.md, "Measured resource consumption".
// Usage: node scripts/measure-worker-resources.mjs
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8798; const SITE = 8790;
const MB = 1024 * 1024;
const site = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nAllow: /\n'); }
  const m = /^\/pdf(\d+)$/.exec(p);
  if (m) { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end(Buffer.alloc(Number(m[1]) * MB, 65)); }
  if (p === '/html1') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><body>' + '<p><a href="/x">link</a> some words here</p>'.repeat(Math.floor(MB / 45)) + '</body></html>'); }
  if (p === '/slow') { setTimeout(() => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('slow'); }, 2500); return; }
  if (p === '/hang') return; // never answers: the Worker's own upstream timeout must cut it off
  res.writeHead(404); res.end();
});
await new Promise((r) => site.listen(SITE, '127.0.0.1', r));
const vars = ['ENVIRONMENT:development', 'TEST_MODE:on', 'FEATURE_DISCOVERY_FETCH:on', `DISCOVERY_ALLOW_PRIVATE:127.0.0.1:${SITE}`, 'DISCOVERY_UPSTREAM_TIMEOUT_MS:3000', 'LIMIT_FETCH_PER_IP_PER_MIN:5000', 'LIMIT_FETCH_PER_SITE_PER_MIN:5000', 'LIMIT_FETCH_GLOBAL_PER_DAY:100000'];
const child = spawn(['npx', 'wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', fs.mkdtempSync(path.join(os.tmpdir(), 'chronium-measure-')), ...vars.flatMap((v) => ['--var', `"${v}"`])].join(' '), { cwd: root, shell: true, stdio: 'ignore' });
const get = (p) => new Promise((resolve, reject) => {
  const t0 = performance.now();
  const q = http.get({ host: '127.0.0.1', port: PORT, path: p, headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'empty' } }, (r) => {
    let n = 0; r.on('data', (d) => { n += d.length; }); r.on('end', () => resolve({ status: r.statusCode, bytes: n, ms: Math.round(performance.now() - t0), truncated: r.headers['x-chronium-truncated'] === '1' }));
  });
  q.on('error', reject);
});
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
const workerdStats = () => {
  const out = ps(`Get-Process workerd -ErrorAction SilentlyContinue | ForEach-Object { '{0}|{1}' -f $_.TotalProcessorTime.TotalMilliseconds, $_.WorkingSet64 }`);
  return out.split(/\r?\n/).filter(Boolean).map((l) => l.split('|').map(Number)).reduce((a, [c, m]) => ({ cpu: a.cpu + c, mem: Math.max(a.mem, m) }), { cpu: 0, mem: 0 });
};
let up = false;
for (let i = 0; i < 90 && !up; i++) { try { up = (await get('/api/health')).status === 200; } catch { /* waiting */ } if (!up) await new Promise((r) => setTimeout(r, 1000)); }
const rows = [];
if (up) {
  await get(`/api/fetch?url=http://127.0.0.1:${SITE}/pdf1&ack=1&seed=1&w=0`); // warm up (module load, robots)
  for (const [label, p] of [['1 MB document', 'pdf1'], ['5 MB document', 'pdf5'], ['10 MB document (at the default limit)', 'pdf10'], ['12 MB document (over the limit, cut off)', 'pdf12'], ['1 MB web page (HTML)', 'html1']]) {
    const before = workerdStats(); const r = await get(`/api/fetch?url=http://127.0.0.1:${SITE}/${p}&ack=1&seed=1&n=${Math.random()}`); const after = workerdStats();
    rows.push({ label, status: r.status, bytes: r.bytes, wallMs: r.ms, truncated: r.truncated, cpuMs: Math.round(after.cpu - before.cpu), peakWorkerdMemMB: Math.round(after.mem / MB) });
  }
  const b0 = workerdStats(); const hang = await get(`/api/fetch?url=http://127.0.0.1:${SITE}/hang&ack=1&seed=1`); const b1 = workerdStats();
  rows.push({ label: 'upstream never answers (3 s test timeout)', status: hang.status, bytes: hang.bytes, wallMs: hang.ms, cpuMs: Math.round(b1.cpu - b0.cpu) });
  const c0 = workerdStats(); const t0 = performance.now();
  const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => get(`/api/fetch?url=http://127.0.0.1:${SITE}/slow&ack=1&seed=1&n=${i}`)));
  rows.push({ label: '6 simultaneous slow requests (default limit 4)', served: burst.filter((r) => r.status === 200).length, busy: burst.filter((r) => r.status === 429).length, wallMs: Math.round(performance.now() - t0), cpuMs: Math.round(workerdStats().cpu - c0.cpu) });
}
console.log(JSON.stringify({ measuredOn: 'local workerd via wrangler dev; not Cloudflare edge', node: process.version, rows }, null, 2));
try { execFileSync('powershell', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' }); } catch { /* gone */ }
try { child.kill(); } catch { /* gone */ }
site.close();
process.exit(up ? 0 : 1);
