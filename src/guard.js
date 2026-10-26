// Server-side protections shared by every new network-facing route. Nothing here trusts the browser: a route that
// is switched off answers as if it did not exist, whatever the page shows; limits are counted by the Worker; and
// every protection FAILS CLOSED, meaning that if its configuration or its storage is missing the request is refused,
// never allowed through.
//
// Configuration model (see docs/STAGE0_SECURITY.md):
//   - Each feature has its own switch variable and is OFF unless the variable is exactly "on".
//   - ENVIRONMENT must be set; an unset value is treated as production.
//   - Test-only variables are honoured only when TEST_MODE is "on" and ENVIRONMENT is not "production". If any
//     test-only variable is present in a production environment, every guarded feature refuses to run.

export const FEATURE_VARS = Object.freeze({
  discoveryFetch: 'FEATURE_DISCOVERY_FETCH',
  discoveryCaptures: 'FEATURE_DISCOVERY_CAPTURES',
  viewCapture: 'FEATURE_VIEW_CAPTURE',
  askSources: 'FEATURE_ASK_SOURCES',
  ai: 'AI_ENABLED'
});

// Variables that exist only to make tests deterministic. They must never be present in production.
export const TEST_ONLY_VARS = Object.freeze([
  'TEST_MODE', 'DISCOVERY_ALLOW_PRIVATE', 'DISCOVERY_IP_PER_MINUTE', 'DISCOVERY_HOST_PER_MINUTE', 'DISCOVERY_UPSTREAM_TIMEOUT_MS',
  'TEST_ARCHIVE_HOSTS', 'TEST_SKIP_DNS_CHECK', 'TEST_LIMIT_OVERRIDES'
]);

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
export const reply = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });

export const isProduction = (env) => !env || !env.ENVIRONMENT || env.ENVIRONMENT === 'production';
export const isTestMode = (env) => !!env && env.TEST_MODE === 'on' && !!env.ENVIRONMENT && env.ENVIRONMENT !== 'production';
// A test-only variable's value, or undefined outside test mode.
export const testVar = (env, name) => (isTestMode(env) ? env[name] : undefined);

// Problems that make the configuration unsafe. Empty list = safe.
export function configProblems(env) {
  const problems = [];
  if (!env || typeof env !== 'object') return ['no configuration was provided'];
  if (!env.ENVIRONMENT) problems.push('ENVIRONMENT is not set (treated as production)');
  if (isProduction(env)) for (const v of TEST_ONLY_VARS) if (env[v] !== undefined && env[v] !== '') problems.push(`test-only variable ${v} is set in a production environment`);
  if (env.TEST_MODE === 'on' && !isTestMode(env)) problems.push('TEST_MODE is on without a non-production ENVIRONMENT');
  return problems;
}

export const featureSwitch = (env, feature) => !!env && env[FEATURE_VARS[feature]] === 'on';

const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
// AI is available only when its switch is on AND both cost ceilings are configured as positive whole numbers.
export function aiCeilings(env) {
  const perVisitor = posInt(env?.AI_PER_VISITOR_PER_DAY); const global = posInt(env?.AI_DAILY_CEILING);
  return perVisitor && global ? { perVisitor, global } : null;
}
export function featureEffective(env, feature) {
  if (!featureSwitch(env, feature) || configProblems(env).length) return false;
  if (feature === 'ai') return !!aiCeilings(env);
  if (feature === 'askSources') return featureSwitch(env, 'ai') && !!aiCeilings(env);
  return true;
}
export function publicFeatures(env) {
  return Object.fromEntries(Object.keys(FEATURE_VARS).map((f) => [f, featureEffective(env, f)]));
}

// Answers for a switched-off or unsafe feature. A switched-off feature looks absent (404) so that it cannot be probed.
export function featureGate(env, feature) {
  const problems = configProblems(env);
  if (!featureSwitch(env, feature)) return reply({ error: 'not-available' }, 404);
  if (problems.length) return reply({ error: 'unsafe-configuration' }, 503);
  if (feature === 'ai' && !aiCeilings(env)) return reply({ error: 'not-available' }, 404);
  if (feature === 'askSources' && (!featureSwitch(env, 'ai') || !aiCeilings(env))) return reply({ error: 'not-available' }, 404);
  return null;
}

