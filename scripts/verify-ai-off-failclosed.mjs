#!/usr/bin/env node
// Fail-closed proof for the "paid AI switched off" release. Loads the PATCHED Worker (the package's own src/index.js, unchanged) and
// calls it directly with every unusual value of AI_ENABLED, and with path tricks, to show that only the exact string "on" can reach the
// paid AI code, and that nothing is ever sent to any provider while the switch is off.
//   node scripts/verify-ai-off-failclosed.mjs --package=.release/ai-off-package
// No network is used: fetch is replaced by a recorder that FAILS the test if anything is requested, and there is no API key.
import path from 'node:path';
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const pkg = path.resolve(arg('package', '.release/ai-off-package'));
let failed = false;
const row = (ok, name, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failed = true; };

register('./json-import-hooks.mjs', pathToFileURL(fileURLToPath(import.meta.url)));
const { default: worker } = await import(pathToFileURL(path.join(pkg, 'src', 'index.js')).href);

const outbound = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => { outbound.push(String(url)); throw new Error(`blocked: ${url}`); };
const ctx = { waitUntil() {} };
const assets = { fetch: async () => new Response('asset-not-found', { status: 404 }) }; // stands in for the static-file handler
const BODY = JSON.stringify({ researchQuestion: 'q', evidenceItems: [{ id: 'a', excerptText: 'x' }, { id: 'b', excerptText: 'y' }], claims: [] });

async function hit(env, method, p, body) {
  const res = await worker.fetch(new Request(`https://x.example${p}`, { method, body, headers: body ? { 'content-type': 'application/json' } : {} }), { ASSETS: assets, ...env }, ctx);
  return { status: res.status, text: await res.text() };
}

// 1. Everything that is not exactly "on" leaves BOTH AI routes answering 404, for every method.
const notOn = [['(variable missing)', undefined], ['null', null], ['empty string', ''], ['space', ' '], ['ON', 'ON'], ['On', 'On'], ['oN', 'oN'], ['true', 'true'], ['TRUE', 'TRUE'], ['1', '1'], ['number 1', 1], ['boolean true', true], ['yes', 'yes'], ['enabled', 'enabled'], [' on', ' on'], ['on ', 'on '], ['on + newline', 'on\n'], ['tab + on', '\ton'], ['o n', 'o n'], ['on;', 'on;'], ['"on" with quotes', '"on"'], ['off', 'off'], ['false', 'false'], ['0', '0'], ['number 0', 0], ['boolean false', false], ['the word null', 'null'], ['the word undefined', 'undefined'], ['empty object', {}], ['empty array', []], ['array ["on"]', ['on']], ['object whose toString says on', { toString() { return 'on'; } }], ['Cyrillic o + n', 'оn'], ['full-width on', 'ｏｎ'], ['on + zero-width space', 'on​'], ['very long', 'on'.repeat(5000)]];
let reached = 0;
for (const [label, value] of notOn) {
  const env = value === undefined ? {} : { AI_ENABLED: value };
  const results = [await hit(env, 'GET', '/api/ai/usage'), await hit(env, 'GET', '/api/analyze/qualitative'), await hit(env, 'POST', '/api/analyze/qualitative', BODY), await hit(env, 'HEAD', '/api/analyze/qualitative'), await hit(env, 'OPTIONS', '/api/analyze/qualitative'), await hit(env, 'PUT', '/api/analyze/qualitative', BODY), await hit(env, 'POST', '/api/ai/usage', BODY)];
  const ok = results.every((r) => r.status === 404);
  if (!ok) reached++;
  row(ok, `AI_ENABLED = ${label}: both AI routes, 7 requests (GET, POST, HEAD, OPTIONS, PUT, usage)`, ok ? '' : results.map((r) => r.status).join(','));
}
row(reached === 0, `${notOn.length} values that are not exactly "on": none of them let any request reach the AI code`);

// 2. Path tricks cannot reach the handler either (the handler is only reached by an exact path match, and the gate uses the same match first).
const env0 = {};
for (const p of ['/api/analyze/qualitative/', '/API/ANALYZE/QUALITATIVE', '//api/analyze/qualitative', '/api/analyze/%71ualitative', '/api/analyze/qualitative%00', '/api/analyze/qualitative?x=1', '/api/analyze/qualitative#frag', '/api/analyze/./qualitative', '/api/analyze/../analyze/qualitative', '/api/ai/usage/', '/api/ai/usage.json', '/api/ai']) {
  const r = await hit(env0, 'POST', p, BODY);
  row(r.status === 404 && !/ok":true|AI analysis/.test(r.text), `POST ${p} -> ${r.status}`);
}

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } }; // the platform's cache, needed only once the route is enabled

// 3. The one value that turns it on is exactly "on". Even then, a call with too little evidence answers without any provider.
const on = await hit({ AI_ENABLED: 'on' }, 'POST', '/api/analyze/qualitative', JSON.stringify({ evidenceItems: [{ id: 'a', excerptText: 'x' }] }));
row(on.status === 200 && /skipped/.test(on.text), 'AI_ENABLED = "on" restores the route (a request with too little evidence is answered without any provider call)', `${on.status}`);
const usageOn = await hit({ AI_ENABLED: 'on' }, 'GET', '/api/ai/usage');
row(usageOn.status === 200, 'AI_ENABLED = "on" restores the usage route', `${usageOn.status}`);

// 4. While off, nothing went out, ever; with no key, even an enabled call cannot reach a provider.
row(outbound.length === 0, 'no outbound network request was attempted by any of the above', outbound.join(', '));
const noKey = await hit({ AI_ENABLED: 'on' }, 'POST', '/api/analyze/qualitative', BODY);
row(noKey.status === 502 && outbound.length === 0, 'enabled but with no key: the call fails inside the Worker, before any network request', `${noKey.status}, outbound ${outbound.length}`);

globalThis.fetch = realFetch;
console.log(failed ? '\nFAIL-CLOSED CHECK FAILED' : '\nFAIL-CLOSED CHECK PASSED');
process.exit(failed ? 1 : 0);
