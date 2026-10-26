// GET /api/view-capture?url=<archive capture>[&download=1]
//
// Presents an archived page inside Chronium. Archived content is UNTRUSTED: anyone can submit a page containing
// script to a public archive. The rules below keep it from ever running with access to Chronium's own origin
// (where a person's investigations live in IndexedDB):
//   1. Server-enforced switch (default off), configuration check, caller check, limits: refused before any fetch.
//   2. Who may call: view mode only from the page's own fetch() (Sec-Fetch-Dest: empty); download mode from a link or
//      a fetch. A direct visit, a frame, an object or an embed is refused, so the content is never rendered by
//      navigating to this URL.
//   3. Only known archive hosts, and EVERY redirect destination is checked the same way (host list, URL guard), at
//      most three hops; a redirect anywhere else is refused.
//   4. Every response carries isolation headers: a Content-Security-Policy with the `sandbox` directive (an opaque
//      origin, no scripts, no forms) for anything that could execute, `nosniff`, no referrer, same-origin resource
//      policy. Downloads are `attachment`.
//   5. Sizes are enforced while streaming, not only from the declared length.
// The page itself also renders HTML only inside a sandboxed iframe (public/app.js): this is defence in depth.
import { checkUrl } from '../public/discovery/urlGuard.js';
import { isKnownArchiveHost, toDirectContentUrl, filenameForCapture } from './archive.js';
import { featureGate, callerAllowed, enforceLimits, acquireSlot, limitsFor, reply, ISOLATION_HEADERS, testVar } from './guard.js';

const UA = 'ChroniumMind/0.2 (+https://chronium-mind.truewolfflix777.workers.dev/crawler; research tool, not a browser)';
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 8 * 1024 * 1024;

export const CSP_SANDBOX = "sandbox; default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https: http:; font-src data: https: http:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
export const CSP_PLAIN = "default-src 'none'; style-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
// Types a browser could execute or interpret as markup get the sandbox directive.
const SCRIPTABLE = new Set(['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', 'application/xml']);
const RENDERABLE = new Set([
  'text/html', 'application/xhtml+xml', 'application/pdf', 'text/plain', 'application/json', 'text/xml', 'application/xml', 'text/csv', 'application/csv',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'
]);

export const isolationFor = (contentType) => ({ ...ISOLATION_HEADERS, 'content-security-policy': SCRIPTABLE.has(contentType) || !RENDERABLE.has(contentType) ? CSP_SANDBOX : CSP_PLAIN });
const refuse = (error, status) => reply({ ok: false, error }, status, { ...ISOLATION_HEADERS, 'content-security-policy': CSP_SANDBOX });

function archiveHosts(env) { return String(testVar(env, 'TEST_ARCHIVE_HOSTS') || '').split(',').map((s) => s.trim()).filter(Boolean); }
function guardOptions(env) { const l = String(testVar(env, 'DISCOVERY_ALLOW_PRIVATE') || '').split(',').map((s) => s.trim()).filter(Boolean); return l.length ? { allowPrivateHosts: l } : {}; }

// A capture request with every redirect destination re-validated. Returns { res } or { refused }.
export async function fetchArchive(target, env, fetchImpl = (...a) => fetch(...a)) {
  let next = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const g = checkUrl(next, guardOptions(env));
    if (!g.ok) return { refused: hop ? 'redirect-refused' : 'address-refused' };
    if (!isKnownArchiveHost(g.url.href, archiveHosts(env))) return { refused: hop ? 'redirect-refused' : 'not-an-archive-host' };
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res;
    try { res = await fetchImpl(g.url.href, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' } }); }
    catch (e) { return { refused: e?.name === 'AbortError' ? 'timeout' : 'network' }; }
    finally { clearTimeout(timer); }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location'); res.body?.cancel?.();
      if (!loc) return { refused: 'redirect-refused' };
      try { next = new URL(loc, g.url.href).href; } catch { return { refused: 'redirect-refused' }; }
      continue;
    }
    return { res, finalUrl: g.url.href };
  }
  return { refused: 'too-many-redirects' };
}

async function readCapped(res, max) {
  const reader = res.body.getReader(); const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    chunks.push(value);
  }
  return new Blob(chunks);
}
function capStream(body, max) {
  let n = 0;
  return body.pipeThrough(new TransformStream({ transform(chunk, ctl) { n += chunk.byteLength; if (n > max) ctl.error(new Error('too large')); else ctl.enqueue(chunk); } }));
}

