import {
  listInvestigations, createInvestigation, deleteInvestigation,
  saveRecordToInvestigation, removeRecordFromInvestigation, listInvestigationRecords,
  getSavedCanonicalKeys, searchLibrary, searchInvestigation, addUserUrl, listIngestionBatches, getBlob,
  updateBibliographyDetails, getOutline, saveOutline, addOutlineLane, updateOutlineLane, deleteOutlineLane,
  listEvidenceItems, createEvidenceItem, deleteEvidenceItem, listClaims, createClaim, deleteClaim
} from './db.js';
import { ingestFiles, ingestZip } from './ingest/pipeline.js';
import { openOverlay, openMenu, confirmDialog } from './ui.js';

// ---------------------------------------------------------------------------
// Element refs
// ---------------------------------------------------------------------------
const navScrim = document.querySelector('#navScrim');
const navDrawer = document.querySelector('#navDrawer');
const navOpenBtn = document.querySelector('#navOpenBtn');
const navCloseBtn = document.querySelector('#navCloseBtn');
const navWorkspaceGroup = document.querySelector('#navWorkspaceGroup');
const navWorkspaceTitle = document.querySelector('#navWorkspaceTitle');

const form = document.querySelector('#searchForm');
const input = document.querySelector('#query');
const statusBox = document.querySelector('#status');
const resultsSection = document.querySelector('#resultsSection');
const list = document.querySelector('#results');
const title = document.querySelector('#resultsTitle');
const coverage = document.querySelector('#coverage');
const sourceFilter = document.querySelector('#sourceFilter');
const typeFilter = document.querySelector('#typeFilter');

const investigationSearchForm = document.querySelector('#investigationSearchForm');
const investigationQuery = document.querySelector('#investigationQuery');
const investigationSearchResults = document.querySelector('#investigationSearchResults');

const dashboardSummary = document.querySelector('#dashboardSummary');
const facetBar = document.querySelector('#facetBar');
const reportList = document.querySelector('#reportList');

const newInvestigationForm = document.querySelector('#newInvestigationForm');
const addUrlForm = document.querySelector('#addUrlForm');
const addResearchStatus = document.querySelector('#addResearchStatus');
const addResearchTarget = document.querySelector('#addResearchTarget');

const importZone = document.querySelector('#importZone');
const dropTarget = document.querySelector('#dropTarget');
const bulkImportFilesInput = document.querySelector('#bulkImportFilesInput');
const bulkImportFolderInput = document.querySelector('#bulkImportFolderInput');
const preserveOriginalsCheckbox = document.querySelector('#preserveOriginalsCheckbox');
const bulkImportProgress = document.querySelector('#bulkImportProgress');

const toast = document.querySelector('#toast');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let current = [];
let activeInvestigationId = localStorage.getItem('chronium.activeInvestigation') || '';
let savedKeys = new Set();
let activeFacet = 'documents';
let lastDashboardData = null; // { docs, records, duplicateEntries, skipped, errors, typeCounts }
let toastTimer = null;
let closeNav = null;
const activeCloses = {};

const WORKSPACE_TABS = [
  { id: 'overview', label: 'Overview', icon: 'icon-grid' },
  { id: 'outline', label: 'Outline', icon: 'icon-list' },
  { id: 'sources', label: 'Sources', icon: 'icon-file' },
  { id: 'evidence', label: 'Evidence', icon: 'icon-flag' },
  { id: 'analysis', label: 'Analysis', icon: 'icon-bar' },
  { id: 'timeline', label: 'Timeline', icon: 'icon-timeline' },
  { id: 'gaps', label: 'Gaps', icon: 'icon-gap' },
  { id: 'claims', label: 'Claims', icon: 'icon-quote' },
  { id: 'report', label: 'Report', icon: 'icon-doc-check' }
];
const DATA_DRIVEN_TABS = new Set(['overview', 'sources', 'timeline', 'outline', 'evidence', 'claims', 'gaps', 'report']);

// Analysis is the one workspace section still not built: real Quantitative
// & Qualitative analysis needs an AI call (theme extraction, trend
// narration over free text), a separate provider/cost decision, not
// something to fake with deterministic code.
const COMING_SOON = {
  analysis: {
    title: 'Quantitative & Qualitative Analysis',
    body: 'Not built yet. Chronium will support three analysis modes over your evidence base: Quantitative (trends, totals, variances), Qualitative (themes, rationale, chronology), and Mixed-Method (cross-checking numbers against narrative records) — always with methodology and citations preserved. This one needs an AI integration, which is a separate decision from the rest of the research pipeline.'
  }
};

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
function esc(s = '') { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function attr(s = '') { return esc(s); }
function asUrl(u) { return /^https?:\/\//i.test(u) ? u : `https://${u}`; }
function bucket(m = '') { m = String(m).toLowerCase(); if (m.includes('pdf')) return 'PDF'; if (m.startsWith('image/')) return 'Image'; if (m.includes('html')) return 'Webpage'; if (m.includes('audio')) return 'Audio'; if (m.includes('video')) return 'Video'; return m ? 'Other' : 'Unknown'; }
function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
function formatDate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown date';
}
function showToast(msg, bad = false) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.toggle('toast-bad', bad);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 4500);
}
function setStatus(msg, bad = false) { statusBox.textContent = msg; statusBox.classList.remove('hidden'); statusBox.classList.toggle('status-bad', bad); }
function setAddResearchStatus(msg, bad = false) { addResearchStatus.textContent = msg; addResearchStatus.classList.remove('hidden'); addResearchStatus.classList.toggle('status-bad', bad); }

function canonicalKeyOf(x) { return x.canonicalKey || x.originalUrl || x.archiveUrl || x.id; }
function kindClass(k) { return k === 'investigation-corpus' ? 'kind-corpus' : k === 'personal-library' ? 'kind-library' : 'kind-connector'; }
function kindLabel(k) { return k === 'investigation-corpus' ? 'Investigation corpus' : k === 'personal-library' ? 'My library' : 'Archive connector'; }

