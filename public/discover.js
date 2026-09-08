// Provider-neutral "Discover Sources" seam for Ask Sources
// (docs/CANON.md Product Principles #1/#9/#22). Ask Sources must never
// hard-wire itself to one endpoint as though it represented all external
// research - it calls discoverSources() below, and only this file (or
// the server-side connector list it already delegates to,
// `ARCHIVE_PROVIDERS` in src/index.js) needs to change to add a new
// provider (an authoritative API, RSS/sitemaps, an academic source,
// another archive). Today the only implementation is Chronium's existing
// federated `/api/search` (Arquivo.pt, Wayback, Common Crawl, Memento,
// plus the bundled reference corpus), which already aggregates multiple
// connectors server-side with per-connector Coverage Verdicts - this
// wrapper is the client-side seam on top of that, not a rewrite of it.

export async function discoverSources(query, { limit = 25 } = {}) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Discover search failed.');
  return {
    results: data.results || [],
    connectors: data.connectors || [],
    mode: data.mode || 'topic',
    tookMs: data.tookMs || 0
  };
}

// Coverage summary for the Unresolved path (docs/CANON.md "Never Fake
// Coverage"): which provider groups actually found something, which
// answered but found nothing for this query, and which couldn't be
// reached at all (coverage unknown, never presented as "nothing there").
export function summarizeDiscoverCoverage(connectors) {
  const list = connectors || [];
  return {
    found: list.filter((c) => c.verdict === 'found'),
    noMatch: list.filter((c) => c.verdict === 'no-captures-in-index' || c.verdict === 'verified-gap'),
    unavailable: list.filter((c) => c.verdict === 'provider-unavailable')
  };
}
