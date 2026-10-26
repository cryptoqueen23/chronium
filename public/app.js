import {
  listInvestigations, createInvestigation, deleteInvestigation,
  saveRecordToInvestigation, removeRecordFromInvestigation, listInvestigationRecords,
  getSavedCanonicalKeys, searchLibrary, searchInvestigation, addUserUrl, listIngestionBatches, getBlob,
  updateBibliographyDetails, computeBiblioDerived, getOutline, saveOutline, addOutlineLane, updateOutlineLane, deleteOutlineLane,
  listEvidenceItems, createEvidenceItem, deleteEvidenceItem, listClaims, createClaim, deleteClaim,
  getQualitativeAnalysis, saveQualitativeAnalysis,
  listQuantitativeFindings, createQuantitativeFinding, deleteQuantitativeFinding,
  listQualitativeFindings, createQualitativeFinding, deleteQualitativeFinding,
  listCrossValidations, createCrossValidation, deleteCrossValidation,
  listAskSourcesHistory, createAskSourcesHistoryEntry, updateClaim,
  createEntity, updateEntity, listEntities, findEntities, deleteEntity,
  createRelationship, listRelationshipsForEntity, deleteRelationship,
  addEntityAlias, listEntityAliases, deleteEntityAlias,
  createEntityMention, listMentionsForEntity, listMentionsForEvidence, deleteEntityMention,
  getClaim, listClaimsForEntity,
  createClaimEvidence, listClaimEvidenceForClaim, listClaimEvidenceForEvidence, deleteClaimEvidence,
  createClaimFinding, listClaimFindings, listClaimFindingsForClaim, listClaimFindingsForEntity, deleteClaimFinding,
  listDiscoveryRuns, listDiscoveryLedger
} from './db.js';
import {
  ENTITY_TYPES, ENTITY_TYPE_LABELS, RELATIONSHIP_STATUSES, RELATIONSHIP_STATUS_LABELS,
  SUGGESTED_RELATIONSHIP_TYPES
} from './entities.js';
import {
  CLAIM_STATUSES, CLAIM_STATUS_LABELS, EVIDENCE_STANCES, EVIDENCE_STANCE_LABELS,
  FINDING_CLASSIFICATIONS, FINDING_CLASSIFICATION_LABELS, FINDING_CLASSIFICATIONS_REQUIRING_EVIDENCE
} from './claims.js';
import { ingestFiles, ingestZip } from './ingest/pipeline.js';
import { extractContent } from './ingest/adapters.js';
import { mountDiscoveryPanel, webStorage } from './discovery/panel.js';
import { createProxyFetcher, createArchiveLookup } from './discovery/fetchers.js';
import { mountRecoveryPanel } from './recovery/panel.js';
import * as recoveryStore from './recovery/store.js';
import { buildRecoveryModel } from './recovery/model.js';
import { recoveryHtml } from './recovery/report.js';
import { renderReviewQueuePanel } from './reviewQueue.js';
import { openOverlay, openMenu, confirmDialog } from './ui.js';
import { answerQuestion } from './askRouter.js';
import { buildModel, viewHtml, resolveTarget, VIEWS } from './views.js';
import { answerHeaderHtml, answerFooterHtml, itemHtml } from './askRender.js';
import { readInvestigationForExport } from './portableDb.js';
import { exportInvestigationFile, previewImport, importBundle, describeReport, PortableFileError } from './portable.js';
import { formatCitation, buildFootnotes, CITATION_STYLES, CITATION_STYLE_LABELS } from './citations.js';
import { renderSourceIndex, renderEvidenceTable, renderClaimEvidenceMatrix, renderQuantitativeTable } from './artifacts.js';
import {
  parseAskSourcesCommand, computeDeterministicFact, extractSearchTerms, ADD_TO_TARGETS, CREATE_TARGETS,
  classifyAskAnswer, FACT_STATE_LABELS, parseDepthRequest, DEPTH_LABELS
} from './askCommands.js';
import { discoverSources, summarizeDiscoverCoverage } from './discover.js';

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

const askSourcesAnswer = document.querySelector('#askSourcesAnswer');
const askSourcesProvenance = document.querySelector('#askSourcesProvenance');
const askSourcesComputedFact = document.querySelector('#askSourcesComputedFact');
const askMySourcesHeading = document.querySelector('#askMySourcesHeading');
const askSourcesDiscover = document.querySelector('#askSourcesDiscover');
const askSourcesDiscoverResults = document.querySelector('#askSourcesDiscoverResults');
const askDiscoverCoverage = document.querySelector('#askDiscoverCoverage');
const askSourcesResultActions = document.querySelector('#askSourcesResultActions');
const askAddToMenu = document.querySelector('#askAddToMenu');
const askCreateMenu = document.querySelector('#askCreateMenu');
const askRunAiBtn = document.querySelector('#askRunAiBtn');
const askSourcesStatus = document.querySelector('#askSourcesStatus');
const askSourcesAiResult = document.querySelector('#askSourcesAiResult');
const askSourcesArtifact = document.querySelector('#askSourcesArtifact');
const askSourcesHistoryEl = document.querySelector('#askSourcesHistory');

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
const bulkImportControls = document.querySelector('#bulkImportControls');
const bulkImportPauseBtn = document.querySelector('#bulkImportPauseBtn');
const bulkImportCancelBtn = document.querySelector('#bulkImportCancelBtn');
const bulkImportResumeBtn = document.querySelector('#bulkImportResumeBtn');

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

// Ask Sources: last deterministic result set + the question that produced
// it, so the "Add to.../Create..." menus and the opt-in AI button act on
// exactly what's on screen rather than re-querying.
let lastAskResults = []; // My Sources + Discover Sources, merged - AI/footnotes/citations/mutations read this
let lastAskMyResults = []; // My Sources only - what renderAskSourcesResultsAtDepth re-renders under "My Sources"
let lastAskDiscoverResults = []; // Discover Sources only - re-rendered under "Discovered"
let lastAskDiscoverConnectors = []; // last Discover coverage, for depth re-presentation without re-searching
let lastAskQuestion = '';
let lastAskAiAnswer = ''; // last AI answer text, for follow-up context only - never re-asserted as a fact (Principle #1/#19)
let previousAskQuestion = ''; // the turn before the current one - follow-up context, one turn deep
let previousAskAiAnswer = '';
let lastAskDepth = 'research'; // Adaptive Research Depth (Principle #21) - presentation only, same evidence
let lastBibliographyRecords = [];

// Subjects tab (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 1): last-loaded
// entities/evidence for the active investigation, so form handlers don't
// re-fetch on every keystroke, plus which subject (if any) is currently
// open - driven by the URL (#/workspace/subjects/:entityId), same
// hash-as-state convention as Findings/Evidence sub-tabs.
let lastSubjectsEntities = [];
let lastSubjectsEvidenceItems = [];

// Evidence tab (Phase 2): entities loaded fresh here rather than reused
// from lastSubjectsEntities, so "Link Subject" works correctly even if
// the Subjects tab was never visited this session - the two tabs stay
// independently self-sufficient, not silently order-dependent on each other.
let lastEvidenceEntities = [];

