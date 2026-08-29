import {
  listInvestigations, createInvestigation, deleteInvestigation,
  saveRecordToInvestigation, removeRecordFromInvestigation, listInvestigationRecords,
  getSavedCanonicalKeys, searchLibrary, searchInvestigation, addUserUrl, listIngestionBatches, getBlob,
  updateBibliographyDetails, computeBiblioDerived, getOutline, saveOutline, addOutlineLane, updateOutlineLane, deleteOutlineLane,
  listEvidenceItems, createEvidenceItem, deleteEvidenceItem, listClaims, createClaim, deleteClaim,
  getQualitativeAnalysis, saveQualitativeAnalysis,
  listQuantitativeFindings, createQuantitativeFinding, deleteQuantitativeFinding,
  listQualitativeFindings, createQualitativeFinding, deleteQualitativeFinding,
  listCrossValidations, createCrossValidation, deleteCrossValidation
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
let lastQuery = '';
let activeInvestigationId = localStorage.getItem('chronium.activeInvestigation') || '';
let savedKeys = new Set();
let activeFacet = 'documents';
let lastDashboardData = null; // { docs, records, duplicateEntries, skipped, errors, typeCounts }
let toastTimer = null;
let closeNav = null;
const activeCloses = {};

// P0 "Make Investigation Workspace User-Friendly": 4 primary sections
// instead of 9 - a first-time user shouldn't need to understand Sources,
// Outline, Gaps, etc. to upload a document and search it. The visible
// workflow is SEARCH -> FIND RECEIPT -> SAVE EVIDENCE -> FINDING -> REPORT.
// Nothing underneath was deleted - Outline's research question and Gaps'
// coverage lanes moved to the Findings sub-tabs that actually use them
// (see FINDINGS_SUBTABS), and Sources' facet/table browsing moved into
// Research under a "Details"-style disclosure.
const WORKSPACE_TABS = [
  { id: 'research', label: 'Research', icon: 'icon-search' },
  { id: 'evidence', label: 'Evidence', icon: 'icon-flag' },
  { id: 'findings', label: 'Findings', icon: 'icon-bar' },
  { id: 'report', label: 'Report', icon: 'icon-doc-check' }
];
const FINDINGS_SUBTABS = [
  { id: 'claims', label: 'Claims' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'contradictions', label: 'Contradictions' },
  { id: 'gaps', label: 'Gaps' },
  { id: 'analysis', label: 'Analysis' }
];
// Evidence tab sub-toggle: saved receipts vs. the detailed per-source
// bibliography record - same hash convention as FINDINGS_SUBTABS
// (#/workspace/evidence/:subtab), not a 5th top-level workspace tab.
const EVIDENCE_SUBTABS = [
  { id: 'items', label: 'Evidence Items' },
  { id: 'bibliography', label: 'Bibliography' }
];
const METHOD_LABEL = { quantitative: 'Quantitative', qualitative: 'Qualitative', mixed: 'Mixed' };
const STATUS_LABEL = { 'not-started': 'Not started', 'in-progress': 'In progress', answered: 'Answered' };

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
// Wraps the matched term in <mark> inside an already-escaped passage. Safe
// because `passageHtml` is post-esc() and `term` only needs literal-regex
// escaping, never HTML escaping, before matching against it.
function highlightTerm(passageHtml, term) {
  if (!term) return passageHtml;
  const re = new RegExp(esc(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
  return passageHtml.replace(re, (m) => `<mark>${m}</mark>`);
}
function kindLabel(k) { return k === 'investigation-corpus' ? 'Investigation corpus' : k === 'personal-library' ? 'My library' : 'Archive connector'; }
function hostnameOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }

// Wayback/Common Crawl are URL/capture indexes with no page-title metadata -
// their `title` is just the raw URL again. Arquivo.pt, the corpus, and the
// library all carry a real extracted title. Never headline a result with a
// giant raw URL: fall back to a short label derived from the URL's last
// path segment instead, in "Title — organization/site" shape either way.
function displayTitle(x) {
  const host = hostnameOf(x.originalUrl || '');
  const hasRealTitle = x.title && x.title !== x.originalUrl && !/^https?:\/\//i.test(x.title);
  if (hasRealTitle) return host ? `${x.title} — ${host}` : x.title;
  if (host) {
    const path = (() => { try { return new URL(x.originalUrl).pathname.replace(/\/+$/, ''); } catch { return ''; } })();
    const last = path.split('/').filter(Boolean).pop();
    const label = last ? decodeURIComponent(last).replace(/[-_]+/g, ' ') : host;
    return `${label} — ${host}`;
  }
  return x.title || 'Archived result';
}

function resultRow(x, mode) {
  const d = x.captureDate ? new Date(x.captureDate) : null;
  const year = d && !isNaN(d) ? d.getUTCFullYear() : 'Unknown';
  const date = d && !isNaN(d) ? date_(d) : 'Capture date unavailable';
  const key = canonicalKeyOf(x);
  const isSaved = savedKeys.has(key);
  const action = mode === 'library'
    ? `<button type="button" class="remove-btn" data-record-id="${attr(x.id)}">Remove</button>`
    : activeInvestigationId
      ? `<button type="button" class="save-btn" data-key="${attr(key)}" ${isSaved ? 'disabled' : ''}>${isSaved ? 'Added to investigation' : '+ Add to investigation'}</button>`
      : `<button type="button" disabled title="Select or create an investigation first">+ Add to investigation</button>`;
  const previewAction = x.sourceType === 'bulk-document'
    ? (x.storageMode === 'local-copy'
        ? `<button type="button" class="preview-btn" data-hash="${attr(x.fileHash)}" data-mime="${attr(x.mime)}"${x.matchPage ? ` data-page="${attr(x.matchPage)}"` : ''}>${x.matchPage ? `Open at p.${esc(x.matchPage)}` : 'Preview original'}</button>`
        : `<span class="hint">Not stored by Chronium — original at: ${esc(x.filePath || x.title)}</span>`)
    : '';
  // A matched passage - from searchInvestigation's exact in-document hit, or
  // an external connector's own full-text snippet (Arquivo.pt) - is why the
  // researcher is looking at this result at all, so it's the second thing
  // shown, right under the headline+date, highlighted the same way either way.
  const passageBlock = x.matchPassage
    ? `<p class="result-snippet result-passage">${highlightTerm(esc(x.matchPassage), x.matchTerm)}</p>`
    : (x.snippet ? `<p class="result-snippet result-passage">${highlightTerm(esc(x.snippet).slice(0, 450), lastQuery)}</p>` : '');
  const saveEvidenceAction = x.matchPassage
    ? `<button type="button" class="save-evidence-btn" data-record-id="${attr(x.id)}" data-excerpt="${attr(x.matchPassageRaw || x.matchPassage)}" data-location="${attr(x.matchPage ? 'p.' + x.matchPage : '')}">Save as Evidence</button>`
    : '';
  // Archive/live links are buttons, not plain <a> tags: Chronium checks the
  // link resolves (and, for an archived copy, tries another preserved copy
  // of the same page from a different archive) before ever navigating -
  // never given a dead result when another working copy is available.
  const alternates = Array.isArray(x.alternateArchiveUrls) ? x.alternateArchiveUrls : [];
  const archiveBtn = x.archiveUrl
    ? `<button type="button" class="link-check primary" data-link-kind="archive" data-url="${attr(x.archiveUrl)}" data-source="${attr(x.source || '')}" data-key="${attr(key)}" data-date="${attr(date)}" data-alternates="${attr(JSON.stringify(alternates))}">View archived page</button>`
    : '';
  const liveBtn = x.originalUrl
    ? `<button type="button" class="link-check" data-link-kind="live" data-url="${attr(asUrl(x.originalUrl))}">View current page</button>`
    : '';
  // One readable provenance line - date, archived/live, provider - replaces
  // what used to be three separate technical tag pills. Everything more
  // granular (raw URL, match type, mime, language, version count) is still
  // there, just tucked behind "Details" instead of crowding every row.
  const isArchiveLike = x.sourceKind === 'archive-connector' || x.sourceKind === 'investigation-corpus';
  const provKind = isArchiveLike ? (x.archiveUrl ? 'Archived' : (x.originalUrl ? 'Live' : null)) : null;
  const provenanceLine = provKind
    ? `<p class="result-provenance">${esc(date)} · ${provKind}${x.source ? ` · ${esc(x.source)}` : ''}</p>`
    : (x.sourceKind ? `<p class="result-provenance">${esc(date)} · ${esc(kindLabel(x.sourceKind))}</p>` : '');
  const versionCount = 1 + alternates.length;
  const detailsRows = [
    x.originalUrl ? `<div>URL: ${esc(x.originalUrl)}</div>` : '',
    x.sourceId ? `<div>Source ID: ${esc(x.sourceId)}</div>` : '',
    x.matchType ? `<div>Match type: ${esc(x.matchType)}</div>` : '',
    x.mime ? `<div>File type: ${esc(x.mime)}</div>` : '',
    x.language ? `<div>Language: ${esc(x.language)}</div>` : '',
    versionCount > 1 ? `<div>${versionCount} known captures</div>` : ''
  ].filter(Boolean).join('');
  const detailsBlock = detailsRows ? `<details class="result-details"><summary>Details</summary>${detailsRows}</details>` : '';
  const urlLine = x.originalUrl ? `<div class="result-url" title="${attr(x.originalUrl)}">${esc(hostnameOf(x.originalUrl) || x.originalUrl)}</div>` : '';
  return `<article class="result-row"><div class="result-when"><strong>${esc(year)}</strong>${esc(date)}</div><div><h3>${esc(displayTitle(x))}</h3>${provenanceLine}${passageBlock}${urlLine}${previewAction}${saveEvidenceAction}${detailsBlock}</div><div class="result-actions">${archiveBtn}${liveBtn}${action}</div></article>`;
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
const VIEW_TITLES = { home: 'Chronium Mind', investigations: 'Investigations', library: 'My Library', settings: 'Settings & Help', workspace: 'Workspace' };

function parseHash() {
  const path = (location.hash || '#/').slice(1) || '/';
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'workspace') return { view: 'workspace', tab: parts[1] || 'research', subtab: parts[2] || null };
  if (['investigations', 'library', 'settings'].includes(parts[0])) return { view: parts[0] };
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
  else if (route.view === 'settings') renderSettingsView();
  else if (route.view === 'workspace') await renderWorkspaceView(route.tab, route.subtab);
}

window.addEventListener('hashchange', renderRoute);

// ---------------------------------------------------------------------------
// Home: universal search
// ---------------------------------------------------------------------------
document.querySelectorAll('[data-q]').forEach((btn) => btn.addEventListener('click', () => { input.value = btn.dataset.q; form.requestSubmit(); }));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = input.value.trim(); if (!q) return;
  lastQuery = q;
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
  // "Historical archives" (Wayback, Arquivo.pt, Common Crawl, ...) and "My
  // research" (the investigation corpus connector, plus this browser's
  // saved library) are different kinds of source and must never be
  // summarized together as "archives" - kind comes from the server
  // (ArchiveProvider vs searchLocalCorpora, see src/index.js), so the
  // frontend never has to guess by source name.
  const archiveConnectors = data.connectors.filter((c) => c.kind !== 'my-research');
  const myResearchConnectors = data.connectors.filter((c) => c.kind === 'my-research');
  const myResearchHits = myResearchConnectors.reduce((sum, c) => sum + (c.count || 0), 0) + libraryHits.length;

  // Coverage Verdict (src/index.js): "no results" is never one thing.
  // These four cases must never be presented the same way:
  //   found                - matches came back
  //   provider-unavailable - the connector couldn't be reached; UNKNOWN
  //                          coverage, never "nothing archived"
  //   no-captures-in-index - this exact query matched nothing; may still
  //                          contradict itself via crossCheckFoundCaptures
  //   verified-gap         - cross-checked two independent ways, both agree
  const okWithResults = archiveConnectors.filter((c) => c.verdict === 'found');
  const unavailable = archiveConnectors.filter((c) => c.verdict === 'provider-unavailable');
  const verifiedGaps = archiveConnectors.filter((c) => c.verdict === 'verified-gap');
  const contradicted = archiveConnectors.filter((c) => c.verdict === 'no-captures-in-index' && c.crossCheckFoundCaptures);
  const softNoMatch = archiveConnectors.filter((c) => c.verdict === 'no-captures-in-index' && !c.crossCheckFoundCaptures);
  const allArchivesUnavailable = archiveConnectors.length > 0 && archiveConnectors.every((c) => c.verdict === 'provider-unavailable');

  const banner = allArchivesUnavailable
    ? `<div class="status status-bad">All historical archives are temporarily unavailable right now — this means Chronium couldn't ask, not that nothing was archived. Try again in a moment. Results below (if any) are from your own research only.</div>`
    : '';
  // A provider that found nothing for THIS query but is independently known
  // to have other captures of the same domain is the exact "don't confuse
  // absence of evidence with evidence of absence" case - it gets a visible
  // callout, not a line buried in collapsed Source status.
  const contradictionCallout = contradicted.length
    ? `<div class="status status-warn">${contradicted.map((c) => esc(c.note || `${c.source} found no matches for this exact query, but has other captures of this domain.`)).join(' ')}</div>`
    : '';
  const summary = `<p class="coverage-summary">${okWithResults.length} of ${archiveConnectors.length} historical archives returned matches${myResearchHits ? ` · ${myResearchHits} from your own research` : ''}</p>`;
  // Only connectors that actually found something get a prominent card - a
  // provider that succeeded but matched nothing is plumbing, not a result,
  // and belongs in the same quiet details list as a failed one.
  const grid = okWithResults.length
    ? `<div class="coverage-grid">${okWithResults.map((c) => `<div class="source"><strong><i class="dot"></i>${esc(c.source)} · ${c.count}</strong><p>${esc(c.capability)}${c.note ? `<br>${esc(c.note)}` : ''}</p></div>`).join('')}</div>`
    : '';
  const statusItems = [
    ...unavailable.map((c) => `<li>${esc(humanizeConnectorError(c))} — coverage unknown, not confirmed absent.</li>`),
    ...softNoMatch.map((c) => `<li>${esc(c.source)} found no matches for this query.</li>`),
    ...verifiedGaps.map((c) => `<li>${esc(c.source)}: no captures found for this domain (verified against an independent cross-check).</li>`)
  ];
  const details = statusItems.length
    ? `<details class="source-status"><summary>Source status</summary><ul>${statusItems.join('')}</ul></details>`
    : '';

  coverage.innerHTML = `${banner}${contradictionCallout}${summary}${grid}${details}`;
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
  // #page=N is a standard PDF open parameter Chromium's built-in viewer
  // honors even on blob: URLs - the closest we can get to "open at the
  // exact match" without a bundled PDF viewer of our own.
  const isPdf = (btn.dataset.mime || '').includes('pdf');
  const target = isPdf && btn.dataset.page ? `${url}#page=${btn.dataset.page}` : url;
  window.open(target, '_blank', 'noopener');
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.save-evidence-btn');
  if (!btn || !activeInvestigationId) return;
  btn.disabled = true;
  try {
    await createEvidenceItem(activeInvestigationId, {
      sourceRecordId: btn.dataset.recordId,
      excerptType: 'quote',
      location: btn.dataset.location || '',
      outlineLaneId: null,
      excerptText: btn.dataset.excerpt
    });
    btn.textContent = 'Saved to Evidence';
    showToast('Saved this passage as Evidence — provenance and citation carried over automatically.');
  } catch (err) {
    btn.disabled = false;
    showToast('Could not save this as evidence: ' + err.message, true);
  }
});

