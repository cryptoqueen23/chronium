// Deep Discovery: bounded link discovery. Extracts links from HTML without a
// DOM (works in Node, the Worker, the browser), decides file types, scope, and
// keeps the crawl frontier inside depth, page, document and host limits in a
// deterministic order. Pure module.
import { checkUrl, canonicalizeUrl } from './urlGuard.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null; };

// Robots directives a page itself carries (meta tag). Only nofollow matters for crawling.
export function metaRobots(html) {
  let nofollow = false, noindex = false;
  for (const m of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const name = (attr(m[0], 'name') || '').toLowerCase();
    if (name === 'robots' || name === 'chroniummind') {
      const c = (attr(m[0], 'content') || '').toLowerCase();
      if (/\bnofollow\b|\bnone\b/.test(c)) nofollow = true;
      if (/\bnoindex\b|\bnone\b/.test(c)) noindex = true;
    }
  }
  return { nofollow, noindex };
}

// Returns [{ href (absolute), text, rel, tag }] in document order. Ignores
// script, style and comments; mailto:, tel:, javascript:, data: and
// fragment-only links; links with rel=nofollow.
export function extractLinks(html, baseUrl, { maxLinks = 1000 } = {}) {
  let src = String(html);
  src = src.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ').replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ');
  let base = baseUrl;
  const baseTag = src.match(/<base\b[^>]*>/i);
  if (baseTag) { const h = attr(baseTag[0], 'href'); if (h) { try { base = new URL(h, baseUrl).href; } catch { /* keep page URL */ } } }
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>|<area\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(src)) && out.length < maxLinks) {
    const tag = m[1] !== undefined ? 'a' : 'area';
    const attrs = m[1] !== undefined ? m[1] : m[3];
    const href = attr(attrs, 'href');
    if (!href) continue;
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#') || /^(mailto|tel|javascript|data|sms|ftp):/i.test(trimmed)) continue;
    const rel = (attr(attrs, 'rel') || '').toLowerCase();
    if (/\bnofollow\b/.test(rel)) continue;
    let abs;
    try { abs = new URL(trimmed, base).href; } catch { continue; }
    const text = tag === 'a' ? decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 200) : (attr(attrs, 'alt') || '');
    out.push({ href: abs, text, rel, tag });
  }
  return out;
}

const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'odp', 'json', 'xml']);
const ARCHIVE_EXT = new Set(['zip', 'gz', 'tar', 'tgz', '7z', 'rar']);
const MEDIA_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'mp3', 'mp4', 'mov', 'avi', 'wav', 'webm', 'woff', 'woff2', 'ttf', 'css', 'js', 'map']);
const CT_MAP = [['application/pdf', 'pdf'], ['application/msword', 'doc'], ['officedocument.wordprocessingml', 'docx'], ['ms-excel', 'xls'], ['officedocument.spreadsheetml', 'xlsx'], ['text/csv', 'csv'], ['text/plain', 'txt'], ['ms-powerpoint', 'ppt'], ['officedocument.presentationml', 'pptx'], ['application/zip', 'zip']];

// 'page' | 'document' | 'archive' | 'media'. Content-Type, when known, wins over the extension.
export function fileKind(url, contentType = '') {
  const ct = String(contentType).toLowerCase();
  if (ct) {
    if (ct.includes('text/html') || ct.includes('application/xhtml')) return { kind: 'page', ext: 'html' };
    for (const [needle, ext] of CT_MAP) if (ct.includes(needle)) return { kind: ext === 'zip' ? 'archive' : 'document', ext };
    if (ct.startsWith('image/') || ct.startsWith('audio/') || ct.startsWith('video/') || ct.startsWith('font/')) return { kind: 'media', ext: '' };
  }
  let ext = '';
  try { const p = new URL(url).pathname; const m = p.match(/\.([a-z0-9]{1,5})$/i); ext = m ? m[1].toLowerCase() : ''; } catch { /* leave empty */ }
  if (DOC_EXT.has(ext)) return { kind: 'document', ext };
  if (ARCHIVE_EXT.has(ext)) return { kind: 'archive', ext };
  if (MEDIA_EXT.has(ext)) return { kind: 'media', ext };
  return { kind: 'page', ext };
}