// P0 "Make Investigation Workspace User-Friendly": 4 primary sections
// instead of 9 - a first-time user shouldn't need to understand Sources,
// Outline, Gaps, etc. to upload a document and search it. The visible
// workflow is SEARCH -> FIND RECEIPT -> SAVE EVIDENCE -> FINDING -> REPORT.
// Nothing underneath was deleted - Outline's research question and Gaps'
// coverage lanes moved to the Findings sub-tabs that actually use them
// (see FINDINGS_SUBTABS), and Sources' facet/table browsing moved into
// Research under a "Details"-style disclosure.
const WORKSPACE_TABS = [
  { id: 'bigpicture', label: 'Big Picture', icon: 'icon-grid' },
  { id: 'overview', label: 'Overview', icon: 'icon-timeline' },
  { id: 'deepdive', label: 'Deep Dive', icon: 'icon-file' },
  { id: 'research', label: 'Research', icon: 'icon-search' },
  { id: 'discover', label: 'Find Records', icon: 'icon-file' },
  { id: 'recovery', label: 'Records Recovery', icon: 'icon-flag' },
  { id: 'review', label: 'Review Queue', icon: 'icon-list' },
  { id: 'subjects', label: 'Subjects', icon: 'icon-user' },
  { id: 'evidence', label: 'Evidence', icon: 'icon-flag' },
  { id: 'findings', label: 'Findings', icon: 'icon-bar' },
  { id: 'report', label: 'Report', icon: 'icon-doc-check' }
];
const FINDINGS_SUBTABS = [
  { id: 'claims', label: 'Claims' },
  { id: 'findings', label: 'Findings' },
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
// Exported for public/reviewQueue.js (Phase 4) - the first module in this
// app to need shared UI utilities from app.js rather than the other way
// around, since it's large/interactive enough to own its own DOM wiring
// (see that file's header). Behavior unchanged, just made importable.
export function esc(s = '') { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function attr(s = '') { return esc(s); }
function asUrl(u) { return /^https?:\/\//i.test(u) ? u : `https://${u}`; }
function bucket(m = '') { m = String(m).toLowerCase(); if (m.includes('pdf')) return 'PDF'; if (m.startsWith('image/')) return 'Image'; if (m.includes('html')) return 'Webpage'; if (m.includes('audio')) return 'Audio'; if (m.includes('video')) return 'Video'; return m ? 'Other' : 'Unknown'; }
export function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
export function formatDate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown date';
}
export function showToast(msg, bad = false) {
  clearTimeout(toastTimer);
  toast.setAttribute('role', bad ? 'alert' : 'status'); // errors are announced at once
  toast.setAttribute('aria-live', bad ? 'assertive' : 'polite');
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
  // A Discover Sources hit (mode 'search', not yet in this investigation)
  // with real retrieved content (x.snippet) is evidence-able in one click
  // without a separate "save the source" step first - the button below
  // saves the source AND creates the Evidence Item together, atomically,
  // so an Evidence Item's sourceRecordId is never left pointing at
  // nothing (explicit product requirement: one-click save, but asking
  // about a retrieved source never requires saving it first - saving is
  // only required to turn it into a structured Evidence Item).
  const saveEvidenceAction = x.matchPassage
    ? `<button type="button" class="save-evidence-btn" data-record-id="${attr(x.id)}" data-excerpt="${attr(x.matchPassageRaw || x.matchPassage)}" data-location="${attr(x.matchPage ? 'p.' + x.matchPage : '')}">Save as Evidence</button>`
    : (!x.matchPassage && x.snippet && mode === 'search'
        ? `<button type="button" class="save-discover-evidence-btn" data-key="${attr(canonicalKeyOf(x))}" data-excerpt="${attr(x.snippet.slice(0, 600))}">Save to Investigation as Evidence</button>`
        : '');
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
  } else if (action === 'export-active-investigation') {
    if (!activeInvestigationId) return;
    try {
      const { filename, text } = await exportInvestigationFile(activeInvestigationId);
      downloadTextFile(filename, text);
      showToast('Case file saved. Open it in the Chronium extension or on another device with Import case file.');
    } catch (err) { showToast(`Could not export: ${err.message}`, true); }
  } else if (action === 'import-case-file') {
    document.querySelector('#caseFileInput').click();
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


function downloadTextFile(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Import a .chronium.json case file: always preview first, never overwrite.
document.querySelector('#caseFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { bundle, report } = await previewImport(await file.text());
    const ok = await confirmDialog({ title: 'Import this case?', message: describeReport(report).join('\n'), confirmLabel: 'Import' });
    if (!ok) return;
    const done = await importBundle(bundle);
    showToast(describeReport(done, { done: true })[0]);
    await loadViewContent(parseHash());
  } catch (err) {
    showToast(err instanceof PortableFileError ? err.message : `Import failed: ${err.message}`, true);
  }
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const VIEW_TITLES = { home: 'Chronium Mind', investigations: 'Investigations', library: 'My Library', settings: 'Settings & Help', workspace: 'Workspace' };

// Bookmarks from the earlier version of the workspace. Each old page now lives inside a current tab.
const LEGACY_WORKSPACE_ROUTES = {
  sources: { to: 'research', says: 'Sources are now in Research' },
  outline: { to: 'research', says: 'The outline is now in Research' },
  claims: { to: 'findings/claims', says: 'Claims are now in Findings, Claims' },
  timeline: { to: 'findings/timeline', says: 'The timeline is now in Findings, Timeline' },
  gaps: { to: 'findings/gaps', says: 'Gaps are now in Findings, Gaps' },
  analysis: { to: 'findings/analysis', says: 'Analysis is now in Findings, Analysis' }
};
const KNOWN_WORKSPACE_TABS = new Set(['bigpicture', 'overview', 'deepdive', 'research', 'discover', 'recovery', 'review', 'subjects', 'evidence', 'findings', 'report']);

function parseHash() {
  const path = (location.hash || '#/').slice(1) || '/';
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'workspace') {
    const tab = parts[1] || 'bigpicture';
    const legacy = LEGACY_WORKSPACE_ROUTES[tab];
    if (legacy) { const [t, s] = legacy.to.split('/'); return { view: 'workspace', tab: t, subtab: s || null, arg: null, moved: legacy.says, canonical: `#/workspace/${legacy.to}` }; }
    if (!KNOWN_WORKSPACE_TABS.has(tab)) return { view: 'workspace', tab: 'bigpicture', subtab: null, arg: null, moved: 'That page is not available any more; showing the Big Picture', canonical: '#/workspace/bigpicture' };
    return { view: 'workspace', tab, subtab: parts[2] || null, arg: parts.slice(3).join('/') || null };
  }
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
  // An old bookmark: replace the address with the current one (so the right tab is selected and the link keeps working)
  // and tell the person, politely, what moved.
  if (route.moved) { history.replaceState(null, '', route.canonical); const n = document.querySelector('#routeNotice'); if (n) n.textContent = `${route.moved}.`; }
  else { const n = document.querySelector('#routeNotice'); if (n) n.textContent = ''; }
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  const target = document.querySelector(`#view-${route.view}`);
  target.classList.remove('hidden');
  document.title = `${VIEW_TITLES[route.view] || 'Chronium'} · Chronium Mind`;
  updateNavActiveStates(route);
  await loadViewContent(route);
  window.scrollTo(0, pendingScrollY);
  pendingScrollY = 0;
  target.focus({ preventScroll: true });
  if (pendingFocus) { document.querySelector(pendingFocus)?.focus(); pendingFocus = null; }
}

async function loadViewContent(route) {
  if (route.view === 'home') await renderHomeRecent();
  else if (route.view === 'investigations') await renderInvestigationsView();
  else if (route.view === 'library') await renderLibraryView();
  else if (route.view === 'settings') renderSettingsView();
  else if (route.view === 'workspace') await renderWorkspaceView(route.tab, route.subtab, route.arg);
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
    coverage.innerHTML = renderCoverage(data, libraryHits);
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

// Returns the coverage-summary HTML string (never writes to the DOM
// itself) so both the Home page's universal search and Ask Sources'
// "Discover Sources" layer (public/app.js runAskSourcesQuestion) can
// reuse the exact same Coverage Verdict rendering instead of duplicating
// it - docs/CANON.md "Never Fake Coverage" applies equally to both.
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

  return `${banner}${contradictionCallout}${summary}${grid}${details}`;
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
  // Discover Sources results (Ask Sources, Research tab) live in
  // lastAskResults, not the Home page's `current` array - checked before
  // the expensive full-investigation fallback below.
  const item = current.find((r) => canonicalKeyOf(r) === btn.dataset.key)
    || lastAskResults.find((r) => canonicalKeyOf(r) === btn.dataset.key)
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

// Discover Sources -> Evidence, in one click: saves the discovered
// record into the investigation (dedup-safe by canonical key, same as
// the Home page's save-btn) AND creates the Evidence Item against its
// real new record id, atomically - never leaves an Evidence Item's
// sourceRecordId pointing at a source that was never actually saved.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.save-discover-evidence-btn');
  if (!btn || !activeInvestigationId) return;
  const record = lastAskResults.find((r) => canonicalKeyOf(r) === btn.dataset.key);
  if (!record) { showToast('Could not find this source to save — try asking again.', true); return; }
  btn.disabled = true;
  try {
    const saved = await saveRecordToInvestigation(activeInvestigationId, record);
    savedKeys.add(canonicalKeyOf(record));
    await createEvidenceItem(activeInvestigationId, {
      sourceRecordId: saved.id, excerptType: 'quote', location: '', outlineLaneId: null, excerptText: btn.dataset.excerpt
    });
    btn.textContent = 'Saved to Evidence';
    showToast('Saved this discovered source and passage as Evidence — provenance preserved.');
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
  if (!(await loadFeatures()).viewCapture) return { ok: false, error: 'The in-page archive viewer is switched off right now. Use the archive link to open the capture there.' };
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
    <a class="investigation-card-link" href="#/workspace/bigpicture" data-open-investigation="${attr(inv.id)}">${esc(inv.name)}</a>
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
  location.hash = '#/workspace/bigpicture'; // opening an investigation lands on the Big Picture
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
  const urlInput = document.querySelector('#addUrlInput');
  const urlError = document.querySelector('#addUrlError');
  try {
    await addUserUrl(activeInvestigationId, { url, title: urlTitle, note });
  } catch (err) {
    // Error identified in text, tied to the field (aria-invalid + aria-describedby), announced (role=alert), focus returned to the field.
    urlError.textContent = `That web address could not be added: ${err.message || 'it is not a valid address'}. Check it starts with https:// and try again.`;
    urlError.classList.remove('hidden');
    urlInput.setAttribute('aria-invalid', 'true');
    urlInput.focus();
    return;
  }
  urlError.classList.add('hidden'); urlError.textContent = ''; urlInput.removeAttribute('aria-invalid');
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

// Phase 4: Cancel/Pause controls for a running bulk import
// (docs/INVESTIGATION_WORKSPACE_PLAN.md - "one bad document must not kill
// the batch," and the investigator must be able to stop a large run).
// `pendingResume` remembers enough to offer a genuine Resume for the
// plain-files path (a concrete, indexable array) - re-invoking ingestFiles
// with the remaining slice against the SAME batch id. Zip imports are
// streamed and can't be resumed from an arbitrary position - Pause on a
// zip behaves as Cancel there (documented limitation, see pipeline.js).
let importControl = null;
let pendingResume = null;

async function runImport(items) {
  if (!activeInvestigationId || !items.length) return;
  const preserveOriginals = preserveOriginalsCheckbox.checked;
  bulkImportProgress.classList.remove('hidden');
  bulkImportProgress.textContent = 'Starting import…';
  bulkImportControls.classList.remove('hidden');
  bulkImportResumeBtn.classList.add('hidden');
  importControl = { cancelled: false, paused: false };
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
      ? await ingestZip(first instanceof File ? first : first.file, activeInvestigationId, onProgress, { preserveOriginals, control: importControl })
      : await ingestFiles(items, activeInvestigationId, onProgress, { preserveOriginals, control: importControl });

    savedKeys = await getSavedCanonicalKeys(activeInvestigationId);
    bulkImportControls.classList.add('hidden');

    if (batch.status === 'PAUSED' && !isSingleZip) {
      pendingResume = { items, investigationId: activeInvestigationId, batchId: batch.id, preserveOriginals, processedCount: batch.processedCount };
      bulkImportProgress.textContent = `Paused after ${batch.processedCount} of ${items.length} files.`;
      bulkImportResumeBtn.classList.remove('hidden');
      bulkImportControls.classList.remove('hidden');
      setAddResearchStatus(`Import paused after ${batch.processedCount} of ${items.length} files. Click Resume to continue, or close this dialog and resume later from the Review Queue tab.`);
      return;
    }
    if (batch.status === 'CANCELLED' || (batch.status === 'PAUSED' && isSingleZip)) {
      bulkImportProgress.classList.add('hidden');
      setAddResearchStatus(`Import cancelled after ${batch.processedCount} file${batch.processedCount === 1 ? '' : 's'}. What was already processed is saved.`);
      await renderWorkspaceView('research');
      return;
    }

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
    bulkImportControls.classList.add('hidden');
    setAddResearchStatus(`Import failed: ${err.message}`, true);
  }
}

bulkImportPauseBtn.addEventListener('click', () => { if (importControl) importControl.paused = true; });
bulkImportCancelBtn.addEventListener('click', () => { if (importControl) importControl.cancelled = true; });
bulkImportResumeBtn.addEventListener('click', async () => {
  if (!pendingResume) return;
  const { items, investigationId, batchId, preserveOriginals, processedCount } = pendingResume;
  const remaining = items.slice(processedCount);
  pendingResume = null;
  bulkImportResumeBtn.classList.add('hidden');
  bulkImportProgress.classList.remove('hidden');
  bulkImportProgress.textContent = 'Resuming…';
  bulkImportControls.classList.remove('hidden');
  importControl = { cancelled: false, paused: false };
  try {
    const batch = await ingestFiles(remaining, investigationId, (p) => {
      bulkImportProgress.textContent = `Processed ${p.processed} files (resumed) — current: ${p.current}`;
    }, { preserveOriginals, existingBatchId: batchId, control: importControl });
    savedKeys = await getSavedCanonicalKeys(activeInvestigationId);
    bulkImportControls.classList.add('hidden');
    if (batch.status === 'PAUSED') {
      pendingResume = { items, investigationId, batchId, preserveOriginals, processedCount: batch.processedCount };
      bulkImportProgress.textContent = `Paused after ${batch.processedCount} of ${items.length} files.`;
      bulkImportResumeBtn.classList.remove('hidden');
      bulkImportControls.classList.remove('hidden');
      return;
    }
    bulkImportProgress.classList.add('hidden');
    setAddResearchStatus(`Imported ${batch.fileCount} file${batch.fileCount === 1 ? '' : 's'} total (${formatBytes(batch.byteTotal)}).`);
    closeDialog('addResearchDialog');
    location.hash = '#/workspace/research';
    await renderWorkspaceView('research');
  } catch (err) {
    bulkImportControls.classList.add('hidden');
    setAddResearchStatus(`Resume failed: ${err.message}`, true);
  }
});

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
  lastAskResults = []; lastAskMyResults = []; lastAskDiscoverResults = []; lastAskDiscoverConnectors = [];
  lastAskQuestion = ''; lastAskAiAnswer = ''; previousAskQuestion = ''; previousAskAiAnswer = ''; // never carry Ask Sources context across investigations
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


// ---------------------------------------------------------------------------
// Investigation views: Big Picture / Overview / Deep Dive (public/views.js).
// Three presentations of the same snapshot; nothing is stored separately.
// ---------------------------------------------------------------------------
let pendingScrollY = 0;
let pendingFocus = null;
const viewScroll = {};          // per-view scroll position, so switching views keeps your place
let viewBefore = 'bigpicture';  // the view a Deep Dive link was followed from (for "Back")
const VIEW_LABEL = Object.fromEntries(VIEWS.map((v) => [v.id, v.label]));

function rememberViewScroll() {
  const tab = parseHash().tab;
  if (VIEWS.some((v) => v.id === tab)) {
    viewScroll[tab] = window.scrollY;
    if (tab !== 'deepdive') viewBefore = tab;
  }
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-goto], #workspaceTabStrip button')) rememberViewScroll();
}, true);

async function renderInvestigationView(tab, target, inv) {
  const body = document.querySelector(`#viewBody-${tab}`);
  const crumbs = document.querySelector(`#viewCrumbs-${tab}`);
  body.innerHTML = '<p class="status" role="status">Loading…</p>';
  let model;
  try {
    const snapshot = await readInvestigationForExport(activeInvestigationId);
    model = buildModel(snapshot);
    // Records Recovery is derived from the same snapshot; if it cannot be computed the views still work.
    try { model.recovery = buildRecoveryModel(snapshot); } catch { model.recovery = null; }
  } catch (err) {
    body.innerHTML = `<p class="status status-bad" role="alert">Could not load this investigation: ${esc(err.message)}</p>`;
    return;
  }
  const t = tab === 'deepdive' && target ? resolveTarget(model, target) : null;
  const here = `<li${t ? '' : ' aria-current="page"'}>${tab === 'deepdive' && t ? `<a href="#/workspace/deepdive">${VIEW_LABEL[tab]}</a>` : esc(VIEW_LABEL[tab])}</li>`;
  crumbs.innerHTML = `<ol class="vw-crumb-list"><li><a href="#/investigations">My Research</a></li><li>${esc(inv?.name || 'Investigation')}</li>${here}${t ? `<li aria-current="page">${esc(t.title.slice(0, 60))}</li>` : ''}</ol>${tab === 'deepdive' && t ? `<a class="btn btn-small" data-goto="${viewBefore}" href="#/workspace/${viewBefore}">← Back to ${esc(VIEW_LABEL[viewBefore])}</a>` : ''}`;
  body.innerHTML = viewHtml(tab, model, target);
  if (tab === 'deepdive' && target && t) pendingFocus = '#howWeKnow';
  else pendingScrollY = viewScroll[tab] || 0;
}

// Records Recovery: mounted once so a request being corrected survives a trip to another tab.
let recoveryPanel = null;
function renderRecoveryPanel() {
  if (!recoveryPanel) {
    recoveryPanel = mountRecoveryPanel(document.querySelector('#recoveryMount'), {
      getInvestigationId: () => activeInvestigationId,
      store: recoveryStore,
      getPerson: () => { try { return localStorage.getItem('chronium.person') || ''; } catch { return ''; } },
      setPerson: (n) => { try { localStorage.setItem('chronium.person', n); } catch { /* storage blocked */ } },
      onChange: () => { lastDashboardData = null; }
    });
  } else recoveryPanel.refresh();
}

// Deep Discovery (Find Records): mounted once so a search keeps running while you look at other tabs.
let discoveryPanel = null;
// Which server features are switched on. The Worker enforces the same switches, so this only decides what to show.
let featuresPromise = null;
function loadFeatures() {
  featuresPromise ||= fetch('/api/features').then((r) => (r.ok ? r.json() : { features: {} })).then((d) => d.features || {}).catch(() => ({}));
  return featuresPromise;
}
// Plain-language reasons for the server's refusals.
function apiErrorMessage(res, data, fallback) {
  const code = data && data.error;
  const text = { 'not-available': 'This feature is switched off right now.', 'daily-limit': 'You have reached today\'s limit for this feature. Try again tomorrow.', 'unavailable-today': 'This feature is unavailable for the rest of today.', 'rate-limited': 'Too many requests. Wait a minute and try again.', 'protection-unavailable': 'This feature is temporarily unavailable.', 'unsafe-configuration': 'This feature is temporarily unavailable.', 'caller-not-allowed': 'Reload the page and try again.', busy: 'The server is busy. Try again in a few seconds.', 'too-large': 'That request is too large.' }[code];
  return text || (typeof code === 'string' && code.length < 120 ? code : fallback);
}

async function renderDiscoverPanel(inv) {
  const mount = document.querySelector('#discoveryMount');
  if (!discoveryPanel) {
    const features = await loadFeatures();
    if (discoveryPanel) return; // another call finished first
    // Test-only options (a local test site, no waiting). Honoured only when this page itself is served from the local machine.
    const t = (['127.0.0.1', 'localhost'].includes(location.hostname) && window.__chroniumDiscoveryTest) || {};
    discoveryPanel = mountDiscoveryPanel(mount, {
      mode: 'website', guardOptions: t.guardOptions, limits: t.limits,
      getInvestigation: () => (activeInvestigationId ? { id: activeInvestigationId, name: document.querySelector('#workspaceTitle').textContent || 'Investigation' } : null),
      makeFetcher: () => createProxyFetcher({ base: '' }),
      archiveLookup: features.discoveryCaptures ? createArchiveLookup({ base: '' }) : null,
      unavailableMessage: features.discoveryFetch ? null : 'Searching a website from the website is not switched on right now. The Chronium browser extension does not need this and can search directly. Your cases and documents you add yourself are not affected.',
      requestAccess: async () => true,
      extract: extractContent,
      budgetStorage: webStorage(),
      listRuns: listDiscoveryRuns,
      listLedger: listDiscoveryLedger,
      onSaved: async () => { savedKeys = activeInvestigationId ? await getSavedCanonicalKeys(activeInvestigationId) : new Set(); lastDashboardData = null; }
    });
  } else discoveryPanel.refresh();
}

async function renderWorkspaceView(tab, subtab, arg) {
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

  if (VIEWS.some((v) => v.id === tab)) {
    await renderInvestigationView(tab, subtab && arg ? `${subtab}/${arg}` : null, inv);
  } else if (tab === 'research') {
    await refreshWorkspaceData();
    renderOverviewPanel();
    renderSourcesPanel();
    await renderOutlinePanel();
    askSourcesAnswer.classList.add('hidden');
    investigationQuery.value = '';
    await renderAskSourcesHistory();
  } else if (tab === 'discover') {
    await renderDiscoverPanel(inv);
  } else if (tab === 'recovery') {
    renderRecoveryPanel();
  } else if (tab === 'review') {
    await renderReviewQueuePanel(activeInvestigationId);
  } else if (tab === 'subjects') {
    await renderSubjectsPanel(subtab || null);
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
    else if (activeSubtab === 'findings') await renderFindingsPanel();
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

// ---------------------------------------------------------------------------
// Ask Sources (Research tab): a conversational front end over the same
// structured investigation state, source-first and deterministic-first per
// docs/CANON.md's "AI/Agents Are Last Resort" rule. A typed question is
// routed by parseAskSourcesCommand (public/askCommands.js) to one of:
//   search        - deterministic searchInvestigation() + a Computed Fact
//                    line, rendered with the existing resultRow() cards
//                    (Source Fact layer - no new rendering code needed)
//   create         - render/jump to one of the artifact views (§ below)
//   add-to         - a narrow, deterministic mutation (evidence/outline/claim)
//   exclude-from-report - toggles a Claim's excludedFromReport flag
// AI only ever enters via the explicit "Analyze with AI" button below, and
// only over the passages already found deterministically - never the
// trigger for search, artifacts, citations, or any mutation.
// ---------------------------------------------------------------------------
askAddToMenu.innerHTML = ADD_TO_TARGETS.map((t) => `<li role="none"><button type="button" role="menuitem" class="menu-item" data-add-to="${attr(t.id)}">${esc(t.label)}</button></li>`).join('');
askCreateMenu.innerHTML = CREATE_TARGETS.map((t) => `<li role="none"><button type="button" role="menuitem" class="menu-item" data-create="${attr(t.id)}">${esc(t.label)}</button></li>`).join('');

investigationSearchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeInvestigationId) return;
  const q = investigationQuery.value.trim();
  if (!q) { askSourcesAnswer.classList.add('hidden'); return; }
  await runAskSourcesQuestion(q);
});


// ---------------------------------------------------------------------------
// Ask Chronium (deterministic question router) - see public/askRouter.js
// ---------------------------------------------------------------------------
const askRouterBox = document.querySelector('#askRouterBox');
let askChroniumContext = {};
let askChroniumLastIntent = '';

async function tryAskChronium(q) {
  askRouterBox.classList.add('hidden');
  askRouterBox.innerHTML = '';
  askSourcesAnswer.removeAttribute('data-intent');
  askSourcesAnswer.removeAttribute('data-state');
  let answer;
  try {
    const snapshot = await readInvestigationForExport(activeInvestigationId);
    answer = snapshot ? answerQuestion(q, snapshot, askChroniumContext) : null;
  } catch (err) {
    console.error('Ask Chronium router failed; falling back to document search', err);
    return false;
  }
  if (!answer) return false;
  askChroniumContext = { ...askChroniumContext, ...answer.context };
  askChroniumLastIntent = answer.intent;
  askSourcesAnswer.dataset.intent = answer.intent;
  askSourcesAnswer.dataset.state = answer.state;
  askSourcesProvenance.textContent = `${answer.title}. ${answer.summary}`;
  askRouterBox.innerHTML = answerHeaderHtml(answer) + answerFooterHtml(answer);
  askRouterBox.classList.remove('hidden');
  investigationSearchResults.innerHTML = answer.items.map(itemHtml).join('');
  askMySourcesHeading.classList.toggle('hidden', !answer.items.length);
  askSourcesStatus.textContent = answer.state === 'NEEDS_CLARIFICATION' ? 'Chronium needs one more detail before it can answer.' : `Answer ready: ${answer.title}`;
  await appendAskHistory(q, 'router:' + answer.intent, answer.title, null);
  return true;
}

// Clarification buttons re-ask with the chosen detail.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ask-followup]');
  if (!b) return;
  const input = document.querySelector('#investigationQuery');
  input.value = b.dataset.askFollowup;
  document.querySelector('#investigationSearchForm').requestSubmit();
});

