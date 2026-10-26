// Independent server-side AI limits: a daily TOKEN ceiling counted by our own Worker, and a latch that stops calling OpenAI for the rest
// of the day once it reports a spend, credit or usage limit. They do not depend on OpenAI's own hard spend limit (whose enforcement,
// OpenAI says, "is not instantaneous, so recorded spend can slightly exceed the configured amount"). AI is OFF by default; here it is
// switched on only inside a test, with OpenAI replaced by a stub: no key, no network, no money.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { aiTokenCeiling, AI_TOKENS_PER_CALL_WORST_CASE, PROVIDER_LIMIT_CODES, isProviderLimitError, recordAiTokens, enforceAiLimits } from '../src/guard.js';

register('./json-import-hooks.mjs', import.meta.url);
const { default: worker } = await import('../src/index.js');

const ENV = { ENVIRONMENT: 'staging', AI_ENABLED: 'on', AI_PER_VISITOR_PER_DAY: '50', AI_DAILY_CEILING: '50', OPENAI_API_KEY: 'sk-test-THIS-IS-NOT-A-REAL-KEY-0123456789' };
const msg = (t) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: t }] });
const GOOD = JSON.stringify({ themes: [{ title: 'T', description: 'D', evidenceIds: ['ev-1'] }], patterns: [], contradictions: [], synthesis: 'S' });
const items = ['ev-1', 'ev-2', 'ev-3'].map((id) => ({ id, excerptType: 'quote', location: 'p.1', excerptText: `Text of ${id}.` }));

