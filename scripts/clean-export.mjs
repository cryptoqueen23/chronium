#!/usr/bin/env node
// Makes a CLEAN EXPORT of a commit: exactly the files Git has stored for that commit, LF line endings, no working-tree conversion, no
// untracked files, no .git folder. This is what must be deployed from (never from a Windows checkout or worktree).
//
//   node scripts/clean-export.mjs <commit-or-branch> <empty-destination-folder>
//   example: node scripts/clean-export.mjs release/ai-off .release/ai-off-package
//
// Each file is written straight from the bytes Git stores for the commit (`git cat-file --batch`), so no line-ending setting, no checkout and
// no external archive program can change it. Afterwards it re-reads every file and compares its size and SHA-1 (as Git computes it) with the
// stored object, checks no deployed text file contains CRLF, and writes EXPORT.json (commit, time).
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCrlf } from './check-deploy-tree.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
const gitBlobSha = (buf) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');

export function cleanExport(ref, dest) {
  const commit = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  const target = path.resolve(root, dest);
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`${target} already exists and is not empty. Choose a new folder.`);

  // Every blob of the commit: mode, object id, path. (Submodules, mode 160000, are not files and are skipped.)
  const entries = git(['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean).map((l) => { const tab = l.indexOf('\t'); const [mode, type, sha] = l.slice(0, tab).split(' '); return { mode, type, sha, file: l.slice(tab + 1) }; }).filter((e) => e.type === 'blob');

  // One streaming read of all the stored objects.
  const out = spawnSync('git', ['cat-file', '--batch'], { cwd: root, input: entries.map((e) => `${e.sha}\n`).join(''), maxBuffer: 1 << 30 });
  if (out.status !== 0) throw new Error(`git cat-file failed: ${out.stderr?.toString().slice(0, 200)}`);
  const buf = out.stdout; let pos = 0; const blobs = [];
  for (const e of entries) {
    const nl = buf.indexOf(0x0a, pos); const [sha, type, size] = buf.subarray(pos, nl).toString().split(' ');
    if (sha !== e.sha || type !== 'blob') throw new Error(`unexpected object while reading ${e.file}`);
    const n = Number(size); blobs.push(buf.subarray(nl + 1, nl + 1 + n)); pos = nl + 1 + n + 1;
  }

  fs.mkdirSync(target, { recursive: true });
  entries.forEach((e, i) => { const p = path.join(target, e.file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, blobs[i]); });

  // Verify what is now on disk against what Git stores.
  const problems = [];
  entries.forEach((e) => {
    const p = path.join(target, e.file);
    if (!fs.existsSync(p)) { problems.push(`missing: ${e.file}`); return; }
    if (gitBlobSha(fs.readFileSync(p)) !== e.sha) problems.push(`differs from the stored file: ${e.file}`);
  });
  for (const b of findCrlf(target, ['public', 'src', 'wrangler.jsonc', 'package.json']).bad) problems.push(`has CRLF: ${b.file}`);
  if (problems.length) throw new Error(`The export did not verify:\n- ${problems.slice(0, 20).join('\n- ')}`);
  fs.writeFileSync(path.join(target, 'EXPORT.json'), JSON.stringify({ commit, ref, files: entries.length, exportedAt: new Date().toISOString(), tool: 'scripts/clean-export.mjs (git cat-file; every file re-verified against its stored object id)' }, null, 2) + '\n');
  return { commit, target, files: entries.length };
}

function cli() {
  const [ref, dest] = process.argv.slice(2);
  if (!ref || !dest) { console.error('Usage: node scripts/clean-export.mjs <commit-or-branch> <empty-destination-folder>'); process.exit(2); }
  try { const r = cleanExport(ref, dest); console.log(`Exported ${r.files} files of commit ${r.commit.slice(0, 12)} to ${r.target}\nVerified: every file matches its stored Git object byte for byte, and no deployed text file has CRLF. Deploy from THIS folder only.`); }
  catch (e) { console.error(e.message); process.exit(1); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