function resultRow(x, mode) {
  const d = x.captureDate ? new Date(x.captureDate) : null;
  const year = d && !isNaN(d) ? d.getUTCFullYear() : 'Unknown';
  const date = d && !isNaN(d) ? date_(d) : 'Capture date unavailable';
  const key = canonicalKeyOf(x);
  const isSaved = savedKeys.has(key);
  const action = mode === 'library'
    ? `<button type="button" class="remove-btn" data-record-id="${attr(x.id)}">Remove</button>`
    : activeInvestigationId
      ? `<button type="button" class="save-btn" data-key="${attr(key)}" ${isSaved ? 'disabled' : ''}>${isSaved ? 'Saved' : 'Save'}</button>`
      : `<button type="button" disabled title="Select or create an investigation first">Save</button>`;
  const previewAction = x.sourceType === 'bulk-document'
    ? (x.storageMode === 'local-copy'
        ? `<button type="button" class="preview-btn" data-hash="${attr(x.fileHash)}" data-mime="${attr(x.mime)}">Preview original</button>`
        : `<span class="hint">Not stored by Chronium — original at: ${esc(x.filePath || x.title)}</span>`)
    : '';
  // Archive/live links are buttons, not plain <a> tags: Chronium checks the
  // link resolves (and, for an archived copy, tries another preserved copy
  // of the same page from a different archive) before ever navigating -
  // never given a dead result when another working copy is available.
  const alternates = Array.isArray(x.alternateArchiveUrls) ? x.alternateArchiveUrls : [];
  const archiveBtn = x.archiveUrl
    ? `<button type="button" class="link-check primary" data-link-kind="archive" data-url="${attr(x.archiveUrl)}" data-alternates="${attr(JSON.stringify(alternates))}">View archived copy</button>`
    : '';
  const liveBtn = x.originalUrl
    ? `<button type="button" class="link-check" data-link-kind="live" data-url="${attr(asUrl(x.originalUrl))}">View current page</button>`
    : '';
  return `<article class="result-row"><div class="result-when"><strong>${esc(year)}</strong>${esc(date)}</div><div><h3>${esc(x.title || x.originalUrl || 'Archived result')}</h3>${x.originalUrl ? `<div class="result-url">${esc(x.originalUrl)}</div>` : ''}${x.sourceId ? `<div class="result-url">${esc(x.sourceId)}</div>` : ''}${x.snippet ? `<p class="result-snippet">${esc(x.snippet).slice(0, 450)}</p>` : ''}${previewAction}<div class="tags"><span class="tag ${kindClass(x.sourceKind)}">${esc(kindLabel(x.sourceKind))}</span><span class="tag">${esc(x.source)}</span><span class="tag">${esc(x.matchType || 'archive')}</span>${x.mime ? `<span class="tag">${esc(x.mime)}</span>` : ''}${x.language ? `<span class="tag">${esc(x.language)}</span>` : ''}</div></div><div class="result-actions">${archiveBtn}${liveBtn}${action}</div></article>`;
}
function date_(d) { return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }

// ---------------------------------------------------------------------------
// Dialog helpers (named overlays, reused across the app)
// ---------------------------------------------------------------------------
function openDialog(id, opts) {
  const overlay = document.querySelector(`#${id}`);
  const panel = overlay.querySelector('.dialog-panel');
  activeCloses[id] = openOverlay(overlay, panel, { ...opts, onClose: () => { activeCloses[id] = null; opts?.onClose?.(); } });
  return activeCloses[id];
}
function closeDialog(id) { activeCloses[id]?.(); }

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-dialog-close]');
  if (btn) closeDialog(btn.dataset.dialogClose);
});

async function openAddResearchDialogFor(investigationId) {
  const investigations = await listInvestigations();
  const inv = investigations.find((i) => i.id === investigationId);
  addResearchTarget.textContent = inv ? `Adding research to “${inv.name}”` : '';
  addUrlForm.reset();
  bulkImportProgress.classList.add('hidden');
  addResearchStatus.classList.add('hidden');
  openDialog('addResearchDialog');
}

// ---------------------------------------------------------------------------
// Nav drawer (mobile off-canvas / desktop persistent via CSS)
// ---------------------------------------------------------------------------
function openNav() {
  navDrawer.classList.remove('hidden');
  navOpenBtn.setAttribute('aria-expanded', 'true');
  closeNav = openOverlay(navScrim, navDrawer, {
    onClose: () => { navDrawer.classList.add('hidden'); navOpenBtn.setAttribute('aria-expanded', 'false'); closeNav = null; }
  });
}
navOpenBtn.addEventListener('click', openNav);
navCloseBtn.addEventListener('click', () => closeNav?.());
navDrawer.addEventListener('click', (e) => {
  if (e.target.closest('[data-route], [data-action]')) closeNav?.();
});

// ---------------------------------------------------------------------------
// Kebab menus (investigation cards + workspace header)
// ---------------------------------------------------------------------------
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('[data-kebab-toggle]');
  if (!trigger) return;
  const wrap = trigger.closest('.menu-wrap');
  const menu = wrap.querySelector('.menu');
  if (!menu.classList.contains('hidden')) { openMenu(menu, trigger); return; } // already-open guard falls through to close via outside click
  openMenu(menu, trigger);
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'new-investigation') {
    openDialog('newInvestigationDialog');
  } else if (action === 'import-research') {
    if (activeInvestigationId) await openAddResearchDialogFor(activeInvestigationId);
    else openDialog('newInvestigationDialog');
  } else if (action === 'research-search' || action === 'historical-web') {
    location.hash = '#/';
    requestAnimationFrame(() => input?.focus());
  } else if (action === 'delete-investigation') {
    const id = btn.dataset.id, name = btn.dataset.name;
    const ok = await confirmDialog({ title: 'Delete investigation?', message: `Delete “${name}”? Saved records stay in your library but will no longer be linked to this investigation.`, confirmLabel: 'Delete investigation', danger: true });
    if (!ok) return;
    await deleteInvestigation(id);
    if (activeInvestigationId === id) await setActiveInvestigation('');
    showToast(`Deleted investigation “${name}”.`);
    await loadViewContent(parseHash());
  } else if (action === 'delete-active-investigation') {
    if (!activeInvestigationId) return;
    const investigations = await listInvestigations();
    const inv = investigations.find((i) => i.id === activeInvestigationId);
    const name = inv?.name || 'this investigation';
    const ok = await confirmDialog({ title: 'Delete investigation?', message: `Delete “${name}”? Saved records stay in your library but will no longer be linked to this investigation.`, confirmLabel: 'Delete investigation', danger: true });
    if (!ok) return;
    await deleteInvestigation(activeInvestigationId);
    await setActiveInvestigation('');
    showToast(`Deleted investigation “${name}”.`);
    location.hash = '#/investigations';
  }
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const VIEW_TITLES = { home: 'Chronium Mind', investigations: 'Investigations', library: 'My Library', bibliography: 'Bibliography', settings: 'Settings & Help', workspace: 'Workspace' };

function parseHash() {
  const path = (location.hash || '#/').slice(1) || '/';
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'workspace') return { view: 'workspace', tab: parts[1] || 'overview' };
  if (['investigations', 'library', 'bibliography', 'settings'].includes(parts[0])) return { view: parts[0] };
  return { view: 'home' };
}

function updateNavActiveStates(route) {
  const path = route.view === 'workspace' ? `/workspace/${route.tab}` : route.view === 'home' ? '/' : `/${route.view}`;
  document.querySelectorAll('[data-route]').forEach((el) => {
    el.toggleAttribute('aria-current', el.dataset.route === path);
    if (el.dataset.route === path) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
}

async function renderRoute() {
  const route = parseHash();
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  const target = document.querySelector(`#view-${route.view}`);
  target.classList.remove('hidden');
  document.title = `${VIEW_TITLES[route.view] || 'Chronium'} · Chronium Mind`;
  updateNavActiveStates(route);
  await loadViewContent(route);
  window.scrollTo(0, 0);
  target.focus({ preventScroll: true });
}

async function loadViewContent(route) {
  if (route.view === 'home') await renderHomeRecent();
  else if (route.view === 'investigations') await renderInvestigationsView();
  else if (route.view === 'library') await renderLibraryView();
  else if (route.view === 'bibliography') await renderBibliographyView();
  else if (route.view === 'settings') renderSettingsView();
  else if (route.view === 'workspace') await renderWorkspaceView(route.tab);
}

window.addEventListener('hashchange', renderRoute);

// ---------------------------------------------------------------------------
// Home: universal search
// ---------------------------------------------------------------------------
document.querySelectorAll('[data-q]').forEach((btn) => btn.addEventListener('click', () => { input.value = btn.dataset.q; form.requestSubmit(); }));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = input.value.trim(); if (!q) return;
  setStatus(`Searching Chronium heads for “${q}”…`);
  resultsSection.classList.add('hidden');
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
    renderResults();
    resultsSection.classList.remove('hidden');
    setStatus(data.mode === 'topic'
      ? `Topic mode: only heads with full-text capability were queried. ${data.tookMs} ms.`
      : `URL history mode: archive capture indexes were queried. ${data.tookMs} ms.`);
  } catch (err) { setStatus(`Search error: ${err.message}`, true); }
});
sourceFilter.addEventListener('change', renderResults);
typeFilter.addEventListener('change', renderResults);