export async function handleViewCapture(request, env, ctx, { fetchImpl } = {}) {
  const gate = featureGate(env, 'viewCapture');
  if (gate) return gate;
  if (request.method !== 'GET') return refuse('method-not-allowed', 405);
  const url = new URL(request.url);
  const target = url.searchParams.get('url') || '';
  const download = url.searchParams.get('download') === '1';
  // Who may call, and how: see the header comment.
  if (!callerAllowed(request, env)) return refuse('caller-not-allowed', 403);
  const dest = request.headers.get('sec-fetch-dest');
  if (download ? !['document', 'empty'].includes(dest) : dest !== 'empty') return refuse('direct-viewing-is-not-allowed', 403);
  if (!/^https?:\/\//i.test(target)) return refuse('Invalid URL', 400);
  const first = checkUrl(target, guardOptions(env));
  if (!first.ok) return refuse('address-refused', 400);
  if (!isKnownArchiveHost(first.canonical, archiveHosts(env))) return refuse('Not a recognized archive host', 400);

  const limited = await enforceLimits(request, env, 'viewCapture');
  if (limited) return limited;
  const lim = limitsFor(env, 'viewCapture');
  const release = acquireSlot('viewCapture', lim.maxConcurrent);
  if (!release) return reply({ error: 'busy' }, 429, { 'retry-after': '5' });
  try {
    const store = typeof caches !== 'undefined' ? caches.default : null;
    const cacheReq = new Request(`${url.origin}/api/view-capture?url=${encodeURIComponent(first.canonical)}&download=${download ? 1 : 0}`);
    const hit = store ? await store.match(cacheReq) : null;
    if (hit) return hit;

    // View mode fetches the direct-content variant (no archive toolbar); download fetches the exact URL cited.
    const fetchTarget = download ? first.url.href : toDirectContentUrl(first.url.href);
    const got = await fetchArchive(fetchTarget, env, fetchImpl);
    if (got.refused) return refuse(got.refused === 'timeout' || got.refused === 'network' ? `Could not reach this capture (${got.refused}).` : `Refused (${got.refused}).`, got.refused === 'timeout' || got.refused === 'network' ? 502 : 403);
    const upstream = got.res;
    if (!upstream.ok) { upstream.body?.cancel?.(); return refuse(`Capture responded with HTTP ${upstream.status}.`, 502); }
    const contentType = (upstream.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();

    if (download) {
      const iso = isolationFor(contentType);
      if (Number(upstream.headers.get('content-length') || 0) > lim.maxBytes) { upstream.body?.cancel?.(); return refuse('Capture is too large to download here.', 413); }
      const response = new Response(upstream.body ? capStream(upstream.body, lim.maxBytes) : null, { status: 200, headers: { ...iso, 'content-type': contentType, 'content-disposition': `attachment; filename="${filenameForCapture(first.url.href, contentType)}"`, 'cache-control': 'public, max-age=300' } });
      if (store && ctx?.waitUntil) ctx.waitUntil(store.put(cacheReq, response.clone()).catch(() => {}));
      return response;
    }

    if (!RENDERABLE.has(contentType)) { upstream.body?.cancel?.(); return refuse(`Chronium can't safely preview "${contentType}" content.`, 415); }
    if (Number(upstream.headers.get('content-length') || 0) > lim.maxBytes) { upstream.body?.cancel?.(); return refuse('Capture is too large to preview safely.', 413); }
    const iso = isolationFor(contentType);
    let response;
    if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
      const blob = upstream.body ? await readCapped(upstream, Math.min(MAX_HTML_BYTES, lim.maxBytes)) : new Blob([]);
      if (!blob) return refuse('Capture is too large to preview safely.', 413);
      const html = await blob.text();
      const baseTag = `<base href="${fetchTarget.replace(/"/g, '&quot;')}">`;
      const withBase = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`) : baseTag + html;
      response = new Response(withBase, { status: 200, headers: { ...iso, 'content-type': 'text/html; charset=utf-8', 'content-disposition': 'inline', 'cache-control': 'public, max-age=1800' } });
    } else {
      response = new Response(upstream.body ? capStream(upstream.body, lim.maxBytes) : null, { status: 200, headers: { ...iso, 'content-type': contentType, 'content-disposition': 'inline', 'cache-control': 'public, max-age=1800' } });
    }
    if (store && ctx?.waitUntil) ctx.waitUntil(store.put(cacheReq, response.clone()).catch(() => {}));
    return response;
  } finally { release(); }
}
