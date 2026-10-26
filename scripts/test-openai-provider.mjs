// The OpenAI adapter (src/ai/openai.js), its schemas, and its place in the Worker. AI is OFF by default; here it is switched on only
// inside a test with OpenAI replaced by a stub, so nothing is sent anywhere, no key exists and no money can be spent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildOpenAIRequest, readOpenAIResponse, openaiSettings, openaiProvider, OPENAI_DEFAULT_MODEL } from '../src/ai/openai.js';
import { ANALYSIS_SCHEMA, ASK_SOURCES_SCHEMA } from '../src/ai/schemas.js';
import { validateAnalysis, validateAskSources } from '../src/aiResult.js';
import { getAIProvider } from '../src/ai/index.js';
import { visitorHash } from '../src/guard.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
register('./json-import-hooks.mjs', import.meta.url);
const { default: worker } = await import('../src/index.js');

const FAKE_KEY = 'sk-test-THIS-IS-NOT-A-REAL-KEY-0123456789';

// ---------- request shape ----------
test('the request: Responses API fields, store false, the Worker cap, reasoning effort none, strict schema, hashed safety id', () => {
  const b = buildOpenAIRequest({ system: 'SYS', prompt: 'PROMPT', maxTokens: 600, schema: ANALYSIS_SCHEMA, safetyId: 'a'.repeat(64), env: {} });
  assert.equal(b.model, 'gpt-6-luna'); assert.equal(OPENAI_DEFAULT_MODEL, 'gpt-6-luna');
  assert.equal(b.instructions, 'SYS'); assert.equal(b.input, 'PROMPT');
  assert.equal(b.max_output_tokens, 600); assert.equal(b.store, false);
  assert.deepEqual(b.reasoning, { effort: 'none' });
  assert.deepEqual(b.text, { format: { type: 'json_schema', name: 'chronium_analysis', strict: true, schema: ANALYSIS_SCHEMA.schema } });
  assert.equal(b.safety_identifier.length, 64);
  assert.equal('stream' in b, false); assert.equal('tools' in b, false); assert.equal('previous_response_id' in b, false);
});
test('settings: model, effort and structured mode come from plain variables and bad values cannot sneak in', () => {
  assert.equal(openaiSettings({ OPENAI_MODEL: 'gpt-6.1-terra' }).model, 'gpt-6.1-terra');
  for (const bad of ['', 'GPT 6', 'x', 'a/b', '../../etc', 'gpt-6 luna', 'a'.repeat(80), 'model\nname']) {
    if (bad === '') assert.equal(openaiSettings({ OPENAI_MODEL: bad }).model, 'gpt-6-luna', 'empty means the default');
    else assert.throws(() => openaiSettings({ OPENAI_MODEL: bad }), /not a model name/, JSON.stringify(bad));
  }
  assert.equal(openaiSettings({ OPENAI_REASONING_EFFORT: 'low' }).effort, 'low');
  for (const bad of ['LOW', 'extreme', '', 'none; drop', undefined]) assert.equal(openaiSettings({ OPENAI_REASONING_EFFORT: bad }).effort, 'none', String(bad));
  assert.equal(openaiSettings({ OPENAI_STRUCTURED: 'off' }).structured, false); assert.equal(openaiSettings({}).structured, true);
  const plain = buildOpenAIRequest({ system: 's', prompt: 'p', maxTokens: 10, schema: ASK_SOURCES_SCHEMA, env: { OPENAI_STRUCTURED: 'off' } });
  assert.equal('text' in plain, false);
});