// Translates a raw connector failure into something a non-technical user can
// read. Raw runtime errors ("The operation was aborted") never reach the UI -
// they're implementation noise that makes a search that still returned good
// results look broken. The real error stays available in data.connectors for
// anyone inspecting the network response; this is just what renders.
function humanizeConnectorError(c) {
  if (c.skipped) return `${c.source} temporarily skipped after repeated failures — retrying automatically.`;
  const err = c.error || '';
  if (/aborted/i.test(err)) return `${c.source} temporarily unavailable (timed out).`;
  if (/HTTP 429/.test(err)) return `${c.source} is rate-limiting requests right now.`;
  if (/HTTP 403/.test(err)) return `${c.source} is blocking automated requests right now.`;
  if (/HTTP 5\d\d/.test(err)) return `${c.source} is having server trouble right now.`;
  return `${c.source} temporarily unavailable.`;
}

function renderCoverage(data, libraryHits) {
  const connectors = [...data.connectors, { source: 'My Library', capability: 'personal saved records', ok: true, count: libraryHits.length, note: null }];
  const okList = connectors.filter((c) => c.ok);
  const failedList = connectors.filter((c) => !c.ok);
  // "All real archive connectors failed" - excludes the always-ok My Library
  // entry, which isn't an archive. This is the only case that gets a loud
  // banner; anything short of it is a quiet, neutral summary line.
  const allArchivesFailed = data.connectors.length > 0 && data.connectors.every((c) => !c.ok);

  const banner = allArchivesFailed
    ? `<div class="status status-bad">All archives are temporarily unavailable right now — try again in a moment. Results below (if any) are from your saved research only.</div>`
    : '';
  const summary = `<p class="coverage-summary">${okList.length} of ${connectors.length} archives searched</p>`;
  const grid = okList.length
    ? `<div class="coverage-grid">${okList.map((c) => `<div class="source"><strong><i class="dot"></i>${esc(c.source)} · ${c.count}</strong><p>${esc(c.capability)}${c.note ? `<br>${esc(c.note)}` : ''}</p></div>`).join('')}</div>`
    : '';
  const details = failedList.length
    ? `<details class="source-status"><summary>Source status</summary><ul>${failedList.map((c) => `<li>${esc(humanizeConnectorError(c))}</li>`).join('')}</ul></details>`
    : '';

  coverage.innerHTML = `${banner}${summary}${grid}${details}`;
}
function buildFilters(items) {
  const sources = [...new Set(items.map((x) => x.source).filter(Boolean))].sort();
  const types = [...new Set(items.map((x) => bucket(x.mime)).filter(Boolean))].sort();
  sourceFilter.innerHTML = '<option value="all">All sources</option>' + sources.map((x) => `<option>${esc(x)}</option>`).join('');
  typeFilter.innerHTML = '<option value="all">All content</option>' + types.map((x) => `<option>${esc(x)}</option>`).join('');
}
function renderResults() {
  const sf = sourceFilter.value, tf = typeFilter.value;
  const filtered = current.filter((x) => (sf === 'all' || x.source === sf) && (tf === 'all' || bucket(x.mime) === tf));
  list.innerHTML = filtered.length ? filtered.map((x) => resultRow(x, 'search')).join('') : '<p class="status">No results match these filters.</p>';
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.save-btn');
  if (!btn || btn.disabled || !activeInvestigationId) return;
  const item = current.find((r) => canonicalKeyOf(r) === btn.dataset.key)
    || (await searchInvestigation(activeInvestigationId, '', 1000)).find((r) => canonicalKeyOf(r) === btn.dataset.key);
  if (!item) return;
  btn.disabled = true;
  await saveRecordToInvestigation(activeInvestigationId, item);
  savedKeys.add(btn.dataset.key);
  showToast(`Saved “${item.title || item.originalUrl}” to your investigation.`);
  renderResults();
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.preview-btn');
  if (!btn) return;
  const row = await getBlob(btn.dataset.hash);
  if (!row) { showToast('Original not found in this browser (was it imported with "keep a local copy" off?).', true); return; }
  const url = URL.createObjectURL(row.blob);
  window.open(url, '_blank', 'noopener');
});

async function checkLinkRemote(target) {
  try {
    const res = await fetch(`/api/check-link?url=${encodeURIComponent(target)}`);
    return await res.json();
  } catch {
    return { ok: false, kind: 'network-error' };
  }
}

function showLinkUnavailable(btn, kind) {
  const message = kind === 'archive'
    ? 'Archived copy unavailable. Try another capture or source.'
    : 'Current page unavailable.';
  let note = btn.nextElementSibling;
  if (!note || !note.classList.contains('link-unavailable-note')) {
    note = document.createElement('p');
    note.className = 'link-unavailable-note hint';
    btn.insertAdjacentElement('afterend', note);
  }
  note.textContent = message;
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.link-check');
  if (!btn || btn.disabled) return;
  const kind = btn.dataset.linkKind;
  const primaryUrl = btn.dataset.url;
  const originalLabel = btn.textContent;
  const oldNote = btn.nextElementSibling;
  if (oldNote?.classList.contains('link-unavailable-note')) oldNote.remove();

  btn.disabled = true;
  btn.textContent = 'Checking…';

  // Never construct/guess a fallback - only try copies Chronium already has
  // a real archiveUrl for, from another archive's successful response for
  // this same page (server-grouped in groupSamePage(), src/index.js).
  const candidates = [primaryUrl];
  if (kind === 'archive') {
    try { candidates.push(...(JSON.parse(btn.dataset.alternates || '[]')).slice(0, 2)); } catch { /* malformed data-alternates, ignore */ }
  }

  let opened = false;
  for (const candidate of candidates) {
    const verdict = await checkLinkRemote(candidate);
    if (verdict.ok) {
      window.open(verdict.finalUrl || candidate, '_blank', 'noopener');
      opened = true;
      break;
    }
  }

  btn.disabled = false;
  btn.textContent = originalLabel;
  if (!opened) showLinkUnavailable(btn, kind);
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.remove-btn');
  if (!btn || !activeInvestigationId) return;
  await removeRecordFromInvestigation(activeInvestigationId, btn.dataset.recordId);
  savedKeys = await getSavedCanonicalKeys(activeInvestigationId);
  await renderLibraryView();
  showToast('Removed from investigation.');
});

