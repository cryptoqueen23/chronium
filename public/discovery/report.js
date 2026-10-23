// Deep Discovery: accessible progress and status UI pieces, shared by the
// website and the extension (Phase 1 wires them into the product screens).
// mountProgress() builds the structure once and updates nodes in place, so the
// polite live region is announced reliably; controls are real buttons with a
// visible state, operable by keyboard. Everything is escaped. No colour-only
// meaning.
import { OUTCOME_LABEL, OUTCOME_MEANING } from './outcomes.js';

const STATE_LABEL = { idle: 'Not started', preparing: 'Preparing', running: 'Running', paused: 'Paused', finished: 'Finished', cancelled: 'Cancelled', refused: 'Not started', error: 'Stopped by an error' };
const fmtDuration = (ms) => { const s = Math.round(ms / 1000); if (s < 90) return `${s} seconds`; const m = Math.round(s / 60); return m < 90 ? `${m} minutes` : `${(m / 60).toFixed(1)} hours`; };

export function mountProgress(container, { onPause, onResume, onCancel, id = 'dc' } = {}) {
  const doc = container.ownerDocument;
  container.innerHTML = `<section class="dc-progress" aria-labelledby="${id}-h">
    <h3 id="${id}-h">Document search progress</h3>
    <p id="${id}-status" class="dc-status" role="status" aria-live="polite"></p>
    <p><label for="${id}-bar">Progress</label> <progress id="${id}-bar" max="1" value="0"></progress></p>
    <dl class="dc-stats"><dt>State</dt><dd id="${id}-state"></dd><dt>Sources searched</dt><dd id="${id}-src"></dd><dt>Documents found</dt><dd id="${id}-found"></dd><dt>Documents retrieved</dt><dd id="${id}-got"></dd><dt>Historical copies found</dt><dd id="${id}-hist"></dd><dt>Sources unavailable</dt><dd id="${id}-unav"></dd><dt>Not located in the sources searched</dt><dd id="${id}-nl"></dd><dt>Requests made</dt><dd id="${id}-req"></dd><dt>Estimated time left</dt><dd id="${id}-eta"></dd><dt>Downloaded</dt><dd id="${id}-bytes"></dd></dl>
    <p class="dc-controls"><button type="button" id="${id}-pause">Pause</button> <button type="button" id="${id}-resume">Resume</button> <button type="button" id="${id}-cancel">Cancel</button></p>
  </section>`;
  const $ = (s) => container.querySelector(`#${id}-${s}`);
  $('pause').addEventListener('click', () => onPause && onPause());
  $('resume').addEventListener('click', () => onResume && onResume());
  $('cancel').addEventListener('click', () => onCancel && onCancel());
  return {
    update(p) {
      if ($('status').textContent !== p.message) $('status').textContent = p.message;
      const planned = Math.max(p.pagesPlanned || 0, 1);
      const inDocs = p.phase === 'documents';
      const total = inDocs ? Math.max(p.documentsPlanned || 0, 1) : planned; const progressed = inDocs ? (p.documentsDone || 0) : (p.pagesFetched || 0);
      $('bar').max = total; $('bar').value = Math.min(progressed, total);
      $('bar').setAttribute('aria-valuetext', inDocs ? `${p.documentsDone} of ${p.documentsPlanned} documents` : `${p.pagesFetched} of about ${p.pagesPlanned} pages`);
      $('state').textContent = STATE_LABEL[p.state] || p.state;
      $('src').textContent = `${p.host || 'starting'}${p.phase === 'documents' ? ' (retrieving documents)' : ''}`;
      $('found').textContent = String(p.documentsFound ?? 0); $('got').textContent = String(p.documentsRetrieved ?? 0); $('hist').textContent = String(p.historicalCopies ?? 0);
      $('unav').textContent = String(p.documentsUnavailable ?? 0); $('nl').textContent = String(p.documentsNotLocated ?? 0);
      $('req').textContent = `${p.requests} of at most ${p.requestsMax}`;
      $('eta').textContent = p.pagesRemaining ? fmtDuration(p.etaMs) : 'none';
      $('bytes').textContent = `${(p.bytes / 1048576).toFixed(2)} MB`;
      const live = p.state === 'running' || p.state === 'preparing';
      const done = ['finished', 'cancelled', 'refused', 'error', 'idle'].includes(p.state);
      $('pause').disabled = !live; $('resume').disabled = p.state !== 'paused'; $('cancel').disabled = done;
      $('pause').setAttribute('aria-disabled', String(!live)); $('resume').setAttribute('aria-disabled', String(p.state !== 'paused')); $('cancel').setAttribute('aria-disabled', String(done));
    },
    destroy() { container.innerHTML = ''; }
  };
}

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Outcome legend: what each result word means, so "Not located" is never read as "does not exist".
export function outcomeLegendHtml() {
  return `<dl class="dc-legend">${Object.keys(OUTCOME_LABEL).map((k) => `<dt>${esc(OUTCOME_LABEL[k])}</dt><dd>${esc(OUTCOME_MEANING[k])}</dd>`).join('')}</dl>`;
}