async function runAskSourcesQuestion(q) {
  // Principle #1 ("Conversation First"): follow-up questions must
  // understand conversation context - captured before lastAskQuestion is
  // overwritten below, so "compare that with 2021" can fall back to the
  // previous question's topic, and the AI call can resolve "why did it
  // change" against what was just discussed. One turn of context only -
  // Ask Sources stays single-turn/stateless beyond that (confirmed scope).
  const priorQuestion = lastAskQuestion;

  // Adaptive Research Depth (Principle #21): a pure re-presentation
  // request ("now give me the professional version with footnotes")
  // re-renders the SAME lastAskResults at a new depth - no re-search, no
  // new AI call, same evidence/provenance, only the view changes.
  const depthReq = parseDepthRequest(q);
  if (depthReq.depth && depthReq.isRepresentOnly && lastAskResults.length) {
    lastAskDepth = depthReq.depth;
    askSourcesAnswer.classList.remove('hidden');
    renderAskSourcesResultsAtDepth(lastAskMyResults, lastAskDiscoverResults, lastAskDiscoverConnectors, lastAskDepth);
    askSourcesStatus.textContent = `Showing the same research at ${DEPTH_LABELS[lastAskDepth]} depth — same evidence, same provenance, only the presentation changed.`;
    await appendAskHistory(q, 'depth:' + lastAskDepth, `Re-presented previous answer at ${DEPTH_LABELS[lastAskDepth]} depth`, null);
    return;
  }
  lastAskDepth = depthReq.depth || 'research';

  previousAskQuestion = priorQuestion;
  previousAskAiAnswer = lastAskAiAnswer;
  lastAskQuestion = q;
  lastAskAiAnswer = '';
  const cmd = parseAskSourcesCommand(q);

  askSourcesAnswer.classList.remove('hidden');
  askSourcesAiResult.innerHTML = '';
  askSourcesArtifact.innerHTML = '';
  askSourcesStatus.textContent = '';
  investigationSearchResults.innerHTML = '';
  askSourcesProvenance.innerHTML = '';
  askSourcesComputedFact.classList.add('hidden');
  askSourcesComputedFact.textContent = '';
  askMySourcesHeading.classList.add('hidden');
  askSourcesDiscover.classList.add('hidden');
  askSourcesDiscoverResults.innerHTML = '';
  askDiscoverCoverage.textContent = '';
  askSourcesResultActions.classList.add('hidden');
  clearAskSourcesFootnotes();

  if (cmd.intent === 'leads') {
    await handleLeadsIntent();
    await appendAskHistory(q, 'leads', 'Investigative leads shown', null);
    return;
  }
  if (cmd.intent === 'unresolved') {
    await handleUnresolvedIntent();
    await appendAskHistory(q, 'unresolved', 'Unresolved items shown', null);
    return;
  }
  if (cmd.intent === 'create' || cmd.intent === 'clarify-table') {
    await handleCreateIntent(cmd, q);
    await appendAskHistory(q, cmd.intent, cmd.target ? `Created/opened: ${cmd.target.replace(/-/g, ' ')}` : 'Asked which table to build');
    return;
  }
  if (cmd.intent === 'add-to') {
    await runAskSourcesAddTo(cmd.target);
    return;
  }
  if (cmd.intent === 'exclude-from-report') {
    await handleExcludeFromReport(q);
    return;
  }

  // Ask Chronium: investigative-intent questions (claims, contradictions,
  // relationships, payments, before/after, progress...) are answered from the
  // investigation's own structured data by public/askRouter.js. Anything it
  // does not recognise as such falls through to ranked document search below.
  if (await tryAskChronium(q)) return;

  // Deterministic search - the Source Fact layer, over My Sources first
  // (docs/CANON.md Product Principles: search priority is existing
  // investigation evidence before external discovery). A follow-up like
  // "compare that with 2021" often has too few terms of its own to match
  // anything on its own - if the question alone finds nothing and there
  // was a previous question this turn, retry once with both questions'
  // terms combined before giving up (still plain deterministic
  // substring search, no AI involved in this fallback).
  let terms = extractSearchTerms(q);
  // If a depth cue was detected (e.g. "explain it simply") and every word
  // was stripped as filler, extractSearchTerms's raw-question fallback
  // would hand the literal filler words ("it") back to searchInvestigation
  // as substring-match terms - a false-positive flood, not "no results."
  // Treat a contextless bare depth request as having nothing to search,
  // never a noisy guess (Principle #17, Never Fake Coverage).
  const isBareDepthPhrase = depthReq.depth && terms.trim().toLowerCase() === q.trim().toLowerCase();
  let myResults = isBareDepthPhrase ? [] : await searchInvestigation(activeInvestigationId, terms, 50);
  let usedFollowUpContext = false;
  if (!myResults.length && priorQuestion && !isBareDepthPhrase) {
    const combinedTerms = extractSearchTerms(`${priorQuestion} ${q}`);
    if (combinedTerms !== terms) {
      const combinedResults = await searchInvestigation(activeInvestigationId, combinedTerms, 50);
      if (combinedResults.length) { myResults = combinedResults; usedFollowUpContext = true; terms = combinedTerms; }
    }
  }

  // Discover Sources (public/discover.js): search outward - current web,
  // historical archives, public datasets - through the provider-neutral
  // seam, never a hard-wired endpoint call here. Runs whenever there's a
  // real topic to search; never for a bare depth phrase. A Discover
  // failure never breaks the answer - it just means nothing came back
  // externally this time, reported honestly, not silently swallowed.
  let discoverResults = [];
  let discoverConnectors = [];
  let discoverMode = 'topic';
  if (!isBareDepthPhrase && terms.trim()) {
    try {
      const discovered = await discoverSources(terms, { limit: 25 });
      discoverConnectors = discovered.connectors;
      discoverMode = discovered.mode;
      // Dedup by canonical key (URL/content identity) against what's
      // already in this investigation - a source already saved shows up
      // in "My Sources" above, never duplicated as "newly discovered."
      const myKeys = new Set([...savedKeys, ...myResults.map((r) => canonicalKeyOf(r))]);
      discoverResults = discovered.results
        .filter((r) => !myKeys.has(canonicalKeyOf(r)))
        .sort((a, b) => authorityRank(a) - authorityRank(b)); // primary/authoritative & archived-primary first
    } catch (err) {
      discoverConnectors = [{ source: 'Discover Sources', kind: 'discover', verdict: 'provider-unavailable', error: err.message }];
    }
  }

  lastAskResults = [...myResults, ...discoverResults];
  lastAskMyResults = myResults;
  lastAskDiscoverResults = discoverResults;
  lastAskDiscoverConnectors = discoverConnectors;
  renderAskSourcesResultsAtDepth(myResults, discoverResults, discoverConnectors, lastAskDepth);

  const sourceCount = new Set(myResults.map((r) => r.id)).size;
  const passageCount = myResults.filter((r) => passageTextOf(r)).length;
  const discoverCount = discoverResults.length;
  // Product Principles #11: every answer is labeled one of five states -
  // never left implicit, never silently blurred into another. Discovery
  // alone is never "Confirmed" - see classifyAskAnswer.
  const factState = classifyAskAnswer({ passageCount, sourceCount, discoverCount });
  const badge = `<span class="fact-badge fact-badge-${factState}">${esc(FACT_STATE_LABELS[factState])}</span> `;
  const depthNote = lastAskDepth !== 'research' ? ` · ${DEPTH_LABELS[lastAskDepth]} depth` : '';
  const discoverNote = discoverCount ? ` · ${discoverCount} discovered externally` : '';
  if (myResults.length || discoverCount) {
    askSourcesProvenance.innerHTML = `${badge}Answered from ${sourceCount} source${sourceCount === 1 ? '' : 's'} · ${passageCount} passage${passageCount === 1 ? '' : 's'}${discoverNote}${usedFollowUpContext ? ' · using context from your previous question' : ''}${depthNote}`;
  } else {
    // Unresolved must say WHERE Chronium searched, not just "no results"
    // (explicit product requirement + Principle #17, Never Fake Coverage).
    askSourcesProvenance.innerHTML = `${badge}No matches in your sources for this question. ${describeSearchCoverage(discoverConnectors, discoverMode)}`;
  }

  const computed = computeDeterministicFact(q, myResults);
  if (computed) { askSourcesComputedFact.classList.remove('hidden'); askSourcesComputedFact.textContent = computed; }

  askSourcesResultActions.classList.toggle('hidden', myResults.length === 0 && discoverCount === 0);
  askRunAiBtn.disabled = lastAskResults.filter((r) => passageTextOf(r)).length === 0;
  askRunAiBtn.textContent = 'Analyze with AI';

  await appendAskHistory(q, 'search',
    (myResults.length || discoverCount)
      ? `${sourceCount} source${sourceCount === 1 ? '' : 's'}, ${passageCount} passage${passageCount === 1 ? '' : 's'}${discoverCount ? `, ${discoverCount} discovered externally` : ''}`
      : 'No matches anywhere searched',
    null, factState);
}

// A source already retrieved with real content (a matched passage, or an
// external connector's own full-text snippet) is citable/analyzable
// immediately - saving to the investigation is never a precondition
// (explicit product requirement). Uniform across My Sources and Discover
// Sources so the rest of Ask Sources doesn't need to know which is which.
function passageTextOf(r) { return r.matchPassageRaw || r.matchPassage || r.snippet || null; }

// Search priority (explicit product requirement): primary/authoritative
// sources and archived primary captures before other discovered results.
// A light, honest, deterministic heuristic over real fields - never a
// fabricated reliability score.
function authorityRank(r) {
  const host = hostnameOf(r.originalUrl || r.archiveUrl || '');
  if (/\.(gov|mil)$/.test(host)) return 0;
  if (r.sourceKind === 'archive-connector') return 1;
  return 2;
}

