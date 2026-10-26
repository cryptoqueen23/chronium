// Paid-AI size caps (src/guard.js aiCaps, used by src/index.js). AI stays OFF everywhere by default; these tests switch it on
// only inside the test, with a fake provider endpoint, so no network call is made and no money can be spent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { aiCaps, AI_CAP_DEFAULTS, aiRouteGuard } from '../src/guard.js';

// Load the Worker entry point as it is (see json-import-hooks.mjs).
register('./json-import-hooks.mjs', import.meta.url);
const { default: worker, buildEvidencePromptBody, buildPassagePromptBody } = await import('../src/index.js');

test('defaults: 600 output tokens, 8,000 characters of evidence text, and the request-body bound', () => {
  assert.deepEqual(aiCaps({}), { maxOutputTokens: 600, maxInputChars: 8000, maxBodyBytes: 256 * 1024 });
  assert.deepEqual(aiCaps(undefined), { ...AI_CAP_DEFAULTS });
});

test('configuration can only LOWER a cap outside test mode; anything else is ignored', () => {
  const prod = { ENVIRONMENT: 'production' };
  assert.equal(aiCaps({ ...prod, AI_MAX_OUTPUT_TOKENS: '300' }).maxOutputTokens, 300);
  assert.equal(aiCaps({ ...prod, AI_MAX_INPUT_CHARS: '4000' }).maxInputChars, 4000);
  assert.equal(aiCaps({ ...prod, AI_MAX_BODY_BYTES: '65536' }).maxBodyBytes, 65536);
  for (const bad of ['9999', '601', '0', '-5', '1.5', 'abc', '', ' ', '600abc', 'NaN', 'Infinity']) {
    assert.equal(aiCaps({ ...prod, AI_MAX_OUTPUT_TOKENS: bad }).maxOutputTokens, 600, `output: ${JSON.stringify(bad)}`);
  }
  assert.equal(aiCaps({ ...prod, AI_MAX_INPUT_CHARS: '12000' }).maxInputChars, 8000, 'raising back to the old 12,000 is refused');
  assert.equal(aiCaps({ ...prod, AI_MAX_BODY_BYTES: String(10 * 1024 * 1024) }).maxBodyBytes, 256 * 1024);
});

test('test mode (never production) may set exact values, so tests can be exact', () => {
  assert.equal(aiCaps({ ENVIRONMENT: 'development', TEST_MODE: 'on', AI_MAX_OUTPUT_TOKENS: '2000' }).maxOutputTokens, 2000);
  assert.equal(aiCaps({ ENVIRONMENT: 'production', TEST_MODE: 'on', AI_MAX_OUTPUT_TOKENS: '2000' }).maxOutputTokens, 600);
});

const item = (n, len = 590) => ({ id: `ev-${n}`, excerptType: 'quote', location: `p.${n}`, excerptText: 'x'.repeat(len) });

test('evidence text sent to the model is cut at the cap and the person is told it was cut', () => {
  const items = Array.from({ length: 60 }, (_, i) => item(i));
  const a = buildEvidencePromptBody(items, [], 8000);
  assert.equal(a.truncated, true);
  assert.ok(a.promptBody.length < 8000 + 200, `evidence block is ${a.promptBody.length} characters`);
  assert.match(a.promptBody, /Analysis is based on the first \d+ of 60 evidence items/);
  const b = buildEvidencePromptBody(items, [], 3000);
  assert.ok(b.promptBody.length < a.promptBody.length && b.promptBody.length < 3200);
  const small = buildEvidencePromptBody(items.slice(0, 3), [{ claimId: 'c1', text: 'a claim' }], 8000);
  assert.equal(small.truncated, false);
  assert.match(small.promptBody, /a claim/);
  const p = buildPassagePromptBody(Array.from({ length: 60 }, (_, i) => ({ id: `p-${i}`, location: 'p', excerptText: 'y'.repeat(590) })), 8000);
  assert.equal(p.truncated, true);
  assert.ok(p.promptBody.length < 8200);
});

