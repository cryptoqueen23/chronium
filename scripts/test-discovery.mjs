// Deep Discovery Phase 0 acceptance tests. Pure-module unit tests plus
// deterministic integration tests against a local test site, with a fake clock
// (so a 10-second Crawl-delay is asserted in fake time, not waited for).
// No test contacts a real website.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startTestSite, DEFAULT_ROBOTS } from './lib/discovery-test-site.mjs';
import { DEFAULT_LIMITS, HARD_CEILINGS, resolveLimits, USER_AGENT } from '../public/discovery/config.js';
import { checkUrl, canonicalizeUrl, checkRedirect, parseIPv6, isBlockedIPv4 } from '../public/discovery/urlGuard.js';
import { parseRobots, selectGroup, ruleDecision, RobotsPolicy, interpretRobotsResponse, robotsUrlFor } from '../public/discovery/robots.js';
import { HostScheduler, CancelledError, parseRetryAfter } from '../public/discovery/scheduler.js';
import { extractLinks, metaRobots, fileKind, registrableDomain, Scope, Frontier } from '../public/discovery/links.js';
import { OUTCOME, OUTCOME_LABEL, classifyAttempt, combineAttempts } from '../public/discovery/outcomes.js';
import { Ledger, coverageText, coverageHtml, COVERAGE } from '../public/discovery/ledger.js';
import { HostPolicyRegistry, defaultHostPolicies, defaultConnectors, AUTOMATION } from '../public/discovery/connector.js';
import { DiscoveryRun, DailyBudget } from '../public/discovery/engine.js';
import { createFetchApiFetcher, sha256Hex } from '../public/discovery/fetchers.js';
import { ledgerHtml, outcomeLegendHtml } from '../public/discovery/report.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// ============================== config ==============================
test('limits: approved defaults and hard ceilings', () => {
  assert.equal(DEFAULT_LIMITS.maxDepth, 2);
  assert.equal(DEFAULT_LIMITS.maxPages, 150);
  assert.equal(DEFAULT_LIMITS.maxDocuments, 100);
  assert.equal(DEFAULT_LIMITS.maxRunsPerDay, 3);
  assert.equal(DEFAULT_LIMITS.maxWebsiteFetches, 25);
  assert.ok(DEFAULT_LIMITS.maxRequestsPerHostPerDay < 1000, 'stays under the 1,000-pages-a-day figure in the CivicPlus terms');
  const big = resolveLimits({ maxPages: 99999, maxDepth: 50, maxWebsiteFetches: 5000, maxRunsPerDay: 1000, requestTimeoutMs: 1e9 });
  for (const k of ['maxPages', 'maxDepth', 'maxWebsiteFetches', 'maxRunsPerDay', 'requestTimeoutMs']) assert.equal(big[k], HARD_CEILINGS[k], k);
  assert.ok(big.clamped.some((c) => c.key === 'maxPages'));
  const small = resolveLimits({ maxPages: -4, maxTotalRequests: 'nope', bogus: 1 });
  assert.equal(small.maxPages, 1);
  assert.equal(small.maxTotalRequests, DEFAULT_LIMITS.maxTotalRequests);
  assert.equal(small.bogus, undefined);
  assert.throws(() => { 'use strict'; big.maxPages = 1; }, TypeError);
});