function renderDiscoverSection(shownResults, connectors, totalCount) {
  if (!shownResults.length) {
    askSourcesDiscover.classList.add('hidden');
    askSourcesDiscoverResults.innerHTML = '';
    askDiscoverCoverage.textContent = '';
    return;
  }
  askSourcesDiscover.classList.remove('hidden');
  const restNote = totalCount > shownResults.length
    ? `<p class="hint">+${totalCount - shownResults.length} more discovered — ask "give me everything" for the full list.</p>` : '';
  askSourcesDiscoverResults.innerHTML = shownResults.map((r) => resultRow(r, 'search')).join('') + restNote;
  const { found } = summarizeDiscoverCoverage(connectors);
  askDiscoverCoverage.textContent = found.length ? `via ${found.map((c) => c.source).join(', ')}` : '';
}

// Unresolved (Product Principles #11/#12 + explicit product requirement):
// must name which source groups were searched, which were unavailable,
// and what wasn't searched at all - never a bare "nothing found."
function describeSearchCoverage(connectors, mode) {
  const { found, noMatch, unavailable } = summarizeDiscoverCoverage(connectors);
  const bits = ['Searched: your sources.'];
  if (found.length) bits.push(`Also found matches at ${found.map((c) => c.source).join(', ')} (see Discovered above, or this may already be in your sources).`);
  if (noMatch.length) bits.push(`No matches at: ${noMatch.map((c) => c.source).join(', ')}.`);
  if (unavailable.length) bits.push(`Unavailable right now (coverage unknown, not confirmed absent): ${unavailable.map((c) => c.source).join(', ')}.`);
  if (mode === 'topic') bits.push('Not searched: Wayback and Common Crawl only search by a specific page URL, not a topic — ask about a specific URL to check those too.');
  return bits.join(' ');
}

// Adaptive Research Depth (Principle #21): same two result arrays (My
// Sources, Discover Sources), same resultRow() markup, just how much of
// each is shown and whether a Footnotes block is appended - not four
// separate research engines. Takes both arrays explicitly (rather than
// reading module state) so it works identically whether called right
// after a fresh search or when re-presenting a past turn at a new depth.
function renderAskSourcesResultsAtDepth(myResults, discoverResults, discoverConnectors, depth) {
  investigationSearchResults.classList.toggle('depth-explain', depth === 'explain');
  const cap = depth === 'quick' ? 1 : depth === 'explain' ? 3 : Infinity;
  const shownMy = myResults.slice(0, cap);
  const shownDiscover = discoverResults.slice(0, cap);
  askMySourcesHeading.classList.toggle('hidden', myResults.length === 0);
  const restNote = myResults.length > shownMy.length
    ? `<p class="hint">+${myResults.length - shownMy.length} more source${myResults.length - shownMy.length === 1 ? '' : 's'} — ask "give me everything" for the full list.</p>` : '';
  investigationSearchResults.innerHTML = shownMy.map((r) => resultRow(r, 'library')).join('') + restNote;
  renderDiscoverSection(shownDiscover, discoverConnectors, discoverResults.length);
  // Footnotes cover everything citable this turn - My Sources AND
  // Discover Sources - a discovered-but-unsaved source is fully citable
  // (explicit product requirement). Uses the full (untruncated) sets, not
  // just what's visually shown at this depth.
  if (depth === 'professional') renderAskSourcesFootnotes([...myResults, ...discoverResults]); else clearAskSourcesFootnotes();
}

function clearAskSourcesFootnotes() {
  const el = document.querySelector('#askSourcesFootnotes');
  if (el) el.innerHTML = '';
}

// Citations/Footnotes (Principle #14): built once from stored source
// metadata via public/citations.js - never invented, never AI-authored.
function renderAskSourcesFootnotes(results) {
  const container = document.querySelector('#askSourcesFootnotes');
  if (!container) return;
  const seen = new Set();
  const records = results.filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
  if (!records.length) { container.innerHTML = ''; return; }
  const locById = new Map(results.filter((r) => passageTextOf(r)).map((r) => [r.id, r.matchPage ? `p.${r.matchPage}` : '']));
  const { list } = buildFootnotes(records, 'chicago', (r) => locById.get(r.id) || '');
  container.innerHTML = `<div class="panel"><h2>Footnotes</h2><ol class="report-list">${list.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ol></div>`;
}

// "What don't we know?" - Unresolved: outline gaps + past questions Ask
// Sources genuinely couldn't answer (Product Principles #11/#12).
async function handleUnresolvedIntent() {
  const [outline, evidenceItems, history] = await Promise.all([
    getOutline(activeInvestigationId),
    listEvidenceItems(activeInvestigationId),
    listAskSourcesHistory(activeInvestigationId)
  ]);
  const gapWarnings = computeGapWarnings(outline, evidenceItems);
  const unresolvedQuestions = history.filter((h) => h.factState === 'unresolved' && h.question !== lastAskQuestion);
  const gapItems = gapWarnings.map(({ lane, count, reason }) => `<li><strong>${esc(lane.label)}</strong> — ${reason === 'unconfirmed-answered' ? 'marked answered but no evidence linked' : count === 0 ? 'no evidence linked yet' : `only ${count} evidence item${count === 1 ? '' : 's'} linked`}.</li>`).join('');
  const questionItems = unresolvedQuestions.slice(0, 15).map((h) => `<li>“${esc(h.question)}”${h.aiAnswer ? ' — ' + esc(h.aiAnswer.slice(0, 140)) : ''}</li>`).join('');
  askSourcesArtifact.innerHTML = `<div class="panel">
    <h2>What we don't know yet <span class="fact-badge fact-badge-unresolved">${esc(FACT_STATE_LABELS.unresolved)}</span></h2>
    <p class="view-subtitle">Evidence is insufficient or conflicting here — this is a status, not a conclusion (docs/CANON.md Product Principles #12: absence of a record is not proof of anything).</p>
    ${gapItems ? `<h3 style="margin:14px 0 6px;font-size:13px">Research outline gaps</h3><ul class="report-list">${gapItems}</ul>` : ''}
    ${questionItems ? `<h3 style="margin:14px 0 6px;font-size:13px">Questions Ask Sources couldn't answer</h3><ul class="report-list">${questionItems}</ul>` : ''}
    ${!gapItems && !questionItems ? '<p class="status">Nothing unresolved yet — no outline gaps, and every question asked so far was answerable from your sources.</p>' : ''}
  </div>`;
}

// "What should I investigate next?" - Investigative Leads: least-covered
// outline sections first, plus past questions that matched sources by
// topic but never confirmed an exact passage. Prioritized deterministically
// (weakest coverage first), never by AI guesswork.
async function handleLeadsIntent() {
  const [outline, evidenceItems, history] = await Promise.all([
    getOutline(activeInvestigationId),
    listEvidenceItems(activeInvestigationId),
    listAskSourcesHistory(activeInvestigationId)
  ]);
  const lanes = (outline.lanes || []).filter((l) => l.status !== 'answered')
    .map((l) => ({ lane: l, count: evidenceItems.filter((e) => e.outlineLaneId === l.id).length }))
    .sort((a, b) => a.count - b.count || (a.lane.coveragePct ?? 0) - (b.lane.coveragePct ?? 0));
  const leadQuestions = history.filter((h) => h.factState === 'lead' && h.question !== lastAskQuestion);
  const laneItems = lanes.slice(0, 10).map(({ lane, count }) => `<li><strong>${esc(lane.label)}</strong> — ${count} evidence item${count === 1 ? '' : 's'} so far${lane.coveragePct != null ? `, ~${lane.coveragePct}% coverage` : ''}.</li>`).join('');
  const questionItems = leadQuestions.slice(0, 15).map((h) => `<li>“${esc(h.question)}” — sources matched by topic, no confirmed passage yet.</li>`).join('');
  askSourcesArtifact.innerHTML = `<div class="panel">
    <h2>What to investigate next <span class="fact-badge fact-badge-lead">${esc(FACT_STATE_LABELS.lead)}</span></h2>
    <p class="view-subtitle">Worth pursuing, not yet established — prioritized by weakest coverage first, never a conclusion.</p>
    ${laneItems ? `<h3 style="margin:14px 0 6px;font-size:13px">Least-covered outline sections</h3><ul class="report-list">${laneItems}</ul>` : ''}
    ${questionItems ? `<h3 style="margin:14px 0 6px;font-size:13px">Leads from past questions</h3><ul class="report-list">${questionItems}</ul>` : ''}
    ${!laneItems && !questionItems ? '<p class="status">No leads yet — add a research outline section, or ask a few questions, to surface some.</p>' : ''}
  </div>`;
}

askRunAiBtn.addEventListener('click', async () => {
  // My Sources AND Discover Sources - a discovered-but-unsaved source is
  // analyzable immediately, saving is never a precondition (explicit
  // product requirement). passageTextOf() is the uniform accessor across
  // both origins (matched passage vs. a connector's own full-text snippet).
  const passages = lastAskResults.filter((r) => passageTextOf(r)).map((r) => ({
    id: r.id, sourceRecordId: r.id, excerptText: passageTextOf(r), location: r.matchPage ? `p.${r.matchPage}` : ''
  }));
  if (!passages.length) return;
  askRunAiBtn.disabled = true;
  askRunAiBtn.textContent = 'Analyzing…';
  askSourcesStatus.textContent = 'Sending matched passages for AI analysis…';
  try {
    const res = await fetch('/api/analyze/ask-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: lastAskQuestion, passages, previousQuestion: previousAskQuestion, previousAnswer: previousAskAiAnswer })
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(apiErrorMessage(res, data, 'Analysis failed.'));
    if (data.skipped) { askSourcesStatus.textContent = data.reason; return; }
    renderAskSourcesAiResult(data.result, passages);
    if (data.result && !data.result.insufficient && !data.result.parseError) lastAskAiAnswer = data.result.answer || '';
    askSourcesStatus.textContent = `${data.cached ? 'Loaded a recent analysis' : 'Analysis complete'} (${data.model || 'AI'}).${data.truncated ? ' Based on a subset of matched passages — the full set was too large for one pass.' : ''}`;
    const aiFactState = classifyAskAnswer({ passageCount: passages.length, sourceCount: passages.length, aiResult: data.result });
    await appendAskHistory(lastAskQuestion, 'ai-analysis', null, data.result?.answer || data.result?.missing || null, aiFactState);
  } catch (err) {
    askSourcesStatus.textContent = err.message;
    showToast(err.message, true);
  } finally {
    askRunAiBtn.disabled = false;
    askRunAiBtn.textContent = 'Re-analyze with AI';
  }
});

function renderAskSourcesAiResult(result, passages) {
  const byId = new Map(passages.map((p) => [p.id, p]));
  if (result.parseError) {
    askSourcesAiResult.innerHTML = `<div class="panel"><p class="hint">The AI's response didn't come back in the expected format — showing it as-is.</p><p>${esc(result.answer || '')}</p></div>`;
    return;
  }
  if (result.insufficient) {
    askSourcesAiResult.innerHTML = `<div class="panel"><h2>Answer <span class="fact-badge fact-badge-unresolved">${esc(FACT_STATE_LABELS.unresolved)}</span></h2><p class="view-subtitle">The matched passages don't contain enough to answer this — AI never guesses past what's in your sources.</p><p class="hint">${esc(result.missing || 'More sources may be needed.')}</p></div>`;
    return;
  }
  const cited = (result.citedPassageIds || []).map((id) => byId.get(id)).filter(Boolean);
  const citeList = cited.map((p) => `<li>${esc(p.excerptText.slice(0, 140))}${p.excerptText.length > 140 ? '…' : ''}</li>`).join('');
  askSourcesAiResult.innerHTML = `<div class="panel">
    <h2>Answer <span class="fact-badge fact-badge-ai-analysis">${esc(FACT_STATE_LABELS['ai-analysis'])}</span></h2>
    <p class="view-subtitle">This is AI interpretation of your matched sources, not established fact — every sentence cites the passage it's based on.</p>
    <p>${esc(result.answer)}</p>
    ${citeList ? `<p class="hint">AI-assisted analysis based on ${cited.length} cited passage${cited.length === 1 ? '' : 's'}</p><ul class="claim-card-links">${citeList}</ul>` : ''}
  </div>`;
}

// "Add to..." - shared by the menu and typed commands like "add this to the
// outline" / "put that in the report". Every branch echoes exactly what it
// did (never a silent mutation) and only fires against an unambiguous
// target: the current Ask Sources result set.
async function runAskSourcesAddTo(target) {
  if (!lastAskResults.length) { askSourcesStatus.textContent = 'Ask a question with matching sources first, then use Add to…'; return; }
  const passageResults = lastAskResults.filter((r) => r.matchPassage);
  if (target === 'evidence') {
    if (!passageResults.length) { askSourcesStatus.textContent = 'No passage-level match to save as evidence — try a more specific question.'; return; }
    for (const r of passageResults) {
      await createEvidenceItem(activeInvestigationId, { sourceRecordId: r.id, excerptType: 'quote', location: r.matchPage ? `p.${r.matchPage}` : '', outlineLaneId: null, excerptText: r.matchPassageRaw || r.matchPassage });
    }
    askSourcesStatus.textContent = `Saved ${passageResults.length} passage${passageResults.length === 1 ? '' : 's'} as Evidence.`;
    showToast('Saved to Evidence.');
  } else if (target === 'outline') {
    await addOutlineLane(activeInvestigationId, { label: lastAskQuestion.slice(0, 120), method: 'mixed', status: 'in-progress' });
    askSourcesStatus.textContent = `Added "${lastAskQuestion.slice(0, 60)}" to the Research Outline.`;
    showToast('Added to Outline.');
  } else if (target === 'findings' || target === 'report') {
    if (!passageResults.length) { askSourcesStatus.textContent = 'No passage-level match to build a claim from — try a more specific question.'; return; }
    const evItems = [];
    for (const r of passageResults) {
      evItems.push(await createEvidenceItem(activeInvestigationId, { sourceRecordId: r.id, excerptType: 'quote', location: r.matchPage ? `p.${r.matchPage}` : '', outlineLaneId: null, excerptText: r.matchPassageRaw || r.matchPassage }));
    }
    const claim = await createClaim(activeInvestigationId, { text: lastAskQuestion, links: evItems.map((e) => ({ evidenceItemId: e.id, stance: 'supports' })) });
    askSourcesStatus.textContent = `Added claim ${claim.claimId} — it'll show up in Findings and Report.`;
    showToast('Added as a Claim.');
  } else if (target === 'timeline') {
    askSourcesStatus.textContent = 'Timeline is generated automatically from dated sources.';
    location.hash = '#/workspace/findings/timeline';
  }
  await appendAskHistory(lastAskQuestion, 'add-to:' + target, null, null);
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('#askAddToMenu button[data-add-to]');
  if (!btn) return;
  askAddToMenu.classList.add('hidden');
  await runAskSourcesAddTo(btn.dataset.addTo);
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('#askCreateMenu button[data-create]');
  if (!btn) return;
  askCreateMenu.classList.add('hidden');
  askSourcesArtifact.innerHTML = '';
  askSourcesStatus.textContent = '';
  await handleCreateIntent({ intent: 'create', target: btn.dataset.create }, lastAskQuestion);
});

