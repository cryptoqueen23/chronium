// Stage 1: the Workers Rate Limiting binding integration (src/guard.js), tested deterministically with a fake binding.
// The binding fails CLOSED once RATE_LIMIT_BINDING is "required" and does nothing at all when it is not (production).
// The real binding's behaviour on Cloudflare (Free-plan support, per-location accuracy) is NOT tested here: it can only be
// observed on a deployed staging Worker (docs/STAGE1_STAGING_PROPOSAL.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceBindingLimit, enforceLimits, enforceAiLimits, bindingRequired, RATE_LIMIT_BINDINGS, publicFeatures, featureGate } from '../src/guard.js';

const req = (ip = '192.0.2.10') => new Request('https://x.example/api/fetch', { headers: { 'cf-connecting-ip': ip } });
const fake = (answers) => { const calls = []; return { calls, limit: async (o) => { calls.push(o); const a = answers.shift(); if (a instanceof Error) throw a; return a; } }; };
const stagingEnv = (extra = {}) => ({ ENVIRONMENT: 'staging', RATE_LIMIT_BINDING: 'required', AI_ENABLED: 'on', AI_PER_VISITOR_PER_DAY: '5', AI_DAILY_CEILING: '50', ...extra });
const withCounters = async (fn) => {
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => { const v = store.get(r.url); return v ? v.clone() : undefined; }, put: async (r, res) => { store.set(r.url, res.clone()); } } };
  try { return await fn(store); } finally { delete globalThis.caches; }
};

test('without RATE_LIMIT_BINDING=required nothing changes: the binding is never called (production behaviour)', async () => {
  for (const value of [undefined, '', 'off', 'on', 'true', 'Required', ' required']) {
    const b = fake([{ success: false }]);
    assert.equal(await enforceBindingLimit(req(), { ENVIRONMENT: 'production', RATE_LIMIT_BINDING: value, RL_FETCH: b }, 'fetch'), null, String(value));
    assert.equal(b.calls.length, 0);
    assert.equal(bindingRequired({ RATE_LIMIT_BINDING: value }), false);
  }
});

test('required: an allowed request passes, and the key names the route and the visitor', async () => {
  const b = fake([{ success: true }, { success: true }]);
  assert.equal(await enforceBindingLimit(req('198.51.100.7'), stagingEnv({ RL_FETCH: b }), 'fetch'), null);
  assert.deepEqual(b.calls[0], { key: 'fetch:198.51.100.7' });
  assert.equal(await enforceBindingLimit(req('198.51.100.7'), stagingEnv({ RL_FETCH: b }), 'captures'), null);
  assert.deepEqual(b.calls[1], { key: 'captures:198.51.100.7' }, 'captures shares the RL_FETCH limiter but has its own key');
  assert.equal(RATE_LIMIT_BINDINGS.fetch, 'RL_FETCH');
  assert.equal(RATE_LIMIT_BINDINGS.viewCapture, 'RL_VIEWCAPTURE');
  assert.equal(RATE_LIMIT_BINDINGS.ai, 'RL_AI');
});

test('required: a refused request is a 429 with Retry-After, and says it was the burst limiter', async () => {
  const r = await enforceBindingLimit(req(), stagingEnv({ RL_FETCH: fake([{ success: false }]) }), 'fetch');
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '60');
  assert.deepEqual(await r.json(), { error: 'rate-limited', scope: 'burst' });
});

