// Review Queue tab (docs/INVESTIGATION_WORKSPACE_PLAN.md Phase 4): turns
// bulk-ingested documents into a triage workflow instead of a wall of
// unread text. This is the first module in the app that owns its own DOM
// state and event wiring rather than being a pure renderer app.js calls
// into (public/citations.js, public/artifacts.js) - a deliberate choice,
// made because this tab's interactivity (filters, pagination, a
// multi-action detail panel, Next/Previous triage) is large enough to
// warrant its own self-contained module now that app.js has grown past
// 3,300 lines. app.js's routing dispatch calls exactly one entry point:
// renderReviewQueuePanel(investigationId).
//
// THE HARD RULE this file exists to protect: automation may only ever
// SURFACE a possibility (docs/db.js's scanRecordForReview already
// enforces this on the write side - see its header). This file's job is
// to make confirming a candidate require an explicit click on ONE of the
// possibilities Chronium found, never a default, never auto-selected -
// see renderCandidateRow() below.
import {
  listInvestigationRecords, listIngestionBatches,
  listIngestionItemsPage, countIngestionItemsByStatus, updateIngestionItem, searchIngestionItems,
  listReviewCandidatesForRecord, confirmReviewCandidate, rejectReviewCandidate,
  listWatchlistMatchesForRecord, createWatchlist, listWatchlists, deleteWatchlist,
  confirmWatchlistMatch, dismissWatchlistMatch,
  listEntities, createEntity,
  listClaims, createClaimEvidence,
  createInvestigator, listInvestigators,
  recordReviewHistory
} from './db.js';
import { ITEM_STATUSES, ITEM_STATUS_LABELS, CANDIDATE_STATES, WATCHLIST_TYPES, WATCHLIST_TYPE_LABELS } from './ingestionReview.js';
import { ENTITY_TYPES, ENTITY_TYPE_LABELS } from './entities.js';
import { esc, attr, formatBytes, formatDate, showToast } from './app.js';
import { confirmDialog } from './ui.js';

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Module state - scoped to whichever investigation is currently open.
// Reset at the top of every renderReviewQueuePanel() call.
// ---------------------------------------------------------------------------
let invId = null;
let recordsById = new Map();
let entitiesById = new Map();
let entitiesList = [];
let claimsList = [];
let queueItems = []; // accumulated pages, newest first
let afterId = null; // pagination cursor into ingestionItems
let hasMore = true;
let filters = { status: '', batchId: '', candidates: '', watchlist: '', flaggedOnly: false, search: '' };
let currentDetailIndex = -1; // index into the FILTERED view currently shown

function currentInvestigator() { return localStorage.getItem('chronium.activeInvestigator') || null; }

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export async function renderReviewQueuePanel(investigationId) {
  invId = investigationId;
  const [records, entities, claims] = await Promise.all([listInvestigationRecords(investigationId), listEntities(investigationId), listClaims(investigationId)]);
  recordsById = new Map(records.map((r) => [r.id, r]));
  entitiesById = new Map(entities.map((e) => [e.id, e]));
  entitiesList = entities;
  claimsList = claims;

  renderStatusFilterOptions();
  await renderStatusCounts();
  await renderBatchFilterOptions();
  await renderWatchlistTypeOptions();
  renderNewSubjectTypeOptions();
  await renderWatchlistPanel();
  await renderInvestigatorPicker();

  queueItems = [];
  afterId = null;
  hasMore = true;
  await loadNextPage();
  renderQueueList();

  document.querySelector('#reviewQueueListView').classList.remove('hidden');
  document.querySelector('#reviewDetailView').classList.add('hidden');
}

function renderStatusFilterOptions() {
  const select = document.querySelector('#reviewFilterStatus');
  if (!select.options.length) {
    select.innerHTML = '<option value="">All statuses</option>' + ITEM_STATUSES.map((s) => `<option value="${attr(s)}">${esc(ITEM_STATUS_LABELS[s])}</option>`).join('');
    select.value = 'READY_FOR_REVIEW'; // the queue's actual working state, not the noisier "everything"
    filters.status = 'READY_FOR_REVIEW';
  }
}

