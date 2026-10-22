import {
  listInvestigations, createInvestigation, deleteInvestigation,
  saveRecordToInvestigation, listInvestigationRecords, getSavedCanonicalKeys, searchLibrary
} from './lib/db.js';

const DEFAULT_WORKER = 'https://chronium-mind.truewolfflix777.workers.dev';
const $ = (s) => document.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Only ever put http(s) URLs in an href; anything else (javascript:, data:) is dropped.
const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };

let workerUrl = DEFAULT_WORKER;
let activeCaseId = null;
let current = [];
let savedKeys = new Set();

async function store(key, fallback) {
  try { const r = await chrome.storage.local.get(key); return r[key] ?? fallback; } catch { return fallback; }
}
async function setStore(key, value) { try { await chrome.storage.local.set({ [key]: value }); } catch { /* storage unavailable */ } }

// ---- navigation (tabs) ----
const tabs = [...document.querySelectorAll('[role=tab]')];
function showView(name) {
  for (const t of tabs) {
    const on = t.dataset.view === name;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $('#view-' + t.dataset.view).hidden = !on;
  }
  if (name === 'research') renderCases();
  if (name === 'reports') renderReport();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => showView(t.dataset.view));
  t.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const n = tabs[(i + d + tabs.length) % tabs.length];
    n.focus(); showView(n.dataset.view); e.preventDefault();
  });
});

// ---- cases ----
async function refreshActiveCase() {
  const cases = await listInvestigations();
  if (!cases.find((c) => c.id === activeCaseId)) activeCaseId = cases[0]?.id || null;
  savedKeys = activeCaseId ? await getSavedCanonicalKeys(activeCaseId) : new Set();
  const active = cases.find((c) => c.id === activeCaseId);
  $('#caseBar').textContent = active ? `Saving to case: ${active.name}` : 'No case yet. Create one under My Research to save sources.';
  return cases;
}

async function renderCases() {
  const cases = await refreshActiveCase();
  $('#caseList').innerHTML = cases.length ? `<ul class="list">${cases.map((c) => `
    <li><span>${esc(c.name)}${c.id === activeCaseId ? ' <b class="badge">Active</b>' : ''}</span>
    <span class="row-actions">
      ${c.id === activeCaseId ? '' : `<button type="button" data-use="${esc(c.id)}">Use</button>`}
      <button type="button" data-open="${esc(c.id)}">Sources</button>
      <button type="button" data-del="${esc(c.id)}" aria-label="Delete case ${esc(c.name)}">Delete</button>
    </span></li>`).join('')}</ul>` : '<p class="hint">No cases yet. A case holds the sources you save while researching one subject.</p>';
  $('#caseDetail').innerHTML = '';
}
$('#newCaseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#newCaseName').value.trim(); if (!name) return;
  const c = await createInvestigation({ name, description: '' });
  activeCaseId = c.id; await setStore('activeCaseId', activeCaseId);
  $('#newCaseName').value = ''; renderCases();
});
$('#caseList').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.use) { activeCaseId = b.dataset.use; await setStore('activeCaseId', activeCaseId); renderCases(); }
  if (b.dataset.del && confirm('Delete this case and its saved sources? This cannot be undone.')) { await deleteInvestigation(b.dataset.del); renderCases(); }
  if (b.dataset.open) {
    const rows = await listInvestigationRecords(b.dataset.open);
    $('#caseDetail').innerHTML = rows.length ? `<h3>Saved sources</h3><ul class="list">${rows.map((r) => `<li><span>${esc(r.title || r.originalUrl)}</span>${linkHtml(r.archiveUrl, 'Open snapshot')}${linkHtml(r.originalUrl, 'Current page')}</li>`).join('')}</ul>` : '<p class="hint">Nothing saved in this case yet.</p>';
  }
});

// ---- search ----
function linkHtml(url, label) { const u = safeUrl(url); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : ''; }
const keyOf = (x) => x.canonicalKey || x.originalUrl || x.archiveUrl || x.id;

function plainStatus(c) {
  if (c.skipped) return 'paused for a minute after repeated problems';
  if (!c.ok) return 'did not respond';
  return c.count > 0 ? `${c.count} found` : 'nothing found';
}
function renderSearchStatus(data, libCount) {
  const cs = data.connectors || [];
  const failed = cs.filter((c) => !c.ok);
  const lines = cs.map((c) => `<li class="${c.ok ? '' : 'bad'}">${esc(c.source)}: ${esc(plainStatus(c))}</li>`).join('');
  $('#searchStatus').innerHTML = `<details class="statusbox" ${failed.length ? 'open' : ''}>
    <summary>Search status: checked ${cs.length} source${cs.length === 1 ? '' : 's'}${failed.length ? `, ${failed.length} did not respond` : ''}</summary>
    <ul>${lines}${libCount ? `<li>My saved library: ${libCount} found</li>` : ''}</ul>
    <p class="hint">This covers only the sources listed here. It is not the whole internet, and "nothing found" does not prove a page never existed.</p></details>`;
}