// "Create..." - jumps to an existing tab for artifacts that already have a
// home (Outline, Bibliography, Timeline, Gaps, Report), or renders one of
// the new deterministic table artifacts directly under Ask Sources.
async function handleCreateIntent(cmd, q) {
  if (cmd.intent === 'clarify-table') {
    askSourcesStatus.textContent = 'Which table would you like — an Evidence Table, a Claim/Evidence Matrix, or a Quantitative Table?';
    return;
  }
  const target = cmd.target;
  const NAV = {
    outline: '#/workspace/research',
    bibliography: '#/workspace/evidence/bibliography',
    timeline: '#/workspace/findings/timeline',
    'findings-summary': '#/workspace/findings',
    gaps: '#/workspace/findings/gaps',
    report: '#/workspace/report'
  };
  if (NAV[target]) {
    askSourcesStatus.textContent = `Opening ${target.replace(/-/g, ' ')}…`;
    location.hash = NAV[target];
    return;
  }
  const [records, evidenceItems, claims, quantFindings] = await Promise.all([
    listInvestigationRecords(activeInvestigationId),
    listEvidenceItems(activeInvestigationId),
    listClaims(activeInvestigationId),
    listQuantitativeFindings(activeInvestigationId)
  ]);
  if (target === 'source-index') {
    askSourcesArtifact.innerHTML = `<div class="panel"><h2>Source Index</h2>${renderSourceIndex(records)}</div>`;
  } else if (target === 'evidence-table') {
    askSourcesArtifact.innerHTML = `<div class="panel"><h2>Evidence Table</h2>${renderEvidenceTable(evidenceItems, records, claims)}</div>`;
  } else if (target === 'claim-matrix') {
    askSourcesArtifact.innerHTML = `<div class="panel"><h2>Claim/Evidence Matrix</h2>${renderClaimEvidenceMatrix(claims, evidenceItems)}</div>`;
  } else if (target === 'quantitative-table') {
    askSourcesArtifact.innerHTML = `<div class="panel"><h2>Quantitative Table</h2>${renderQuantitativeTable(quantFindings)}</div>`;
  } else if (target === 'citations') {
    renderCitationsArtifact(records, q);
  }
}

function renderCitationsArtifact(records, q) {
  const styleMatch = /\b(apa|mla|chicago|turabian|legal)\b/i.exec(q || '');
  const style = styleMatch ? styleMatch[1].toLowerCase() : 'apa';
  const scopedIds = new Set(lastAskResults.map((r) => r.id));
  const list = scopedIds.size ? records.filter((r) => scopedIds.has(r.id)) : records;
  const finalList = list.length ? list : records;
  if (!finalList.length) { askSourcesArtifact.innerHTML = '<div class="panel"><h2>Citations</h2><p class="status">No sources to cite yet.</p></div>'; return; }
  const styleOptions = CITATION_STYLES.map((s) => `<option value="${s}" ${s === style ? 'selected' : ''}>${esc(CITATION_STYLE_LABELS[s])}</option>`).join('');
  const renderList = (st) => finalList.map((r) => `<li>${esc(formatCitation(r, st).text)}</li>`).join('');
  askSourcesArtifact.innerHTML = `<div class="panel"><h2>Citations</h2>
    <p class="hint">${finalList.length === records.length ? 'All sources in this investigation.' : `Sources from your last answer (${finalList.length}).`}</p>
    <label class="sr-only" for="askCitationStyleSelect">Citation style</label>
    <select id="askCitationStyleSelect">${styleOptions}</select>
    <ol class="report-list" id="askCitationList" style="margin-top:10px">${renderList(style)}</ol>
  </div>`;
  document.querySelector('#askCitationStyleSelect').addEventListener('change', (e) => {
    document.querySelector('#askCitationList').innerHTML = renderList(e.target.value);
  });
}

async function handleExcludeFromReport() {
  const claims = await listClaims(activeInvestigationId);
  if (!claims.length) { askSourcesStatus.textContent = 'No claims yet to remove from the report.'; return; }
  const target = claims[0]; // listClaims sorts newest-first - "this/that" resolves to the most recent claim
  await updateClaim(target.id, { excludedFromReport: true });
  askSourcesStatus.textContent = `Excluded claim ${target.claimId} ("${target.text.slice(0, 60)}${target.text.length > 60 ? '…' : ''}") from the Report — it stays as Evidence and in Findings > Claims.`;
  showToast('Excluded from Report.');
  await appendAskHistory(lastAskQuestion, 'exclude-from-report', `Excluded ${target.claimId} from Report`, null);
}

async function appendAskHistory(question, intent, resultSummary, aiAnswer, factState) {
  if (!activeInvestigationId) return;
  await createAskSourcesHistoryEntry(activeInvestigationId, { question, intent, resultSummary, aiAnswer, factState });
  await renderAskSourcesHistory();
}

async function renderAskSourcesHistory() {
  if (!activeInvestigationId) { askSourcesHistoryEl.innerHTML = ''; return; }
  const rows = await listAskSourcesHistory(activeInvestigationId);
  if (!rows.length) { askSourcesHistoryEl.innerHTML = ''; return; }
  askSourcesHistoryEl.innerHTML = `<h3 style="margin:18px 0 8px;font-size:14px">Recent questions</h3>` + rows.slice(0, 20).map((r) => `
    <details class="ask-history-entry">
      <summary>${r.factState ? `<span class="fact-badge fact-badge-${esc(r.factState)}">${esc(FACT_STATE_LABELS[r.factState] || r.factState)}</span> ` : ''}${esc(r.question)} <span class="hint">· ${esc(formatDate(r.createdAt))}</span></summary>
      ${r.resultSummary ? `<p class="hint">${esc(r.resultSummary)}</p>` : ''}
      ${r.aiAnswer ? `<p>${esc(r.aiAnswer)}</p>` : ''}
    </details>
  `).join('');
}

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
  lastBibliographyRecords = records;
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
    <div class="biblio-cite">
      <label class="sr-only" for="biblioCiteStyle-${attr(record.id)}">Citation style</label>
      <select id="biblioCiteStyle-${attr(record.id)}" class="biblio-cite-style" data-record-id="${attr(record.id)}">${CITATION_STYLES.map((s) => `<option value="${s}">${esc(CITATION_STYLE_LABELS[s])}</option>`).join('')}</select>
      <button type="button" class="mini-edit-btn" data-action="cite-source" data-id="${attr(record.id)}">Cite</button>
      <button type="button" class="mini-edit-btn" data-action="edit-bibliography" data-id="${attr(record.id)}">Edit</button>
    </div>
    <p class="hint biblio-cite-output" id="biblioCiteOut-${attr(record.id)}"></p>
  </article>`;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="cite-source"]');
  if (!btn) return;
  const record = lastBibliographyRecords.find((r) => r.id === btn.dataset.id);
  const out = document.querySelector(`#biblioCiteOut-${btn.dataset.id}`);
  if (!record || !out) return;
  const styleSelect = document.querySelector(`#biblioCiteStyle-${btn.dataset.id}`);
  out.textContent = formatCitation(record, styleSelect ? styleSelect.value : 'apa').text;
});

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
  const [records, outline, items, entities] = await Promise.all([
    listInvestigationRecords(activeInvestigationId),
    getOutline(activeInvestigationId),
    listEvidenceItems(activeInvestigationId),
    listEntities(activeInvestigationId)
  ]);
  currentOutline = outline;
  lastEvidenceEntities = entities;

  const sourceSelect = document.querySelector('#evidenceSourceSelect');
  sourceSelect.innerHTML = records.length
    ? records.map((r) => `<option value="${attr(r.id)}">${esc(r.title || r.originalUrl || r.id)}</option>`).join('')
    : '<option value="">No sources in this investigation yet</option>';

  const laneSelect = document.querySelector('#evidenceLaneSelect');
  laneSelect.innerHTML = '<option value="">None</option>' + (outline.lanes || []).map((l) => `<option value="${attr(l.id)}">${esc(l.label)}</option>`).join('');

  // One listMentionsForEvidence() call per item - fine at this app's
  // scale (matches the existing per-row pattern elsewhere, e.g.
  // investigationCardHtml's per-card listInvestigationRecords call); a
  // bulk by-investigation query isn't worth adding until a real
  // investigation shows this is a bottleneck.
  const mentionLists = await Promise.all(items.map((item) => listMentionsForEvidence(activeInvestigationId, item.id)));
  const mentionsByEvidence = new Map(items.map((item, i) => [item.id, mentionLists[i]]));

  // Phase 3 §7 "USED IN CLAIMS" - same per-row query pattern as mentions
  // above, read-only, never alters the underlying evidence.
  const claimLinkLists = await Promise.all(items.map((item) => listClaimEvidenceForEvidence(activeInvestigationId, item.id)));
  const claims = await listClaims(activeInvestigationId);
  const claimLinksByEvidence = new Map(items.map((item, i) => [item.id, claimLinkLists[i]]));
  const claimById = new Map(claims.map((c) => [c.id, c]));

  renderEvidenceList(items, records, entities, mentionsByEvidence, claimLinksByEvidence, claimById);
}