async function renderStatusCounts() {
  const counts = await countIngestionItemsByStatus(invId);
  const container = document.querySelector('#reviewStatusCounts');
  container.innerHTML = [
    { label: 'Unreviewed', value: counts.READY_FOR_REVIEW || 0 },
    { label: 'Flagged', value: counts.FLAGGED || 0 },
    { label: 'Reviewed', value: counts.REVIEWED || 0 },
    { label: 'Failed', value: counts.FAILED || 0 },
    { label: 'Duplicates skipped', value: counts.SKIPPED || 0 },
    { label: 'Total', value: counts.TOTAL || 0 }
  ].map((s) => `<div><strong>${esc(String(s.value))}</strong><p>${esc(s.label)}</p></div>`).join('');
}

async function renderBatchFilterOptions() {
  const select = document.querySelector('#reviewFilterBatch');
  const batches = await listIngestionBatches(invId);
  const current = select.value;
  select.innerHTML = '<option value="">All batches</option>' + batches.map((b) => `<option value="${attr(b.id)}">${esc(b.label)} (${esc(formatDate(b.createdAt))})</option>`).join('');
  select.value = current;
}

function renderWatchlistTypeOptions() {
  const select = document.querySelector('#watchlistTypeSelect');
  if (!select.options.length) select.innerHTML = WATCHLIST_TYPES.map((t) => `<option value="${attr(t)}">${esc(WATCHLIST_TYPE_LABELS[t])}</option>`).join('');
}

// ---------------------------------------------------------------------------
// Queue list: paginated (Phase 4 brief §17 - must not freeze at scale),
// filtered client-side over each fetched page rather than via a compound
// index per filter combination - reasonable at this app's scale (a few
// hundred items per page), matching the "do not optimize prematurely, but
// document obvious bottlenecks" instruction. A richer investigation
// (tens of thousands of items) would want server-side/indexed filtering
// for date range and document type specifically; those two filters are
// deliberately NOT implemented this phase since bulk-imported local files
// rarely carry a reliable date, and are the two the brief's list weighs
// least for THIS ingestion path (see the plan doc's as-built notes).
// ---------------------------------------------------------------------------
async function loadNextPage() {
  if (!hasMore) return;
  const statusFilter = filters.status || undefined;
  const page = await listIngestionItemsPage(invId, { statusFilter, limit: PAGE_SIZE, afterId });
  if (page.length < PAGE_SIZE) hasMore = false;
  if (page.length) afterId = page[page.length - 1].id;
  queueItems = queueItems.concat(page);
}

function filteredItems() {
  return queueItems.filter((item) => {
    if (filters.batchId && item.jobId !== filters.batchId) return false;
    if (filters.flaggedOnly && !item.flagged) return false;
    return true;
  });
}

// Whichever base list the other filters apply on top of. A non-empty
// search term switches from the paginated queueItems (only whatever's
// been scrolled/loaded-more into) to a real, bounded scan of the ENTIRE
// (optionally status-filtered) queue via searchIngestionItems() -
// otherwise a search could silently miss a match that just hasn't been
// paged in yet (found by this phase's own 1,000-record scale test).
async function baseItemsForList() {
  if (filters.search.trim()) {
    return searchIngestionItems(invId, filters.search, { statusFilter: filters.status || undefined, limit: 200 })
      .then((rows) => rows.filter((item) => {
        if (filters.batchId && item.jobId !== filters.batchId) return false;
        if (filters.flaggedOnly && !item.flagged) return false;
        return true;
      }));
  }
  return filteredItems();
}

// candidates/watchlist filters need a per-item lookup (not on the item
// itself), so they're applied asynchronously when rendering rather than
// in the synchronous filteredItems() above.
async function applyAsyncFilters(items) {
  if (!filters.candidates && !filters.watchlist) return items;
  const withMeta = await Promise.all(items.map(async (item) => {
    if (!item.recordId) return { item, candidates: [], matches: [] };
    const [candidates, matches] = await Promise.all([
      listReviewCandidatesForRecord(invId, item.recordId),
      listWatchlistMatchesForRecord(invId, item.recordId)
    ]);
    return { item, candidates, matches };
  }));
  return withMeta.filter(({ candidates, matches }) => {
    if (filters.candidates === 'has' && !candidates.length) return false;
    if (filters.candidates === 'ambiguous' && !candidates.some((c) => c.state === 'AMBIGUOUS')) return false;
    if (filters.candidates === 'none' && candidates.length) return false;
    if (filters.watchlist === 'has' && !matches.length) return false;
    if (filters.watchlist === 'none' && matches.length) return false;
    return true;
  }).map(({ item }) => item);
}

