// Records Recovery: rendering (accessible HTML, plain text, the Big Picture summary) and the editable follow-up
// request draft. Every output carries the notice that a gap in this case is not necessarily a gap in the
// government's records or in its response to a request, and ends with "What remains unknown".
// Pure module. All text is escaped; only http(s) addresses become links.
import { NOTICE, DETECTORS, ITEM_STATUS_LABEL, STATUS_LABEL } from './config.js';
import { DECISION_LABEL } from './model.js';
import { TYPE_LABEL } from './request.js';
import { longDate } from './series.js';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeHref = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const link = (text, u) => { const h = safeHref(u); return h ? `<a href="${esc(h)}" rel="noopener noreferrer">${esc(text)}</a>` : esc(text); };

const statusLabel = (it) => ITEM_STATUS_LABEL[it.status] || STATUS_LABEL[it.status] || it.status;
const evidenceHtml = (it) => (it.evidence?.length ? `<details class="rr-evidence"><summary>What the case holds that relates to this (${it.evidence.length})</summary><ul>${it.evidence.map((e) => `<li>${esc(e.role || '')}: ${e.address ? link(e.title || e.address, e.address) : esc(e.title || e.runId || '')}${e.date ? `, dated ${esc(longDate(e.date))}` : ''}${e.why ? `; ${esc(e.why)}` : ''}${e.quote ? `<br><q>${esc(e.quote)}</q>` : ''}</li>`).join('')}</ul></details>` : '');

function decisionCell(it, { buttons }) {
  const d = it.decision ? `<p class="rr-decided">${esc(it.decision.label)}${it.decision.by ? `, by ${esc(it.decision.by)}` : ''}, ${esc(String(it.decision.at || '').slice(0, 10))}${it.decision.note ? `: ${esc(it.decision.note)}` : ''}</p>` : '';
  if (!buttons) return d || '<p>No decision recorded.</p>';
  const k = esc(it.key);
  return `${d}<p class="rr-actions"><button type="button" data-rr-decide="acknowledged" data-rr-key="${k}">Acknowledge</button> <button type="button" data-rr-decide="match-confirmed" data-rr-key="${k}">Confirm a match</button> <button type="button" data-rr-decide="not-applicable" data-rr-key="${k}">Not applicable</button>${it.decision ? ` <button type="button" data-rr-decide="reopened" data-rr-key="${k}">Reopen</button>` : ''}</p>`;
}