// ---------------------------------------------------------------------------
// Investigations: shared card rendering (Home recent + Investigations view)
// ---------------------------------------------------------------------------
async function investigationCardHtml(inv) {
  const records = await listInvestigationRecords(inv.id);
  const n = records.length;
  return `<div class="investigation-card">
    <a class="investigation-card-link" href="#/workspace/overview" data-open-investigation="${attr(inv.id)}">${esc(inv.name)}</a>
    ${inv.description ? `<p class="investigation-card-desc">${esc(inv.description)}</p>` : ''}
    <p class="investigation-card-meta">${n} source${n === 1 ? '' : 's'} · updated ${esc(formatDate(inv.updatedAt))}</p>
    <div class="menu-wrap">
      <button type="button" class="icon-btn" data-kebab-toggle aria-haspopup="true" aria-expanded="false" aria-label="Actions for ${attr(inv.name)}"><svg width="18" height="18"><use href="#icon-kebab"/></svg></button>
      <ul class="menu hidden" role="menu" aria-label="Actions for ${attr(inv.name)}">
        <li role="none"><button type="button" role="menuitem" class="menu-item menu-item-danger" data-action="delete-investigation" data-id="${attr(inv.id)}" data-name="${attr(inv.name)}">Delete investigation…</button></li>
      </ul>
    </div>
  </div>`;
}
function emptyInvestigationsHtml() {
  return `<div class="empty-state">
    <svg class="empty-state-mascot" width="48" height="48" aria-hidden="true"><use href="#icon-dragon-outline"/></svg>
    <div>
      <h2>No investigations yet</h2>
      <p>An investigation is where saved research, imported documents, and URLs come together for one question or topic.</p>
      <div class="empty-state-actions"><button type="button" class="btn btn-primary" data-action="new-investigation">New investigation</button></div>
    </div>
  </div>`;
}

document.addEventListener('click', async (e) => {
  const link = e.target.closest('[data-open-investigation]');
  if (!link) return;
  e.preventDefault();
  await setActiveInvestigation(link.dataset.openInvestigation);
  location.hash = '#/workspace/overview';
});

async function renderHomeRecent() {
  const investigations = (await listInvestigations()).slice(0, 6);
  const container = document.querySelector('#recentInvestigationsList');
  if (!investigations.length) { container.innerHTML = emptyInvestigationsHtml(); return; }
  container.innerHTML = (await Promise.all(investigations.map(investigationCardHtml))).join('');
}
async function renderInvestigationsView() {
  const investigations = await listInvestigations();
  const container = document.querySelector('#allInvestigationsList');
  if (!investigations.length) { container.innerHTML = emptyInvestigationsHtml(); return; }
  container.innerHTML = (await Promise.all(investigations.map(investigationCardHtml))).join('');
}

// ---------------------------------------------------------------------------
// My Library (per active investigation)
// ---------------------------------------------------------------------------
async function renderLibraryView() {
  const emptyState = document.querySelector('#libraryEmptyState');
  const resultsEl = document.querySelector('#libraryResults');
  const contextLine = document.querySelector('#libraryContextLine');
  if (!activeInvestigationId) {
    contextLine.textContent = '';
    resultsEl.innerHTML = '';
    emptyState.classList.remove('hidden');
    emptyState.innerHTML = `<svg class="empty-state-mascot" width="48" height="48" aria-hidden="true"><use href="#icon-dragon-outline"/></svg>
      <div><h2>No investigation open</h2><p>Your library is scoped to an investigation. Open or create one to see what you’ve saved.</p>
      <div class="empty-state-actions"><a class="btn" href="#/investigations" data-route="/investigations">Browse investigations</a><button type="button" class="btn btn-primary" data-action="new-investigation">New investigation</button></div></div>`;
    return;
  }
  emptyState.classList.add('hidden');
  const investigations = await listInvestigations();
  const inv = investigations.find((i) => i.id === activeInvestigationId);
  contextLine.textContent = inv ? `Saved to “${inv.name}”` : '';
  const records = await listInvestigationRecords(activeInvestigationId);
  resultsEl.innerHTML = records.length ? records.map((r) => resultRow(r, 'library')).join('') : '<p class="status">Nothing saved to this investigation yet.</p>';
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
async function renderSettingsView() {
  const line = document.querySelector('#settingsActiveLine');
  const clearBtn = document.querySelector('#settingsClearActiveBtn');
  if (!activeInvestigationId) { line.textContent = 'No investigation is currently active.'; clearBtn.disabled = true; return; }
  const investigations = await listInvestigations();
  const inv = investigations.find((i) => i.id === activeInvestigationId);
  line.textContent = inv ? `“${inv.name}” is currently active.` : 'No investigation is currently active.';
  clearBtn.disabled = !inv;
}
document.querySelector('#settingsClearActiveBtn').addEventListener('click', async () => {
  await setActiveInvestigation('');
  await renderSettingsView();
  showToast('Cleared the active investigation.');
});

// ---------------------------------------------------------------------------
// New Investigation
// ---------------------------------------------------------------------------
newInvestigationForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.querySelector('#newInvestigationName').value.trim();
  if (!name) return;
  const description = document.querySelector('#newInvestigationDescription').value.trim();
  const investigation = await createInvestigation({ name, description });
  await setActiveInvestigation(investigation.id);
  newInvestigationForm.reset();
  closeDialog('newInvestigationDialog');
  showToast(`Created investigation “${investigation.name}”.`);
  location.hash = '#/workspace/overview';
  await openAddResearchDialogFor(investigation.id);
});

// ---------------------------------------------------------------------------
// Add Research: URL form + bulk import (consolidated modal)
// ---------------------------------------------------------------------------
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
  setAddResearchStatus(`Added ${url} to your investigation.`);
  if (parseHash().view === 'workspace') await renderWorkspaceView(parseHash().tab);
  if (parseHash().view === 'library') await renderLibraryView();
});

bulkImportFilesInput.addEventListener('change', () => {
  if (bulkImportFilesInput.files.length) runImport([...bulkImportFilesInput.files]);
  bulkImportFilesInput.value = '';
});
bulkImportFolderInput.addEventListener('change', () => {
  if (bulkImportFolderInput.files.length) runImport([...bulkImportFolderInput.files]);
  bulkImportFolderInput.value = '';
});

['dragenter', 'dragover'].forEach((evt) => dropTarget.addEventListener(evt, (e) => { e.preventDefault(); dropTarget.classList.add('dragover'); }));
['dragleave', 'dragend'].forEach((evt) => dropTarget.addEventListener(evt, () => dropTarget.classList.remove('dragover')));
dropTarget.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropTarget.classList.remove('dragover');
  if (!activeInvestigationId) return;
  const items = await filesFromDataTransfer(e.dataTransfer);
  if (items.length) runImport(items);
});

async function filesFromDataTransfer(dataTransfer) {
  const out = [];
  const entries = [];
  const dtItems = dataTransfer.items ? [...dataTransfer.items] : [];
  for (const item of dtItems) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else if (item.kind === 'file') { const f = item.getAsFile(); if (f) out.push(f); }
  }
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, path: prefix + entry.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      } while (batch.length > 0);
    }
  }
  for (const entry of entries) await walk(entry, '');
  if (!entries.length && !out.length && dataTransfer.files) return [...dataTransfer.files];
  return out;
}

