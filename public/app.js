import {
  listInvestigations, createInvestigation, deleteInvestigation,
  saveRecordToInvestigation, removeRecordFromInvestigation, listInvestigationRecords,
  getSavedCanonicalKeys, searchLibrary, addUserUrl, listIngestionBatches, getBlob
} from './db.js';
import { ingestFiles, ingestZip } from './ingest/pipeline.js';

const form = document.querySelector('#searchForm');
const input = document.querySelector('#query');
const statusBox = document.querySelector('#status');
const section = document.querySelector('#resultsSection');
const list = document.querySelector('#results');
const title = document.querySelector('#resultsTitle');
const coverage = document.querySelector('#coverage');
const sourceFilter = document.querySelector('#sourceFilter');
const typeFilter = document.querySelector('#typeFilter');

const investigationSelect = document.querySelector('#investigationSelect');
const newInvestigationBtn = document.querySelector('#newInvestigationBtn');
const newInvestigationForm = document.querySelector('#newInvestigationForm');
const cancelNewInvestigation = document.querySelector('#cancelNewInvestigation');
const deleteInvestigationBtn = document.querySelector('#deleteInvestigationBtn');
const toggleLibraryBtn = document.querySelector('#toggleLibraryBtn');
const librarySection = document.querySelector('#librarySection');
const libraryList = document.querySelector('#libraryResults');
const addUrlForm = document.querySelector('#addUrlForm');
const workspaceStatus = document.querySelector('#workspaceStatus');
const bulkImportBtn = document.querySelector('#bulkImportBtn');
const bulkImportForm = document.querySelector('#bulkImportForm');
const bulkImportInput = document.querySelector('#bulkImportInput');
const preserveOriginalsCheckbox = document.querySelector('#preserveOriginalsCheckbox');
const bulkImportProgress = document.querySelector('#bulkImportProgress');
const toggleReportBtn = document.querySelector('#toggleReportBtn');
const reportSection = document.querySelector('#reportSection');
const reportSummary = document.querySelector('#reportSummary');
const reportList = document.querySelector('#reportList');

let current = [];
let activeInvestigationId = localStorage.getItem('chronium.activeInvestigation') || '';
let savedKeys = new Set();

document.querySelectorAll('[data-q]').forEach(btn => btn.addEventListener('click', () => { input.value = btn.dataset.q; form.requestSubmit(); }));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = input.value.trim(); if (!q) return;
  setStatus(`Searching Chronium heads for “${q}”…`);
  section.classList.add('hidden');
  try {
    const [res, libraryHits] = await Promise.all([
      fetch(`/api/search?q=${encodeURIComponent(q)}&limit=25`),
      searchLibrary(q, 25)
    ]);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed');
    current = [...(data.results || []), ...libraryHits];
    title.textContent = `${current.length} historical result${current.length === 1 ? '' : 's'}`;
    renderCoverage(data, libraryHits);
    buildFilters(current);
    render();
    section.classList.remove('hidden');
    setStatus(data.mode === 'topic'
      ? `Topic mode: only heads with full-text capability were queried. ${data.tookMs} ms.`
      : `URL history mode: archive capture indexes were queried. ${data.tookMs} ms.`);
  } catch (err) { setStatus(`Search error: ${err.message}`, true); }
});
sourceFilter.addEventListener('change', render); typeFilter.addEventListener('change', render);

