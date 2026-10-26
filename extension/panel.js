import {
  listInvestigations, createInvestigation, deleteInvestigation,
  saveRecordToInvestigation, listInvestigationRecords, getSavedCanonicalKeys, searchLibrary, searchInvestigation,
  updateInvestigation, createEvidenceItem, listEvidenceItems, openDb
} from './lib/db.js';
import { buildRawBackup, restoreRawBackup, parseBackupText, backupFileName, BackupFileError } from './lib/upgrade.js';
import { startupGate } from './startupGate.js';
import { answerQuestion } from './lib/askRouter.js';
import { answerHtml } from './lib/askRender.js';
import { extractSearchTerms } from './lib/askCommands.js';
import { readInvestigationForExport } from './lib/portableDb.js';
import { buildModel, viewHtml, resolveTarget, VIEWS } from './lib/views.js';
import { buildRecoveryModel } from './lib/recovery/model.js';
import { recoveryText } from './lib/recovery/report.js';
import { exportInvestigationFile, previewImport, importBundle, describeReport, PortableFileError } from './lib/portable.js';
import { listDiscoveryRuns, listDiscoveryLedger } from './lib/db.js';
import { mountDiscoveryPanel } from './lib/discovery/panel.js';
import { createFetchApiFetcher, createArchiveLookup } from './lib/discovery/fetchers.js';
import { plainTextExtract } from './lib/discovery/save.js';
import { requestSiteAccess } from './network.js';

const DEFAULT_WORKER = 'https://chronium-mind.truewolfflix777.workers.dev';
const $ = (s) => document.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Only ever put http(s) URLs in an href; anything else (javascript:, data:) is dropped.
const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };

let workerUrl = DEFAULT_WORKER;
let activeCaseId = null;
let activeCaseName = '';
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
  activeCaseName = active ? active.name : '';
  $('#caseBar').textContent = active ? `Saving to case: ${active.name}` : 'No case yet. Create one under My Research to save sources.';
  return cases;
}

async function renderCases() {
  const cases = await refreshActiveCase();
  $('#caseList').innerHTML = cases.length ? `<ul class="list">${cases.map((c) => `
    <li><span>${esc(c.name)}${c.id === activeCaseId ? ' <b class="badge">Active</b>' : ''}</span>
    <span class="row-actions">
      ${c.id === activeCaseId ? '' : `<button type="button" data-use="${esc(c.id)}">Use</button>`}
      <button type="button" data-open="${esc(c.id)}">Open</button>
      <button type="button" data-export="${esc(c.id)}">Export</button>
      <button type="button" data-del="${esc(c.id)}" aria-label="Delete case ${esc(c.name)}">Delete</button>
    </span></li>`).join('')}</ul>` : '<p class="hint">No cases yet. A case holds the sources you save while researching one subject.</p>';
  await renderViewer();
  await renderCaseTools(cases);
  const active = cases.find((c) => c.id === activeCaseId);
  $('#askCaseLine').textContent = active ? `Asking about: ${active.name}` : 'No case selected.';
  if (discovery) discovery.refresh();
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
  if (b.dataset.del) {
    // Deleting is two deliberate steps. Step 1 saves a copy of the case to Downloads and deletes NOTHING. Step 2 (below) deletes
    // only after the person confirms the copy is there, because the browser cannot tell this page whether a download finished.
    try {
      const filename = await downloadCaseFile(b.dataset.del);
      $('#importBox').innerHTML = `<div class="notice" role="group" aria-labelledby="delTitle"><p id="delTitle"><strong>Delete this case?</strong></p>
        <p>A backup copy was saved as <strong>${esc(filename)}</strong>. Check that the file is in your Downloads folder before you continue. If you delete the case, the only way to get it back is Import case file with that file.</p>
        <p class="actions"><button type="button" id="keepCase" class="primary">Keep the case</button> <button type="button" id="confirmDelete" data-del-id="${esc(b.dataset.del)}">Delete the case</button></p></div>`;
      $('#keepCase').focus();
    } catch (err) { $('#importBox').textContent = `Nothing was deleted, because the backup copy could not be saved: ${err.message}`; }
  }
  if (b.dataset.export) {
    try {
      const filename = await downloadCaseFile(b.dataset.export);
      $('#importBox').textContent = `Saved ${filename}. Open it on the website or another device with Import case file.`;
    } catch (err) { $('#importBox').textContent = `Could not export: ${err.message}`; }
  }
  if (b.dataset.open) { viewCaseId = b.dataset.open; viewTab = 'bigpicture'; viewTarget = null; await renderViewer(); }
});

