// Deep Discovery: URL safety. Decides whether a URL may be requested at all,
// and canonicalizes URLs for de-duplication. Blocks non-web schemes,
// credentials, odd ports, single-label and local names, every private,
// loopback, link-local, reserved and metadata address in every spelling the
// WHATWG URL parser normalizes (decimal, hex, octal, shorthand IPv4; IPv6;
// IPv4-mapped IPv6). Redirect hops are re-checked with checkRedirect().
// Pure module: no network, no DNS. (A hostname that resolves to a private
// address cannot be detected without DNS; the Worker cannot reach private
// networks and the extension blocks private targets with network rules, see
// docs/DEEP_DISCOVERY_PLAN.md section 8.)

export const MAX_URL_LENGTH = 2048;

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.lan', '.home.arpa', '.intranet', '.corp', '.private'];
const BLOCKED_NAMES = new Set(['localhost', 'metadata', 'metadata.google.internal', 'instance-data']);

function ipv4ToInt(p) { return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]; }
// [network, prefix] pairs for ranges that are not ordinary public addresses.
const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
].map(([n, p]) => [ipv4ToInt(n.split('.').map(Number)), p]);

export function isBlockedIPv4(dotted) {
  const parts = dotted.split('.').map(Number);
  if (parts.length !== 4 || parts.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const v = ipv4ToInt(parts);
  return BLOCKED_V4.some(([net, p]) => { const mask = p === 0 ? 0 : (~0 << (32 - p)) >>> 0; return (v & mask) >>> 0 === (net & mask) >>> 0; });
}

// Parses IPv6 text (without brackets) to eight 16-bit groups, or null.
export function parseIPv6(text) {
  let s = text.toLowerCase();
  if (s.includes('%')) return null; // zone ids are never legitimate here
  let tail = null;
  const lastColon = s.lastIndexOf(':');
  if (s.includes('.') && lastColon >= 0) {
    const v4 = s.slice(lastColon + 1).split('.').map(Number);
    if (v4.length !== 4 || v4.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    s = s.slice(0, lastColon + 1) + '0:0';
  }
  const dbl = s.split('::');
  if (dbl.length > 2) return null;
  const toGroups = (str) => (str === '' ? [] : str.split(':'));
  const head = toGroups(dbl[0]);
  const rest = dbl.length === 2 ? toGroups(dbl[1]) : [];
  if (dbl.length === 1 && head.length !== 8) return null;
  if (dbl.length === 2 && head.length + rest.length > 7) return null;
  const mid = dbl.length === 2 ? new Array(8 - head.length - rest.length).fill('0') : [];
  const all = [...head, ...mid, ...rest];
  if (all.length !== 8) return null;
  const nums = all.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  if (nums.some(Number.isNaN)) return null;
  if (tail) { nums[6] = tail[0]; nums[7] = tail[1]; }
  return nums;
}

// IPv6 uses an allowlist: only global unicast (2000::/3) outside the
// documentation, Teredo and 6to4 ranges is accepted. Everything else
// (loopback, unspecified, ULA, link-local, site-local, multicast, IPv4-mapped,
// NAT64, discard, reserved) is refused.
export function isBlockedIPv6(groups) {
  if (!groups) return true;
  const g0 = groups[0];
  if (g0 < 0x2000 || g0 > 0x3fff) return true;
  if (g0 === 0x2001 && (groups[1] === 0x0db8 || groups[1] === 0x0000)) return true; // documentation, Teredo
  if (g0 === 0x2002) return true; // 6to4 can embed any IPv4 address
  return false;
}

// Returns { ok:true, url:URL, canonical:string } or { ok:false, reason, detail }.
// opts.allowPrivateHosts: exact "host:port" strings allowed even though private (tests only).
// opts.allowedPorts: extra ports to accept (default 80 and 443 only).
export function checkUrl(input, opts = {}) {
  if (typeof input !== 'string' && !(input instanceof URL)) return fail('invalid-url', 'not a string');
  const raw = input instanceof URL ? input.href : input.trim();
  if (!raw) return fail('invalid-url', 'empty');
  if (raw.length > MAX_URL_LENGTH) return fail('too-long', `${raw.length} characters`);
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return fail('invalid-url', 'contains whitespace or control characters');
  let url;
  try { url = new URL(raw); } catch { return fail('invalid-url', 'cannot be parsed'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail('scheme', url.protocol);
  if (url.username || url.password) return fail('credentials', 'user name or password in the address');
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const allowedPorts = new Set(['80', '443', ...(opts.allowedPorts || []).map(String)]);
  let host = url.hostname.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  const hostPort = `${host}:${port}`;
  const exempt = (opts.allowPrivateHosts || []).includes(hostPort) || (opts.allowPrivateHosts || []).includes(`[${host}]:${port}`);
  if (!allowedPorts.has(port) && !exempt) return fail('port', port);
  if (exempt) return ok(url);
  if (host.startsWith('[') && host.endsWith(']')) {
    const g = parseIPv6(host.slice(1, -1));
    if (isBlockedIPv6(g)) return fail('private-address', 'IPv6 address is not a public global address');
    return ok(url); // a public IPv6 literal is allowed by the guard; scope rules decide whether to use it
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isBlockedIPv4(host)) return fail('private-address', host);
    return ok(url);
  }
  if (!host.includes('.')) return fail('single-label', host);
  if (BLOCKED_NAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return fail('local-name', host);
  if (/^[0-9.]+$/.test(host) || /^0x[0-9a-f.]+$/i.test(host)) return fail('private-address', 'numeric host that is not a normal address');
  if (!/^[a-z0-9.-]+$/.test(host)) return fail('invalid-url', 'host is not plain ASCII after normalization');
  return ok(url);
  function ok(u) { return { ok: true, url: u, canonical: canonicalizeUrl(u) }; }
  function fail(reason, detail) { return { ok: false, reason, detail }; }
}

const TRACKING_PARAMS = /^(utm_[a-z0-9_]+|gclid|fbclid|msclkid|mc_cid|mc_eid|igshid|_ga|yclid)$/i;

// One spelling per resource: lowercase scheme and host, no default port, no
// fragment, no tracking parameters, sorted query, "." and ".." resolved by the
// URL parser, no trailing slash except the root, percent-encoding of unreserved
// characters normalized.
export function canonicalizeUrl(input) {
  const u = new URL(input instanceof URL ? input.href : input);
  u.hash = '';
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k)).sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  u.search = '';
  for (const [k, v] of params) u.searchParams.append(k, v);
  let path = u.pathname.replace(/%([0-9a-f]{2})/gi, (m, h) => { const c = String.fromCharCode(parseInt(h, 16)); return /[A-Za-z0-9\-._~]/.test(c) ? c : `%${h.toUpperCase()}`; });
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  u.pathname = path;
  return u.href;
}

// Validates one redirect hop. `from` is the URL that answered with a 3xx,
// `location` its Location header (absolute or relative), `hop` the 1-based
// number of this hop.
export function checkRedirect({ from, location, hop, maxRedirects }, opts = {}) {
  if (hop > maxRedirects) return { ok: false, reason: 'redirect-limit', detail: `more than ${maxRedirects} redirects` };
  let target;
  try { target = new URL(location, from); } catch { return { ok: false, reason: 'invalid-url', detail: 'redirect target cannot be parsed' }; }
  const guard = checkUrl(target, opts);
  if (!guard.ok) return { ok: false, reason: `redirect-${guard.reason}`, detail: guard.detail };
  const f = new URL(from);
  if (f.protocol === 'https:' && target.protocol === 'http:') return { ok: false, reason: 'redirect-downgrade', detail: 'https to http' };
  return { ok: true, url: guard.url, canonical: guard.canonical };
}