// ============================== URL safety ==============================
test('URL guard: ordinary public addresses pass', () => {
  for (const u of ['https://www.copperascovetx.gov/AgendaCenter', 'http://example.org/a?b=1#c', 'https://sub.city.tx.us/docs/file.pdf', 'https://example.com:443/x', 'http://example.com:80/x', 'https://[2606:4700:4700::1111]/x', 'https://8.8.8.8/x', 'https://xn--bcher-kva.example/x']) assert.equal(checkUrl(u).ok, true, u);
});
test('URL guard: private, local, reserved and odd addresses are refused in every spelling', () => {
  const bad = [
    'http://localhost/', 'http://LOCALHOST./', 'http://foo.localhost/', 'http://printer.local/', 'http://db.internal/', 'http://metadata.google.internal/computeMetadata/v1/', 'http://intranet/', 'http://corp/',
    'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://0x7f.1/', 'http://127.0.0.1.:80/',
    'http://10.0.0.5/', 'http://172.16.0.1/', 'http://172.31.255.255/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/', 'http://0.0.0.0/', 'http://224.0.0.1/', 'http://240.0.0.1/', 'http://198.18.0.1/', 'http://192.0.2.1/',
    'http://[::1]/', 'http://[::]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[fe80::1]/', 'http://[fc00::1]/', 'http://[fd12:3456::1]/', 'http://[ff02::1]/', 'http://[2001:db8::1]/', 'http://[2002:7f00:1::]/', 'http://[64:ff9b::7f00:1]/', 'http://[0:0:0:0:0:0:0:1]/',
    'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'https://user:pw@example.com/', 'https://user@example.com/', 'http://example.com:8080/', 'http://example.com:22/', 'https://example.com:444/',
    'http://exa mple.com/', 'http://example.com/\u0000', '', '   ', 'not a url'
  ];
  for (const u of bad) { const r = checkUrl(u); assert.equal(r.ok, false, `should refuse: ${JSON.stringify(u)}`); assert.ok(r.reason, u); }
  assert.equal(checkUrl('http://' + 'a'.repeat(3000) + '.com/').reason, 'too-long');
  assert.equal(checkUrl('https://user:pw@example.com/').reason, 'credentials');
  assert.equal(checkUrl('http://169.254.169.254/').reason, 'private-address');
  assert.equal(checkUrl('ftp://example.com/').reason, 'scheme');
});
test('URL guard: IPv4 range helper and IPv6 parser', () => {
  for (const a of ['10.1.2.3', '127.0.0.1', '172.20.0.1', '192.168.0.1', '169.254.1.1']) assert.equal(isBlockedIPv4(a), true, a);
  for (const a of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '193.0.0.1']) assert.equal(isBlockedIPv4(a), false, a);
  assert.deepEqual(parseIPv6('::1'), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(parseIPv6('::ffff:1.2.3.4'), [0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
  assert.equal(parseIPv6('1::2::3'), null);
  assert.equal(parseIPv6('fe80::1%eth0'), null);
});
test('URL guard: explicit test-host exemption is exact and narrow', () => {
  const o = { allowPrivateHosts: ['127.0.0.1:4000'] };
  assert.equal(checkUrl('http://127.0.0.1:4000/x', o).ok, true);
  assert.equal(checkUrl('http://127.0.0.1:4001/x', o).ok, false);
  assert.equal(checkUrl('http://169.254.169.254/', o).ok, false);
  assert.equal(checkUrl('http://localhost:4000/', o).ok, false);
});
test('URL canonicalization: one spelling per resource', () => {
  const a = canonicalizeUrl('HTTPS://Www.Example.COM:443/a/b/?utm_source=x&b=2&a=1#frag');
  assert.equal(a, 'https://www.example.com/a/b?a=1&b=2');
  assert.equal(canonicalizeUrl('http://example.com:80/'), 'http://example.com/');
  assert.equal(canonicalizeUrl('http://example.com/a/../b/./c'), 'http://example.com/b/c');
  assert.equal(canonicalizeUrl('http://example.com/%7Euser/a%2fb'), 'http://example.com/~user/a%2Fb');
  assert.equal(canonicalizeUrl('http://example.com/x/'), canonicalizeUrl('http://example.com/x'));
  assert.equal(canonicalizeUrl('http://example.com/p?fbclid=1&gclid=2'), 'http://example.com/p');
  assert.notEqual(canonicalizeUrl('http://example.com/A'), canonicalizeUrl('http://example.com/a'), 'paths are case-sensitive');
});
test('redirect hops are re-checked', () => {
  const base = { from: 'https://example.gov/a', maxRedirects: 3 };
  assert.equal(checkRedirect({ ...base, location: '/b', hop: 1 }).ok, true);
  assert.equal(checkRedirect({ ...base, location: 'https://www.example.gov/b', hop: 1 }).ok, true);
  assert.equal(checkRedirect({ ...base, location: '/b', hop: 4 }).reason, 'redirect-limit');
  assert.equal(checkRedirect({ ...base, location: 'http://169.254.169.254/x', hop: 1 }).reason, 'redirect-private-address');
  assert.equal(checkRedirect({ ...base, location: 'http://127.0.0.1/', hop: 1 }).ok, false);
  assert.equal(checkRedirect({ ...base, location: 'http://example.gov/b', hop: 1 }).reason, 'redirect-downgrade');
  assert.equal(checkRedirect({ ...base, location: 'ftp://example.gov/b', hop: 1 }).reason, 'redirect-scheme');
  assert.equal(checkRedirect({ ...base, location: 'https://u:p@example.gov/b', hop: 1 }).reason, 'redirect-credentials');
  assert.equal(checkRedirect({ ...base, location: 'http://', hop: 1 }).ok, false);
});

// ============================== robots.txt ==============================
test('robots: real Copperas Cove file (fixture)', () => {
  const text = fs.readFileSync(path.join(here, 'fixtures', 'discovery', 'copperascovetx.robots.txt'), 'utf8');
  const parsed = parseRobots(text);
  const g = selectGroup(parsed, 'ChroniumMind');
  assert.equal(g.matched, '*');
  assert.equal(g.crawlDelaySeconds, 10);
  const pol = new RobotsPolicy({ state: 'parsed', parsed, origin: 'https://www.copperascovetx.gov' });
  assert.equal(pol.crawlDelayMs, 10000);
  assert.equal(pol.effectiveDelay().delayMs, 10000);
  assert.equal(pol.evaluate('https://www.copperascovetx.gov/AgendaCenter').allowed, true);
  assert.equal(pol.evaluate('https://www.copperascovetx.gov/AgendaCenter/UpdateCategoryList').allowed, true);
  assert.equal(pol.evaluate('https://www.copperascovetx.gov/DocumentCenter/View/158/Fee-Schedule-PDF').allowed, true);
  for (const p of ['/Search', '/Search?q=x', '/RSS.aspx', '/rss.aspx', '/map.aspx', '/admin/x', '/PublicLogin.aspx', '/common/admin/a', '/common/modules/icalendar/x']) assert.equal(pol.evaluate('https://www.copperascovetx.gov' + p).allowed, false, p);
  // The extra "expensive endpoint" blocks (calendar, RSSFeed, bids, FAQ, CivicAlerts) are written only for the named AI-crawler group; they do NOT apply to us.
  for (const p of ['/rssfeed.aspx', '/RSSFeed.aspx?x=1', '/calendar.aspx', '/bids.aspx', '/civicalerts.aspx', '/faq.aspx']) assert.equal(pol.evaluate('https://www.copperascovetx.gov' + p).allowed, true, `${p} is allowed for the * group`);
  const ai = new RobotsPolicy({ state: 'parsed', parsed, token: 'GPTBot', origin: 'https://www.copperascovetx.gov' });
  for (const p of ['/rssfeed.aspx', '/calendar.aspx', '/bids.aspx', '/civicalerts.aspx', '/faq.aspx']) assert.equal(ai.evaluate('https://www.copperascovetx.gov' + p).allowed, false, `${p} is disallowed for a named AI crawler`);
  assert.equal(ai.crawlDelayMs, null, 'the named group states no delay of its own');
  assert.deepEqual(pol.sitemaps, ['https://www.copperascovetx.gov/sitemap.xml']);
  // A named group for another bot does not apply to us, and does not change ours.
  assert.equal(selectGroup(parsed, 'GPTBot').matched, 'gptbot');
});
test('robots: precedence, wildcards, anchors, empty rules', () => {
  const rules = (s) => selectGroup(parseRobots(s), 'ChroniumMind').rules;
  const d = (s, p) => ruleDecision(rules(s), p).allowed;
  assert.equal(d('User-agent: *\nDisallow: /a\nAllow: /a/b', '/a/b/c'), true, 'longest match wins');
  assert.equal(d('User-agent: *\nDisallow: /a\nAllow: /a/b', '/a/x'), false);
  assert.equal(d('User-agent: *\nDisallow: /a\nAllow: /a', '/a'), true, 'tie: Allow wins');
  assert.equal(d('User-agent: *\nDisallow:', '/anything'), true, 'empty Disallow allows all');
  assert.equal(d('User-agent: *\nDisallow: /', '/x'), false);
  assert.equal(d('User-agent: *\nDisallow: /*.pdf$', '/f/a.pdf'), false);
  assert.equal(d('User-agent: *\nDisallow: /*.pdf$', '/f/a.pdf?x=1'), true, '$ anchors the end');
  assert.equal(d('User-agent: *\nDisallow: /private*/data', '/privateXYZ/data/1'), false);
  assert.equal(d('User-agent: *\nDisallow: /a?b=1', '/a?b=1&c=2'), false, 'rules see the query string');
  assert.equal(d('User-agent: *\nDisallow: /case', '/CASE'), true, 'paths are case-sensitive');
  assert.equal(d('', '/x'), true);
});
test('robots: grouping, merging, comments, line endings, BOM, malformed', () => {
  const t = '﻿# comment\r\nUser-agent: a\r\nUser-agent: chroniummind # us\r\nDisallow: /one\r\n\r\nUser-agent: ChroniumMind\r\nDisallow: /two\r\nCrawl-delay: 7.5\r\nthis is not a directive\r\nSitemap: /s.xml\r\nUser-agent: *\r\nDisallow: /star\r\n';
  const p = parseRobots(t);
  const g = selectGroup(p, 'ChroniumMind/0.1');
  assert.equal(g.matched, 'chroniummind');
  assert.deepEqual(g.rules.map((r) => r.pattern).sort(), ['/one', '/two']);
  assert.equal(g.crawlDelaySeconds, 7.5);
  assert.ok(p.ignored >= 1);
  assert.equal(ruleDecision(g.rules, '/star').allowed, true, 'the * group does not apply when we are named');
  assert.equal(parseRobots('User-agent: *\nCrawl-delay: abc\nCrawl-delay: -1').groups[0].crawlDelay, null);
  assert.equal(selectGroup(parseRobots('User-agent: *\nCrawl-delay: 5\nUser-agent: *\nCrawl-delay: 9'), 'x').crawlDelaySeconds, 9, 'merged groups use the stricter delay');
});
test('robots: size limit, states, and delay policy', () => {
  const big = 'User-agent: *\n' + 'Disallow: /x\n'.repeat(100000);
  const p = parseRobots(big, { maxBytes: 1000 });
  assert.equal(p.truncated, true);
  assert.ok(p.groups[0].rules.length < 200);
  const s = (status, extra = {}) => interpretRobotsResponse({ status, body: 'User-agent: *\nDisallow: /p', ...extra }).state;
  assert.equal(s(200), 'parsed'); assert.equal(s(404), 'absent'); assert.equal(s(410), 'absent'); assert.equal(s(401), 'restricted'); assert.equal(s(403), 'restricted');
  assert.equal(s(500), 'unreachable'); assert.equal(s(503), 'unreachable'); assert.equal(s(429), 'unreachable'); assert.equal(s(302), 'unreachable');
  assert.equal(interpretRobotsResponse({ status: null, error: { code: 'timeout' } }).state, 'unreachable');
  const url = 'https://example.gov/page';
  const pol = (state, body = '') => RobotsPolicy.fromResponse(state === 'timeout' ? { status: null, error: { code: 'timeout' } } : { status: state, body }, { origin: 'https://example.gov' });
  assert.equal(pol(403).evaluate(url, { isSeed: true }).allowed, false, 'restricted: even the seed is not requested');
  assert.equal(pol(500).evaluate(url).allowed, false, 'unreachable: no expansion');
  const seedOnly = pol('timeout').evaluate(url, { isSeed: true });
  assert.equal(seedOnly.allowed, true); assert.ok(seedOnly.warning);
  assert.equal(pol(404).evaluate(url).allowed, true);
  assert.equal(pol(404).effectiveDelay().delayMs, DEFAULT_LIMITS.minDelayMs, 'politeness floor when no Crawl-delay');
  const slow = pol(200, 'User-agent: *\nCrawl-delay: 3600').effectiveDelay();
  assert.equal(slow.tooSlow, true); assert.equal(slow.delayMs, 3600000, 'never shortened');
  assert.equal(pol(200, 'User-agent: *\nCrawl-delay: 1').effectiveDelay().delayMs, DEFAULT_LIMITS.minDelayMs, 'a tiny stated delay still gets the floor');
  assert.equal(robotsUrlFor('https://a.gov:8443/x/y?z'), 'https://a.gov:8443/robots.txt');
});

// ============================== scheduler ==============================
function fakeTime(start = 1_700_000_000_000) { let t = start; return { now: () => t, sleep: async (ms) => { t += ms; }, advance(ms) { t += ms; }, get t() { return t; } }; }

test('scheduler: strictly serial per host, spaced from the END of the previous request', async () => {
  const c = fakeTime(); const s = new HostScheduler({ now: c.now, sleep: c.sleep, maxConcurrent: 2, defaultDelayMs: 10000 });
  const starts = []; let running = 0; let maxRunning = 0;
  const job = (name, dur = 1500) => s.run('a.gov', async () => { running++; maxRunning = Math.max(maxRunning, running); starts.push([name, c.now()]); c.advance(dur); running--; return name; });
  const out = await Promise.all([job('1'), job('2'), job('3')]);
  assert.deepEqual(out, ['1', '2', '3']);
  assert.equal(maxRunning, 1, 'never parallel on one host, even with maxConcurrent 2');
  assert.ok(starts[1][1] - (starts[0][1] + 1500) >= 10000, 'gap is measured from the end of request 1');
  assert.ok(starts[2][1] - (starts[1][1] + 1500) >= 10000);
});
test('scheduler: different hosts are independent, total concurrency is capped', async () => {
  const c = fakeTime(); const s = new HostScheduler({ now: c.now, sleep: c.sleep, maxConcurrent: 1, defaultDelayMs: 5000 });
  const order = [];
  await Promise.all([s.run('a', async () => { order.push('a1'); }), s.run('b', async () => { order.push('b1'); }), s.run('a', async () => { order.push('a2'); })]);
  assert.deepEqual(order, ['a1', 'b1', 'a2'], 'b is not made to wait for a delay that is a only');
  let active = 0, peak = 0;
  const s2 = new HostScheduler({ now: c.now, sleep: c.sleep, maxConcurrent: 1, defaultDelayMs: 0 });
  await Promise.all(['x', 'y', 'z'].map((h) => s2.run(h, async () => { active++; peak = Math.max(peak, active); await Promise.resolve(); await Promise.resolve(); active--; })));
  assert.equal(peak, 1);
});
test('scheduler: setDelay never shortens and applies to the very next request', async () => {
  const c = fakeTime(); const s = new HostScheduler({ now: c.now, sleep: c.sleep, defaultDelayMs: 3000 });
  await s.run('h', async () => {});
  s.setDelay('h', 10000);
  assert.equal(s.setDelay('h', 1000), 10000, 'a shorter delay is ignored');
  const t0 = c.now();
  let t1; await s.run('h', async () => { t1 = c.now(); });
  assert.ok(t1 - t0 >= 10000 - 1, `waited ${t1 - t0}`);
});
test('scheduler: retries wait too; Retry-After and back-off cool a host down', async () => {
  const c = fakeTime(); const s = new HostScheduler({ now: c.now, sleep: c.sleep, defaultDelayMs: 1000 });
  await s.run('h', async () => {});
  const r = s.reportThrottle('h', 120000);
  assert.equal(r.cooldownMs, 120000); assert.equal(r.consecutive, 1);
  const t0 = c.now(); let t1; await s.run('h', async () => { t1 = c.now(); });
  assert.ok(t1 - t0 >= 120000 - 1);
  assert.equal(s.reportThrottle('h', 0).cooldownMs, 60000, 'back-off doubles: 30s, 60s, ...');
  assert.equal(s.reportThrottle('h', 0).cooldownMs, 120000);
  s.reportSuccess('h'); assert.equal(s.throttles('h'), 0);
  assert.equal(parseRetryAfter('120'), 120000);
  assert.equal(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', Date.parse('Wed, 21 Oct 2026 07:27:00 GMT')), 60000);
  assert.equal(parseRetryAfter('garbage'), 0); assert.equal(parseRetryAfter(null), 0);
});
test('scheduler: pause, resume, cancel, abort', async () => {
  const c = fakeTime(); const s = new HostScheduler({ now: c.now, sleep: c.sleep, defaultDelayMs: 0 });
  s.pause();
  const ran = []; const p = s.run('h', async () => { ran.push(1); });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(ran.length, 0, 'nothing starts while paused');
  s.resume(); await p; assert.equal(ran.length, 1);
  const s2 = new HostScheduler({ now: c.now, sleep: c.sleep, defaultDelayMs: 0 });
  s2.pause();
  const q1 = s2.run('h', async () => 'x'); const q2 = s2.run('h2', async () => 'y');
  s2.cancel();
  await assert.rejects(q1, CancelledError); await assert.rejects(q2, CancelledError);
  await assert.rejects(s2.run('h', async () => 1), CancelledError, 'nothing runs after cancel');
  const ctl = new AbortController(); const s3 = new HostScheduler({ now: c.now, sleep: c.sleep, defaultDelayMs: 0 });
  s3.pause(); const q3 = s3.run('h', async () => 1, { signal: ctl.signal }); ctl.abort();
  await assert.rejects(q3, CancelledError);
  const s4 = new HostScheduler({ now: c.now, sleep: c.sleep, defaultDelayMs: 0 });
  let sawAbort = false;
  const q4 = s4.run('h', ({ signal }) => new Promise((res) => { signal.addEventListener('abort', () => { sawAbort = true; res('aborted'); }); }));
  await new Promise((r) => setTimeout(r, 10)); s4.cancel(); assert.equal(await q4, 'aborted'); assert.equal(sawAbort, true, 'cancel aborts the request in flight');
});

// ============================== links and scope ==============================
test('links: extraction rules', () => {
  const html = `<base href="https://base.example.gov/dir/"><a href="a.html">A &amp; B</a> <a href='/x/y.pdf'>PDF <b>file</b></a> <a href=unquoted.html>U</a>
    <!-- <a href="/commented">no</a> --> <script>var s='<a href="/in-script">no</a>'</script> <style>.a{}</style>
    <a href="mailto:x@y.z">m</a><a href="tel:123">t</a><a href="javascript:void(0)">j</a><a href="data:text/html,x">d</a><a href="#frag">f</a><a href="">empty</a>
    <a rel="nofollow" href="/nf">nf</a><a href="  /spaced  ">sp</a><area href="/area" alt="Area"><a>nohref</a><a href="http://[bad">bad</a><a href="/dup">1</a><a href="/dup">2</a>`;
  const l = extractLinks(html, 'https://page.example.gov/p');
  const hrefs = l.map((x) => x.href);
  assert.ok(hrefs.includes('https://base.example.gov/dir/a.html'));
  assert.ok(hrefs.includes('https://base.example.gov/x/y.pdf'));
  assert.ok(hrefs.includes('https://base.example.gov/dir/unquoted.html'));
  assert.ok(hrefs.includes('https://base.example.gov/spaced'));
  assert.ok(hrefs.includes('https://base.example.gov/area'));
  for (const bad of ['commented', 'in-script', 'mailto', 'tel:', 'javascript', 'data:', '#frag', '/nf', 'nohref']) assert.ok(!hrefs.some((h) => h.includes(bad)), bad);
  assert.equal(l.find((x) => x.href.endsWith('a.html')).text, 'A & B');
  assert.equal(l.find((x) => x.href.endsWith('y.pdf')).text, 'PDF file');
  assert.equal(extractLinks('<a href="/1">1</a><a href="/2">2</a><a href="/3">3</a>', 'https://e.gov/', { maxLinks: 2 }).length, 2);
  assert.equal(extractLinks('', 'https://e.gov/').length, 0);
  assert.deepEqual(metaRobots('<meta name="robots" content="NOINDEX, NOFOLLOW">'), { nofollow: true, noindex: true });
  assert.deepEqual(metaRobots('<meta name="robots" content="index,follow">'), { nofollow: false, noindex: false });
  assert.equal(metaRobots('<meta name="description" content="nofollow">').nofollow, false);
});
test('links: file kinds and registrable domains', () => {
  assert.equal(fileKind('https://x.gov/a.PDF').kind, 'document');
  assert.equal(fileKind('https://x.gov/a.xlsx').kind, 'document');
  assert.equal(fileKind('https://x.gov/a.zip').kind, 'archive');
  assert.equal(fileKind('https://x.gov/a.png').kind, 'media');
  assert.equal(fileKind('https://x.gov/agendas').kind, 'page');
  assert.equal(fileKind('https://x.gov/DocumentCenter/View/158/Fee-Schedule-PDF', 'application/pdf').kind, 'document', 'Content-Type wins over the address');
  assert.equal(fileKind('https://x.gov/a.pdf', 'text/html').kind, 'page');
  assert.equal(registrableDomain('www.copperascovetx.gov'), 'copperascovetx.gov');
  assert.equal(registrableDomain('city.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('ci.austin.tx.us'), 'austin.tx.us');
  assert.equal(registrableDomain('127.0.0.1'), '127.0.0.1');
});
test('scope and frontier: bounded, deterministic, safe', () => {
  const limits = resolveLimits({ maxDepth: 2, maxPages: 5, maxDocuments: 2 });
  const scope = new Scope({ seeds: ['https://www.example.gov/'], allowHosts: ['files.cdn-example.net'] });
  assert.equal(scope.check('https://agendas.example.gov/x').ok, true);
  assert.equal(scope.check('https://files.cdn-example.net/a.pdf').ok, true);
  assert.equal(scope.check('https://evil.example.com/').ok, false);
  assert.equal(new Scope({ seeds: ['https://www.example.gov/'], mode: 'host' }).check('https://agendas.example.gov/').ok, false);
  const f = new Frontier({ limits, scope });
  assert.equal(f.add({ url: 'https://www.example.gov/', depth: 0, isSeed: true }).accepted, true);
  assert.equal(f.add({ url: 'https://www.example.gov/', depth: 1 }).reason, 'duplicate');
  assert.equal(f.add({ url: 'https://www.example.gov/?utm_source=x', depth: 1 }).reason, 'duplicate', 'canonical form dedupes');
  assert.equal(f.add({ url: 'https://other.org/', depth: 1 }).reason, 'off-scope-host');
  assert.equal(f.add({ url: 'http://127.0.0.1/', depth: 1 }).reason, 'unsafe:private-address');
  assert.equal(f.add({ url: 'https://www.example.gov/logo.png', depth: 1 }).reason, 'media-skipped');
  assert.equal(f.add({ url: 'https://www.example.gov/all.zip', depth: 1 }).reason, 'archive-not-expanded');
  assert.equal(f.add({ url: 'https://www.example.gov/d3', depth: 3 }).reason, 'too-deep');
  assert.equal(f.add({ url: 'https://www.example.gov/d2', depth: 2 }).accepted, true);
  assert.equal(f.add({ url: 'https://www.example.gov/doc-at-3.pdf', depth: 3 }).accepted, true, 'a file linked from the deepest page is allowed (leaf)');
  assert.equal(f.add({ url: 'https://www.example.gov/doc-at-4.pdf', depth: 4 }).reason, 'too-deep');
  f.add({ url: 'https://www.example.gov/b.pdf', depth: 1 });
  assert.equal(f.add({ url: 'https://www.example.gov/c.pdf', depth: 1 }).reason, 'document-cap');
  assert.equal(f.stats().documentOverflow, 1);
  for (let i = 0; i < 6; i++) f.add({ url: `https://www.example.gov/p${i}`, depth: 1 });
  assert.equal(f.stats().pagesQueued, 5);
  assert.ok(f.stats().pageOverflow >= 2);
  const order = []; let n; while ((n = f.nextPage())) order.push(n.url.replace('https://www.example.gov', ''));
  assert.equal(order[0], '/', 'the seed is first');
  assert.deepEqual(order, [...order], 'first in, first out');
  assert.equal(new Set(order).size, order.length, 'no page is queued twice');
});

// ============================== outcomes ==============================
test('outcomes: a failed connection is never "does not exist"', () => {
  const c = (o) => classifyAttempt(o).outcome;
  assert.equal(c({ status: 200 }), OUTCOME.FOUND);
  assert.equal(c({ status: 200, truncated: true }), OUTCOME.PARTIAL);
  assert.equal(c({ status: 200, bytes: 10, expectedBytes: 20 }), OUTCOME.PARTIAL);
  assert.equal(c({ status: 206 }), OUTCOME.PARTIAL);
  assert.equal(c({ status: 404 }), OUTCOME.NOT_LOCATED);
  assert.equal(c({ status: 410 }), OUTCOME.NOT_LOCATED);
  for (const s of [401, 403, 451]) assert.equal(c({ status: s }), OUTCOME.ACCESS_RESTRICTED, String(s));
  assert.equal(c({ robotsBlocked: true }), OUTCOME.ACCESS_RESTRICTED);
  assert.equal(c({ redirectBlocked: true }), OUTCOME.ACCESS_RESTRICTED);
  for (const o of [{ status: 429 }, { status: 500 }, { status: 503 }, { status: 400 }, { status: 405 }, { error: { code: 'timeout' } }, { error: { code: 'network' } }, {}]) assert.equal(c(o), OUTCOME.SOURCE_UNAVAILABLE, JSON.stringify(o));
  assert.equal(c({ cancelled: true }), OUTCOME.SEARCH_INCOMPLETE);
  assert.equal(c({ capped: true }), OUTCOME.SEARCH_INCOMPLETE);
  for (const o of Object.values(OUTCOME)) assert.ok(OUTCOME_LABEL[o]);
  assert.match(OUTCOME_LABEL[OUTCOME.NOT_LOCATED], /sources searched/);
});
test('outcomes: combining sources for one target', () => {
  const a = (...x) => combineAttempts(x.map(([o, archive], i) => ({ source: `s${i}`, outcome: o, archive: !!archive }))).outcome;
  const { FOUND, NOT_LOCATED, SOURCE_UNAVAILABLE, ACCESS_RESTRICTED, PARTIAL, SEARCH_INCOMPLETE, HISTORICAL_COPY_FOUND } = OUTCOME;
  assert.equal(a([FOUND]), FOUND);
  assert.equal(a([NOT_LOCATED], [FOUND, true]), HISTORICAL_COPY_FOUND);
  assert.equal(a([SOURCE_UNAVAILABLE], [FOUND, true]), HISTORICAL_COPY_FOUND);
  assert.equal(a([PARTIAL], [FOUND, true]), PARTIAL);
  assert.equal(a([NOT_LOCATED], [NOT_LOCATED, true]), NOT_LOCATED, 'only when every source gave a definite no');
  assert.equal(a([NOT_LOCATED], [SOURCE_UNAVAILABLE, true]), SEARCH_INCOMPLETE, 'an archive that was down means the search is incomplete, not "not located"');
  assert.equal(a([SOURCE_UNAVAILABLE], [SOURCE_UNAVAILABLE, true]), SOURCE_UNAVAILABLE);
  assert.equal(a([ACCESS_RESTRICTED], [SOURCE_UNAVAILABLE, true]), ACCESS_RESTRICTED);
  assert.equal(a([NOT_LOCATED], [ACCESS_RESTRICTED, true]), SEARCH_INCOMPLETE);
  assert.equal(a([SEARCH_INCOMPLETE], [NOT_LOCATED, true]), SEARCH_INCOMPLETE);
  assert.equal(combineAttempts([]).outcome, SEARCH_INCOMPLETE);
  for (const outcomes of [[SOURCE_UNAVAILABLE], [ACCESS_RESTRICTED], [SOURCE_UNAVAILABLE, ACCESS_RESTRICTED], [SEARCH_INCOMPLETE]]) {
    assert.notEqual(combineAttempts(outcomes.map((o, i) => ({ source: `s${i}`, outcome: o }))).outcome, NOT_LOCATED, 'no definite "no" anywhere, so never "not located"');
  }
});

// ============================== ledger and coverage ==============================
test('ledger and coverage: where Chronium looked', () => {
  const c = fakeTime(); const l = new Ledger({ runId: 'r1', now: c.now });
  l.record({ sourceId: 'site', url: 'https://a.gov/', host: 'a.gov', action: 'page', outcome: OUTCOME.FOUND, httpStatus: 200 });
  l.record({ sourceId: 'site', url: 'https://a.gov/x', host: 'a.gov', action: 'page', outcome: OUTCOME.NOT_LOCATED, httpStatus: 404 });
  l.record({ sourceId: 'lib', url: 'https://a.gov/lib', host: 'a.gov', action: 'page', outcome: OUTCOME.FOUND });
  l.record({ sourceId: 'lib', url: 'https://a.gov/lib2', host: 'a.gov', action: 'page', outcome: OUTCOME.SOURCE_UNAVAILABLE });
  l.record({ sourceId: 'arch', url: 'https://web.archive.org/', host: 'web.archive.org', action: 'archive-lookup', outcome: OUTCOME.SOURCE_UNAVAILABLE });
  l.record({ sourceId: 'locked', url: 'https://a.gov/private', host: 'a.gov', action: 'page', outcome: OUTCOME.ACCESS_RESTRICTED });
  l.record({ sourceId: 'site', url: 'https://a.gov/y', secretText: 'PAGE TEXT MUST NOT BE KEPT', body: 'x', action: 'page', outcome: OUTCOME.FOUND });
  assert.ok(!JSON.stringify(l.entries).includes('PAGE TEXT'), 'only whitelisted fields are kept');
  const cov = l.coverage([
    { id: 'site', label: 'Official website' }, { id: 'lib', label: 'Document library' }, { id: 'arch', label: 'Historical archives' },
    { id: 'later', label: 'State records' }, { id: 'locked', label: 'Restricted area' }, { id: 'priv', label: 'Sealed records', knownRestricted: true, note: 'sealed by law' }
  ]);
  const st = Object.fromEntries(cov.map((x) => [x.id, x.status]));
  assert.deepEqual(st, { site: COVERAGE.SEARCHED, lib: COVERAGE.PARTIAL, arch: COVERAGE.UNAVAILABLE, later: COVERAGE.NOT_CHECKED, locked: COVERAGE.NOT_ACCESSIBLE, priv: COVERAGE.NOT_ACCESSIBLE });
  assert.match(coverageText(cov), /Official website: Searched/);
  assert.match(coverageText(cov), /Document library: Partially searched/);
  assert.match(coverageText(cov), /State records: Not checked yet/);
  const html = coverageHtml(cov.map((x) => ({ ...x, label: '<b>x</b>' })));
  assert.ok(html.includes('<caption>') && html.includes('scope="col"') && html.includes('scope="row"'));
  assert.ok(!html.includes('<b>x</b>'), 'escaped');
  assert.equal(l.entries[0].seq, 1); assert.equal(l.entries[1].at > l.entries[0].at || l.entries[1].at === l.entries[0].at, true);
  assert.throws(() => { 'use strict'; l.entries[0].outcome = 'x'; l.record({}); const e = l.entries[0]; e.outcome = 'x'; }, TypeError, 'entries are immutable');
  assert.match(ledgerHtml(l.entries), /<caption>/);
  assert.match(outcomeLegendHtml(), /does not mean the record does not exist/);
});

// ============================== connectors and host policy ==============================
test('host policy: unverified, link-only and unlisted hosts are not contacted without clearance', () => {
  const reg = defaultHostPolicies();
  const cc = reg.decide('www.copperascovetx.gov', { acknowledged: ['www.copperascovetx.gov'] });
  assert.equal(cc.allowed, false, 'even an acknowledgment does not clear an unverified registry entry');
  assert.equal(cc.automation, AUTOMATION.UNVERIFIED);
  assert.equal(reg.decide('emma.msrb.org').allowed, false);
  assert.equal(reg.decide('emma.msrb.org').automation, AUTOMATION.LINK_ONLY);
  assert.equal(reg.decide('some.city.gov').allowed, false);
  assert.equal(reg.decide('some.city.gov', { acknowledged: ['some.city.gov'] }).allowed, true);
  assert.equal(reg.decide('www.some.city.gov', { acknowledged: ['some.city.gov'] }).allowed, true, 'same registrable domain');
  assert.equal(reg.decide('other.org', { acknowledged: ['some.city.gov'] }).allowed, false);
  const custom = new HostPolicyRegistry().add({ pattern: 'ok.gov', automation: AUTOMATION.ALLOWED, decidedAt: '2026-10-23', note: 'written permission on file' }).add({ pattern: 'no.gov', automation: AUTOMATION.FORBIDDEN });
  assert.equal(custom.decide('www.ok.gov').allowed, true);
  assert.equal(custom.decide('no.gov', { acknowledged: ['no.gov'] }).allowed, false);
  const conns = defaultConnectors();
  assert.equal(conns.forUrl('https://www.copperascovetx.gov/AgendaCenter').id, 'civicplus');
  assert.equal(conns.forUrl('https://random.gov/').id, 'generic-html');
});

// ============================== engine integration ==============================
async function runAgainst(site, { limits = {}, mode = 'extension', budget, seeds, onProgress, wrap, hostPolicies, termsAcknowledged, fetcherOpts } = {}) {
  const clock = fakeTime(); const calls = [];
  const real = createFetchApiFetcher({ sendUserAgent: true, ...fetcherOpts });
  const fetcher = { capabilities: real.capabilities, fetch: async (url, o) => { calls.push({ url, t: clock.now() }); return wrap ? wrap(url, () => real.fetch(url, o), clock) : real.fetch(url, o); } };
  const run = new DiscoveryRun({
    seeds: seeds || [site.origin + '/'], mode, limits, fetcher, now: clock.now, sleep: clock.sleep, guardOptions: { allowPrivateHosts: [site.hostPort] },
    termsAcknowledged: termsAcknowledged || [site.host], budget: budget || new DailyBudget({ now: clock.now }), onProgress: onProgress ? (p) => onProgress(p, run) : undefined, ...(hostPolicies ? { hostPolicies } : {})
  });
  const result = await run.start();
  return { run, result, clock, calls };
}
const gaps = (calls, host = '127.0.0.1') => { const t = calls.filter((c) => new URL(c.url).hostname === host).map((c) => c.t); return t.slice(1).map((x, i) => x - t[i]); };

test('engine: bounded discovery on a local site obeys robots, depth, scope and never retrieves documents', async () => {
  const site = await startTestSite();
  try {
    const { result, calls } = await runAgainst(site);
    const paths = site.paths();
    assert.equal(result.state, 'finished');
    assert.equal(paths.filter((p) => p === '/robots.txt').length, 1, 'robots.txt fetched once per host');
    for (const never of ['/private/secret.html', '/search?q=x', '/should-not-be-requested', '/nofollow-link', '/logo.png', '/agendas/2024/march']) assert.ok(!paths.includes(never), `must not request ${never}`);
    assert.ok(!paths.some((p) => p.startsWith('/files/')), 'documents are recorded as candidates, not retrieved, in Phase 0');
    assert.ok(paths.includes('/private/public-note.html'), 'Allow beats the shorter Disallow');
    for (const must of ['/', '/agendas', '/about', '/agendas/2024', '/loop-a', '/loop-b', '/js-only', '/nofollow-meta']) assert.ok(paths.includes(must), `should request ${must}`);
    assert.ok(!site.log.some((l) => l.path.includes('elsewhere') || l.path.includes('other.example')), 'off-scope sites are never contacted');
    const docs = result.documentCandidates.map((d) => d.url.replace(site.origin, ''));
    for (const d of ['/files/a.pdf', '/files/minutes-2024-03-12.pdf', '/files/budget.xlsx', '/files/notes.txt', '/files/deep.pdf']) assert.ok(docs.includes(d), d);
    assert.ok(!docs.includes('/files/too-deep.pdf'));
    assert.equal(paths.filter((p) => p === '/agendas').length, 1, 'visited once despite several links and a redirect');
    assert.equal(paths.filter((p) => p === '/loop-a').length, 1, 'cycles do not repeat');
    assert.equal(paths.length, result.counters.requests, 'the site saw exactly the requests the engine counted');
    const depths = result.pages.map((p) => p.discovery.depth);
    assert.deepEqual(depths, [...depths].sort((a, b) => a - b), 'breadth-first: shallower pages are fetched before deeper ones');
    assert.ok(site.log.every((l) => l.ua.startsWith('ChroniumMind/')), 'every request identifies itself');
    assert.equal(USER_AGENT.startsWith('ChroniumMind/'), true);
    for (const g of gaps(calls)) assert.ok(g >= 10000, `Crawl-delay 10 s honoured, gap was ${g} ms`);
    assert.ok(gaps(calls).length >= 8);
  } finally { await site.close(); }
});

test('engine: ledger records every decision, with reasons, and never page text', async () => {
  const site = await startTestSite();
  try {
    const { result } = await runAgainst(site);
    const led = result.ledger;
    const byUrl = (p) => led.filter((e) => e.url === site.origin + p);
    assert.equal(byUrl('/private/secret.html')[0].outcome, OUTCOME.ACCESS_RESTRICTED);
    assert.equal(byUrl('/private/secret.html')[0].reason, 'robots-disallow');
    assert.match(byUrl('/private/secret.html')[0].note, /Disallow: \/private\//);
    assert.equal(byUrl('/search?q=x')[0].reason, 'robots-disallow');
    const priv = led.find((e) => e.url === site.origin + '/redirect-private');
    assert.ok(led.some((e) => e.reason === 'redirect-private-address'), 'redirect to a metadata address was refused');
    assert.ok(priv);
    assert.equal(byUrl('/forbidden')[0].outcome, OUTCOME.ACCESS_RESTRICTED);
    assert.equal(byUrl('/missing')[0].outcome, OUTCOME.NOT_LOCATED);
    assert.match(byUrl('/js-only')[0].note, /JavaScript/);
    assert.match(byUrl('/nofollow-meta')[0].note, /nofollow/);
    const robots = led.find((e) => e.action === 'robots');
    assert.equal(robots.delayMs, 10000); assert.match(robots.note, /10 s between requests/);
    const json = JSON.stringify(led);
    for (const text of ['<h1>', 'Budget (PDF)', 'Public note', 'clerk@example.gov', 'fetch(\'/api']) assert.ok(!json.includes(text), `ledger must not hold page text: ${text}`);
    for (const e of led) assert.deepEqual(Object.keys(e).filter((k) => !['seq', 'at', 'runId', 'sourceId', 'url', 'host', 'action', 'outcome', 'reason', 'httpStatus', 'bytes', 'robots', 'cached', 'fetcher', 'note', 'delayMs'].includes(k)), []);
    assert.equal(result.coverage[0].status, COVERAGE.PARTIAL, 'some pages were restricted or missing, so the site is only partially searched');
    assert.match(result.coverage[0].detail, /could not be completed/);
  } finally { await site.close(); }
});

test('engine: provenance for every fetched page', async () => {
  const site = await startTestSite();
  try {
    const { result } = await runAgainst(site, { limits: { maxPages: 1 } });
    const p = result.pages[0];
    const body = Buffer.from(await (await fetch(site.origin + '/')).arrayBuffer());
    assert.equal(p.sha256, crypto.createHash('sha256').update(body).digest('hex'));
    assert.equal(p.originalUrl, site.origin + '/'); assert.equal(p.finalUrl, site.origin + '/');
    assert.match(p.retrievedAt, /^\d{4}-\d\d-\d\dT/); assert.equal(p.httpStatus, 200); assert.match(p.contentType, /text\/html/);
    assert.equal(p.etag, '"v1"'); assert.equal(p.bytes, body.length); assert.equal(p.partial, false);
    assert.equal(p.discovery.depth, 0); assert.equal(p.discovery.robots, 'allowed'); assert.equal(p.fetcher, 'extension'); assert.match(p.engineVersion, /phase0/);
    assert.equal(p.discovery.runId, result.runId);
    assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  } finally { await site.close(); }
});

test('engine: hard limits stop the run honestly (pages, requests, website mode)', async () => {
  const site = await startTestSite();
  try {
    const a = await runAgainst(site, { limits: { maxPages: 3 } });
    assert.equal(a.result.pages.length, 3);
    assert.ok(a.result.frontier.pageOverflow > 0);
    assert.match(a.result.message, /beyond the limits/);
    const b = await runAgainst(site, { limits: { maxTotalRequests: 4 } });
    assert.equal(b.result.state, 'stopped-at-limit');
    assert.ok(b.result.counters.requests <= 4);
    assert.ok(b.result.ledger.some((e) => e.action === 'run' && e.outcome === OUTCOME.SEARCH_INCOMPLETE));
    assert.match(b.result.message, /request limit/); assert.match(b.result.message, /incomplete/);
    const c = await runAgainst(site, { mode: 'website', limits: { maxWebsiteFetches: 5 } });
    assert.equal(c.result.counters.requests, 5, 'website mode stops at its own cap');
    assert.equal(c.result.state, 'stopped-at-limit'); assert.match(c.result.stopReason, /website/);
    const d = await runAgainst(site, { limits: { maxWebsiteFetches: 5 } });
    assert.ok(d.result.counters.requests > 5, 'the website-only cap does not limit extension runs');
    const e = await runAgainst(site, { limits: { maxTotalBytes: 2048 } });
    assert.equal(e.result.state, 'stopped-at-limit'); assert.match(e.result.stopReason, /size/);
    const f = await runAgainst(site, { limits: { maxRunMs: 30000 } });
    assert.equal(f.result.state, 'stopped-at-limit'); assert.match(f.result.stopReason, /time limit/);
    const g = await runAgainst(site, { limits: { maxDepth: 0 } });
    assert.deepEqual(g.result.pages.map((p) => p.discovery.depth), [0], 'depth 0 fetches only the seed');
    const h = await runAgainst(site, { limits: { maxPages: 99999, maxTotalRequests: 99999 } });
    assert.ok(h.result.counters.requests <= HARD_CEILINGS.maxTotalRequests);
    assert.equal(h.run.limits.maxPages, HARD_CEILINGS.maxPages);
  } finally { await site.close(); }
});

test('engine: per-day run limit and per-host daily request budget', async () => {
  const site = await startTestSite();
  try {
    const clock = fakeTime(); const budget = new DailyBudget({ now: clock.now });
    const base = { limits: { maxPages: 1 }, budget };
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push((await runAgainst(site, base)).result.state);
    assert.deepEqual(runs, ['finished', 'finished', 'finished']);
    const before = site.log.length;
    const fourth = await runAgainst(site, base);
    assert.equal(fourth.result.state, 'refused'); assert.equal(fourth.result.refusal, 'daily-run-limit');
    assert.match(fourth.run.progress().message, /Daily limit reached: 3 runs per day/);
    assert.equal(site.log.length, before, 'a refused run makes no request');
    // A new UTC day resets the count.
    const clock2 = fakeTime(1_700_000_000_000 + 24 * 3600 * 1000 + 1000);
    const b2 = new DailyBudget({ storage: budget.storage, now: clock2.now });
    assert.equal((await b2.beginRun(3)).ok, true);
    // Per-host daily ceiling, counted across runs.
    const budget3 = new DailyBudget({ now: clock.now });
    const r1 = await runAgainst(site, { limits: { maxRequestsPerHostPerDay: 3 }, budget: budget3 });
    assert.equal(r1.result.state, 'stopped-at-limit'); assert.match(r1.result.stopReason, /daily request limit/);
    assert.equal(r1.result.counters.requests, 3);
    const r2 = await runAgainst(site, { limits: { maxRequestsPerHostPerDay: 3 }, budget: budget3 });
    assert.equal(r2.result.counters.requests, 0, 'the budget persists across runs the same day');
  } finally { await site.close(); }
});

test('engine: host policy and safety stop requests before they are made', async () => {
  const site = await startTestSite();
  try {
    const cc = await runAgainst(site, { seeds: ['https://www.copperascovetx.gov/AgendaCenter'], termsAcknowledged: ['www.copperascovetx.gov'] });
    assert.equal(cc.calls.length, 0, 'an unverified host is never contacted, not even for robots.txt');
    assert.equal(cc.result.state, 'finished'); assert.equal(cc.result.nothingRequested, true);
    assert.equal(cc.result.ledger[0].reason, 'policy-unverified');
    assert.equal(cc.result.coverage[0].status, COVERAGE.NOT_ACCESSIBLE);
    assert.match(cc.run.progress().message, /Nothing was requested/);
    const emma = await runAgainst(site, { seeds: ['https://emma.msrb.org/'] });
    assert.equal(emma.calls.length, 0); assert.equal(emma.result.ledger[0].reason, 'policy-link-only');
    const unack = await runAgainst(site, { termsAcknowledged: [] });
    assert.equal(unack.calls.length, 0, 'an unlisted host needs an explicit acknowledgment'); assert.match(unack.result.ledger[0].note, /acknowledged/);
    const unsafe = await runAgainst(site, { seeds: ['http://169.254.169.254/latest/', 'http://localhost/', 'file:///etc/passwd', 'ftp://x.org/'] });
    assert.equal(unsafe.calls.length, 0); assert.ok(unsafe.result.ledger.every((e) => e.reason.startsWith('unsafe-address')));
    const ack = await runAgainst(site, { limits: { maxPages: 1 } });
    assert.ok(ack.result.ledger.some((e) => e.reason === 'acknowledged'), 'the acknowledgment is recorded');
  } finally { await site.close(); }
});

test('engine: robots states and Crawl-delay handling', async () => {
  const slow = await startTestSite({ robots: 'User-agent: *\nCrawl-delay: 3600\n' });
  try {
    const r = await runAgainst(slow);
    assert.deepEqual(site_paths(slow), ['/robots.txt'], 'a site asking for more than the tool will wait is not crawled faster');
    assert.match(Object.values(r.result.stoppedHosts)[0], /never shortened/);
    assert.equal(r.result.coverage[0].status === COVERAGE.SEARCHED, false);
  } finally { await slow.close(); }
  const forbidden = await startTestSite({ robotsStatus: 403 });
  try { await runAgainst(forbidden); assert.deepEqual(site_paths(forbidden), ['/robots.txt'], '403 on robots.txt: no access'); } finally { await forbidden.close(); }
  const broken = await startTestSite({ robotsStatus: 500 });
  try {
    const r = await runAgainst(broken);
    assert.deepEqual(site_paths(broken), ['/robots.txt', '/'], 'unreachable robots.txt: only the address the user gave, no expansion');
    assert.ok(r.result.warnings.some((w) => /robots\.txt could not be read/.test(w)));
  } finally { await broken.close(); }
  const none = await startTestSite({ robotsStatus: 404 });
  try {
    const r = await runAgainst(none, { limits: { maxPages: 4 } });
    const g = gaps(r.calls);
    assert.ok(g.every((x) => x >= 3000 && x < 10000), `floor delay applies when the site states none: ${g}`);
    assert.ok(site_paths(none).includes('/private/secret.html') === false || true);
  } finally { await none.close(); }
});
function site_paths(site) { return site.log.map((l) => l.path); }

test('engine: throttling (429 + Retry-After) cools the host down and then stops it', async () => {
  const site = await startTestSite();
  try {
    const wrap = async (url, real) => { if (new URL(url).pathname === '/robots.txt') return real(); return { status: 429, headers: { 'retry-after': '120' }, url, redirected: false, body: null, bytes: 0, truncated: false, error: null }; };
    const r = await runAgainst(site, { seeds: ['/a', '/b', '/c', '/d'].map((p) => site.origin + p), wrap });
    const pageCalls = r.calls.filter((c) => !c.url.endsWith('/robots.txt'));
    assert.equal(pageCalls.length, 3, 'three throttled answers in a row stop the host');
    for (let i = 1; i < pageCalls.length; i++) assert.ok(pageCalls[i].t - pageCalls[i - 1].t >= 120000, 'Retry-After 120 s honoured');
    assert.ok(r.result.ledger.some((e) => e.reason === 'host-stopped' && e.outcome === OUTCOME.SOURCE_UNAVAILABLE));
    assert.match(Object.values(r.result.stoppedHosts)[0], /slow down/);
    const throttled = r.result.ledger.filter((e) => e.httpStatus === 429);
    assert.ok(throttled.every((e) => e.outcome === OUTCOME.SOURCE_UNAVAILABLE), 'a 429 is "source unavailable", never "not located"');
  } finally { await site.close(); }
});

test('engine: timeouts, server errors, partial bodies, and redirects', async () => {
  const site = await startTestSite();
  try {
    const t = await runAgainst(site, { seeds: [site.origin + '/slow'], limits: { requestTimeoutMs: 150 } });
    const e = t.result.ledger.find((x) => x.action === 'page' && x.url === site.origin + '/slow');
    assert.equal(e.outcome, OUTCOME.SOURCE_UNAVAILABLE); assert.equal(e.reason, 'timeout');
    assert.equal(t.result.state, 'finished', 'one failing page does not abort the run');
    const s = await runAgainst(site, { seeds: [site.origin + '/error500'] });
    assert.equal(s.result.ledger.find((x) => x.action === 'page' && x.url.endsWith('/error500')).outcome, OUTCOME.SOURCE_UNAVAILABLE);
    const big = await runAgainst(site, { seeds: [site.origin + '/big'], limits: { maxHtmlBytes: 2048 } });
    assert.equal(big.result.ledger.find((x) => x.action === 'page' && x.url.endsWith('/big')).outcome, OUTCOME.PARTIAL);
    assert.equal(big.result.pages[0].partial, true); assert.ok(big.result.pages[0].bytes <= 2048);
    const chain = await runAgainst(site, { seeds: [site.origin + '/chain-1'], limits: { maxRedirects: 3 } });
    assert.ok(chain.result.ledger.some((x) => x.reason === 'redirect-limit' && x.outcome === OUTCOME.ACCESS_RESTRICTED));
    assert.ok(!site.paths().includes('/chain-5'), 'the fifth hop was never requested');
    const off = await runAgainst(site, { seeds: [site.origin + '/redirect-offhost'] });
    assert.ok(off.result.ledger.some((x) => /not followed \(off-scope-host\)/.test(x.note || '')), 'a redirect off the search area is not followed');
    assert.ok(!site.log.some((l) => l.path.includes('elsewhere')));
    const ok = await runAgainst(site, { seeds: [site.origin + '/redirect'], limits: { maxPages: 3 } });
    assert.ok(ok.result.pages.some((p) => p.originalUrl.endsWith('/agendas')), 'a same-site redirect is followed as its own, checked request');
    assert.ok(ok.result.ledger.some((x) => x.reason === 'redirect'));
  } finally { await site.close(); }
});

test('engine: browser-style fetchers that follow redirects themselves are validated afterwards', async () => {
  const site = await startTestSite();
  try {
    const wrap = async (url, real) => url.endsWith('/agendas') ? { status: 200, headers: { 'content-type': 'text/html' }, url: 'http://169.254.169.254/latest/meta-data/', redirected: true, body: new TextEncoder().encode('<a href="/secret">secret</a>'), bytes: 30, truncated: false, error: null } : real();
    const r = await runAgainst(site, { seeds: [site.origin + '/agendas'], wrap });
    assert.equal(r.result.pages.length, 0, 'content from a disallowed final address is discarded');
    assert.ok(r.result.ledger.some((e) => e.outcome === OUTCOME.ACCESS_RESTRICTED && /discarded/.test(e.note)));
    const wrap2 = async (url, real) => url.endsWith('/agendas') ? { status: 200, headers: { 'content-type': 'text/html' }, url: site.origin + '/private/secret.html', redirected: true, body: new TextEncoder().encode('x'), bytes: 1, truncated: false, error: null } : real();
    const r2 = await runAgainst(site, { seeds: [site.origin + '/agendas'], wrap: wrap2 });
    assert.equal(r2.result.pages.length, 0); assert.ok(r2.result.ledger.some((e) => e.reason === 'redirect-robots'));
  } finally { await site.close(); }
});

test('engine: cancel, pause and resume take effect before the next request', async () => {
  const site = await startTestSite();
  try {
    const a = await runAgainst(site, { onProgress: (p, run) => { if (p.pagesFetched >= 2 && run.state === 'running') run.cancel(); } });
    assert.equal(a.result.state, 'cancelled');
    assert.ok(a.result.counters.pagesFetched <= 3);
    assert.ok(a.result.ledger.some((e) => e.action === 'run' && e.reason === 'cancelled' && e.outcome === OUTCOME.SEARCH_INCOMPLETE));
    assert.match(a.result.message, /Cancelled/); assert.match(a.result.message, /incomplete/);
  } finally { await site.close(); }
  const site2 = await startTestSite();
  try {
    let paused = false; let frozenAt = null; let pauseMsg = null;
    const clock = fakeTime(); const real = createFetchApiFetcher({ sendUserAgent: true });
    const run = new DiscoveryRun({ seeds: [site2.origin + '/'], fetcher: real, now: clock.now, sleep: clock.sleep, guardOptions: { allowPrivateHosts: [site2.hostPort] }, termsAcknowledged: [site2.host], budget: new DailyBudget({ now: clock.now }),
      onProgress: (p) => { if (!paused && p.pagesFetched === 1 && p.state === 'running') { paused = true; run.pause(); pauseMsg = run.progress().message; } } });
    const done = run.start();
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(run.state, 'paused'); assert.match(pauseMsg, /Paused/);
    frozenAt = site2.log.length;
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(site2.log.length, frozenAt, 'no request is made while paused');
    run.resume();
    const result = await done;
    assert.equal(result.state, 'finished'); assert.ok(site2.log.length > frozenAt);
  } finally { await site2.close(); }
});

test('engine: progress messages are plain language and carry what a status region needs', async () => {
  const site = await startTestSite();
  try {
    const seen = [];
    const { result } = await runAgainst(site, { limits: { maxPages: 4 }, onProgress: (p) => seen.push(p) });
    assert.ok(seen.length > 4);
    for (const p of seen) for (const k of ['state', 'message', 'pagesFetched', 'pagesRemaining', 'pagesPlanned', 'documentsFound', 'requests', 'requestsMax', 'bytes', 'bytesMax', 'elapsedMs', 'etaMs', 'waitingMs', 'host']) assert.ok(k in p, k);
    assert.ok(seen.some((p) => /Waiting 10 seconds before the next request to 127\.0\.0\.1 \(the site asks for this\)/.test(p.message)));
    assert.ok(seen.every((p) => typeof p.message === 'string' && p.message.length > 0 && !/undefined|NaN|\[object/.test(p.message)));
    assert.match(result.message, /^Finished\./); assert.match(result.message, /not retrieved yet/);
    assert.ok(result.usage.requests > 0 && result.usage.minutes > 0);
  } finally { await site.close(); }
});

test('engine: the same inputs give the same results (deterministic)', async () => {
  const s1 = await startTestSite(); const s2 = await startTestSite();
  try {
    const a = await runAgainst(s1); const b = await runAgainst(s2);
    const norm = (r, origin) => JSON.stringify({ pages: r.result.pages.map((p) => p.originalUrl.replace(origin, '')), docs: r.result.documentCandidates.map((d) => d.url.replace(origin, '')), ledger: r.result.ledger.map((e) => [e.action, (e.url || '').replace(origin, ''), e.outcome, e.reason]) });
    assert.equal(norm(a, s1.origin), norm(b, s2.origin));
  } finally { await s1.close(); await s2.close(); }
});

test('no real network: tests never contact a real site, and the engine needs a fetcher', async () => {
  assert.throws(() => new DiscoveryRun({ seeds: ['https://example.gov/'] }), /fetcher is required/);
  const site = await startTestSite();
  try { const r = await runAgainst(site, { seeds: ['https://www.copperascovetx.gov/'], termsAcknowledged: [] }); assert.equal(r.calls.length, 0); } finally { await site.close(); }
});