async function downloadCaseFile(caseId) {
  const { filename, text } = await exportInvestigationFile(caseId);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return filename;
}

// ---- case tools: rename, add a source by hand, add an evidence passage by hand ----
let toolsOpen = false;
async function renderCaseTools(cases) {
  const box = $('#caseTools');
  const active = cases.find((c) => c.id === activeCaseId);
  if (!active) { box.innerHTML = ''; return; }
  const sources = await listInvestigationRecords(activeCaseId);
  const sourceOptions = sources.map((r) => `<option value="${esc(r.id)}">${esc((r.title || r.originalUrl || 'Untitled source').slice(0, 90))}</option>`).join('');
  box.innerHTML = `<details class="tools" id="toolsDetails"${toolsOpen ? ' open' : ''}>
    <summary>Edit this case and add material by hand</summary>
    <form id="renameForm" class="stack" novalidate>
      <h4>Case name</h4>
      <label for="renameInput">Name of the active case</label>
      <input id="renameInput" type="text" maxlength="120" value="${esc(active.name)}" required aria-describedby="toolsError" />
      <button type="submit">Save name</button>
    </form>
    <form id="addSourceForm" class="stack" novalidate>
      <h4>Add a document or source by hand</h4>
      <label for="srcTitle">Title (required)</label>
      <input id="srcTitle" type="text" maxlength="300" required aria-describedby="toolsError" />
      <label for="srcUrl">Web address (optional, starts with https://)</label>
      <input id="srcUrl" type="url" maxlength="2000" placeholder="https://" aria-describedby="toolsError" />
      <label for="srcDate">Date of the document (optional)</label>
      <input id="srcDate" type="date" />
      <label for="srcFrom">Where it came from (optional)</label>
      <input id="srcFrom" type="text" maxlength="200" placeholder="For example: City Hall records office" />
      <label for="srcText">Its text, or your notes about it (optional)</label>
      <textarea id="srcText" maxlength="50000"></textarea>
      <button type="submit" class="primary">Add to this case</button>
    </form>
    <form id="addEvidenceForm" class="stack" novalidate>
      <h4>Add an evidence passage by hand</h4>
      ${sources.length ? `<label for="evSource">From which source</label>
      <select id="evSource" required aria-describedby="toolsError">${sourceOptions}</select>
      <label for="evText">The passage or quote (required)</label>
      <textarea id="evText" maxlength="5000" required aria-describedby="toolsError"></textarea>
      <label for="evLocation">Page or place in the document (optional)</label>
      <input id="evLocation" type="text" maxlength="200" placeholder="For example: page 4, paragraph 2" />
      <label for="evNotes">Your note (optional)</label>
      <input id="evNotes" type="text" maxlength="500" />
      <button type="submit" class="primary">Save passage</button>` : '<p class="hint">Add a source first (above, or from Search). A passage always belongs to a source, so anyone can check where it came from.</p>'}
    </form>
    <p id="toolsError" class="field-error" role="alert" hidden></p>
    <p id="toolsStatus" class="toolsStatus" role="status" aria-live="polite"></p>
  </details>`;
  $('#toolsDetails').addEventListener('toggle', (e) => { toolsOpen = e.target.open; });
}
function toolsFail(message, field) {
  const err = $('#toolsError'); err.textContent = message; err.hidden = false;
  $('#toolsStatus').textContent = '';
  if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
}
function toolsOk(message) {
  const err = $('#toolsError'); err.hidden = true; err.textContent = '';
  document.querySelectorAll('#caseTools [aria-invalid]').forEach((f) => f.removeAttribute('aria-invalid'));
  $('#toolsStatus').textContent = message;
}
$('#caseTools').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = e.target.id;
  try {
    if (id === 'renameForm') {
      const input = $('#renameInput'); const name = input.value.trim();
      if (!name) return toolsFail('A case needs a name.', input);
      await updateInvestigation(activeCaseId, { name });
      await renderCases(); toolsOk(`Saved. The case is now called "${name}".`);
    } else if (id === 'addSourceForm') {
      const title = $('#srcTitle'); const url = $('#srcUrl');
      if (!title.value.trim()) return toolsFail('Give the document a title.', title);
      let address = '';
      if (url.value.trim()) { address = safeUrl(url.value.trim()); if (!address) return toolsFail('The web address must start with https:// or http://. Leave it empty if the document has none.', url); }
      const text = $('#srcText').value.trim(); const date = $('#srcDate').value;
      const key = address || `manual:${crypto.randomUUID()}`;
      if (address && (await getSavedCanonicalKeys(activeCaseId)).has(key)) return toolsFail('That web address is already saved in this case.', url);
      await saveRecordToInvestigation(activeCaseId, {
        canonicalKey: key, title: title.value.trim(), originalUrl: address, archiveUrl: '', source: $('#srcFrom').value.trim() || 'Added by hand',
        captureDate: date || null, snippet: text.slice(0, 300), extractedText: text, addedBy: 'hand'
      });
      toolsOpen = true; await renderCases(); toolsOk(`Added "${title.value.trim()}" to this case.`);
    } else if (id === 'addEvidenceForm') {
      const text = $('#evText');
      if (!text.value.trim()) return toolsFail('Type or paste the passage you want to keep.', text);
      await createEvidenceItem(activeCaseId, { sourceRecordId: $('#evSource').value, excerptType: 'quote', excerptText: text.value, location: $('#evLocation').value, notes: $('#evNotes').value });
      toolsOpen = true; await renderCases(); toolsOk('Saved the passage. It is listed under its source in this case.');
    }
  } catch (err) { toolsFail(`Could not save: ${err.message}`); }
});

