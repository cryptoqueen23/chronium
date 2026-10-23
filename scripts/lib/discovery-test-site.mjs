// A small deterministic website for Deep Discovery tests. It serves the same
// pages every time and records every request it receives, so tests can assert
// not just what the engine found but what it asked for (and, just as
// important, what it never asked for).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = path.resolve(HERE, '..', '..', 'public', 'discovery');

const html = (body, title = 'Test') => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

export const DEFAULT_ROBOTS = `# test site
User-agent: *
Crawl-delay: 10
Disallow: /private/
Disallow: /search
Allow: /private/public-note.html

User-agent: ClaudeBot
Disallow: /
`;

export async function startTestSite({ robots = DEFAULT_ROBOTS, robotsStatus = 200 } = {}) {
  const log = [];
  const sockets = new Set();
  let port = 0;
  const pages = {
    '/': () => html(`<h1>Town</h1>
      <a href="/agendas">Agendas</a> <a href="/about">About</a> <a href="/files/a.pdf">Budget (PDF)</a>
      <a href="/private/secret.html">Private</a> <a href="/redirect">Old agendas</a> <a href="/redirect-private">Trap</a>
      <a href="/loop-a">Loop</a> <a href="/js-only">App</a> <a href="/nofollow-meta">Nofollow page</a>
      <a href="http://other.example.gov/x">Another site</a> <a href="mailto:clerk@example.gov">Mail</a> <a href="javascript:void(0)">JS</a>
      <a href="/logo.png"><img src="/logo.png" alt=""></a> <a href="/search?q=x">Search</a> <a href="#top">Top</a>
      <a href="/private/public-note.html">Public note</a> <a rel="nofollow" href="/nofollow-link">Nofollow link</a>`),
    '/agendas': () => html(`<a href="/agendas/2024">2024</a> <a href="/files/minutes-2024-03-12.pdf">Minutes March 12</a>
      <a href="/files/budget.xlsx">Budget workbook</a> <a href="/files/notes.txt">Notes</a> <a href="/">Home</a>`),
    '/agendas/2024': () => html(`<a href="/agendas/2024/march">March</a> <a href="/files/deep.pdf">Deep file</a> <a href="/agendas">Up</a>`),
    '/agendas/2024/march': () => html(`<a href="/files/too-deep.pdf">Too deep</a>`),
    '/about': () => html(`<a href="/">Home</a> <a href="/loop-a">Loop</a> <a href="/forbidden">Forbidden</a> <a href="/missing">Missing</a>`),
    '/loop-a': () => html(`<a href="/loop-b">B</a>`),
    '/loop-b': () => html(`<a href="/loop-a">A</a> <a href="/">Home</a>`),
    '/js-only': () => html(`<div id="app"></div><script>fetch('/api/list').then(r=>r.json()).then(()=>{});</script>`),
    '/nofollow-meta': () => `<!doctype html><html><head><meta name="robots" content="nofollow"></head><body><a href="/should-not-be-requested">x</a></body></html>`,
    '/private/secret.html': () => html('secret'),
    '/private/public-note.html': () => html('public note'),
    '/big': () => html('x'.repeat(60000))
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    log.push({ path: url.pathname + url.search, method: req.method, ua: req.headers['user-agent'] || '', at: Date.now() });
    const p = url.pathname;
    // Browser-test harness: serves the engine modules and a harness page from this same origin (so no CORS), not logged as site traffic.
    if (p === '/__harness') { log.pop(); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(HERE, 'discovery-harness.html'))); }
    if (p.startsWith('/__m/')) { log.pop(); const f = path.basename(p); if (!/^[A-Za-z]+\.js$/.test(f) || !fs.existsSync(path.join(MODULE_DIR, f))) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(MODULE_DIR, f))); }
    if (p === '/robots.txt') { res.writeHead(robotsStatus, { 'content-type': 'text/plain' }); return res.end(robotsStatus === 200 ? robots : 'no'); }
    if (p === '/redirect') { res.writeHead(302, { location: '/agendas' }); return res.end(); }
    if (p === '/redirect-private') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end(); }
    if (p === '/redirect-offhost') { res.writeHead(302, { location: 'http://elsewhere.example.org/' }); return res.end(); }
    const chain = p.match(/^\/chain-(\d+)$/);
    if (chain) { const n = Number(chain[1]); res.writeHead(302, { location: n >= 9 ? '/agendas' : `/chain-${n + 1}` }); return res.end(); }
    if (p === '/slow') return; // never answers; the engine's timeout must fire
    if (p === '/throttle') { res.writeHead(429, { 'retry-after': '120' }); return res.end('slow down'); }
    if (p === '/forbidden') { res.writeHead(403); return res.end('no'); }
    if (p === '/error500') { res.writeHead(500); return res.end('oops'); }
    if (p.startsWith('/files/')) { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end(PDF); }
    if (pages[p]) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', etag: '"v1"' }); return res.end(pages[p]()); }
    res.writeHead(404, { 'content-type': 'text/html' }); res.end(html('not found'));
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  return {
    origin: `http://127.0.0.1:${port}`, host: '127.0.0.1', port, hostPort: `127.0.0.1:${port}`, log,
    paths: () => log.map((l) => l.path),
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); })
  };
}
