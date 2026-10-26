#!/usr/bin/env node
// Stage 1, phase B: does the Rate Limiting binding work on this deployment? Exactly one question, at most 25 requests.
//   node scripts/probe-staging-limiter.mjs --base=https://chronium-mind-staging.<account>.workers.dev [--log=<file.json>]
//   node scripts/probe-staging-limiter.mjs --base=http://127.0.0.1:8795          (local `wrangler dev --env staging --var FEATURE_DISCOVERY_FETCH:on`)
//
// Needs ONLY the website fetch switch on in staging (every other switch off, AI off). Every request asks for the reserved name
// `probe.invalid`, which cannot exist (RFC 2606): the Worker passes the burst limiter, fails the DNS check and answers 400
// "address-refused" without contacting any website. So the only things this can show are: how many requests the binding lets
// through before it answers 429 "burst", and whether the binding is broken (503 "protection-unavailable").
//
// STOP CONDITIONS (the script ends at the first one): 25 requests sent; any 2xx answer (a real fetch happened: something is
// wrong); any 5xx answer (binding unsupported or broken, or the account is out of quota); 3 network errors in a row;
// the first 429 followed by 3 more 429s (the limiter has clearly engaged, no more requests are needed).
// Refuses to run against the production hostname, and never builds a request for any other host.
import fs from 'node:fs';

const arg = (n, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const base = (arg('base') || '').replace(/\/+$/, '');
const logPath = arg('log');
const MAX = 25;
if (!/^https?:\/\//.test(base)) { console.error('Give --base=<staging address>.'); process.exit(2); }
if (new URL(base).host === 'chronium-mind.truewolfflix777.workers.dev') { console.error('Refusing to run against production.'); process.exit(2); }

const target = `${base}/api/fetch?url=${encodeURIComponent('https://probe.invalid/')}&ack=1&seed=1`;
const rows = []; let stop = null; let netErrors = 0; let afterFirst429 = 0; let first429 = null;
for (let i = 1; i <= MAX && !stop; i++) {
  const t0 = performance.now();
  try {
    const res = await fetch(target, { headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }, redirect: 'manual' });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    netErrors = 0;
    rows.push({ n: i, status: res.status, error: json?.error || null, scope: json?.scope || null, reason: json?.reason || null, ms: Math.round(performance.now() - t0) });
    if (res.status >= 200 && res.status < 300) stop = `request ${i} answered ${res.status}: a real fetch happened`;
    else if (res.status >= 500) stop = `request ${i} answered ${res.status} (${json?.error || 'no error code'})`;
    else if (res.status === 429) { first429 ??= i; if (i > first429) afterFirst429++; if (afterFirst429 >= 3) stop = 'the limiter engaged and stayed engaged'; }
  } catch (e) {
    rows.push({ n: i, status: 0, error: `network: ${e.message}` });
    if (++netErrors >= 3) stop = '3 network errors in a row';
  }
}
if (!stop) stop = `${MAX} requests sent`;

const allowed = rows.filter((r) => r.status === 400 && r.error === 'address-refused').length;
const burst = rows.filter((r) => r.status === 429 && r.scope === 'burst').length;
const other = rows.filter((r) => !(r.status === 400 && r.error === 'address-refused') && !(r.status === 429 && r.scope === 'burst'));
console.log(rows.map((r) => `${String(r.n).padStart(2)}  ${r.status}  ${r.error || ''}${r.scope ? ' / ' + r.scope : ''}${r.reason ? ' / ' + r.reason : ''}`).join('\n'));
console.log(`\nstopped: ${stop}\nrequests sent: ${rows.length} of at most ${MAX}; passed the limiter: ${allowed}; refused by the burst limiter: ${burst}; anything else: ${other.length}`);

// The binding is approximate and counted per location, so the pass window is deliberately wide around the configured 15.
const ok = other.length === 0 && allowed >= 10 && allowed <= 20 && burst >= 1;
console.log(ok ? 'RESULT: the Rate Limiting binding is working (it let requests through, then refused).' : 'RESULT: NOT confirmed. Do not rely on the binding until this is understood.');
if (logPath) fs.writeFileSync(logPath, JSON.stringify({ base, when: new Date().toISOString(), stop, rows, allowed, burst, ok }, null, 2));
process.exit(ok ? 0 : 1);
