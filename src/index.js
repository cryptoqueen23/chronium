import corpus from "../data/copperas-cove/normalized.json";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=60"
};

const LOCAL_CORPORA = [
  { id: "copperas-cove", label: "Copperas Cove Investigation Corpus", data: corpus }
];

// Formalizes the connector contract from docs/ARCHITECTURE.md. A provider's search()
// NEVER rejects/throws — it always resolves to the {source, capability, ok, count,
// results, note} shape the API has always returned, even if its own implementation
// has a bug. That's what keeps one archive being down from breaking federated search;
// each provider already has its own try/catch, this is defense in depth around it.
class ArchiveProvider {
  constructor({ id, label, capabilities, run }) {
    this.id = id;
    this.label = label;
    this.capabilities = capabilities; // e.g. ['full-text', 'url-history']
    this.run = run; // async (query, { limit, mode }) => same payload shape as before
  }

  supports(capability) {
    return this.capabilities.includes(capability);
  }

  async search(query, options) {
    try {
      return await this.run(query, options);
    } catch (e) {
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
  new ArchiveProvider({ id: "commoncrawl", label: "Common Crawl", capabilities: ["url-history"], run: searchCommonCrawl })
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "Chronium Mind", version: "0.2.0" });
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
      const options = { limit, mode };

      const arquivo = ARCHIVE_PROVIDERS.find((p) => p.id === "arquivo");
      const jobs = [arquivo.search(q, options), searchLocalCorpora(q, limit)];

      // Wayback and Common Crawl CDX are URL/capture indexes, not global full-text engines;
      // only query them in URL mode. Each is an independent provider — one being down
      // (or slow, or rate-limited) never blocks the others, per ArchiveProvider.search().
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

      const results = dedupe(payloads.flatMap((p) => p.results || []))
        .sort((a, b) => String(b.captureDate || "").localeCompare(String(a.captureDate || "")))
        .slice(0, limit * 3);

      const response = json({
        query: q,
        mode,
        tookMs: Date.now() - started,
        total: results.length,
        connectors: payloads.map(({ source, capability, ok, error, count, note }) => ({
          source, capability, ok, error: error || null, count: count || 0, note: note || null
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

    const res = await fetchWithTimeout(endpoint, 8000, { headers: { accept: "application/json" } });
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

async function searchWayback(query, { limit }) {
  const source = "Wayback Machine";
  try {
    const target = normalizeTarget(query);
    const api = new URL("https://web.archive.org/cdx/search/cdx");
    api.searchParams.set("url", `${target}/*`);
    api.searchParams.set("output", "json");
    api.searchParams.set("fl", "timestamp,original,statuscode,mimetype,digest");
    api.searchParams.append("filter", "statuscode:200");
    api.searchParams.set("collapse", "digest");
    api.searchParams.set("limit", String(Math.min(limit, 50)));

    // 12s not 8s: the CDX endpoint is noticeably slower now that requests
    // reach the app layer at all (see the missing-User-Agent fix above) -
    // it was previously rejecting everything instantly at the nginx layer.
    const res = await fetchWithTimeout(api.toString(), 12000, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    if (!text.trim()) {
      return { source, capability: "URL/capture index", ok: true, count: 0, results: [],
        note: "Wayback CDX indexes URLs and captures; it is not a global full-text topic search API." };
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
    return { source, capability: "URL/capture index", ok: true, count: results.length, results,
      note: "Wayback CDX indexes URLs and captures; it is not a global full-text topic search API." };
  } catch (e) {
    return { source, capability: "URL/capture index", ok: false, error: e.message, count: 0, results: [] };
  }
}

async function searchCommonCrawl(query, { limit }) {
  const source = "Common Crawl";
  try {
    const target = normalizeTarget(query);
    const collectionsRes = await fetchWithTimeout("https://index.commoncrawl.org/collinfo.json", 6000);
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
      const res = await fetchWithTimeout(endpoint.toString(), 7000, { headers: { accept: "application/x-ndjson,application/json" } });
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

    return { source, capability: "URL/capture index", ok: true, count: results.length, results,
      note: "MVP searches the latest 3 Common Crawl monthly indexes for URL/domain queries." };
  } catch (e) {
    return { source, capability: "URL/capture index", ok: false, error: e.message, count: 0, results: [] };
  }
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