test('required: every kind of broken binding refuses with 503 (fails closed)', async () => {
  const cases = {
    'binding missing': {}, 'binding is null': { RL_FETCH: null }, 'binding without limit()': { RL_FETCH: {} }, 'limit is not a function': { RL_FETCH: { limit: 'yes' } },
    'limit throws': { RL_FETCH: fake([new Error('down')]) }, 'limit rejects with nothing': { RL_FETCH: { limit: async () => { throw undefined; } } },
    'answer undefined': { RL_FETCH: fake([undefined]) }, 'answer null': { RL_FETCH: fake([null]) }, 'answer empty object': { RL_FETCH: fake([{}]) },
    'success is a string': { RL_FETCH: fake([{ success: 'true' }]) }, 'success is 1': { RL_FETCH: fake([{ success: 1 }]) }
  };
  for (const [name, extra] of Object.entries(cases)) {
    const r = await enforceBindingLimit(req(), stagingEnv(extra), 'fetch');
    assert.equal(r?.status, 503, name);
    assert.deepEqual(await r.json(), { error: 'protection-unavailable' }, name);
  }
});

test("a route's own binding is the one that is checked (a present RL_FETCH does not cover the AI route)", async () => {
  const r = await enforceBindingLimit(req(), stagingEnv({ RL_FETCH: fake([{ success: true }]) }), 'ai');
  assert.equal(r.status, 503);
});

test('enforceLimits: the burst limiter is consulted first, and a refusal never reaches the counters', async () => {
  await withCounters(async (store) => {
    const r = await enforceLimits(req(), stagingEnv({ RL_FETCH: fake([{ success: false }]) }), 'fetch', { site: 'example.org' });
    assert.equal(r.status, 429);
    assert.equal(store.size, 0, 'no counter was touched');
  });
});

test('enforceLimits: allowed by the burst limiter, the counters still apply', async () => {
  await withCounters(async (store) => {
    const env = stagingEnv({ RL_FETCH: fake(Array.from({ length: 20 }, () => ({ success: true }))), LIMIT_FETCH_PER_IP_PER_MIN: '2' });
    assert.equal(await enforceLimits(req(), env, 'fetch'), null);
    assert.equal(await enforceLimits(req(), env, 'fetch'), null);
    const third = await enforceLimits(req(), env, 'fetch');
    assert.equal(third.status, 429);
    assert.equal((await third.json()).scope, 'visitor');
    assert.ok(store.size > 0);
  });
});

test('enforceLimits: with the binding required but missing, the counters are not a fallback (503)', async () => {
  await withCounters(async (store) => {
    const r = await enforceLimits(req(), stagingEnv(), 'fetch');
    assert.equal(r.status, 503);
    assert.equal(store.size, 0);
  });
});

test('AI: the burst limiter runs before the AI counters, and fails closed too', async () => {
  await withCounters(async (store) => {
    const denied = await enforceAiLimits(req(), stagingEnv({ RL_AI: fake([{ success: false }]) }));
    assert.equal(denied.status, 429);
    assert.equal(store.size, 0);
    const missing = await enforceAiLimits(req(), stagingEnv());
    assert.equal(missing.status, 503);
    assert.equal(store.size, 0);
    const ok = await enforceAiLimits(req(), stagingEnv({ RL_AI: fake([{ success: true }]) }));
    assert.equal(ok, null);
    assert.ok(store.size > 0);
  });
});

test('without the AI ceilings the AI route is still 404, binding or not (the older rule is not weakened)', async () => {
  const r = await enforceAiLimits(req(), { ENVIRONMENT: 'staging', RATE_LIMIT_BINDING: 'required', RL_AI: fake([{ success: true }]) });
  assert.equal(r.status, 404);
});

test('the capture viewer is never available in a production environment, whatever its switch says', () => {
  const prod = { ENVIRONMENT: 'production', FEATURE_VIEW_CAPTURE: 'on' };
  assert.equal(publicFeatures(prod).viewCapture, false);
  assert.equal(featureGate(prod, 'viewCapture').status, 404);
  assert.equal(featureGate({ FEATURE_VIEW_CAPTURE: 'on' }, 'viewCapture').status, 404, 'an unset ENVIRONMENT counts as production');
  assert.equal(featureGate({ ENVIRONMENT: 'staging', FEATURE_VIEW_CAPTURE: 'on' }, 'viewCapture'), null, 'the unit-test environments are unchanged');
});
