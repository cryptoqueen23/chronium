#!/usr/bin/env node
// Builds the STABLE PERSONAL COPY of the extension: a frozen snapshot, outside the repository, that you load into Chrome and use
// every day. The development folder (extension/) keeps changing; this copy only changes when you ask.
//
//   node scripts/make-personal-extension.mjs                    first build into C:\Users\<you>\ChroniumMind-Personal
//   node scripts/make-personal-extension.mjs --dest=<folder>     another folder
//   node scripts/make-personal-extension.mjs --update            replace an existing copy (after you backed up, see the guide)
//
// Why a separate copy, and why a key:
//   * Chrome stores an unpacked extension's saved research under the extension's ID. Without a key, the ID comes from the
//     FOLDER PATH, so the development copy and any other folder get different IDs (and different, empty storage), and moving
//     or renaming a folder would make your research seem to vanish (it would still be on disk, under the old ID).
//   * The personal copy carries a fixed public key in its manifest, so its ID is the same forever, wherever the folder is and
//     however many times you update it. The development copy has no key, so it can never touch your personal research.
//   * Differences from the development manifest, and nothing else: the key; no localhost host permission; "unlimitedStorage"
//     (asks Chrome to keep your saved research and not apply a storage quota); a version name that says which build it is.
// The key is a PUBLIC key (scripts/personal-extension-public-key.txt). The private half was discarded: nothing can be signed
// or published with it, and nothing secret is stored here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findCrlf } from './check-deploy-tree.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const update = process.argv.includes('--update');
const allowDirty = process.argv.includes('--allow-dirty'); // tests only: build from the working tree
const dest = path.resolve(arg('dest') || path.join(os.homedir(), 'ChroniumMind-Personal'));
const keyFile = path.join(root, 'scripts', 'personal-extension-public-key.txt');

// ---- the fixed public key, created once ----
if (!fs.existsSync(keyFile)) {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(keyFile, publicKey.export({ type: 'spki', format: 'der' }).toString('base64') + '\n');
  console.log('Created the personal extension public key (the private half was not kept).');
}
const keyB64 = fs.readFileSync(keyFile, 'utf8').trim();
export const extensionIdForKey = (b64) => [...crypto.createHash('sha256').update(Buffer.from(b64, 'base64')).digest().subarray(0, 16)].map((b) => 'abcdefghijklmnop'[b >> 4] + 'abcdefghijklmnop'[b & 15]).join('');
const extensionId = extensionIdForKey(keyB64);

export function personalManifest(dev, { commit = 'unknown', date = '' } = {}) {
  const m = JSON.parse(JSON.stringify(dev));
  m.key = keyB64;
  m.version_name = `${dev.version} personal (${commit}${date ? ', ' + date : ''})`;
  m.permissions = [...new Set([...(dev.permissions || []), 'unlimitedStorage'])];
  m.host_permissions = (dev.host_permissions || []).filter((h) => !/127\.0\.0\.1|localhost/.test(h));
  return m;
}

function cli() {
  // The copy must be built from files that are already in step with the shared code.
  execFileSync(process.execPath, [path.join(root, 'scripts', 'sync-extension.mjs')], { cwd: root, stdio: 'ignore' });
  let commit = 'unknown';
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* no git */ }
  let dirty = false;
  try { dirty = execFileSync('git', ['status', '--porcelain', '--', 'extension', 'public'], { cwd: root, encoding: 'utf8' }).trim().length > 0; } catch { /* no git */ }
  // The copy must be byte-for-byte what is committed: refuse an extension folder whose text files were rewritten with Windows line endings.
  const crlf = findCrlf(root, ['extension']).bad;
  if (crlf.length) { console.error(`The extension folder has Windows line endings (${crlf.slice(0, 5).map((b) => b.file).join(', ')}...). Run git checkout -- extension, then try again.`); process.exit(1); }
  if (dirty && !allowDirty) { console.error('The extension or shared code has uncommitted changes. Commit them first, so this copy matches a commit you can come back to.'); process.exit(1); }

  if (fs.existsSync(dest) && fs.readdirSync(dest).length) {
    if (!update) { console.error(`${dest} already exists and is not empty. Run with --update to replace it (export your research first: see docs/EXTENSION_PERSONAL_USE.md).`); process.exit(1); }
    if (!fs.existsSync(path.join(dest, 'PERSONAL-COPY.txt'))) { console.error(`${dest} does not look like a personal copy made by this script (no PERSONAL-COPY.txt). Not touching it.`); process.exit(1); }
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(path.join(root, 'extension'), dest, { recursive: true });
  const dev = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  const date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(personalManifest(dev, { commit, date }), null, 2) + '\n');
  fs.writeFileSync(path.join(dest, 'PERSONAL-COPY.txt'), `Chronium Mind, personal copy\nBuilt from commit ${commit} on ${date}\nExtension ID (never changes for this copy): ${extensionId}\nMade by scripts/make-personal-extension.mjs. Do not edit these files by hand; do not move or rename this folder while Chrome has it loaded.\n`);
  console.log(`Personal copy written to ${dest}\n  built from commit ${commit} (${date})\n  extension ID ${extensionId}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
