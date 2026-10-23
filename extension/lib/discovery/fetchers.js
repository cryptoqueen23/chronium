// Deep Discovery: the fetcher contract and one implementation over the Fetch API.
//
// A fetcher performs ONE request and reports what happened. It must not
// follow redirects when capabilities.manualRedirects is true (the engine
// validates every hop). Browsers cannot read a redirect's Location when
// redirects are manual, so a browser/extension fetcher sets
// manualRedirects:false and the engine validates the final address afterwards
// and discards the body if it is not acceptable (documented limitation: in that
// mode the redirect request itself has already been made; Phase 1 adds network
// rules in the extension to block private targets).
//
// fetch(url, { signal, timeoutMs, maxBytes }) -> {
//   status: number|null, headers: { [lowercase name]: string }, url: string (final address),
//   redirected: boolean, body: Uint8Array|null, bytes: number, truncated: boolean,
//   error: { code: 'timeout'|'aborted'|'network' } | null }
import { USER_AGENT } from './config.js';

export async function sha256Hex(bytes) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createFetchApiFetcher({ fetchImpl = (...a) => globalThis.fetch(...a), manualRedirects = true, sendUserAgent = false, extraHeaders = {} } = {}) {
  return {
    capabilities: { manualRedirects },
    async fetch(url, { signal, timeoutMs = 20000, maxBytes = 10 * 1024 * 1024 } = {}) {
      const ctrl = new AbortController();
      let abortReason = null;
      const timer = setTimeout(() => { abortReason = 'timeout'; ctrl.abort(); }, timeoutMs);
      const onAbort = () => { abortReason = abortReason || 'aborted'; ctrl.abort(); };
      if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
      try {
        const headers = { Accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.5', ...extraHeaders };
        if (sendUserAgent) headers['User-Agent'] = USER_AGENT;
        const res = await fetchImpl(url, { method: 'GET', redirect: manualRedirects ? 'manual' : 'follow', credentials: 'omit', cache: 'no-store', signal: ctrl.signal, headers });
        const h = {};
        res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
        const out = { status: res.status, headers: h, url: res.url || url, redirected: !!res.redirected, body: null, bytes: 0, truncated: false, error: null };
        if (res.status >= 300 && res.status < 400) return out;
        if (!res.body) { const buf = new Uint8Array(await res.arrayBuffer()); out.body = buf.length > maxBytes ? buf.slice(0, maxBytes) : buf; out.bytes = out.body.length; out.truncated = buf.length > maxBytes; return out; }
        const reader = res.body.getReader();
        const chunks = []; let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (total + value.length > maxBytes) { chunks.push(value.slice(0, maxBytes - total)); total = maxBytes; out.truncated = true; try { await reader.cancel(); } catch { /* ignore */ } break; }
          chunks.push(value); total += value.length;
        }
        const body = new Uint8Array(total); let o = 0; for (const c of chunks) { body.set(c, o); o += c.length; }
        out.body = body; out.bytes = total;
        return out;
      } catch (e) {
        return { status: null, headers: {}, url, redirected: false, body: null, bytes: 0, truncated: false, error: { code: abortReason || 'network', message: String(e && e.message || e).slice(0, 120) } };
      } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
    }
  };
}

// Website mode: the same contract, through the Worker's guarded /api/fetch endpoint (the browser cannot fetch
// other sites directly). The Worker never follows redirects, so manual-redirect handling in the engine applies.
// Worker answers: HTTP 200 with the upstream status in x-chronium-status and the upstream body, or a JSON error.
export function createProxyFetcher({ base = '', fetchImpl = (...a) => globalThis.fetch(...a), acknowledge = true } = {}) {
  const ERROR_STATUS = { 'rate-limited': 429, 'robots-refused': 403, 'policy-refused': 403, 'content-type-refused': 415 };
  return {
    capabilities: { manualRedirects: true },
    async fetch(url, { signal, timeoutMs = 20000, maxBytes = 10 * 1024 * 1024, isSeed = false } = {}) {
      const ctrl = new AbortController();
      let abortReason = null;
      const timer = setTimeout(() => { abortReason = 'timeout'; ctrl.abort(); }, timeoutMs);
      const onAbort = () => { abortReason = abortReason || 'aborted'; ctrl.abort(); };
      if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
      const fail = (code, message) => ({ status: null, headers: {}, url, redirected: false, body: null, bytes: 0, truncated: false, error: { code, message } });
      try {
        const q = new URLSearchParams({ url });
        if (acknowledge) q.set('ack', '1');
        if (isSeed) q.set('seed', '1');
        const res = await fetchImpl(`${base}/api/fetch?${q}`, { method: 'GET', credentials: 'omit', cache: 'no-store', signal: ctrl.signal });
        const upstreamStatus = res.headers.get('x-chronium-status');
        if (upstreamStatus === null) {
          let err = {}; try { err = await res.json(); } catch { /* not JSON */ }
          if (err.error === 'timeout') return fail('timeout');
          const status = ERROR_STATUS[err.error] ?? null;
          if (status === null) return fail('network', err.error || `HTTP ${res.status}`);
          return { status, headers: err.error === 'rate-limited' ? { 'retry-after': '60' } : {}, url, redirected: false, body: null, bytes: 0, truncated: false, error: null, proxyError: err };
        }
        const h = {};
        const copy = (from, to) => { const v = res.headers.get(from); if (v) h[to] = v; };
        copy('content-type', 'content-type'); copy('x-chronium-etag', 'etag'); copy('x-chronium-last-modified', 'last-modified');
        copy('x-chronium-retry-after', 'retry-after'); copy('x-chronium-x-robots-tag', 'x-robots-tag'); copy('x-chronium-location', 'location');
        const buf = new Uint8Array(await res.arrayBuffer());
        const body = buf.length > maxBytes ? buf.slice(0, maxBytes) : buf;
        const status = Number(upstreamStatus);
        return { status, headers: h, url, redirected: false, body: status >= 300 && status < 400 ? null : body, bytes: status >= 300 && status < 400 ? 0 : body.length, truncated: res.headers.get('x-chronium-truncated') === '1' || buf.length > maxBytes, error: null };
      } catch (e) { return fail(abortReason || 'network', String(e && e.message || e).slice(0, 120)); }
      finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
    }
  };
}

// Archived-copy lookup through the Worker. Returns { status: 'found'|'none'|'unavailable', copies }.
export function createArchiveLookup({ base = '', fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = 15000 } = {}) {
  return async function archiveLookup(url) {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}/api/captures?url=${encodeURIComponent(url)}`, { credentials: 'omit', signal: ctrl.signal });
      if (!res.ok) return { status: 'unavailable', copies: [] };
      const d = await res.json();
      const status = d.status === 'found' && Array.isArray(d.copies) && d.copies.length ? 'found' : d.status === 'none' ? 'none' : 'unavailable';
      return { status, copies: status === 'found' ? d.copies : [] };
    } catch { return { status: 'unavailable', copies: [] }; } finally { clearTimeout(timer); }
  };
}