function renderEvidenceList(items, records, entities, mentionsByEvidence, claimLinksByEvidence, claimById) {
  const container = document.querySelector('#evidenceList');
  if (!items.length) { container.innerHTML = '<p class="status">No evidence items yet — pull a specific excerpt from a source above.</p>'; return; }
  const byId = new Map(records.map((r) => [r.id, r]));
  const entityById = new Map(entities.map((e) => [e.id, e]));
  container.innerHTML = items.map((item) => {
    const src = byId.get(item.sourceRecordId);
    const mentions = mentionsByEvidence.get(item.id) || [];
    const claimLinks = claimLinksByEvidence.get(item.id) || [];
    // "USED IN CLAIMS" - never alters the evidence itself, just shows
    // where it's cited and with what stance (docs/INVESTIGATION_WORKSPACE_PLAN.md
    // Phase 3 §7).
    const usedInClaimsHtml = claimLinks.length
      ? `<div class="linked-subjects"><span class="hint">Used in claims:</span> ${claimLinks.map((l) => {
          const claim = claimById.get(l.claimId);
          const label = claim ? `${esc(claim.claimId)} — ${esc(claim.text.slice(0, 60))}${claim.text.length > 60 ? '…' : ''}` : 'Claim removed';
          return `<span class="alias-chip"><span class="stance-tag ${esc(l.stance)}">${esc(EVIDENCE_STANCE_LABELS[l.stance] || l.stance)}</span> ${label}</span>`;
        }).join(' ')}</div>`
      : '';
    // Linked Subjects: explicitly labeled as mentions, never implied
    // relationships (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 2 "the UI
    // must make clear these are evidence mentions, not automatically
    // relationships") - each chip shows the subject's canonical name AND
    // the exact quoted wording, since they can legitimately differ.
    const linkedSubjectsHtml = mentions.length
      ? `<div class="linked-subjects"><span class="hint">Mentions:</span> ${mentions.map((m) => {
          const entity = entityById.get(m.entityId);
          const label = entity ? esc(entity.name) : 'Subject removed';
          const linkOpen = entity ? `<a href="#/workspace/subjects/${attr(entity.id)}">` : '<span>';
          const linkClose = entity ? '</a>' : '</span>';
          return `<span class="alias-chip">${linkOpen}${label}${linkClose} <span class="hint">as “${esc(m.quotedName)}”</span> <button type="button" class="alias-chip-remove" data-action="delete-mention" data-id="${attr(m.id)}" aria-label="Remove mention of ${label}">×</button></span>`;
        }).join(' ')}</div>`
      : '';
    return `<article class="evidence-card">
      <p class="evidence-card-meta">${esc(item.excerptType)}${item.location ? ' · ' + esc(item.location) : ''}</p>
      <p>${esc(item.excerptText)}</p>
      <p class="evidence-card-cite">From: ${src ? esc(src.title || src.originalUrl || 'Untitled source') : 'Source no longer in this investigation'}</p>
      ${linkedSubjectsHtml}
      ${usedInClaimsHtml}
      <button type="button" class="btn btn-small" data-action="open-link-subject" data-id="${attr(item.id)}">Link Subject</button>
      <button type="button" class="btn btn-small card-delete" data-action="delete-evidence" data-id="${attr(item.id)}">Delete</button>
    </article>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Link Subject dialog (Phase 2): attaches an Entity Mention to an evidence
// item from the Evidence tab, per docs/INVESTIGATION_WORKSPACE_PLAN.md
// Phase 2 §4 ("From an existing evidence item, allow the researcher to
// 'Link Subject'"). Never creates a relationship - see public/db.js
// createEntityMention() for why that's structurally impossible here.
// ---------------------------------------------------------------------------
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="open-link-subject"]');
  if (!btn) return;
  if (!lastEvidenceEntities.length) { showToast('Add a subject on the Subjects tab first.', true); return; }
  document.querySelector('#linkSubjectEvidenceId').value = btn.dataset.id;
  const select = document.querySelector('#linkSubjectEntitySelect');
  select.innerHTML = lastEvidenceEntities.map((ent) => `<option value="${attr(ent.id)}">${esc(ent.name)} (${esc(ENTITY_TYPE_LABELS[ent.type] || ent.type)})</option>`).join('');
  document.querySelector('#linkSubjectForm').reset();
  document.querySelector('#linkSubjectEvidenceId').value = btn.dataset.id; // reset() above clears the hidden field too - set it again after
  // Courtesy prefill only, never forced - the researcher can freely
  // overwrite it to match the source's actual wording.
  const selected = lastEvidenceEntities.find((ent) => ent.id === select.value);
  if (selected) document.querySelector('#linkSubjectQuotedName').value = selected.name;
  openDialog('linkSubjectDialog', { initialFocusEl: select });
});

document.querySelector('#linkSubjectEntitySelect').addEventListener('change', (e) => {
  const selected = lastEvidenceEntities.find((ent) => ent.id === e.target.value);
  const quotedNameInput = document.querySelector('#linkSubjectQuotedName');
  if (selected && !quotedNameInput.value.trim()) quotedNameInput.value = selected.name;
});

document.querySelector('#linkSubjectForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeInvestigationId) return;
  const evidenceId = document.querySelector('#linkSubjectEvidenceId').value;
  const entityId = document.querySelector('#linkSubjectEntitySelect').value;
  const quotedName = document.querySelector('#linkSubjectQuotedName').value;
  try {
    await createEntityMention(activeInvestigationId, {
      entityId, evidenceId, quotedName,
      snippet: document.querySelector('#linkSubjectSnippet').value,
      page: document.querySelector('#linkSubjectPage').value,
      location: document.querySelector('#linkSubjectLocation').value,
      notes: document.querySelector('#linkSubjectNotes').value
    });
    closeDialog('linkSubjectDialog');
    await renderEvidencePanel();
    showToast('Linked subject to this evidence item.');
  } catch (err) {
    showToast(err.message || 'Could not link subject.', true);
  }
});

// "Remove mention" appears in two places (the Evidence tab's Linked
// Subjects chips, and a Subject profile's Evidence Mentions list) - both
// share this one handler, which refreshes whichever view is actually on
// screen rather than assuming the Evidence tab.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-mention"]');
  if (!btn) return;
  await deleteEntityMention(btn.dataset.id);
  const entity = currentProfileEntity();
  if (entity) await renderEntityMentionsList(entity);
  else await renderEvidencePanel();
});

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
  try {
    await deleteEvidenceItem(btn.dataset.id);
    await renderEvidencePanel();
  } catch (err) {
    // Phase 3: deleteEvidenceItem refuses to delete the last evidence
    // behind a DOCUMENTED_FACT/SUPPORTED_INFERENCE/ALLEGATION finding -
    // surface why instead of silently doing nothing.
    showToast(err.message || 'Could not delete this evidence item.', true);
  }
});

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------
// Module state, mirroring the lastSubjectsEntities/lastEvidenceEntities
// pattern: fetched fresh whenever the Claims/Findings panel renders, so
// form handlers (which run after the render, on user action) don't
// re-fetch on every keystroke.
let lastClaimsEntities = [];
let lastClaimsEvidenceItems = [];
let lastClaimsRecords = [];
let lastClaimsList = [];
// Set by a claim card's "Create Finding" button so the Findings sub-tab
// can pre-select that claim when the investigator is sent there - a
// small, deliberately narrow cross-panel affordance, not shared state.
let pendingFindingClaimId = null;

async function renderClaimsPanel() {
  const [records, items, claims, entities] = await Promise.all([
    listInvestigationRecords(activeInvestigationId),
    listEvidenceItems(activeInvestigationId),
    listClaims(activeInvestigationId),
    listEntities(activeInvestigationId)
  ]);
  lastClaimsRecords = records; lastClaimsEvidenceItems = items; lastClaimsList = claims; lastClaimsEntities = entities;
  renderClaimStatusOptions();
  renderClaimSubjectsPicker(entities);
  renderClaimEvidencePicker(items);
  await renderClaimsList(claims, items, records, entities);
}

function renderClaimStatusOptions() {
  const select = document.querySelector('#claimStatusSelect');
  if (!select.options.length) select.innerHTML = CLAIM_STATUSES.map((s) => `<option value="${attr(s)}"${s === 'UNVERIFIED' ? ' selected' : ''}>${esc(CLAIM_STATUS_LABELS[s])}</option>`).join('');
}

function renderClaimSubjectsPicker(entities) {
  const container = document.querySelector('#claimSubjectsPicker');
  container.innerHTML = entities.length
    ? entities.map((e) => `<label class="claim-evidence-option">
        <input type="checkbox" data-entity-id="${attr(e.id)}" />
        <span class="claim-evidence-option-text">${esc(e.name)}<p>${esc(ENTITY_TYPE_LABELS[e.type] || e.type)}</p></span>
      </label>`).join('')
    : '<p class="status" style="padding:12px;margin:0">No subjects yet — add one on the Subjects tab to tag this claim, or leave it untagged.</p>';
}

function renderClaimEvidencePicker(items) {
  const container = document.querySelector('#claimEvidencePicker');
  if (!items.length) { container.innerHTML = '<p class="status" style="padding:12px;margin:0">Add evidence items first, on the Evidence tab. A claim may still be added without any — a claim is something being tested, not yet proven.</p>'; return; }
  container.innerHTML = items.map((item) => `<label class="claim-evidence-option">
    <input type="checkbox" data-evidence-id="${attr(item.id)}" />
    <span class="claim-evidence-option-text">${esc(item.excerptText.slice(0, 140))}${item.excerptText.length > 140 ? '…' : ''}<p>${esc(item.excerptType)}${item.location ? ' · ' + esc(item.location) : ''}</p></span>
    <select data-stance-for="${attr(item.id)}" aria-label="Stance for this evidence item">${EVIDENCE_STANCES.map((s) => `<option value="${attr(s)}">${esc(EVIDENCE_STANCE_LABELS[s])}</option>`).join('')}</select>
  </label>`).join('');
}

async function renderClaimsList(claims, items, records, entities) {
  const container = document.querySelector('#claimsList');
  if (!claims.length) { container.innerHTML = '<p class="status">No claims yet.</p>'; return; }
  const evById = new Map(items.map((e) => [e.id, e]));
  const recById = new Map(records.map((r) => [r.id, r]));
  const entById = new Map(entities.map((e) => [e.id, e]));
  const linksByClaimList = await Promise.all(claims.map((c) => listClaimEvidenceForClaim(activeInvestigationId, c.id)));

  container.innerHTML = claims.map((claim, i) => {
    const status = claim.status || 'UNVERIFIED';
    const links = linksByClaimList[i];
    const linkRows = links.map((l) => {
      const ev = evById.get(l.evidenceId);
      const src = ev ? recById.get(ev.sourceRecordId) : null;
      return `<li><span class="stance-tag ${esc(l.stance)}">${esc(EVIDENCE_STANCE_LABELS[l.stance] || l.stance)}</span>${ev ? esc(ev.excerptText.slice(0, 80)) : 'Evidence item removed'}${src ? ' — ' + esc(src.title || src.originalUrl || '') : ''}
        <button type="button" class="link-remove" data-action="delete-claim-evidence" data-id="${attr(l.id)}" aria-label="Remove this evidence link">×</button></li>`;
    }).join('');
    const subjectChips = (claim.subjectEntityIds || []).map((id) => {
      const e = entById.get(id);
      return e ? `<a href="#/workspace/subjects/${attr(e.id)}" class="entity-type-badge">${esc(e.name)}</a>` : `<span class="entity-type-badge">(subject removed)</span>`;
    }).join(' ');
    return `<article class="claim-card">
      <p class="claim-card-meta">${esc(claim.claimId)} · <span class="status-badge status-${esc(status.toLowerCase().replace(/_/g, '-'))}">${esc(CLAIM_STATUS_LABELS[status] || status)}</span>${claim.excludedFromReport ? ' · <span class="hint">excluded from Report</span>' : ''}</p>
      <p>${esc(claim.text)}</p>
      ${subjectChips ? `<p>${subjectChips}</p>` : ''}
      ${linkRows ? `<ul class="claim-card-links">${linkRows}</ul>` : '<p class="hint">No evidence linked yet.</p>'}
      <div class="field-row" style="margin-top:10px;align-items:center">
        <select class="lane-inline-select" data-action="set-claim-status" data-id="${attr(claim.id)}" aria-label="Change status for ${esc(claim.claimId)}">${CLAIM_STATUSES.map((s) => `<option value="${attr(s)}"${s === status ? ' selected' : ''}>${esc(CLAIM_STATUS_LABELS[s])}</option>`).join('')}</select>
        <button type="button" class="btn btn-small" data-action="create-finding-from-claim" data-id="${attr(claim.id)}">Create Finding</button>
      </div>
      <button type="button" class="btn btn-small" data-action="toggle-claim-report" data-id="${attr(claim.id)}" data-excluded="${claim.excludedFromReport ? '1' : ''}">${claim.excludedFromReport ? 'Include in Report' : 'Exclude from Report'}</button>
      <button type="button" class="btn btn-small card-delete" data-action="delete-claim" data-id="${attr(claim.id)}">Delete</button>
    </article>`;
  }).join('');
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="toggle-claim-report"]');
  if (!btn) return;
  await updateClaim(btn.dataset.id, { excludedFromReport: !btn.dataset.excluded });
  await renderClaimsPanel();
});

document.addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-action="set-claim-status"]');
  if (!sel) return;
  await updateClaim(sel.dataset.id, { status: sel.value });
  await renderClaimsPanel();
  showToast('Updated claim status.');
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="create-finding-from-claim"]');
  if (!btn) return;
  pendingFindingClaimId = btn.dataset.id;
  location.hash = '#/workspace/findings/findings';
});

document.querySelector('#claimForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeInvestigationId) return;
  const text = document.querySelector('#claimTextInput').value.trim();
  if (!text) return;
  const status = document.querySelector('#claimStatusSelect').value;
  const subjectEntityIds = [...document.querySelectorAll('#claimSubjectsPicker input[type=checkbox]:checked')].map((cb) => cb.dataset.entityId);
  const evidenceLinks = [...document.querySelectorAll('#claimEvidencePicker input[type=checkbox]:checked')].map((cb) => {
    const id = cb.dataset.evidenceId;
    const stanceSelect = document.querySelector(`select[data-stance-for="${id}"]`);
    return { evidenceId: id, stance: stanceSelect ? stanceSelect.value : 'supports' };
  });
  try {
    const claim = await createClaim(activeInvestigationId, { text, status, subjectEntityIds });
    for (const link of evidenceLinks) await createClaimEvidence(activeInvestigationId, { claimId: claim.id, ...link });
    document.querySelector('#claimForm').reset();
    await renderClaimsPanel();
    showToast(`Added claim ${claim.claimId}.`);
  } catch (err) {
    showToast(err.message || 'Could not add claim.', true);
  }
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-claim-evidence"]');
  if (!btn) return;
  await deleteClaimEvidence(btn.dataset.id);
  await renderClaimsPanel();
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-claim"]');
  if (!btn) return;
  try {
    await deleteClaim(btn.dataset.id);
    await renderClaimsPanel();
  } catch (err) {
    // Phase 3: deleteClaim refuses when a Finding still cites this claim.
    showToast(err.message || 'Could not delete this claim.', true);
  }
});

// ---------------------------------------------------------------------------
// Findings (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 3): the
// investigator's current evidence-backed CONCLUSION about a claim. THE
// HARD RULE lives in public/db.js createClaimFinding()/updateClaimFinding()
// - this file's job is to make it hard to even attempt saving a
// DOCUMENTED_FACT/SUPPORTED_INFERENCE/ALLEGATION with no evidence (submit
// button starts enabled only for the two evidence-exempt classifications,
// and disables for the other three until ≥1 evidence item is checked),
// but the real enforcement is the data-layer boundary.
// ---------------------------------------------------------------------------
async function renderFindingsPanel() {
  const [claims, items, records, findings] = await Promise.all([
    listClaims(activeInvestigationId),
    listEvidenceItems(activeInvestigationId),
    listInvestigationRecords(activeInvestigationId),
    listClaimFindings(activeInvestigationId)
  ]);
  renderFindingClaimOptions(claims);
  renderFindingClassificationOptions();
  renderFindingEvidencePicker(items);
  if (pendingFindingClaimId && claims.some((c) => c.id === pendingFindingClaimId)) {
    document.querySelector('#findingClaimSelect').value = pendingFindingClaimId;
    pendingFindingClaimId = null;
  }
  updateFindingSubmitState();
  renderFindingsList(findings, claims, items, records);
  renderUnresolvedList(claims, findings);
}

function renderFindingClaimOptions(claims) {
  const select = document.querySelector('#findingClaimSelect');
  select.innerHTML = claims.length
    ? claims.map((c) => `<option value="${attr(c.id)}">${esc(c.claimId)} — ${esc(c.text.slice(0, 60))}${c.text.length > 60 ? '…' : ''}</option>`).join('')
    : '<option value="">Add a claim first, above</option>';
}

function renderFindingClassificationOptions() {
  const select = document.querySelector('#findingClassificationSelect');
  if (!select.options.length) select.innerHTML = FINDING_CLASSIFICATIONS.map((c) => `<option value="${attr(c)}">${esc(FINDING_CLASSIFICATION_LABELS[c])}</option>`).join('');
}

function renderFindingEvidencePicker(items) {
  const container = document.querySelector('#findingEvidencePicker');
  container.innerHTML = items.length
    ? items.map((item) => `<label class="claim-evidence-option">
        <input type="checkbox" data-evidence-id="${attr(item.id)}" />
        <span class="claim-evidence-option-text">${esc(item.excerptText.slice(0, 140))}${item.excerptText.length > 140 ? '…' : ''}<p>${esc(item.excerptType)}${item.location ? ' · ' + esc(item.location) : ''}</p></span>
      </label>`).join('')
    : '<p class="status" style="padding:12px;margin:0">No evidence items yet.</p>';
}

// The UI-level half of the hard rule: DOCUMENTED_FACT/SUPPORTED_INFERENCE/
// ALLEGATION require ≥1 evidence checkbox; UNRESOLVED_QUESTION/
// NO_EVIDENCE_LOCATED never require one. db.js rejects the write
// regardless of what this button's state was.
function updateFindingSubmitState() {
  const classification = document.querySelector('#findingClassificationSelect').value;
  const checked = document.querySelectorAll('#findingEvidencePicker input[type="checkbox"]:checked').length;
  const needsEvidence = FINDING_CLASSIFICATIONS_REQUIRING_EVIDENCE.includes(classification);
  const btn = document.querySelector('#findingSubmitBtn');
  const status = document.querySelector('#findingFormStatus');
  btn.disabled = needsEvidence && checked === 0;
  status.textContent = needsEvidence
    ? (checked === 0 ? 'This classification asserts something as true — select at least one evidence item to enable saving.' : `${checked} evidence item${checked === 1 ? '' : 's'} selected.`)
    : 'This classification does not require evidence — it is itself the honest statement that nothing (yet) established this.';
}
document.querySelector('#findingClassificationSelect').addEventListener('change', updateFindingSubmitState);
document.querySelector('#findingEvidencePicker').addEventListener('change', (e) => {
  if (e.target.matches('input[type="checkbox"]')) updateFindingSubmitState();
});

function renderFindingsList(findings, claims, items, records) {
  const container = document.querySelector('#findingsList');
  if (!findings.length) { container.innerHTML = '<p class="status">No findings yet.</p>'; return; }
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const evById = new Map(items.map((e) => [e.id, e]));
  const recById = new Map(records.map((r) => [r.id, r]));
  container.innerHTML = findings.map((f) => {
    const claim = claimById.get(f.claimId);
    const evidenceHtml = (f.evidenceIds || []).map((id) => {
      const ev = evById.get(id);
      if (!ev) return '<li class="hint">Evidence item removed</li>';
      const src = recById.get(ev.sourceRecordId);
      return `<li>${esc(ev.excerptText.slice(0, 100))}${ev.excerptText.length > 100 ? '…' : ''}${src ? ' — ' + esc(src.title || src.originalUrl || '') : ''}</li>`;
    }).join('');
    return `<article class="claim-card">
      <p class="claim-card-meta"><span class="fact-badge fact-badge-${esc(f.classification.toLowerCase().replace(/_/g, '-'))}">${esc(FINDING_CLASSIFICATION_LABELS[f.classification])}</span> ${claim ? `on <a href="#/workspace/findings/claims">${esc(claim.claimId)}</a>` : '(claim removed)'}</p>
      <p>${esc(f.conclusion)}</p>
      ${evidenceHtml ? `<ul class="claim-card-links">${evidenceHtml}</ul>` : ''}
      <button type="button" class="btn btn-small card-delete" data-action="delete-finding" data-id="${attr(f.id)}">Delete</button>
    </article>`;
  }).join('');
}

// Unresolved (Phase 3 brief §6): claims still UNVERIFIED, plus findings
// classified UNRESOLVED_QUESTION/NO_EVIDENCE_LOCATED - the honest open
// part of the investigation, never "this never happened" (CANON.md
// Product Principle #12).
function renderUnresolvedList(claims, findings) {
  const container = document.querySelector('#unresolvedList');
  const unverifiedClaims = claims.filter((c) => (c.status || 'UNVERIFIED') === 'UNVERIFIED');
  const openFindings = findings.filter((f) => f.classification === 'UNRESOLVED_QUESTION' || f.classification === 'NO_EVIDENCE_LOCATED');
  if (!unverifiedClaims.length && !openFindings.length) { container.innerHTML = '<p class="status">Nothing unresolved right now.</p>'; return; }
  const claimItems = unverifiedClaims.map((c) => `<li><strong>${esc(c.claimId)}</strong> — ${esc(c.text)}</li>`).join('');
  const findingItems = openFindings.map((f) => `<li><span class="fact-badge fact-badge-${esc(f.classification.toLowerCase().replace(/_/g, '-'))}">${esc(FINDING_CLASSIFICATION_LABELS[f.classification])}</span> ${esc(f.conclusion)}</li>`).join('');
  container.innerHTML = `
    ${claimItems ? `<h3 style="margin:0 0 8px;font-size:13px">Unverified claims</h3><ul class="report-list">${claimItems}</ul>` : ''}
    ${findingItems ? `<h3 style="margin:${claimItems ? '18px' : '0'} 0 8px;font-size:13px">Open findings</h3><ul class="report-list">${findingItems}</ul>` : ''}
  `;
}

document.querySelector('#findingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeInvestigationId) return;
  const claimId = document.querySelector('#findingClaimSelect').value;
  if (!claimId) { showToast('Add a claim first.', true); return; }
  const conclusion = document.querySelector('#findingConclusionInput').value.trim();
  const classification = document.querySelector('#findingClassificationSelect').value;
  const evidenceIds = [...document.querySelectorAll('#findingEvidencePicker input[type="checkbox"]:checked')].map((cb) => cb.dataset.evidenceId);
  try {
    await createClaimFinding(activeInvestigationId, { claimId, conclusion, classification, evidenceIds });
    document.querySelector('#findingForm').reset();
    updateFindingSubmitState();
    await renderFindingsPanel();
    showToast('Added finding.');
  } catch (err) {
    showToast(err.message || 'Could not add finding.', true);
  }
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-finding"]');
  if (!btn) return;
  await deleteClaimFinding(btn.dataset.id);
  await renderFindingsPanel();
});

// ---------------------------------------------------------------------------
// Subjects (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 1): the entity/
// relationship case-file layer. List view (create + search + browse
// subjects) and profile view (one subject's aliases + relationships) are
// two panels toggled by whether the URL carries an entity id
// (#/workspace/subjects/:entityId) - selecting a subject just navigates,
// so the browser back button and reloads both work for free, matching
// every other sub-view in this app.
//
// THE HARD RULE lives in public/db.js createRelationship()/
// updateRelationship(), not here - this file's job is to make it hard to
// even attempt a save without evidence (submit button starts disabled,
// only enables once an evidence checkbox is checked), but the real
// enforcement is the data-layer boundary. Never assume the UI check is
// sufficient on its own.
// ---------------------------------------------------------------------------
async function renderSubjectsPanel(selectedEntityId) {
  const [entities, evidenceItems] = await Promise.all([
    listEntities(activeInvestigationId),
    listEvidenceItems(activeInvestigationId)
  ]);
  lastSubjectsEntities = entities;
  lastSubjectsEvidenceItems = evidenceItems;

  const entity = selectedEntityId ? entities.find((e) => e.id === selectedEntityId) : null;
  document.querySelector('#subjectsListView').classList.toggle('hidden', !!entity);
  document.querySelector('#subjectProfileView').classList.toggle('hidden', !entity);

  if (entity) {
    await renderEntityProfile(entity, entities, evidenceItems);
  } else {
    renderEntityTypeOptions();
    // Route through findEntities() (name + alias search) whenever there's
    // a search value, exactly like the live-typing handler below - so
    // re-entering this tab with a non-empty search box behaves the same
    // as typing it just did, instead of silently falling back to a
    // name-only filter that can't see aliases.
    const searchValue = document.querySelector('#subjectsSearchInput').value.trim();
    const rows = searchValue ? await findEntities(activeInvestigationId, searchValue) : entities;
    renderEntityList(rows, searchValue);
  }
}

function renderEntityTypeOptions() {
  const select = document.querySelector('#entityTypeSelect');
  if (select.options.length) return; // static vocabulary - populate once
  select.innerHTML = ENTITY_TYPES.map((t) => `<option value="${attr(t)}">${esc(ENTITY_TYPE_LABELS[t])}</option>`).join('');
}

// `rows` must already be filtered by the caller (findEntities() when
// there's a search value, the full list otherwise) - this function only
// renders, it never filters, so there is exactly one search codepath
// (name + alias, via findEntities) instead of two that could drift apart.
function renderEntityList(rows, filterText) {
  const container = document.querySelector('#subjectsList');
  if (!rows.length) {
    container.innerHTML = filterText
      ? `<p class="status">No subjects match “${esc(filterText)}”.</p>`
      : '<p class="status">No subjects yet — add a person, organization, or other entity above to start building this investigation\'s case file.</p>';
    return;
  }
  container.innerHTML = rows.map((e) => `<article class="entity-card">
    <button type="button" class="entity-card-select" data-action="select-entity" data-id="${attr(e.id)}">
      <span class="entity-type-badge">${esc(ENTITY_TYPE_LABELS[e.type] || e.type)}</span>
      <strong>${esc(e.name)}</strong>
      ${e.description ? `<p>${esc(e.description)}</p>` : ''}
    </button>
    <button type="button" class="btn btn-small card-delete" data-action="delete-entity" data-id="${attr(e.id)}" aria-label="Delete ${esc(e.name)}">Delete</button>
  </article>`).join('');
}

// findEntities() does the same substring-over-name-and-aliases search as
// the list filter above, but goes through the real search path (aliases
// included) - used so "search 'Payne' returns both entities" is an
// actual product behavior, not just a list filter side effect.
document.querySelector('#subjectsSearchInput').addEventListener('input', async (e) => {
  if (!activeInvestigationId) return;
  const rows = await findEntities(activeInvestigationId, e.target.value);
  renderEntityList(rows, e.target.value);
});

document.querySelector('#entityForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeInvestigationId) return;
  const name = document.querySelector('#entityNameInput').value.trim();
  const type = document.querySelector('#entityTypeSelect').value;
  const description = document.querySelector('#entityDescriptionInput').value.trim();
  if (!name) return;
  try {
    const entity = await createEntity(activeInvestigationId, { type, name, description });
    document.querySelector('#entityForm').reset();
    await renderSubjectsPanel(null);
    showToast(`Added subject “${entity.name}”.`);
  } catch (err) {
    showToast(err.message || 'Could not add subject.', true);
  }
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="select-entity"]');
  if (!btn) return;
  location.hash = `#/workspace/subjects/${btn.dataset.id}`;
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-entity"]');
  if (!btn) return;
  const entity = lastSubjectsEntities.find((x) => x.id === btn.dataset.id);
  const ok = await confirmDialog({
    title: 'Delete subject?',
    message: `Delete “${entity?.name || 'this subject'}”? Its relationships stay in place as evidence-backed records but will show this subject as removed, the same way a deleted evidence item does elsewhere.`,
    confirmLabel: 'Delete subject', danger: true
  });
  if (!ok) return;
  await deleteEntity(btn.dataset.id);
  await renderSubjectsPanel(null);
});

async function renderEntityProfile(entity, allEntities, evidenceItems) {
  document.querySelector('#subjectProfileHead').innerHTML = `
    <p class="eyebrow">${esc(ENTITY_TYPE_LABELS[entity.type] || entity.type)}</p>
    <h1 style="margin:0 0 8px;font-size:22px">${esc(entity.name)}</h1>
    ${entity.description ? `<p class="view-subtitle">${esc(entity.description)}</p>` : ''}
  `;

  await renderEntityAliases(entity);
  renderRelationshipTargetOptions(entity, allEntities);
  renderRelationshipVocabularyOptions();
  renderRelationshipEvidencePicker(evidenceItems);
  await renderEntityRelationships(entity, allEntities);
  await renderEntityMentionsList(entity);
  await renderEntityClaimsList(entity);
  await renderEntityFindingsList(entity);
}

// "Claims involving this subject" / "Findings involving this subject"
// (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 3 §8) - explicit
// subjectEntityIds only, never plain-text name matching.
async function renderEntityClaimsList(entity) {
  const container = document.querySelector('#entityClaimsList');
  const claims = await listClaimsForEntity(activeInvestigationId, entity.id);
  if (!claims.length) { container.innerHTML = '<p class="status">No claims tag this subject yet.</p>'; return; }
  container.innerHTML = `<ul class="rel-list">${claims.map((c) => {
    const status = c.status || 'UNVERIFIED';
    return `<li class="rel-row">
      <span class="status-badge status-${esc(status.toLowerCase().replace(/_/g, '-'))}">${esc(CLAIM_STATUS_LABELS[status] || status)}</span>
      <strong>${esc(c.claimId)}</strong>
      <p class="hint">${esc(c.text)}</p>
      <a href="#/workspace/findings/claims" class="hint">View in Claims →</a>
    </li>`;
  }).join('')}</ul>`;
}

async function renderEntityFindingsList(entity) {
  const container = document.querySelector('#entityFindingsList');
  const findings = await listClaimFindingsForEntity(activeInvestigationId, entity.id);
  if (!findings.length) { container.innerHTML = '<p class="status">No findings involve this subject yet.</p>'; return; }
  container.innerHTML = `<ul class="rel-list">${findings.map((f) => `<li class="rel-row">
      <span class="fact-badge fact-badge-${esc(f.classification.toLowerCase().replace(/_/g, '-'))}">${esc(FINDING_CLASSIFICATION_LABELS[f.classification])}</span>
      <p class="hint">${esc(f.conclusion)}</p>
      <a href="#/workspace/findings/findings" class="hint">View in Findings →</a>
    </li>`).join('')}</ul>`;
}

// Evidence Mentions (Phase 2): every evidence item explicitly linked to
// this subject, read-only here - linking happens from the Evidence tab's
// "Link Subject" button (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 2 §5).
async function renderEntityMentionsList(entity) {
  const container = document.querySelector('#entityMentionsList');
  const [mentions, records] = await Promise.all([
    listMentionsForEntity(activeInvestigationId, entity.id),
    listInvestigationRecords(activeInvestigationId)
  ]);
  if (!mentions.length) { container.innerHTML = '<p class="status">No evidence mentions yet — use "Link Subject" on an evidence item, on the Evidence tab.</p>'; return; }

  const evidenceItems = await listEvidenceItems(activeInvestigationId);
  const evidenceById = new Map(evidenceItems.map((ev) => [ev.id, ev]));
  const recordById = new Map(records.map((r) => [r.id, r]));

  container.innerHTML = `<ul class="rel-list">${mentions.map((m) => {
    const evidence = evidenceById.get(m.evidenceId);
    const src = evidence ? recordById.get(evidence.sourceRecordId) : null;
    const sourceLabel = src ? esc(src.title || src.originalUrl || 'Untitled source') : 'Evidence removed';
    const dateLine = src?.captureDate ? ` · ${esc(formatDate(src.captureDate))}` : '';
    return `<li class="rel-row">
      <strong>“${esc(m.quotedName)}”</strong> <span class="hint">appears in: ${sourceLabel}${dateLine}${m.page ? ' · p.' + esc(m.page) : ''}${m.location ? ' · ' + esc(m.location) : ''}</span>
      ${evidence ? `<p class="hint">${esc(evidence.excerptText.slice(0, 160))}${evidence.excerptText.length > 160 ? '…' : ''}</p>` : ''}
      ${m.snippet ? `<p class="hint">Snippet: ${esc(m.snippet)}</p>` : ''}
      <a href="#/workspace/evidence/items" class="hint">View in Evidence →</a>
      <button type="button" class="btn btn-small card-delete" data-action="delete-mention" data-id="${attr(m.id)}">Remove mention</button>
    </li>`;
  }).join('')}</ul>`;
}

async function renderEntityAliases(entity) {
  const aliases = await listEntityAliases(entity.id);
  const container = document.querySelector('#entityAliasList');
  container.innerHTML = aliases.length
    ? aliases.map((a) => `<span class="alias-chip">${esc(a.alias)} <button type="button" class="alias-chip-remove" data-action="delete-alias" data-id="${attr(a.id)}" aria-label="Remove alias ${esc(a.alias)}">×</button></span>`).join('')
    : '<p class="hint">No aliases yet.</p>';
}

document.querySelector('#entityAliasForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const entity = currentProfileEntity();
  if (!entity) return;
  const input = document.querySelector('#entityAliasInput');
  const alias = input.value.trim();
  if (!alias) return;
  try {
    await addEntityAlias(activeInvestigationId, entity.id, alias);
    input.value = '';
    await renderEntityAliases(entity);
  } catch (err) {
    showToast(err.message || 'Could not add alias.', true);
  }
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-alias"]');
  if (!btn) return;
  const entity = currentProfileEntity();
  await deleteEntityAlias(btn.dataset.id);
  if (entity) await renderEntityAliases(entity);
});

