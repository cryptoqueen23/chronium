#!/usr/bin/env node
// Copies the shared local-first modules from public/ into extension/lib/ so
// the side panel uses the exact same workspace code and IndexedDB schema as
// the web app (no forked logic). Run after changing any of these files:
//   node scripts/sync-extension.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['db.js', 'entities.js', 'claims.js', 'ingestionReview.js', 'portable.js', 'portableDb.js']) {
  fs.copyFileSync(path.join(root, 'public', f), path.join(root, 'extension', 'lib', f));
  console.log('synced', f);
}
