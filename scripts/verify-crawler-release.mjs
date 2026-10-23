#!/usr/bin/env node
// Verifies the page-only release against a running site (production or a local test server).
//   node scripts/verify-crawler-release.mjs --package=.release/package --url=https://chronium-mind.truewolfflix777.workers.dev --expect=before
//   node scripts/verify-crawler-release.mjs --package=.release/package --url=https://chronium-mind.truewolfflix777.workers.dev --expect=after
// "before": every existing asset is byte-identical to the package, and /crawler is NOT there yet.
// "after":  the same, and /crawler is there (200) with the page's exact bytes. In both: no new API route exists.
// Read-only GET requests, about thirty in total.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const pkg = path.resolve(arg('package', '.release/package'));
const base = arg('url', 'https://chronium-mind.truewolfflix777.workers.dev').replace(/\/$/, '');
const expect = arg('expect', 'before');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
let failed = false;
const row = (ok, name, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failed = true; };
const get = async (p) => { const r = await fetch(base + p, { redirect: 'manual' }); const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, type: r.headers.get('content-type') || '', body: b, location: r.headers.get('location') }; };

// 1. Existing assets: byte-identical to the package (which is byte-identical to d80ef66, the verified production baseline).
const assets = [];
(function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else assets.push(f); } })(path.join(pkg, 'public'));
let same = 0;
for (const f of assets.sort()) {
  const rel = path.relative(path.join(pkg, 'public'), f).replaceAll('\\', '/');
  if (rel === 'crawler.html' || rel === 'index.html') continue;
  const live = await get('/' + rel); const mine = fs.readFileSync(f);
  if (live.status === 200 && sha(live.body) === sha(mine)) same += 1; else row(false, `asset /${rel}`, `status ${live.status}, live ${sha(live.body)} vs package ${sha(mine)}`);
}
row(same === assets.length - 2, `existing assets byte-identical to the package: ${same} of ${assets.length - 2}`);
const idx = await get('/'); row(idx.status === 200 && sha(idx.body) === sha(fs.readFileSync(path.join(pkg, 'public', 'index.html'))), 'index.html (/) identical');

// 2. Existing API behaviour, and the routes that must NOT exist.
const probes = [['/api/health', 200], ['/api/check-link', 400], ['/api/search', 400], ['/api/analyze/qualitative', 405], ['/api/view-capture', 404], ['/api/analyze/ask-sources', 404], ['/api/fetch', 404], ['/api/captures', 404], ['/api/nonexistent', 404], ['/nonexistent-xyz', 404]];
for (const [p, want] of probes) { const r = await get(p); row(r.status === want, `${p} -> ${r.status}`, r.status === want ? '' : `expected ${want}`); }

// 3. The page itself.
const page = await get('/crawler'); const old = await get('/crawler.html');
const mine = fs.readFileSync(path.join(pkg, 'public', 'crawler.html'));
if (expect === 'before') { row(page.status === 404, '/crawler is not live yet (404)'); }
else { row(page.status === 200 && page.type.startsWith('text/html'), `/crawler -> ${page.status} ${page.type}`); row(sha(page.body) === sha(mine), 'the page served is byte-identical to the package', `${sha(page.body)} vs ${sha(mine)}`); row(old.status === 307 && /\/crawler$/.test(old.location || ''), '/crawler.html redirects to /crawler', `${old.status} ${old.location}`); }
console.log(failed ? `\nRELEASE CHECK FAILED (${expect})` : `\nRELEASE CHECK PASSED (${expect})`);
process.exit(failed ? 1 : 0);