// ---- who may call: browsers on this site (and, where allowed, a named extension); never an unnamed other site ----
export function extensionOrigins(env) {
  return String(env?.ALLOWED_EXTENSION_ORIGINS || '').split(',').map((s) => s.trim()).filter((s) => /^chrome-extension:\/\/[a-p]{32}$/.test(s));
}
// Browsers send Sec-Fetch-Site on every request. Missing means "not a browser we can vouch for": refused.
export function callerAllowed(request, env, { allowExtension = false } = {}) {
  const site = request.headers.get('sec-fetch-site');
  if (site === 'same-origin') return true;
  if (allowExtension) {
    const origin = request.headers.get('origin') || '';
    if (origin && extensionOrigins(env).includes(origin)) return true;
  }
  return false;
}

// ---- limits, enforced here; the browser's own limits are a courtesy ----
const cacheKey = (kind, key) => new Request(`https://cache.chronium.invalid/${kind}/${encodeURIComponent(key)}`);
async function bump(kind, key, ttlSeconds) {
  const store = typeof caches !== 'undefined' ? caches.default : null;
  if (!store) throw new Error('no limit storage');
  const k = cacheKey(kind, key);
  const hit = await store.match(k);
  const n = hit ? Number(await hit.text()) || 0 : 0;
  await store.put(k, new Response(String(n + 1), { headers: { 'cache-control': `max-age=${ttlSeconds}` } }));
  return n + 1;
}

const HARD_DEFAULTS = Object.freeze({
  fetch: { perIpPerMin: 30, perSitePerMin: 30, globalPerDay: 3000, maxConcurrent: 4, maxBytes: 10 * 1024 * 1024 },
  captures: { perIpPerMin: 30, perSitePerMin: 60, globalPerDay: 3000, maxConcurrent: 4, maxBytes: 64 * 1024 },
  viewCapture: { perIpPerMin: 20, perSitePerMin: 60, globalPerDay: 3000, maxConcurrent: 4, maxBytes: 15 * 1024 * 1024 },
  ai: { perIpPerMin: 6, perSitePerMin: 0, globalPerDay: 0, maxConcurrent: 3, maxBytes: 64 * 1024 }
});
// Limits for a route. Production can only ever use the defaults or LOWER them (env value must be a smaller whole number).
// Test mode may set exact values with TEST_LIMIT_OVERRIDES (JSON), including higher ones.
export function limitsFor(env, route) {
  const base = { ...HARD_DEFAULTS[route] };
  const upper = String(route).toUpperCase();
  for (const [key, envName] of [['perIpPerMin', `LIMIT_${upper}_PER_IP_PER_MIN`], ['perSitePerMin', `LIMIT_${upper}_PER_SITE_PER_MIN`], ['globalPerDay', `LIMIT_${upper}_GLOBAL_PER_DAY`], ['maxConcurrent', `LIMIT_${upper}_MAX_CONCURRENT`], ['maxBytes', `LIMIT_${upper}_MAX_BYTES`]]) {
    const v = posInt(env?.[envName]);
    if (v !== null && (v < base[key] || isTestMode(env))) base[key] = v; // production can only lower; test mode may set exact values
  }
  const t = testVar(env, 'TEST_LIMIT_OVERRIDES');
  if (t) {
    try {
      // JSON ({"fetch":{"perIpPerMin":9}}) or the short form fetch.perIpPerMin=9;fetch.maxConcurrent=2
      if (String(t).trim().startsWith('{')) Object.assign(base, JSON.parse(t)[route] || {});
      else for (const part of String(t).split(';')) { const m = /^\s*(\w+)\.(\w+)\s*=\s*(\d+)\s*$/.exec(part); if (m && m[1] === route) base[m[2]] = Number(m[3]); }
    } catch { /* ignore a malformed test override */ }
  }
  return base;
}