// CANON "Backup-to-the-backup reliability": resolutions are cached so
// Chronium never re-tests a link it already knows the answer to - this is
// the in-memory half (instant, this page load); /api/check-link itself also
// caches server-side so a second tab or a later session isn't cold either.
const linkResolutionCache = new Map();
async function checkLinkRemote(target) {
  if (linkResolutionCache.has(target)) return linkResolutionCache.get(target);
  let verdict;
  try {
    const res = await fetch(`/api/check-link?url=${encodeURIComponent(target)}`);
    verdict = await res.json();
  } catch {
    verdict = { ok: false, kind: 'network-error' };
  }
  linkResolutionCache.set(target, verdict);
  return verdict;
}

// Only used for the live-page link now - archive-page failures render
// inside the Archive Viewer itself (openArchiveViewer), not as a note next
// to the button.
function showLinkUnavailable(btn) {
  let note = btn.nextElementSibling;
  if (!note || !note.classList.contains('link-unavailable-note')) {
    note = document.createElement('p');
    note.className = 'link-unavailable-note hint';
    btn.insertAdjacentElement('afterend', note);
  }
  note.textContent = 'The live page is unreachable right now — the archived copy above is your best bet.';
}

// ---------------------------------------------------------------------------
// Archive Viewer - clicking "View archived page" renders the capture INSIDE
// Chronium (iframe/PDF/text) instead of navigating straight to the
// archive's URL, which for a PDF or a misconfigured server can mean a
// forced download instead of a page the researcher can look at. The
// content-type gate lives server-side (/api/view-capture, src/index.js);
// this is presentation only - fetch, classify by the response's real
// content-type, render, or fall through to the next known capture.
// ---------------------------------------------------------------------------
async function fetchCaptureForView(archiveUrl) {
  const res = await fetch(`/api/view-capture?url=${encodeURIComponent(archiveUrl)}`);
  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!res.ok) {
    let error = `HTTP ${res.status}`;
    try { error = (await res.json()).error || error; } catch { /* non-JSON error body, keep generic message */ }
    return { ok: false, error };
  }
  if (contentType === 'application/pdf' || contentType.startsWith('image/')) return { ok: true, contentType, blob: await res.blob() };
  return { ok: true, contentType, text: await res.text() }; // html, plain, json, xml, csv
}