function renderCoverage(data, libraryHits) {
  const connectors = [...data.connectors, { source: 'My Library', capability: 'personal saved records', ok: true, count: libraryHits.length, note: null }];
  coverage.innerHTML = connectors.map(c => `<div class="source ${c.ok ? '' : 'bad'}"><strong><i class="dot ${c.ok ? 'live' : ''}"></i>${esc(c.source)} · ${c.ok ? c.count : 'unavailable'}</strong><p>${esc(c.capability)}${c.note ? `<br>${esc(c.note)}` : ''}${c.error ? `<br>${esc(c.error)}` : ''}</p></div>`).join('');
}
function buildFilters(items) {
  const sources = [...new Set(items.map(x=>x.source).filter(Boolean))].sort();
  const types = [...new Set(items.map(x=>bucket(x.mime)).filter(Boolean))].sort();
  sourceFilter.innerHTML = '<option value="all">All sources</option>'+sources.map(x=>`<option>${esc(x)}</option>`).join('');
  typeFilter.innerHTML = '<option value="all">All content</option>'+types.map(x=>`<option>${esc(x)}</option>`).join('');
}
function render() {
  const sf=sourceFilter.value, tf=typeFilter.value;
  const filtered=current.filter(x=>(sf==='all'||x.source===sf)&&(tf==='all'||bucket(x.mime)===tf));
  list.innerHTML = filtered.length ? filtered.map(x=>card(x,'search')).join('') : '<p class="status">No results match these filters.</p>';
}
function canonicalKeyOf(x) { return x.canonicalKey || x.originalUrl || x.archiveUrl || x.id; }
function kindClass(k) { return k === 'investigation-corpus' ? 'kind-corpus' : k === 'personal-library' ? 'kind-library' : 'kind-connector'; }
function kindLabel(k) { return k === 'investigation-corpus' ? 'Investigation corpus' : k === 'personal-library' ? 'My library' : 'Archive connector'; }
function card(x, mode) {
  const d=x.captureDate ? new Date(x.captureDate) : null;
  const year=d&&!isNaN(d)?d.getUTCFullYear():'Unknown';
  const date=d&&!isNaN(d)?d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'Capture date unavailable';
  const key = canonicalKeyOf(x);
  const isSaved = savedKeys.has(key);
  const action = mode === 'library'
    ? `<button type="button" class="mini remove-btn" data-record-id="${attr(x.id)}">Remove</button>`
    : activeInvestigationId
      ? `<button type="button" class="mini save-btn" data-key="${attr(key)}" ${isSaved ? 'disabled' : ''}>${isSaved ? 'Saved' : 'Save'}</button>`
      : `<button type="button" class="mini" disabled title="Select or create an investigation first">Save</button>`;
  const previewAction = x.sourceType === 'bulk-document'
    ? (x.storageMode === 'local-copy'
        ? `<button type="button" class="mini preview-btn" data-hash="${attr(x.fileHash)}" data-mime="${attr(x.mime)}">Preview original</button>`
        : `<span class="hint">Not stored by Chronium — original at: ${esc(x.filePath || x.title)}</span>`)
    : '';
  return `<article class="card"><div class="when"><strong>${esc(year)}</strong>${esc(date)}</div><div><h3>${esc(x.title||x.originalUrl||'Archived result')}</h3>${x.originalUrl?`<div class="url">${esc(x.originalUrl)}</div>`:''}${x.sourceId?`<div class="url">${esc(x.sourceId)}</div>`:''}${x.snippet?`<p class="snippet">${esc(x.snippet).slice(0,450)}</p>`:''}${previewAction}<div class="tags"><span class="tag ${kindClass(x.sourceKind)}">${esc(kindLabel(x.sourceKind))}</span><span class="tag">${esc(x.source)}</span><span class="tag">${esc(x.matchType||'archive')}</span>${x.mime?`<span class="tag">${esc(x.mime)}</span>`:''}${x.language?`<span class="tag">${esc(x.language)}</span>`:''}</div></div><div class="actions">${x.archiveUrl?`<a class="primary" target="_blank" rel="noopener" href="${attr(x.archiveUrl)}">View source</a>`:''}${x.originalUrl?`<a target="_blank" rel="noopener" href="${attr(asUrl(x.originalUrl))}">Live URL</a>`:''}${action}</div></article>`;
}
function bucket(m=''){m=String(m).toLowerCase();if(m.includes('pdf'))return'PDF';if(m.startsWith('image/'))return'Image';if(m.includes('html'))return'Webpage';if(m.includes('audio'))return'Audio';if(m.includes('video'))return'Video';return m?'Other':'Unknown'}
function setStatus(msg,bad=false){statusBox.textContent=msg;statusBox.classList.remove('hidden');statusBox.style.color=bad?'#ff8a8a':''}
function setWorkspaceStatus(msg,bad=false){workspaceStatus.textContent=msg;workspaceStatus.classList.remove('hidden');workspaceStatus.style.color=bad?'#ff8a8a':''}
function asUrl(u){return /^https?:\/\//i.test(u)?u:`https://${u}`}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function attr(s=''){return esc(s)}

list.addEventListener('click', async (e) => {
  const btn = e.target.closest('.save-btn');
  if (!btn || btn.disabled || !activeInvestigationId) return;
  const item = current.find(r => canonicalKeyOf(r) === btn.dataset.key);
  if (!item) return;
  btn.disabled = true;
  await saveRecordToInvestigation(activeInvestigationId, item);
  savedKeys.add(btn.dataset.key);
  setWorkspaceStatus(`Saved "${item.title || item.originalUrl}" to your investigation.`);
  render();
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.preview-btn');
  if (!btn) return;
  const row = await getBlob(btn.dataset.hash);
  if (!row) { setWorkspaceStatus('Original not found in this browser (was it imported with "keep a local copy" off?).', true); return; }
  const url = URL.createObjectURL(row.blob);
  window.open(url, '_blank', 'noopener');
});

libraryList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.remove-btn');
  if (!btn || !activeInvestigationId) return;
  await removeRecordFromInvestigation(activeInvestigationId, btn.dataset.recordId);
  savedKeys = await getSavedCanonicalKeys(activeInvestigationId);
  await renderLibrary();
  render();
  setWorkspaceStatus('Removed from investigation.');
});

