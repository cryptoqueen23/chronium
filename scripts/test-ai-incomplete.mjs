// A cut-off, malformed or unfinished structured answer must never be mistaken for a complete analysis (src/aiResult.js, and the
// two AI handlers in src/index.js). AI is OFF by default; here it is switched on only inside each test, with the provider replaced
// by a stub, so nothing is sent anywhere and no money can be spent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { interpretAnalysis, interpretAskSources, completionState, parseJsonObject, validateAnalysis, validateAskSources, incompleteBody } from '../src/aiResult.js';
import { acceptFreshAiResult } from '../public/aiGate.js';

register('./json-import-hooks.mjs', import.meta.url);
const { default: worker } = await import('../src/index.js');

const EV = new Set(['ev-1', 'ev-2']);
const PS = new Set(['p-1', 'p-2']);
const goodAnalysis = { themes: [{ title: 'Votes', description: 'Two votes recorded.', evidenceIds: ['ev-1', 'ev-2'] }], patterns: [{ description: 'Same member each time.', evidenceIds: ['ev-1'] }], contradictions: [], synthesis: 'The minutes record two votes.' };
const goodAsk = { answer: 'Payne voted yes.', citedPassageIds: ['p-1'], insufficient: false, missing: '' };
const A = JSON.stringify(goodAnalysis); const K = JSON.stringify(goodAsk);

test('a complete, well-formed, finished answer is accepted, and only then', () => {
  const a = interpretAnalysis(A, 'end_turn', EV);
  assert.equal(a.complete, true); assert.equal(a.result.complete, true); assert.equal(a.result.parseError, false);
  const k = interpretAskSources(K, 'end_turn', PS);
  assert.equal(k.complete, true); assert.equal(k.result.complete, true);
  const fenced = interpretAnalysis('```json\n' + A + '\n```', 'end_turn', EV);
  assert.equal(fenced.complete, true, 'a matching pair of fences is allowed');
  assert.equal(interpretAskSources(JSON.stringify({ answer: '', citedPassageIds: [], insufficient: true, missing: 'No passage mentions the vote.' }), 'end_turn', PS).complete, true, '"not enough in the passages" is a valid complete answer');
});

test('the stop reason decides: only end_turn means the model finished', () => {
  assert.equal(completionState('end_turn'), 'finished');
  assert.equal(completionState('max_tokens'), 'truncated');
  assert.equal(completionState('refusal'), 'refused');
  for (const other of [undefined, null, '', 'tool_use', 'pause_turn', 'stop_sequence', 'model_context_window_exceeded', 'END_TURN', 42]) assert.equal(completionState(other), 'unverified', String(other));
  // A perfectly valid answer is still refused if it was cut off or if nobody can say it finished.
  assert.deepEqual(interpretAnalysis(A, 'max_tokens', EV), { complete: false, reason: 'truncated' });
  assert.deepEqual(interpretAskSources(K, 'max_tokens', PS), { complete: false, reason: 'truncated' });
  assert.deepEqual(interpretAnalysis(A, 'refusal', EV), { complete: false, reason: 'refused' });
  for (const sr of [undefined, null, 'tool_use', 'pause_turn']) {
    assert.deepEqual(interpretAnalysis(A, sr, EV), { complete: false, reason: 'unverified' }, String(sr));
    assert.deepEqual(interpretAskSources(K, sr, PS), { complete: false, reason: 'unverified' }, String(sr));
  }
});

test('EVERY proper prefix of a valid answer is refused, even if the provider claims it finished', () => {
  for (const [full, interpret, ids] of [[A, interpretAnalysis, EV], [K, interpretAskSources, PS], ['```json\n' + A + '\n```', interpretAnalysis, EV]]) {
    for (let n = 0; n < full.length; n++) {
      for (const sr of ['end_turn', 'max_tokens', null]) {
        const r = interpret(full.slice(0, n), sr, ids);
        assert.equal(r.complete, false, `prefix of ${n} characters with stop reason ${sr} was accepted: ${JSON.stringify(full.slice(0, n)).slice(-40)}`);
      }
    }
    assert.equal(interpret(full, 'end_turn', ids).complete, true);
  }
});