function renderCaptureContent(result) {
  const body = document.querySelector('#archiveViewerBody');
  const ct = result.contentType;
  body.innerHTML = '';
  if (ct === 'text/html' || ct === 'application/xhtml+xml') {
    const iframe = document.createElement('iframe');
    iframe.className = 'archive-viewer-frame';
    iframe.setAttribute('sandbox', ''); // render-only: no script execution from archived page content
    iframe.srcdoc = result.text;
    body.appendChild(iframe);
  } else if (ct === 'application/pdf') {
    const iframe = document.createElement('iframe');
    iframe.className = 'archive-viewer-frame';
    iframe.src = URL.createObjectURL(result.blob);
    body.appendChild(iframe);
  } else if (ct.startsWith('image/')) {
    const wrap = document.createElement('div');
    wrap.className = 'archive-viewer-image-wrap';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(result.blob);
    img.alt = 'Archived capture';
    wrap.appendChild(img);
    body.appendChild(wrap);
  } else {
    let text = result.text;
    if (ct === 'application/json') { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not valid JSON, show as-is */ } }
    const pre = document.createElement('pre');
    pre.className = 'archive-viewer-text';
    pre.textContent = text;
    body.appendChild(pre);
  }
}

function triggerCaptureDownload(archiveUrl) {
  const a = document.createElement('a');
  a.href = `/api/view-capture?url=${encodeURIComponent(archiveUrl)}&download=1`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function openArchiveViewer({ title, date, source, originalUrl, primaryUrl, primarySource, alternates, rowKey }) {
  document.querySelector('#archiveViewerTitle').textContent = title || 'Archived capture';
  document.querySelector('#archiveViewerMeta').textContent = [date, source, originalUrl].filter(Boolean).join(' · ');
  document.querySelector('#archiveViewerBody').innerHTML = '<p class="status">Loading capture…</p>';
  const origBtn = document.querySelector('#archiveViewerOriginalBtn');
  const dlBtn = document.querySelector('#archiveViewerDownloadBtn');
  origBtn.disabled = true;
  dlBtn.disabled = true;
  openDialog('archiveViewerDialog');

  // Discover -> Deduplicate -> Validate -> Rank -> Open, same candidate
  // chain as link reachability (CANON "Backup-to-the-backup reliability"),
  // extended one step further: a candidate that resolves but can't be
  // safely rendered (unsupported type, too large) also falls through to
  // the next known capture before Chronium gives up.
  const candidates = [{ source: primarySource, archiveUrl: primaryUrl }, ...alternates];
  let lastReachable = null;
  for (const candidate of candidates) {
    const verdict = await checkLinkRemote(candidate.archiveUrl);
    if (!verdict.ok) continue;
    lastReachable = candidate;
    const result = await fetchCaptureForView(candidate.archiveUrl).catch((e) => ({ ok: false, error: e.message }));
    if (!result.ok) continue;

    renderCaptureContent(result);
    origBtn.disabled = false;
    origBtn.onclick = () => window.open(candidate.archiveUrl, '_blank', 'noopener');
    dlBtn.disabled = false;
    dlBtn.onclick = () => triggerCaptureDownload(candidate.archiveUrl);

    if (candidate.archiveUrl !== primaryUrl) {
      const item = rowKey && current.find((r) => canonicalKeyOf(r) === rowKey);
      if (item) { item.archiveUrl = candidate.archiveUrl; item.source = candidate.source; if (candidate.captureDate) item.captureDate = candidate.captureDate; }
      showToast(`${primarySource}'s copy couldn't be shown — displaying the ${candidate.source} capture instead.`);
    }
    return;
  }

  // Nothing renderable. If at least one candidate was reachable, offer it
  // via Open original / Download rather than a blanket failure - never
  // fake a preview, but never hide a real (if unrenderable) copy either.
  if (lastReachable) {
    document.querySelector('#archiveViewerBody').innerHTML =
      '<p class="status status-bad">Chronium reached this capture but can\'t safely preview it here. Open it directly or download the original bytes below.</p>';
    origBtn.disabled = false;
    origBtn.onclick = () => window.open(lastReachable.archiveUrl, '_blank', 'noopener');
    dlBtn.disabled = false;
    dlBtn.onclick = () => triggerCaptureDownload(lastReachable.archiveUrl);
  } else {
    document.querySelector('#archiveViewerBody').innerHTML =
      '<p class="status status-bad">No accessible archived copy found. Every known capture was tried.</p>';
  }
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.link-check');
  if (!btn || btn.disabled) return;
  const kind = btn.dataset.linkKind;
  const primaryUrl = btn.dataset.url;

  if (kind === 'archive') {
    const row = btn.closest('.result-row');
    let alternates = [];
    try { alternates = JSON.parse(btn.dataset.alternates || '[]'); } catch { /* malformed data-alternates, ignore */ }
    await openArchiveViewer({
      title: row?.querySelector('h3')?.textContent || '',
      date: btn.dataset.date || '',
      source: btn.dataset.source || '',
      originalUrl: row?.querySelector('.result-url')?.title || '',
      primaryUrl,
      primarySource: btn.dataset.source || 'this provider',
      alternates,
      rowKey: btn.dataset.key
    });
    return;
  }

  // Live pages have no fallback chain (there's only one "current" page) -
  // validate then navigate directly, same as before.
  const originalLabel = btn.textContent;
  const oldNote = btn.nextElementSibling;
  if (oldNote?.classList.contains('link-unavailable-note')) oldNote.remove();
  btn.disabled = true;
  btn.textContent = 'Checking…';
  const verdict = await checkLinkRemote(primaryUrl);
  if (verdict.ok) {
    window.open(verdict.finalUrl || primaryUrl, '_blank', 'noopener');
    btn.disabled = false;
    btn.textContent = originalLabel;
  } else {
    btn.textContent = 'Current page unavailable';
    showLinkUnavailable(btn);
  }
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
    <a class="investigation-card-link" href="#/workspace/research" data-open-investigation="${attr(inv.id)}">${esc(inv.name)}</a>
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
  location.hash = '#/workspace/research';
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
  location.hash = '#/workspace/research';
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
    // Setting a hash that's already current doesn't fire hashchange (the
    // Research tab is where "Add Files"/"Add Web Source" are triggered
    // from), so re-render directly rather than relying on the router.
    location.hash = '#/workspace/research';
    await renderWorkspaceView('research');
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
let lastFindingsSubtab = 'claims';
let lastEvidenceSubtab = 'items';

function buildWorkspaceTabStrip(activeTab) {
  const strip = document.querySelector('#workspaceTabStrip');
  strip.innerHTML = WORKSPACE_TABS.map((t) => `<button type="button" id="tab-${t.id}" role="tab" aria-selected="${t.id === activeTab}" aria-controls="workspacePanel-${t.id}" data-tab="${t.id}"><svg width="15" height="15" style="vertical-align:-3px;margin-right:6px"><use href="#${t.icon}"/></svg>${t.label}</button>`).join('');
  strip.querySelectorAll('button[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.dataset.tab;
    location.hash = id === 'findings' ? `#/workspace/findings/${lastFindingsSubtab}`
      : id === 'evidence' ? `#/workspace/evidence/${lastEvidenceSubtab}`
      : `#/workspace/${id}`;
  }));
}

function buildFindingsSubTabStrip(activeSubtab) {
  const strip = document.querySelector('#findingsSubTabStrip');
  strip.innerHTML = FINDINGS_SUBTABS.map((t) => `<button type="button" role="tab" aria-selected="${t.id === activeSubtab}" aria-controls="findingsPanel-${t.id}" data-subtab="${t.id}">${t.label}</button>`).join('');
  strip.querySelectorAll('button[data-subtab]').forEach((btn) => btn.addEventListener('click', () => { location.hash = `#/workspace/findings/${btn.dataset.subtab}`; }));
}

function buildEvidenceSubTabStrip(activeSubtab) {
  const strip = document.querySelector('#evidenceSubTabStrip');
  strip.innerHTML = EVIDENCE_SUBTABS.map((t) => `<button type="button" role="tab" aria-selected="${t.id === activeSubtab}" aria-controls="evidencePanel-${t.id}" data-evidence-subtab="${t.id}">${t.label}</button>`).join('');
  strip.querySelectorAll('button[data-evidence-subtab]').forEach((btn) => btn.addEventListener('click', () => { location.hash = `#/workspace/evidence/${btn.dataset.evidenceSubtab}`; }));
}

