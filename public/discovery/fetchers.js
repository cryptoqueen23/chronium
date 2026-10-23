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