async function refreshInvestigationOptions() {
  const investigations = await listInvestigations();
  const valid = new Set(investigations.map(i => i.id));
  if (activeInvestigationId && !valid.has(activeInvestigationId)) activeInvestigationId = '';
  investigationSelect.innerHTML = '<option value="">No investigation selected</option>' +
    investigations.map(i => `<option value="${attr(i.id)}">${esc(i.name)}</option>`).join('');
  investigationSelect.value = activeInvestigationId;
  return investigations;
}

async function setActiveInvestigation(id) {
  activeInvestigationId = id;
  localStorage.setItem('chronium.activeInvestigation', id);
  deleteInvestigationBtn.disabled = !id;
  toggleLibraryBtn.disabled = !id;
  bulkImportBtn.disabled = !id;
  toggleReportBtn.disabled = !id;
  addUrlForm.classList.toggle('hidden', !id);
  bulkImportForm.classList.add('hidden');
  librarySection.classList.add('hidden');
  reportSection.classList.add('hidden');
  toggleLibraryBtn.setAttribute('aria-expanded', 'false');
  toggleReportBtn.setAttribute('aria-expanded', 'false');
  savedKeys = id ? await getSavedCanonicalKeys(id) : new Set();
  render();
}

async function renderLibrary() {
  if (!activeInvestigationId) { libraryList.innerHTML = ''; return; }
  const records = await listInvestigationRecords(activeInvestigationId);
  libraryList.innerHTML = records.length
    ? records.map(r => card(r, 'library')).join('')
    : '<p class="status">Nothing saved to this investigation yet.</p>';
}

investigationSelect.addEventListener('change', () => setActiveInvestigation(investigationSelect.value));

newInvestigationBtn.addEventListener('click', () => {
  newInvestigationForm.classList.remove('hidden');
  document.querySelector('#newInvestigationName').focus();
});
cancelNewInvestigation.addEventListener('click', () => {
  newInvestigationForm.reset();
  newInvestigationForm.classList.add('hidden');
});
newInvestigationForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.querySelector('#newInvestigationName').value.trim();
  if (!name) return;
  const description = document.querySelector('#newInvestigationDescription').value.trim();
  const investigation = await createInvestigation({ name, description });
  await refreshInvestigationOptions();
  investigationSelect.value = investigation.id;
  await setActiveInvestigation(investigation.id);
  newInvestigationForm.reset();
  newInvestigationForm.classList.add('hidden');
  setWorkspaceStatus(`Created investigation "${investigation.name}".`);
});

deleteInvestigationBtn.addEventListener('click', async () => {
  if (!activeInvestigationId) return;
  const name = investigationSelect.selectedOptions[0]?.textContent || 'this investigation';
  if (!confirm(`Delete "${name}"? Saved records stay in your library but will no longer be linked to this investigation.`)) return;
  await deleteInvestigation(activeInvestigationId);
  await refreshInvestigationOptions();
  await setActiveInvestigation('');
  setWorkspaceStatus(`Deleted investigation "${name}".`);
});

toggleLibraryBtn.addEventListener('click', async () => {
  const willOpen = librarySection.classList.contains('hidden');
  if (willOpen) await renderLibrary();
  librarySection.classList.toggle('hidden', !willOpen);
  toggleLibraryBtn.setAttribute('aria-expanded', String(willOpen));
});

bulkImportBtn.addEventListener('click', () => {
  bulkImportForm.classList.toggle('hidden');
});

bulkImportForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeInvestigationId) return;
  const files = bulkImportInput.files;
  if (!files || !files.length) return;
  const preserveOriginals = preserveOriginalsCheckbox.checked;

  bulkImportProgress.classList.remove('hidden');
  bulkImportProgress.textContent = 'Starting import…';
  const onProgress = (p) => {
    bulkImportProgress.textContent = p.status === 'error'
      ? `Processed ${p.processed} files — error on "${p.current}": ${p.error}`
      : `Processed ${p.processed} files (${formatBytes(p.byteTotal)}) — current: ${p.current}`;
  };

  try {
    const isSingleZip = files.length === 1 && /\.zip$/i.test(files[0].name);
    const batch = isSingleZip
      ? await ingestZip(files[0], activeInvestigationId, onProgress, { preserveOriginals })
      : await ingestFiles(files, activeInvestigationId, onProgress, { preserveOriginals });

    savedKeys = await getSavedCanonicalKeys(activeInvestigationId);
    bulkImportForm.reset();
    bulkImportProgress.classList.add('hidden');
    setWorkspaceStatus(`Imported ${batch.fileCount} file${batch.fileCount === 1 ? '' : 's'} (${formatBytes(batch.byteTotal)}). ${batch.skipped.length} unrecognized, ${batch.errors.length} errors.`);
    if (!librarySection.classList.contains('hidden')) await renderLibrary();
    if (!reportSection.classList.contains('hidden')) await renderReport();
  } catch (err) {
    bulkImportProgress.textContent = `Import failed: ${err.message}`;
  }
});

toggleReportBtn.addEventListener('click', async () => {
  const willOpen = reportSection.classList.contains('hidden');
  if (willOpen) await renderReport();
  reportSection.classList.toggle('hidden', !willOpen);
  toggleReportBtn.setAttribute('aria-expanded', String(willOpen));
});

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

async function renderReport() {
  if (!activeInvestigationId) { reportSummary.innerHTML = ''; reportList.innerHTML = ''; return; }
  const [batches, records] = await Promise.all([
    listIngestionBatches(activeInvestigationId),
    listInvestigationRecords(activeInvestigationId)
  ]);
  const docs = records.filter((r) => r.sourceType === 'bulk-document');
  const duplicates = docs.filter((r) => r.isDuplicateOf).length;
  const totalBytes = docs.reduce((n, r) => n + (r.fileSize || 0), 0);
  const skippedTotal = batches.reduce((n, b) => n + (b.skipped?.length || 0), 0);
  const errorTotal = batches.reduce((n, b) => n + (b.errors?.length || 0), 0);

  reportSummary.innerHTML = [
    { label: 'Batches', value: batches.length },
    { label: 'Files ingested', value: docs.length },
    { label: 'Total size', value: formatBytes(totalBytes) },
    { label: 'Unrecognized types', value: skippedTotal },
    { label: 'Errors', value: errorTotal }
  ].map((s) => `<div class="source"><strong>${esc(String(s.value))}</strong><p>${esc(s.label)}</p></div>`).join('');

  reportList.innerHTML = docs.length ? `<table><thead><tr><th>Source ID</th><th>Name</th><th>Type</th><th>Size</th><th>Hash</th><th>Snippet</th><th>Original</th></tr></thead><tbody>${
    docs.map((r) => `<tr><td>${esc(r.sourceId || '')}</td><td>${esc(r.title || '')}</td><td>${esc(r.mime || '')}</td><td>${esc(formatBytes(r.fileSize))}</td><td title="${attr(r.fileHash || '')}">${esc((r.fileHash || '').slice(0, 10))}…</td><td>${esc((r.snippet || '').slice(0, 120))}</td><td>${
      r.storageMode === 'local-copy'
        ? `<button type="button" class="mini preview-btn" data-hash="${attr(r.fileHash)}">Preview</button>`
        : `<span class="hint">Not stored — ${esc(r.filePath || '')}</span>`
    }</td></tr>`).join('')
  }</tbody></table>` : '<p class="status">No documents ingested into this investigation yet.</p>';
}

addUrlForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeInvestigationId) return;
  const url = document.querySelector('#addUrlInput').value.trim();
  const urlTitle = document.querySelector('#addUrlTitle').value.trim();
  const note = document.querySelector('#addUrlNote').value.trim();
  if (!url) return;
  await addUserUrl(activeInvestigationId, { url, title: urlTitle, note });
  savedKeys = await getSavedCanonicalKeys(activeInvestigationId);
  addUrlForm.reset();
  setWorkspaceStatus(`Added ${url} to your investigation.`);
  if (!librarySection.classList.contains('hidden')) await renderLibrary();
});

(async function init() {
  await refreshInvestigationOptions();
  await setActiveInvestigation(activeInvestigationId);
})();