async function renderWorkspaceView(tab, subtab) {
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
  const panel = document.querySelector(`#workspacePanel-${tab}`) || document.querySelector('#workspacePanel-research');
  panel.classList.remove('hidden');

  if (tab === 'research') {
    await refreshWorkspaceData();
    renderOverviewPanel();
    renderSourcesPanel();
    await renderOutlinePanel();
  } else if (tab === 'evidence') {
    const activeSubtab = EVIDENCE_SUBTABS.some((t) => t.id === subtab) ? subtab : 'items';
    lastEvidenceSubtab = activeSubtab;
    buildEvidenceSubTabStrip(activeSubtab);
    document.querySelectorAll('.evidence-subpanel').forEach((p) => p.classList.add('hidden'));
    document.querySelector(`#evidencePanel-${activeSubtab}`).classList.remove('hidden');
    await renderEvidencePanel();
    if (activeSubtab === 'bibliography') await renderBibliographyPanel();
  } else if (tab === 'findings') {
    const activeSubtab = FINDINGS_SUBTABS.some((t) => t.id === subtab) ? subtab : 'claims';
    lastFindingsSubtab = activeSubtab;
    buildFindingsSubTabStrip(activeSubtab);
    document.querySelectorAll('.findings-subpanel').forEach((p) => p.classList.add('hidden'));
    document.querySelector(`#findingsPanel-${activeSubtab}`).classList.remove('hidden');
    await refreshWorkspaceData(); // Timeline reads lastDashboardData
    if (activeSubtab === 'claims') await renderClaimsPanel();
    else if (activeSubtab === 'timeline') renderTimelinePanel();
    else if (activeSubtab === 'contradictions') await renderContradictionsPanel();
    else if (activeSubtab === 'gaps') await renderGapsPanel();
    else if (activeSubtab === 'analysis') await renderAnalysisPanel();
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
  const panel = document.querySelector('#findingsPanel-timeline');
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
// Bibliography (Evidence tab subpanel, per active investigation). Each
// source renders as a card, not a dense table - most Target Source Record
// Shape fields (docs/RESEARCH_METHOD.md) are optional per source, so a wide
// table gets mostly-empty columns fast. Everything computable
// (computeBiblioDerived, db.js) is never re-entered by the researcher.
// ---------------------------------------------------------------------------
async function renderBibliographyPanel() {
  const container = document.querySelector('#bibliographyList');
  if (!activeInvestigationId) { container.innerHTML = ''; return; }
  const [records, evidenceItems, claims] = await Promise.all([
    listInvestigationRecords(activeInvestigationId),
    listEvidenceItems(activeInvestigationId),
    listClaims(activeInvestigationId)
  ]);
  container.innerHTML = records.length
    ? records.map((r) => biblioCardHtml(r, evidenceItems, claims)).join('')
    : '<p class="status">No sources in this investigation yet.</p>';
}

function biblioCardHtml(record, evidenceItems, claims) {
  const b = record.biblio || {};
  const derived = computeBiblioDerived(record, evidenceItems, claims);
  const relevantPages = [...derived.relevantPages, ...(b.relevantPagesNote ? [b.relevantPagesNote] : [])];
  const preservation = [
    `Original: ${derived.preservation.originalAvailable ? 'available' : 'unknown'}`,
    `Archived copy: ${derived.preservation.archived ? 'yes' : 'no'}${derived.preservation.alternateArchiveCount ? ` (+${derived.preservation.alternateArchiveCount} alternate${derived.preservation.alternateArchiveCount === 1 ? '' : 's'})` : ''}`,
    `Local copy: ${derived.preservation.localCopy ? 'kept' : 'not kept'}`
  ].join(' · ');
  const archiveLine = derived.archive
    ? `${esc(derived.archive.source || 'Archived')}${derived.archive.captureDate ? ' · ' + esc(formatDate(derived.archive.captureDate)) : ''}${derived.archive.alternateCount ? ` (+${derived.archive.alternateCount} alternate${derived.archive.alternateCount === 1 ? '' : 's'})` : ''}`
    : 'Not archived';
  const versionLine = [
    derived.versionHash ? `<span title="${attr(derived.versionHash)}">${esc(derived.versionHash.slice(0, 12))}…</span>` : '—',
    derived.pageCount ? `${derived.pageCount} pages` : ''
  ].filter(Boolean).join(' · ');
  const usageLine = `${derived.usage.evidenceCount} evidence item${derived.usage.evidenceCount === 1 ? '' : 's'}, ${derived.usage.claimCount} claim${derived.usage.claimCount === 1 ? '' : 's'}${derived.usage.claimIds.length ? ' (' + esc(derived.usage.claimIds.join(', ')) + ')' : ''}`;
  return `<article class="evidence-card biblio-card">
    <p class="evidence-card-meta">${esc(b.sourceType || 'Source class not set')}${b.documentType ? ' · ' + esc(b.documentType) : ''}</p>
    <p class="biblio-title">${esc(record.title || record.originalUrl || 'Untitled source')}</p>
    <dl class="biblio-fields">
      <div><dt>Publisher / creator</dt><dd>${esc(b.publisher || '—')}</dd></div>
      <div><dt>Publication date</dt><dd>${esc(b.publicationDate || '—')}</dd></div>
      <div><dt>Date coverage</dt><dd>${esc(b.dateCoverage || '—')}</dd></div>
      <div><dt>Retrieved</dt><dd>${derived.retrievedAt ? esc(formatDate(derived.retrievedAt)) : '—'}</dd></div>
      <div><dt>Original location</dt><dd>${derived.originalLocation ? esc(derived.originalLocation) : '—'}</dd></div>
      <div><dt>Archive / capture</dt><dd>${archiveLine}</dd></div>
      <div><dt>Version / hash</dt><dd>${versionLine}</dd></div>
      <div><dt>Relevant pages/passages</dt><dd>${relevantPages.length ? esc(relevantPages.join(', ')) : '—'}</dd></div>
      <div><dt>Investigation usage</dt><dd>${usageLine}</dd></div>
      <div><dt>Preservation</dt><dd>${esc(preservation)}</dd></div>
      <div><dt>Reliability</dt><dd>${esc(b.reliability || '—')}</dd></div>
      <div><dt>Research notes</dt><dd>${esc(b.researchNotes || '—')}</dd></div>
    </dl>
    <button type="button" class="mini-edit-btn" data-action="edit-bibliography" data-id="${attr(record.id)}">Edit</button>
  </article>`;
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
  document.querySelector('#bibliographyDocumentType').value = b.documentType || '';
  document.querySelector('#bibliographyPublicationDate').value = b.publicationDate || '';
  document.querySelector('#bibliographyDateCoverage').value = b.dateCoverage || '';
  document.querySelector('#bibliographyReliability').value = b.reliability || '';
  document.querySelector('#bibliographyRelevantPages').value = b.relevantPagesNote || '';
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
    documentType: document.querySelector('#bibliographyDocumentType').value,
    publicationDate: document.querySelector('#bibliographyPublicationDate').value.trim(),
    dateCoverage: document.querySelector('#bibliographyDateCoverage').value.trim(),
    reliability: document.querySelector('#bibliographyReliability').value,
    relevantPagesNote: document.querySelector('#bibliographyRelevantPages').value.trim(),
    researchNotes: document.querySelector('#bibliographyNotes').value.trim()
  });
  closeDialog('bibliographyDialog');
  showToast('Saved bibliography details.');
  await renderBibliographyPanel();
});

// ---------------------------------------------------------------------------
// Research Outline (Research tab) - a research question + overall method,
// broken into sections/subquestions each with their own method, status, and
// evidence/finding coverage, per docs/RESEARCH_METHOD.md "Research Outline &
// Coverage." Editing lives here; Findings->Gaps (renderGapsPanel) only reads
// it, read-only.
// ---------------------------------------------------------------------------
let currentOutline = null;

async function renderOutlinePanel() {
  const [outline, evidenceItems, quantFindings, qualFindings] = await Promise.all([
    getOutline(activeInvestigationId),
    listEvidenceItems(activeInvestigationId),
    listQuantitativeFindings(activeInvestigationId),
    listQualitativeFindings(activeInvestigationId)
  ]);
  currentOutline = outline;
  document.querySelector('#outlineQuestionInput').value = currentOutline.researchQuestion || '';
  document.querySelector('#outlineMethodSelect').value = currentOutline.method || 'mixed';
  renderOutlineLanes(evidenceItems, quantFindings, qualFindings);
}

async function refreshOutlineLanes() {
  const [evidenceItems, quantFindings, qualFindings] = await Promise.all([
    listEvidenceItems(activeInvestigationId),
    listQuantitativeFindings(activeInvestigationId),
    listQualitativeFindings(activeInvestigationId)
  ]);
  renderOutlineLanes(evidenceItems, quantFindings, qualFindings);
}