// The entity id currently open, read back from the URL - avoids a
// separate mutable "current entity" variable that could drift from what
// #/workspace/subjects/:entityId actually says.
function currentProfileEntity() {
  const { tab, subtab } = parseHash();
  if (tab !== 'subjects' || !subtab) return null;
  return lastSubjectsEntities.find((e) => e.id === subtab) || null;
}

function renderRelationshipTargetOptions(entity, allEntities) {
  const select = document.querySelector('#relationshipTargetSelect');
  const others = allEntities.filter((e) => e.id !== entity.id);
  select.innerHTML = others.length
    ? others.map((e) => `<option value="${attr(e.id)}">${esc(e.name)} (${esc(ENTITY_TYPE_LABELS[e.type] || e.type)})</option>`).join('')
    : '<option value="">Add another subject first</option>';
}

function renderRelationshipVocabularyOptions() {
  const statusSelect = document.querySelector('#relationshipStatusSelect');
  if (!statusSelect.options.length) {
    statusSelect.innerHTML = RELATIONSHIP_STATUSES.map((s) => `<option value="${attr(s)}"${s === 'UNKNOWN' ? ' selected' : ''}>${esc(RELATIONSHIP_STATUS_LABELS[s])}</option>`).join('');
  }
  const datalist = document.querySelector('#relationshipTypeSuggestions');
  if (!datalist.options.length) {
    datalist.innerHTML = SUGGESTED_RELATIONSHIP_TYPES.map((t) => `<option value="${attr(t)}"></option>`).join('');
  }
}