async function runImport(items) {
  if (!activeInvestigationId || !items.length) return;
  const preserveOriginals = preserveOriginalsCheckbox.checked;
  bulkImportProgress.classList.remove('hidden');
  bulkImportProgress.textContent = 'Starting import…';
  const onProgress = (p) => {
    bulkImportProgress.textContent = p.status === 'error'
      ? `Processed ${p.processed} files — error on "${p.current}": ${p.error}`
      : `Processed ${p.processed} files (${formatBytes(p.byteTotal)}) — current: ${p.current}`;
  };
  try {
    const first = items[0];
    const firstName = first instanceof File ? first.name : first.file.name;
    const isSingleZip = items.length === 1 && /\.zip$/i.test(firstName);
    const batch = isSingleZip
      ? await ingestZip(first instanceof File ? first : first.file, activeInvestigationId, onProgress, { preserveOriginals })
      : await ingestFiles(items, activeInvestigationId, onProgress, { preserveOriginals });

    savedKeys = await getSavedCanonicalKeys(activeInvestigationId);
    bulkImportProgress.classList.add('hidden');
    setAddResearchStatus(`Imported ${batch.fileCount} file${batch.fileCount === 1 ? '' : 's'} (${formatBytes(batch.byteTotal)}). ${batch.duplicates.length} duplicates, ${batch.skipped.length + batch.errors.length} need attention.`);
    showToast(`Imported ${batch.fileCount} file${batch.fileCount === 1 ? '' : 's'} into your investigation.`);
    closeDialog('addResearchDialog');
    location.hash = '#/workspace/sources';
  } catch (err) {
    setAddResearchStatus(`Import failed: ${err.message}`, true);
  }
}

// ---------------------------------------------------------------------------
// Active investigation
// ---------------------------------------------------------------------------
async function setActiveInvestigation(id) {
  const investigations = await listInvestigations();
  const valid = new Set(investigations.map((i) => i.id));
  if (id && !valid.has(id)) id = '';
  activeInvestigationId = id;
  localStorage.setItem('chronium.activeInvestigation', id);
  savedKeys = id ? await getSavedCanonicalKeys(id) : new Set();
  lastDashboardData = null;
  const inv = id ? investigations.find((i) => i.id === id) : null;
  navWorkspaceGroup.hidden = !id;
  if (inv) navWorkspaceTitle.textContent = `Workspace · ${inv.name}`;
  renderResults();
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------
function buildWorkspaceTabStrip(activeTab) {
  const strip = document.querySelector('#workspaceTabStrip');
  strip.innerHTML = WORKSPACE_TABS.map((t) => `<button type="button" id="tab-${t.id}" role="tab" aria-selected="${t.id === activeTab}" aria-controls="workspacePanel-${t.id}" data-tab="${t.id}"><svg width="15" height="15" style="vertical-align:-3px;margin-right:6px"><use href="#${t.icon}"/></svg>${t.label}</button>`).join('');
  strip.querySelectorAll('button[data-tab]').forEach((btn) => btn.addEventListener('click', () => { location.hash = `#/workspace/${btn.dataset.tab}`; }));
}

function buildStaticComingSoonPanels() {
  Object.entries(COMING_SOON).forEach(([tab, { title: t, body }]) => {
    const panel = document.querySelector(`#workspacePanel-${tab}`);
    panel.innerHTML = `<div class="coming-soon"><svg class="coming-soon-mascot" width="40" height="40" aria-hidden="true"><use href="#icon-dragon-outline"/></svg><div><h2>${esc(t)}</h2><p>${body}</p></div></div>`;
  });
}
buildStaticComingSoonPanels();

async function renderWorkspaceView(tab) {
  const emptyState = document.querySelector('#workspaceEmptyState');
  const body = document.querySelector('#workspaceBody');
  if (!activeInvestigationId) { emptyState.classList.remove('hidden'); body.classList.add('hidden'); return; }
  emptyState.classList.add('hidden');
  body.classList.remove('hidden');

  const investigations = await listInvestigations();
  const inv = investigations.find((i) => i.id === activeInvestigationId);
  document.querySelector('#workspaceTitle').textContent = inv?.name || 'Investigation';
  document.querySelector('#workspaceDescription').textContent = inv?.description || '';

  buildWorkspaceTabStrip(tab);
  document.querySelectorAll('.workspace-panel').forEach((p) => p.classList.add('hidden'));
  const panel = document.querySelector(`#workspacePanel-${tab}`) || document.querySelector('#workspacePanel-overview');
  panel.classList.remove('hidden');

  if (tab === 'overview' || tab === 'sources' || tab === 'timeline') {
    await refreshWorkspaceData();
    if (tab === 'overview') renderOverviewPanel();
    if (tab === 'sources') renderSourcesPanel();
    if (tab === 'timeline') renderTimelinePanel();
  } else if (tab === 'outline') {
    await renderOutlinePanel();
  } else if (tab === 'evidence') {
    await renderEvidencePanel();
  } else if (tab === 'claims') {
    await renderClaimsPanel();
  } else if (tab === 'gaps') {
    await renderGapsPanel();
  } else if (tab === 'report') {
    await renderReportPanel();
  }
}

async function refreshWorkspaceData() {
  if (!activeInvestigationId) { lastDashboardData = null; return; }
  const [batches, records] = await Promise.all([
    listIngestionBatches(activeInvestigationId),
    listInvestigationRecords(activeInvestigationId)
  ]);
  const docs = records.filter((r) => r.sourceType === 'bulk-document');
  const duplicateEntries = batches.flatMap((b) => b.duplicates || []);
  const skipped = batches.flatMap((b) => (b.skipped || []).map((s) => ({ ...s, kind: 'unsupported' })));
  const errors = batches.flatMap((b) => (b.errors || []).map((e) => ({ ...e, kind: 'error' })));
  const totalReceived = batches.reduce((n, b) => n + (b.fileCount || 0), 0);
  const totalBytes = docs.reduce((n, r) => n + (r.fileSize || 0), 0);
  const typeCounts = docs.reduce((m, r) => { const k = bucket(r.mime) || 'Other'; m[k] = (m[k] || 0) + 1; return m; }, {});
  lastDashboardData = { batches, records, docs, duplicateEntries, skipped, errors, typeCounts, totalReceived, totalBytes };
}

function renderOverviewPanel() {
  if (!lastDashboardData) { dashboardSummary.innerHTML = ''; return; }
  const { docs, records, duplicateEntries, skipped, errors, typeCounts, totalReceived, totalBytes } = lastDashboardData;
  const savedOnly = records.length - docs.length;
  dashboardSummary.innerHTML = [
    { label: 'Files received', value: totalReceived },
    { label: 'Indexed documents', value: docs.length },
    { label: 'Saved / web records', value: savedOnly },
    { label: 'Duplicates', value: duplicateEntries.length },
    { label: 'Needs attention', value: skipped.length + errors.length },
    { label: 'Total size', value: formatBytes(totalBytes) },
    ...Object.entries(typeCounts).map(([k, v]) => ({ label: k, value: v }))
  ].map((s) => `<div><strong>${esc(String(s.value))}</strong><p>${esc(s.label)}</p></div>`).join('');
}

const FACETS = [
  { id: 'documents', label: 'Documents' },
  { id: 'sources', label: 'All Sources' },
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'attention', label: 'Needs Attention' },
  { id: 'people', label: 'People', disabled: true },
  { id: 'organizations', label: 'Organizations', disabled: true },
  { id: 'money', label: 'Money', disabled: true },
  { id: 'dates', label: 'Dates', disabled: true },
  { id: 'topics', label: 'Topics', disabled: true }
];
function renderSourcesPanel() {
  renderFacetBar();
  applyFacet();
}
function renderFacetBar() {
  facetBar.innerHTML = FACETS.map((f) => `<button type="button" role="tab" data-facet="${f.id}" aria-selected="${f.id === activeFacet}" ${f.disabled ? 'disabled title="Needs entity extraction — not built yet"' : ''}>${esc(f.label)}</button>`).join('');
}
facetBar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-facet]');
  if (!btn || btn.disabled) return;
  activeFacet = btn.dataset.facet;
  renderFacetBar();
  applyFacet();
});
function applyFacet() {
  if (!lastDashboardData) return;
  const { docs, records, duplicateEntries, skipped, errors } = lastDashboardData;
  if (activeFacet === 'sources') { renderRecordTable(records); return; }
  if (activeFacet === 'duplicates') { renderDuplicateTable(duplicateEntries); return; }
  if (activeFacet === 'attention') { renderAttentionTable(skipped, errors); return; }
  renderRecordTable(docs);
}
function renderRecordTable(rows) {
  reportList.innerHTML = rows.length ? `<table><thead><tr><th>Source ID</th><th>Name</th><th>Type</th><th>Size</th><th>Hash</th><th>Snippet</th><th>Original</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${esc(r.sourceId || '')}</td><td>${esc(r.title || '')}</td><td>${esc(r.mime || '')}</td><td>${esc(formatBytes(r.fileSize))}</td><td title="${attr(r.fileHash || '')}">${esc((r.fileHash || '').slice(0, 10))}${r.fileHash ? '…' : ''}</td><td>${esc((r.snippet || '').slice(0, 120))}</td><td>${
      r.storageMode === 'local-copy'
        ? `<button type="button" class="preview-btn" data-hash="${attr(r.fileHash)}">Preview</button>`
        : `<span class="hint">${r.filePath ? 'Not stored — ' + esc(r.filePath) : ''}</span>`
    }</td></tr>`).join('')
  }</tbody></table>` : '<p class="status">Nothing here yet.</p>';
}
function renderDuplicateTable(rows) {
  reportList.innerHTML = rows.length ? `<table><thead><tr><th>Duplicate file</th><th>Matches existing source</th></tr></thead><tbody>${
    rows.map((d) => `<tr><td>${esc(d.path)}</td><td>${esc(d.matchedTitle || d.matchedRecordId)}</td></tr>`).join('')
  }</tbody></table>` : '<p class="status">No duplicate files found.</p>';
}
function renderAttentionTable(skipped, errors) {
  const rows = [...skipped.map((s) => ({ path: s.path, reason: s.reason })), ...errors.map((e) => ({ path: e.path, reason: e.message }))];
  reportList.innerHTML = rows.length ? `<table><thead><tr><th>File</th><th>Reason</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${esc(r.path)}</td><td>${esc(r.reason)}</td></tr>`).join('')
  }</tbody></table>` : '<p class="status">Nothing needs attention.</p>';
}

