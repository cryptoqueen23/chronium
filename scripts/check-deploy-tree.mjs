#!/usr/bin/env node
// Refuses to continue if any text file that would be DEPLOYED contains Windows line endings (CRLF).
//
// Why: Git on a Windows computer with core.autocrlf=true rewrites files with CRLF on checkout. Wrangler hashes every static file's bytes, so
// a CRLF rewrite silently changes what is served (staging, 2026-10-26: 56 static files became CRLF and a redeploy re-uploaded 50 of them).
// The repository now pins LF in .gitattributes, and this check is the second lock: `npm run deploy` and `npm run deploy:staging` run it first.
//
//   node scripts/check-deploy-tree.mjs [--root=<folder>] [--dirs=public,src,extension]
// Default root is the folder this script lives in the parent of. Default checked paths: public, src, wrangler.jsonc, package.json.
// Exit 0 = every text file checked is LF-only. Exit 1 = lists the offending files (and how to fix them).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEXT = /\.(js|mjs|cjs|html|htm|css|json|jsonc|md|txt|svg|webmanifest|map|xml|toml|yml|yaml|csv)$/i;

export function findCrlf(root, entries = ['public', 'src', 'wrangler.jsonc', 'package.json']) {
  const bad = []; let checked = 0;
  const visit = (p) => {
    let st; try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) { for (const n of fs.readdirSync(p)) if (n !== 'node_modules' && n !== '.git' && n !== '.wrangler') visit(path.join(p, n)); return; }
    if (!TEXT.test(p)) return;
    checked++;
    const buf = fs.readFileSync(p);
    const i = buf.indexOf(0x0d);
    if (i >= 0) bad.push({ file: path.relative(root, p).replaceAll('\\', '/'), crlf: buf.toString('latin1').split('\r\n').length - 1 });
  };
  for (const e of entries) visit(path.join(root, e));
  return { checked, bad };
}

function cli() {
  const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
  const root = path.resolve(arg('root', path.join(path.dirname(fileURLToPath(import.meta.url)), '..')));
  const dirs = arg('dirs', 'public,src,wrangler.jsonc,package.json').split(',').filter(Boolean);
  const { checked, bad } = findCrlf(root, dirs);
  if (bad.length) {
    console.error(`NOT SAFE TO DEPLOY: ${bad.length} text file(s) have Windows line endings (CRLF), which would change the bytes that are served:`);
    for (const b of bad.slice(0, 25)) console.error(`  ${b.file} (${b.crlf} line(s))`);
    if (bad.length > 25) console.error(`  ... and ${bad.length - 25} more`);
    console.error('\nFix: deploy from a clean export (node scripts/clean-export.mjs <commit> <empty-folder>), or in this repository run `git checkout -- <file>` on each file (the .gitattributes rules rewrite it as LF).');
    process.exit(1);
  }
  console.log(`Deploy tree is clean: ${checked} text file(s) checked under ${dirs.join(', ')}, all LF.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