// The run's ledger as a table (what was requested and what happened).
export function ledgerHtml(entries, { caption = 'Every request this run made or skipped' } = {}) {
  return `<table class="dc-ledger"><caption>${esc(caption)}</caption><thead><tr><th scope="col">#</th><th scope="col">Address</th><th scope="col">What</th><th scope="col">Result</th><th scope="col">Note</th></tr></thead><tbody>${entries.map((e) => `<tr><th scope="row">${e.seq}</th><td>${esc(e.url || '')}</td><td>${esc(e.action)}</td><td>${esc(e.outcome ? OUTCOME_LABEL[e.outcome] || e.outcome : '')}${e.httpStatus ? ` (HTTP ${e.httpStatus})` : ''}</td><td>${esc([e.reason, e.note].filter(Boolean).join(': '))}</td></tr>`).join('')}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// Phase 1: the readable coverage report shown after every discovery run.
// buildCoverageReport() turns a finished run result into plain facts;
// coverageReportHtml() / coverageReportText() render them. The report always
// says where Chronium looked, what it found, what it could not reach, and what
// remains unknown. It never treats an unsuccessful search as proof that a
// record does not exist.
import { OUTCOME } from './outcomes.js';
import { coverageHtml } from './ledger.js';

const safeHref = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const cnt = (v, w, pl) => `${v} ${v === 1 ? w : (pl || w + 's')}`;
const FIXED_UNKNOWNS = [
  'Chronium only follows links that pages on the site publish. A record that no page links to, or that sits behind a login, a search form or a script, is not seen and is not counted here.',
  '"Not located" and "unavailable" describe this search only. They are not evidence that a record is missing, was destroyed, or never existed.',
  'Scanned pages and images are saved but cannot be searched until text recognition is added.'
];

export function buildCoverageReport(result, { label = '' } = {}) {
  const docs = result.documents || [];
  const by = (o) => docs.filter((d) => d.outcome === o);
  const retrieved = docs.filter((d) => d.outcome === OUTCOME.FOUND || d.outcome === OUTCOME.PARTIAL);
  const groups = {
    found: by(OUTCOME.FOUND), partial: by(OUTCOME.PARTIAL), historical: by(OUTCOME.HISTORICAL_COPY_FOUND), notLocated: by(OUTCOME.NOT_LOCATED),
    unavailable: docs.filter((d) => d.outcome === OUTCOME.SOURCE_UNAVAILABLE || d.outcome === OUTCOME.SEARCH_INCOMPLETE), restricted: by(OUTCOME.ACCESS_RESTRICTED),
    listedOnly: docs.filter((d) => d.skipped)
  };
  const counts = {
    sourcesPlanned: (result.coverage || []).length,
    sourcesSearched: (result.coverage || []).filter((c) => c.status === 'searched').length,
    pagesFetched: result.counters?.pagesFetched || 0,
    documentLinksFound: Array.isArray(result.documentCandidates) ? result.documentCandidates.length : (Number(result.documentCandidates) || 0),
    documentsRetrieved: retrieved.length,
    duplicates: retrieved.filter((d) => d.duplicateOf).length,
    partial: groups.partial.length,
    historicalCopies: groups.historical.length,
    notLocated: groups.notLocated.length,
    unavailable: groups.unavailable.length,
    restricted: groups.restricted.length,
    listedOnly: groups.listedOnly.length
  };
  const limits = [];
  if (result.stopReason) limits.push(`The run stopped at ${result.stopReason}. Items found but not requested are not covered by this report.`);
  if (result.frontier?.pageOverflow) limits.push(`${cnt(result.frontier.pageOverflow, 'more page')} were found beyond the page limit and were not queued.`);
  if (result.frontier?.documentOverflow) limits.push(`${cnt(result.frontier.documentOverflow, 'more document link')} were found beyond the document limit and were not queued.`);
  for (const [h, why] of Object.entries(result.stoppedHosts || {})) limits.push(`${h} was stopped: ${why}.`);
  for (const [h, why] of Object.entries(result.blockedHosts || {})) limits.push(`${h} was not contacted: ${why}.`);
  if (result.state === 'cancelled') limits.push('The run was cancelled before it finished. It can be continued; finished work is not repeated.');
  const headline = `${cnt(counts.sourcesSearched, 'source')} fully searched of ${counts.sourcesPlanned} planned. ${cnt(counts.documentLinksFound, 'document link')} found, ${counts.documentsRetrieved} retrieved${counts.historicalCopies ? `, ${cnt(counts.historicalCopies, 'historical copy', 'historical copies')} found` : ''}.`;
  return {
    label, runId: result.runId, state: result.state, startedAt: result.startedAt, finishedAt: result.finishedAt, headline, counts, groups, limits,
    coverage: result.coverage || [], usage: result.usage || {}, unknowns: FIXED_UNKNOWNS.slice(), engineVersion: result.engineVersion
  };
}

const REASON_TEXT = {
  timeout: 'the site did not answer in time', network: 'the connection failed', aborted: 'the request was stopped', 'rate-limited': 'the site asked for fewer requests',
  'robots-disallow': 'robots.txt asks automated tools not to fetch this', 'robots-restricted': 'robots.txt could not be used (access restricted)', 'redirect-blocked': 'a redirect led somewhere that is not allowed',
  'returned-a-web-page': 'a web page came back instead of the document', 'size-limit': 'cut off by the size limit', 'partial-content': 'only part was sent', 'host-stopped': 'the site was stopped for this run',
  'policy-unverified': 'automated access to this site has not been cleared', 'policy-link-only': 'this site only allows links, not automated retrieval', 'policy-forbidden': 'this site forbids automated access'
};
const reasonText = (d) => {
  const r = d.originalReason || d.reason; if (!r) return '';
  if (REASON_TEXT[r]) return REASON_TEXT[r];
  const m = /^http-(\d+)$/.exec(r); if (!m) return '';
  const c = Number(m[1]);
  return c === 404 || c === 410 ? `the site answered "not found" (HTTP ${c})` : c === 401 || c === 403 ? `the site refused access (HTTP ${c})` : c >= 500 ? `the site reported an error (HTTP ${c})` : `HTTP ${c}`;
};
const archiveText = (d) => (!d.archive ? '' : d.archive.status === 'found' ? '' : d.archive.status === 'none' ? 'web archives consulted: no copy found' : d.archive.status === 'unavailable' ? 'web archives could not be reached' : (d.archive.note || ''));

const docRow = (d) => {
  const href = safeHref(d.finalUrl || d.url);
  const addr = href ? `<a href="${esc(href)}" rel="noopener noreferrer">${esc(d.linkText || d.url)}</a><br><span class="dc-addr">${esc(d.url)}</span>` : esc(d.url);
  const arch = (d.archive?.copies || []).slice(0, 2).map((c) => { const h = safeHref(c.archiveUrl); return h ? `<a href="${esc(h)}" rel="noopener noreferrer">${esc(c.provider || 'Archive')} copy${c.captureDate ? ` (${esc(String(c.captureDate).slice(0, 10))})` : ''}</a>` : ''; }).filter(Boolean).join('; ');
  const bits = [d.classificationLabel, d.retrievedAt ? `retrieved ${String(d.retrievedAt).slice(0, 19).replace('T', ' ')} UTC` : '', d.sha256 ? `sha256 ${d.sha256.slice(0, 12)}…` : '', d.duplicateOf ? `same content as ${d.duplicateOf}` : '', d.partial ? 'partial' : '', d.outcome !== OUTCOME.FOUND ? reasonText(d) : '', archiveText(d), d.note || ''].filter(Boolean).map(esc);
  if (arch) bits.push(arch);
  return `<tr><th scope="row">${addr}</th><td>${esc(OUTCOME_LABEL[d.outcome] || (d.skipped ? 'Listed, not retrieved' : ''))}</td><td>${bits.join('; ')}</td></tr>`;
};
const docTable = (title, list) => (list.length ? `<table class="dc-docs"><caption>${esc(title)} (${list.length})</caption><thead><tr><th scope="col">Document</th><th scope="col">Result</th><th scope="col">Details</th></tr></thead><tbody>${list.map(docRow).join('')}</tbody></table>` : '');

export function coverageReportHtml(rep, { headingLevel = 3 } = {}) {
  const hl = (k) => Math.min(headingLevel + k, 6);
  const g = rep.groups; const c = rep.counts;
  const summary = `<dl class="dc-counts"><dt>Sources searched</dt><dd>${c.sourcesSearched} of ${c.sourcesPlanned}</dd><dt>Pages fetched</dt><dd>${c.pagesFetched}</dd><dt>Document links found</dt><dd>${c.documentLinksFound}</dd><dt>Documents retrieved</dt><dd>${c.documentsRetrieved}${c.duplicates ? ` (${c.duplicates} with content already retrieved from another address)` : ''}</dd><dt>Historical copies found</dt><dd>${c.historicalCopies}</dd><dt>Sources unavailable or restricted</dt><dd>${c.unavailable + c.restricted}</dd><dt>Not located in the sources searched</dt><dd>${c.notLocated}</dd><dt>Requests made</dt><dd>${rep.usage.requests ?? 0} (${rep.usage.megabytes ?? 0} MB, ${rep.usage.minutes ?? 0} minutes)</dd></dl>`;
  return `<section class="dc-report" aria-labelledby="dc-report-h">
    <h${hl(0)} id="dc-report-h" tabindex="-1">Coverage report</h${hl(0)}>
    <p class="dc-headline">${esc(rep.headline)}</p>
    ${summary}
    <div class="dc-scroll" tabindex="0" role="region" aria-label="Where Chronium looked (scrolls sideways on small screens)">${coverageHtml(rep.coverage, { caption: 'Where Chronium looked' })}</div>
    ${[['Retrieved', [...g.found, ...g.partial]], ['Historical copy found (original not available)', g.historical], ['Source unavailable or search incomplete', g.unavailable], ['Access restricted (nothing was retrieved)', g.restricted], ['Not located in the sources searched', g.notLocated], ['Listed but not retrieved (file type)', g.listedOnly]].map(([t, l]) => (l.length ? `<div class="dc-scroll" tabindex="0" role="region" aria-label="${esc(t)} (scrolls sideways on small screens)">${docTable(t, l)}</div>` : '')).join('')}
    ${rep.limits.length ? `<h${hl(1)}>Limits that applied</h${hl(1)}><ul>${rep.limits.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <h${hl(1)}>What remains unknown</h${hl(1)}><ul>${rep.unknowns.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
  </section>`;
}

export function coverageReportText(rep) {
  const lines = ['COVERAGE REPORT', rep.headline, '', 'Where Chronium looked:'];
  for (const c of rep.coverage) lines.push(`  ${c.label}: ${c.statusLabel}${c.detail ? ` (${c.detail})` : ''}`);
  const sect = (title, list) => {
    if (!list.length) return;
    lines.push('', `${title} (${list.length}):`);
    for (const d of list) {
      const parts = [d.classificationLabel, d.retrievedAt ? `retrieved ${String(d.retrievedAt).slice(0, 19).replace('T', ' ')} UTC` : '', d.sha256 ? `sha256 ${d.sha256}` : '', d.duplicateOf ? `same content as ${d.duplicateOf}` : '', d.partial ? 'partial' : '', d.outcome !== OUTCOME.FOUND ? reasonText(d) : '', archiveText(d), d.note || ''].filter(Boolean);
      lines.push(`  ${d.url}`);
      if (parts.length) lines.push(`    ${parts.join('; ')}`);
      for (const c of (d.archive?.copies || []).slice(0, 2)) lines.push(`    archived copy: ${c.archiveUrl}${c.captureDate ? ` (captured ${String(c.captureDate).slice(0, 10)})` : ''}${c.provider ? ` via ${c.provider}` : ''}`);
    }
  };
  sect('Retrieved', [...rep.groups.found, ...rep.groups.partial]);
  sect('Historical copy found', rep.groups.historical);
  sect('Source unavailable or search incomplete', rep.groups.unavailable);
  sect('Access restricted', rep.groups.restricted);
  sect('Not located in the sources searched', rep.groups.notLocated);
  if (rep.limits.length) lines.push('', 'Limits that applied:', ...rep.limits.map((x) => `  ${x}`));
  lines.push('', 'What remains unknown:', ...rep.unknowns.map((x) => `  ${x}`));
  return lines.join('\n');
}
