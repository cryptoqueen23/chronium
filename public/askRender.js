// Renders an Ask Chronium answer (see askRouter.js) as accessible HTML. One
// renderer for the website and the extension so both read the same. Pure
// string building: every dynamic value is escaped.
import { STATES } from './askRouter.js';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const httpUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const stateLabel = (k) => STATES[k] || k || '';
const link = (u, label) => { const h = httpUrl(u); return h ? `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : ''; };

export function sourceHtml(s) {
  const bits = [s.date ? esc(s.date) : '', s.location ? esc(s.location) : '', s.sourceId ? esc(s.sourceId) : ''].filter(Boolean).join(' · ');
  const links = [link(s.url, 'Open original'), link(s.archiveUrl, 'Open archived copy')].filter(Boolean).join(' ');
  return `<li class="ask-source">
    <p class="ask-source-title"><strong>${esc(s.title)}</strong>${s.stance ? ` <span class="ask-tag">${esc(s.stance)}</span>` : ''}${bits ? `<span class="ask-source-meta"> · ${bits}</span>` : ''}</p>
    ${s.excerpt ? `<blockquote class="ask-excerpt">${esc(s.excerpt)}</blockquote>` : ''}
    ${s.hash ? `<p class="ask-source-meta">File fingerprint: ${esc(String(s.hash).slice(0, 16))}</p>` : ''}
    ${links ? `<p class="ask-source-links">${links}</p>` : ''}
  </li>`;
}

export function itemHtml(item) {
  return `<article class="ask-item">
    <h4>${esc(item.heading)}</h4>
    ${item.state ? `<p class="ask-tag-line"><span class="ask-tag">${esc(stateLabel(item.state))}</span></p>` : ''}
    ${item.body ? `<p>${esc(item.body)}</p>` : ''}
    ${item.sources?.length ? `<ul class="ask-sources" aria-label="Sources for this item">${item.sources.map(sourceHtml).join('')}</ul>` : ''}
  </article>`;
}

// Everything except the evidence items: the headline, what is not
// established, what was searched, and clarification choices.
export function answerHeaderHtml(a) {
  return `<h3 class="ask-title">${esc(a.title)} <span class="ask-tag ask-state-${esc(String(a.state).toLowerCase())}">${esc(stateLabel(a.state))}</span></h3>
    <p class="ask-summary">${esc(a.summary)}</p>`;
}
export function answerFooterHtml(a) {
  const missing = a.missing?.length ? `<section class="ask-missing" aria-label="What is not established"><h4>What the records do not establish</h4><ul>${a.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></section>` : '';
  const searched = a.searched ? `<p class="ask-searched"><strong>What Chronium looked at:</strong> ${esc(a.searched)}</p>` : '';
  const clar = a.clarification
    ? `<section class="ask-clarify" aria-label="Choose one"><p><strong>${esc(a.clarification.question)}</strong></p><ul class="ask-options">${a.clarification.options.map((o) => `<li><button type="button" class="btn btn-small" data-ask-followup="${esc(o.followUp)}">${esc(o.label)}</button></li>`).join('')}</ul></section>`
    : '';
  return `${missing}${searched}${clar}`;
}
export function answerHtml(a) {
  return `${answerHeaderHtml(a)}${a.items.map(itemHtml).join('')}${answerFooterHtml(a)}`;
}