function itemTable(title, list, { buttons }) {
  if (!list.length) return '';
  return `<div class="rr-scroll" tabindex="0" role="region" aria-label="${esc(title)} (scrolls sideways on small screens)"><table class="rr-table"><caption>${esc(title)} (${list.length})</caption><thead><tr><th scope="col">Item</th><th scope="col">What was searched</th><th scope="col">What is not concluded</th><th scope="col">Next steps</th><th scope="col">Your decision</th></tr></thead><tbody>${list.map((it) => `<tr><th scope="row"><strong>${esc(it.title)}</strong><br><span class="rr-status">Status: ${esc(statusLabel(it))}</span><br>${esc(it.summary)}${evidenceHtml(it)}</th><td>${esc(it.searched)}</td><td>${esc(it.notConcluded)}</td><td>${it.nextSteps?.length ? `<ul>${it.nextSteps.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</td><td>${decisionCell(it, { buttons })}</td></tr>`).join('')}</tbody></table></div>`;
}

function requestTable(rq, { buttons }) {
  return `<div class="rr-scroll" tabindex="0" role="region" aria-label="${esc(rq.title)}: request compared with this case (scrolls sideways on small screens)"><table class="rr-table"><caption>${esc(rq.title)}: each requested item compared with what this case holds (${rq.items.length})</caption><thead><tr><th scope="col">Requested item</th><th scope="col">Result</th><th scope="col">What this case holds</th><th scope="col">Your decision</th></tr></thead><tbody>${rq.items.map((it) => {
    const i = it.item;
    const asked = `${i.type ? TYPE_LABEL[i.type] : 'Kind of record not read'}${i.body ? `, ${esc(i.body)}` : ''}${i.fiscalYear ? `, fiscal year ${i.fiscalYear}` : i.dateFrom ? `, ${esc(longDate(i.dateFrom))}${i.dateTo && i.dateTo !== i.dateFrom ? ` to ${esc(longDate(i.dateTo))}` : ''}` : ''}${i.citationKey ? ` ${esc(i.citationKey.split(':')[1])}` : ''}`;
    return `<tr><th scope="row">${asked}${i.text ? `<br><q>${esc(i.text)}</q>` : ''}</th><td><strong>${esc(statusLabel(it))}</strong></td><td>${esc(it.basis || '')}${it.held?.length ? `<ul>${it.held.slice(0, 12).map((h) => `<li>${link(h.title || h.address || h.recordId, h.address)}${h.date ? `, ${esc(longDate(h.date))}` : ''}${h.why ? ` (${esc(h.why)})` : ''}</li>`).join('')}${it.held.length > 12 ? `<li>and ${it.held.length - 12} more</li>` : ''}</ul>` : ''}${it.nextSteps?.length ? `<p>Next steps: ${esc(it.nextSteps.join(' '))}</p>` : ''}</td><td>${decisionCell(it, { buttons })}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

export function recoveryHtml(model, { headingLevel = 3, buttons = false, id = 'rr' } = {}) {
  const h = (k) => Math.min(headingLevel + k, 6);
  const gaps = model.items.filter((i) => i.status !== 'info');
  const info = model.items.filter((i) => i.status === 'info');
  const by = (d) => gaps.filter((i) => i.detector === d);
  const c = model.counts;
  return `<section class="rr-report" aria-labelledby="${id}-h">
  <h${h(0)} id="${id}-h" tabindex="-1">Records Recovery</h${h(0)}>
  <p class="rr-notice" role="note"><strong>Please note.</strong> ${esc(NOTICE)}</p>
  <dl class="rr-counts"><dt>Sources this case holds</dt><dd>${c.sources} (${c.datedSources} with a readable date)</dd><dt>Not held in this case</dt><dd>${c.notHeld}</dd><dt>Requires review</dt><dd>${c.requiresReview}</dd><dt>Linked in a search, not retrieved</dt><dd>${c.couldNotRetrieve}</dd><dt>Held, cannot be searched yet</dt><dd>${c.notReadable}</dd><dt>Search limits noted</dt><dd>${c.searchLimits}</dd><dt>Pattern setting</dt><dd>A recurring series is recognised from at least ${model.options.cadenceMinDocuments} dated documents</dd></dl>
  ${model.requests.map((rq) => requestTable(rq, { buttons })).join('')}
  ${['G1', 'G2', 'G3', 'G5', 'G4', 'G7', 'G6'].map((d) => itemTable(`${DETECTORS[d].title} (${DETECTORS[d].basis})`, by(d), { buttons })).join('')}
  ${info.length ? `<details class="rr-info"><summary>For information only (${info.length})</summary>${itemTable('Information only', info, { buttons: false })}</details>` : ''}
  ${gaps.length || model.requests.length ? '' : '<p>Nothing in this case is flagged. That describes the patterns and citations this tool can read; it is not a check of anyone\'s records.</p>'}
  <h${h(1)}>What remains unknown</h${h(1)}><ul>${model.unknowns.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>
</section>`;
}

export function recoverySummaryHtml(model, { href = '#/workspace/recovery' } = {}) {
  const c = model.counts;
  return `<section class="vw-card rr-summary" aria-labelledby="rr-sum-h"><h3 id="rr-sum-h">Records Recovery</h3>
  <p class="rr-notice">${esc(NOTICE)}</p>
  <ul class="vw-list"><li class="vw-item"><p>${c.notHeld} not held in this case · ${c.requiresReview} require review · ${c.couldNotRetrieve} linked in a search but not retrieved · ${c.notReadable} held but not searchable yet.</p></li></ul>
  ${href ? `<p><a class="btn btn-small" href="${esc(href)}">Open Records Recovery</a></p>` : '<p>To review these items and record decisions, open the same case on the website (Records Recovery tab; move cases with Export and Import). The full screen is not built into this panel yet.</p>'}</section>`;
}

export function recoveryText(model) {
  const L = ['RECORDS RECOVERY', NOTICE, '', `Sources this case holds: ${model.counts.sources} (${model.counts.datedSources} with a readable date). Recurring series are recognised from at least ${model.options.cadenceMinDocuments} dated documents.`];
  for (const rq of model.requests) {
    L.push('', `${rq.title}: each requested item compared with what this case holds`);
    for (const it of rq.items) {
      const i = it.item;
      L.push(`  - ${i.type ? TYPE_LABEL[i.type] : 'Kind of record not read'}${i.body ? `, ${i.body}` : ''}${i.fiscalYear ? `, fiscal year ${i.fiscalYear}` : i.dateFrom ? `, ${longDate(i.dateFrom)}${i.dateTo && i.dateTo !== i.dateFrom ? ` to ${longDate(i.dateTo)}` : ''}` : ''}: ${statusLabel(it)}. ${it.basis || ''}`.trim());
      if (it.decision) L.push(`      Decision: ${it.decision.label}${it.decision.note ? ` (${it.decision.note})` : ''}`);
    }
  }
  for (const d of ['G1', 'G2', 'G3', 'G5', 'G4', 'G7', 'G6']) {
    const list = model.items.filter((i) => i.detector === d && i.status !== 'info');
    if (!list.length) continue;
    L.push('', `${DETECTORS[d].title} (${DETECTORS[d].basis}): ${list.length}`);
    for (const it of list) { L.push(`  - ${it.title} [${statusLabel(it)}]`, `      ${it.summary}`, `      Searched: ${it.searched}`, `      Not concluded: ${it.notConcluded}`); if (it.decision) L.push(`      Decision: ${it.decision.label}${it.decision.note ? ` (${it.decision.note})` : ''}`); }
  }
  L.push('', 'What remains unknown:', ...model.unknowns.map((u) => `  - ${u}`));
  return L.join('\n');
}

// ---- the editable follow-up request (never sent by Chronium) ----
export function followUpDraft(model, request, { yourName = '[Your name]', originalDate = '[date of your original request, if any]', agency = '[Agency or records office]' } = {}) {
  // An item a reviewer closed (match confirmed) or marked not applicable has a different status and drops out.
  const open = request.items.filter((it) => ['not-held', 'partly', 'review', 'cannot-assess'].includes(it.status));
  const lines = [];
  lines.push(`To: ${agency}`, `From: ${yourName}`, 'Subject: Follow-up to my records request', '');
  lines.push(`I am following up on my request of ${originalDate}. I keep a research file of the records I have been able to find. This note compares that file with what I asked for. It describes my own file only; I am not saying what your office holds, and I am not suggesting that anything was handled incorrectly.`, '');
  if (!open.length) lines.push('For the items I asked about, my file already holds what I was looking for, so I have no further questions at this time.');
  else {
    lines.push('For the items below, my file does not hold everything I asked for, or I cannot be sure it does:', '');
    open.forEach((it, n) => {
      const i = it.item;
      const what = `${i.type ? TYPE_LABEL[i.type] : 'Records'}${i.citationKey ? ` ${i.citationKey.split(':')[1]}` : ''}${i.body ? ` of the ${i.body}` : ''}${i.fiscalYear ? `, fiscal year ${i.fiscalYear}` : i.dateFrom ? `, ${longDate(i.dateFrom)}${i.dateTo && i.dateTo !== i.dateFrom ? ` to ${longDate(i.dateTo)}` : ''}` : ''}`;
      lines.push(`${n + 1}. ${what}`, `   My file: ${STATUS_LABEL[it.status]}. ${it.basis || ''}`.trimEnd());
      if (it.held?.length) lines.push(`   Held in my file: ${it.held.slice(0, 8).map((h) => (h.date ? longDate(h.date) : h.title)).join('; ')}${it.held.length > 8 ? `; and ${it.held.length - 8} more` : ''}.`);
      lines.push('');
    });
    lines.push('Could you please tell me which of these records exist, and send me copies of those that do? If you hold no record of a kind I asked for, or cannot release one, I would be grateful for a short note saying so and giving the reason, and for any suggestion of where else I might look.', '');
  }
  lines.push(`What I searched: ${model.searched}`, '', '[If this follow-up relates to a request made under the Texas Public Information Act (Texas Government Code, Chapter 552), you may wish to say so here and check the current statute for your rights and the agency\'s timelines.]', '', 'Thank you for your help.', '', yourName);
  return lines.join('\n');
}
