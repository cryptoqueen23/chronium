import corpus from "../data/copperas-cove/normalized.json";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=60"
};

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
      return result;
    } catch (e) {
      if (env && ctx) {
        recordOutcome(env, ctx, this.id, classifyError(e?.message) || "otherError", Date.now() - started, e?.message);
      }
      return {
        source: this.label,
        capability: this.capabilities.join(" + "),
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
      return json(await checkLink(target));
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
        connectors: payloads.map(({ source, capability, ok, error, count, note, skipped }) => ({
          source, capability, ok, error: error || null, count: count || 0, note: note || null, skipped: !!skipped
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
      source, capability: "local investigation corpus (keyword match)", ok: true,
      count: results.length, results,
      note: "Searches a locally bundled, previously harvested investigation dataset, not a live crawl."
    };
  } catch (e) {
    return { source, capability: "local investigation corpus", ok: false, error: e.message, count: 0, results: [] };
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

// Collapses multiple archives' captures of the same underlying page (same
// originalUrl) into one result row: the most recent capture is shown, the
// rest become alternateArchiveUrls for the frontend's click-time fallback.
// Runs after dedupe() (which only removes exact same-source repeats), so
// this is specifically the cross-archive merge.
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
    const alternateArchiveUrls = [...new Set(rest.map((c) => c.archiveUrl).filter((u) => u && u !== primary.archiveUrl))];
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