// ---- back up or restore everything (whole database; restoring never overwrites) ----
let pendingRestore = null;
$('#backupAllBtn').addEventListener('click', async () => {
  const box = $('#backupBox');
  try {
    const backup = await buildRawBackup();
    if (!backup) { box.textContent = 'There is nothing to back up yet.'; return; }
    const name = backupFileName(backup);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    const c = backup.counts || {};
    box.textContent = `Saved ${name}: ${c.investigations || 0} case(s), ${c.records || 0} source(s), ${c.evidenceItems || 0} evidence passage(s). Keep it somewhere safe.`;
  } catch (err) { box.textContent = `The backup could not be made: ${err.message}. Nothing was changed.`; }
});
$('#restoreBtn').addEventListener('click', () => $('#restoreFileInput').click());
$('#restoreFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = ''; pendingRestore = null;
  if (!file) return;
  const box = $('#backupBox');
  try {
    const backup = parseBackupText(await file.text());
    pendingRestore = backup;
    const c = backup.counts || {};
    box.innerHTML = `<div class="notice"><p><strong>Restore this backup?</strong></p><p>It holds ${c.investigations || 0} case(s), ${c.records || 0} source(s) and ${c.evidenceItems || 0} evidence passage(s), saved ${esc(String(backup.createdAt || '').slice(0, 10))}. Anything you already have stays exactly as it is; only what is missing is added.</p>
      <p class="actions"><button type="button" id="confirmRestore" class="primary">Restore</button> <button type="button" id="cancelRestore">Cancel</button></p></div>`;
    $('#confirmRestore').focus();
  } catch (err) { box.innerHTML = `<p class="notice">${esc(err instanceof BackupFileError ? err.message : 'That file could not be read: ' + err.message)}</p>`; }
});
$('#backupBox').addEventListener('click', async (e) => {
  if (e.target.id === 'cancelRestore') { pendingRestore = null; $('#backupBox').textContent = ''; }
  if (e.target.id === 'confirmRestore' && pendingRestore) {
    try {
      const rep = await restoreRawBackup(pendingRestore, { openCurrentDb: () => openDb() });
      pendingRestore = null;
      const added = Object.values(rep.added || {}).reduce((n, v) => n + v, 0);
      $('#backupBox').textContent = `Restored. Added ${added} item(s); ${Object.values(rep.kept || {}).reduce((n, v) => n + v, 0)} you already had were left as they were.`;
      await renderCases();
    } catch (err) { $('#backupBox').textContent = `The restore failed and nothing was overwritten: ${err.message}`; }
  }
});

