#!/usr/bin/env node
// Browser check of the public crawler information page, served by the page-only release package.
// Usage: node scripts/test-crawler-page-browser.mjs --url=http://127.0.0.1:8792/crawler [--chrome=<exe>]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const url = arg('url', 'http://127.0.0.1:8792/crawler');
const chrome = arg('chrome', 'C:/Users/insur/.cache/puppeteer/chrome/win64-152.0.7977.75/chrome-win64/chrome.exe');
const AXE = fs.readFileSync(path.join(root, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
let failed = false;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failed = true; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: chrome, headless: true, defaultViewport: null, args: ['--no-first-run'] });
try {
  const page = await b.newPage();
  const errs = []; const reqs = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('request', (r) => reqs.push(r.url()));
  const res = await page.goto(url, { waitUntil: 'load' });
  check('the page loads (HTTP 200)', res.status() === 200, String(res.status()));
  check('it needs no other request: no scripts, styles or images from anywhere else', reqs.filter((u) => !u.startsWith(new URL(url).origin)).length === 0 && reqs.length === 1, reqs.join(', '));
  check('it has a language, a title and one h1', await page.evaluate(() => document.documentElement.lang === 'en' && !!document.title && document.querySelectorAll('h1').length === 1));
  check('headings never skip a level', await page.evaluate(() => { const l = [...document.querySelectorAll('h1,h2,h3')].map((h) => Number(h.tagName[1])); return l.every((x, i) => i === 0 || x - l[i - 1] <= 1); }));
  check('the contact address is a working mail link', await page.evaluate(() => [...document.querySelectorAll('a[href^="mailto:"]')].every((a) => a.getAttribute('href') === 'mailto:marimercruz8@gmail.com' && a.textContent.trim() === 'marimercruz8@gmail.com') && document.querySelectorAll('a[href^="mailto:"]').length >= 1));
  check('the robots.txt example is shown', /User-agent: ChroniumMind\s+Disallow: \//.test(await page.$eval('pre', (e) => e.textContent)));
  await page.keyboard.press('Tab');
  check('the skip link is the first tab stop, becomes visible, and goes to the content', await page.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return a.classList.contains('skip') && r.left >= 0 && r.width > 0; }));
  await page.keyboard.press('Enter');
  check('activating it moves focus to the main content', await page.evaluate(() => location.hash === '#main'));
  for (const scheme of ['dark', 'light']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    for (const w of [320, 375, 768, 1024, 1440]) {
      await page.setViewport({ width: w, height: 900 }); await sleep(100);
      const m = await page.evaluate(() => ({ h: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, clipped: [...document.querySelectorAll('h1,h2,p,li,td,th,a')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').length }));
      check(`${scheme} ${w}px: no horizontal scroll, nothing clipped`, !m.h && m.clipped === 0);
    }
    for (const w of [320, 1440]) {
      await page.setViewport({ width: w, height: 900 }); await page.evaluate(AXE);
      const v = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }).then((r) => r.violations.map((x) => `${x.id}[${x.nodes.length}]`)));
      check(`${scheme} ${w}px: axe WCAG 2.2 AA finds no violations`, v.length === 0, v.join(', '));
    }
  }
  await page.setViewport({ width: 320, height: 900 });
  await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }' }); await sleep(150);
  check('text spacing (WCAG 1.4.12) at 320px: no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await page.emulateMediaFeatures([{ name: 'forced-colors', value: 'active' }]);
  check('forced colors: the page still renders its text and links', await page.evaluate(() => document.body.innerText.length > 500 && [...document.querySelectorAll('a')].length >= 2));
  check('no script or console errors', errs.length === 0, errs.join(' | '));
} catch (e) { console.log('FAIL  test crashed :: ' + (e && e.stack || e)); failed = true; }
finally { await b.close(); }
console.log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
