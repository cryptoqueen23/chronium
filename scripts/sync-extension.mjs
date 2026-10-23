#!/usr/bin/env node
// Copies the shared local-first modules from public/ into extension/lib/ so
// the side panel uses the exact same workspace code and IndexedDB schema as
// the web app (no forked logic). Run after changing any of these files:
//   node scripts/sync-extension.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['db.js', 'entities.js', 'claims.js', 'ingestionReview.js', 'portable.js', 'portableDb.js', 'askRouter.js', 'askRender.js', 'askCommands.js', 'views.js']) {
  fs.copyFileSync(path.join(root, 'public', f), path.join(root, 'extension', 'lib', f));
  console.log('synced', f);
}
// Deep Discovery: the engine modules, the screen and its stylesheet (imports stay relative, so ../db.js resolves to lib/db.js).
const dsrc = path.join(root, 'public', 'discovery'); const ddst = path.join(root, 'extension', 'lib', 'discovery');
fs.mkdirSync(ddst, { recursive: true });
for (const f of fs.readdirSync(dsrc).filter((n) => /\.(js|css)$/.test(n))) {
  fs.copyFileSync(path.join(dsrc, f), path.join(ddst, f));
  console.log('synced discovery/' + f);
}

// Records Recovery: pure modules, the shared screen and its stylesheet.
const rsrc = path.join(root, 'public', 'recovery'); const rdst = path.join(root, 'extension', 'lib', 'recovery');
fs.mkdirSync(rdst, { recursive: true });
for (const f of fs.readdirSync(rsrc).filter((n) => /\.(js|css)$/.test(n))) {
  fs.copyFileSync(path.join(rsrc, f), path.join(rdst, f));
  console.log('synced recovery/' + f);
}
