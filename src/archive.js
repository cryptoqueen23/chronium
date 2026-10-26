// Archive-host helpers shared by /api/view-capture and the archive search connectors.
// Only these hosts are ever proxied by the archive viewer: that is what keeps it from being an open proxy.

// /api/view-capture only ever proxies known archive hosts - this is what
// keeps it from becoming an open proxy for arbitrary URLs.
export const KNOWN_ARCHIVE_HOSTS = [
  "web.archive.org", "archive-it.org", "nationalarchives.gov.uk", "webarchive.loc.gov", "loc.gov",
  "arquivo.pt", "commoncrawl.org", "data.commoncrawl.org", "index.commoncrawl.org", "timetravel.mementoweb.org"
];
export function isKnownArchiveHost(u, extraHosts = []) {
  let host;
  try { host = new URL(u).hostname.toLowerCase(); } catch { return false; }
  return [...KNOWN_ARCHIVE_HOSTS, ...extraHosts].some((h) => host === h || host.endsWith(`.${h}`));
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
export function toDirectContentUrl(u) {
  try {
    const host = new URL(u).hostname.toLowerCase();
    if (NON_HTML_EXT.test(u)) return u;
    if (host.endsWith("arquivo.pt") && /\/wayback\/\d{14}\//.test(u)) return u.replace(/(\/wayback\/\d{14})\//, "$1mp_/");
    if (host.endsWith("web.archive.org") && /\/web\/\d{14}\//.test(u)) return u.replace(/(\/web\/\d{14})\//, "$1if_/");
    return u;
  } catch { return u; }
}

export const EXT_FOR_CONTENT_TYPE = {
  "text/html": "html", "application/xhtml+xml": "html", "application/pdf": "pdf",
  "text/plain": "txt", "application/json": "json", "text/xml": "xml", "application/xml": "xml",
  "text/csv": "csv", "application/csv": "csv",
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg"
};
export function filenameForCapture(target, contentType) {
  let last = "capture";
  try { last = new URL(target).pathname.split("/").filter(Boolean).pop() || "capture"; } catch { /* keep default */ }
  last = last.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "capture";
  if (/\.[a-z0-9]{1,6}$/i.test(last)) return last;
  return `${last}.${EXT_FOR_CONTENT_TYPE[contentType] || "bin"}`;
}
