#!/usr/bin/env node
// Starts one local Worker (port 8791, fresh state, test configuration) and runs every browser suite against it in turn.
// Usage: node scripts/run-browser-suites.mjs [suite-name ...]
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUITES = ['a11y', 'a11y-deep', 'a11y-modes', 'contrast', 'ask-browser', 'portable-browser', 'views-browser', 'crawler-page-browser', 'discovery-browser', 'discovery-ui', 'discovery-extension', 'recovery-ui', 'extension'];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : SUITES;
const vars = ['ENVIRONMENT:development', 'TEST_MODE:on', 'FEATURE_DISCOVERY_FETCH:on', 'FEATURE_DISCOVERY_CAPTURES:on', 'DISCOVERY_ALLOW_PRIVATE:127.0.0.1:8790', 'LIMIT_FETCH_PER_IP_PER_MIN:5000', 'LIMIT_FETCH_PER_SITE_PER_MIN:5000', 'LIMIT_FETCH_GLOBAL_PER_DAY:100000', 'LIMIT_CAPTURES_PER_IP_PER_MIN:5000', 'LIMIT_CAPTURES_GLOBAL_PER_DAY:100000'];
const CHROME = 'C:/Users/insur/.cache/puppeteer/chrome/win64-152.0.7977.75/chrome-win64/chrome.exe';
// The suites use two conventional ports (8787 and 8791); one Worker on each, same fresh test configuration.
const workers = [8787, 8791].map((port) => spawn(['npx', 'wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', fs.mkdtempSync(path.join(os.tmpdir(), `chronium-suites-${port}-`)), ...vars.flatMap((v) => ['--var', `"${v}"`])].join(' '), { cwd: root, shell: true, stdio: 'ignore' }));
let up = false;
for (let i = 0; i < 120 && !up; i++) {
  try { up = (await fetch('http://127.0.0.1:8787/api/health')).ok && (await fetch('http://127.0.0.1:8791/api/health')).ok; } catch { /* waiting */ }
  if (!up) await new Promise((r) => setTimeout(r, 1000));
}
const results = [];
if (!up) console.log('Worker did not start');
else for (const name of wanted) {
  const file = path.join('scripts', `test-${name}.mjs`);
  if (!fs.existsSync(path.join(root, file))) { results.push([name, 'missing']); continue; }
  const r = await new Promise((resolve) => {
    const c = spawn(process.execPath, [file, `--chrome=${CHROME}`, ...(name === 'crawler-page-browser' ? ['--url=http://127.0.0.1:8787/crawler'] : [])], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; c.stdout.on('data', (d) => out += d); c.stderr.on('data', (d) => out += d);
    const timer = setTimeout(() => c.kill(), 600000);
    c.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
  const pass = (r.out.match(/^PASS/gm) || []).length; const fail = (r.out.match(/^FAIL/gm) || []).length;
  results.push([name, r.code === 0 && fail === 0 ? 'ok' : 'FAILED', `${pass} pass / ${fail} fail (exit ${r.code})`]);
  if (r.code !== 0 || fail) { console.log(`---- ${name}\n${r.out.split('\n').filter((l) => /^FAIL|Error|error/.test(l)).slice(0, 12).join('\n')}`); }
}
try { execFileSync('powershell', ['-NoProfile', '-Command', 'Get-NetTCPConnection -LocalPort 8787,8791 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }'], { stdio: 'ignore' }); } catch { /* gone */ }
for (const w of workers) { try { w.kill(); } catch { /* gone */ } }
console.log('\n' + results.map((r) => r.join('  ')).join('\n'));
process.exit(results.every((r) => r[1] === 'ok') && up ? 0 : 1);
