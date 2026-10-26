#!/usr/bin/env node
// Initial staging smoke test: the "everything is off" state, with the fewest requests that prove it.
//   node scripts/smoke-staging.mjs --base=https://chronium-mind-staging.<account>.workers.dev [--log=<file.json>] [--budget=40]
//   node scripts/smoke-staging.mjs --base=http://127.0.0.1:8795          (a local `wrangler dev --env staging`)
//
// What it does NOT do: it never contacts a municipal or CivicPlus host (it refuses to run if one appears in any address it
// would request), never uses the production hostname (refuses), makes no browser, stores nothing on the machine except the log,
// and stops at the request budget. Every guarded route must answer 404 "not-available" because every switch is off.
// The real-browser checks (the database upgrade prompt, the extension permission prompt) are manual: docs/STAGE1_STAGING_PROPOSAL.md.
import fs from 'node:fs';

const arg = (n, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const base = (arg('base') || '').replace(/\/+$/, '');
const budget = Number(arg('budget', 40));
const logPath = arg('log');
const PRODUCTION_HOSTS = ['chronium-mind.truewolfflix777.workers.dev'];
const FORBIDDEN = /copperascovetx|civicplus|\.gov(\/|$|:)/i;

if (!/^https?:\/\//.test(base)) { console.error('Give --base=<staging address>.'); process.exit(2); }
const host = new URL(base).host;
if (PRODUCTION_HOSTS.includes(host)) { console.error(`Refusing to run against production (${host}). This test is for staging or a local Worker.`); process.exit(2); }

const results = []; let used = 0;
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };
async function call(path, init = {}) {
  if (FORBIDDEN.test(path)) throw new Error(`refusing to build a request that mentions a forbidden host: ${path}`);
  if (used >= budget) throw new Error(`request budget (${budget}) reached`);
  used++;
  const t0 = performance.now();
  const res = await fetch(base + path, { redirect: 'manual', ...init });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ms: Math.round(performance.now() - t0), text, json, headers: res.headers };
}

try {
  const health = await call('/api/health');
  check('health answers 200', health.status === 200, `${health.status} in ${health.ms} ms`);

  const features = await call('/api/features');
  const f = features.json?.features || {};
  check('every guarded feature reports off', features.status === 200 && ['ai', 'askSources', 'discoveryCaptures', 'discoveryFetch', 'viewCapture'].every((k) => f[k] === false), JSON.stringify(f));

  // A deploy takes up to a minute to reach every location, and the previous version may still be serving. If any feature still
  // reports on, stop here: sending the route probes could do real work. (Found on staging 2026-10-26.)
  if (Object.values(f).some((v) => v !== false)) throw new Error('a feature still reports on (a deploy may still be propagating); not sending the route probes. Wait and rerun.');
  // The probe address is the reserved name probe.invalid (RFC 2606), which cannot exist, so even a route wrongly switched on
  // could not fetch anything from any website.
  const probes = [
    ['GET', '/api/fetch?url=https%3A%2F%2Fprobe.invalid%2F&ack=1&seed=1'],
    ['GET', '/api/captures?url=https%3A%2F%2Fprobe.invalid%2F'],
    ['GET', '/api/view-capture?url=https%3A%2F%2Fweb.archive.org%2Fweb%2F2020%2Fhttps%3A%2F%2Fprobe.invalid%2F'],
    ['POST', '/api/analyze/qualitative'],
    ['POST', '/api/analyze/ask-sources']
  ];
  for (const [method, path] of probes) {
    // Presented the way a browser on this site would, so a 404 can only mean "switched off", not "wrong caller".
    const r = await call(path, { method, headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}) });
    check(`${method} ${path.split('?')[0]} is switched off (404 not-available)`, r.status === 404 && r.json?.error === 'not-available', `${r.status} ${r.text.slice(0, 60)}`);
    check(`${method} ${path.split('?')[0]} leaks no secret or key name`, !/ANTHROPIC|sk-ant|api[_-]?key/i.test(r.text + [...r.headers].join(' ')));
  }

  const home = await call('/');
  check('home page loads and starts the app through boot.js with app.js preloaded', home.status === 200 && /\/boot\.js/.test(home.text) && /rel="modulepreload"\s+href="\/app\.js"/.test(home.text));
  const crawler = await call('/crawler');
  check('the public crawler information page loads', crawler.status === 200 && /ChroniumMind/.test(crawler.text));
  const upgrade = await call('/upgrade.js');
  check('the storage-upgrade script is served (the backup prompt can run)', upgrade.status === 200 && /BackupFileError/.test(upgrade.text));
} catch (e) {
  check('the smoke test ran to the end', false, e.message);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed, ${used} requests used of a budget of ${budget}.`);
if (logPath) fs.writeFileSync(logPath, JSON.stringify({ base, when: new Date().toISOString(), requestsUsed: used, budget, results }, null, 2));
process.exitCode = failed ? 1 : 0;