function renderOutlineLanes(evidenceItems, quantFindings = [], qualFindings = []) {
  const container = document.querySelector('#outlineLanesList');
  const progressLine = document.querySelector('#outlineProgressLine');
  const lanes = currentOutline?.lanes || [];
  if (progressLine) {
    const answered = lanes.filter((l) => l.status === 'answered').length;
    progressLine.textContent = lanes.length ? `${answered} of ${lanes.length} section${lanes.length === 1 ? '' : 's'} answered.` : '';
  }
  if (!lanes.length) { container.innerHTML = '<p class="status">No outline sections yet — add one below.</p>'; return; }
  container.innerHTML = lanes.map((lane) => {
    const count = evidenceItems.filter((e) => e.outlineLaneId === lane.id).length;
    const findingCount = quantFindings.filter((f) => f.outlineLaneId === lane.id).length + qualFindings.filter((f) => f.outlineLaneId === lane.id).length;
    const pct = lane.coveragePct;
    const bar = pct == null ? '' : `<div class="lane-bar-track"><div class="lane-bar-fill" style="width:${pct}%"></div></div>`;
    const method = lane.method || 'mixed';
    const status = lane.status || 'not-started';
    return `<div class="lane-row">
      <div class="lane-row-label">
        <strong>${esc(lane.label)}</strong>
        <span>${count} evidence item${count === 1 ? '' : 's'} · ${findingCount} finding${findingCount === 1 ? '' : 's'} linked</span>
      </div>
      <select class="lane-inline-select" data-lane-field="method" data-lane-id="${attr(lane.id)}" aria-label="Method for ${attr(lane.label)}">
        <option value="quantitative"${method === 'quantitative' ? ' selected' : ''}>Quantitative</option>
        <option value="qualitative"${method === 'qualitative' ? ' selected' : ''}>Qualitative</option>
        <option value="mixed"${method === 'mixed' ? ' selected' : ''}>Mixed</option>
      </select>
      <select class="lane-inline-select" data-lane-field="status" data-lane-id="${attr(lane.id)}" aria-label="Status for ${attr(lane.label)}">
        <option value="not-started"${status === 'not-started' ? ' selected' : ''}>Not started</option>
        <option value="in-progress"${status === 'in-progress' ? ' selected' : ''}>In progress</option>
        <option value="answered"${status === 'answered' ? ' selected' : ''}>Answered</option>
      </select>
      ${bar}
      <div class="lane-pct">${pct == null ? 'Not estimated' : pct + '%'}</div>
      <button type="button" class="icon-btn" data-action="delete-lane" data-lane-id="${attr(lane.id)}" aria-label="Delete section ${attr(lane.label)}"><svg width="16" height="16"><use href="#icon-close"/></svg></button>
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
  const method = document.querySelector('#outlineLaneMethodSelect').value;
  const status = document.querySelector('#outlineLaneStatusSelect').value;
  currentOutline = await addOutlineLane(activeInvestigationId, { label, coveragePct: coverageRaw === '' ? null : Number(coverageRaw), method, status });
  document.querySelector('#outlineLaneForm').reset();
  await refreshOutlineLanes();
  showToast(`Added section “${label}”.`);
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-lane"]');
  if (!btn || !activeInvestigationId) return;
  currentOutline = await deleteOutlineLane(activeInvestigationId, btn.dataset.laneId);
  await refreshOutlineLanes();
});

document.addEventListener('change', async (e) => {
  const sel = e.target.closest('.lane-inline-select');
  if (!sel || !activeInvestigationId) return;
  currentOutline = await updateOutlineLane(activeInvestigationId, sel.dataset.laneId, { [sel.dataset.laneField]: sel.value });
  await refreshOutlineLanes();
  showToast('Updated outline section.');
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
// Research Gaps (computed from Outline + Evidence, no separate store).
// Editing the outline happens on the Research tab - this is read-only.
// computeGapWarnings is also reused by the Report tab so gap criteria only
// live in one place.
// ---------------------------------------------------------------------------
function computeGapWarnings(outline, evidenceItems) {
  return (outline.lanes || []).map((lane) => {
    const count = evidenceItems.filter((e) => e.outlineLaneId === lane.id).length;
    const status = lane.status || 'not-started';
    if (status === 'answered') return count === 0 ? { lane, count, reason: 'unconfirmed-answered' } : null;
    if (count === 0) return { lane, count, reason: 'no-evidence' };
    if (lane.coveragePct != null && lane.coveragePct < 50) return { lane, count, reason: 'low-coverage' };
    return null;
  }).filter(Boolean);
}

async function renderGapsPanel() {
  const [outline, items] = await Promise.all([getOutline(activeInvestigationId), listEvidenceItems(activeInvestigationId)]);
  const container = document.querySelector('#gapsContent');
  const lanes = outline.lanes || [];
  if (!lanes.length) {
    container.innerHTML = `<div class="coming-soon"><svg class="coming-soon-mascot" width="40" height="40" aria-hidden="true"><use href="#icon-dragon-outline"/></svg><div><h2>No outline sections yet</h2><p>Research Gaps are computed from your <a href="#/workspace/research" data-route="/workspace/research">research outline</a> — add a few sections there to see gap warnings here.</p></div></div>`;
    return;
  }
  const gaps = computeGapWarnings(outline, items);
  container.innerHTML = gaps.length
    ? gaps.map(({ lane, count, reason }) => {
        const status = lane.status || 'not-started';
        const message = reason === 'unconfirmed-answered'
          ? 'Marked “Answered” but has no evidence items linked yet — worth double-checking.'
          : count === 0 ? 'No evidence items linked yet.' : `Only ${count} evidence item${count === 1 ? '' : 's'} linked, estimated coverage ${lane.coveragePct}%.`;
        return `<div class="gap-card"><div class="gap-card-head"><strong>${esc(lane.label)}</strong><span class="status-badge status-${esc(status)}">${esc(STATUS_LABEL[status])}</span></div><p>${message}</p></div>`;
      }).join('')
    : '<p class="status">No gap warnings — every section is marked answered or has adequate evidence linked.</p>';
}

// ---------------------------------------------------------------------------
// Evidence-Backed Report - built strictly from structured research state,
// in the order docs/RESEARCH_METHOD.md's Current Research Flow lays out:
// Question -> Method -> Outline -> Sources/Bibliography -> Evidence ->
// Quantitative/Qualitative Findings -> Gaps/Contradictions -> Claims. Every
// section is generated live from IndexedDB (deterministic, free, no AI
// required) and skipped silently when there's nothing in it yet.
// ---------------------------------------------------------------------------
async function renderReportPanel() {
  const [outline, records, evidenceItems, claims, quantFindings, qualFindings, crossValidations, cachedAnalysis] = await Promise.all([
    getOutline(activeInvestigationId),
    listInvestigationRecords(activeInvestigationId),
    listEvidenceItems(activeInvestigationId),
    listClaims(activeInvestigationId),
    listQuantitativeFindings(activeInvestigationId),
    listQualitativeFindings(activeInvestigationId),
    listCrossValidations(activeInvestigationId),
    getQualitativeAnalysis(activeInvestigationId)
  ]);
  const container = document.querySelector('#reportContent');

  const hasAnything = outline.researchQuestion || (outline.lanes || []).length || records.length || claims.length || quantFindings.length || qualFindings.length;
  if (!hasAnything) {
    container.innerHTML = `<div class="coming-soon"><svg class="coming-soon-mascot" width="40" height="40" aria-hidden="true"><use href="#icon-dragon-outline"/></svg><div><h2>Nothing to report yet</h2><p>A report is built from your structured research state, not raw search results. Start with a question on the <a href="#/workspace/research" data-route="/workspace/research">Research tab</a>, save some evidence, and add claims.</p></div></div>`;
    return;
  }

  const sections = [];

  // 1-2. Question, Method & Outline
  if (outline.researchQuestion || outline.method) {
    sections.push(`<section class="report-section"><h2>Research question</h2><p class="report-question">${esc(outline.researchQuestion || 'Not yet defined.')}</p><p class="hint">Overall method: ${esc(METHOD_LABEL[outline.method] || 'Mixed')}</p></section>`);
  }
  if ((outline.lanes || []).length) {
    const rows = outline.lanes.map((lane) => {
      const count = evidenceItems.filter((e) => e.outlineLaneId === lane.id).length;
      const status = lane.status || 'not-started';
      const method = lane.method || 'mixed';
      return `<li><strong>${esc(lane.label)}</strong> — ${esc(STATUS_LABEL[status])} · ${esc(METHOD_LABEL[method])} · ${count} evidence item${count === 1 ? '' : 's'}${lane.coveragePct != null ? ` · ~${lane.coveragePct}% coverage` : ''}</li>`;
    }).join('');
    sections.push(`<section class="report-section"><h2>Outline</h2><ul class="report-list">${rows}</ul></section>`);
  }

  // 3. Sources / Bibliography
  if (records.length) {
    const rows = records.map((r) => {
      const b = r.biblio || {};
      const derived = computeBiblioDerived(r, evidenceItems, claims);
      const preserved = derived.preservation.archived || derived.preservation.originalAvailable ? 'preserved' : 'preservation unconfirmed';
      return `<li><strong>${esc(r.title || r.originalUrl || 'Untitled source')}</strong>${b.publisher ? ' — ' + esc(b.publisher) : ''}${b.sourceType ? ' · ' + esc(b.sourceType) : ''}${b.documentType ? ' · ' + esc(b.documentType) : ''} · ${preserved}</li>`;
    }).join('');
    sections.push(`<section class="report-section"><h2>Sources</h2><ul class="report-list">${rows}</ul></section>`);
  }

  // 4. Evidence (summary only - full excerpts already appear under Findings/Claims below)
  if (evidenceItems.length) {
    const sourceCount = new Set(evidenceItems.map((e) => e.sourceRecordId)).size;
    sections.push(`<section class="report-section"><h2>Evidence</h2><p>${evidenceItems.length} evidence item${evidenceItems.length === 1 ? '' : 's'} collected across ${sourceCount} source${sourceCount === 1 ? '' : 's'}.</p></section>`);
  }

  // 5-6. Quantitative & Qualitative Findings
  if (quantFindings.length) {
    const items = quantFindings.map((f) => `<div class="report-evidence"><p><strong>${esc(f.statement)}</strong></p>${f.formula ? `<p>Formula: ${esc(f.formula)}</p>` : ''}${f.method ? `<p>Method: ${esc(f.method)}</p>` : ''}</div>`).join('');
    sections.push(`<section class="report-section"><h2>Quantitative findings</h2>${items}</section>`);
  }
  if (qualFindings.length) {
    const items = qualFindings.map((f) => `<div class="report-evidence"><p><strong>${esc(f.statement)}</strong></p>${f.methodology ? `<p>Methodology: ${esc(f.methodology)}</p>` : ''}</div>`).join('');
    sections.push(`<section class="report-section"><h2>Qualitative findings</h2>${items}</section>`);
  }

  // 7. Gaps / Contradictions / Review items - open questions, never conclusions
  const gapWarnings = computeGapWarnings(outline, evidenceItems);
  const contradictions = cachedAnalysis?.result?.contradictions || [];
  const discrepancies = crossValidations.filter((c) => c.verdict === 'discrepancy');
  if (gapWarnings.length || contradictions.length || discrepancies.length) {
    const qById = new Map(quantFindings.map((f) => [f.id, f]));
    const qlById = new Map(qualFindings.map((f) => [f.id, f]));
    const gapItems = gapWarnings.map((g) => `<li>Gap — ${esc(g.lane.label)}: ${g.reason === 'unconfirmed-answered' ? 'marked answered but no evidence linked' : g.count === 0 ? 'no evidence linked yet' : 'estimated coverage below 50%'}.</li>`).join('');
    const contraItems = contradictions.map((c) => `<li>Contradiction (AI-flagged, unverified): ${esc(c.description)}</li>`).join('');
    const discItems = discrepancies.map((d) => `<li>Review item — “${esc(qById.get(d.quantitativeFindingId)?.statement || 'quantitative finding removed')}” vs. “${esc(qlById.get(d.qualitativeFindingId)?.statement || 'qualitative finding removed')}”${d.note ? ': ' + esc(d.note) : ''} — needs human review, not a conclusion.</li>`).join('');
    sections.push(`<section class="report-section"><h2>Gaps, contradictions &amp; review items</h2><p class="hint">These are open questions the research hasn't resolved yet — never treat them as findings.</p><ul class="report-list">${gapItems}${contraItems}${discItems}</ul></section>`);
  }

  // 8. Claims (the reasoning unit reports are actually built from)
  const evById = new Map(evidenceItems.map((e) => [e.id, e]));
  const recById = new Map(records.map((r) => [r.id, r]));
  if (claims.length) {
    const claimsHtml = claims.map((claim) => {
      const evidenceHtml = (claim.links || []).map((l) => {
        const ev = evById.get(l.evidenceItemId);
        if (!ev) return '';
        const src = recById.get(ev.sourceRecordId);
        return `<div class="report-evidence"><span class="stance-tag ${l.stance}">${l.stance}</span>${esc(ev.excerptText)}<p>${src ? esc(src.title || src.originalUrl || 'Untitled source') : 'Source unavailable'}${ev.location ? ' · ' + esc(ev.location) : ''}</p></div>`;
      }).join('');
      return `<article class="report-claim"><p class="report-claim-id">${esc(claim.claimId)}</p><h3>${esc(claim.text)}</h3>${evidenceHtml || '<p class="hint">No evidence linked to this claim yet.</p>'}</article>`;
    }).join('');
    sections.push(`<section class="report-section"><h2>Claims</h2>${claimsHtml}</section>`);
  } else {
    sections.push(`<section class="report-section"><h2>Claims</h2><p class="hint">No claims yet — add claims backed by evidence on the <a href="#/workspace/findings/claims" data-route="/workspace/findings">Findings</a> tab.</p></section>`);
  }

  container.innerHTML = sections.join('');
}

// ---------------------------------------------------------------------------
// Analysis: Quantitative (deterministic, client-only, free) + Qualitative
// (AI-assisted, explicit user action only, cached). Docs/CANON.md: AI is a
// last resort behind cache -> deterministic code -> database/index ->
// rules, never used for work normal code already does reliably - so
// Quantitative never touches the network at all.
// ---------------------------------------------------------------------------
const MIN_EVIDENCE_FOR_ANALYSIS = 2;
let analysisEvidenceItems = []; // last-rendered list, so the finding forms below can resolve a checked evidence-item id without a second query

async function renderAnalysisPanel() {
  const [records, outline, evidenceItems, claims, quantFindings, qualFindings, crossValidations] = await Promise.all([
    listInvestigationRecords(activeInvestigationId),
    getOutline(activeInvestigationId),
    listEvidenceItems(activeInvestigationId),
    listClaims(activeInvestigationId),
    listQuantitativeFindings(activeInvestigationId),
    listQualitativeFindings(activeInvestigationId),
    listCrossValidations(activeInvestigationId)
  ]);
  currentOutline = outline;
  analysisEvidenceItems = evidenceItems;

  renderQuantitativeAnalysis(records, outline, evidenceItems, claims);

  const outlineOptions = '<option value="">None</option>' + (outline.lanes || []).map((l) => `<option value="${attr(l.id)}">${esc(l.label)}</option>`).join('');
  document.querySelector('#quantFindingOutlineSelect').innerHTML = outlineOptions;
  document.querySelector('#qualFindingOutlineSelect').innerHTML = outlineOptions;

  renderQuantFindingInputsPicker(evidenceItems);
  renderQuantFindingsList(quantFindings, evidenceItems);
  renderQualFindingPicker(evidenceItems);
  renderQualFindingsList(qualFindings, evidenceItems);
  renderCrossValidationSelects(quantFindings, qualFindings);
  renderCrossValidationsList(crossValidations, quantFindings, qualFindings);

  await renderQualitativeSection(evidenceItems, claims, outline);
}

// ---------------------------------------------------------------------------
// Quantitative Findings: a specific numeric conclusion with its formula,
// method, and exact inputs preserved (docs/RESEARCH_METHOD.md Analysis
// Modes). The numeric sum shown is a mechanically Computed Fact, not a
// substitute for the formula/method text describing what was actually done.
// ---------------------------------------------------------------------------
function renderQuantFindingInputsPicker(evidenceItems) {
  const container = document.querySelector('#quantFindingInputsPicker');
  if (!evidenceItems.length) { container.innerHTML = '<p class="status" style="padding:12px;margin:0">Add evidence items first, on the Evidence tab.</p>'; return; }
  container.innerHTML = evidenceItems.map((item) => `<label class="claim-evidence-option">
    <input type="checkbox" data-quant-input-id="${attr(item.id)}" />
    <span class="claim-evidence-option-text">${esc(item.excerptText.slice(0, 140))}${item.excerptText.length > 140 ? '…' : ''}<p>${esc(item.excerptType)}${item.location ? ' · ' + esc(item.location) : ''}</p></span>
    <input type="number" step="any" class="claim-evidence-option-value" data-quant-value-for="${attr(item.id)}" placeholder="Value" aria-label="Value contributed by this evidence item" />
  </label>`).join('');
}

function renderQuantFindingsList(findings, evidenceItems) {
  const container = document.querySelector('#quantFindingsList');
  if (!findings.length) { container.innerHTML = '<p class="status">No quantitative findings yet.</p>'; return; }
  const byId = new Map(evidenceItems.map((e) => [e.id, e]));
  container.innerHTML = findings.map((f) => {
    const rows = (f.inputs || []).map((i) => {
      const ev = i.evidenceItemId ? byId.get(i.evidenceItemId) : null;
      const label = ev ? esc(ev.excerptText.slice(0, 100)) + (ev.excerptText.length > 100 ? '…' : '') : esc(i.label || 'Evidence item removed');
      return `<li>${i.value != null ? `<strong>${esc(String(i.value))}</strong> — ` : ''}${label}</li>`;
    }).join('');
    const numericValues = (f.inputs || []).map((i) => i.value).filter((v) => typeof v === 'number' && !isNaN(v));
    const sum = numericValues.length ? numericValues.reduce((a, b) => a + b, 0) : null;
    return `<article class="evidence-card">
      <p class="evidence-card-meta">Quantitative finding</p>
      <p><strong>${esc(f.statement)}</strong></p>
      ${f.formula ? `<p class="hint">Formula: ${esc(f.formula)}</p>` : ''}
      ${f.method ? `<p class="hint">Method: ${esc(f.method)}</p>` : ''}
      ${rows ? `<ul class="claim-card-links">${rows}</ul>` : ''}
      ${sum != null ? `<p class="hint">Mechanical sum of numeric inputs: ${sum} — informational only, not a substitute for the formula/method above.</p>` : ''}
      <button type="button" class="btn btn-small card-delete" data-action="delete-quant-finding" data-id="${attr(f.id)}">Delete</button>
    </article>`;
  }).join('');
}

document.querySelector('#quantFindingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeInvestigationId) return;
  const statement = document.querySelector('#quantFindingStatement').value.trim();
  if (!statement) return;
  const byId = new Map(analysisEvidenceItems.map((it) => [it.id, it]));
  const inputs = [...document.querySelectorAll('#quantFindingInputsPicker input[type=checkbox]:checked')].map((cb) => {
    const id = cb.dataset.quantInputId;
    const valueInput = document.querySelector(`input[data-quant-value-for="${id}"]`);
    const item = byId.get(id);
    return { label: item ? item.excerptText.slice(0, 100) : '', value: valueInput?.value, evidenceItemId: id };
  });
  await createQuantitativeFinding(activeInvestigationId, {
    statement,
    formula: document.querySelector('#quantFindingFormula').value.trim(),
    method: document.querySelector('#quantFindingMethod').value.trim(),
    inputs,
    outlineLaneId: document.querySelector('#quantFindingOutlineSelect').value || null
  });
  document.querySelector('#quantFindingForm').reset();
  await renderAnalysisPanel();
  showToast('Added quantitative finding.');
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-quant-finding"]');
  if (!btn) return;
  await deleteQuantitativeFinding(btn.dataset.id);
  await renderAnalysisPanel();
});

