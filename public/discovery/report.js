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
    <p><label for="${id}-bar">Pages fetched</label> <progress id="${id}-bar" max="1" value="0"></progress></p>
    <dl class="dc-stats"><dt>State</dt><dd id="${id}-state"></dd><dt>Requests made</dt><dd id="${id}-req"></dd><dt>Estimated time left</dt><dd id="${id}-eta"></dd><dt>Downloaded</dt><dd id="${id}-bytes"></dd></dl>
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
      $('bar').max = planned; $('bar').value = Math.min(p.pagesFetched || 0, planned);
      $('bar').setAttribute('aria-valuetext', `${p.pagesFetched} of about ${p.pagesPlanned} pages`);
      $('state').textContent = STATE_LABEL[p.state] || p.state;
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
