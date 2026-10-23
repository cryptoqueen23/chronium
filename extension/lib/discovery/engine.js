// Deep Discovery engine: bounded, polite, resumable link discovery with full
// accounting. Phase 0 requests pages, extracts links, keeps a frontier inside
// depth/page/document limits and writes a ledger of everything it tried.
// Phase 1 adds document retrieval (opt-in per run), archived-copy lookups for
// documents that could not be retrieved, a classification hint per document,
// duplicate detection by content hash, and a checkpoint so a cancelled or
// stopped run can continue without repeating finished work.
//
// Guarantees (each is tested): robots.txt is obeyed including Crawl-delay,
// requests to one host are strictly serial and spaced, every redirect hop is a
// separate checked request, private and local addresses are never requested,
// hard ceilings stop the run with an honest "search incomplete", a source whose
// policy is not cleared is never contacted, cancellation and pause take effect
// before the next request, and a failed connection is never reported as
// "does not exist". Nothing here logs page text or user queries.
import { resolveLimits, ENGINE_VERSION, USER_AGENT_TOKEN } from './config.js';
import { checkUrl, checkRedirect } from './urlGuard.js';
import { RobotsPolicy, robotsUrlFor } from './robots.js';
import { HostScheduler, CancelledError, parseRetryAfter } from './scheduler.js';
import { extractLinks, metaRobots, Scope, Frontier, fileKind } from './links.js';
import { OUTCOME, classifyAttempt, combineAttempts, OUTCOME_LABEL } from './outcomes.js';
import { Ledger } from './ledger.js';
import { defaultHostPolicies, defaultConnectors } from './connector.js';
import { sha256Hex } from './fetchers.js';
import { classifyDocument } from './classify.js';

// File types retrieved when document retrieval is on. Anything else a page
// links to (json, xml, archives, media) stays a candidate address only.
export const DEFAULT_DOCUMENT_TYPES = Object.freeze(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'ppt', 'pptx', 'rtf', 'odt', 'ods', 'odp']);

const MAX_CONSECUTIVE_THROTTLES = 3;