async function renderQueueList() {
  const container = document.querySelector('#reviewQueueList');
  const requestedSearch = filters.search; // captured before any await - compared again below
  const filtered = await applyAsyncFilters(await baseItemsForList());
  // A newer call (a later keystroke's debounced search, or a filter
  // change) may have started and even finished WHILE this one's own
  // async scan was still running - if the search box no longer holds
  // what THIS call was searching for, a more current render already
  // owns the screen (or is about to), so bail rather than overwrite it
  // with a stale result.
  if (document.querySelector('#reviewSearchInput').value !== requestedSearch) return;
  if (!filtered.length) { container.innerHTML = '<p class="status">Nothing here — adjust filters, or bulk-import documents on the Research tab.</p>'; return; }

  const rows = await Promise.all(filtered.map(async (item) => {
    const record = item.recordId ? recordsById.get(item.recordId) : null;
    const [candidates, matches] = item.recordId ? await Promise.all([
      listReviewCandidatesForRecord(invId, item.recordId), listWatchlistMatchesForRecord(invId, item.recordId)
    ]) : [[], []];
    const unresolvedCandidates = candidates.filter((c) => c.state === 'UNREVIEWED' || c.state === 'AMBIGUOUS').length;
    const title = record?.title || item.sourceFilename || 'Untitled';
    return `<article class="evidence-card">
      <p class="evidence-card-meta">
        <span class="status-badge status-${esc(item.status.toLowerCase().replace(/_/g, '-'))}">${esc(ITEM_STATUS_LABELS[item.status] || item.status)}</span>
        ${item.flagged ? '<span class="fact-badge fact-badge-lead">Flagged</span>' : ''}
        ${item.error ? `<span class="hint">${esc(item.error)}</span>` : ''}
      </p>
      <p><strong>${esc(title)}</strong></p>
      ${record?.snippet ? `<p class="hint">${esc(record.snippet.slice(0, 160))}${record.snippet.length > 160 ? '…' : ''}</p>` : ''}
      <p class="hint">${unresolvedCandidates ? `${unresolvedCandidates} possible subject${unresolvedCandidates === 1 ? '' : 's'}` : 'No subject candidates'}${matches.length ? ` · ${matches.length} watchlist hit${matches.length === 1 ? '' : 's'}` : ''}</p>
      <button type="button" class="btn btn-small" data-action="open-review-item" data-id="${attr(item.id)}">Open</button>
    </article>`;
  }));
  if (document.querySelector('#reviewSearchInput').value !== requestedSearch) return; // re-checked - the per-item lookups above were also awaited
  container.innerHTML = rows.join('');
  // Search results are a bounded one-shot scan (searchIngestionItems),
  // not paginated via hasMore/afterId - Load More has nothing to add
  // while a search is active.
  document.querySelector('#reviewLoadMoreBtn').classList.toggle('hidden', !hasMore || !!filters.search.trim());
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="open-review-item"]');
  if (!btn) return;
  await openDetail(btn.dataset.id);
});

document.querySelector('#reviewLoadMoreBtn')?.addEventListener('click', async () => {
  await loadNextPage();
  await renderQueueList();
});

function wireFilterControl(id, key, isCheckbox) {
  const el = document.querySelector(id);
  el?.addEventListener(isCheckbox ? 'change' : el.tagName === 'SELECT' ? 'change' : 'input', async () => {
    filters[key] = isCheckbox ? el.checked : el.value;
    queueItems = []; afterId = null; hasMore = true;
    await loadNextPage();
    await renderQueueList();
  });
}
wireFilterControl('#reviewFilterStatus', 'status', false);
wireFilterControl('#reviewFilterBatch', 'batchId', false);
wireFilterControl('#reviewFilterCandidates', 'candidates', false);
wireFilterControl('#reviewFilterWatchlist', 'watchlist', false);
wireFilterControl('#reviewFilterFlagged', 'flaggedOnly', true);
// Debounced: each search now scans the FULL (possibly thousands-of-items)
// queue via searchIngestionItems, not just an in-memory filter - at that
// cost, firing one scan per keystroke would mean slower, earlier scans
// can resolve AFTER faster, later ones, flashing a stale result onto
// screen. Same failure class the Subjects search box had in Phase 1,
// fixed the same way: wait for typing to pause before searching at all.
// renderQueueList() itself also guards its final DOM write against being
// superseded (see there) as a second line of defense for any lingering
// in-flight scan.
let searchDebounceTimer = null;
document.querySelector('#reviewSearchInput')?.addEventListener('input', (e) => {
  filters.search = e.target.value;
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => { renderQueueList(); }, 250);
});

