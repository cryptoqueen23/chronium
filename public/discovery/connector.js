// Deep Discovery: the reusable connector interface and the host policy
// registry that decides, per host, whether automated access is permitted.
//
// A Connector knows how to turn "a place" into seeds and how to expand a page
// into more links. Connectors never fetch anything themselves: the engine owns
// every request (robots, delay, caps, redirects, ledger), so a connector cannot
// bypass the policy by construction.
//
// Host policy values (docs/DISCOVERY_SOURCE_REGISTRY.md):
//   allowed     automated retrieval verified permitted (terms checked, date and basis recorded)
//   link-only   show the link, never fetch it automatically
//   forbidden   terms or access controls prohibit automation
//   unverified  terms not (yet) verified: treated like link-only
// A host with NO entry is allowed only when the user has explicitly
// acknowledged that host for this run (recorded in the ledger).
// Pure module.
import { registrableDomain } from './links.js';

export const AUTOMATION = Object.freeze({ ALLOWED: 'allowed', LINK_ONLY: 'link-only', FORBIDDEN: 'forbidden', UNVERIFIED: 'unverified' });

/**
 * Contract for connectors.
 * @typedef {Object} ConnectorLike
 * @property {string} id
 * @property {string} label
 * @property {string} kind                 e.g. 'official-website', 'document-library', 'meeting-system'
 * @property {(url:string)=>boolean} matches
 * @property {(input:string)=>string[]} seeds
 * @property {(seeds:string[])=>{mode:string, allowHosts:string[]}} scopeOptions
 * @property {(page:{url:string, depth:number, links:Array<{href:string,text:string}>})=>Array<{href:string,text:string}>} expandPage
 * @property {(seeds:string[])=>Array<{url:string, method?:'GET'}>} listingCalls  extra listing addresses a verified connector knows about; GET only
 */
export class Connector {
  constructor({ id, label, kind = 'official-website' }) { this.id = id; this.label = label; this.kind = kind; }
  matches() { return false; }
  seeds(input) { return [input]; }
  scopeOptions() { return { mode: 'registrable', allowHosts: [] }; }
  // May add or filter links for a page. Must not perform requests.
  expandPage({ links }) { return links; }
  // Extra listing addresses (for example a documented public list URL). The engine requests them through the SAME
  // gate as every other address, and only when the host's registry entry is `allowed` (an acknowledgment is not enough).
  listingCalls() { return []; }
}

// Works for any ordinary website through its own links, within the engine's policy.
export class GenericLinkConnector extends Connector {
  constructor() { super({ id: 'generic-html', label: 'Official website (linked pages and files)', kind: 'official-website' }); }
  matches() { return true; }
}