// ---- investigation views: Big Picture / Overview / Deep Dive ----
// Same model and renderers as the website (lib/views.js); one snapshot of the
// case feeds all three, so what you see at each level is the same data.
let viewCaseId = null, viewTab = 'bigpicture', viewTarget = null, viewBefore = 'bigpicture', pendingFocus = false;
const viewScrollY = {};
const VIEW_LABEL = Object.fromEntries(VIEWS.map((v) => [v.id, v.label]));
async function renderViewer() {
  const box = $('#caseDetail');
  if (!viewCaseId) { box.innerHTML = ''; return; }
  const cases = await listInvestigations();
  const inv = cases.find((x) => x.id === viewCaseId);
  if (!inv) { viewCaseId = null; box.innerHTML = ''; return; }
  let model;
  try { const snap = await readInvestigationForExport(viewCaseId); model = buildModel(snap); try { model.recovery = buildRecoveryModel(snap); model.recoveryLink = null; } catch { model.recovery = null; } } catch (err) { box.innerHTML = `<p class="notice" role="alert">Could not load this case: ${esc(err.message)}</p>`; return; }
  const t = viewTab === 'deepdive' && viewTarget ? resolveTarget(model, viewTarget) : null;
  const tabs = VIEWS.map((v) => `<button type="button" role="tab" id="vt-${v.id}" aria-selected="${v.id === viewTab}" aria-controls="vpanel" tabindex="${v.id === viewTab ? 0 : -1}" data-viewtab="${v.id}">${esc(v.label)}</button>`).join('');
  const crumbs = `<ol class="vw-crumb-list"><li>My Research</li><li>${esc(inv.name)}</li><li${t ? '' : ' aria-current="page"'}>${esc(VIEW_LABEL[viewTab])}</li>${t ? `<li aria-current="page">${esc(t.title.slice(0, 50))}</li>` : ''}</ol>${viewTab === 'deepdive' && t ? `<button type="button" data-goto="${viewBefore}">← Back to ${esc(VIEW_LABEL[viewBefore])}</button>` : ''}`;
  box.innerHTML = `<h3>${esc(inv.name)}</h3><div class="vw-tabs" role="tablist" aria-label="Investigation views">${tabs}</div><nav aria-label="You are here">${crumbs}</nav><div id="vpanel" role="tabpanel" aria-labelledby="vt-${viewTab}">${viewHtml(viewTab, model, viewTarget)}</div>`;
  if (viewTab === 'deepdive' && viewTarget && t) { $('#howWeKnow')?.focus(); }
  else window.scrollTo(0, viewScrollY[viewTab] || 0);
}
function goView(path) {
  // path: 'bigpicture' | 'overview' | 'deepdive' | 'deepdive/<kind>/<id>'
  if (VIEWS.some((v) => v.id === viewTab)) { viewScrollY[viewTab] = window.scrollY; if (viewTab !== 'deepdive') viewBefore = viewTab; }
  const [tab, ...rest] = path.split('/');
  viewTab = tab; viewTarget = rest.length ? rest.join('/') : null;
  return renderViewer();
}
$('#caseDetail').addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) { e.preventDefault(); goView(g.dataset.goto); return; }
  const t = e.target.closest('[data-viewtab]');
  if (t) goView(t.dataset.viewtab);
});
$('#caseDetail').addEventListener('keydown', (e) => {
  const t = e.target.closest('[data-viewtab]');
  if (!t || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const ids = VIEWS.map((v) => v.id);
  const next = ids[(ids.indexOf(t.dataset.viewtab) + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length];
  e.preventDefault();
  goView(next).then(() => $('#vt-' + next)?.focus());
});

// ---- import a case file (preview first, never overwrites) ----
let pendingBundle = null;
$('#importCaseBtn').addEventListener('click', () => $('#caseFileInput').click());
$('#caseFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  pendingBundle = null;
  if (!file) return;
  try {
    const { bundle, report } = await previewImport(await file.text());
    pendingBundle = bundle;
    $('#importBox').innerHTML = `<div class="notice"><p><strong>Import this case?</strong></p>${describeReport(report).map((l) => `<p>${esc(l)}</p>`).join('')}
      <p class="actions"><button type="button" id="confirmImport" class="primary">Import</button> <button type="button" id="cancelImport">Cancel</button></p></div>`;
    $('#confirmImport').focus();
  } catch (err) {
    $('#importBox').innerHTML = `<p class="notice">${esc(err instanceof PortableFileError ? err.message : 'Import failed: ' + err.message)}</p>`;
  }
});
$('#importBox').addEventListener('click', async (e) => {
  if (e.target.id === 'keepCase') { $('#importBox').textContent = 'The case was kept. A backup copy is still in your Downloads folder.'; return; }
  if (e.target.id === 'confirmDelete') {
    try { await deleteInvestigation(e.target.dataset.delId); $('#importBox').textContent = 'The case was deleted. To get it back, use Import case file and choose the backup copy.'; }
    catch (err) { $('#importBox').textContent = `The case could not be deleted: ${err.message}`; }
    await renderCases(); return;
  }
  if (e.target.id === 'cancelImport') { pendingBundle = null; $('#importBox').innerHTML = ''; }
  if (e.target.id === 'confirmImport' && pendingBundle) {
    try {
      const done = await importBundle(pendingBundle);
      pendingBundle = null;
      $('#importBox').innerHTML = `<div class="notice">${describeReport(done, { done: true }).map((l) => `<p>${esc(l)}</p>`).join('')}</div>`;
      await renderCases();
    } catch (err) { $('#importBox').innerHTML = `<p class="notice">Import failed: ${esc(err.message)}</p>`; }
  }
});

// ---- Ask Chronium (questions about the active case) ----
let askContext = {};
async function askChronium(q) {
  const out = $('#askOut');
  if (!activeCaseId) { out.innerHTML = '<p class="notice">Create or choose a case first. Ask Chronium answers from the sources in a case.</p>'; return; }
  out.textContent = 'Working on it...';
  try {
    const snapshot = await readInvestigationForExport(activeCaseId);
    const answer = answerQuestion(q, snapshot, askContext);
    if (answer) {
      askContext = { ...askContext, ...answer.context };
      out.innerHTML = answerHtml(answer);
    } else {
      const hits = await searchInvestigation(activeCaseId, extractSearchTerms(q), 10);
      out.innerHTML = hits.length
        ? `<h3 class="ask-title">${hits.length} source${hits.length === 1 ? '' : 's'} mention this</h3><p class="ask-summary">Best matches first. These are text matches, not conclusions.</p>${hits.map((h) => `<article class="ask-item"><h4>${esc(h.title || h.originalUrl || 'Source')}</h4>${h.matchPassage ? `<blockquote class="ask-excerpt">${esc(h.matchPassage)}</blockquote>` : ''}<p>${linkHtml(h.originalUrl, 'Open original')} ${linkHtml(h.archiveUrl, 'Open archived copy')}</p></article>`).join('')}`
        : '<h3 class="ask-title">No saved source matches this</h3><p class="ask-summary">That does not show the record does not exist: only that nothing saved in this case matches. Try other words, or add more documents.</p>';
    }
  } catch (err) {
    out.innerHTML = `<p class="notice">Could not answer: ${esc(err.message)}</p>`;
  }
  out.focus();
}
$('#askForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#askQ').value.trim(); if (q) askChronium(q); });
$('#askOut').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ask-followup]');
  if (b) { $('#askQ').value = b.dataset.askFollowup; askChronium(b.dataset.askFollowup); }
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
  let md = rows.map((r, i) => `${i + 1}. ${r.title || r.originalUrl || 'Untitled'}\n   - Original: ${r.originalUrl || 'n/a'}\n   - Archive: ${r.archiveUrl || 'n/a'}\n   - Source: ${r.source || 'n/a'}; capture date: ${r.captureDate || 'n/a'}; saved: ${r.savedAt || 'n/a'}`).join('\n');
  // Appendix: what this case holds and does not hold (Records Recovery), in plain text with its notice and unknowns.
  try { md += `\n\n${recoveryText(buildRecoveryModel(await readInvestigationForExport(activeCaseId)))}`; } catch { /* the source list still stands */ }
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
  const err = $('#workerUrlError');
  if (!u) {
    // Identified in text, announced, tied to the field, focus returned to it (no alert() popup).
    err.textContent = 'Enter a full web address that starts with https:// (for example https://chronium-mind.truewolfflix777.workers.dev).';
    err.hidden = false; $('#workerUrl').setAttribute('aria-invalid', 'true'); $('#workerUrl').focus();
    return;
  }
  err.hidden = true; err.textContent = ''; $('#workerUrl').removeAttribute('aria-invalid');
  workerUrl = u.replace(/\/$/, ''); await setStore('workerUrl', workerUrl);
});

