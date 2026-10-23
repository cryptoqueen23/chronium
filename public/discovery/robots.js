// Deep Discovery: robots.txt (RFC 9309) parsing and policy decisions.
// Group selection by product token, merged rules, longest-match precedence
// (Allow wins a tie), `*` and `$` patterns, Crawl-delay, Sitemap lines.
// Policy for unusable files (documented deviation: stricter than the RFC where
// access may be restricted):
//   2xx            -> parsed rules apply
//   404, 410, other 4xx -> "absent": no restrictions stated, politeness floor still applies
//   401, 403       -> "restricted": treated as no access (the site is refusing us)
//   5xx, network, timeout -> "unreachable": no automated expansion; only the single
//                    address the user explicitly supplied may be requested, with a warning
// Pure module.
import { USER_AGENT_TOKEN, DEFAULT_LIMITS } from './config.js';

export function robotsUrlFor(url) { const u = new URL(url); return `${u.protocol}//${u.host}/robots.txt`; }

export function parseRobots(text, { maxBytes = DEFAULT_LIMITS.maxRobotsBytes } = {}) {
  let body = String(text ?? '');
  let truncated = false;
  if (body.length > maxBytes) { body = body.slice(0, maxBytes); truncated = true; }
  body = body.replace(/^﻿/, '');
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  let ignored = 0;
  for (const rawLine of body.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) { ignored++; continue; }
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [], crawlDelay: null }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      if (!current) { ignored++; continue; }
      current.rules.push({ type: key, pattern: value });
      lastWasAgent = false;
    } else if (key === 'crawl-delay') {
      if (current) { const n = Number(value); if (Number.isFinite(n) && n >= 0) current.crawlDelay = n; else ignored++; }
      lastWasAgent = false;
    } else if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      lastWasAgent = false;
    } else { ignored++; lastWasAgent = false; }
  }
  return { groups, sitemaps, truncated, ignored };
}

// Rules and Crawl-delay that apply to a product token: all groups naming the
// token; if none, all `*` groups. Groups are merged.
export function selectGroup(parsed, token = USER_AGENT_TOKEN) {
  const t = token.toLowerCase().split('/')[0];
  let matches = parsed.groups.filter((g) => g.agents.some((a) => a.split('/')[0] === t));
  let matched = t;
  if (!matches.length) { matches = parsed.groups.filter((g) => g.agents.includes('*')); matched = '*'; }
  const rules = matches.flatMap((g) => g.rules);
  const delays = matches.map((g) => g.crawlDelay).filter((d) => d !== null);
  return { matched: matches.length ? matched : null, rules, crawlDelaySeconds: delays.length ? Math.max(...delays) : null };
}

function patternToRegex(pattern) {
  let p = pattern;
  let anchored = false;
  if (p.endsWith('$')) { anchored = true; p = p.slice(0, -1); }
  const src = p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + src + (anchored ? '$' : ''));
}

// path includes the query string (robots rules apply to path plus query).
export function ruleDecision(rules, pathWithQuery) {
  let best = null;
  for (const r of rules) {
    if (r.pattern === '') continue; // "Disallow:" with nothing = no restriction
    if (!patternToRegex(r.pattern).test(pathWithQuery)) continue;
    const len = r.pattern.length;
    if (!best || len > best.len || (len === best.len && r.type === 'allow' && best.type !== 'allow')) best = { type: r.type, len, pattern: r.pattern };
  }
  if (!best) return { allowed: true, rule: null };
  return { allowed: best.type === 'allow', rule: `${best.type === 'allow' ? 'Allow' : 'Disallow'}: ${best.pattern}` };
}

// Turns a robots.txt fetch result into a state.
export function interpretRobotsResponse({ status, body, truncated, error }) {
  if (error) return { state: 'unreachable', detail: error.code || 'network' };
  if (status >= 200 && status < 300) return { state: 'parsed', body: body ?? '', truncated: !!truncated };
  if (status === 401 || status === 403) return { state: 'restricted', detail: `HTTP ${status}` };
  if (status === 429 || status >= 500) return { state: 'unreachable', detail: `HTTP ${status}` };
  if (status >= 300 && status < 400) return { state: 'unreachable', detail: `unresolved redirect (HTTP ${status})` };
  return { state: 'absent', detail: `HTTP ${status}` }; // 404, 410 and other 4xx: no robots file
}

export class RobotsPolicy {
  constructor({ state, parsed = null, token = USER_AGENT_TOKEN, origin = '', detail = '', fetchedAt = null }) {
    this.state = state; this.token = token; this.origin = origin; this.detail = detail; this.fetchedAt = fetchedAt;
    this.parsed = parsed;
    this.group = parsed ? selectGroup(parsed, token) : { matched: null, rules: [], crawlDelaySeconds: null };
  }
  static fromResponse(response, { token = USER_AGENT_TOKEN, origin = '', now = Date.now(), maxBytes } = {}) {
    const s = interpretRobotsResponse(response);
    const parsed = s.state === 'parsed' ? parseRobots(s.body, { maxBytes }) : null;
    return new RobotsPolicy({ state: s.state, parsed, token, origin, detail: s.detail || (parsed?.truncated ? 'file larger than the size limit, remainder ignored' : ''), fetchedAt: now });
  }
  get crawlDelayMs() { return this.group.crawlDelaySeconds === null ? null : Math.round(this.group.crawlDelaySeconds * 1000); }
  get sitemaps() { return (this.parsed?.sitemaps || []).map((s) => { try { return new URL(s, this.origin || undefined).href; } catch { return null; } }).filter(Boolean); }
  // isSeed: the single address the user explicitly asked for.
  evaluate(url, { isSeed = false } = {}) {
    const u = new URL(url);
    const p = u.pathname + u.search;
    if (this.state === 'restricted') return { allowed: false, reason: 'robots-restricted', rule: null, warning: null };
    if (this.state === 'unreachable') return isSeed
      ? { allowed: true, reason: 'robots-unreachable', rule: null, warning: 'robots.txt could not be read; only the address you gave was requested' }
      : { allowed: false, reason: 'robots-unreachable', rule: null, warning: null };
    if (this.state === 'absent') return { allowed: true, reason: 'no-robots', rule: null, warning: null };
    const d = ruleDecision(this.group.rules, p);
    return { allowed: d.allowed, reason: d.allowed ? 'robots-allow' : 'robots-disallow', rule: d.rule, warning: null };
  }
  // Delay between requests in ms: the larger of the site's Crawl-delay and our floor.
  // tooSlow is set when the site asks for more than we will wait; the delay is never shortened.
  effectiveDelay({ minDelayMs = DEFAULT_LIMITS.minDelayMs, maxAcceptedCrawlDelayMs = DEFAULT_LIMITS.maxAcceptedCrawlDelayMs } = {}) {
    const stated = this.crawlDelayMs;
    const delayMs = Math.max(minDelayMs, stated ?? 0);
    return { delayMs, stated, tooSlow: stated !== null && stated > maxAcceptedCrawlDelayMs };
  }
}
