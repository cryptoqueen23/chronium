// Deep Discovery, website mode: two small stateless endpoints.
//
//   GET /api/fetch?url=...&ack=1&seed=1   one guarded GET on behalf of the website (the browser cannot fetch
//                                         other sites directly because of CORS). The extension does NOT use this.
//   GET /api/captures?url=...             archived copies of one address (Internet Archive availability API).
//
// Boundaries (docs/DEEP_DISCOVERY_PLAN.md section 8): the address is checked with the same URL guard the engine
// uses; hosts the registry marks link-only / forbidden / unverified are refused here too, so this endpoint cannot
// be used to route around the engine's policy; unlisted hosts need ack=1 (the person confirmed the site's terms);
// robots.txt is evaluated on the server as well (cached 24 h); redirects are never followed (the caller sees the
// 3xx and decides); no cookies or credentials are sent or returned; size, time, content-type and rate limits
// apply; nothing about the request (address, query) is stored or logged.
import { checkUrl } from '../public/discovery/urlGuard.js';
import { RobotsPolicy, robotsUrlFor } from '../public/discovery/robots.js';
import { defaultHostPolicies } from '../public/discovery/connector.js';
import { USER_AGENT, USER_AGENT_TOKEN, DEFAULT_LIMITS } from '../public/discovery/config.js';

const MAX_BYTES = DEFAULT_LIMITS.maxResponseBytes;
const TIMEOUT_MS = 10_000;
const timeoutOf = (env) => Number(env?.DISCOVERY_UPSTREAM_TIMEOUT_MS) || TIMEOUT_MS; // the override exists for tests
const PER_IP_PER_MINUTE = 40;
const PER_HOST_PER_MINUTE = 30;
const ROBOTS_TTL_S = 86_400;
const CAPTURES_TTL_S = 86_400;
const BLOCKED_TYPE_PREFIXES = ['image/', 'video/', 'audio/', 'font/', 'application/x-msdownload', 'application/x-executable', 'application/java-archive'];
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const cacheKey = (kind, key) => new Request(`https://cache.chronium.invalid/${kind}/${encodeURIComponent(key)}`);

function guardOptions(env) {
  const list = String(env?.DISCOVERY_ALLOW_PRIVATE || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? { allowPrivateHosts: list } : {};
}

// Best-effort counters in the Cache API (no KV writes): a shared edge cache is enough for a courtesy limit.
async function bump(kind, key, ttlSeconds) {
  const k = cacheKey(kind, key);
  const hit = await caches.default.match(k);
  const n = hit ? Number(await hit.text()) || 0 : 0;
  await caches.default.put(k, new Response(String(n + 1), { headers: { 'cache-control': `max-age=${ttlSeconds}` } }));
  return n + 1;
}

async function readCapped(res, maxBytes) {
  if (!res.body) return { body: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks = []; let total = 0; let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > maxBytes) { chunks.push(value.slice(0, maxBytes - total)); total = maxBytes; truncated = true; try { await reader.cancel(); } catch { /* ignore */ } break; }
    chunks.push(value); total += value.length;
  }
  const body = new Uint8Array(total); let o = 0; for (const c of chunks) { body.set(c, o); o += c.length; }
  return { body, truncated };
}

async function upstream(url, timeoutMs, accept) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': USER_AGENT, accept }, cf: { cacheTtl: 0 } }); }
  finally { clearTimeout(timer); }
}

async function robotsFor(url, env) {
  const origin = new URL(url).origin;
  const k = cacheKey('robots', origin);
  const hit = await caches.default.match(k);
  if (hit) return RobotsPolicy.fromResponse(await hit.json(), { token: USER_AGENT_TOKEN, origin });
  let snap;
  try {
    const res = await upstream(robotsUrlFor(url), timeoutOf(env), 'text/plain,*/*;q=0.5');
    const { body, truncated } = await readCapped(res, DEFAULT_LIMITS.maxRobotsBytes);
    snap = { status: res.status, body: new TextDecoder().decode(body), truncated, error: null };
  } catch { snap = { status: null, body: '', truncated: false, error: { code: 'network' } }; }
  // An unreachable robots.txt is not cached for long: it may only be a blip.
  await caches.default.put(k, new Response(JSON.stringify(snap), { headers: { 'cache-control': `max-age=${snap.error ? 300 : ROBOTS_TTL_S}`, 'content-type': 'application/json' } }));
  return RobotsPolicy.fromResponse(snap, { token: USER_AGENT_TOKEN, origin });
}

