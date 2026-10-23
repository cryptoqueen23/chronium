// Deep Discovery: the search-transparency record. Every source Chronium tried
// is written down with what happened, and a plain-language coverage table says
// where it looked: Searched, Partially searched, Not checked yet, Not
// accessible, or Source unavailable. Entries hold addresses, results and
// counts only: never page text, never case contents, never search queries.
// Pure module.
import { OUTCOME, OUTCOME_LABEL } from './outcomes.js';

export const COVERAGE = Object.freeze({
  SEARCHED: 'searched',
  PARTIAL: 'partially-searched',
  NOT_CHECKED: 'not-checked-yet',
  NOT_ACCESSIBLE: 'not-accessible',
  UNAVAILABLE: 'source-unavailable'
});
export const COVERAGE_LABEL = Object.freeze({
  [COVERAGE.SEARCHED]: 'Searched',
  [COVERAGE.PARTIAL]: 'Partially searched',
  [COVERAGE.NOT_CHECKED]: 'Not checked yet',
  [COVERAGE.NOT_ACCESSIBLE]: 'Not accessible',
  [COVERAGE.UNAVAILABLE]: 'Source unavailable'
});

const ALLOWED_KEYS = ['sourceId', 'url', 'host', 'action', 'outcome', 'reason', 'httpStatus', 'bytes', 'robots', 'cached', 'fetcher', 'note', 'delayMs'];

export class Ledger {
  #entries = []; #now; #runId;
  constructor({ runId, now = () => Date.now() } = {}) { this.#runId = runId; this.#now = now; }
  get runId() { return this.#runId; }
  record(entry) {
    const e = { seq: this.#entries.length + 1, at: new Date(this.#now()).toISOString(), runId: this.#runId };
    for (const k of ALLOWED_KEYS) if (entry[k] !== undefined) e[k] = entry[k];
    this.#entries.push(Object.freeze(e));
    return e;
  }
  get entries() { return this.#entries.slice(); }
  summary() {
    const byOutcome = {}; const byHost = {};
    for (const e of this.#entries) {
      if (e.outcome) byOutcome[e.outcome] = (byOutcome[e.outcome] || 0) + 1;
      if (e.host) { const h = (byHost[e.host] ||= { requests: 0, outcomes: {} }); if (['robots', 'page', 'listing', 'document', 'archive-lookup'].includes(e.action)) h.requests++; if (e.outcome) h.outcomes[e.outcome] = (h.outcomes[e.outcome] || 0) + 1; }
    }
    return { entries: this.#entries.length, byOutcome, byHost };
  }

  // planned: [{ id, label, kind, knownRestricted?, note? }] declared BEFORE the run so
  // "not checked yet" is possible. Entries are matched by sourceId.
  coverage(planned) {
    return planned.map((src) => {
      const mine = this.#entries.filter((e) => e.sourceId === src.id && e.action !== 'skip-note');
      const counts = {}; for (const e of mine) if (e.outcome) counts[e.outcome] = (counts[e.outcome] || 0) + 1;
      const n = (o) => counts[o] || 0;
      let status; let detail;
      if (src.knownRestricted && !mine.length) { status = COVERAGE.NOT_ACCESSIBLE; detail = src.note || 'restricted by law or access control; not attempted'; }
      else if (!mine.length) { status = COVERAGE.NOT_CHECKED; detail = 'planned, not attempted'; }
      else {
        const done = n(OUTCOME.FOUND) + n(OUTCOME.NOT_LOCATED) + n(OUTCOME.HISTORICAL_COPY_FOUND);
        const bad = n(OUTCOME.SOURCE_UNAVAILABLE) + n(OUTCOME.ACCESS_RESTRICTED) + n(OUTCOME.SEARCH_INCOMPLETE) + n(OUTCOME.PARTIAL);
        if (!done && n(OUTCOME.ACCESS_RESTRICTED) === mine.length) { status = COVERAGE.NOT_ACCESSIBLE; detail = 'access restricted'; }
        else if (!done && n(OUTCOME.SOURCE_UNAVAILABLE) === mine.length) { status = COVERAGE.UNAVAILABLE; detail = 'did not answer'; }
        else if (!done && bad) { status = COVERAGE.PARTIAL; detail = 'nothing completed'; }
        else if (bad) { status = COVERAGE.PARTIAL; detail = `${done} completed, ${bad} could not be completed`; }
        else { status = COVERAGE.SEARCHED; detail = `${done} request${done === 1 ? '' : 's'} completed`; }
      }
      return { id: src.id, label: src.label, kind: src.kind || '', status, statusLabel: COVERAGE_LABEL[status], detail, attempts: mine.length, counts };
    });
  }
}

// Plain text, one line per source, for reports and screen readers.
export function coverageText(coverage) {
  return coverage.map((c) => `${c.label}: ${c.statusLabel}${c.detail ? ` (${c.detail})` : ''}`).join('\n');
}

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Accessible table: caption, column headers with scope, status as text (never colour alone).
export function coverageHtml(coverage, { caption = 'Where Chronium looked' } = {}) {
  return `<table class="dc-coverage"><caption>${esc(caption)}</caption><thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Detail</th></tr></thead><tbody>${coverage.map((c) => `<tr class="dc-status-${esc(c.status)}"><th scope="row">${esc(c.label)}</th><td>${esc(c.statusLabel)}</td><td>${esc(c.detail || '')}</td></tr>`).join('')}</tbody></table>`;
}

export { OUTCOME_LABEL };
