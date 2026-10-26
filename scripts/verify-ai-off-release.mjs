#!/usr/bin/env node
// Verifies the Worker-only "paid AI switched off" release against a running site (production or a local test server).
//   node scripts/verify-ai-off-release.mjs --package=.release/ai-off-package --url=https://chronium-mind.truewolfflix777.workers.dev --expect=before
//   node scripts/verify-ai-off-release.mjs --package=.release/ai-off-package --url=http://127.0.0.1:8792 --expect=after
// The point of this release: NO front-end file changes, so no visitor's saved cases (IndexedDB version 4 on production) can be upgraded.
// "before": every package asset is byte-identical to what the site serves, and the AI routes still answer (usage 200, analysis GET 405).
// "after":  the same assets are still byte-identical, and BOTH AI routes answer 404 as if they did not exist.
// In both: no other API route changed. Read-only GET requests only (about forty); it never sends a POST to a public site, and a
// paid-AI call is impossible from here because it never sends a request body anywhere.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const pkg = path.resolve(arg('package', '.release/ai-off-package'));
const base = arg('url', 'https://chronium-mind.truewolfflix777.workers.dev').replace(/\/$/, '');
const expect = arg('expect', 'before');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
let failed = false;
const row = (ok, name, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failed = true; };
const get = async (p) => { const r = await fetch(base + p, { redirect: 'manual' }); const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, type: r.headers.get('content-type') || '', body: b, loc: r.headers.get('location') || '' }; };

// 1. Every static file in the package is served byte-for-byte (so the front end, and with it the database version, is unchanged).
const files = [];
(function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else files.push(f); } })(path.join(pkg, 'public'));
let same = 0;
for (const f of files.sort()) {
  const rel = path.relative(path.join(pkg, 'public'), f).replaceAll('\\', '/');
  const route = rel === 'index.html' ? '/' : rel === 'crawler.html' ? '/crawler' : '/' + rel; // HTML assets are served without the extension
  const live = await get(route); const mine = fs.readFileSync(f);
  if (live.status === 200 && sha(live.body) === sha(mine)) same += 1; else row(false, `asset ${route}`, `status ${live.status}, served ${sha(live.body)} vs package ${sha(mine)}`);
}
row(same === files.length, `static files byte-identical to the package: ${same} of ${files.length}`);
const db = fs.readFileSync(path.join(pkg, 'public', 'db.js'), 'utf8');
row(/const DB_VERSION = 4;/.test(db) && /const DB_VERSION = 4;/.test((await get('/db.js')).body.toString('utf8')), 'the front end still opens the database at version 4: nothing can upgrade a visitor\'s saved cases');
row((await get('/boot.js')).status === 404 && (await get('/upgrade.js')).status === 404, 'no newer front-end file (boot.js, upgrade.js) is served');

// 2. The routes.
const unchanged = [['/api/health', 200], ['/api/check-link', 400], ['/api/search', 400], ['/api/view-capture', 404], ['/api/analyze/ask-sources', 404], ['/api/fetch', 404], ['/api/captures', 404], ['/api/features', 404]];
for (const [p, want] of unchanged) { const r = await get(p); row(r.status === want, `${p} -> ${r.status}`, r.status === want ? '' : `expected ${want}`); }
const usage = await get('/api/ai/usage'); const analyze = await get('/api/analyze/qualitative');
if (expect === 'before') {
  row(usage.status === 200, `/api/ai/usage -> ${usage.status} (still live, as expected before the release)`);
  row(analyze.status === 405, `/api/analyze/qualitative -> ${analyze.status} (the route exists, as expected before the release)`);
} else {
  row(usage.status === 404 && /not-available/.test(usage.body.toString()), `/api/ai/usage -> ${usage.status} (switched off)`);
  row(analyze.status === 404 && /not-available/.test(analyze.body.toString()), `/api/analyze/qualitative -> ${analyze.status} (switched off)`);
}
console.log(failed ? `\nAI-OFF RELEASE CHECK FAILED (${expect})` : `\nAI-OFF RELEASE CHECK PASSED (${expect})`);
process.exit(failed ? 1 : 0);