// One fake data-centre cache shared across several calls of one test, so counters persist between requests.
function makeWorld() {
  const store = new Map();
  const cache = { default: { match: async (r) => { const v = store.get(r.url); return v ? v.clone() : undefined; }, put: async (r, res) => { store.set(r.url, res.clone()); } } };
  return { store, cache };
}
let seq = 0;
async function callIn(world, answer, envExtra = {}, ip = '198.51.100.20') {
  globalThis.caches = world.cache;
  const real = globalThis.fetch; const sent = [];
  globalThis.fetch = async (url) => {
    if (String(url) !== 'https://api.openai.com/v1/responses') throw new Error(`unexpected network call: ${url}`);
    sent.push(1);
    return typeof answer === 'function' ? answer() : new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const env = { ...ENV, ...envExtra };
    // Every request differs, or the Worker's own 30-minute answer cache would serve repeats without reaching the provider.
    const body = JSON.stringify({ researchQuestion: `q${++seq}`, evidenceItems: items, claims: [] });
    const req = new Request('http://w/api/analyze/qualitative', { method: 'POST', body, headers: { 'content-type': 'application/json', 'content-length': String(body.length), 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': ip } });
    const res = await worker.fetch(req, env, { waitUntil: () => {} });
    return { status: res.status, json: await res.json(), calls: sent.length };
  } finally { globalThis.fetch = real; delete globalThis.caches; }
}
const done = (inTok, outTok, text = GOOD) => ({ status: 'completed', model: 'gpt-6-luna', output: [msg(text)], usage: { input_tokens: inTok, output_tokens: outTok } });

test('the daily token ceiling defaults to global calls per day x the worst-case tokens of one call, and configuration can only lower it', () => {
  assert.equal(AI_TOKENS_PER_CALL_WORST_CASE, 4000);
  assert.equal(aiTokenCeiling(ENV), 50 * 4000);
  assert.equal(aiTokenCeiling({ ...ENV, AI_DAILY_TOKEN_CEILING: '90000' }), 90000);
  for (const bad of ['999999999', '200001', '0', '-4', '1.5', 'many', '', ' ']) assert.equal(aiTokenCeiling({ ...ENV, AI_DAILY_TOKEN_CEILING: bad }), 200000, JSON.stringify(bad));
  assert.equal(aiTokenCeiling({ ...ENV, ENVIRONMENT: 'development', TEST_MODE: 'on', AI_DAILY_TOKEN_CEILING: '999999' }), 999999, 'test mode only');
  assert.equal(aiTokenCeiling({ ENVIRONMENT: 'staging', AI_ENABLED: 'on' }), null, 'no call ceiling means no AI at all');
});

test('tokens used are counted from what the provider reports, and once the daily ceiling is reached no further call reaches the provider', async () => {
  const world = makeWorld();
  const env = { AI_DAILY_TOKEN_CEILING: '1000' };
  const first = await callIn(world, done(400, 90), env);          // 490 used
  assert.equal(first.status, 200); assert.equal(first.calls, 1);
  const second = await callIn(world, done(400, 90), env);         // 980 used, still under 1000
  assert.equal(second.status, 200); assert.equal(second.calls, 1);
  const third = await callIn(world, done(400, 90), env);          // 980 < 1000: allowed, reaches 1470
  assert.equal(third.status, 200); assert.equal(third.calls, 1);
  const fourth = await callIn(world, done(400, 90), env);         // 1470 >= 1000: refused BEFORE any provider call
  assert.equal(fourth.status, 503); assert.equal(fourth.json.error, 'unavailable-today'); assert.equal(fourth.calls, 0);
});

test('calls that were cut off, refused or malformed still count (they cost money)', async () => {
  const world = makeWorld(); const env = { AI_DAILY_TOKEN_CEILING: '1000' };
  const cut = await callIn(world, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [msg('{"a"')], usage: { input_tokens: 900, output_tokens: 600 } }, env);
  assert.equal(cut.status, 502); assert.equal(cut.json.error, 'ai-truncated');
  const after = await callIn(world, done(1, 1), env);
  assert.equal(after.status, 503); assert.equal(after.calls, 0, 'the truncated call used 1,500 tokens, over the 1,000 ceiling');
});

test('the ceiling is per UTC day: yesterday\'s usage does not block today', async () => {
  const world = makeWorld();
  const realNow = Date.now; const realDate = globalThis.Date;
  const first = await callIn(world, done(2000, 600), { AI_DAILY_TOKEN_CEILING: '1000' });
  assert.equal(first.status, 200);
  assert.equal((await callIn(world, done(1, 1), { AI_DAILY_TOKEN_CEILING: '1000' })).status, 503);
  // Move the clock forward one day.
  class Tomorrow extends realDate { constructor(...a) { if (a.length) super(...a); else super(realNow() + 86_400_000); } static now() { return realNow() + 86_400_000; } }
  globalThis.Date = Tomorrow;
  try { assert.equal((await callIn(world, done(1, 1), { AI_DAILY_TOKEN_CEILING: '1000' })).status, 200); } finally { globalThis.Date = realDate; }
});

test('a provider spend, credit or usage limit stops all further provider calls for the day (the latch)', async () => {
  for (const code of PROVIDER_LIMIT_CODES) {
    const world = makeWorld();
    const limited = () => new Response(JSON.stringify({ error: { message: 'You exceeded your current quota. sk-test-ECHO', type: 'insufficient_quota', code } }), { status: 429, headers: { 'content-type': 'application/json' } });
    const first = await callIn(world, limited);
    assert.equal(first.status, 502, code); assert.equal(first.calls, 1);
    assert.equal(JSON.stringify(first.json).includes('sk-test'), false, 'no echoed text reaches the person');
    const next = await callIn(world, done(10, 10));
    assert.equal(next.status, 503, code); assert.equal(next.json.error, 'unavailable-today'); assert.equal(next.calls, 0, `${code}: OpenAI is not called again today`);
  }
});

test('an ordinary rate limit or a server error does NOT latch: the next request may try again', async () => {
  for (const [status, code] of [[429, 'rate_limit_exceeded'], [500, 'server_error'], [503, ''], [401, 'invalid_api_key'], [400, 'unsupported_value']]) {
    const world = makeWorld();
    const err = () => new Response(JSON.stringify({ error: { code, message: 'x' } }), { status, headers: { 'content-type': 'application/json' } });
    assert.equal((await callIn(world, err)).status, 502, `${status} ${code}`);
    const next = await callIn(world, done(10, 10));
    assert.equal(next.status, 200, `${status} ${code}`); assert.equal(next.calls, 1);
  }
  assert.equal(isProviderLimitError({ providerCode: 'rate_limit_exceeded' }), false); assert.equal(isProviderLimitError(new Error('x')), false); assert.equal(isProviderLimitError(null), false);
});

test('refused requests use no visitor allowance, and the request limits still apply independently of tokens', async () => {
  const world = makeWorld();
  // Request-count limits (per visitor per day) are unchanged and independent of the token ceiling.
  const env = { AI_PER_VISITOR_PER_DAY: '2', AI_DAILY_CEILING: '50' };
  assert.equal((await callIn(world, done(5, 5), env)).status, 200);
  assert.equal((await callIn(world, done(5, 5), env)).status, 200);
  const third = await callIn(world, done(5, 5), env);
  assert.equal(third.status, 429); assert.equal(third.json.error, 'daily-limit'); assert.equal(third.calls, 0);
  // A different visitor is still served, until the GLOBAL request ceiling.
  assert.equal((await callIn(world, done(5, 5), env, '198.51.100.21')).status, 200);
});

test('broken limit storage fails closed: no provider call', async () => {
  globalThis.caches = { default: { match: async () => { throw new Error('down'); }, put: async () => { throw new Error('down'); } } };
  const real = globalThis.fetch; let called = 0; globalThis.fetch = async () => { called++; throw new Error('must not be called'); };
  try {
    const body = JSON.stringify({ researchQuestion: 'q', evidenceItems: items, claims: [] });
    const res = await worker.fetch(new Request('http://w/api/analyze/qualitative', { method: 'POST', body, headers: { 'content-length': String(body.length), 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '198.51.100.30' } }), ENV, { waitUntil: () => {} });
    assert.equal(res.status, 503); assert.equal(called, 0);
  } finally { globalThis.fetch = real; delete globalThis.caches; }
});

test('recording zero, negative or junk token counts changes nothing', async () => {
  const world = makeWorld(); globalThis.caches = world.cache;
  try {
    for (const v of [0, -5, NaN, undefined, null, 'x']) await recordAiTokens(ENV, v);
    assert.equal(world.store.size, 0);
    assert.equal(await enforceAiLimits(new Request('http://w/', { headers: { 'cf-connecting-ip': '198.51.100.40' } }), ENV), null);
  } finally { delete globalThis.caches; }
});
