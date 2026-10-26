// Deep Discovery screen, shared by the website (My Investigations workspace) and the extension side panel.
// "Find public records": the person pastes a government website or document-library address; Chronium searches
// the publicly linked pages and documents there within the free limits, saves what it finds into the open case,
// and shows a coverage report. The host (website or extension) supplies the pieces that differ: how to fetch,
// how to ask for access to a site, where to keep the daily counters, and the database calls.
import { DiscoveryRun, DailyBudget, MemoryStorage } from './engine.js';
import { checkUrl } from './urlGuard.js';
import { resolveLimits, DEFAULT_LIMITS } from './config.js';
import { mountProgress, buildCoverageReport, coverageReportHtml, coverageReportText, outcomeLegendHtml, ledgerHtml } from './report.js';
import { createDocumentSaver, recordRun } from './save.js';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const minutes = (ms) => (ms < 90000 ? `${Math.max(1, Math.round(ms / 1000))} seconds` : `${Math.round(ms / 60000)} minutes`);

// localStorage-backed {get,set}; falls back to memory when storage is blocked.
export function webStorage(key = 'chronium.discovery') {
  const mem = new MemoryStorage();
  return {
    async get(k) { try { const v = localStorage.getItem(`${key}:${k}`); return v ? JSON.parse(v) : null; } catch { return mem.get(k); } },
    async set(k, v) { try { localStorage.setItem(`${key}:${k}`, JSON.stringify(v)); } catch { await mem.set(k, v); } }
  };
}

/**
 * deps: {
 *   mode: 'website' | 'extension',
 *   getInvestigation: () => ({ id, name } | null),
 *   makeFetcher: () => fetcher,
 *   archiveLookup: (url) => Promise<{status, copies}> | null,
 *   requestAccess: (origin) => Promise<boolean>,        // extension: permission prompt; website: resolves true
 *   extract: (filename, mime, bytes) => Promise<{text, metadata, note}>,
 *   budgetStorage: {get,set},
 *   listRuns: (investigationId) => Promise<run[]>, listLedger: (investigationId, runId) => Promise<entry[]>,
 *   onSaved: () => void                                  // refresh the host's lists after documents were saved
 *   limits: {}                                           // optional overrides (clamped by the engine)
 *   guardOptions: {}                                     // tests only
 * }
 */