function renderTimelinePanel() {
  const panel = document.querySelector('#workspacePanel-timeline');
  const records = lastDashboardData?.records || [];
  const yearCounts = new Map();
  records.forEach((r) => {
    const raw = r.captureDate || r.addedAt || r.savedAt;
    const d = raw ? new Date(raw) : null;
    if (d && !isNaN(d)) { const y = d.getUTCFullYear(); yearCounts.set(y, (yearCounts.get(y) || 0) + 1); }
  });
  const years = [...yearCounts.keys()].sort((a, b) => a - b);
  let railHtml = '';
  if (years.length) {
    const min = years[0], max = years[years.length - 1];
    const span = Math.max(1, max - min);
    railHtml = `<div class="timeline-rail">${years.map((y) => {
      const pct = ((y - min) / span) * 100;
      return `<div class="timeline-node" style="left:${pct}%"><span class="timeline-node-label">${y} · ${yearCounts.get(y)}</span></div>`;
    }).join('')}</div>`;
  }
  panel.innerHTML = `<div class="coming-soon">
    <svg class="coming-soon-mascot" width="40" height="40" aria-hidden="true"><use href="#icon-dragon-outline"/></svg>
    <div>
      <h2>${years.length ? 'Sources by year' : 'No dated sources yet'}</h2>
      <p>${years.length
        ? `A real timeline of this investigation’s ${records.length} source${records.length === 1 ? '' : 's'} by capture year. Then-vs-now version comparison and full evidence timelines are still on the roadmap.`
        : 'Import or save research with capture dates to populate this timeline. Then-vs-now version timelines are still on the roadmap.'}</p>
      ${railHtml ? `<div class="timeline-preview">${railHtml}<p class="timeline-note">Node position is proportional to year, not to scale within a year.</p></div>` : ''}
    </div>
  </div>`;
}

investigationSearchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeInvestigationId) return;
  const q = investigationQuery.value.trim();
  if (!q) { investigationSearchResults.innerHTML = ''; return; }
  const results = await searchInvestigation(activeInvestigationId, q, 50);
  investigationSearchResults.innerHTML = results.length ? results.map((r) => resultRow(r, 'library')).join('') : '<p class="status">No matches in this investigation.</p>';
});

