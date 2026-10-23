#!/usr/bin/env node
// Non-text contrast (WCAG 2.2 SC 1.4.11, 3:1) for the boundaries that identify
// controls, in dark and light themes, website and extension. Three layers:
//   A. design tokens: the control-border / focus / status-edge colours against
//      every surface they can sit on (from computed CSS custom properties);
//   B. pixel probes: real native and styled controls (text input, select,
//      textarea, checkbox, radio, file input, buttons, search box) rendered on
//      each surface, screenshotted, and the boundary pixel measured against the
//      pixel just outside it (this is what the user actually sees, including
//      browser-drawn checkboxes and radios);
//   C. real-page audit: every essential control that exists on the real pages,
//      boundary colour vs the colour behind it.
// Decorative card, panel, table and divider borders are deliberately NOT held
// to 3:1: they carry no information that the text does not. A control whose
// only visible identification is its border IS held to it.
// Usage: wrangler dev on :8787, then
//   node scripts/test-contrast.mjs --chrome=<Chrome for Testing exe> [--report=<file.md>]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILD } from './lib/case-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const chrome = arg('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const reportFile = arg('report', '');
const ext = path.join(root, 'extension');
const BASE = 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const rows = [];
const record = (layer, theme, where, what, ratio, min = 3) => {
  const ok = ratio >= min;
  if (!ok) failed = true;
  rows.push({ layer, theme, where, what, ratio: Math.round(ratio * 100) / 100, min, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${layer}] ${theme} ${where}: ${what} = ${ratio.toFixed(2)}:1 (need ${min}:1)`);
};

// ---- colour maths, run inside the page and here ----
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { c: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 }; };
const hex = (s) => { s = s.trim(); if (/^#/.test(s)) { const h = s.length === 4 ? [...s.slice(1)].map((x) => x + x).join('') : s.slice(1); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); } const p = parse(s); return p ? p.c : null; };

const b = await puppeteer.launch({
  executablePath: chrome, headless: false, defaultViewport: null, ignoreDefaultArgs: ['--disable-extensions'],
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--window-size=1280,900', '--disable-features=DisableLoadExtensionCommandLineSwitch']
});

// Renders probe controls on the three surfaces and measures boundary vs outside pixel.
async function probeMeasure(page, kind) {
  return page.evaluate(async (kind) => {
    document.getElementById('__probe')?.remove();
    const wrap = document.createElement('div');
    wrap.id = '__probe';
    wrap.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;padding:0;display:flex;flex-direction:column;gap:0;width:520px;';
    const surfaces = [['page background', 'var(--bg, var(--bg))'], ['surface', 'var(--surface, var(--panel))'], ['raised surface', 'var(--surface-raised, var(--panel))']];
    const controlsSite = [
      ['text input', '<div class="field"><input type="text" value="Sample" aria-label="probe"></div>'],
      ['select', '<div class="field"><select aria-label="probe"><option>One</option></select></div>'],
      ['textarea', '<div class="field"><textarea aria-label="probe" rows="1">x</textarea></div>'],
      ['checkbox', '<input type="checkbox" aria-label="probe" style="width:18px;height:18px">'],
      ['radio', '<input type="radio" aria-label="probe" style="width:18px;height:18px">'],
      ['secondary button', '<button type="button" class="btn">Button</button>'],
      ['search box', '<form class="search compact" role="search"><input aria-label="probe" value="Search"><button type="submit">Go</button></form>']
    ];
    const controlsExt = [
      ['text input', '<input type="text" value="Sample" aria-label="probe" style="width:200px">'],
      ['search input', '<input type="search" value="Sample" aria-label="probe" style="width:200px">'],
      ['button', '<button type="button">Button</button>']
    ];
    const controls = kind === 'site' ? controlsSite : controlsExt;
    const cells = [];
    for (const [sname, sbg] of surfaces) {
      for (const [cname, html] of controls) {
        const cell = document.createElement('div');
        cell.style.cssText = `background:${sbg};padding:14px;`;
        cell.innerHTML = html;
        cell.dataset.surface = sname; cell.dataset.control = cname;
        wrap.appendChild(cell);
        cells.push(cell);
      }
    }
    document.body.appendChild(wrap);
    await new Promise((r) => setTimeout(r, 100));
    return cells.map((c) => {
      const el = c.querySelector('input, select, textarea, button, form') ;
      const target = c.dataset.control === 'search box' ? c.querySelector('form') : el;
      const r = target.getBoundingClientRect();
      return { surface: c.dataset.surface, control: c.dataset.control, x: r.x, y: r.y, w: r.width, h: r.height };
    });
  }, kind);
}

async function pixelRatio(page, box) {
  // Screenshot a margin around the control; compare the most contrasting pixel at its left edge to the pixel just outside.
  const m = 8;
  const clip = { x: Math.max(0, Math.floor(box.x) - m), y: Math.floor(box.y), width: Math.ceil(box.w) + m * 2, height: Math.ceil(box.h) };
  const png = (await page.screenshot({ clip, encoding: 'base64' }));
  return page.evaluate(async (png, m, h) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const rt = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    // Several rows through the middle third, to dodge rounded corners and text.
    let best = 0;
    for (const fy of [0.45, 0.5, 0.55]) {
      const y = Math.round(img.height * fy);
      const outside = ctx.getImageData(m - 5, y, 1, 1).data;
      for (let x = m - 2; x <= m + 3; x++) {
        const p = ctx.getImageData(x, y, 1, 1).data;
        best = Math.max(best, rt([p[0], p[1], p[2]], [outside[0], outside[1], outside[2]]));
      }
    }
    return best;
  }, png, m, clip.height);
}

// Real-page audit: border colour vs colour actually behind the control.
async function auditReal(page, selectors) {
  return page.evaluate((selectors) => {
    const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { c: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 }; };
    const over = (top, bot) => ({ c: top.c.map((v, i) => Math.round(v * top.a + bot.c[i] * (1 - top.a))), a: 1 });
    const behind = (el) => { const chain = []; for (let e = el.parentElement; e; e = e.parentElement) chain.push(getComputedStyle(e).backgroundColor); let acc = { c: [255, 255, 255], a: 1 }; for (const c of chain.reverse()) { const p = parse(c); if (p && p.a > 0) acc = p.a >= 1 ? p : over(p, acc); } return acc; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const rt = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const out = [];
    for (const sel of selectors) {
      const els = [...document.querySelectorAll(sel)];
      let worst = null;
      for (const el of els) {
        const cs = getComputedStyle(el);
        const bw = parseFloat(cs.borderTopWidth);
        const bc = parse(cs.borderTopColor);
        if (!(bw > 0) || !bc || bc.a === 0) continue; // borderless: the wrapper carries the boundary (measured separately)
        const bg = behind(el);
        const col = bc.a >= 1 ? bc.c : over(bc, bg).c;
        const r = rt(col, bg.c);
        if (!worst || r < worst.r) worst = { r, n: els.length };
      }
      out.push({ sel, count: els.length, ratio: worst ? worst.r : null });
    }
    return out;
  }, selectors);
}

// Left-edge status markers (Missing / Not reviewed yet / Unresolved): supplementary to their text tags, but held to 3:1 anyway.
async function auditEdges(page, selectors) {
  return page.evaluate((selectors) => {
    const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { c: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 }; };
    const behind = (el) => { const chain = []; for (let e = el.parentElement; e; e = e.parentElement) chain.push(getComputedStyle(e).backgroundColor); let acc = [255, 255, 255]; for (const c of chain.reverse()) { const p = parse(c); if (p && p.a >= 1) acc = p.c; } return acc; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const rt = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    return selectors.map((sel) => { const el = document.querySelector(sel); if (!el) return { sel, ratio: null }; const c = parse(getComputedStyle(el).borderLeftColor); return { sel, ratio: c ? rt(c.c, behind(el)) : null }; });
  }, selectors);
}

try {
  await sleep(3000);
  const extId = new URL((await b.targets()).find((t) => t.type() === 'service_worker').url()).host;
  const web = await b.newPage();
  await web.setViewport({ width: 1280, height: 900 });
  await web.goto(`${BASE}/#/investigations`, { waitUntil: 'networkidle2' });
  const panel = await b.newPage();
  await panel.setViewport({ width: 420, height: 900 });
  await panel.goto(`chrome-extension://${extId}/panel.html`);

  // Make a real investigation so the workspace tabs render their controls.
  await web.evaluate(BUILD, '/db.js', 'Contrast audit');
  await web.evaluate(() => { location.hash = '#/settings'; }); await sleep(300);
  await web.evaluate(() => { location.hash = '#/investigations'; });
  await web.waitForSelector('[data-open-investigation]');
  await web.evaluate(() => document.querySelector('[data-open-investigation]').click());
  await web.waitForSelector('#tab-bigpicture');
  await panel.evaluate(BUILD, './lib/db.js', 'Contrast audit');
  await panel.reload();
  const SITE_SEL = ['.field input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden])', '.field select', '.field textarea', '.filters select', '.biblio-cite select', '.lane-inline-select', '.claim-evidence-option-value', '.search', '.btn:not(.btn-primary):not(.btn-danger)', '.preview-btn', '.mini-edit-btn', '.result-actions a', '.result-actions button', '.examples button', '.import-zone-inner'];
  const EXT_SEL = ['input[type=search]', 'input[type=text]', 'input[type=url]', 'button:not(.primary):not([role=tab])'];

  for (const theme of ['dark', 'light']) {
    for (const [page, where, kind, sels] of [[web, 'website', 'site', SITE_SEL], [panel, 'extension', 'ext', EXT_SEL]]) {
      await page.bringToFront();
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
      await sleep(300);

      // A. tokens
      const tokens = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); const g = (n) => cs.getPropertyValue(n).trim(); return { bg: g('--bg'), surface: g('--surface') || g('--panel'), raised: g('--surface-raised') || g('--panel'), control: g('--control-border') || g('--control') || g('--line') || g('--border'), accent: g('--accent'), danger: g('--danger') || g('--bad'), link: g('--link') }; });
      const surf = { 'page background': tokens.bg, surface: tokens.surface, 'raised surface': tokens.raised };
      for (const [sn, sv] of Object.entries(surf)) {
        const bgc = hex(sv); if (!bgc) continue;
        record('token', theme, where, `control border ${tokens.control} on ${sn} ${sv}`, ratio(hex(tokens.control), bgc));
        record('token', theme, where, `focus ring / selected-tab accent ${tokens.accent} on ${sn}`, ratio(hex(tokens.accent), bgc));
      }
      if (kind === 'site') for (const [n, v] of [['Missing edge (danger)', tokens.danger], ['Unresolved edge (link)', tokens.link]]) record('token', theme, where, `${n} ${v} on page background`, ratio(hex(v), hex(tokens.bg)));

      // B. pixel probes
      const boxes = await probeMeasure(page, kind);
      for (const bx of boxes) record('pixel', theme, where, `${bx.control} on ${bx.surface}`, await pixelRatio(page, bx));
      await page.evaluate(() => document.getElementById('__probe')?.remove());

      // C. real controls on the real pages (every workspace tab, home with results, the extension's views)
      let real;
      if (kind === 'site') {
        const agg = new Map(sels.map((s) => [s, { count: 0, ratio: null }]));
        for (const route of ['#/', '#/investigations', '#/settings', '#/workspace/bigpicture', '#/workspace/research', '#/workspace/review', '#/workspace/subjects', '#/workspace/evidence', '#/workspace/evidence/bibliography', '#/workspace/findings/claims', '#/workspace/findings/findings', '#/workspace/findings/gaps', '#/workspace/report']) {
          await page.evaluate((r) => { location.hash = r; }, route);
          await sleep(450);
          if (route === '#/') { await page.evaluate(() => { const i = document.querySelector('#view-home input'); if (i) { i.value = 'copperas cove'; i.form?.requestSubmit(); } }); await sleep(2500); }
          for (const r of await auditReal(page, sels)) { const a = agg.get(r.sel); a.count = Math.max(a.count, r.count); if (r.ratio !== null && (a.ratio === null || r.ratio < a.ratio)) a.ratio = r.ratio; }
        }
        real = sels.map((s) => ({ sel: s, ...agg.get(s) }));
      } else {
        for (const v of ['search', 'compare', 'research', 'reports']) { await page.evaluate((t) => document.querySelector('#tab-' + t).click(), v); await sleep(250); }
        await page.evaluate(() => document.querySelector('#tab-research').click()); await sleep(300);
        await page.evaluate(() => document.querySelector('[data-open]')?.click()); await sleep(500); // open the case so the views render
        real = await auditReal(page, sels);
      }
      // status edges on Big Picture
      if (kind === 'site') await page.evaluate(() => { location.hash = '#/workspace/bigpicture'; }); else await page.evaluate(() => document.querySelector('#vt-bigpicture')?.click());
      await sleep(500);
      for (const e of await auditEdges(page, ['.vw-q-missing', '.vw-q-notreviewed', '.vw-q-unresolved'])) { if (e.ratio === null) console.log(`INFO  [edge] ${theme} ${where}: ${e.sel} not present`); else record('edge', theme, where, `${e.sel} left edge`, e.ratio); }
      for (const r of real) {
        if (r.count === 0) { console.log(`INFO  [real] ${theme} ${where}: ${r.sel} not present on this page`); continue; }
        if (r.ratio === null) { console.log(`INFO  [real] ${theme} ${where}: ${r.sel} (${r.count}) has no border of its own (wrapper measured separately)`); continue; }
        record('real', theme, where, `${r.sel} (${r.count} on page)`, r.ratio);
      }
    }
  }
} catch (e) {
  failed = true;
  console.log('FAIL  test ran without throwing :: ' + (e.stack || e.message));
} finally {
  await b.close();
}

if (reportFile) {
  const md = ['| Layer | Theme | Where | What | Ratio | Needs | |', '|---|---|---|---|---|---|---|', ...rows.map((r) => `| ${r.layer} | ${r.theme} | ${r.where} | ${r.what.replace(/\|/g, '/')} | ${r.ratio}:1 | ${r.min}:1 | ${r.ok ? 'pass' : '**FAIL**'} |`)].join('\n');
  fs.writeFileSync(reportFile, md + '\n');
  console.log('report written to ' + reportFile);
}
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length} measurements, ${bad.length} below threshold.`);
process.exit(failed ? 1 : 0);
