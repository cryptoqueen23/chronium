#!/usr/bin/env node
// Makes the extension's SQUARE toolbar icons (16, 32, 48, 128 px) from the existing brand art. The brand image is a wide logo
// (1774 x 887: dragon and hourglass on the left, the wordmark on the right); Chrome needs square icons, and a wide image is
// squashed into the square slot. This crops the dragon-and-hourglass part and centres it on a transparent square.
//   node scripts/make-extension-icons.mjs [--chrome=<Chrome for Testing exe>]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeArg = process.argv.find((a) => a.startsWith('--chrome='));
const chrome = chromeArg ? chromeArg.slice(9) : 'C:/Users/insur/.cache/puppeteer/chrome/win64-152.0.7977.75/chrome-win64/chrome.exe';
const SRC = path.join(root, 'public', 'assets', 'brand', 'chronium-mind-mascot.png');
const OUT = path.join(root, 'extension', 'icons');
const CROP = { x: 0, y: 0, w: 790, h: 887 }; // the dragon, the books and the hourglass; stops before the wordmark

const b = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--allow-file-access-from-files'] });
try {
  const page = await b.newPage();
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64');
  const results = await page.evaluate(async (src, crop, sizes) => {
    const img = new Image(); img.src = src; await img.decode();
    const out = {};
    for (const n of sizes) {
      const c = document.createElement('canvas'); c.width = n; c.height = n;
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      const k = n / crop.h; const w = crop.w * k;
      // Step down in halves for small sizes so the picture stays sharp.
      let source = img; let sw = crop.w; let sh = crop.h; let sx = crop.x; let sy = crop.y;
      while (sh / 2 > n) { const t = document.createElement('canvas'); t.width = Math.round(sw / 2); t.height = Math.round(sh / 2); const tg = t.getContext('2d'); tg.imageSmoothingQuality = 'high'; tg.drawImage(source, sx, sy, sw, sh, 0, 0, t.width, t.height); source = t; sx = 0; sy = 0; sw = t.width; sh = t.height; }
      g.drawImage(source, sx, sy, sw, sh, (n - w) / 2, 0, w, n);
      out[n] = c.toDataURL('image/png');
    }
    return out;
  }, dataUrl, CROP, [16, 32, 48, 128]);
  for (const [n, url] of Object.entries(results)) { fs.writeFileSync(path.join(OUT, `icon-${n}.png`), Buffer.from(url.split(',')[1], 'base64')); console.log(`wrote extension/icons/icon-${n}.png`); }
} finally { await b.close(); }