// ---------------------------------------------------------------------------
// Detail / fast-triage panel (Phase 4 brief §13): Open item -> scan
// passage -> confirm/reject candidates -> mark reviewed -> next item,
// with Previous/Next cycling the CURRENT filtered list by index so a
// reviewer never has to return to the list between items.
// ---------------------------------------------------------------------------
async function openDetail(itemId) {
  const filtered = await applyAsyncFilters(await baseItemsForList());
  const idx = filtered.findIndex((i) => i.id === itemId);
  if (idx < 0) return;
  currentDetailIndex = idx;
  await renderDetail(filtered);
}

async function renderDetail(filteredList) {
  const item = filteredList[currentDetailIndex];
  if (!item) return;
  document.querySelector('#reviewQueueListView').classList.add('hidden');
  document.querySelector('#reviewDetailView').classList.remove('hidden');
  document.querySelector('#reviewDetailView').dataset.itemId = item.id;

  const record = item.recordId ? recordsById.get(item.recordId) : null;
  document.querySelector('#reviewDetailHead').innerHTML = `
    <p class="eyebrow">${esc(ITEM_STATUS_LABELS[item.status] || item.status)}${item.flagged ? ' · Flagged' : ''}</p>
    <h1 style="margin:0 0 8px;font-size:20px">${esc(record?.title || item.sourceFilename || 'Untitled')}</h1>
    ${record?.captureDate ? `<p class="hint">${esc(formatDate(record.captureDate))}</p>` : ''}
    ${item.metadata?.extractionUnavailable ? '<p class="status status-warn">Content extraction unavailable for this file type — open the source directly to review it.</p>' : ''}
    ${record?.extractedText ? `<details class="research-sources-details"><summary>Full text</summary><p style="white-space:pre-wrap;max-height:300px;overflow-y:auto">${esc(record.extractedText.slice(0, 5000))}${record.extractedText.length > 5000 ? '…' : ''}</p></details>` : ''}
  `;

  const [candidates, matches] = item.recordId ? await Promise.all([
    listReviewCandidatesForRecord(invId, item.recordId), listWatchlistMatchesForRecord(invId, item.recordId)
  ]) : [[], []];
  renderCandidatesList(candidates);
  renderWatchlistMatchesList(matches);
  document.querySelector('#reviewNotesInput').value = item.reviewNotes || '';
  document.querySelector('#reviewPrevBtn').disabled = currentDetailIndex <= 0;
  document.querySelector('#reviewNextBtn').disabled = currentDetailIndex >= filteredList.length - 1;
}