// ---------------------------------------------------------------------------
// Qualitative Findings: a specific interpretive conclusion with its
// supporting passages and methodology preserved - distinct from the
// free-form AI Qualitative Analysis synthesis below (renderQualitativeSection),
// which is a cached AI opinion, not a researcher-asserted finding.
// ---------------------------------------------------------------------------
function renderQualFindingPicker(evidenceItems) {
  const container = document.querySelector('#qualFindingPicker');
  if (!evidenceItems.length) { container.innerHTML = '<p class="status" style="padding:12px;margin:0">Add evidence items first, on the Evidence tab.</p>'; return; }
  container.innerHTML = evidenceItems.map((item) => `<label class="claim-evidence-option">
    <input type="checkbox" data-qual-input-id="${attr(item.id)}" />
    <span class="claim-evidence-option-text">${esc(item.excerptText.slice(0, 140))}${item.excerptText.length > 140 ? '…' : ''}<p>${esc(item.excerptType)}${item.location ? ' · ' + esc(item.location) : ''}</p></span>
  </label>`).join('');
}

function renderQualFindingsList(findings, evidenceItems) {
  const container = document.querySelector('#qualFindingsList');
  if (!findings.length) { container.innerHTML = '<p class="status">No qualitative findings yet.</p>'; return; }
  const byId = new Map(evidenceItems.map((e) => [e.id, e]));
  container.innerHTML = findings.map((f) => {
    const passages = (f.evidenceItemIds || []).map((id) => byId.get(id)).filter(Boolean)
      .map((e) => `<li>${esc(e.excerptText.slice(0, 140))}${e.excerptText.length > 140 ? '…' : ''}</li>`).join('');
    return `<article class="evidence-card">
      <p class="evidence-card-meta">Qualitative finding</p>
      <p><strong>${esc(f.statement)}</strong></p>
      ${f.methodology ? `<p class="hint">Methodology: ${esc(f.methodology)}</p>` : ''}
      ${passages ? `<ul class="claim-card-links">${passages}</ul>` : ''}
      <button type="button" class="btn btn-small card-delete" data-action="delete-qual-finding" data-id="${attr(f.id)}">Delete</button>
    </article>`;
  }).join('');
}

