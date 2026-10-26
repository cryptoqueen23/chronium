// Test helper only. The Worker's source imports JSON files without an import attribute, which wrangler's bundler accepts and
// Node does not. This hook lets a Node test load the Worker entry point unchanged (the source is never modified for tests).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.json')) return { format: 'json', source: await readFile(fileURLToPath(url), 'utf8'), shortCircuit: true };
  return nextLoad(url, context);
}