export function mountDiscoveryPanel(container, deps, { id = 'dc' } = {}) {
  const limits = resolveLimits(deps.limits || {});
  let run = null; let lastResult = null; let lastRunRow = null; let progressUi = null; let lastAnnounce = 0; let lastText = '';
  const $ = (s) => container.querySelector(`#${id}-${s}`);

  container.innerHTML = `<section class="dc-root" aria-labelledby="${id}-title">
    <h2 id="${id}-title" tabindex="-1">Find public records</h2>
    <p class="dc-lead">Paste the address of a government website or its document library. Chronium will look through the pages and documents the site publishes, at the pace the site allows, and save what it finds to your open case. Nothing is uploaded; your case stays on this device.</p>
    <p id="${id}-case" class="dc-case" role="status"></p>
    <form id="${id}-form" class="dc-form" novalidate>
      <p class="dc-field"><label for="${id}-url">Website or document library address</label>
        <input id="${id}-url" name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://www.examplecity.gov/DocumentCenter" aria-describedby="${id}-url-hint ${id}-url-err" required>
        <span id="${id}-url-hint" class="dc-hint">Example: a city, county or school district site, or the page that lists its agendas and documents.</span>
        <span id="${id}-url-err" class="dc-error" role="alert" hidden></span></p>
      <fieldset class="dc-opts"><legend>Options</legend>
        <p><input type="checkbox" id="${id}-ack" required aria-describedby="${id}-ack-err"> <label for="${id}-ack">I have read this site's terms of use, and I want Chronium to search its public pages at the pace the site asks.</label>
          <span id="${id}-ack-err" class="dc-error" role="alert" hidden></span></p>
        <p><input type="checkbox" id="${id}-docs" checked> <label for="${id}-docs">Retrieve the documents found (otherwise they are only listed)</label></p>
        <p><input type="checkbox" id="${id}-arch" checked> <label for="${id}-arch">Look for archived copies of documents that cannot be retrieved. This sends each such document's address to the Internet Archive, through the Chronium server.</label></p>
        <p><input type="checkbox" id="${id}-keep"> <label for="${id}-keep">Keep a copy of each original file on this device (uses more space)</label></p>
      </fieldset>
      <p id="${id}-plan" class="dc-plan"></p>
      <p class="dc-actions"><button type="submit" class="primary" id="${id}-start">Start search</button></p>
    </form>
    <div id="${id}-progress" hidden></div>
    <div id="${id}-after" class="dc-after" hidden></div>
    <div id="${id}-runs" class="dc-runs"></div>
  </section>`;

  const showErr = (el, msg) => { el.textContent = msg; el.hidden = !msg; };
  const planText = () => `Plan: at most ${limits.maxPages} pages and ${limits.maxDocuments} documents, one request at a time, waiting at least ${limits.minDelayMs / 1000} seconds between requests (longer if the site asks). A full run can take ${minutes((limits.maxPages + limits.maxDocuments) * limits.minDelayMs)} or more. You can pause, resume or cancel at any time, and you can search ${limits.maxRunsPerDay} times a day. ${deps.mode === 'website' ? `Searches started from the website make at most ${limits.maxWebsiteFetches} requests; the extension has no such limit.` : ''}`;
  $('plan').textContent = deps.unavailableMessage || planText();
  if (deps.unavailableMessage) { $('plan').setAttribute('role', 'status'); }
  if (!deps.archiveLookup) { $('arch').checked = false; $('arch').disabled = true; }

  function refreshCaseLine() {
    const inv = deps.getInvestigation();
    $('case').textContent = inv ? `Results will be saved to the case: ${inv.name}` : 'No case is open. Open or create a case first; results are saved to the open case.';
    $('start').disabled = !inv || !!deps.unavailableMessage || (run && ['running', 'paused', 'preparing'].includes(run.state));
  }

  async function renderRuns() {
    const inv = deps.getInvestigation();
    const box = $('runs');
    if (!inv || !deps.listRuns) { box.innerHTML = ''; return; }
    const rows = (await deps.listRuns(inv.id)).slice(0, 5);
    if (!rows.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<h3>Earlier searches in this case</h3><ul class="dc-runlist">${rows.map((r) => `<li><span>${esc((r.startedAt || '').slice(0, 16).replace('T', ' '))} UTC · ${esc((r.seeds || [])[0] || '')} · ${esc(r.report?.headline || r.state)}</span>
      <button type="button" data-run="${esc(r.id)}">Show report</button>${r.checkpoint && (r.checkpoint.pagesPending?.length || (r.checkpoint.docCandidates || []).length > (r.checkpoint.docsDone || []).length) && r.state !== 'finished' ? ` <button type="button" data-continue="${esc(r.id)}">Continue</button>` : ''}</li>`).join('')}</ul>`;
    box.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', async () => { const r = rows.find((x) => x.id === b.dataset.run); const ledger = deps.listLedger ? await deps.listLedger(inv.id, r.id) : []; showReport({ ...r, ledger }, true); }));
    box.querySelectorAll('[data-continue]').forEach((b) => b.addEventListener('click', () => { const r = rows.find((x) => x.id === b.dataset.continue); start({ continueFrom: r }); }));
  }

  function showReport(resultLike, focus = true) {
    const rep = buildCoverageReport(resultLike);
    const after = $('after');
    after.hidden = false;
    after.innerHTML = `${coverageReportHtml(rep, { headingLevel: 3 })}
      <p class="dc-actions"><button type="button" id="${id}-copy">Copy report as text</button>${resultLike.checkpoint && resultLike.state !== 'finished' && resultLike.state !== 'refused' ? ` <button type="button" id="${id}-cont">Continue this search</button>` : ''}</p>
      <details class="dc-ledger-box"><summary>Every request this search made or skipped</summary><div class="dc-scroll" tabindex="0" role="region" aria-label="Request log (scrolls sideways on small screens)">${ledgerHtml(resultLike.ledger || [])}</div></details>
      <details><summary>What the result words mean</summary>${outcomeLegendHtml()}</details>`;
    const copy = after.querySelector(`#${id}-copy`);
    if (copy) copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(coverageReportText(rep)); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed; select the report text instead'; } });
    const cont = after.querySelector(`#${id}-cont`);
    if (cont) cont.addEventListener('click', () => start({ continueFrom: resultLike }));
    if (focus) after.querySelector('#dc-report-h')?.focus();
  }

  // Polite status text no more than every 10 seconds (or on a change of state), so a screen reader is not flooded.
  function onProgress(p) {
    if (!progressUi) return;
    const now = Date.now();
    const stateChanged = p.state !== (onProgress.lastState || '') ;
    const phaseChanged = p.phase !== (onProgress.lastPhase || '');
    onProgress.lastState = p.state; onProgress.lastPhase = p.phase;
    let message = lastText;
    if (stateChanged || phaseChanged || now - lastAnnounce > 10000 || !lastText) { message = p.message; lastText = p.message; lastAnnounce = now; }
    progressUi.update({ ...p, message });
  }

  async function start({ continueFrom = null } = {}) {
    if (deps.unavailableMessage) return;
    const inv = deps.getInvestigation();
    if (!inv) { showErr($('url-err'), 'Open or create a case first.'); return; }
    const urlEl = $('url');
    const raw = continueFrom ? (continueFrom.seeds || [])[0] : urlEl.value.trim();
    showErr($('url-err'), ''); showErr($('ack-err'), '');
    urlEl.removeAttribute('aria-invalid');
    const g = checkUrl(raw, deps.guardOptions || {});
    if (!g.ok) {
      showErr($('url-err'), raw ? 'That address cannot be searched. Use a full web address that starts with https:// and belongs to a public website.' : 'Enter the web address to search.');
      urlEl.setAttribute('aria-invalid', 'true'); urlEl.focus(); return;
    }
    if (!continueFrom && !$('ack').checked) { showErr($('ack-err'), 'Confirm that you have read the site\'s terms to continue.'); $('ack').focus(); return; }
    const opts = continueFrom ? { ...(continueFrom.options || {}) } : { retrieve: $('docs').checked, archive: $('arch').checked, keep: $('keep').checked };
    const host = g.url.hostname.toLowerCase();
    // Must be the first await after the click so the browser still sees a user gesture (extension permission prompt).
    const allowed = await deps.requestAccess(g.url.origin);
    if (!allowed) { showErr($('url-err'), 'Chronium needs your permission to read pages from that site. Choose Allow in the browser prompt to continue.'); urlEl.focus(); return; }

    const saver = createDocumentSaver({ investigationId: inv.id, label: `Deep Discovery: ${host}`, extract: deps.extract, preserveOriginals: !!opts.keep });
    const budget = new DailyBudget({ storage: deps.budgetStorage || new MemoryStorage() });
    run = new DiscoveryRun({
      seeds: [g.canonical], mode: deps.mode, limits: deps.limits || {}, fetcher: deps.makeFetcher(), termsAcknowledged: [host], budget, guardOptions: deps.guardOptions || {},
      retrieveDocuments: !!opts.retrieve, onDocument: opts.retrieve ? (p) => saver.onDocument(p) : null, archiveLookup: opts.archive && deps.archiveLookup ? deps.archiveLookup : null,
      resumeFrom: continueFrom ? continueFrom.checkpoint : null, onProgress,
      ...(deps.now ? { now: deps.now } : {}), ...(deps.sleep ? { sleep: deps.sleep } : {}) // unset options must not override the engine's defaults
    });
    $('after').hidden = true; $('after').innerHTML = '';
    const prog = $('progress'); prog.hidden = false;
    progressUi = mountProgress(prog, { onPause: () => run && run.pause(), onResume: () => run && run.resume(), onCancel: () => run && run.cancel(), id: `${id}-p` });
    lastText = ''; lastAnnounce = 0; onProgress.lastState = ''; onProgress.lastPhase = '';
    $('start').disabled = true;
    prog.querySelector('h3')?.setAttribute('tabindex', '-1'); prog.querySelector('h3')?.focus();

    const result = await run.start();
    result.seeds = [g.canonical]; result.options = opts; // kept so the search can be continued from its report
    lastResult = result;
    try {
      await saver.finish(result.state);
      await recordRun(inv.id, result, { seeds: [g.canonical], options: opts });
    } catch (e) { result.warnings = [...(result.warnings || []), `The run could not be fully recorded: ${String(e && e.message || e).slice(0, 120)}`]; }
    progressUi.update({ ...run.progress(), message: result.message, state: result.state === 'finished' || result.state === 'cancelled' || result.state === 'refused' ? result.state : 'finished' });
    showReport(result);
    deps.onSaved && deps.onSaved(saver.tally);
    refreshCaseLine(); renderRuns();
  }

  $('form').addEventListener('submit', (e) => { e.preventDefault(); start(); });
  refreshCaseLine(); renderRuns();
  return {
    refresh() { refreshCaseLine(); renderRuns(); },
    get run() { return run; },
    get lastResult() { return lastResult; },
    start
  };
}

export { DEFAULT_LIMITS };