document.querySelector('#qualFindingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeInvestigationId) return;
  const statement = document.querySelector('#qualFindingStatement').value.trim();
  if (!statement) return;
  const evidenceItemIds = [...document.querySelectorAll('#qualFindingPicker input[type=checkbox]:checked')].map((cb) => cb.dataset.qualInputId);
  await createQualitativeFinding(activeInvestigationId, {
    statement,
    methodology: document.querySelector('#qualFindingMethodology').value.trim(),
    evidenceItemIds,
    outlineLaneId: document.querySelector('#qualFindingOutlineSelect').value || null
  });
  document.querySelector('#qualFindingForm').reset();
  await renderAnalysisPanel();
  showToast('Added qualitative finding.');
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-qual-finding"]');
  if (!btn) return;
  await deleteQualitativeFinding(btn.dataset.id);
  await renderAnalysisPanel();
});

// ---------------------------------------------------------------------------
// Mixed-method cross-validation: does a Quantitative Finding agree with a
// Qualitative Finding? A researcher judgment call, never inferred by
// Chronium - a 'discrepancy' verdict is a review item, not a conclusion
// (docs/RESEARCH_METHOD.md: "Never turn a ... discrepancy ... into a
// factual conclusion").
// ---------------------------------------------------------------------------
function renderCrossValidationSelects(quantFindings, qualFindings) {
  const qSel = document.querySelector('#crossValQuantSelect');
  const qlSel = document.querySelector('#crossValQualSelect');
  qSel.innerHTML = quantFindings.length ? quantFindings.map((f) => `<option value="${attr(f.id)}">${esc(f.statement.slice(0, 70))}</option>`).join('') : '<option value="">Add a quantitative finding first</option>';
  qlSel.innerHTML = qualFindings.length ? qualFindings.map((f) => `<option value="${attr(f.id)}">${esc(f.statement.slice(0, 70))}</option>`).join('') : '<option value="">Add a qualitative finding first</option>';
}

function renderCrossValidationsList(entries, quantFindings, qualFindings) {
  const container = document.querySelector('#crossValidationsList');
  if (!entries.length) { container.innerHTML = '<p class="status">No cross-validations yet.</p>'; return; }
  const qById = new Map(quantFindings.map((f) => [f.id, f]));
  const qlById = new Map(qualFindings.map((f) => [f.id, f]));
  const VERDICT_LABEL = { consistent: 'Consistent', discrepancy: 'Discrepancy — review item', unclear: 'Unclear' };
  container.innerHTML = entries.map((entry) => {
    const qf = qById.get(entry.quantitativeFindingId);
    const qlf = qlById.get(entry.qualitativeFindingId);
    return `<article class="${entry.verdict === 'discrepancy' ? 'gap-card' : 'evidence-card'}">
      <p class="evidence-card-meta">${esc(VERDICT_LABEL[entry.verdict] || entry.verdict)}</p>
      <p>Quant: ${qf ? esc(qf.statement) : 'Finding removed'}</p>
      <p>Qual: ${qlf ? esc(qlf.statement) : 'Finding removed'}</p>
      ${entry.note ? `<p>${esc(entry.note)}</p>` : ''}
      <button type="button" class="btn btn-small card-delete" data-action="delete-cross-validation" data-id="${attr(entry.id)}">Delete</button>
    </article>`;
  }).join('');
}

document.querySelector('#crossValidationForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeInvestigationId) return;
  const quantitativeFindingId = document.querySelector('#crossValQuantSelect').value;
  const qualitativeFindingId = document.querySelector('#crossValQualSelect').value;
  if (!quantitativeFindingId || !qualitativeFindingId) { showToast('Add at least one quantitative and one qualitative finding first.', true); return; }
  await createCrossValidation(activeInvestigationId, {
    quantitativeFindingId, qualitativeFindingId,
    verdict: document.querySelector('#crossValVerdictSelect').value,
    note: document.querySelector('#crossValNote').value.trim()
  });
  document.querySelector('#crossValNote').value = '';
  await renderAnalysisPanel();
  showToast('Added cross-validation.');
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-cross-validation"]');
  if (!btn) return;
  await deleteCrossValidation(btn.dataset.id);
  await renderAnalysisPanel();
});

