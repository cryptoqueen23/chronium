// Deep Discovery, website mode: small stateless endpoints. Every one is behind a server-enforced switch that is OFF
// unless the Worker's configuration turns it on (src/guard.js), so hiding a button never "enables" anything.
//
//   GET /api/features                       which features this Worker will actually serve (booleans only)
//   GET /api/fetch?url=...&ack=1&seed=1     one guarded GET for the website (the browser cannot fetch other sites
//                                           directly because of CORS). The extension does NOT use this.
//   GET /api/captures?url=...               archived copies of one address (Internet Archive availability API)
//
// Boundaries (docs/DEEP_DISCOVERY_PLAN.md section 8, docs/STAGE0_SECURITY.md): same URL guard as the engine; hosts the
// registry marks link-only / forbidden / unverified are refused; unlisted hosts need ack=1 (a claim by the caller, so it
// is not relied on for safety); the hostname is resolved through DNS-over-HTTPS and refused if any answer is a private
// address; robots.txt is evaluated here too (cached 24 h); redirects are never followed; no cookies; size, time,
// concurrency, per-visitor, per-site and per-day limits are counted by the Worker and FAIL CLOSED if they cannot be
// counted; nothing about the request is stored or logged.
import { checkUrl, isBlockedIPv4, parseIPv6, isBlockedIPv6 } from '../public/discovery/urlGuard.js';
import { RobotsPolicy, robotsUrlFor } from '../public/discovery/robots.js';
import { defaultHostPolicies } from '../public/discovery/connector.js';
import { USER_AGENT, USER_AGENT_TOKEN, DEFAULT_LIMITS } from '../public/discovery/config.js';
import { featureGate, callerAllowed, enforceLimits, acquireSlot, limitsFor, reply, testVar, publicFeatures, ISOLATION_HEADERS } from './guard.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const ROBOTS_TTL_S = 86_400;
const CAPTURES_TTL_S = 86_400;
const DNS_TTL_S = 60;
const BLOCKED_TYPE_PREFIXES = ['image/', 'video/', 'audio/', 'font/', 'application/x-msdownload', 'application/x-executable', 'application/java-archive'];
const cacheKey = (kind, key) => new Request(`https://cache.chronium.invalid/${kind}/${encodeURIComponent(key)}`);
const timeoutOf = (env) => Number(testVar(env, 'DISCOVERY_UPSTREAM_TIMEOUT_MS')) || DEFAULT_TIMEOUT_MS;

function guardOptions(env) {
  const list = String(testVar(env, 'DISCOVERY_ALLOW_PRIVATE') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? { allowPrivateHosts: list } : {};
}
const store = () => { if (typeof caches === 'undefined' || !caches.default) throw new Error('no cache storage'); return caches.default; };

export function handleFeatures(request, env) {
  if (request.method !== 'GET') return reply({ error: 'method-not-allowed' }, 405);
  return reply({ features: publicFeatures(env) });
}

async function readCapped(res, maxBytes) {
  if (!res.body) return { blob: new Blob([]), truncated: false, bytes: 0 };
  const reader = res.body.getReader(); const chunks = []; let total = 0; let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > maxBytes) { chunks.push(value.slice(0, maxBytes - total)); total = maxBytes; truncated = true; try { await reader.cancel(); } catch { /* ignore */ } break; }
    chunks.push(value); total += value.length;
  }
  return { blob: new Blob(chunks), truncated, bytes: total };
}

async function upstream(fetchImpl, url, timeoutMs, accept, extraHeaders = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': USER_AGENT, accept, ...extraHeaders }, cf: { cacheTtl: 0 } }); }
  finally { clearTimeout(timer); }
}