// ---------------------------------------------------------------------------
// Bibliography (per active investigation)
// ---------------------------------------------------------------------------
async function renderBibliographyView() {
  const emptyState = document.querySelector('#bibliographyEmptyState');
  const listEl = document.querySelector('#bibliographyList');
  const contextLine = document.querySelector('#bibliographyContextLine');
  if (!activeInvestigationId) {
    contextLine.textContent = '';
    listEl.innerHTML = '';
    emptyState.classList.remove('hidden');
    emptyState.innerHTML = `<svg class="empty-state-mascot" width="48" height="48" aria-hidden="true"><use href="#icon-dragon-outline"/></svg>
      <div><h2>No investigation open</h2><p>Bibliography details are scoped to an investigation's sources. Open or create one first.</p>
      <div class="empty-state-actions"><a class="btn" href="#/investigations" data-route="/investigations">Browse investigations</a><button type="button" class="btn btn-primary" data-action="new-investigation">New investigation</button></div></div>`;
    return;
  }
  emptyState.classList.add('hidden');
  const investigations = await listInvestigations();
  const inv = investigations.find((i) => i.id === activeInvestigationId);
  contextLine.textContent = inv ? `Sources in “${inv.name}”` : '';
  const records = await listInvestigationRecords(activeInvestigationId);
  listEl.innerHTML = records.length ? `<table><thead><tr><th>Title</th><th>Publisher</th><th>Source type</th><th>Reliability</th><th>Notes</th><th></th></tr></thead><tbody>${
    records.map((r) => {
      const b = r.biblio || {};
      return `<tr><td>${esc(r.title || r.originalUrl || 'Untitled')}</td><td>${esc(b.publisher || '—')}</td><td>${esc(b.sourceType || '—')}</td><td>${esc(b.reliability || '—')}</td><td>${esc((b.researchNotes || '').slice(0, 60))}${(b.researchNotes || '').length > 60 ? '…' : ''}</td><td><button type="button" class="mini-edit-btn" data-action="edit-bibliography" data-id="${attr(r.id)}">Edit</button></td></tr>`;
    }).join('')
  }</tbody></table>` : '<p class="status">No sources in this investigation yet.</p>';
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="edit-bibliography"]');
  if (!btn) return;
  const records = await listInvestigationRecords(activeInvestigationId);
  const record = records.find((r) => r.id === btn.dataset.id);
  if (!record) return;
  const b = record.biblio || {};
  document.querySelector('#bibliographyRecordId').value = record.id;
  document.querySelector('#bibliographyPublisher').value = b.publisher || '';
  document.querySelector('#bibliographySourceType').value = b.sourceType || '';
  document.querySelector('#bibliographyReliability').value = b.reliability || '';
  document.querySelector('#bibliographyNotes').value = b.researchNotes || '';
  document.querySelector('#bibliographyDialogTitle').textContent = `Bibliography: ${record.title || record.originalUrl || 'Untitled'}`;
  openDialog('bibliographyDialog');
});

document.querySelector('#bibliographyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const recordId = document.querySelector('#bibliographyRecordId').value;
  await updateBibliographyDetails(recordId, {
    publisher: document.querySelector('#bibliographyPublisher').value.trim(),
    sourceType: document.querySelector('#bibliographySourceType').value,
    reliability: document.querySelector('#bibliographyReliability').value,
    researchNotes: document.querySelector('#bibliographyNotes').value.trim()
  });
  closeDialog('bibliographyDialog');
  showToast('Saved bibliography details.');
  await renderBibliographyView();
});

// ---------------------------------------------------------------------------
// Research Outline
// ---------------------------------------------------------------------------
let currentOutline = null;

async function renderOutlinePanel() {
  currentOutline = await getOutline(activeInvestigationId);
  document.querySelector('#outlineQuestionInput').value = currentOutline.researchQuestion || '';
  document.querySelector('#outlineMethodSelect').value = currentOutline.method || 'mixed';
  renderOutlineLanes(await listEvidenceItems(activeInvestigationId));
}

function renderOutlineLanes(evidenceItems) {
  const container = document.querySelector('#outlineLanesList');
  const lanes = currentOutline?.lanes || [];
  if (!lanes.length) { container.innerHTML = '<p class="status">No coverage lanes yet — add one below.</p>'; return; }
  container.innerHTML = lanes.map((lane) => {
    const count = evidenceItems.filter((e) => e.outlineLaneId === lane.id).length;
    const pct = lane.coveragePct;
    const bar = pct == null ? '' : `<div class="lane-bar-track"><div class="lane-bar-fill" style="width:${pct}%"></div></div>`;
    return `<div class="lane-row">
      <div class="lane-row-label"><strong>${esc(lane.label)}</strong><span>${count} evidence item${count === 1 ? '' : 's'} linked</span></div>
      ${bar}
      <div class="lane-pct">${pct == null ? 'Not estimated' : pct + '%'}</div>
      <button type="button" class="icon-btn" data-action="delete-lane" data-lane-id="${attr(lane.id)}" aria-label="Delete lane ${attr(lane.label)}"><svg width="16" height="16"><use href="#icon-close"/></svg></button>
    </div>`;
  }).join('');
}

document.querySelector('#outlineQuestionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeInvestigationId) return;
  currentOutline = await saveOutline(activeInvestigationId, {
    researchQuestion: document.querySelector('#outlineQuestionInput').value.trim(),
    method: document.querySelector('#outlineMethodSelect').value
  });
  showToast('Saved research outline.');
});

document.querySelector('#outlineLaneForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeInvestigationId) return;
  const label = document.querySelector('#outlineLaneLabel').value.trim();
  if (!label) return;
  const coverageRaw = document.querySelector('#outlineLaneCoverage').value;
  currentOutline = await addOutlineLane(activeInvestigationId, { label, coveragePct: coverageRaw === '' ? null : Number(coverageRaw) });
  document.querySelector('#outlineLaneForm').reset();
  renderOutlineLanes(await listEvidenceItems(activeInvestigationId));
  showToast(`Added lane “${label}”.`);
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-lane"]');
  if (!btn || !activeInvestigationId) return;
  currentOutline = await deleteOutlineLane(activeInvestigationId, btn.dataset.laneId);
  renderOutlineLanes(await listEvidenceItems(activeInvestigationId));
});

// ---------------------------------------------------------------------------
// Evidence Items
// ---------------------------------------------------------------------------
async function renderEvidencePanel() {
  const [records, outline, items] = await Promise.all([
    listInvestigationRecords(activeInvestigationId),
    getOutline(activeInvestigationId),
    listEvidenceItems(activeInvestigationId)
  ]);
  currentOutline = outline;

  const sourceSelect = document.querySelector('#evidenceSourceSelect');
  sourceSelect.innerHTML = records.length
    ? records.map((r) => `<option value="${attr(r.id)}">${esc(r.title || r.originalUrl || r.id)}</option>`).join('')
    : '<option value="">No sources in this investigation yet</option>';

  const laneSelect = document.querySelector('#evidenceLaneSelect');
  laneSelect.innerHTML = '<option value="">None</option>' + (outline.lanes || []).map((l) => `<option value="${attr(l.id)}">${esc(l.label)}</option>`).join('');

  renderEvidenceList(items, records);
}

function renderEvidenceList(items, records) {
  const container = document.querySelector('#evidenceList');
  if (!items.length) { container.innerHTML = '<p class="status">No evidence items yet — pull a specific excerpt from a source above.</p>'; return; }
  const byId = new Map(records.map((r) => [r.id, r]));
  container.innerHTML = items.map((item) => {
    const src = byId.get(item.sourceRecordId);
    return `<article class="evidence-card">
      <p class="evidence-card-meta">${esc(item.excerptType)}${item.location ? ' · ' + esc(item.location) : ''}</p>
      <p>${esc(item.excerptText)}</p>
      <p class="evidence-card-cite">From: ${src ? esc(src.title || src.originalUrl || 'Untitled source') : 'Source no longer in this investigation'}</p>
      <button type="button" class="btn btn-small card-delete" data-action="delete-evidence" data-id="${attr(item.id)}">Delete</button>
    </article>`;
  }).join('');
}