test('valid JSON of the wrong kind or shape is malformed, not an empty analysis', () => {
  const bad = ['{}', '[]', 'null', '"text"', '42', 'true', '', '   ', 'not json', '{"themes":[]}', JSON.stringify({ ...goodAnalysis, synthesis: '' }), JSON.stringify({ ...goodAnalysis, synthesis: '   ' }),
    JSON.stringify({ ...goodAnalysis, synthesis: 7 }), JSON.stringify({ ...goodAnalysis, themes: 'none' }), JSON.stringify({ ...goodAnalysis, patterns: null }), JSON.stringify({ ...goodAnalysis, contradictions: {} }),
    JSON.stringify({ ...goodAnalysis, themes: [null] }), JSON.stringify({ ...goodAnalysis, themes: ['a theme'] }), JSON.stringify({ ...goodAnalysis, themes: [{ title: 'T', description: 'D' }] }),
    JSON.stringify({ ...goodAnalysis, themes: [{ title: '', description: 'D', evidenceIds: [] }] }), JSON.stringify({ ...goodAnalysis, themes: [{ title: 'T', description: 'D', evidenceIds: 'ev-1' }] }),
    JSON.stringify({ ...goodAnalysis, themes: [{ title: 'T', description: 'D', evidenceIds: [1] }] }), JSON.stringify({ ...goodAnalysis, patterns: [{ evidenceIds: [] }] }),
    JSON.stringify({ ...goodAnalysis, contradictions: [{ description: '' , evidenceIds: [] }] }),
    'Here is the analysis: ' + A, A + '\nHope that helps!', '```json\n' + A, A + '\n```', '```\n' + A, A + A, A + ',', '[' + A + ']'];
  for (const t of bad) assert.equal(interpretAnalysis(t, 'end_turn', EV).complete, false, t.slice(0, 80));
  const badAsk = ['{}', '[]', 'null', '{"answer":"x"}', JSON.stringify({ ...goodAsk, insufficient: 'false' }), JSON.stringify({ ...goodAsk, insufficient: 0 }), JSON.stringify({ ...goodAsk, insufficient: undefined }),
    JSON.stringify({ ...goodAsk, answer: '' }), JSON.stringify({ ...goodAsk, answer: '  ' }), JSON.stringify({ ...goodAsk, answer: 5 }), JSON.stringify({ ...goodAsk, citedPassageIds: [] }),
    JSON.stringify({ ...goodAsk, citedPassageIds: 'p-1' }), JSON.stringify({ ...goodAsk, citedPassageIds: [1] }), JSON.stringify({ ...goodAsk, missing: null }),
    JSON.stringify({ answer: '', citedPassageIds: [], insufficient: true, missing: '' }), JSON.stringify({ answer: '', citedPassageIds: [], insufficient: true }),
    'Sure! ' + K, K + ' done'];
  for (const t of badAsk) assert.equal(interpretAskSources(t, 'end_turn', PS).complete, false, String(t).slice(0, 80));
});

test('citations must name something this request actually supplied', () => {
  assert.equal(interpretAnalysis(JSON.stringify({ ...goodAnalysis, themes: [{ title: 'T', description: 'D', evidenceIds: ['ev-99'] }] }), 'end_turn', EV).complete, false);
  assert.equal(interpretAskSources(JSON.stringify({ ...goodAsk, citedPassageIds: ['p-1', 'p-404'] }), 'end_turn', PS).complete, false);
  assert.equal(interpretAskSources(JSON.stringify({ answer: '', citedPassageIds: ['p-404'], insufficient: true, missing: 'x' }), 'end_turn', PS).complete, false, 'even a refusal may not cite what does not exist');
  assert.equal(interpretAnalysis(A, 'end_turn', new Set(['ev-1'])).complete, false, 'ev-2 was not sent');
  assert.equal(interpretAnalysis(A, 'end_turn', null).complete, true, 'no allow-list given means no check, only for direct unit use');
});

test('parseJsonObject: one object only', () => {
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  assert.equal(parseJsonObject('[1]'), null); assert.equal(parseJsonObject(null), null); assert.equal(parseJsonObject(undefined), null); assert.equal(parseJsonObject({}), null);
  assert.equal(validateAnalysis(undefined), false); assert.equal(validateAskSources(null), false);
});

test('an incomplete result is a plain refusal that contains no model text', () => {
  for (const reason of ['truncated', 'malformed', 'unverified', 'refused']) {
    const b = incompleteBody(reason);
    assert.equal(b.ok, false); assert.match(b.error, /^ai-/); assert.equal(b.incomplete, reason);
    assert.deepEqual(Object.keys(b).sort(), ['error', 'incomplete', 'ok']);
  }
});

test('the page refuses anything that is not marked complete (old, cached or hand-made results too)', () => {
  const ok = { ok: true, result: { complete: true, parseError: false } };
  assert.equal(acceptFreshAiResult(ok), true);
  for (const d of [null, undefined, {}, { ok: true }, { ok: true, result: null }, { ok: true, result: {} }, { ok: true, result: { complete: false } }, { ok: true, result: { complete: 'true' } },
    { ok: true, result: { complete: true, parseError: true } }, { ok: false, result: { complete: true, parseError: false } }, { ok: true, result: { themes: [], synthesis: 'x', parseError: false } }, { ok: true, incomplete: 'truncated', result: { complete: true } }]) {
    assert.equal(acceptFreshAiResult(d), false, JSON.stringify(d));
  }
});