// ---- DNS: refuse hostnames that resolve to private addresses (checked on every request, i.e. every redirect hop) ----
const isIpLiteral = (h) => /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith('[');
export async function dnsVerdict(host, env, fetchImpl) {
  if (isIpLiteral(host)) return { ok: true, reason: 'literal' };               // already judged by the URL guard
  if (testVar(env, 'TEST_SKIP_DNS_CHECK') === 'on') return { ok: true, reason: 'test-skip' };
  const k = cacheKey('dns', host);
  try { const hit = await store().match(k); if (hit) return await hit.json(); } catch { return { ok: false, reason: 'dns-unavailable' }; }
  let answers = 0;
  for (const type of ['A', 'AAAA']) {
    let data;
    try {
      const res = await upstream(fetchImpl, `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, 3000, 'application/dns-json', { 'user-agent': 'ChroniumMind-dns/1.0' });
      if (!res.ok) return { ok: false, reason: 'dns-unavailable' };
      data = await res.json();
    } catch { return { ok: false, reason: 'dns-unavailable' }; }
    for (const a of data?.Answer || []) {
      if (a.type !== 1 && a.type !== 28) continue; // address records only (CNAME chains are followed by the resolver)
      answers += 1;
      const addr = String(a.data || '');
      const blocked = a.type === 1 ? isBlockedIPv4(addr) : (() => { const g = parseIPv6(addr); return !g || isBlockedIPv6(g); })();
      if (blocked) return { ok: false, reason: 'private-address' };
    }
  }
  const verdict = answers ? { ok: true, reason: 'public' } : { ok: false, reason: 'no-address' };
  try { await store().put(k, new Response(JSON.stringify(verdict), { headers: { 'cache-control': `max-age=${DNS_TTL_S}`, 'content-type': 'application/json' } })); } catch { /* not caching is safe */ }
  return verdict;
}

async function robotsFor(url, env, fetchImpl) {
  const origin = new URL(url).origin;
  const k = cacheKey('robots', origin);
  const hit = await store().match(k);
  if (hit) return RobotsPolicy.fromResponse(await hit.json(), { token: USER_AGENT_TOKEN, origin });
  let snap;
  try {
    const res = await upstream(fetchImpl, robotsUrlFor(url), timeoutOf(env), 'text/plain,*/*;q=0.5');
    const { blob, truncated } = await readCapped(res, DEFAULT_LIMITS.maxRobotsBytes);
    snap = { status: res.status, body: await blob.text(), truncated, error: null };
  } catch { snap = { status: null, body: '', truncated: false, error: { code: 'network' } }; }
  await store().put(k, new Response(JSON.stringify(snap), { headers: { 'cache-control': `max-age=${snap.error ? 300 : ROBOTS_TTL_S}`, 'content-type': 'application/json' } }));
  return RobotsPolicy.fromResponse(snap, { token: USER_AGENT_TOKEN, origin });
}

export async function handleFetch(request, env, { fetchImpl = (...a) => fetch(...a) } = {}) {
  const gate = featureGate(env, 'discoveryFetch'); if (gate) return gate;
  if (request.method !== 'GET') return reply({ error: 'method-not-allowed' }, 405);
  if (!callerAllowed(request, env)) return reply({ error: 'caller-not-allowed' }, 403);
  const q = new URL(request.url).searchParams;
  const g = checkUrl(q.get('url') || '', guardOptions(env));
  if (!g.ok) return reply({ error: 'address-refused', reason: g.reason }, 400);
  const host = g.url.hostname.toLowerCase();
  const decision = defaultHostPolicies().decide(host, { acknowledged: q.get('ack') === '1' ? [host] : [] });
  if (!decision.allowed) return reply({ error: 'policy-refused', reason: decision.reason, automation: decision.automation }, 403);

  const limited = await enforceLimits(request, env, 'fetch', { site: host });
  if (limited) return limited;
  const lim = limitsFor(env, 'fetch');
  const release = acquireSlot('fetch', lim.maxConcurrent);
  if (!release) return reply({ error: 'busy' }, 429, { 'retry-after': '5' });
  try {
    const allowedPrivate = guardOptions(env).allowPrivateHosts || [];
    if (!allowedPrivate.includes(`${host}:${g.url.port || (g.url.protocol === 'https:' ? '443' : '80')}`)) {
      const dns = await dnsVerdict(host, env, fetchImpl);
      if (!dns.ok) return reply({ error: dns.reason === 'dns-unavailable' ? 'dns-unavailable' : 'address-refused', reason: dns.reason }, dns.reason === 'dns-unavailable' ? 503 : 400);
    }
    if (g.url.pathname !== '/robots.txt') {
      let policy;
      try { policy = await robotsFor(g.canonical, env, fetchImpl); } catch { return reply({ error: 'protection-unavailable' }, 503); }
      const v = policy.evaluate(g.canonical, { isSeed: q.get('seed') === '1' });
      if (!v.allowed) return reply({ error: 'robots-refused', reason: v.reason, rule: v.rule }, 403);
    }
    let res;
    try { res = await upstream(fetchImpl, g.canonical, timeoutOf(env), 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.5'); }
    catch (e) { return reply({ error: e?.name === 'AbortError' ? 'timeout' : 'network' }, 504); }

    const h = new Headers({ ...ISOLATION_HEADERS, 'content-security-policy': 'sandbox', 'cache-control': 'no-store', 'x-chronium-status': String(res.status), 'x-chronium-final-url': g.canonical });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (BLOCKED_TYPE_PREFIXES.some((p) => ct.startsWith(p))) { res.body?.cancel?.(); return reply({ error: 'content-type-refused', contentType: ct }, 415); }
    for (const name of ['content-type', 'etag', 'last-modified', 'retry-after', 'x-robots-tag']) { const v = res.headers.get(name); if (v) h.set(name === 'content-type' ? 'content-type' : `x-chronium-${name}`, v); }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location'); res.body?.cancel?.();
      if (loc) { try { h.set('x-chronium-location', new URL(loc, g.canonical).href); } catch { /* unusable location */ } }
      return new Response(null, { status: 200, headers: h });
    }
    const declared = Number(res.headers.get('content-length') || 0);
    const { blob, truncated } = await readCapped(res, lim.maxBytes);
    if (truncated || declared > lim.maxBytes) h.set('x-chronium-truncated', '1');
    if (!h.has('content-type')) h.set('content-type', 'application/octet-stream');
    // Keep the robots.txt just served, so the site is not asked for it twice.
    if (g.url.pathname === '/robots.txt' && res.status < 500) {
      try {
        const snap = { status: res.status, body: await blob.slice(0, DEFAULT_LIMITS.maxRobotsBytes).text(), truncated, error: null };
        await store().put(cacheKey('robots', g.url.origin), new Response(JSON.stringify(snap), { headers: { 'cache-control': `max-age=${ROBOTS_TTL_S}`, 'content-type': 'application/json' } }));
      } catch { /* not caching is safe */ }
    }
    return new Response(blob, { status: 200, headers: h });
  } finally { release(); }
}

// Wayback availability for one address. Other archives are not queried here: their responses could not be verified.
export async function handleCaptures(request, env, { fetchImpl = (...a) => fetch(...a) } = {}) {
  const gate = featureGate(env, 'discoveryCaptures'); if (gate) return gate;
  if (request.method !== 'GET') return reply({ error: 'method-not-allowed' }, 405);
  if (!callerAllowed(request, env, { allowExtension: true })) return reply({ error: 'caller-not-allowed' }, 403);
  const target = new URL(request.url).searchParams.get('url') || '';
  const g = checkUrl(target, guardOptions(env));
  if (!g.ok) return reply({ error: 'address-refused', reason: g.reason }, 400);
  const limited = await enforceLimits(request, env, 'captures');
  if (limited) return limited;
  const lim = limitsFor(env, 'captures');
  const release = acquireSlot('captures', lim.maxConcurrent);
  if (!release) return reply({ error: 'busy' }, 429, { 'retry-after': '5' });
  try {
    const k = cacheKey('captures', g.canonical);
    let hit; try { hit = await store().match(k); } catch { return reply({ error: 'protection-unavailable' }, 503); }
    if (hit) return reply(await hit.json());
    let out;
    try {
      const res = await upstream(fetchImpl, `https://archive.org/wayback/available?url=${encodeURIComponent(g.canonical)}`, 8000, 'application/json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { blob } = await readCapped(res, lim.maxBytes);
      const data = JSON.parse(await blob.text());
      const snap = data?.archived_snapshots?.closest;
      if (snap?.available && snap.url) {
        const t = String(snap.timestamp || '');
        const iso = /^\d{14}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}Z` : null;
        out = { status: 'found', copies: [{ provider: 'Wayback Machine', archiveUrl: String(snap.url).replace(/^http:/, 'https:'), captureDate: iso, httpStatus: snap.status ? Number(snap.status) : null }], checked: ['Wayback Machine'] };
      } else out = { status: 'none', copies: [], checked: ['Wayback Machine'] };
    } catch {
      return reply({ status: 'unavailable', copies: [], checked: ['Wayback Machine'] }); // an unreachable archive is never cached
    }
    try { await store().put(k, new Response(JSON.stringify(out), { headers: { 'cache-control': `max-age=${CAPTURES_TTL_S}`, 'content-type': 'application/json' } })); } catch { /* not caching is safe */ }
    return reply(out);
  } finally { release(); }
}