// ---------- the schemas match what the validator accepts ----------
function assertStrict(node, where = 'root') {
  if (node && typeof node === 'object' && node.type === 'object') {
    assert.equal(node.additionalProperties, false, `${where}: additionalProperties must be false`);
    assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${where}: every property must be required (strict mode)`);
    for (const [k, v] of Object.entries(node.properties)) assertStrict(v, `${where}.${k}`);
  }
  if (node?.type === 'array') assertStrict(node.items, `${where}[]`);
}
test('the two schemas are valid for strict mode and agree with the validators', () => {
  assertStrict(ANALYSIS_SCHEMA.schema); assertStrict(ASK_SOURCES_SCHEMA.schema);
  assert.match(ANALYSIS_SCHEMA.name, /^[a-zA-Z0-9_-]{1,64}$/); assert.match(ASK_SOURCES_SCHEMA.name, /^[a-zA-Z0-9_-]{1,64}$/);
  const a = { themes: [{ title: 'T', description: 'D', evidenceIds: ['ev-1'] }], patterns: [], contradictions: [], synthesis: 'S' };
  assert.equal(validateAnalysis(a, new Set(['ev-1'])), true);
  assert.deepEqual(Object.keys(a).sort(), [...ANALYSIS_SCHEMA.schema.required].sort());
  assert.deepEqual(Object.keys(a.themes[0]).sort(), [...ANALYSIS_SCHEMA.schema.properties.themes.items.required].sort());
  const k = { answer: 'A', citedPassageIds: ['p-1'], insufficient: false, missing: '' };
  assert.equal(validateAskSources(k, new Set(['p-1'])), true);
  assert.deepEqual(Object.keys(k).sort(), [...ASK_SOURCES_SCHEMA.schema.required].sort());
});

// ---------- reading every kind of answer ----------
const msg = (...content) => ({ type: 'message', role: 'assistant', content });
const text = (t) => ({ type: 'output_text', text: t });
test('response states map onto the shared stop reasons, and only a completed answer counts as finished', () => {
  const done = readOpenAIResponse({ status: 'completed', model: 'gpt-6-luna-2026', output: [msg(text('{"a":1}'))], usage: { input_tokens: 120, output_tokens: 33 } });
  assert.deepEqual(done, { text: '{"a":1}', inputTokens: 120, outputTokens: 33, model: 'gpt-6-luna-2026', stopReason: 'end_turn' });
  assert.equal(readOpenAIResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [msg(text('{"a":'))] }).stopReason, 'max_tokens');
  assert.equal(readOpenAIResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning', summary: [] }] }).stopReason, 'max_tokens', 'reasoning ate the whole cap and nothing was written');
  assert.equal(readOpenAIResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning' }] }).text, '');
  assert.equal(readOpenAIResponse({ status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] }).stopReason, 'refusal');
  assert.equal(readOpenAIResponse({ status: 'completed', output: [msg({ type: 'refusal', refusal: 'I cannot help with that.' })] }).stopReason, 'refusal', 'a refusal never counts as finished, even with status completed');
  for (const odd of [{ status: 'failed', error: { code: 'server_error' } }, { status: 'in_progress' }, { status: 'queued' }, { status: 'cancelled' }, {}, null, undefined, 'text', 42, { status: 'incomplete' }, { status: 'incomplete', incomplete_details: { reason: 'something_new' } }]) {
    assert.equal(readOpenAIResponse(odd).stopReason, null, JSON.stringify(odd));
  }
  assert.equal(readOpenAIResponse({ status: 'completed', output: [{ type: 'reasoning' }, msg(text('{"a":'), text('1}'))] }).text, '{"a":1}', 'parts are joined, other items are ignored');
  assert.equal(readOpenAIResponse({ status: 'completed', output: [msg(text('x'))], usage: { input_tokens: 'many' } }).inputTokens, 0);
});

// ---------- the call itself, with fetch replaced ----------
async function withFetch(handler, fn) {
  const real = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return handler(url, init); };
  try { return await fn(calls); } finally { globalThis.fetch = real; }
}
const jsonRes = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
test('complete(): one POST to the Responses API, the key only in the Authorization header, the answer read back', async () => {
  await withFetch(() => jsonRes({ status: 'completed', model: 'gpt-6-luna', output: [msg(text('{"ok":true}'))], usage: { input_tokens: 5, output_tokens: 7 } }), async (calls) => {
    const r = await openaiProvider.complete({ system: 's', prompt: 'p', maxTokens: 600, schema: ASK_SOURCES_SCHEMA, safetyId: 'h'.repeat(64), env: { OPENAI_API_KEY: FAKE_KEY } });
    assert.equal(r.stopReason, 'end_turn'); assert.equal(r.text, '{"ok":true}');
    assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://api.openai.com/v1/responses'); assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.authorization, `Bearer ${FAKE_KEY}`);
    assert.equal(calls[0].init.body.includes(FAKE_KEY), false, 'the key is never in the request body');
    assert.equal(JSON.stringify(Object.entries(calls[0].init.headers).filter(([k]) => k !== 'authorization')).includes(FAKE_KEY), false);
  });
});
test('complete(): no key means a plain refusal that names the secret but never a value; no request is made', async () => {
  await withFetch(() => { throw new Error('must not be called'); }, async (calls) => {
    await assert.rejects(openaiProvider.complete({ system: 's', prompt: 'p', maxTokens: 10, env: {} }), /no OPENAI_API_KEY secret set/);
    assert.equal(calls.length, 0);
  });
});
test('errors never carry OpenAI\'s response text, which can echo part of a key', async () => {
  const echoing = `Incorrect API key provided: ${FAKE_KEY.slice(0, 12)}****. You can find your API key at https://platform.openai.com/account/api-keys.`;
  for (const [status, body, expected] of [[401, { error: { message: echoing, type: 'invalid_request_error', code: 'invalid_api_key' } }, /OpenAI HTTP 401 invalid_api_key/], [429, { error: { message: echoing, code: 'insufficient_quota' } }, /OpenAI HTTP 429 insufficient_quota/], [400, { error: { message: echoing, code: 'unsupported_value; DROP' } }, /OpenAI HTTP 400 unsupported_valueDROP/], [500, 'plain text ' + echoing, /^OpenAI HTTP 500$/]]) {
    await withFetch(() => (typeof body === 'string' ? new Response(body, { status }) : jsonRes(body, status)), async () => {
      let err = null; try { await openaiProvider.complete({ system: 's', prompt: 'p', maxTokens: 10, env: { OPENAI_API_KEY: FAKE_KEY } }); } catch (e) { err = e; }
      assert.ok(err && expected.test(err.message), `${status}: ${err && err.message}`);
      assert.equal(err.message.includes('Incorrect API key') || err.message.includes(FAKE_KEY.slice(0, 12)) || err.message.includes('platform.openai.com'), false, 'no echoed text');
    });
  }
  await withFetch(() => new Response('<html>nope</html>', { status: 200 }), async () => { await assert.rejects(openaiProvider.complete({ system: 's', prompt: 'p', maxTokens: 10, env: { OPENAI_API_KEY: FAKE_KEY } }), /not JSON/); });
  await withFetch(() => jsonRes({ error: { code: 'server_error', message: echoing } }), async () => {
    let err = null; try { await openaiProvider.complete({ system: 's', prompt: 'p', maxTokens: 10, env: { OPENAI_API_KEY: FAKE_KEY } }); } catch (e) { err = e; }
    assert.ok(err && /reported an error server_error/.test(err.message) && !err.message.includes('Incorrect'), err && err.message);
  });
});