// Never a single button that "confirms" without saying which entity - an
// AMBIGUOUS or multi-candidate row always shows every possibility as its
// own explicit choice (Phase 4 brief §6: "It must NOT pick one
// automatically"). A single-possibility row still requires the one
// Confirm click; nothing here is pre-selected.
function renderCandidatesList(candidates) {
  const container = document.querySelector('#reviewCandidatesList');
  if (!candidates.length) { container.innerHTML = '<p class="status">No possible subjects detected in this document.</p>'; return; }
  container.innerHTML = candidates.map((c) => {
    const options = c.candidateEntityIds.map((id) => {
      const e = entitiesById.get(id);
      return e ? `<button type="button" class="btn btn-small" data-action="confirm-candidate" data-id="${attr(c.id)}" data-entity="${attr(id)}">Confirm as ${esc(e.name)}</button>` : '';
    }).join(' ');
    const resolvedLabel = c.state === 'CONFIRMED' ? `Confirmed: ${esc(entitiesById.get(c.confirmedEntityId)?.name || 'Entity removed')}` : c.state === 'REJECTED' ? 'Rejected' : '';
    // A confirmed candidate's new Evidence Item can be linked straight to
    // an existing Claim from here (Phase 4 brief §4 "link evidence to
    // Claim") - going through the same createClaimEvidence() API a human
    // would use from Findings > Claims, never a shortcut around it.
    const claimLinkHtml = c.state === 'CONFIRMED' && c.confirmedEvidenceId
      ? (claimsList.length
          ? `<div class="field-row" style="align-items:flex-end;margin-top:6px">
              <div class="field"><label for="claimLinkSelect-${attr(c.id)}">Link this evidence to a claim</label>
                <select id="claimLinkSelect-${attr(c.id)}">${claimsList.map((cl) => `<option value="${attr(cl.id)}">${esc(cl.claimId)} — ${esc(cl.text.slice(0, 50))}${cl.text.length > 50 ? '…' : ''}</option>`).join('')}</select>
              </div>
              <select data-stance-picker="${attr(c.id)}" aria-label="Stance"><option value="supports">Supports</option><option value="contradicts">Contradicts</option><option value="contextualizes">Contextualizes</option></select>
              <button type="button" class="btn btn-small" data-action="link-candidate-to-claim" data-id="${attr(c.id)}" data-evidence="${attr(c.confirmedEvidenceId)}">Link</button>
            </div>`
          : '<p class="hint">No claims yet to link to — add one on the Findings tab.</p>')
      : '';
    return `<div class="rel-row">
      <span class="fact-badge ${c.state === 'AMBIGUOUS' ? 'fact-badge-lead' : c.state === 'CONFIRMED' ? 'fact-badge-confirmed' : c.state === 'REJECTED' ? 'fact-badge-unresolved' : ''}">${esc(c.state)}</span>
      <strong>“${esc(c.matchedText)}”</strong>
      <p class="hint">${esc(c.snippet)}</p>
      ${c.state === 'UNREVIEWED' || c.state === 'AMBIGUOUS' ? `<div class="dialog-actions dialog-actions-inline" style="flex-wrap:wrap">${options} <button type="button" class="btn btn-small" data-action="reject-candidate" data-id="${attr(c.id)}">Not a match</button></div>` : `<p class="hint">${resolvedLabel}</p>${claimLinkHtml}`}
    </div>`;
  }).join('');
}

function renderWatchlistMatchesList(matches) {
  const container = document.querySelector('#reviewWatchlistMatchesList');
  if (!matches.length) { container.innerHTML = '<p class="status">No watchlist hits in this document.</p>'; return; }
  container.innerHTML = matches.map((m) => `<div class="rel-row">
    <span class="fact-badge ${m.state === 'CONFIRMED' ? 'fact-badge-confirmed' : m.state === 'REJECTED' ? 'fact-badge-unresolved' : ''}">${esc(m.state)}</span>
    <strong>“${esc(m.matchedText)}”</strong>
    <p class="hint">${esc(m.snippet)}</p>
    ${m.state === 'UNREVIEWED' ? `<div class="dialog-actions dialog-actions-inline"><button type="button" class="btn btn-small" data-action="confirm-watchlist-match" data-id="${attr(m.id)}">Acknowledge</button><button type="button" class="btn btn-small" data-action="dismiss-watchlist-match" data-id="${attr(m.id)}">Dismiss</button></div>` : ''}
  </div>`).join('');
}

async function refreshDetailInPlace() {
  const filtered = await applyAsyncFilters(await baseItemsForList());
  const item = document.querySelector('#reviewDetailView').dataset.itemId;
  const idx = filtered.findIndex((i) => i.id === item);
  if (idx >= 0) { currentDetailIndex = idx; await renderDetail(filtered); }
}