// ---- Deep Discovery (Find public records) ----
let discovery = null;
function mountDiscovery() {
  discovery = mountDiscoveryPanel($('#discoveryMount'), {
    mode: 'extension',
    getInvestigation: () => (activeCaseId ? { id: activeCaseId, name: activeCaseName || 'Open case' } : null),
    // The side panel reads sites directly (host permission granted per site); redirects are validated by the engine afterwards.
    makeFetcher: () => createFetchApiFetcher({ manualRedirects: false }),
    archiveLookup: (u) => createArchiveLookup({ base: workerUrl })(u),
    requestAccess: requestSiteAccess,
    extract: plainTextExtract,
    budgetStorage: { get: (k) => store('dc:' + k, null), set: (k, v) => setStore('dc:' + k, v) },
    listRuns: listDiscoveryRuns, listLedger: listDiscoveryLedger,
    onSaved: () => { refreshActiveCase(); }
  });
}

(async function init() {
  if (!(await startupGate())) return; // a message is on screen; the database was not changed
  try {
    const persisted = (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.());
    $('#persistLine').textContent = persisted ? 'Chrome has marked this storage as protected from automatic clean-up.' : 'Chrome has not marked this storage as protected from automatic clean-up. It is cleared only if you clear this extension\'s data, but keeping a backup file is wise.';
  } catch { /* not available */ }
  workerUrl = await store('workerUrl', DEFAULT_WORKER);
  activeCaseId = await store('activeCaseId', null);
  $('#workerUrl').value = workerUrl;
  await refreshActiveCase();
  mountDiscovery();
})();