// ---------- registry ----------
test('OpenAI is the default provider; Anthropic is still selectable but is never the default', () => {
  assert.equal(getAIProvider({}).id, 'openai'); assert.equal(getAIProvider({ AI_PROVIDER: 'openai' }).id, 'openai');
  assert.equal(getAIProvider({ AI_PROVIDER: 'anthropic' }).id, 'anthropic');
  assert.throws(() => getAIProvider({ AI_PROVIDER: 'nonsense' }), /Unknown AI_PROVIDER/);
});

// ---------- end to end through the real Worker entry point ----------
const items = ['ev-1', 'ev-2', 'ev-3'].map((id) => ({ id, excerptType: 'quote', location: 'p.1', excerptText: `Text of ${id}.` }));
const GOOD = JSON.stringify({ themes: [{ title: 'T', description: 'D', evidenceIds: ['ev-1'] }], patterns: [], contradictions: [], synthesis: 'S' });
async function call(openaiAnswer, envExtra = {}, ip = '203.0.113.9') {
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => { const v = store.get(r.url); return v ? v.clone() : undefined; }, put: async (r, res) => { store.set(r.url, res.clone()); } } };
  const real = globalThis.fetch; const sent = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://api.openai.com/v1/responses') { sent.push({ headers: init.headers, body: JSON.parse(init.body) }); return jsonRes(openaiAnswer); }
    throw new Error(`unexpected network call: ${url}`);
  };
  try {
    const env = { ENVIRONMENT: 'staging', AI_ENABLED: 'on', AI_PER_VISITOR_PER_DAY: '9', AI_DAILY_CEILING: '90', OPENAI_API_KEY: FAKE_KEY, ...envExtra };
    const body = JSON.stringify({ researchQuestion: 'q', evidenceItems: items, claims: [] });
    const req = new Request('http://w/api/analyze/qualitative', { method: 'POST', body, headers: { 'content-type': 'application/json', 'content-length': String(body.length), 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': ip } });
    const res = await worker.fetch(req, env, { waitUntil: () => {} });
    return { status: res.status, json: await res.json(), sent };
  } finally { globalThis.fetch = real; delete globalThis.caches; }
}
test('through the Worker: the request OpenAI receives is capped, unstored, reasoning-free and carries only a hash of the visitor', async () => {
  const r = await call({ status: 'completed', model: 'gpt-6-luna', output: [msg(text(GOOD))], usage: { input_tokens: 400, output_tokens: 90 } });
  assert.equal(r.status, 200); assert.equal(r.json.result.complete, true);
  const { body, headers } = r.sent[0];
  assert.equal(body.max_output_tokens, 600); assert.equal(body.store, false); assert.deepEqual(body.reasoning, { effort: 'none' });
  assert.equal(body.text.format.strict, true); assert.equal(body.text.format.name, 'chronium_analysis');
  assert.match(body.safety_identifier, /^[0-9a-f]{64}$/); assert.notEqual(body.safety_identifier, '203.0.113.9');
  assert.equal(body.safety_identifier, await visitorHash(new Request('http://w/', { headers: { 'cf-connecting-ip': '203.0.113.9' } }), {}));
  assert.ok(String(body.input).length < 8000 + 600, 'the evidence cap still applies');
  assert.equal(headers.authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(JSON.stringify(r.json).includes(FAKE_KEY), false, 'the key is never in any response');
});
test('through the Worker: truncated, reasoning-exhausted, refused and unfinished OpenAI answers are refused, never shown as an analysis', async () => {
  const cases = [
    ['cut off mid-answer', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [msg(text(GOOD.slice(0, 40)))] }, 'ai-truncated'],
    ['cut off even though the text looks whole', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [msg(text(GOOD))] }, 'ai-truncated'],
    ['reasoning used the whole cap, nothing written', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning' }] }, 'ai-truncated'],
    ['a refusal', { status: 'completed', output: [msg({ type: 'refusal', refusal: 'no' })] }, 'ai-refused'],
    ['filtered', { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] }, 'ai-refused'],
    ['still running', { status: 'in_progress', output: [msg(text(GOOD))] }, 'ai-unverified'],
    ['completed but empty', { status: 'completed', output: [] }, 'ai-malformed'],
    ['completed but wrong JSON', { status: 'completed', output: [msg(text('{}'))] }, 'ai-malformed'],
    ['completed but cites an id that was not sent', { status: 'completed', output: [msg(text(JSON.stringify({ themes: [{ title: 'T', description: 'D', evidenceIds: ['ev-404'] }], patterns: [], contradictions: [], synthesis: 'S' })))] }, 'ai-malformed']
  ];
  for (const [name, answer, code] of cases) {
    const r = await call(answer);
    assert.equal(r.status, 502, name); assert.equal(r.json.error, code, name); assert.equal(r.json.result, undefined, name);
  }
});
test('through the Worker: with AI off, or without ceilings, or without a key, OpenAI is never contacted', async () => {
  const off = await call({ status: 'completed', output: [msg(text(GOOD))] }, { AI_ENABLED: 'off' }); assert.equal(off.status, 404); assert.equal(off.sent.length, 0);
  const noCeil = await call({ status: 'completed', output: [msg(text(GOOD))] }, { AI_PER_VISITOR_PER_DAY: undefined }); assert.equal(noCeil.status, 404); assert.equal(noCeil.sent.length, 0);
  const noKey = await call({ status: 'completed', output: [msg(text(GOOD))] }, { OPENAI_API_KEY: undefined }); assert.equal(noKey.status, 502); assert.equal(noKey.sent.length, 0);
});

// ---------- the key can never end up in the extension, the website, or the repository ----------
// Other test files create and delete scratch files while suites run in parallel: a file that vanishes between listing and reading is skipped.
const readIfThere = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
function walk(dir, out = []) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (['node_modules', '.git', '.wrangler', '.release'].includes(e.name)) continue; const f = path.join(dir, e.name); if (e.isDirectory()) walk(f, out); else out.push(f); } return out; }
test('no OpenAI credential or API address exists in the extension or the website files', () => {
  for (const f of [...walk(path.join(root, 'extension')), ...walk(path.join(root, 'public'))].filter((x) => /\.(js|html|json|css|txt|md|webmanifest)$/.test(x))) {
    const t = readIfThere(f); if (t === null) continue;
    assert.equal(/OPENAI_API_KEY|api\.openai\.com|sk-proj-|sk-[A-Za-z0-9]{20,}/.test(t), false, path.relative(root, f));
  }
});
test('no real-looking secret is committed anywhere (the only key-shaped strings are the obvious fakes in tests)', () => {
  for (const f of walk(root).filter((x) => /\.(js|mjs|json|jsonc|md|html|txt|toml|yml|yaml)$/.test(x))) {
    const t = readIfThere(f); if (t === null) continue;
    for (const m of t.matchAll(/(?<![A-Za-z0-9-])sk-(?:proj-|svcacct-|admin-|ant-)?[A-Za-z0-9_]{12,}(?:-[A-Za-z0-9_]{6,})*/g)) assert.match(m[0], /TEST|FAKE|NOT-A-REAL|MUST-NEVER|THIS-/i, `${path.relative(root, f)}: ${m[0].slice(0, 16)}...`);
  }
});
test('the wrangler configuration names no key and keeps the provider a plain variable', () => {
  const t = fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');
  assert.match(t, /"AI_PROVIDER": "openai"/); assert.equal(/"OPENAI_API_KEY"\s*:/.test(t), false); assert.equal(/"ANTHROPIC_API_KEY"\s*:/.test(t), false);
});