function renderQuantitativeAnalysis(records, outline, evidenceItems, claims) {
  const grid = document.querySelector('#quantAnalysisGrid');
  const supportsCount = claims.reduce((n, c) => n + (c.links || []).filter((l) => l.stance === 'supports').length, 0);
  const contradictsCount = claims.reduce((n, c) => n + (c.links || []).filter((l) => l.stance === 'contradicts').length, 0);
  const typeCounts = evidenceItems.reduce((m, e) => { const k = e.excerptType || 'other'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const bySource = evidenceItems.reduce((m, e) => { m[e.sourceRecordId] = (m[e.sourceRecordId] || 0) + 1; return m; }, {});
  const mostCitedCount = Object.values(bySource).reduce((max, n) => Math.max(max, n), 0);
  const unlinkedClaims = claims.filter((c) => !(c.links || []).length).length;
  const lanesWithNoEvidence = (outline.lanes || []).filter((lane) => !evidenceItems.some((e) => e.outlineLaneId === lane.id)).length;

  const stats = [
    { label: 'Sources', value: records.length },
    { label: 'Evidence items', value: evidenceItems.length },
    { label: 'Claims', value: claims.length },
    { label: 'Supporting links', value: supportsCount },
    { label: 'Contradicting links', value: contradictsCount },
    { label: 'Claims with no evidence', value: unlinkedClaims },
    { label: 'Most-cited source', value: mostCitedCount ? `${mostCitedCount}×` : '—' },
    { label: 'Outline lanes with no evidence', value: lanesWithNoEvidence },
    ...Object.entries(typeCounts).map(([k, v]) => ({ label: k, value: v }))
  ];
  grid.innerHTML = stats.map((s) => `<div><strong>${esc(String(s.value))}</strong><p>${esc(s.label)}</p></div>`).join('');
}

async function renderQualitativeSection(evidenceItems, claims, outline) {
  const statusEl = document.querySelector('#qualAnalysisStatus');
  const btn = document.querySelector('#runQualAnalysisBtn');
  const resultsEl = document.querySelector('#qualAnalysisResults');

  if (evidenceItems.length < MIN_EVIDENCE_FOR_ANALYSIS) {
    statusEl.textContent = `Add at least ${MIN_EVIDENCE_FOR_ANALYSIS} evidence items on the Evidence tab before running analysis.`;
    btn.disabled = true;
  } else {
    statusEl.textContent = '';
    btn.disabled = false;
  }

  const cached = await getQualitativeAnalysis(activeInvestigationId);
  if (cached?.result) {
    renderQualitativeResult(cached.result, evidenceItems, claims);
    btn.textContent = 'Re-run AI analysis';
    if (!btn.disabled) statusEl.textContent = `Last analyzed ${formatDate(cached.createdAt)} (${cached.model || 'AI'}).`;
  } else {
    resultsEl.innerHTML = '';
    btn.textContent = 'Run AI analysis';
  }

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Analyzing…';
    statusEl.textContent = 'Sending evidence for AI analysis…';
    try {
      const res = await fetch('/api/analyze/qualitative', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          researchQuestion: outline.researchQuestion || '',
          evidenceItems: evidenceItems.map((e) => ({ id: e.id, excerptType: e.excerptType, location: e.location, excerptText: e.excerptText })),
          claims: claims.map((c) => ({ claimId: c.claimId, text: c.text }))
        })
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Analysis failed.');
      if (data.skipped) { statusEl.textContent = data.reason; return; }
      await saveQualitativeAnalysis(activeInvestigationId, { result: data.result, model: data.model });
      renderQualitativeResult(data.result, evidenceItems, claims);
      statusEl.textContent = `${data.cached ? 'Loaded a recent analysis' : 'Analysis complete'} (${data.model || 'AI'}).${data.truncated ? ' Based on a subset of your evidence — the full set was too large for one pass.' : ''}`;
      showToast('Qualitative analysis complete.');
    } catch (err) {
      statusEl.textContent = err.message;
      showToast(err.message, true);
    } finally {
      btn.disabled = evidenceItems.length < MIN_EVIDENCE_FOR_ANALYSIS;
      btn.textContent = 'Re-run AI analysis';
    }
  };
}

function renderQualitativeResult(result, evidenceItems, claims) {
  const resultsEl = document.querySelector('#qualAnalysisResults');
  const evById = new Map(evidenceItems.map((e) => [e.id, e]));
  if (result.parseError) {
    resultsEl.innerHTML = `<div class="panel"><p class="hint">The AI's response didn't come back in the expected format — showing it as-is.</p><p>${esc(result.synthesis)}</p></div>`;
    return;
  }
  const citeList = (ids) => (ids || []).map((id) => evById.get(id)).filter(Boolean)
    .map((e) => `<li>${esc(e.excerptText.slice(0, 140))}${e.excerptText.length > 140 ? '…' : ''}</li>`).join('');

  const themesHtml = (result.themes || []).map((t) => `<div class="evidence-card"><p class="evidence-card-meta">Theme</p><p><strong>${esc(t.title)}</strong> — ${esc(t.description)}</p>${t.evidenceIds?.length ? `<ul class="claim-card-links">${citeList(t.evidenceIds)}</ul>` : ''}</div>`).join('');
  const patternsHtml = (result.patterns || []).map((p) => `<div class="evidence-card"><p class="evidence-card-meta">Pattern</p><p>${esc(p.description)}</p>${p.evidenceIds?.length ? `<ul class="claim-card-links">${citeList(p.evidenceIds)}</ul>` : ''}</div>`).join('');
  // Contradictions get their own Findings sub-tab (renderContradictionsPanel,
  // reading this same cached result) rather than being repeated here too.
  resultsEl.innerHTML = `
    ${result.synthesis ? `<div class="panel"><h2>Synthesis</h2><p>${esc(result.synthesis)}</p></div>` : ''}
    ${themesHtml ? `<h3 style="margin:18px 0 8px;font-size:14px">Themes</h3>${themesHtml}` : ''}
    ${patternsHtml ? `<h3 style="margin:18px 0 8px;font-size:14px">Patterns</h3>${patternsHtml}` : ''}
    ${result.contradictions?.length ? `<p class="hint" style="margin-top:14px">This evidence also has ${result.contradictions.length} contradiction${result.contradictions.length === 1 ? '' : 's'} — see the <a href="#/workspace/findings/contradictions" data-route="/workspace/findings">Contradictions</a> tab.</p>` : ''}
    ${!themesHtml && !patternsHtml && !result.synthesis ? '<p class="status">No findings returned.</p>' : ''}
  `;
}

// ---------------------------------------------------------------------------
// Contradictions (Findings sub-tab) - a focused view of the same
// contradictions AI Qualitative Analysis already finds (renderQualitativeResult
// above), so a researcher doesn't have to dig through the combined Analysis
// panel to see just the tensions in their evidence. No new data - just its
// own screen for data the AI provider already returns.
// ---------------------------------------------------------------------------
async function renderContradictionsPanel() {
  const container = document.querySelector('#contradictionsContent');
  const [cached, evidenceItems] = await Promise.all([
    getQualitativeAnalysis(activeInvestigationId),
    listEvidenceItems(activeInvestigationId)
  ]);
  const contradictions = cached?.result?.contradictions || [];
  if (!contradictions.length) {
    container.innerHTML = `<div class="coming-soon"><svg class="coming-soon-mascot" width="40" height="40" aria-hidden="true"><use href="#icon-dragon-outline"/></svg><div><h2>No contradictions found yet</h2><p>Contradictions come from AI Qualitative Analysis. Run it on the <a href="#/workspace/findings/analysis" data-route="/workspace/findings">Analysis</a> tab to check your evidence for tensions.</p></div></div>`;
    return;
  }
  const evById = new Map(evidenceItems.map((e) => [e.id, e]));
  const citeList = (ids) => (ids || []).map((id) => evById.get(id)).filter(Boolean)
    .map((e) => `<li>${esc(e.excerptText.slice(0, 140))}${e.excerptText.length > 140 ? '…' : ''}</li>`).join('');
  container.innerHTML = contradictions.map((c) => `<div class="gap-card"><p class="evidence-card-meta">Contradiction</p><p>${esc(c.description)}</p>${c.evidenceIds?.length ? `<ul class="claim-card-links">${citeList(c.evidenceIds)}</ul>` : ''}</div>`).join('');
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
(async function init() {
  await setActiveInvestigation(activeInvestigationId);
  await renderRoute();
})();