const inflight = new Map(); // route -> count, per isolate
export function acquireSlot(route, max) {
  const n = inflight.get(route) || 0;
  if (n >= max) return null;
  inflight.set(route, n + 1);
  let released = false;
  return () => { if (!released) { released = true; inflight.set(route, Math.max(0, (inflight.get(route) || 1) - 1)); } };
}
export const _inflightForTests = inflight;

export function visitorKey(request, env) {
  return request.headers.get('cf-connecting-ip') || (isTestMode(env) ? 'test-visitor' : 'unknown');
}

/**
 * Enforces per-visitor and per-site (per minute) and global (per day) request counts. Returns a refusal Response, or null.
 * If the counting storage is missing or fails, the request is refused (503): no limit means no service.
 */
export async function enforceLimits(request, env, route, { site = null } = {}) {
  const lim = limitsFor(env, route);
  const minute = Math.floor(Date.now() / 60_000); const day = new Date().toISOString().slice(0, 10);
  try {
    if (lim.perIpPerMin && await bump(`rl-ip-${route}`, `${visitorKey(request, env)}/${minute}`, 90) > lim.perIpPerMin) return reply({ error: 'rate-limited', scope: 'visitor' }, 429, { 'retry-after': '60' });
    if (site && lim.perSitePerMin && await bump(`rl-site-${route}`, `${site}/${minute}`, 90) > lim.perSitePerMin) return reply({ error: 'rate-limited', scope: 'site' }, 429, { 'retry-after': '60' });
    if (lim.globalPerDay && await bump(`rl-day-${route}`, day, 90_000) > lim.globalPerDay) return reply({ error: 'unavailable-today' }, 503, { 'retry-after': '3600' });
  } catch {
    return reply({ error: 'protection-unavailable' }, 503);
  }
  return null;
}

// AI: per-visitor and global ceilings per UTC day, plus a short per-minute burst limit. Configuration is required.
export async function enforceAiLimits(request, env) {
  const c = aiCeilings(env);
  if (!c) return reply({ error: 'not-available' }, 404);
  const day = new Date().toISOString().slice(0, 10); const minute = Math.floor(Date.now() / 60_000);
  const lim = limitsFor(env, 'ai');
  try {
    const who = visitorKey(request, env);
    if (await bump('rl-ai-min', `${who}/${minute}`, 90) > lim.perIpPerMin) return reply({ error: 'rate-limited', scope: 'visitor' }, 429, { 'retry-after': '60' });
    if (await bump('ai-visitor-day', `${who}/${day}`, 90_000) > c.perVisitor) return reply({ error: 'daily-limit', scope: 'visitor' }, 429, { 'retry-after': '3600' });
    if (await bump('ai-global-day', day, 90_000) > c.global) return reply({ error: 'unavailable-today' }, 503, { 'retry-after': '3600' });
  } catch {
    return reply({ error: 'protection-unavailable' }, 503);
  }
  return null;
}

// Everything the two paid-AI routes need before any handler runs. Returns a refusal Response, or null to proceed.
// Order: switch and configuration (404/503), method (405), caller (403), body size (411/413), then the ceilings.
export async function aiRouteGuard(request, env, kind /* 'qualitative' | 'ask-sources' */) {
  const gate = featureGate(env, kind === 'ask-sources' ? 'askSources' : 'ai');
  if (gate) return gate;
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (!callerAllowed(request, env)) return reply({ error: 'caller-not-allowed' }, 403);
  const len = Number(request.headers.get('content-length') || 0);
  if (!len) return reply({ error: 'length-required' }, 411);
  if (len > 256 * 1024) return reply({ error: 'too-large' }, 413);
  return enforceAiLimits(request, env);
}

// Headers for any response that carries third-party content.
export const ISOLATION_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  // A stored copy made for one kind of request must never be handed to another (a page's own fetch vs. a direct navigation).
  vary: 'Sec-Fetch-Dest, Sec-Fetch-Site, Sec-Fetch-Mode'
});
