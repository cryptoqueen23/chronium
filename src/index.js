import corpus from "../data/copperas-cove/normalized.json";
import { getAIProvider } from "./ai/index.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=60"
};

// Qualitative Analysis cost controls (docs/CANON.md Cost Principle: AI cost
// routing is cache -> deterministic -> cheap model -> premium model, and
// nothing calls a paid API without a real reason to).
const AI_MIN_EVIDENCE_ITEMS = 2; // below this, deterministic "not enough evidence yet" - no AI call at all
const AI_MAX_INPUT_CHARS = 12000; // roughly ~3000 tokens of evidence text, leaves room for the response
const AI_MAX_TOKENS = 1200;
const AI_CACHE_TTL_S = 1800; // 30 min - re-running analysis on unchanged evidence is free within this window

const LOCAL_CORPORA = [
  { id: "copperas-cove", label: "Copperas Cove Investigation Corpus", data: corpus }
];

// Circuit breaker tuning: after this many consecutive failures a connector's
// health record trips, and search() skips calling it at all (instant
// "unavailable" instead of waiting out another doomed timeout) until the
// cooldown passes - "prefer alternate archives immediately" instead of
// waiting on a connector that's currently unhealthy.
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60_000;

// Brief cache for successful provider results, independent of the full
// merged-response cache below - covers "same target, different overall
// query" and "just outside the 5-minute response cache window" without
// re-hitting a rate-limit-sensitive public API. Only ever stores ok:true
// results, so a timeout/error is never cached as a false negative.
const PROVIDER_CACHE_TTL_S = 600;

// Formalizes the connector contract from docs/ARCHITECTURE.md. A provider's search()
// NEVER rejects/throws — it always resolves to the {source, capability, ok, count,
// results, note} shape the API has always returned, even if its own implementation
// has a bug. That's what keeps one archive being down from breaking federated search;
// each provider already has its own try/catch, this is defense in depth around it.
//
// It also owns the circuit breaker and health recording, so an individual
// provider's run() function stays focused purely on talking to its API -
// resilience is generic infrastructure, not per-connector logic (per
// docs/CANON.md: "source-specific logic stays outside the core").
class ArchiveProvider {
  constructor({ id, label, capabilities, run }) {
    this.id = id;
    this.label = label;
    this.capabilities = capabilities; // e.g. ['full-text', 'url-history']
    this.run = run; // async (query, { limit, mode, env, ctx }) => same payload shape as before
  }

  supports(capability) {
    return this.capabilities.includes(capability);
  }

  async search(query, options) {
    const { env, ctx } = options;
    const health = env ? await getHealthRecord(env, this.id) : null;
    if (isCircuitOpen(health)) {
      const retryInS = Math.max(1, Math.ceil((health.circuitOpenUntil - Date.now()) / 1000));
      return {
        source: this.label,
        capability: this.capabilities.join(" + "),
        kind: "historical-archive",
        ok: false,
        skipped: true,
        error: `Temporarily skipped after repeated failures — retrying automatically in ~${retryInS}s.`,
        count: 0,
        results: []
      };
    }

    const started = Date.now();
    try {
      const result = await this.run(query, options);
      if (env && ctx) {
        const outcome = result.ok ? "success" : (classifyError(result.error) || "otherError");
        recordOutcome(env, ctx, this.id, outcome, Date.now() - started, result.error);
      }
      // Every ArchiveProvider is, definitionally, a historical archive - the
      // frontend must never lump this in with the researcher's own saved
      // corpus/library when summarizing "archives searched".
      return { kind: "historical-archive", ...result };
    } catch (e) {
      if (env && ctx) {
        recordOutcome(env, ctx, this.id, classifyError(e?.message) || "otherError", Date.now() - started, e?.message);
      }
      return {
        source: this.label,
        capability: this.capabilities.join(" + "),
        kind: "historical-archive",
        ok: false,
        error: e?.message || "Provider failed",
        count: 0,
        results: []
      };
    }
  }

  // Not called by /api/search yet. Declared now so a dedicated URL/version-history
  // lookup (distinct from a keyword search) and single-capture fetch have one place
  // to live per provider once they're built, instead of another interface change.
  async history() {
    throw new Error(`${this.label} does not implement history() yet`);
  }
  async fetchVersion() {
    throw new Error(`${this.label} does not implement fetchVersion() yet`);
  }

  // Placeholder for selective Cloudflare R2 evidence preservation (docs/ARCHITECTURE.md
  // Phase C: "R2 only for evidence a user explicitly chooses to preserve"). Intentionally
  // unimplemented — no bucket binding or storage logic yet. Exists so the Investigation
  // Workspace's "Save" action has one documented seam to call into later without another
  // interface change: e.g. `await provider.preserve(record, env)` once env.EVIDENCE_BUCKET
  // exists.
  async preserve(_record, _env) {
    return { preserved: false, reason: "R2 preservation not implemented yet" };
  }
}