export async function handleFetch(request, env) {
  if (request.method !== 'GET') return reply({ error: 'method-not-allowed' }, 405);
  const q = new URL(request.url).searchParams;
  const target = q.get('url') || '';
  const g = checkUrl(target, guardOptions(env));
  if (!g.ok) return reply({ error: 'address-refused', reason: g.reason }, 400);
  const host = g.url.hostname.toLowerCase();
  const decision = defaultHostPolicies().decide(host, { acknowledged: q.get('ack') === '1' ? [host] : [] });
  if (!decision.allowed) return reply({ error: 'policy-refused', reason: decision.reason, automation: decision.automation }, 403);

  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const minute = Math.floor(Date.now() / 60_000);
  // The limits can be overridden by environment variables (tests only); a real run is paced far below them.
  const ipLimit = Number(env?.DISCOVERY_IP_PER_MINUTE) || PER_IP_PER_MINUTE; const hostLimit = Number(env?.DISCOVERY_HOST_PER_MINUTE) || PER_HOST_PER_MINUTE;
  if (await bump('rl-ip', `${ip}/${minute}`, 90) > ipLimit) return reply({ error: 'rate-limited', scope: 'visitor' }, 429);
  if (await bump('rl-host', `${host}/${minute}`, 90) > hostLimit) return reply({ error: 'rate-limited', scope: 'site' }, 429);

  if (g.url.pathname !== '/robots.txt') {
    const policy = await robotsFor(g.canonical, env);
    const v = policy.evaluate(g.canonical, { isSeed: q.get('seed') === '1' });
    if (!v.allowed) return reply({ error: 'robots-refused', reason: v.reason, rule: v.rule }, 403);
  }

  let res;
  try { res = await upstream(g.canonical, timeoutOf(env), 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.5'); }
  catch (e) { return reply({ error: e?.name === 'AbortError' ? 'timeout' : 'network' }, 504); }

  const h = new Headers({ 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', 'cache-control': 'no-store', 'x-chronium-status': String(res.status), 'x-chronium-final-url': g.canonical });
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (BLOCKED_TYPE_PREFIXES.some((p) => ct.startsWith(p))) return reply({ error: 'content-type-refused', contentType: ct }, 415);
  for (const name of ['content-type', 'etag', 'last-modified', 'retry-after', 'x-robots-tag']) { const v = res.headers.get(name); if (v) h.set(name === 'content-type' ? 'content-type' : `x-chronium-${name}`, v); }
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (loc) { try { h.set('x-chronium-location', new URL(loc, g.canonical).href); } catch { /* unusable location */ } }
    return new Response(null, { status: 200, headers: h });
  }
  const declared = Number(res.headers.get('content-length') || 0);
  const { body, truncated } = await readCapped(res, MAX_BYTES);
  // The robots.txt the caller just asked for is exactly what this server would fetch to check the next request,
  // so keep it: the site is not asked for its robots.txt twice.
  if (g.url.pathname === '/robots.txt' && res.status < 500) {
    const snap = { status: res.status, body: new TextDecoder().decode(body.subarray(0, DEFAULT_LIMITS.maxRobotsBytes)), truncated, error: null };
    await caches.default.put(cacheKey('robots', g.url.origin), new Response(JSON.stringify(snap), { headers: { 'cache-control': `max-age=${ROBOTS_TTL_S}`, 'content-type': 'application/json' } }));
  }
  if (truncated || declared > MAX_BYTES) h.set('x-chronium-truncated', '1');
  if (!h.has('content-type')) h.set('content-type', 'application/octet-stream');
  return new Response(body, { status: 200, headers: h });
}

// Wayback availability for one address. Other archives (Arquivo.pt, Memento) are not queried here: their
// responses could not be verified from the build machine, so they are not claimed.
export async function handleCaptures(request, env) {
  if (request.method !== 'GET') return reply({ error: 'method-not-allowed' }, 405);
  const target = new URL(request.url).searchParams.get('url') || '';
  const g = checkUrl(target, guardOptions(env));
  if (!g.ok) return reply({ error: 'address-refused', reason: g.reason }, 400);
  const k = cacheKey('captures', g.canonical);
  const hit = await caches.default.match(k);
  if (hit) return new Response(hit.body, { headers: JSON_HEADERS });
  let out;
  try {
    const res = await upstream(`https://archive.org/wayback/available?url=${encodeURIComponent(g.canonical)}`, 8000, 'application/json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const snap = data?.archived_snapshots?.closest;
    if (snap?.available && snap.url) {
      const t = String(snap.timestamp || '');
      const iso = /^\d{14}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}Z` : null;
      out = { status: 'found', copies: [{ provider: 'Wayback Machine', archiveUrl: String(snap.url).replace(/^http:/, 'https:'), captureDate: iso, httpStatus: snap.status ? Number(snap.status) : null }], checked: ['Wayback Machine'] };
    } else out = { status: 'none', copies: [], checked: ['Wayback Machine'] };
  } catch {
    // Not cached: an unreachable archive says nothing about whether a copy exists.
    return reply({ status: 'unavailable', copies: [], checked: ['Wayback Machine'] });
  }
  await caches.default.put(k, new Response(JSON.stringify(out), { headers: { ...JSON_HEADERS, 'cache-control': `max-age=${CAPTURES_TTL_S}` } }));
  return reply(out);
}