function renderRelationshipEvidencePicker(evidenceItems) {
  const container = document.querySelector('#relationshipEvidencePicker');
  if (!evidenceItems.length) {
    container.innerHTML = '<p class="status" style="padding:12px;margin:0">Add evidence items first, on the Evidence tab — a relationship can\'t be saved without at least one.</p>';
  } else {
    container.innerHTML = evidenceItems.map((item) => `<label class="claim-evidence-option">
      <input type="checkbox" data-evidence-id="${attr(item.id)}" />
      <span class="claim-evidence-option-text">${esc(item.excerptText.slice(0, 140))}${item.excerptText.length > 140 ? '…' : ''}<p>${esc(item.excerptType)}${item.location ? ' · ' + esc(item.location) : ''}</p></span>
    </label>`).join('');
  }
  updateRelationshipSubmitState();
}

// The UI-level half of "no evidence = no relationship": the submit
// button starts disabled and only enables once ≥1 evidence checkbox is
// checked. This is a convenience, not the enforcement - db.js rejects
// the write regardless of what this button's state was.
function updateRelationshipSubmitState() {
  const checked = document.querySelectorAll('#relationshipEvidencePicker input[type="checkbox"]:checked').length;
  const btn = document.querySelector('#relationshipSubmitBtn');
  const status = document.querySelector('#relationshipFormStatus');
  btn.disabled = checked === 0;
  status.textContent = checked === 0 ? 'Select at least one evidence item to enable saving.' : `${checked} evidence item${checked === 1 ? '' : 's'} selected.`;
}
document.querySelector('#relationshipEvidencePicker').addEventListener('change', (e) => {
  if (e.target.matches('input[type="checkbox"]')) updateRelationshipSubmitState();
});

async function renderEntityRelationships(entity, allEntities) {
  const entById = new Map(allEntities.map((e) => [e.id, e]));
  const relationships = await listRelationshipsForEntity(activeInvestigationId, entity.id);
  const container = document.querySelector('#entityRelationshipsList');
  if (!relationships.length) { container.innerHTML = '<p class="status">No relationships yet.</p>'; return; }

  const outgoing = relationships.filter((r) => r.direction === 'outgoing');
  const incoming = relationships.filter((r) => r.direction === 'incoming');

  function relRow(r, otherId, arrow) {
    const other = entById.get(otherId);
    const otherLabel = other
      ? `<a href="#/workspace/subjects/${attr(other.id)}">${esc(other.name)}</a>`
      : '<span class="hint">Entity removed</span>';
    return `<li class="rel-row">
      <span class="status-badge status-${esc(r.status.toLowerCase())}">${esc(RELATIONSHIP_STATUS_LABELS[r.status] || r.status)}</span>
      <strong>${esc(r.type.replace(/_/g, ' '))}</strong> ${arrow} ${otherLabel}
      <span class="hint">${r.evidenceIds.length} evidence item${r.evidenceIds.length === 1 ? '' : 's'}${r.dateStart ? ' · from ' + esc(r.dateStart) : ''}${r.dateEnd ? ' to ' + esc(r.dateEnd) : ''}</span>
      ${r.notes ? `<p class="hint">${esc(r.notes)}</p>` : ''}
      <button type="button" class="btn btn-small card-delete" data-action="delete-relationship" data-id="${attr(r.id)}">Delete</button>
    </li>`;
  }

  container.innerHTML = `
    ${outgoing.length ? `<h3 style="margin:0 0 8px;font-size:13px">Outgoing</h3><ul class="rel-list">${outgoing.map((r) => relRow(r, r.targetEntityId, '→')).join('')}</ul>` : ''}
    ${incoming.length ? `<h3 style="margin:${outgoing.length ? '18px' : '0'} 0 8px;font-size:13px">Incoming</h3><ul class="rel-list">${incoming.map((r) => relRow(r, r.sourceEntityId, '←')).join('')}</ul>` : ''}
  `;
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-relationship"]');
  if (!btn) return;
  await deleteRelationship(btn.dataset.id);
  const entity = currentProfileEntity();
  if (entity) await renderEntityRelationships(entity, lastSubjectsEntities);
});

document.querySelector('#relationshipForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const entity = currentProfileEntity();
  if (!entity || !activeInvestigationId) return;
  const direction = document.querySelector('#relationshipDirectionSelect').value;
  const targetId = document.querySelector('#relationshipTargetSelect').value;
  const type = document.querySelector('#relationshipTypeInput').value;
  const status = document.querySelector('#relationshipStatusSelect').value;
  const dateStart = document.querySelector('#relationshipDateStart').value;
  const dateEnd = document.querySelector('#relationshipDateEnd').value;
  const notes = document.querySelector('#relationshipNotes').value;
  const evidenceIds = [...document.querySelectorAll('#relationshipEvidencePicker input[type="checkbox"]:checked')].map((cb) => cb.dataset.evidenceId);

  if (!targetId) { showToast('Add another subject first.', true); return; }

  const sourceEntityId = direction === 'outgoing' ? entity.id : targetId;
  const targetEntityId = direction === 'outgoing' ? targetId : entity.id;

  try {
    await createRelationship(activeInvestigationId, { sourceEntityId, targetEntityId, type, status, evidenceIds, dateStart, dateEnd, notes });
    document.querySelector('#relationshipForm').reset();
    updateRelationshipSubmitState();
    await renderEntityRelationships(entity, lastSubjectsEntities);
    showToast('Added relationship.');
  } catch (err) {
    // Reaches here only if something got past the disabled-button guard
    // (e.g. the evidence picker was empty because there's no evidence at
    // all yet) - db.js's rejection is still the thing that actually
    // stopped the write; this just surfaces why. err instanceof
    // RelationshipValidationError for anything thrown by
    // createRelationship()/validateRelationshipFields.
    showToast(err.message || 'Could not add relationship.', true);
  }
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
  const [outline, records, evidenceItems, claims, quantFindings, qualFindings, crossValidations, cachedAnalysis, claimFindings] = await Promise.all([
    getOutline(activeInvestigationId),
    listInvestigationRecords(activeInvestigationId),
    listEvidenceItems(activeInvestigationId),
    listClaims(activeInvestigationId),
    listQuantitativeFindings(activeInvestigationId),
    listQualitativeFindings(activeInvestigationId),
    listCrossValidations(activeInvestigationId),
    getQualitativeAnalysis(activeInvestigationId),
    listClaimFindings(activeInvestigationId)
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

  // 8. Claims (the reasoning unit reports are actually built from) - a
  // Claim with excludedFromReport stays fully intact everywhere else
  // (Findings > Claims, its Evidence Items) but is left out of the Report
  // itself, per Ask Sources' "remove this from the report but keep it as
  // evidence" command (public/db.js updateClaim). Evidence links now come
  // from the claimEvidence store (Phase 3), not the deprecated inline
  // `claim.links` array.
  const evById = new Map(evidenceItems.map((e) => [e.id, e]));
  const recById = new Map(records.map((r) => [r.id, r]));
  const reportClaims = claims.filter((c) => !c.excludedFromReport);
  const excludedCount = claims.length - reportClaims.length;
  if (reportClaims.length) {
    const linkLists = await Promise.all(reportClaims.map((c) => listClaimEvidenceForClaim(activeInvestigationId, c.id)));
    const claimsHtml = reportClaims.map((claim, i) => {
      const status = claim.status || 'UNVERIFIED';
      const evidenceHtml = linkLists[i].map((l) => {
        const ev = evById.get(l.evidenceId);
        if (!ev) return '';
        const src = recById.get(ev.sourceRecordId);
        return `<div class="report-evidence"><span class="stance-tag ${esc(l.stance)}">${esc(EVIDENCE_STANCE_LABELS[l.stance] || l.stance)}</span>${esc(ev.excerptText)}<p>${src ? esc(src.title || src.originalUrl || 'Untitled source') : 'Source unavailable'}${ev.location ? ' · ' + esc(ev.location) : ''}</p></div>`;
      }).join('');
      return `<article class="report-claim"><p class="report-claim-id">${esc(claim.claimId)} · ${esc(CLAIM_STATUS_LABELS[status] || status)}</p><h3>${esc(claim.text)}</h3>${evidenceHtml || '<p class="hint">No evidence linked to this claim yet.</p>'}</article>`;
    }).join('');
    sections.push(`<section class="report-section"><h2>Claims</h2>${excludedCount ? `<p class="hint">${excludedCount} claim${excludedCount === 1 ? '' : 's'} kept as evidence but excluded from this report.</p>` : ''}${claimsHtml}</section>`);
  } else if (excludedCount) {
    sections.push(`<section class="report-section"><h2>Claims</h2><p class="hint">${excludedCount} claim${excludedCount === 1 ? '' : 's'} kept as evidence but excluded from this report — see Findings &gt; Claims.</p></section>`);
  } else {
    sections.push(`<section class="report-section"><h2>Claims</h2><p class="hint">No claims yet — add claims backed by evidence on the <a href="#/workspace/findings/claims" data-route="/workspace/findings">Findings</a> tab.</p></section>`);
  }

  // 9. Findings (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 3) - the
  // investigator's evidence-backed conclusions, kept visually and
  // structurally distinct from the Claims they answer. A DOCUMENTED_FACT/
  // SUPPORTED_INFERENCE/ALLEGATION finding here is GUARANTEED to cite real
  // evidence (public/db.js createClaimFinding()/updateClaimFinding()
  // enforce this at write time), so the report never has to re-check.
  if (claimFindings.length) {
    const claimByIdForFindings = new Map(claims.map((c) => [c.id, c]));
    const findingsHtml = claimFindings.map((f) => {
      const claim = claimByIdForFindings.get(f.claimId);
      const evidenceHtml = (f.evidenceIds || []).map((id) => {
        const ev = evById.get(id);
        if (!ev) return '';
        const src = recById.get(ev.sourceRecordId);
        return `<div class="report-evidence">${esc(ev.excerptText)}<p>${src ? esc(src.title || src.originalUrl || 'Untitled source') : 'Source unavailable'}${ev.location ? ' · ' + esc(ev.location) : ''}</p></div>`;
      }).join('');
      return `<article class="report-claim"><p class="report-claim-id">${esc(FINDING_CLASSIFICATION_LABELS[f.classification])}${claim ? ` on ${esc(claim.claimId)}` : ''}</p><h3>${esc(f.conclusion)}</h3>${evidenceHtml}</article>`;
    }).join('');
    sections.push(`<section class="report-section"><h2>Findings</h2>${findingsHtml}</section>`);
  }

  try {
    const recSnap = await readInvestigationForExport(activeInvestigationId);
    if (recSnap && (recSnap.records || []).length) sections.push(`<section class="report-section">${recoveryHtml(buildRecoveryModel(recSnap), { headingLevel: 2, id: 'rr-report' })}</section>`);
  } catch { /* the rest of the report still stands */ }
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
      if (!res.ok || data.ok === false) throw new Error(apiErrorMessage(res, data, 'Analysis failed.'));
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
