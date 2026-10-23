// Deep Discovery: every limit in one place. Defaults are the approved
// provisional maximums (docs/DEEP_DISCOVERY_PLAN.md); HARD_CEILINGS cannot be
// exceeded by any configuration. Limits are safety ceilings, not targets.
// Pure module: runs in the browser, the extension, the Worker, and Node.

export const ENGINE_VERSION = '0.2.0-phase1';
export const USER_AGENT_TOKEN = 'ChroniumMind';
export const USER_AGENT = `${USER_AGENT_TOKEN}/0.1 (+https://chronium-mind.truewolfflix777.workers.dev/crawler; public-records research; honors robots.txt and Crawl-delay)`;

const MB = 1024 * 1024;

// No setting, caller, or future premium plan may raise a limit past these
// without a code change reviewed against the access rules.
export const HARD_CEILINGS = Object.freeze({
  maxDepth: 4,
  maxPages: 500,
  maxDocuments: 300,
  maxRunsPerDay: 10,
  maxWebsiteFetches: 50,
  maxTotalRequests: 1200,
  maxRedirects: 5,
  maxResponseBytes: 25 * MB,
  maxHtmlBytes: 5 * MB,
  maxTotalBytes: 1024 * MB,
  maxRunMs: 6 * 3600 * 1000,
  maxConcurrentTotal: 2,
  maxRequestsPerHostPerDay: 800,
  requestTimeoutMs: 60000,
  maxRobotsBytes: 512 * 1024,
  maxLinksPerPage: 2000,
  maxAcceptedCrawlDelayMs: 120000,
  maxArchiveLookups: 100
});

// Approved provisional maximums: depth 2, 150 pages, 100 documents, 3 runs a
// day, 25 website-mode fetches.
export const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 2,
  maxPages: 150,
  maxDocuments: 100,
  maxRunsPerDay: 3,
  maxWebsiteFetches: 25,
  maxTotalRequests: 400,
  maxRedirects: 3,
  maxResponseBytes: 10 * MB,
  maxHtmlBytes: 2 * MB,
  maxTotalBytes: 300 * MB,
  maxRunMs: 3 * 3600 * 1000,
  maxConcurrentTotal: 1,
  maxRequestsPerHostPerDay: 500, // under the 1,000-pages-a-day figure in the CivicPlus terms
  requestTimeoutMs: 20000,
  maxRobotsBytes: 512 * 1024,
  maxLinksPerPage: 1000,
  maxAcceptedCrawlDelayMs: 60000, // a host that asks for more than this is reported as too slow to search, never sped up
  maxArchiveLookups: 25,          // lookups for archived copies of documents that could not be retrieved (each is one Worker request)
  minDelayMs: 3000                // politeness floor when a host states no Crawl-delay
});

const MINIMUMS = { maxDepth: 0, maxPages: 1, maxDocuments: 0, maxRunsPerDay: 1, maxWebsiteFetches: 1, maxTotalRequests: 1, maxRedirects: 0, maxResponseBytes: 1024, maxHtmlBytes: 1024, maxTotalBytes: 1024, maxRunMs: 1000, maxConcurrentTotal: 1, maxRequestsPerHostPerDay: 1, requestTimeoutMs: 100, maxRobotsBytes: 1024, maxLinksPerPage: 1, maxAcceptedCrawlDelayMs: 1000, maxArchiveLookups: 0, minDelayMs: 0 };

// Merges overrides over the defaults and clamps every number into
// [minimum, hard ceiling]. Unknown keys are ignored. `clamped` lists what was
// changed so a caller can tell the user why a requested value was reduced.
export function resolveLimits(overrides = {}) {
  const out = {};
  const clamped = [];
  for (const [k, def] of Object.entries(DEFAULT_LIMITS)) {
    let v = Object.prototype.hasOwnProperty.call(overrides, k) ? Number(overrides[k]) : def;
    if (!Number.isFinite(v)) v = def;
    const min = MINIMUMS[k] ?? 0;
    const max = HARD_CEILINGS[k] ?? Infinity;
    const c = Math.min(Math.max(Math.floor(v), min), max);
    if (c !== v && Object.prototype.hasOwnProperty.call(overrides, k)) clamped.push({ key: k, requested: overrides[k], used: c });
    out[k] = c;
  }
  return Object.freeze({ ...out, clamped: Object.freeze(clamped) });
}