function renderResults() {
  if (!current.length) { $('#results').innerHTML = '<p class="notice">No results from the sources that responded. Try a website address (like example.com) to look up its history.</p>'; return; }
  $('#results').innerHTML = current.map((x, i) => {
    const d = x.captureDate ? new Date(x.captureDate) : null;
    const date = d && !isNaN(d) ? d.toISOString().slice(0, 10) : 'Date unavailable';
    const saved = savedKeys.has(keyOf(x));
    const title = x.title && !/^https?:\/\//i.test(x.title) ? x.title : (x.originalUrl || 'Archived result');
    return `<article class="card">
      <h3>${esc(title)}</h3>
      <p class="meta">${esc(x.source || 'Saved library')} &bull; ${esc(date)}${x.archiveUrl ? ' &bull; Archived website' : ''}</p>
      ${x.snippet ? `<p class="snip">${esc(String(x.snippet).slice(0, 300))}</p>` : ''}
      <p class="actions">${linkHtml(x.archiveUrl, 'Open snapshot')} ${linkHtml(x.originalUrl, 'Current page')}
      <button type="button" data-save="${i}" ${saved || !activeCaseId ? 'disabled' : ''}>${saved ? 'Saved' : 'Save'}</button></p>
    </article>`;
  }).join('');
}
$('#results').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-save]'); if (!b || !activeCaseId) return;
  const x = current[Number(b.dataset.save)];
  await saveRecordToInvestigation(activeCaseId, { ...x, canonicalKey: keyOf(x) });
  savedKeys.add(keyOf(x)); renderResults();
});

$('#searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#q').value.trim(); if (!q) return;
  $('#status').textContent = `Searching for "${q}"...`;
  $('#results').innerHTML = ''; $('#searchStatus').innerHTML = '';
  try {
    const [res, lib] = await Promise.all([
      fetch(`${workerUrl}/api/search?q=${encodeURIComponent(q)}&limit=25`),
      searchLibrary(q, 25).catch(() => [])
    ]);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed');
    current = [...(data.results || []), ...lib];
    await refreshActiveCase();
    renderSearchStatus(data, lib.length);
    renderResults();
    $('#status').textContent = `${current.length} result${current.length === 1 ? '' : 's'}.`;
  } catch (err) {
    $('#status').textContent = `Could not complete the search: ${err.message}. Check the server address in Settings.`;
  }
});

// ---- reports ----
async function renderReport() {
  await refreshActiveCase();
  if (!activeCaseId) { $('#reportBox').innerHTML = '<p class="notice">Create a case and save some sources first.</p>'; return; }
  const rows = await listInvestigationRecords(activeCaseId);
  if (!rows.length) { $('#reportBox').innerHTML = '<p class="notice">This case has no saved sources yet.</p>'; return; }
  const md = rows.map((r, i) => `${i + 1}. ${r.title || r.originalUrl || 'Untitled'}\n   - Original: ${r.originalUrl || 'n/a'}\n   - Archive: ${r.archiveUrl || 'n/a'}\n   - Source: ${r.source || 'n/a'}; capture date: ${r.captureDate || 'n/a'}; saved: ${r.savedAt || 'n/a'}`).join('\n');
  $('#reportBox').innerHTML = `<pre class="report">${esc(md)}</pre><button type="button" id="copyReport">Copy</button> <button type="button" id="dlReport">Download .txt</button>`;
  $('#copyReport').onclick = () => navigator.clipboard.writeText(md);
  $('#dlReport').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/plain' })); a.download = 'chronium-source-list.txt'; a.click();
  };
}

// ---- settings ----
$('#saveWorkerUrl').addEventListener('click', async () => {
  const u = safeUrl($('#workerUrl').value);
  if (!u) { alert('Enter a full web address starting with https://'); return; }
  workerUrl = u.replace(/\/$/, ''); await setStore('workerUrl', workerUrl);
});

(async function init() {
  workerUrl = await store('workerUrl', DEFAULT_WORKER);
  activeCaseId = await store('activeCaseId', null);
  $('#workerUrl').value = workerUrl;
  await refreshActiveCase();
})();
