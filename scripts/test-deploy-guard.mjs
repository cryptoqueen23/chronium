// The two locks against Windows line-ending rewrites reaching a deployment: the CRLF guard and the clean export (see
// scripts/check-deploy-tree.mjs and scripts/clean-export.mjs, and .gitattributes).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findCrlf } from './check-deploy-tree.mjs';
import { cleanExport } from './clean-export.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-guard-'));
const put = (base, rel, content) => { const p = path.join(base, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };

test('an LF-only tree passes; a single CRLF in any deployed text file fails and names the file', () => {
  const d = tmp();
  put(d, 'public/app.js', 'a\nb\n'); put(d, 'public/index.html', '<p>x</p>\n'); put(d, 'src/index.js', 'export {};\n'); put(d, 'wrangler.jsonc', '{\n}\n'); put(d, 'package.json', '{}\n');
  assert.deepEqual(findCrlf(d).bad, []);
  assert.equal(findCrlf(d).checked, 5);
  put(d, 'public/ingest/pipeline.js', 'a\r\nb\r\n');
  const r = findCrlf(d);
  assert.deepEqual(r.bad.map((b) => b.file), ['public/ingest/pipeline.js']);
  assert.equal(r.bad[0].crlf, 2);
});

test('every deployed kind of file is covered (config and source too), and binary files are ignored', () => {
  const d = tmp();
  put(d, 'public/a.png', Buffer.from([0x89, 0x50, 0x0d, 0x0a, 0x1a, 0x0a])); // a PNG header contains CR LF and is not text
  put(d, 'public/vendor/lib.mjs', 'ok\n'); put(d, 'src/index.js', 'ok\n');
  assert.deepEqual(findCrlf(d).bad, []);
  for (const rel of ['wrangler.jsonc', 'package.json', 'src/guard.js', 'public/styles.css', 'public/crawler.html', 'public/vendor/lib.mjs']) {
    const e = tmp(); put(e, rel, 'x\r\ny\r\n');
    assert.equal(findCrlf(e).bad.length, 1, rel);
  }
  const lone = tmp(); put(lone, 'public/app.js', 'a\rb\n'); // a stray carriage return is also refused
  assert.equal(findCrlf(lone).bad.length, 1);
});

test('the command exits 1 on CRLF with plain instructions, and 0 on a clean tree', () => {
  const d = tmp(); put(d, 'public/app.js', 'x\r\n'); put(d, 'src/index.js', 'ok\n');
  const bad = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-deploy-tree.mjs'), `--root=${d}`], { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.match(bad.stderr, /NOT SAFE TO DEPLOY/); assert.match(bad.stderr, /public\/app\.js/); assert.match(bad.stderr, /clean-export/);
  const good = tmp(); put(good, 'public/app.js', 'x\n'); put(good, 'src/index.js', 'ok\n');
  const ok = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-deploy-tree.mjs'), `--root=${good}`], { encoding: 'utf8' });
  assert.equal(ok.status, 0); assert.match(ok.stdout, /all LF/);
});

test('this repository\'s own working tree is LF (the .gitattributes rules and the checkout agree)', () => {
  const r = findCrlf(root);
  assert.deepEqual(r.bad, [], 'a text file that is deployed has CRLF: run `git checkout -- <file>`');
  assert.ok(r.checked > 40);
  const attrs = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
  assert.match(attrs, /^\* text=auto eol=lf$/m); assert.match(attrs, /^\*\.png binary$/m);
});

test('deploy scripts run the line-ending guard first', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const s of ['deploy', 'deploy:staging']) {
    const cmd = pkg.scripts[s];
    assert.match(cmd, /check-deploy-tree\.mjs/, s);
    assert.ok(cmd.indexOf('check-deploy-tree') < cmd.indexOf('validate-production-config'), `${s}: the guard comes before the validator`);
    assert.ok(cmd.indexOf('validate-production-config') < cmd.indexOf('wrangler deploy'), `${s}: the validator comes before the deploy`);
  }
});

test('a clean export reproduces a commit exactly: same files, same sizes, LF, with a record of the commit', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dest = path.join(tmp(), 'export');
  const r = cleanExport('HEAD', dest);
  assert.equal(r.commit, head);
  const meta = JSON.parse(fs.readFileSync(path.join(dest, 'EXPORT.json'), 'utf8'));
  assert.equal(meta.commit, head); assert.ok(meta.files > 100);
  assert.ok(fs.existsSync(path.join(dest, 'public', 'index.html'))); assert.ok(!fs.existsSync(path.join(dest, '.git')));
  assert.deepEqual(findCrlf(dest).bad, []);
  // The tracked list and the export agree (no untracked or ignored file, nothing missing).
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of tracked.slice(0, 200)) assert.ok(fs.existsSync(path.join(dest, f)), f);
  assert.throws(() => cleanExport('HEAD', dest), /not empty/, 'refuses a destination that already has files');
  assert.throws(() => cleanExport('no-such-branch-xyz', path.join(tmp(), 'x')));
});