export class MemoryStorage {
  #m = new Map();
  async get(k) { return this.#m.get(k) ?? null; }
  async set(k, v) { this.#m.set(k, v); }
}

// Per-day counters kept in the browser (any {get,set} storage): runs per day
// and requests per host per day. The day is the UTC date.
export class DailyBudget {
  constructor({ storage = new MemoryStorage(), now = () => Date.now(), key = 'chronium.discovery.budget' } = {}) { this.storage = storage; this.now = now; this.key = key; }
  #day() { return new Date(this.now()).toISOString().slice(0, 10); }
  async #load() { const d = this.#day(); const cur = await this.storage.get(this.key); return cur && cur.date === d ? cur : { date: d, runs: 0, hosts: {} }; }
  async beginRun(limit) {
    const cur = await this.#load();
    if (cur.runs >= limit) { const t = new Date(this.now()); const reset = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1)).toISOString(); return { ok: false, used: cur.runs, limit, resetAt: reset }; }
    cur.runs += 1; await this.storage.set(this.key, cur);
    return { ok: true, used: cur.runs, limit };
  }
  async hostCount(host) { return (await this.#load()).hosts[host] || 0; }
  async countRequest(host) { const cur = await this.#load(); cur.hosts[host] = (cur.hosts[host] || 0) + 1; await this.storage.set(this.key, cur); return cur.hosts[host]; }
}

const sec = (ms) => Math.round(ms / 1000);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export class DiscoveryRun {
  #o; #limits; #ledger; #sched; #frontier; #scope; #robots = new Map(); #blockedHosts = new Map(); #stoppedHosts = new Map();
  #state = 'idle'; #started = 0; #cancelled = false; #paused = false; #stopReason = null;
  #counters = { requests: 0, bytes: 0, pagesFetched: 0, websiteFetches: 0, redirects: 0, robotsFetches: 0 };
  #pages = []; #warnings = []; #lastMessage = ''; #resolveDone; #done;
  #docs = []; #docHashes = new Map(); #docsDone = new Set(); #docTotal = 0; #phase = 'pages'; #archiveLookups = 0;

  constructor(options) {
    const o = this.#o = {
      seeds: [], mode: 'extension', limits: {}, fetcher: null, hostPolicies: defaultHostPolicies(), connectors: defaultConnectors(),
      termsAcknowledged: [], now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), hash: sha256Hex,
      guardOptions: {}, scopeMode: 'registrable', allowDocumentHosts: [], budget: new DailyBudget(), onProgress: () => {}, runId: null, plannedSources: null,
      retrieveDocuments: false, onDocument: null, archiveLookup: null, resumeFrom: null, documentTypes: DEFAULT_DOCUMENT_TYPES,
      ...options
    };
    o.documentTypes = new Set(o.documentTypes);
    if (!o.fetcher) throw new Error('A fetcher is required');
    this.#limits = resolveLimits(o.limits);
    this.runId = o.runId || `run-${o.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.#ledger = new Ledger({ runId: this.runId, now: o.now });
    this.#sched = new HostScheduler({ now: o.now, sleep: o.sleep, maxConcurrent: this.#limits.maxConcurrentTotal, defaultDelayMs: this.#limits.minDelayMs });
    this.#done = new Promise((r) => { this.#resolveDone = r; });
  }

  get limits() { return this.#limits; }
  get ledger() { return this.#ledger; }
  get state() { return this.#state; }
  get stats() { return { ...this.#counters }; }

  pause() { if (this.#state === 'running' || this.#state === 'preparing') { this.#paused = true; this.#sched.pause(); this.#setState('paused', 'Paused. Nothing more will be requested until you resume.'); } }
  resume() { if (this.#state === 'paused') { this.#paused = false; this.#sched.resume(); this.#setState('running', this.#runningMessage()); } }
  cancel() { if (['finished', 'cancelled', 'refused', 'idle'].includes(this.#state)) return; this.#cancelled = true; this.#sched.cancel(); }
  whenDone() { return this.#done; }

  progress() {
    const f = this.#frontier;
    const remaining = f ? f.pagesRemaining : 0;
    const host = this.#currentHost || '';
    const delay = host ? this.#sched.delayFor(host) : this.#limits.minDelayMs;
    return {
      state: this.#state, message: this.#lastMessage,
      pagesFetched: this.#counters.pagesFetched, pagesRemaining: remaining, pagesPlanned: f ? f.pagesQueued : 0,
      documentsFound: f ? f.docs.length : 0, documentsRetrieved: this.#docs.filter((d) => d.outcome === OUTCOME.FOUND || d.outcome === OUTCOME.PARTIAL).length,
      historicalCopies: this.#docs.filter((d) => d.outcome === OUTCOME.HISTORICAL_COPY_FOUND).length,
      documentsUnavailable: this.#docs.filter((d) => [OUTCOME.SOURCE_UNAVAILABLE, OUTCOME.ACCESS_RESTRICTED, OUTCOME.SEARCH_INCOMPLETE].includes(d.outcome)).length,
      documentsNotLocated: this.#docs.filter((d) => d.outcome === OUTCOME.NOT_LOCATED).length,
      documentsPlanned: this.#docTotal, documentsDone: this.#docs.length, phase: this.#phase, requests: this.#counters.requests, requestsMax: this.#limits.maxTotalRequests,
      bytes: this.#counters.bytes, bytesMax: this.#limits.maxTotalBytes, elapsedMs: this.#started ? this.#o.now() - this.#started : 0,
      etaMs: remaining * delay, waitingMs: host ? this.#sched.waitingMs(host) : 0, host
    };
  }
  #currentHost = '';
  #runningMessage() {
    const p = this.progress();
    const wait = p.waitingMs > 1000 ? ` Waiting ${plural(sec(p.waitingMs), 'second')} before the next request to ${p.host} (the site asks for this).` : '';
    if (p.phase === 'documents') return `Retrieving documents: ${p.documentsDone} of ${p.documentsPlanned} done, ${p.documentsRetrieved} retrieved.${wait}`;
    if (p.pagesFetched === 0) return `Requesting the first page from ${p.host || 'the site'}.${wait}`;
    return `Fetched ${p.pagesFetched} of about ${p.pagesPlanned} pages; found ${plural(p.documentsFound, 'document link')}.${wait}`;
  }
  #setState(state, message) { this.#state = state; this.#lastMessage = message; try { this.#o.onProgress(this.progress()); } catch { /* UI errors never affect the run */ } }
  #emitRunning() { this.#lastMessage = this.#runningMessage(); try { this.#o.onProgress(this.progress()); } catch { /* ignore */ } }

  // ---- limits ----
  #limitHit() {
    const l = this.#limits; const c = this.#counters;
    if (c.requests >= l.maxTotalRequests) return 'the request limit for one run';
    if (this.#o.mode === 'website' && c.websiteFetches >= l.maxWebsiteFetches) return 'the limit for runs started from the website';
    if (c.bytes >= l.maxTotalBytes) return 'the download size limit for one run';
    if (this.#started && this.#o.now() - this.#started >= l.maxRunMs) return 'the time limit for one run';
    return null;
  }

  // ---- one request through the scheduler ----
  async #request(url, { action, isSeed = false, maxBytes }) {
    const u = new URL(url); const host = u.hostname.toLowerCase();
    const hit = this.#limitHit();
    if (hit) { this.#stopReason ||= hit; return { skipped: true, outcome: OUTCOME.SEARCH_INCOMPLETE, reason: 'limit-reached', host }; }
    const hostCount = await this.#o.budget.hostCount(host);
    if (hostCount >= this.#limits.maxRequestsPerHostPerDay) { this.#stopReason ||= `the daily request limit for ${host}`; return { skipped: true, outcome: OUTCOME.SEARCH_INCOMPLETE, reason: 'host-daily-limit', host }; }
    this.#currentHost = host;
    let res;
    try {
      res = await this.#sched.run(host, async ({ signal }) => {
        this.#counters.requests += 1;
        if (this.#o.mode === 'website') this.#counters.websiteFetches += 1;
        await this.#o.budget.countRequest(host);
        return this.#o.fetcher.fetch(url, { signal, timeoutMs: this.#limits.requestTimeoutMs, maxBytes: maxBytes ?? this.#limits.maxResponseBytes, isSeed });
      });
    } catch (e) {
      if (e instanceof CancelledError || e?.name === 'CancelledError') return { cancelled: true, outcome: OUTCOME.SEARCH_INCOMPLETE, reason: 'cancelled', host };
      res = { status: null, headers: {}, url, redirected: false, body: null, bytes: 0, truncated: false, error: { code: 'network' } };
    }
    this.#counters.bytes += res.bytes || 0;
    const status = res.status;
    if (status === 429 || status === 503) {
      const t = this.#sched.reportThrottle(host, parseRetryAfter(res.headers?.['retry-after'], this.#o.now()));
      if (t.consecutive >= MAX_CONSECUTIVE_THROTTLES) this.#stoppedHosts.set(host, `the site kept answering "slow down" (HTTP ${status}) ${t.consecutive} times in a row`);
    } else if (status !== null && status < 500) this.#sched.reportSuccess(host);
    return { res, host, status };
  }

  async #policyFor(url) {
    const origin = new URL(url).origin;
    if (!this.#robots.has(origin)) {
      this.#robots.set(origin, (async () => {
        const rurl = robotsUrlFor(url);
        const host = new URL(url).hostname.toLowerCase();
        const r = await this.#request(rurl, { action: 'robots', maxBytes: this.#limits.maxRobotsBytes });
        if (r.skipped || r.cancelled) return null;
        const res = r.res;
        this.#counters.robotsFetches += 1;
        let text = '';
        if (res.body) text = new TextDecoder('utf-8', { fatal: false }).decode(res.body);
        const policy = RobotsPolicy.fromResponse({ status: res.status, body: text, truncated: res.truncated, error: res.error }, { token: USER_AGENT_TOKEN, origin, now: this.#o.now(), maxBytes: this.#limits.maxRobotsBytes });
        const eff = policy.effectiveDelay(this.#limits);
        this.#sched.setDelay(host, eff.delayMs);
        this.#ledger.record({ sourceId: this.#sourceIdFor(host), url: rurl, host, action: 'robots', outcome: policy.state === 'parsed' || policy.state === 'absent' ? OUTCOME.FOUND : (policy.state === 'restricted' ? OUTCOME.ACCESS_RESTRICTED : OUTCOME.SOURCE_UNAVAILABLE), reason: `robots-${policy.state}`, httpStatus: res.status ?? undefined, bytes: res.bytes, robots: policy.state, fetcher: this.#o.mode, delayMs: eff.delayMs, note: eff.stated !== null ? `site asks for ${sec(eff.stated)} s between requests${eff.tooSlow ? ' (more than this tool will wait)' : ''}` : (policy.detail || undefined) });
        if (eff.tooSlow) this.#stoppedHosts.set(host, `the site asks for ${sec(eff.stated)} seconds between requests, which is more than this tool will wait; the delay is never shortened`);
        return policy;
      })());
    }
    return this.#robots.get(origin);
  }

  #sourceIdFor(host) { return `host:${host}`; }

  // Default planned sources for the coverage table: one per seed host.
  plannedSources() {
    if (this.#o.plannedSources) return this.#o.plannedSources;
    const hosts = [...new Set(this.#o.seeds.map((s) => { try { return new URL(s).hostname.toLowerCase(); } catch { return null; } }).filter(Boolean))];
    const list = hosts.map((h) => ({ id: this.#sourceIdFor(h), label: `Official website: ${h}`, kind: 'official-website' }));
    // Listed only when archives were actually consulted: otherwise "not checked yet" would suggest a gap that is not one.
    if (this.#archiveLookups > 0) list.push({ id: 'archives', label: 'Web archives (historical copies of documents that could not be retrieved)', kind: 'web-archive' });
    return list;
  }

  // ---- the run ----
  async start() {
    if (this.#state !== 'idle') return this.#done;
    this.#started = this.#o.now();
    const result = await this.#execute().catch((e) => ({ state: 'error', error: String(e && e.message || e) }));
    this.#resolveDone(result);
    return result;
  }

  async #execute() {
    const o = this.#o; const l = this.#limits;
    this.#setState('preparing', 'Preparing the run.');
    // Continuing an earlier run is not a new run: the per-host daily request ceiling still applies.
    const b = o.resumeFrom ? { ok: true } : await o.budget.beginRun(l.maxRunsPerDay);
    if (!b.ok) {
      this.#setState('refused', `Daily limit reached: ${l.maxRunsPerDay} runs per day. Try again after ${b.resetAt.slice(0, 10)} (UTC).`);
      return this.#finish('refused', { refusal: 'daily-run-limit' });
    }
    // Seeds: safe, allowed by host policy, acknowledged where needed.
    const seeds = [];
    for (const s of o.seeds) {
      const g = checkUrl(s, o.guardOptions);
      if (!g.ok) { this.#ledger.record({ url: String(s).slice(0, 200), host: '', action: 'skip', outcome: OUTCOME.ACCESS_RESTRICTED, reason: `unsafe-address:${g.reason}`, note: g.detail }); continue; }
      const host = g.url.hostname.toLowerCase();
      const d = o.hostPolicies.decide(host, { acknowledged: o.termsAcknowledged });
      if (!d.allowed) {
        this.#blockedHosts.set(host, d.reason);
        this.#ledger.record({ sourceId: this.#sourceIdFor(host), url: g.canonical, host, action: 'skip', outcome: OUTCOME.ACCESS_RESTRICTED, reason: d.automation === 'unverified' || d.automation === 'link-only' || d.automation === 'forbidden' ? `policy-${d.automation}` : 'policy', note: `no automated request was made: ${d.reason}` });
        continue;
      }
      if (d.automation === 'acknowledged') this.#ledger.record({ sourceId: this.#sourceIdFor(host), url: g.canonical, host, action: 'skip', outcome: undefined, reason: 'acknowledged', note: 'the user confirmed they have read this site\'s terms for this run' });
      seeds.push(g.canonical);
    }
    if (!seeds.length) {
      this.#setState('finished', 'Nothing was requested: no address was cleared for automated access. See the coverage list for the reason.');
      return this.#finish('finished', { nothingRequested: true });
    }
    this.#scope = new Scope({ seeds, mode: o.scopeMode, allowHosts: o.allowDocumentHosts });
    this.#frontier = new Frontier({ limits: l, scope: this.#scope, guardOptions: o.guardOptions });
    const connector = o.connectors.forUrl(seeds[0]);
    if (o.resumeFrom) { this.#frontier.restore(o.resumeFrom); for (const u of o.resumeFrom.docsDone || []) this.#docsDone.add(u); }
    for (const s of seeds) this.#frontier.add({ url: s, depth: 0, isSeed: true });
    // A connector may know extra listing addresses; they are used only for hosts the registry explicitly clears (never on an acknowledgment alone).
    if (connector && typeof connector.listingCalls === 'function') {
      for (const s of seeds) {
        if (o.hostPolicies.decide(new URL(s).hostname.toLowerCase(), { acknowledged: [] }).automation !== 'allowed') continue;
        for (const c of connector.listingCalls([s]) || []) if (!c.method || c.method === 'GET') this.#frontier.add({ url: c.url, depth: 1, parent: s, text: '(listing)' });
      }
    }
    this.#setState('running', 'Starting.');

    let page;
    while ((page = this.#frontier.nextPage())) {
      if (this.#cancelled) { this.#frontier.cursor--; break; }
      const host = new URL(page.url).hostname.toLowerCase();
      if (this.#stoppedHosts.has(host)) { this.#ledger.record({ sourceId: this.#sourceIdFor(host), url: page.url, host, action: 'page', outcome: OUTCOME.SOURCE_UNAVAILABLE, reason: 'host-stopped', note: this.#stoppedHosts.get(host) }); continue; }
      // robots.txt first (one request per host, through the same scheduler).
      const policy = await this.#policyFor(page.url);
      if (this.#cancelled) { this.#frontier.cursor--; break; }
      if (!policy) { if (this.#stopReason) { this.#frontier.cursor--; break; } continue; }
      if (this.#stoppedHosts.has(host)) { this.#ledger.record({ sourceId: this.#sourceIdFor(host), url: page.url, host, action: 'page', outcome: OUTCOME.SEARCH_INCOMPLETE, reason: 'host-stopped', note: this.#stoppedHosts.get(host) }); continue; }
      const verdict = policy.evaluate(page.url, { isSeed: page.isSeed });
      if (!verdict.allowed) { this.#ledger.record({ sourceId: this.#sourceIdFor(host), url: page.url, host, action: 'page', outcome: OUTCOME.ACCESS_RESTRICTED, reason: verdict.reason, robots: 'disallowed', note: verdict.rule || undefined }); continue; }
      if (verdict.warning) this.#warnings.push(verdict.warning);
      if (this.#limitHit()) { this.#stopReason ||= this.#limitHit(); this.#frontier.cursor--; break; }
      this.#emitRunning();
      const r = await this.#request(page.url, { action: 'page', isSeed: page.isSeed, maxBytes: l.maxHtmlBytes });
      if (r.cancelled) { this.#frontier.cursor--; break; }
      if (r.skipped) { this.#frontier.cursor--; break; }
      await this.#handlePage(page, r, policy, connector);
      this.#emitRunning();
    }

    if (o.retrieveDocuments && !this.#cancelled && !this.#stopReason) await this.#retrieveDocuments(connector);

    return this.#conclude();
  }

  async #handlePage(page, r, policy, connector) {
    const { res, host } = r; const o = this.#o; const l = this.#limits;
    const src = this.#sourceIdFor(host);
    const base = { sourceId: src, url: page.url, host, action: 'page', httpStatus: res.status ?? undefined, bytes: res.bytes, robots: 'allowed', fetcher: o.mode };
    // Redirects: each hop is its own checked, scheduled, robots-evaluated request.
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      const hops = (page.hops || 0) + 1;
      const cr = checkRedirect({ from: page.url, location: res.headers.location, hop: hops, maxRedirects: l.maxRedirects }, o.guardOptions);
      this.#counters.redirects += 1;
      if (!cr.ok) { this.#ledger.record({ ...base, ...classifyAttempt({ redirectBlocked: true }), reason: cr.reason, note: cr.detail }); return; }
      // A redirect target is NOT a seed: it must pass the scope check and robots like any other address.
      const added = this.#frontier.add({ url: cr.url.href, depth: page.depth, parent: page.url, text: '(redirect)', isSeed: false });
      if (added.accepted && added.kind === 'page') { const q = this.#frontier.pages[this.#frontier.pages.length - 1]; q.hops = hops; }
      this.#ledger.record({ ...base, outcome: undefined, reason: 'redirect', note: added.accepted ? `followed as a new request: ${cr.canonical}` : `redirect target not followed (${added.reason}): ${cr.canonical}` });
      return;
    }
    // Fetchers that follow redirects themselves: validate the final address afterwards.
    if (res.redirected && res.url && res.url !== page.url) {
      const g = checkUrl(res.url, o.guardOptions);
      const sc = g.ok ? this.#scope.check(g.canonical) : { ok: false };
      if (!g.ok || !sc.ok) { this.#ledger.record({ ...base, ...classifyAttempt({ redirectBlocked: true }), note: `the page redirected to an address that is not allowed (${g.ok ? 'outside the search area' : g.reason}); its content was discarded` }); return; }
      const rv = policy.evaluate(g.canonical);
      if (!rv.allowed && new URL(g.canonical).hostname.toLowerCase() === host) { this.#ledger.record({ ...base, ...classifyAttempt({ robotsBlocked: true }), reason: 'redirect-robots', note: 'the page redirected to a path robots.txt disallows; its content was discarded' }); return; }
    }
    const att = classifyAttempt({ status: res.status, error: res.error, truncated: res.truncated });
    const entry = { ...base, ...att };
    if (res.status >= 200 && res.status < 300 && res.body) {
      this.#counters.pagesFetched += 1;
      const ct = res.headers['content-type'] || '';
      const hash = await o.hash(res.body);
      this.#pages.push({ originalUrl: page.url, finalUrl: res.url || page.url, retrievedAt: new Date(o.now()).toISOString(), httpStatus: res.status, contentType: ct, bytes: res.bytes, sha256: hash, etag: res.headers.etag || null, lastModified: res.headers['last-modified'] || null, partial: !!res.truncated, discovery: { runId: this.runId, parentUrl: page.parent, linkText: page.text, depth: page.depth, robots: 'allowed' }, fetcher: o.mode, engineVersion: ENGINE_VERSION, outcome: att.outcome });
      entry.note = `sha256 ${hash.slice(0, 12)}…`;
      const kind = fileKind(page.url, ct).kind;
      const xrobots = (res.headers['x-robots-tag'] || '').toLowerCase();
      if (kind === 'page' && !/\bnofollow\b|\bnone\b/.test(xrobots)) {
        const html = new TextDecoder('utf-8', { fatal: false }).decode(res.body);
        const meta = metaRobots(html);
        if (meta.nofollow) entry.note += '; page asks not to be followed (nofollow), links not used';
        else {
          const raw = extractLinks(html, res.url || page.url, { maxLinks: l.maxLinksPerPage });
          const links = connector ? connector.expandPage({ url: page.url, depth: page.depth, links: raw }) : raw;
          let pa = 0, da = 0;
          for (const k of links) { const a = this.#frontier.add({ url: k.href, depth: page.depth + 1, parent: page.url, text: k.text }); if (a.accepted) { if (a.kind === 'page') pa++; else da++; } }
          entry.note += `; ${plural(links.length, 'link')} found, ${plural(pa, 'page')} and ${plural(da, 'document')} queued${links.length === 0 ? ' (no links: the page may build its list with JavaScript, which is not run)' : ''}`;
        }
      } else if (kind === 'document') entry.note += '; a document: recorded as a candidate only';
    }
    this.#ledger.record(entry);
  }

  // ---- Phase 1: documents ----

  // Everything that must be true before one address may be requested: safe
  // address, host policy, host not stopped, robots.txt allows it.
  async #gate(url, { isSeed = false } = {}) {
    const o = this.#o;
    const g = checkUrl(url, o.guardOptions);
    if (!g.ok) return { ok: false, outcome: OUTCOME.ACCESS_RESTRICTED, reason: `unsafe-address:${g.reason}`, note: g.detail };
    const host = g.url.hostname.toLowerCase();
    const d = o.hostPolicies.decide(host, { acknowledged: o.termsAcknowledged });
    if (!d.allowed) return { ok: false, host, outcome: OUTCOME.ACCESS_RESTRICTED, reason: `policy-${d.automation}`, note: `no automated request was made: ${d.reason}` };
    if (this.#stoppedHosts.has(host)) return { ok: false, host, outcome: OUTCOME.SOURCE_UNAVAILABLE, reason: 'host-stopped', note: this.#stoppedHosts.get(host) };
    const policy = await this.#policyFor(g.canonical);
    if (!policy) return { ok: false, host, interrupted: true };
    if (this.#stoppedHosts.has(host)) return { ok: false, host, outcome: OUTCOME.SEARCH_INCOMPLETE, reason: 'host-stopped', note: this.#stoppedHosts.get(host) };
    const v = policy.evaluate(g.canonical, { isSeed });
    if (!v.allowed) return { ok: false, host, outcome: OUTCOME.ACCESS_RESTRICTED, reason: v.reason, robots: 'disallowed', note: v.rule || undefined };
    return { ok: true, url: g.canonical, host, policy };
  }

  async #retrieveDocuments() {
    const f = this.#frontier;
    const todo = f.docs.filter((d) => !this.#docsDone.has(d.url));
    this.#docTotal = todo.length; this.#phase = 'documents';
    this.#emitRunning();
    for (const d of todo) {
      if (this.#cancelled) break;
      const hit = this.#limitHit(); if (hit) { this.#stopReason ||= hit; break; }
      if (!this.#o.documentTypes.has(d.ext)) {
        const h = new URL(d.url).hostname.toLowerCase();
        this.#ledger.record({ sourceId: this.#sourceIdFor(h), url: d.url, host: h, action: 'skip', reason: 'type-not-retrieved', note: `.${d.ext} files are recorded as addresses only` });
        this.#docs.push(this.#docResult(d, { outcome: undefined, skipped: true, reason: 'type-not-retrieved', note: `.${d.ext} files are listed but not retrieved` }));
        this.#docsDone.add(d.url);
        continue;
      }
      const status = await this.#retrieveOne(d);
      if (status === 'cancelled' || status === 'limit') break;
      this.#docsDone.add(d.url);
      this.#emitRunning();
    }
    this.#phase = 'pages';
  }

  #docResult(d, extra = {}) {
    const cls = classifyDocument({ url: d.url, text: d.text, parentText: this.#parentText(d.parent) });
    return { url: d.url, ext: d.ext, linkText: d.text, parent: d.parent, depth: d.depth, classification: cls.class, classificationLabel: cls.label, classificationBasis: cls.basis, ...extra };
  }
  #parentText(parentUrl) { const p = this.#pages.find((x) => x.originalUrl === parentUrl); return p ? (p.discovery.linkText || '') : ''; }

  // One document, end to end. Returns 'done' | 'cancelled' | 'limit'.
  async #retrieveOne(d) {
    const o = this.#o; const l = this.#limits;
    let url = d.url; let hops = 0; let r; let gate;
    for (;;) {
      gate = await this.#gate(url);
      if (gate.interrupted) return this.#cancelled ? 'cancelled' : 'limit';
      if (!gate.ok) {
        const host = gate.host || '';
        this.#ledger.record({ sourceId: host ? this.#sourceIdFor(host) : undefined, url, host, action: 'document', outcome: gate.outcome, reason: gate.reason, robots: gate.robots, note: gate.note });
        this.#docs.push(this.#docResult(d, { outcome: gate.outcome, reason: gate.reason, note: gate.note }));
        return 'done';
      }
      r = await this.#request(gate.url, { action: 'document' });
      if (r.cancelled) return 'cancelled';
      if (r.skipped) return 'limit';
      const res = r.res;
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        hops += 1;
        const cr = checkRedirect({ from: gate.url, location: res.headers.location, hop: hops, maxRedirects: l.maxRedirects }, o.guardOptions);
        this.#counters.redirects += 1;
        const sc = cr.ok ? this.#scope.check(cr.canonical) : { ok: false, reason: cr.reason };
        if (!cr.ok || !sc.ok) {
          const why = cr.ok ? `the redirect leads outside the search area (${sc.reason})` : cr.detail;
          this.#ledger.record({ sourceId: this.#sourceIdFor(r.host), url: gate.url, host: r.host, action: 'document', httpStatus: res.status, outcome: OUTCOME.ACCESS_RESTRICTED, reason: cr.ok ? 'redirect-out-of-scope' : cr.reason, note: why });
          this.#docs.push(this.#docResult(d, { outcome: OUTCOME.ACCESS_RESTRICTED, reason: 'redirect-blocked', note: why, httpStatus: res.status }));
          return 'done';
        }
        this.#ledger.record({ sourceId: this.#sourceIdFor(r.host), url: gate.url, host: r.host, action: 'document', httpStatus: res.status, reason: 'redirect', note: `followed as a new request: ${cr.canonical}` });
        url = cr.url.href;
        continue;
      }
      break;
    }
    const res = r.res; const host = r.host; const src = this.#sourceIdFor(host);
    const base = { sourceId: src, url: gate.url, host, action: 'document', httpStatus: res.status ?? undefined, bytes: res.bytes, robots: 'allowed', fetcher: o.mode };
    // Fetchers that follow redirects themselves: validate the final address afterwards.
    if (res.redirected && res.url && res.url !== gate.url) {
      const g = checkUrl(res.url, o.guardOptions);
      const sc = g.ok ? this.#scope.check(g.canonical) : { ok: false };
      if (!g.ok || !sc.ok) {
        const note = `the address redirected to a place that is not allowed (${g.ok ? 'outside the search area' : g.reason}); its content was discarded`;
        this.#ledger.record({ ...base, ...classifyAttempt({ redirectBlocked: true }), note });
        this.#docs.push(this.#docResult(d, { outcome: OUTCOME.ACCESS_RESTRICTED, reason: 'redirect-blocked', note }));
        return 'done';
      }
    }
    const att = classifyAttempt({ status: res.status, error: res.error, truncated: res.truncated });
    const result = this.#docResult(d, { outcome: att.outcome, reason: att.reason, httpStatus: res.status ?? null, originalUrl: d.url, finalUrl: res.url || gate.url, redirects: hops, fetcher: o.mode, engineVersion: ENGINE_VERSION });
    const ct = (res.headers?.['content-type'] || '').toLowerCase();
    if (res.status >= 200 && res.status < 300 && res.body) {
      if (ct.includes('text/html')) {
        // A document address that answers with a web page is usually an error or sign-in page: not a document.
        result.outcome = OUTCOME.SOURCE_UNAVAILABLE; result.reason = 'returned-a-web-page'; result.note = 'the address returned a web page instead of the document (possibly an error or sign-in page); nothing was saved';
        this.#ledger.record({ ...base, outcome: result.outcome, reason: result.reason, note: result.note });
        this.#docs.push(result);
        return this.#maybeArchive(d, result);
      }
      const hash = await o.hash(res.body);
      Object.assign(result, { retrievedAt: new Date(o.now()).toISOString(), contentType: ct, contentLength: res.bytes, sha256: hash, etag: res.headers.etag || null, lastModified: res.headers['last-modified'] || null, partial: !!res.truncated });
      const first = this.#docHashes.get(hash);
      if (first) result.duplicateOf = first; else this.#docHashes.set(hash, gate.url);
      let note = `sha256 ${hash.slice(0, 12)}…${first ? `; same content as ${first}` : ''}${res.truncated ? '; cut off by the size limit, marked partial' : ''}`;
      if (o.onDocument) {
        try { await o.onDocument({ result, bytes: res.body }); }
        catch (e) { result.saveError = String(e && e.message || e).slice(0, 160); note += `; could not be saved: ${result.saveError}`; }
      }
      this.#ledger.record({ ...base, ...att, note });
      this.#docs.push(result);
      return 'done';
    }
    this.#ledger.record({ ...base, ...att });
    this.#docs.push(result);
    return this.#maybeArchive(d, result);
  }

  // A document that could not be retrieved (not found, or the source did not answer) gets one lookup
  // for archived copies. A restricted or blocked document is not looked up: that would route around the restriction.
  async #maybeArchive(d, result) {
    const o = this.#o; const l = this.#limits;
    if (!o.archiveLookup || ![OUTCOME.NOT_LOCATED, OUTCOME.SOURCE_UNAVAILABLE].includes(result.outcome)) return 'done';
    if (this.#cancelled) return 'cancelled';
    if (this.#archiveLookups >= l.maxArchiveLookups) { result.archive = { status: 'not-checked', copies: [], note: 'the limit on archive lookups for one run was reached' }; return 'done'; }
    this.#archiveLookups += 1;
    let found;
    try { found = await o.archiveLookup(d.url); } catch { found = { status: 'unavailable', copies: [] }; }
    const copies = Array.isArray(found?.copies) ? found.copies : [];
    const status = found?.status === 'found' && copies.length ? 'found' : found?.status === 'none' ? 'none' : 'unavailable';
    result.archive = { status, copies };
    const combined = combineAttempts([
      { source: 'original address', outcome: result.outcome },
      { source: 'web archives', archive: true, outcome: status === 'found' ? OUTCOME.FOUND : status === 'none' ? OUTCOME.NOT_LOCATED : OUTCOME.SOURCE_UNAVAILABLE }
    ]);
    const latest = copies.map((c) => c.captureDate).filter(Boolean).sort().pop() || 'date unknown';
    this.#ledger.record({
      sourceId: 'archives', url: d.url, host: 'web-archives', action: 'archive-lookup',
      outcome: status === 'found' ? OUTCOME.HISTORICAL_COPY_FOUND : status === 'none' ? OUTCOME.NOT_LOCATED : OUTCOME.SOURCE_UNAVAILABLE, reason: `archive-${status}`,
      note: status === 'found' ? `${plural(copies.length, 'archived copy')}; latest capture ${latest}` : status === 'none' ? 'the archives consulted have no copy of this address' : 'the archives could not be reached; nothing can be concluded'
    });
    result.originalOutcome = result.outcome; result.originalReason = result.reason;
    result.outcome = combined.outcome; result.reason = combined.reason;
    if (status === 'found' && o.onDocument) {
      try { await o.onDocument({ result, bytes: null }); } catch (e) { result.saveError = String(e && e.message || e).slice(0, 160); }
    }
    return 'done';
  }

  // What a later run needs to continue without repeating finished work.
  #checkpoint() {
    const f = this.#frontier;
    if (!f) return null;
    return {
      pagesDone: f.pages.slice(0, f.cursor).map((p) => p.url),
      pagesPending: f.pages.slice(f.cursor).map((p) => ({ url: p.url, depth: p.depth, parent: p.parent, text: p.text, isSeed: p.isSeed })),
      docCandidates: f.docs.map((d) => ({ url: d.url, depth: d.depth, parent: d.parent, text: d.text })),
      docsDone: [...this.#docsDone]
    };
  }

  #conclude() {
    const f = this.#frontier;
    const unfetched = f ? f.pagesRemaining : 0;
    let state; let message;
    if (this.#cancelled) {
      state = 'cancelled';
      this.#ledger.record({ action: 'run', outcome: OUTCOME.SEARCH_INCOMPLETE, reason: 'cancelled', note: `${plural(unfetched, 'queued page')} not requested` });
      message = `Cancelled. ${plural(this.#counters.pagesFetched, 'page')} fetched and ${plural(this.progress().documentsRetrieved, 'document')} retrieved before you stopped it. What was retrieved is kept. The search is incomplete, and can be continued.`;
    } else if (this.#stopReason) {
      state = 'stopped-at-limit';
      this.#ledger.record({ action: 'run', outcome: OUTCOME.SEARCH_INCOMPLETE, reason: 'limit-reached', note: `stopped at ${this.#stopReason}; ${plural(unfetched, 'queued page')} not requested` });
      const docsLeft = f ? f.docs.filter((d) => !this.#docsDone.has(d.url) && !this.#docs.some((x) => x.url === d.url)).length : 0;
      message = `Stopped at ${this.#stopReason}. ${plural(this.#counters.pagesFetched, 'page')} fetched; ${plural(unfetched, 'page')} found but not requested${this.#o.retrieveDocuments ? `; ${plural(docsLeft, 'document')} found but not retrieved` : ''}. The search is incomplete.`;
    } else {
      state = 'finished';
      const incomplete = f && (f.pageOverflow || f.docOverflow);
      const retrieved = this.progress().documentsRetrieved;
      message = `Finished. ${plural(this.#counters.pagesFetched, 'page')} fetched, ${plural(f ? f.docs.length : 0, 'document link')} found${this.#o.retrieveDocuments ? `, ${retrieved} retrieved` : ' (documents were not retrieved in this run)'}.${incomplete ? ` ${f.pageOverflow} more page${f.pageOverflow === 1 ? '' : 's'} and ${f.docOverflow} more document link${f.docOverflow === 1 ? '' : 's'} were found beyond the limits and not queued.` : ''} The coverage list shows where Chronium looked.`;
    }
    this.#setState(state === 'stopped-at-limit' ? 'finished' : state, message);
    return this.#finish(state, { unfetched });
  }

  #finish(state, extra = {}) {
    const f = this.#frontier;
    const finishedAt = new Date(this.#o.now()).toISOString();
    const summaryLedger = this.#ledger.summary();
    const coverage = this.#ledger.coverage(this.plannedSources());
    const minutes = Math.round(((this.#o.now() - (this.#started || this.#o.now())) / 60000) * 10) / 10;
    return {
      state, runId: this.runId, engineVersion: ENGINE_VERSION, startedAt: new Date(this.#started || this.#o.now()).toISOString(), finishedAt,
      mode: this.#o.mode, limits: this.#limits, counters: { ...this.#counters }, message: this.#lastMessage,
      stopReason: this.#stopReason, warnings: [...new Set(this.#warnings)], blockedHosts: Object.fromEntries(this.#blockedHosts), stoppedHosts: Object.fromEntries(this.#stoppedHosts),
      documents: this.#docs, checkpoint: this.#checkpoint(), retrieveDocuments: !!this.#o.retrieveDocuments,
      pages: this.#pages, documentCandidates: f ? f.docs.map((d) => ({ url: d.url, ext: d.ext, text: d.text, parent: d.parent, depth: d.depth })) : [],
      frontier: f ? f.stats() : null, ledger: this.#ledger.entries, ledgerSummary: summaryLedger, coverage,
      usage: { requests: this.#counters.requests, archiveLookups: this.#archiveLookups, megabytes: Math.round((this.#counters.bytes / 1048576) * 100) / 100, minutes },
      ...extra
    };
  }
}

export { OUTCOME_LABEL };