document.querySelector('#evidenceForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeInvestigationId) return;
  const sourceRecordId = document.querySelector('#evidenceSourceSelect').value;
  if (!sourceRecordId) { showToast('Add a source to this investigation first.', true); return; }
  const excerptText = document.querySelector('#evidenceExcerptInput').value.trim();
  if (!excerptText) return;
  await createEvidenceItem(activeInvestigationId, {
    sourceRecordId,
    excerptType: document.querySelector('#evidenceTypeSelect').value,
    location: document.querySelector('#evidenceLocationInput').value,
    outlineLaneId: document.querySelector('#evidenceLaneSelect').value || null,
    excerptText
  });
  document.querySelector('#evidenceForm').reset();
  await renderEvidencePanel();
  showToast('Added evidence item.');
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-evidence"]');
  if (!btn) return;
  await deleteEvidenceItem(btn.dataset.id);
  await renderEvidencePanel();
});

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------
async function renderClaimsPanel() {
  const [records, items, claims] = await Promise.all([
    listInvestigationRecords(activeInvestigationId),
    listEvidenceItems(activeInvestigationId),
    listClaims(activeInvestigationId)
  ]);
  renderClaimEvidencePicker(items);
  renderClaimsList(claims, items, records);
}

function renderClaimEvidencePicker(items) {
  const container = document.querySelector('#claimEvidencePicker');
  if (!items.length) { container.innerHTML = '<p class="status" style="padding:12px;margin:0">Add evidence items first, on the Evidence tab.</p>'; return; }
  container.innerHTML = items.map((item) => `<label class="claim-evidence-option">
    <input type="checkbox" data-evidence-id="${attr(item.id)}" />
    <span class="claim-evidence-option-text">${esc(item.excerptText.slice(0, 140))}${item.excerptText.length > 140 ? '…' : ''}<p>${esc(item.excerptType)}${item.location ? ' · ' + esc(item.location) : ''}</p></span>
    <select data-stance-for="${attr(item.id)}" aria-label="Stance for this evidence item"><option value="supports">Supports</option><option value="contradicts">Contradicts</option></select>
  </label>`).join('');
}

function renderClaimsList(claims, items, records) {
  const container = document.querySelector('#claimsList');
  if (!claims.length) { container.innerHTML = '<p class="status">No claims yet.</p>'; return; }
  const evById = new Map(items.map((e) => [e.id, e]));
  const recById = new Map(records.map((r) => [r.id, r]));
  container.innerHTML = claims.map((claim) => {
    const linkRows = (claim.links || []).map((l) => {
      const ev = evById.get(l.evidenceItemId);
      const src = ev ? recById.get(ev.sourceRecordId) : null;
      return `<li><span class="stance-tag ${l.stance}">${l.stance}</span>${ev ? esc(ev.excerptText.slice(0, 80)) : 'Evidence item removed'}${src ? ' — ' + esc(src.title || src.originalUrl || '') : ''}</li>`;
    }).join('');
    return `<article class="claim-card">
      <p class="claim-card-meta">${esc(claim.claimId)}</p>
      <p>${esc(claim.text)}</p>
      ${linkRows ? `<ul class="claim-card-links">${linkRows}</ul>` : ''}
      <button type="button" class="btn btn-small card-delete" data-action="delete-claim" data-id="${attr(claim.id)}">Delete</button>
    </article>`;
  }).join('');
}

document.querySelector('#claimForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeInvestigationId) return;
  const text = document.querySelector('#claimTextInput').value.trim();
  if (!text) return;
  const links = [...document.querySelectorAll('#claimEvidencePicker input[type=checkbox]:checked')].map((cb) => {
    const id = cb.dataset.evidenceId;
    const stanceSelect = document.querySelector(`select[data-stance-for="${id}"]`);
    return { evidenceItemId: id, stance: stanceSelect ? stanceSelect.value : 'supports' };
  });
  const claim = await createClaim(activeInvestigationId, { text, links });
  document.querySelector('#claimForm').reset();
  await renderClaimsPanel();
  showToast(`Added claim ${claim.claimId}.`);
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-claim"]');
  if (!btn) return;
  await deleteClaim(btn.dataset.id);
  await renderClaimsPanel();
});

// ---------------------------------------------------------------------------
// Research Gaps (computed from Outline + Evidence, no separate store)
// ---------------------------------------------------------------------------
async function renderGapsPanel() {
  const [outline, items] = await Promise.all([getOutline(activeInvestigationId), listEvidenceItems(activeInvestigationId)]);
  const container = document.querySelector('#gapsContent');
  const lanes = outline.lanes || [];
  if (!lanes.length) {
    container.innerHTML = `<div class="coming-soon"><svg class="coming-soon-mascot" width="40" height="40" aria-hidden="true"><use href="#icon-dragon-outline"/></svg><div><h2>No coverage lanes yet</h2><p>Research Gaps are computed from your <a href="#/workspace/outline" data-route="/workspace/outline">Outline</a>’s coverage lanes — add a few there to see gap warnings here.</p></div></div>`;
    return;
  }
  const gaps = lanes
    .map((lane) => ({ lane, count: items.filter((e) => e.outlineLaneId === lane.id).length }))
    .filter((g) => g.count === 0 || (g.lane.coveragePct != null && g.lane.coveragePct < 50));
  container.innerHTML = gaps.length
    ? gaps.map(({ lane, count }) => `<div class="gap-card"><strong>${esc(lane.label)}</strong><p>${count === 0 ? 'No evidence items linked yet.' : `Only ${count} evidence item${count === 1 ? '' : 's'} linked.`}${lane.coveragePct != null ? ` Estimated coverage: ${lane.coveragePct}%.` : ''}</p></div>`).join('')
    : '<p class="status">No gap warnings — every lane has evidence linked, and no lane is estimated below 50% coverage.</p>';
}

// ---------------------------------------------------------------------------
// Evidence-Backed Report (generated from Claims, not stored)
// ---------------------------------------------------------------------------
async function renderReportPanel() {
  const [records, items, claims] = await Promise.all([
    listInvestigationRecords(activeInvestigationId),
    listEvidenceItems(activeInvestigationId),
    listClaims(activeInvestigationId)
  ]);
  const container = document.querySelector('#reportContent');
  if (!claims.length) {
    container.innerHTML = `<div class="coming-soon"><svg class="coming-soon-mascot" width="40" height="40" aria-hidden="true"><use href="#icon-dragon-outline"/></svg><div><h2>No claims yet</h2><p>A report is generated from your <a href="#/workspace/claims" data-route="/workspace/claims">Claims</a>, not from raw search results — add claims backed by evidence to build one.</p></div></div>`;
    return;
  }
  const evById = new Map(items.map((e) => [e.id, e]));
  const recById = new Map(records.map((r) => [r.id, r]));
  container.innerHTML = claims.map((claim) => {
    const evidenceHtml = (claim.links || []).map((l) => {
      const ev = evById.get(l.evidenceItemId);
      if (!ev) return '';
      const src = recById.get(ev.sourceRecordId);
      return `<div class="report-evidence"><span class="stance-tag ${l.stance}">${l.stance}</span>${esc(ev.excerptText)}<p>${src ? esc(src.title || src.originalUrl || 'Untitled source') : 'Source unavailable'}${ev.location ? ' · ' + esc(ev.location) : ''}</p></div>`;
    }).join('');
    return `<article class="report-claim"><p class="report-claim-id">${esc(claim.claimId)}</p><h3>${esc(claim.text)}</h3>${evidenceHtml || '<p class="hint">No evidence linked to this claim yet.</p>'}</article>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
(async function init() {
  await setActiveInvestigation(activeInvestigationId);
  await renderRoute();
})();