document.addEventListener('click', async (e) => {
  const confirmBtn = e.target.closest('[data-action="confirm-candidate"]');
  if (confirmBtn) {
    try {
      await confirmReviewCandidate(invId, confirmBtn.dataset.id, { entityId: confirmBtn.dataset.entity, reviewedBy: currentInvestigator() });
      showToast('Confirmed - evidence and mention created.');
      await refreshDetailInPlace();
    } catch (err) { showToast(err.message || 'Could not confirm candidate.', true); }
    return;
  }
  const rejectBtn = e.target.closest('[data-action="reject-candidate"]');
  if (rejectBtn) {
    await rejectReviewCandidate(invId, rejectBtn.dataset.id, { reviewedBy: currentInvestigator() });
    await refreshDetailInPlace();
    return;
  }
  const linkBtn = e.target.closest('[data-action="link-candidate-to-claim"]');
  if (linkBtn) {
    const claimSelect = document.querySelector(`#claimLinkSelect-${CSS.escape(linkBtn.dataset.id)}`);
    const stanceSelect = document.querySelector(`[data-stance-picker="${linkBtn.dataset.id}"]`);
    try {
      await createClaimEvidence(invId, { claimId: claimSelect.value, evidenceId: linkBtn.dataset.evidence, stance: stanceSelect.value });
      showToast('Linked to claim.');
      await recordReviewHistory(invId, { action: 'evidence_linked_to_claim', actor: currentInvestigator(), objectType: 'claimEvidence', objectId: claimSelect.value, newValue: linkBtn.dataset.evidence });
    } catch (err) { showToast(err.message || 'Could not link to claim.', true); }
    return;
  }
  const confirmMatchBtn = e.target.closest('[data-action="confirm-watchlist-match"]');
  if (confirmMatchBtn) {
    await confirmWatchlistMatch(invId, confirmMatchBtn.dataset.id, { reviewedBy: currentInvestigator() });
    await refreshDetailInPlace();
    return;
  }
  const dismissMatchBtn = e.target.closest('[data-action="dismiss-watchlist-match"]');
  if (dismissMatchBtn) {
    await dismissWatchlistMatch(invId, dismissMatchBtn.dataset.id, { reviewedBy: currentInvestigator() });
    await refreshDetailInPlace();
    return;
  }
});

document.querySelector('#reviewBackToQueue')?.addEventListener('click', async (e) => {
  e.preventDefault();
  document.querySelector('#reviewDetailView').classList.add('hidden');
  document.querySelector('#reviewQueueListView').classList.remove('hidden');
  await renderStatusCounts();
  await renderQueueList();
});

async function stepDetail(delta) {
  const filtered = await applyAsyncFilters(await baseItemsForList());
  const next = currentDetailIndex + delta;
  if (next < 0 || next >= filtered.length) return;
  currentDetailIndex = next;
  await renderDetail(filtered);
}
document.querySelector('#reviewPrevBtn')?.addEventListener('click', () => stepDetail(-1));
document.querySelector('#reviewNextBtn')?.addEventListener('click', () => stepDetail(1));

document.querySelector('#reviewSkipBtn')?.addEventListener('click', () => stepDetail(1));

document.querySelector('#reviewFlagBtn')?.addEventListener('click', async () => {
  const itemId = document.querySelector('#reviewDetailView').dataset.itemId;
  const item = queueItems.find((i) => i.id === itemId);
  if (!item) return;
  const updated = await updateIngestionItem(itemId, { flagged: !item.flagged });
  Object.assign(item, updated);
  await recordReviewHistory(invId, { action: item.flagged ? 'item_flagged' : 'item_unflagged', actor: currentInvestigator(), objectType: 'ingestionItem', objectId: itemId });
  showToast(item.flagged ? 'Flagged for follow-up.' : 'Unflagged.');
  await refreshDetailInPlace();
});

document.querySelector('#reviewMarkReviewedBtn')?.addEventListener('click', async () => {
  const itemId = document.querySelector('#reviewDetailView').dataset.itemId;
  const item = queueItems.find((i) => i.id === itemId);
  if (!item) return;
  const notes = document.querySelector('#reviewNotesInput').value;
  const updated = await updateIngestionItem(itemId, { status: 'REVIEWED', reviewNotes: notes, reviewedAt: new Date().toISOString(), reviewedBy: currentInvestigator() });
  Object.assign(item, updated);
  await recordReviewHistory(invId, { action: 'item_reviewed', actor: currentInvestigator(), objectType: 'ingestionItem', objectId: itemId });
  showToast('Marked reviewed.');
  const filtered = await applyAsyncFilters(await baseItemsForList());
  if (currentDetailIndex < filtered.length - 1 + 1 && filtered.some((i) => i.id !== itemId)) {
    // Advance to the next still-matching item rather than closing the panel -
    // "Mark reviewed" is meant to feed straight into the next triage.
    const stillFiltered = filtered.filter((i) => i.status !== 'REVIEWED' || !filters.status || filters.status !== 'READY_FOR_REVIEW');
    if (stillFiltered.length) { currentDetailIndex = Math.min(currentDetailIndex, stillFiltered.length - 1); await renderDetail(stillFiltered); return; }
  }
  document.querySelector('#reviewBackToQueue').click();
});