// ---- through the real Worker entry point, with the provider replaced by a stub ----
const items = ['ev-1', 'ev-2', 'ev-3'].map((id) => ({ id, excerptType: 'quote', location: 'p.1', excerptText: `Text of ${id}.` }));
async function call(route, answer, envExtra = {}, ip = '192.0.2.88') {
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => { const v = store.get(r.url); return v ? v.clone() : undefined; }, put: async (r, res) => { store.set(r.url, res.clone()); } } };
  const realFetch = globalThis.fetch; const sent = [];
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.anthropic.com/')) throw new Error(`unexpected network call: ${url}`);
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ model: 'stub', content: [{ type: 'text', text: answer.text }], stop_reason: answer.stop, usage: { input_tokens: 10, output_tokens: 20 } }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const env = { ENVIRONMENT: 'staging', AI_ENABLED: 'on', FEATURE_ASK_SOURCES: 'on', AI_PER_VISITOR_PER_DAY: '99', AI_DAILY_CEILING: '999', ANTHROPIC_API_KEY: 'stub-key-not-real', AI_PROVIDER: 'anthropic', ...envExtra };
    const payload = route === 'qualitative' ? { researchQuestion: 'q', evidenceItems: items, claims: [] } : { question: 'Who voted yes?', passages: items.map((e) => ({ id: e.id.replace('ev', 'p'), location: 'p.1', excerptText: e.excerptText })) };
    const body = JSON.stringify(payload);
    const mk = () => new Request(`http://w/api/analyze/${route === 'qualitative' ? 'qualitative' : 'ask-sources'}`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'content-length': String(body.length), 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': ip } });
    const res = await worker.fetch(mk(), env, { waitUntil: () => {} });
    const first = { status: res.status, json: await res.json() };
    const again = await worker.fetch(mk(), env, { waitUntil: () => {} });
    return { first, second: { status: again.status, json: await again.json() }, providerCalls: sent.length };
  } finally { globalThis.fetch = realFetch; delete globalThis.caches; }
}

for (const route of ['qualitative', 'ask']) {
  const good = route === 'qualitative' ? { text: A, stop: 'end_turn' } : { text: JSON.stringify({ answer: 'Payne voted yes.', citedPassageIds: ['p-1'], insufficient: false, missing: '' }), stop: 'end_turn' };
  const cut = { text: good.text.slice(0, Math.floor(good.text.length * 0.6)), stop: 'max_tokens' };

  test(`${route}: a cut-off answer is refused (502, no result, no model text) and is never cached`, async () => {
    const r = await call(route, cut);
    assert.equal(r.first.status, 502);
    assert.deepEqual(r.first.json, { ok: false, error: 'ai-truncated', incomplete: 'truncated' });
    assert.equal(r.second.status, 502);
    assert.equal(r.providerCalls, 2, 'the second identical request went to the provider again: the refusal was not cached');
  });
  test(`${route}: a cut-off answer is refused even when the provider claims it finished`, async () => {
    const r = await call(route, { text: cut.text, stop: 'end_turn' });
    assert.deepEqual(r.first.json, { ok: false, error: 'ai-malformed', incomplete: 'malformed' });
  });
  test(`${route}: a well-formed answer with an unknown or missing stop reason is refused as unverified`, async () => {
    for (const stop of [undefined, null, 'tool_use']) {
      const r = await call(route, { text: good.text, stop });
      assert.deepEqual(r.first.json, { ok: false, error: 'ai-unverified', incomplete: 'unverified' }, String(stop));
    }
  });
  test(`${route}: an empty or wrong-shaped JSON answer is refused, not shown as "no findings"`, async () => {
    for (const text of ['{}', '[]', 'null', 'I could not do that.', '']) {
      const r = await call(route, { text, stop: 'end_turn' });
      assert.equal(r.first.status, 502, text); assert.equal(r.first.json.error, 'ai-malformed', text); assert.equal(r.first.json.result, undefined);
    }
  });
  test(`${route}: a citation to something that was never sent is refused`, async () => {
    const text = route === 'qualitative'
      ? JSON.stringify({ ...goodAnalysis, themes: [{ title: 'T', description: 'D', evidenceIds: ['ev-404'] }] })
      : JSON.stringify({ answer: 'x', citedPassageIds: ['p-404'], insufficient: false, missing: '' });
    const r = await call(route, { text, stop: 'end_turn' });
    assert.equal(r.first.json.error, 'ai-malformed');
  });
  test(`${route}: a complete answer is accepted, marked complete and carries no parse error`, async () => {
    const r = await call(route, good);
    assert.equal(r.first.status, 200); assert.equal(r.first.json.ok, true);
    assert.equal(r.first.json.result.complete, true); assert.equal(r.first.json.result.parseError, false);
    assert.equal(acceptFreshAiResult(r.first.json), true);
  });
}

test('a complete answer IS cached and served again without another provider call, still marked complete', async () => {
  for (const route of ['qualitative', 'ask']) {
    const text = route === 'qualitative' ? A : JSON.stringify({ answer: 'Payne voted yes.', citedPassageIds: ['p-1'], insufficient: false, missing: '' });
    const r = await call(route, { text, stop: 'end_turn' });
    assert.equal(r.providerCalls, 1, route);
    assert.equal(r.second.json.cached, true); assert.equal(r.second.json.result.complete, true); assert.equal(acceptFreshAiResult(r.second.json), true);
  }
});

test('the refusal is what the page sees: acceptFreshAiResult says no to every refusal body', () => {
  for (const reason of ['truncated', 'malformed', 'unverified', 'refused']) assert.equal(acceptFreshAiResult(incompleteBody(reason)), false);
});