test('body-size check uses the configured cap and runs before any spending', async () => {
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  try {
    const env = { ENVIRONMENT: 'staging', AI_ENABLED: 'on', AI_PER_VISITOR_PER_DAY: '5', AI_DAILY_CEILING: '50', AI_MAX_BODY_BYTES: '1000' };
    const mk = (len) => new Request('http://w/api/analyze/qualitative', { method: 'POST', headers: { 'content-length': String(len), 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '192.0.2.50' } });
    assert.equal((await aiRouteGuard(mk(1001), env, 'qualitative')).status, 413);
    assert.equal(await aiRouteGuard(mk(1000), env, 'qualitative'), null);
  } finally { delete globalThis.caches; }
});

// End to end through the Worker with the provider endpoint replaced: what actually leaves the Worker.
async function callWorker(envExtra, items) {
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => { const v = store.get(r.url); return v ? v.clone() : undefined; }, put: async (r, res) => { store.set(r.url, res.clone()); } } };
  const realFetch = globalThis.fetch; const sent = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.anthropic.com/')) {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ model: 'stub', content: [{ type: 'text', text: '{"themes":[],"patterns":[],"contradictions":[],"synthesis":"ok"}' }], usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected network call: ${url}`);
  };
  try {
    const env = { ENVIRONMENT: 'staging', AI_ENABLED: 'on', AI_PER_VISITOR_PER_DAY: '9', AI_DAILY_CEILING: '90', ANTHROPIC_API_KEY: 'stub-key-not-real', AI_PROVIDER: 'anthropic', ...envExtra };
    const body = JSON.stringify({ researchQuestion: 'q', evidenceItems: items, claims: [] });
    const request = new Request('http://w/api/analyze/qualitative', { method: 'POST', body, headers: { 'content-type': 'application/json', 'content-length': String(body.length), 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '192.0.2.77' } });
    const res = await worker.fetch(request, env, { waitUntil: () => {} });
    return { status: res.status, json: await res.json(), sent };
  } finally { globalThis.fetch = realFetch; delete globalThis.caches; }
}

test('through the Worker: the model is asked for at most 600 tokens and sees at most the evidence cap', async () => {
  const items = Array.from({ length: 60 }, (_, i) => item(i));
  const r = await callWorker({}, items);
  assert.equal(r.status, 200);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].max_tokens, 600);
  const text = r.sent[0].messages[0].content;
  assert.ok(text.length < 8000 + 600, `prompt text is ${text.length} characters`);
  assert.equal(r.json.truncated, true);
});

test('through the Worker: a lower configured cap is honoured, a higher one is not', async () => {
  const items = Array.from({ length: 60 }, (_, i) => item(i));
  const low = await callWorker({ AI_MAX_OUTPUT_TOKENS: '250', AI_MAX_INPUT_CHARS: '2000' }, items);
  assert.equal(low.sent[0].max_tokens, 250);
  assert.ok(low.sent[0].messages[0].content.length < 2600);
  const high = await callWorker({ AI_MAX_OUTPUT_TOKENS: '4000', AI_MAX_INPUT_CHARS: '50000' }, items);
  assert.equal(high.sent[0].max_tokens, 600);
  assert.ok(high.sent[0].messages[0].content.length < 8600);
});

test('AI stays off: with the switch off or the ceilings missing, nothing is sent anywhere', async () => {
  const items = Array.from({ length: 5 }, (_, i) => item(i));
  const off = await callWorker({ AI_ENABLED: 'off' }, items);
  assert.equal(off.status, 404); assert.equal(off.sent.length, 0);
  const noCeil = await callWorker({ AI_PER_VISITOR_PER_DAY: undefined, AI_DAILY_CEILING: undefined }, items);
  assert.equal(noCeil.status, 404); assert.equal(noCeil.sent.length, 0);
});