function renderNewSubjectTypeOptions() {
  const select = document.querySelector('#reviewNewSubjectType');
  if (select && !select.options.length) select.innerHTML = ENTITY_TYPES.map((t) => `<option value="${attr(t)}">${esc(ENTITY_TYPE_LABELS[t])}</option>`).join('');
}
document.querySelector('#reviewCreateSubjectForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!invId) return;
  const name = document.querySelector('#reviewNewSubjectName').value.trim();
  const type = document.querySelector('#reviewNewSubjectType').value;
  if (!name) return;
  try {
    const entity = await createEntity(invId, { type, name });
    entitiesList = [...entitiesList, entity];
    entitiesById.set(entity.id, entity);
    document.querySelector('#reviewCreateSubjectForm').reset();
    showToast(`Created subject "${entity.name}". Future imports will detect them; link this passage manually from the Evidence tab if needed.`);
  } catch (err) { showToast(err.message || 'Could not create subject.', true); }
});

// ---------------------------------------------------------------------------
// Watchlist management
// ---------------------------------------------------------------------------
async function renderWatchlistPanel() {
  const container = document.querySelector('#watchlistList');
  const rows = await listWatchlists(invId);
  container.innerHTML = rows.length
    ? rows.map((w) => `<span class="alias-chip">${esc(w.term)} <span class="hint">(${esc(WATCHLIST_TYPE_LABELS[w.type] || w.type)})</span> <button type="button" class="alias-chip-remove" data-action="delete-watchlist" data-id="${attr(w.id)}" aria-label="Remove watchlist term ${esc(w.term)}">×</button></span>`).join('')
    : '<p class="hint">No watchlist terms yet.</p>';
}
document.querySelector('#watchlistForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!invId) return;
  const term = document.querySelector('#watchlistTermInput').value.trim();
  const type = document.querySelector('#watchlistTypeSelect').value;
  if (!term) return;
  try {
    await createWatchlist(invId, { term, type });
    document.querySelector('#watchlistForm').reset();
    await renderWatchlistPanel();
    showToast('Added watchlist term. New matches appear on future imports.');
  } catch (err) { showToast(err.message || 'Could not add watchlist term.', true); }
});
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-watchlist"]');
  if (!btn || !invId) return;
  await deleteWatchlist(btn.dataset.id);
  await renderWatchlistPanel();
});

// ---------------------------------------------------------------------------
// Investigator picker - not authentication (see file header import comment
// and db.js's own header on the `investigators` store).
// ---------------------------------------------------------------------------
async function renderInvestigatorPicker() {
  const select = document.querySelector('#investigatorSelect');
  const investigators = await listInvestigators();
  const current = localStorage.getItem('chronium.activeInvestigator') || '';
  select.innerHTML = '<option value="">Not set</option>' + investigators.map((i) => `<option value="${attr(i.id)}">${esc(i.displayName)}</option>`).join('');
  select.value = current;
}
document.querySelector('#investigatorSelect')?.addEventListener('change', (e) => {
  if (e.target.value) localStorage.setItem('chronium.activeInvestigator', e.target.value);
  else localStorage.removeItem('chronium.activeInvestigator');
});
document.querySelector('#addInvestigatorBtn')?.addEventListener('click', async () => {
  const input = document.querySelector('#investigatorNameInput');
  const displayName = input.value.trim();
  if (!displayName) return;
  try {
    const investigator = await createInvestigator({ displayName });
    input.value = '';
    await renderInvestigatorPicker();
    document.querySelector('#investigatorSelect').value = investigator.id;
    localStorage.setItem('chronium.activeInvestigator', investigator.id);
    showToast(`Now reviewing as ${investigator.displayName}.`);
  } catch (err) { showToast(err.message || 'Could not add investigator.', true); }
});