const TWO_PART_SUFFIXES = new Set(['co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'com.au', 'gov.au', 'edu.au', 'co.nz', 'co.za', 'com.br', 'gov.br', 'co.in', 'gov.in']);
// Heuristic registrable domain (not the full public-suffix list). US locality
// domains like city.tx.us use the last three labels.
export function registrableDomain(host) {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith('[')) return h;
  const labels = h.split('.');
  if (labels.length <= 2) return h;
  const last2 = labels.slice(-2).join('.');
  if (TWO_PART_SUFFIXES.has(last2)) return labels.slice(-3).join('.');
  if (/^[a-z]{2}\.us$/.test(last2)) return labels.slice(-3).join('.');
  return last2;
}

// Which hosts a run may follow links onto: the seeds' registrable domains
// (mode 'registrable') or exactly the seed hosts (mode 'host'), plus any hosts
// explicitly allowed for documents (for example a city's file CDN).
export class Scope {
  constructor({ seeds, mode = 'registrable', allowHosts = [] }) {
    this.mode = mode;
    const hosts = seeds.map((s) => new URL(s).hostname.toLowerCase());
    this.seedHosts = new Set(hosts);
    this.registrable = new Set(hosts.map(registrableDomain));
    this.allow = new Set(allowHosts.map((h) => h.toLowerCase()));
  }
  check(url) {
    const h = new URL(url).hostname.toLowerCase();
    if (this.allow.has(h)) return { ok: true, reason: 'allowed-host' };
    if (this.mode === 'host' ? this.seedHosts.has(h) : this.registrable.has(registrableDomain(h))) return { ok: true, reason: 'in-scope' };
    return { ok: false, reason: 'off-scope-host' };
  }
}

// The crawl frontier: breadth-first, deterministic (depth, then discovery
// order), de-duplicated by canonical URL, bounded by depth / pages / documents.
// Documents are recorded as candidates; Phase 0 does not retrieve them.
export class Frontier {
  constructor({ limits, scope, guardOptions = {} }) {
    this.limits = limits; this.scope = scope; this.guardOptions = guardOptions;
    this.seen = new Set(); this.pages = []; this.docs = []; this.rejected = new Map();
    this.pagesQueued = 0; this.docsQueued = 0; this.docOverflow = 0; this.pageOverflow = 0; this.seq = 0; this.cursor = 0;
  }
  #reject(reason, url) { this.rejected.set(reason, (this.rejected.get(reason) || 0) + 1); return { accepted: false, reason, url }; }
  // depth: depth of the page that links here (seeds are depth 0 and added with isSeed).
  add({ url, depth, parent = null, text = '', isSeed = false, contentTypeHint = '' }) {
    const g = checkUrl(url, this.guardOptions);
    if (!g.ok) return this.#reject(`unsafe:${g.reason}`, url);
    const canonical = g.canonical;
    if (this.seen.has(canonical)) return this.#reject('duplicate', canonical);
    if (!isSeed) {
      const sc = this.scope.check(canonical);
      if (!sc.ok) return this.#reject(sc.reason, canonical);
    }
    const fk = fileKind(canonical, contentTypeHint);
    if (fk.kind === 'media') return this.#reject('media-skipped', canonical);
    if (fk.kind === 'archive') { this.seen.add(canonical); return this.#reject('archive-not-expanded', canonical); }
    if (fk.kind === 'document') {
      // A document is a leaf (never expanded), so one more level than pages is allowed: files linked from a depth-N page are depth N+1.
      if (depth > this.limits.maxDepth + 1) return this.#reject('too-deep', canonical);
      this.seen.add(canonical);
      if (this.docsQueued >= this.limits.maxDocuments) { this.docOverflow++; return this.#reject('document-cap', canonical); }
      this.docsQueued++;
      this.docs.push({ url: canonical, ext: fk.ext, text, parent, depth, seq: this.seq++ });
      return { accepted: true, kind: 'document', url: canonical };
    }
    if (depth > this.limits.maxDepth) return this.#reject('too-deep', canonical);
    this.seen.add(canonical);
    if (this.pagesQueued >= this.limits.maxPages) { this.pageOverflow++; return this.#reject('page-cap', canonical); }
    this.pagesQueued++;
    this.pages.push({ url: canonical, depth, parent, text, isSeed, seq: this.seq++ });
    return { accepted: true, kind: 'page', url: canonical };
  }
  // Continues an earlier run: finished pages are remembered as seen; pending pages and all document candidates are queued again.
  restore({ pagesDone = [], pagesPending = [], docCandidates = [] } = {}) {
    for (const u of pagesDone) this.seen.add(u);
    for (const p of pagesPending) this.add({ url: p.url, depth: p.depth, parent: p.parent, text: p.text, isSeed: !!p.isSeed });
    for (const d of docCandidates) this.add({ url: d.url, depth: d.depth, parent: d.parent, text: d.text });
  }
  // Breadth-first: pages are appended in discovery order, depth never decreases along the queue.
  nextPage() { return this.cursor < this.pages.length ? this.pages[this.cursor++] : null; }
  get pagesRemaining() { return this.pages.length - this.cursor; }
  stats() {
    return { pagesQueued: this.pagesQueued, pagesRemaining: this.pagesRemaining, documentCandidates: this.docs.length, documentOverflow: this.docOverflow, pageOverflow: this.pageOverflow, rejected: Object.fromEntries(this.rejected) };
  }
}

export { canonicalizeUrl };