// CivicPlus agenda and document centres (many Texas cities use them). This is the reusable ADAPTER INTERFACE:
// it recognises CivicPlus address shapes and classifies them. It performs no retrieval of its own and its
// listingCalls() returns nothing unless a host's registry entry is `allowed`; the engine enforces that, so
// writing this adapter does not clear any site. Automated retrieval for copperascovetx.gov stays blocked
// (docs/CIVICPLUS_VERIFICATION.md). The address shapes below were seen on that site's public pages; the
// responses of its list endpoints were NOT captured, so no list parser exists.
export class CivicPlusAdapter extends Connector {
  constructor(hostPatterns = []) { super({ id: 'civicplus', label: 'CivicPlus agenda and document centres', kind: 'meeting-system' }); this.hostPatterns = hostPatterns; }
  matches(url) { const h = new URL(url).hostname.toLowerCase(); return this.hostPatterns.some((p) => h === p || h.endsWith('.' + p)); }
  // 'agenda-center' | 'document-center' | 'agenda-file' | 'document-file' | null
  static linkShape(url) {
    let p; try { p = new URL(url).pathname.toLowerCase().replace(/\/+$/, ''); } catch { return null; }
    if (p.startsWith('/agendacenter/viewfile/')) return 'agenda-file';
    if (/^\/documentcenter\/view\/\d+/.test(p)) return 'document-file';
    if (p === '/agendacenter') return 'agenda-center';
    if (p === '/documentcenter' || /^\/documentcenter\/index\/\d+/.test(p)) return 'document-center';
    return null;
  }
  // Same links, in a stable order, with the agenda and document files first so a capped run spends its budget on records.
  expandPage({ links }) {
    const rank = (l) => { const k = CivicPlusAdapter.linkShape(l.href); return k === 'agenda-file' || k === 'document-file' ? 0 : k ? 1 : 2; };
    return links.map((l, i) => ({ l, i, r: rank(l) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.l);
  }
}
// Kept for older imports.
export const CivicPlusPlaceholder = CivicPlusAdapter;

export class ConnectorRegistry {
  #list = [];
  register(c) { this.#list.push(c); return this; }
  // Specific connectors first, generic last.
  forUrl(url) { return this.#list.find((c) => c.id !== 'generic-html' && c.matches(url)) || this.#list.find((c) => c.id === 'generic-html') || null; }
  get all() { return this.#list.slice(); }
}

export class HostPolicyRegistry {
  #entries = [];
  add(entry) { this.#entries.push({ decidedAt: null, note: '', docs: '', ...entry }); return this; }
  lookup(host) {
    const h = host.toLowerCase();
    return this.#entries.find((e) => h === e.pattern || h.endsWith('.' + e.pattern)) || null;
  }
  // -> { allowed, automation, reason, entry }
  decide(host, { acknowledged = [] } = {}) {
    const entry = this.lookup(host);
    if (entry) {
      if (entry.automation === AUTOMATION.ALLOWED) return { allowed: true, automation: entry.automation, reason: 'registry-allowed', entry };
      const why = { [AUTOMATION.LINK_ONLY]: 'link-only: automated retrieval is not permitted for this source', [AUTOMATION.FORBIDDEN]: 'forbidden: the source prohibits automated access', [AUTOMATION.UNVERIFIED]: 'unverified: automated access has not been cleared for this source' }[entry.automation] || 'not permitted';
      return { allowed: false, automation: entry.automation, reason: why, entry };
    }
    const ok = acknowledged.some((a) => { const x = a.toLowerCase(); return host.toLowerCase() === x || registrableDomain(host) === registrableDomain(x); });
    return ok
      ? { allowed: true, automation: 'acknowledged', reason: 'user acknowledged this site for this run', entry: null }
      : { allowed: false, automation: AUTOMATION.UNVERIFIED, reason: 'this site has not been acknowledged: confirm you have read its terms before an automated run', entry: null };
  }
}

// What ships in Phase 0. Entries change only by a documented decision.
export function defaultHostPolicies() {
  return new HostPolicyRegistry()
    .add({ pattern: 'copperascovetx.gov', connectorId: 'civicplus', automation: AUTOMATION.UNVERIFIED, docs: 'docs/CIVICPLUS_VERIFICATION.md',
      note: 'CivicPlus-hosted. robots.txt allows the agenda and document paths with Crawl-delay 10; the CivicPlus terms restrict automated systems and the city asserts copyright. Not cleared. Use user-directed capture, user-supplied URLs, a written permission, or a Public Information Act request.' })
    .add({ pattern: 'civicplus.com', connectorId: 'civicplus', automation: AUTOMATION.UNVERIFIED, docs: 'docs/CIVICPLUS_VERIFICATION.md', note: 'Returned HTTP 403 to a non-browser agent; not circumvented.' })
    .add({ pattern: 'emma.msrb.org', connectorId: 'emma', automation: AUTOMATION.LINK_ONLY, docs: 'docs/DEEP_DISCOVERY_PLAN.md', note: 'Terms and permitted retrieval methods not verified: link only.' });
}

export function defaultConnectors() {
  return new ConnectorRegistry().register(new CivicPlusAdapter(['copperascovetx.gov', 'civicplus.com'])).register(new GenericLinkConnector());
}