const ARCHIVE_PROVIDERS = [
  new ArchiveProvider({ id: "arquivo", label: "Arquivo.pt", capabilities: ["full-text", "url-history"], run: searchArquivo }),
  new ArchiveProvider({ id: "wayback", label: "Wayback Machine", capabilities: ["url-history"], run: searchWayback }),
  new ArchiveProvider({ id: "commoncrawl", label: "Common Crawl", capabilities: ["url-history"], run: searchCommonCrawl }),
  // One aggregator instead of several bespoke integrations for archives whose
  // current API shape isn't something Chronium can verify from here (no
  // network access to test against them directly): the Memento protocol
  // (RFC 7089, timetravel.mementoweb.org) is a stable, well-documented
  // standard that federates Library of Congress, Archive-It, UK Government
  // Web Archive, and others under one TimeMap endpoint. Individual result
  // rows still attribute their real originating archive (see
  // labelForArchiveHost) - this is about not guessing at 4 separate unknown
  // endpoints, not about hiding where a result actually came from.
  new ArchiveProvider({ id: "memento", label: "Memento Aggregator", capabilities: ["url-history"], run: searchMemento })
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "Chronium Mind", version: "0.2.0" });
    }

    // Per-connector success rate, latency, and failure-kind breakdown, plus
    // current circuit-breaker state. Read-only, KV-backed.
    if (url.pathname === "/api/health/connectors") {
      const connectors = await Promise.all(ARCHIVE_PROVIDERS.map(async (p) => {
        const r = await getHealthRecord(env, p.id);
        return {
          id: p.id,
          source: p.label,
          total: r?.total || 0,
          success: r?.success || 0,
          timeout: r?.timeout || 0,
          forbidden: r?.forbidden || 0,
          rateLimited: r?.rateLimited || 0,
          serverError: r?.serverError || 0,
          otherError: r?.otherError || 0,
          successRatePct: r?.total ? Math.round((r.success / r.total) * 1000) / 10 : null,
          avgLatencyMs: r?.latencyCount ? Math.round(r.latencySumMs / r.latencyCount) : null,
          circuitOpen: isCircuitOpen(r),
          circuitOpenUntil: r?.circuitOpenUntil ? new Date(r.circuitOpenUntil).toISOString() : null,
          lastError: r?.lastError || null,
          lastUpdated: r?.lastUpdated || null
        };
      }));
      return json({ connectors });
    }

    // Validates a single result link (archived capture or current live page)
    // before the frontend navigates to it, so a dead link never dumps the
    // user onto a third-party error page. Same check for both kinds - the
    // archived-vs-live distinction is a frontend labeling concern, not a
    // different validation strategy.
    if (url.pathname === "/api/check-link") {
      const target = url.searchParams.get("url") || "";
      if (!/^https?:\/\//i.test(target)) return json({ ok: false, kind: "invalid" }, 400);

      // CANON "Backup-to-the-backup reliability": cache resolutions so a
      // researcher paging through the same result set (or Chronium's own
      // fallback cascade re-trying a candidate) never re-tests a link that
      // was just checked. Successes cache longer than failures - a working
      // capture stays working; a failure is more likely transient and
      // shouldn't be trusted as permanently dead for long.
      const cache = caches.default;
      const cacheKey = new Request(`${url.origin}/api/check-link?url=${encodeURIComponent(target)}`);
      const hit = await cache.match(cacheKey);
      if (hit) return hit;

      const verdict = await checkLink(target);
      const response = json(verdict);
      response.headers.set("cache-control", `public, max-age=${verdict.ok ? 600 : 45}`);
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    // Archive Viewer: proxies an archived capture so it can be rendered
    // INSIDE Chronium (an iframe, a PDF embed, a text panel) instead of the
    // browser navigating straight to the archive's own URL - which, for a
    // PDF or a misconfigured server, can mean a forced download instead of
    // a page the researcher can actually look at. Two modes:
    //   (default) view  - allowlisted content-types only, HTML gets a
    //                      <base> tag injected so relative assets still
    //                      resolve against the real archive host, and
    //                      Content-Disposition is always forced to
    //                      "inline" regardless of what the origin sent.
    //   ?download=1      - unmodified passthrough of the exact bytes
    //                      Chronium saw (evidence integrity: the viewer is
    //                      presentation-only, this is the real artifact),
    //                      Content-Disposition forced to "attachment".
    // Only known archive hosts are proxied - this endpoint is not an open
    // proxy for arbitrary URLs.
    if (url.pathname === "/api/view-capture") {
      const target = url.searchParams.get("url") || "";
      const download = url.searchParams.get("download") === "1";
      if (!/^https?:\/\//i.test(target)) return json({ ok: false, error: "Invalid URL" }, 400);
      if (!isKnownArchiveHost(target)) return json({ ok: false, error: "Not a recognized archive host" }, 400);

      const cache = caches.default;
      const cacheKey = new Request(`${url.origin}/api/view-capture?url=${encodeURIComponent(target)}&download=${download ? 1 : 0}`);
      const hit = await cache.match(cacheKey);
      if (hit) return hit;

      // Arquivo.pt and Wayback Machine both replay through pywb, which
      // serves a toolbar+frameset wrapper at the normal capture URL - the
      // actual archived page sits in a *static* nested <iframe> at a
      // modifier-suffixed URL (Arquivo: .../wayback/<ts>mp_/<url>, Wayback:
      // .../web/<ts>if_/<url>). Rendering the wrapper directly (with scripts
      // sandboxed off, as this viewer requires) would show pywb's own chrome
      // - never the page. View mode fetches the direct-content variant;
      // download mode still fetches the exact URL Chronium cited, unmodified,
      // for evidence integrity.
      const fetchTarget = download ? target : toDirectContentUrl(target);

      let upstream;
      try {
        upstream = await fetchResilient(fetchTarget, 15000, { redirect: "follow" });
      } catch (e) {
        return json({ ok: false, error: `Could not reach this capture (${classifyError(e?.message) || "network error"}).` }, 502);
      }
      if (!upstream.ok) {
        upstream.body?.cancel?.();
        return json({ ok: false, error: `Capture responded with HTTP ${upstream.status}.` }, 502);
      }

      const contentType = (upstream.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();

      if (download) {
        // Raw, unmodified passthrough - the actual archived bytes, for
        // evidence integrity. No content-type restriction: if it was
        // reachable, the researcher can save it.
        const response = new Response(upstream.body, {
          status: 200,
          headers: {
            "content-type": contentType,
            "content-disposition": `attachment; filename="${filenameForCapture(target, contentType)}"`,
            "cache-control": "private, max-age=300"
          }
        });
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      }

      const RENDERABLE_TYPES = new Set([
        "text/html", "application/xhtml+xml", "application/pdf",
        "text/plain", "application/json", "text/xml", "application/xml", "text/csv", "application/csv",
        "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"
      ]);
      if (!RENDERABLE_TYPES.has(contentType)) {
        upstream.body?.cancel?.();
        return json({ ok: false, error: `Chronium can't safely preview "${contentType}" content.`, unsupported: true }, 415);
      }

      const contentLength = Number(upstream.headers.get("content-length") || 0);
      const MAX_PROXY_BYTES = 30 * 1024 * 1024;
      if (contentLength > MAX_PROXY_BYTES) {
        upstream.body?.cancel?.();
        return json({ ok: false, error: "Capture is too large to preview safely.", tooLarge: true }, 413);
      }

      let response;
      if (contentType === "text/html" || contentType === "application/xhtml+xml") {
        const MAX_HTML_CHARS = 8 * 1024 * 1024;
        const html = await upstream.text();
        if (html.length > MAX_HTML_CHARS) {
          return json({ ok: false, error: "Capture is too large to preview safely.", tooLarge: true }, 413);
        }
        // The HTML now comes from Chronium's own origin, but its relative
        // (and root-relative) asset/link URLs were written to resolve
        // against fetchTarget (the direct-content URL for pywb captures) -
        // a <base> tag is enough to fix that for the whole document, no
        // need to rewrite every href/src.
        const baseTag = `<base href="${fetchTarget.replace(/"/g, "&quot;")}">`;
        const withBase = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`) : baseTag + html;
        response = new Response(withBase, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "content-disposition": "inline", "cache-control": "public, max-age=1800" }
        });
      } else {
        // PDF/image/text - streamed straight through, never buffered, so a
        // large PDF doesn't sit in Worker memory just to be re-sent.
        response = new Response(upstream.body, {
          status: 200,
          headers: { "content-type": contentType, "content-disposition": "inline", "cache-control": "public, max-age=1800" }
        });
      }
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    // Read-only AI usage/cost visibility - the "cost per successful
    // investigation/search" metric from docs/CANON.md's Cost Principle,
    // at least for the AI slice of it.
    if (url.pathname === "/api/ai/usage") {
      const provider = getAIProvider(env);
      const usage = await getAiUsage(env, provider.id);
      return json({ provider: provider.id, ...usage });
    }

    if (url.pathname === "/api/analyze/qualitative") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      return handleQualitativeAnalysis(request, env, ctx);
    }

    if (url.pathname === "/api/search") {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

      const q = (url.searchParams.get("q") || "").trim();
      const limit = clamp(Number(url.searchParams.get("limit") || 20), 1, 50);
      if (q.length < 2) return json({ error: "Enter at least 2 characters." }, 400);
      if (q.length > 300) return json({ error: "Query is too long." }, 400);

      const cache = caches.default;
      const cacheKey = new Request(`${url.origin}/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);
      const hit = await cache.match(cacheKey);
      if (hit) return hit;

      const mode = looksLikeUrlOrDomain(q) ? "url" : "topic";
      const started = Date.now();
      const options = { limit, mode, env, ctx };

      const arquivo = ARCHIVE_PROVIDERS.find((p) => p.id === "arquivo");
      const jobs = [arquivo.search(q, options), searchLocalCorpora(q, limit)];

      // Wayback and Common Crawl CDX are URL/capture indexes, not global full-text engines;
      // only query them in URL mode. Each is an independent provider — one being down
      // (or slow, or rate-limited) never blocks the others, per ArchiveProvider.search().
      // All jobs run concurrently (Promise.allSettled below), so a slow/circuit-open
      // connector never delays the others' results.
      if (mode === "url") {
        for (const provider of ARCHIVE_PROVIDERS) {
          if (provider.id !== "arquivo" && provider.supports("url-history")) {
            jobs.push(provider.search(q, options));
          }
        }
      }

      const settled = await Promise.allSettled(jobs);
      const payloads = settled.map((r) => r.status === "fulfilled" ? r.value : ({
        source: "Unknown",
        capability: "unknown",
        ok: false,
        error: r.reason?.message || "Connector failed",
        results: []
      }));

      // Same page captured by several archives becomes one result row, not
      // several near-duplicate ones - the other archives' captures ride
      // along as alternateArchiveUrls so a dead primary capture can fall
      // back to a working one from a different archive (see
      // findAlternateArchiveUrls in public/app.js) without Chronium ever
      // needing to re-query anything.
      const results = groupSamePage(dedupe(payloads.flatMap((p) => p.results || [])))
        .sort((a, b) => String(b.captureDate || "").localeCompare(String(a.captureDate || "")))
        .slice(0, limit * 3);

      const response = json({
        query: q,
        mode,
        tookMs: Date.now() - started,
        total: results.length,
        connectors: payloads.map(({ source, capability, kind, ok, error, count, note, skipped }) => ({
          source, capability, kind: kind || "historical-archive", ok, error: error || null, count: count || 0, note: note || null, skipped: !!skipped
        })),
        results
      });
      response.headers.set("cache-control", "public, max-age=300");
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    return env.ASSETS.fetch(request);
  }
};

async function searchArquivo(query, { limit, mode }) {
  const source = "Arquivo.pt";
  try {
    let endpoint;
    if (mode === "url") {
      const target = normalizeTarget(query);
      endpoint = `https://arquivo.pt/textsearch?versionHistory=${encodeURIComponent(target)}&maxItems=${Math.min(limit, 50)}`;
    } else {
      endpoint = `https://arquivo.pt/textsearch?q=${encodeURIComponent(query)}&maxItems=${Math.min(limit, 50)}`;
    }

    const res = await fetchResilient(endpoint, 8000, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = data.response_items || data.responseItems || data.items || [];

    const results = items.map((item, i) => {
      const original = item.originalURL || item.originalUrl || item.url || item.link || "";
      const ts = item.tstamp || item.timestamp || item.date || item.captureDate || "";
      const archiveUrl = item.linkToArchive || item.archiveURL || item.archiveUrl || item.link || buildArquivoReplay(ts, original);
      return {
        id: `arquivo-${ts || i}-${hashString(original)}`,
        source,
        sourceKind: "archive-connector",
        title: stripHtml(item.title || original || "Archived result"),
        originalUrl: original,
        archiveUrl,
        captureDate: normalizeTimestamp(ts),
        mime: item.mimeType || item.mime || "text/html",
        language: item.language || null,
        snippet: stripHtml(item.snippet || item.text || item.description || ""),
        matchType: mode === "topic" ? "full-text" : "url-history"
      };
    });

    return {
      source,
      capability: mode === "topic" ? "full-text historical search" : "URL/version history",
      ok: true,
      count: results.length,
      results
    };
  } catch (e) {
    return { source, capability: "full-text + URL history", ok: false, error: e.message, count: 0, results: [] };
  }
}

async function searchWayback(query, { limit, ctx }) {
  const source = "Wayback Machine";
  const target = normalizeTarget(query);
  const cacheParams = `url=${encodeURIComponent(target)}&limit=${Math.min(limit, 50)}`;
  const cached = await getCachedProviderResult("wayback", cacheParams);
  if (cached) return cached;

  try {
    const api = new URL("https://web.archive.org/cdx/search/cdx");
    api.searchParams.set("url", `${target}/*`);
    api.searchParams.set("output", "json");
    api.searchParams.set("fl", "timestamp,original,statuscode,mimetype,digest");
    api.searchParams.append("filter", "statuscode:200");
    api.searchParams.set("collapse", "digest");
    api.searchParams.set("limit", String(Math.min(limit, 50)));

    // 12s not 8s: the CDX endpoint is noticeably slower now that requests
    // reach the app layer at all (it used to reject everything instantly at
    // the nginx layer for lacking a User-Agent - see DEFAULT_HEADERS below).
    const res = await fetchResilient(api.toString(), 12000, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    if (!text.trim()) {
      const empty = { source, capability: "URL/capture index", ok: true, count: 0, results: [],
        note: "Wayback CDX indexes URLs and captures; it is not a global full-text topic search API." };
      putCachedProviderResult(ctx, "wayback", cacheParams, empty);
      return empty;
    }
    const rows = JSON.parse(text);
    const headers = rows.shift() || [];
    const results = rows.map((row, i) => {
      const obj = Object.fromEntries(headers.map((h, idx) => [h, row[idx]]));
      return {
        id: `wayback-${obj.timestamp || i}-${hashString(obj.original || "")}`,
        source,
        sourceKind: "archive-connector",
        title: obj.original || "Archived page",
        originalUrl: obj.original || "",
        archiveUrl: obj.timestamp && obj.original ? `https://web.archive.org/web/${obj.timestamp}/${obj.original}` : "",
        captureDate: normalizeTimestamp(obj.timestamp),
        mime: obj.mimetype || null,
        language: null,
        snippet: "",
        digest: obj.digest || null,
        matchType: "url-history"
      };
    });
    const payload = { source, capability: "URL/capture index", ok: true, count: results.length, results,
      note: "Wayback CDX indexes URLs and captures; it is not a global full-text topic search API." };
    putCachedProviderResult(ctx, "wayback", cacheParams, payload);
    return payload;
  } catch (e) {
    return { source, capability: "URL/capture index", ok: false, error: e.message, count: 0, results: [] };
  }
}

async function searchCommonCrawl(query, { limit, ctx }) {
  const source = "Common Crawl";
  const target = normalizeTarget(query);
  const cacheParams = `url=${encodeURIComponent(target)}&limit=${Math.min(limit, 30)}`;
  const cached = await getCachedProviderResult("commoncrawl", cacheParams);
  if (cached) return cached;

  try {
    const collectionsRes = await fetchResilient("https://index.commoncrawl.org/collinfo.json", 6000);
    if (!collectionsRes.ok) throw new Error(`Collections HTTP ${collectionsRes.status}`);
    const collections = await collectionsRes.json();
    const latest = collections.slice(0, 3);
    const perIndex = Math.max(3, Math.ceil(Math.min(limit, 30) / latest.length));

    const responses = await Promise.allSettled(latest.map(async (collection) => {
      const endpoint = new URL(collection["cdx-api"] || `https://index.commoncrawl.org/${collection.id}-index`);
      endpoint.searchParams.set("url", `${target}/*`);
      endpoint.searchParams.set("output", "json");
      endpoint.searchParams.append("filter", "status:200");
      endpoint.searchParams.set("collapse", "digest");
      endpoint.searchParams.set("limit", String(perIndex));
      const res = await fetchResilient(endpoint.toString(), 7000, { headers: { accept: "application/x-ndjson,application/json" } });
      if (!res.ok) throw new Error(`${collection.id} HTTP ${res.status}`);
      const text = await res.text();
      return text.split(/\r?\n/).filter(Boolean).map((line) => ({ collection: collection.id, ...JSON.parse(line) }));
    }));

    const rows = responses.flatMap((r) => r.status === "fulfilled" ? r.value : []);
    const results = rows.map((obj, i) => ({
      id: `cc-${obj.collection}-${obj.timestamp || i}-${hashString(obj.url || "")}`,
      source,
      sourceKind: "archive-connector",
      title: obj.url || "Common Crawl capture",
      originalUrl: obj.url || "",
      archiveUrl: obj.filename ? `https://data.commoncrawl.org/${obj.filename}` : "",
      captureDate: normalizeTimestamp(obj.timestamp),
      mime: obj["mime-detected"] || obj.mime || null,
      language: obj.languages || null,
      snippet: "",
      digest: obj.digest || null,
      collection: obj.collection,
      warc: obj.filename ? { filename: obj.filename, offset: obj.offset, length: obj.length } : null,
      matchType: "url-history"
    }));

    const payload = { source, capability: "URL/capture index", ok: true, count: results.length, results,
      note: "MVP searches the latest 3 Common Crawl monthly indexes for URL/domain queries." };
    putCachedProviderResult(ctx, "commoncrawl", cacheParams, payload);
    return payload;
  } catch (e) {
    return { source, capability: "URL/capture index", ok: false, error: e.message, count: 0, results: [] };
  }
}

// Memento Aggregator (RFC 7089): one TimeMap query fans out across many
// participating archives - Library of Congress, Archive-It, UK Government
// Web Archive, and others - rather than Chronium guessing at each one's own
// current API shape. Each returned memento still names its real archive
// host (labelForArchiveHost), so provenance stays honest per result even
// though the query itself goes through one aggregator.
async function searchMemento(query, { limit, ctx }) {
  const source = "Memento Aggregator";
  const capability = "URL/capture index (multi-archive aggregator)";
  const target = normalizeTarget(query);
  const cacheParams = `url=${encodeURIComponent(target)}&limit=${Math.min(limit, 50)}`;
  const cached = await getCachedProviderResult("memento", cacheParams);
  if (cached) return cached;

  try {
    const fullUrl = /^https?:\/\//i.test(target) ? target : `http://${target}`;
    const endpoint = `http://timetravel.mementoweb.org/timemap/link/${fullUrl}`;
    const res = await fetchResilient(endpoint, 8000, { headers: { accept: "application/link-format" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const mementos = parseTimeMap(text).slice(0, Math.min(limit, 50));

    const results = mementos.map((m, i) => ({
      id: `memento-${m.datetime || i}-${hashString(m.url)}`,
      source: labelForArchiveHost(m.url),
      sourceKind: "archive-connector",
      title: target,
      originalUrl: target,
      archiveUrl: m.url,
      captureDate: m.datetime ? normalizeTimestamp(m.datetime) : null,
      mime: null,
      language: null,
      snippet: "",
      matchType: "url-history"
    }));

    const payload = { source, capability, ok: true, count: results.length, results,
      note: "Aggregates captures across Library of Congress, Archive-It, UK Government Web Archive, and others via the Memento protocol (RFC 7089)." };
    putCachedProviderResult(ctx, "memento", cacheParams, payload);
    return payload;
  } catch (e) {
    return { source, capability, ok: false, error: e.message, count: 0, results: [] };
  }
}

// Parses an application/link-format TimeMap: comma-separated
// `<url>;rel="...";datetime="..."` entries. Keeps only rel="memento" (and
// "first memento"/"last memento") entries - "original"/"self"/"timemap"
// entries describe the TimeMap request itself, not an archived capture.
function parseTimeMap(text) {
  const entries = [];
  for (const raw of text.split(/,\s*(?=<)/)) {
    const urlMatch = raw.match(/<([^>]+)>/);
    if (!urlMatch) continue;
    const relMatch = raw.match(/rel="([^"]+)"/);
    if (!relMatch || !/\bmemento\b/.test(relMatch[1])) continue;
    const dtMatch = raw.match(/datetime="([^"]+)"/);
    entries.push({ url: urlMatch[1], datetime: dtMatch ? dtMatch[1] : null });
  }
  return entries;
}

function labelForArchiveHost(u) {
  let host;
  try { host = new URL(u).hostname; } catch { return "Memento-aggregated archive"; }
  if (host.includes("web.archive.org")) return "Wayback Machine";
  if (host.includes("archive-it.org")) return "Archive-It";
  if (host.includes("nationalarchives.gov.uk")) return "UK Government Web Archive";
  if (host.includes("webarchive.loc.gov") || host.includes("loc.gov")) return "Library of Congress Web Archive";
  if (host.includes("arquivo.pt")) return "Arquivo.pt";
  return host;
}

// /api/view-capture only ever proxies known archive hosts - this is what
// keeps it from becoming an open proxy for arbitrary URLs.
const KNOWN_ARCHIVE_HOSTS = [
  "web.archive.org", "archive-it.org", "nationalarchives.gov.uk", "webarchive.loc.gov", "loc.gov",
  "arquivo.pt", "commoncrawl.org", "data.commoncrawl.org", "index.commoncrawl.org", "timetravel.mementoweb.org"
];
function isKnownArchiveHost(u) {
  let host;
  try { host = new URL(u).hostname.toLowerCase(); } catch { return false; }
  return KNOWN_ARCHIVE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

// pywb (Arquivo.pt, Wayback Machine) replay URLs serve a toolbar+frameset
// wrapper by default; appending a modifier right after the 14-digit
// timestamp switches to direct content with no wrapper - what the
// wrapper's own nested <iframe> points at. Only rewrites URLs that already
// match the exact unmodified pattern, so it's a no-op (and never
// double-applies) for anything else, including an already-modified URL.
// The wrapper-frameset problem is HTML-specific: pywb only injects its
// toolbar chrome around a replayed HTML page. A capture URL that's clearly
// a non-HTML file (PDF, image, doc, spreadsheet, archive...) already
// resolves straight to the raw bytes with no wrapper to strip, and
// applying an "if_"/"mp_" modifier to it is unnecessary at best.
const NON_HTML_EXT = /\.(pdf|docx?|xlsx?|csv|zip|jpg|jpeg|png|gif|webp|svg|json|xml|txt|mp3|mp4|wav)(\?|#|$)/i;
function toDirectContentUrl(u) {
  try {
    const host = new URL(u).hostname.toLowerCase();
    if (NON_HTML_EXT.test(u)) return u;
    if (host.endsWith("arquivo.pt") && /\/wayback\/\d{14}\//.test(u)) return u.replace(/(\/wayback\/\d{14})\//, "$1mp_/");
    if (host.endsWith("web.archive.org") && /\/web\/\d{14}\//.test(u)) return u.replace(/(\/web\/\d{14})\//, "$1if_/");
    return u;
  } catch { return u; }
}

const EXT_FOR_CONTENT_TYPE = {
  "text/html": "html", "application/xhtml+xml": "html", "application/pdf": "pdf",
  "text/plain": "txt", "application/json": "json", "text/xml": "xml", "application/xml": "xml",
  "text/csv": "csv", "application/csv": "csv",
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg"
};
function filenameForCapture(target, contentType) {
  let last = "capture";
  try { last = new URL(target).pathname.split("/").filter(Boolean).pop() || "capture"; } catch { /* keep default */ }
  last = last.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "capture";
  if (/\.[a-z0-9]{1,6}$/i.test(last)) return last;
  return `${last}.${EXT_FOR_CONTENT_TYPE[contentType] || "bin"}`;
}

async function searchLocalCorpora(query, limit) {
  const source = LOCAL_CORPORA.map((c) => c.label).join(", ") || "Investigation corpus";
  try {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = [];
    for (const { label, data } of LOCAL_CORPORA) {
      for (const record of data.records || []) {
        const haystack = `${record.title} ${record.category} ${record.description} ${record.originalUrl}`.toLowerCase();
        if (terms.every((t) => haystack.includes(t))) matches.push({ label, record });
      }
    }
    const results = matches.slice(0, limit).map(({ label, record }) => {
      const version = record.versions?.[0] || {};
      return {
        id: record.id,
        source: label,
        sourceKind: "investigation-corpus",
        title: record.title,
        originalUrl: record.originalUrl,
        archiveUrl: version.archiveUrl,
        captureDate: version.capturedAt,
        mime: record.documentType,
        language: null,
        snippet: record.description,
        matchType: "investigation-record",
        organization: record.organization,
        jurisdiction: record.jurisdiction,
        category: record.category,
        captureCount: record.captureCount,
        uniqueVersionCount: record.uniqueVersionCount,
        historyUrl: record.provenance?.historyUrl || null,
        priority: record.provenance?.priority || null
      };
    });
    return {
      source, capability: "local investigation corpus (keyword match)", kind: "my-research", ok: true,
      count: results.length, results,
      note: "Searches a locally bundled, previously harvested investigation dataset, not a live crawl."
    };
  } catch (e) {
    return { source, capability: "local investigation corpus", kind: "my-research", ok: false, error: e.message, count: 0, results: [] };
  }
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.digest || `${item.source}|${item.originalUrl}|${item.captureDate}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// CANON "Backup-to-the-backup reliability": the fallback order a dead
// primary capture cascades through, most-trusted/most-complete first. Not
// used to pick the primary (recency wins there, see below) - only to order
// the alternates a dead link falls back through at click time.
const PROVIDER_FALLBACK_ORDER = ["Wayback Machine", "Arquivo.pt", "Memento Aggregator", "Common Crawl"];
function providerRank(source) {
  const i = PROVIDER_FALLBACK_ORDER.indexOf(source);
  return i === -1 ? PROVIDER_FALLBACK_ORDER.length : i;
}

// Collapses multiple archives' captures of the same underlying page (same
// originalUrl) into one result row: the most recent capture is shown, the
// rest become alternateArchiveUrls for the frontend's click-time fallback -
// each carrying its own source/captureDate so a fallback can report which
// provider actually supplied the evidence (provenance), not just silently
// swap URLs. Runs after dedupe() (which only removes exact same-source
// repeats), so this is specifically the cross-archive merge.
function groupSamePage(items) {
  const groups = new Map();
  for (const item of items) {
    const key = (item.originalUrl || item.archiveUrl || item.id || "").toLowerCase().replace(/\/+$/, "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const grouped = [];
  for (const captures of groups.values()) {
    captures.sort((a, b) => String(b.captureDate || "").localeCompare(String(a.captureDate || "")));
    const [primary, ...rest] = captures;
    // Fallback order: another capture from the SAME provider as the primary
    // first (e.g. an older Wayback snapshot backing up the newest Wayback
    // snapshot), then the remaining providers in preference order, and
    // within each provider the most recent capture first.
    const seen = new Set([primary.archiveUrl]);
    const alternateArchiveUrls = rest
      .filter((c) => c.archiveUrl && !seen.has(c.archiveUrl) && (seen.add(c.archiveUrl), true))
      .sort((a, b) => {
        const sameA = a.source === primary.source ? 0 : 1;
        const sameB = b.source === primary.source ? 0 : 1;
        if (sameA !== sameB) return sameA - sameB;
        const rankDiff = providerRank(a.source) - providerRank(b.source);
        if (rankDiff !== 0) return rankDiff;
        return String(b.captureDate || "").localeCompare(String(a.captureDate || ""));
      })
      .map((c) => ({ source: c.source, archiveUrl: c.archiveUrl, captureDate: c.captureDate || null }));
    grouped.push(alternateArchiveUrls.length ? { ...primary, alternateArchiveUrls } : primary);
  }
  return grouped;
}

function looksLikeUrlOrDomain(q) {
  if (/^https?:\/\//i.test(q)) return true;
  return !/\s/.test(q) && /^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(q);
}

function normalizeTarget(q) {
  return q.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

function normalizeTimestamp(ts) {
  if (!ts) return null;
  const digits = String(ts).replace(/\D/g, "");
  if (digits.length >= 8) {
    const y = digits.slice(0, 4), m = digits.slice(4, 6), d = digits.slice(6, 8);
    const hh = digits.slice(8, 10) || "00", mm = digits.slice(10, 12) || "00", ss = digits.slice(12, 14) || "00";
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}Z`;
  }
  const parsed = new Date(ts);
  return Number.isNaN(parsed.getTime()) ? String(ts) : parsed.toISOString();
}

function buildArquivoReplay(ts, url) {
  return ts && url ? `https://arquivo.pt/wayback/${String(ts).replace(/\D/g, "")}/${url}` : "";
}

function stripHtml(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function clamp(n, min, max) { return Math.min(Math.max(Number.isFinite(n) ? n : min, min), max); }
function hashString(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Checks whether a result link (archived capture or live page) actually
// resolves before the frontend ever navigates to it. Follows redirects (so
// a moved/canonicalized URL still counts as reachable) and falls back from
// HEAD to GET for the servers that reject HEAD outright. The failure kind
// is for internal logging only (console.error below, visible via `wrangler
// tail`) - callers get a clean {ok, kind} pair, never the raw error text.
async function checkLink(target) {
  try {
    let res = await fetchResilient(target, 5000, { method: "HEAD", redirect: "follow" });
    if (res.status === 405 || res.status === 501) {
      res = await fetchResilient(target, 5000, { method: "GET", redirect: "follow" });
    }
    if (res.ok) return { ok: true, status: res.status, finalUrl: res.url };
    const kind = res.status === 404 ? "not-found" : res.status === 403 ? "forbidden" : res.status >= 500 ? "server-error" : "http-error";
    console.error(`checkLink: ${target} -> HTTP ${res.status} (${kind})`);
    return { ok: false, status: res.status, finalUrl: res.url, kind };
  } catch (e) {
    const kind = classifyError(e?.message) === "timeout" ? "timeout" : "network-error";
    console.error(`checkLink: ${target} -> ${e?.message || "unknown error"} (${kind})`);
    return { ok: false, status: null, finalUrl: null, kind };
  }
}

// ---------------------------------------------------------------------------
// Qualitative Analysis (AI-assisted) - Chronium never stores investigation
// data server-side (it lives in the client's IndexedDB, see docs/CANON.md
// Storage Modes), so the client sends the specific evidence/claims text to
// analyze on each call. Quantitative analysis needs none of this - it's
// pure counting over data the client already has, computed entirely
// client-side in public/app.js with zero AI cost.
// ---------------------------------------------------------------------------
const ANALYSIS_SYSTEM_PROMPT = `You are analyzing evidence for a research investigation in Chronium, a "never lose the receipt" research tool.
Rules:
- Only reason over the evidence items and claims you are given. Never invent facts, names, dates, or figures that aren't present in them.
- Every theme, pattern, or contradiction you identify must cite which evidence item id(s) (the "ev-..." ids given to you) it's based on.
- This is AI Analysis, not Source Fact or Computed Fact (see Chronium's evidence rules) - never present your interpretation as established fact. If evidence is sparse, ambiguous, or contradictory, say so rather than overstating confidence.
- Respond with ONLY a JSON object, no other text, no markdown fences, matching exactly this shape:
{"themes":[{"title":string,"description":string,"evidenceIds":string[]}],"patterns":[{"description":string,"evidenceIds":string[]}],"contradictions":[{"description":string,"evidenceIds":string[]}],"synthesis":string}`;

async function handleQualitativeAnalysis(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const researchQuestion = String(body?.researchQuestion || "").slice(0, 300);
  const evidenceItems = Array.isArray(body?.evidenceItems) ? body.evidenceItems : [];
  const claims = Array.isArray(body?.claims) ? body.claims : [];

  if (evidenceItems.length < AI_MIN_EVIDENCE_ITEMS) {
    // Deterministic answer, no AI call - docs/CANON.md: never call AI when
    // deterministic analysis is enough (here: it's enough to just say no).
    return json({ ok: true, skipped: true, reason: `Add at least ${AI_MIN_EVIDENCE_ITEMS} evidence items before running analysis.`, result: null });
  }

  const { promptBody, truncated } = buildEvidencePromptBody(evidenceItems, claims);
  const prompt = `Research question: ${researchQuestion || "(not set)"}\n\n${promptBody}`;
  const contentHash = hashString(ANALYSIS_SYSTEM_PROMPT + "|" + prompt);

  const cacheKey = new Request(`https://cache.internal/analyze/qualitative?h=${contentHash}`);
  const cacheHit = await caches.default.match(cacheKey);
  if (cacheHit) return json({ ...(await cacheHit.json()), cached: true, truncated });

  let provider;
  try {
    provider = getAIProvider(env);
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }

  const started = Date.now();
  try {
    const completion = await provider.complete({ system: ANALYSIS_SYSTEM_PROMPT, prompt, maxTokens: AI_MAX_TOKENS, env });
    recordAiUsage(env, ctx, provider.id, { calls: 1, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, errors: 0 });

    const result = parseAnalysisResponse(completion.text);
    const payload = { ok: true, result, model: completion.model, tookMs: Date.now() - started };

    const cacheResponse = new Response(JSON.stringify(payload), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${AI_CACHE_TTL_S}` } });
    ctx.waitUntil(caches.default.put(cacheKey, cacheResponse));

    return json({ ...payload, cached: false, truncated });
  } catch (e) {
    recordAiUsage(env, ctx, provider.id, { calls: 1, inputTokens: 0, outputTokens: 0, errors: 1 });
    console.error(`qualitative analysis failed: ${e.message}`);
    return json({ ok: false, error: "AI analysis is temporarily unavailable. Try again in a moment." }, 502);
  }
}

// Builds the evidence/claims text block for the prompt, truncating to
// AI_MAX_INPUT_CHARS if needed rather than silently sending everything (or
// silently dropping items without saying so).
function buildEvidencePromptBody(evidenceItems, claims) {
  const lines = ["Evidence items:"];
  let truncated = false;
  let usedItems = 0;
  for (const item of evidenceItems) {
    const line = `- [${item.id}] (${item.excerptType || "excerpt"}${item.location ? ", " + item.location : ""}): ${String(item.excerptText || "").slice(0, 600)}`;
    const candidate = lines.join("\n") + "\n" + line;
    if (candidate.length > AI_MAX_INPUT_CHARS) { truncated = true; break; }
    lines.push(line);
    usedItems++;
  }
  if (claims.length && !truncated) {
    lines.push("\nExisting claims:");
    for (const c of claims) {
      const line = `- [${c.claimId || c.id}] ${String(c.text || "").slice(0, 300)}`;
      const candidate = lines.join("\n") + "\n" + line;
      if (candidate.length > AI_MAX_INPUT_CHARS) { truncated = true; break; }
      lines.push(line);
    }
  }
  if (truncated) lines.push(`\n(Analysis is based on the first ${usedItems} of ${evidenceItems.length} evidence items - the full set was too large for one analysis pass.)`);
  return { promptBody: lines.join("\n"), truncated };
}

// The model is instructed to return only JSON, but never trust that
// unconditionally - fall back to returning the raw text as the synthesis
// rather than silently discarding an answer that didn't parse cleanly.
function parseAnalysisResponse(text) {
  try {
    const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(cleaned);
    return {
      themes: Array.isArray(parsed.themes) ? parsed.themes : [],
      patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
      contradictions: Array.isArray(parsed.contradictions) ? parsed.contradictions : [],
      synthesis: typeof parsed.synthesis === "string" ? parsed.synthesis : "",
      parseError: false
    };
  } catch {
    return { themes: [], patterns: [], contradictions: [], synthesis: text, parseError: true };
  }
}

// AI usage/cost tracking - reuses the CONNECTOR_HEALTH KV namespace (same
// "small fast-changing counters" use case, no reason for a second
// namespace) under a distinct key prefix.
async function getAiUsage(env, providerId) {
  if (!env?.CONNECTOR_HEALTH) return { calls: 0, inputTokens: 0, outputTokens: 0, errors: 0, lastUpdated: null };
  const raw = await env.CONNECTOR_HEALTH.get(`ai-usage:${providerId}`, "json");
  return raw || { calls: 0, inputTokens: 0, outputTokens: 0, errors: 0, lastUpdated: null };
}

function recordAiUsage(env, ctx, providerId, delta) {
  if (!env?.CONNECTOR_HEALTH || !ctx) return;
  ctx.waitUntil((async () => {
    try {
      const usage = await getAiUsage(env, providerId);
      usage.calls += delta.calls || 0;
      usage.inputTokens += delta.inputTokens || 0;
      usage.outputTokens += delta.outputTokens || 0;
      usage.errors += delta.errors || 0;
      usage.lastUpdated = new Date().toISOString();
      await env.CONNECTOR_HEALTH.put(`ai-usage:${providerId}`, JSON.stringify(usage));
    } catch {
      // Usage tracking is best-effort; never let it break analysis.
    }
  })());
}

// Sorts a fetch failure into a bucket so health tracking (and the circuit
// breaker) can tell "flaky" (timeout) from "blocked" (403) from
// "rate-limited" (429) from a plain upstream server error (5xx), instead of
// lumping every failure together. Returns null for a successful result
// (nothing to classify).
function classifyError(message) {
  if (!message) return null;
  if (/aborted/i.test(message)) return "timeout";
  if (/HTTP 403/.test(message)) return "forbidden";
  if (/HTTP 429/.test(message)) return "rateLimited";
  if (/HTTP 5\d\d/.test(message)) return "serverError";
  return "otherError";
}

// ---------------------------------------------------------------------------
// Connector health + circuit breaker (Cloudflare KV, best-effort)
// ---------------------------------------------------------------------------

async function getHealthRecord(env, id) {
  if (!env?.CONNECTOR_HEALTH) return null;
  const raw = await env.CONNECTOR_HEALTH.get(`health:${id}`, "json");
  return raw || {
    total: 0, success: 0, timeout: 0, forbidden: 0, rateLimited: 0, serverError: 0, otherError: 0,
    latencySumMs: 0, latencyCount: 0, consecutiveFailures: 0, circuitOpenUntil: 0,
    lastUpdated: null, lastError: null
  };
}

function isCircuitOpen(record) {
  return !!record && record.circuitOpenUntil > Date.now();
}

// Fire-and-forget (scheduled via ctx.waitUntil) so recording health never
// adds latency to the response the user is waiting on.
function recordOutcome(env, ctx, id, outcome, latencyMs, errorMessage) {
  if (!env?.CONNECTOR_HEALTH || !ctx) return;
  ctx.waitUntil((async () => {
    try {
      const record = await getHealthRecord(env, id);
      record.total++;
      if (outcome === "success") {
        record.success++;
        record.consecutiveFailures = 0;
        record.circuitOpenUntil = 0;
      } else {
        record[outcome] = (record[outcome] || 0) + 1;
        record.consecutiveFailures++;
        record.lastError = errorMessage || outcome;
        if (record.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
          record.circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
        }
      }
      if (latencyMs != null) { record.latencySumMs += latencyMs; record.latencyCount++; }
      record.lastUpdated = new Date().toISOString();
      await env.CONNECTOR_HEALTH.put(`health:${id}`, JSON.stringify(record));
    } catch {
      // Health tracking is best-effort; never let it break search.
    }
  })());
}

// ---------------------------------------------------------------------------
// Brief provider-level result cache (success only)
// ---------------------------------------------------------------------------

async function getCachedProviderResult(providerId, cacheParams) {
  const hit = await caches.default.match(new Request(`https://cache.internal/archive/${providerId}?${cacheParams}`));
  return hit ? hit.json() : null;
}

function putCachedProviderResult(ctx, providerId, cacheParams, payload) {
  if (!ctx) return;
  const response = new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json", "cache-control": `public, max-age=${PROVIDER_CACHE_TTL_S}` }
  });
  ctx.waitUntil(caches.default.put(new Request(`https://cache.internal/archive/${providerId}?${cacheParams}`), response));
}

// A default User-Agent matters here: web.archive.org's CDX endpoint rejects
// requests with no User-Agent at the nginx layer with a bare 400, before the
// query is ever parsed - Cloudflare Workers' fetch() sends none by default.
// Identifies Chronium honestly to these public archive APIs (a descriptive
// UA is standard etiquette for API consumers) rather than spoofing a browser.
const DEFAULT_HEADERS = {
  "user-agent": "ChroniumMind/0.2 (+https://chronium-mind.truewolfflix777.workers.dev; research tool, not a browser)",
  "accept-language": "en-US,en;q=0.9"
};

async function fetchWithTimeout(url, ms, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { ...init, headers: { ...DEFAULT_HEADERS, ...init.headers }, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

// One retry, timeout only - a definitive HTTP error (400/403/429/5xx) means
// the server actually answered and won't change its mind a moment later, so
// only a genuine timeout (AbortError) is worth retrying. Short random jitter
// before the retry avoids hitting the same possibly-overloaded endpoint at
// the exact same instant a second time.
async function fetchResilient(url, ms, init = {}) {
  try {
    return await fetchWithTimeout(url, ms, init);
  } catch (e) {
    if (e?.name !== "AbortError") throw e;
    await sleep(150 + Math.floor(Math.random() * 250));
    return await fetchWithTimeout(url, ms, init);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
