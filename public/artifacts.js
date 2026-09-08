// Deterministic artifact renderers - pure functions over investigation state
// that's already loaded (no new storage, no re-research, no AI). Each
// returns an HTML string for injection into the Ask Sources artifact slot.
// docs/CANON.md: use deterministic code, not AI, for anything mechanical -
// tabulating, sorting, and counting all happen here in plain JS, always
// reflecting current state (there is nothing to "go stale").

function esc(s = '') { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export function renderSourceIndex(records) {
  if (!records.length) return '<p class="status">No sources in this investigation yet.</p>';
  const rows = records.map((r) => {
    const b = r.biblio || {};
    return `<tr><td>${esc(r.sourceId || r.id)}</td><td>${esc(r.title || r.originalUrl || 'Untitled')}</td><td>${esc(b.publisher || '')}</td><td>${esc(b.sourceType || '')}</td><td>${esc(b.publicationDate || 'n.d.')}</td></tr>`;
  }).join('');
  return `<div class="report-table"><table><thead><tr><th>Source ID</th><th>Title</th><th>Publisher</th><th>Type</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderEvidenceTable(evidenceItems, records, claims) {
  if (!evidenceItems.length) return '<p class="status">No evidence items yet.</p>';
  const recById = new Map(records.map((r) => [r.id, r]));
  const claimsByEvidence = new Map();
  (claims || []).forEach((c) => (c.links || []).forEach((l) => {
    if (!claimsByEvidence.has(l.evidenceItemId)) claimsByEvidence.set(l.evidenceItemId, []);
    claimsByEvidence.get(l.evidenceItemId).push(c);
  }));
  const rows = evidenceItems.map((e) => {
    const src = recById.get(e.sourceRecordId);
    const linked = claimsByEvidence.get(e.id) || [];
    return `<tr><td>${esc(src ? (src.title || src.originalUrl || 'Untitled') : 'Source unavailable')}</td><td>${esc(e.excerptText.slice(0, 160))}${e.excerptText.length > 160 ? '…' : ''}</td><td>${esc(e.location || '')}</td><td>${linked.length ? esc(linked.map((c) => c.claimId).join(', ')) : '<span class="hint">none</span>'}</td></tr>`;
  }).join('');
  return `<div class="report-table"><table><thead><tr><th>Source</th><th>Excerpt</th><th>Location</th><th>Linked claim(s)</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderClaimEvidenceMatrix(claims, evidenceItems) {
  if (!claims.length) return '<p class="status">No claims yet.</p>';
  const evById = new Map(evidenceItems.map((e) => [e.id, e]));
  const rows = claims.map((c) => {
    const cells = (c.links || []).map((l) => {
      const ev = evById.get(l.evidenceItemId);
      const label = ev ? esc(ev.excerptText.slice(0, 60)) + (ev.excerptText.length > 60 ? '…' : '') : 'evidence removed';
      return `<li><span class="stance-tag ${esc(l.stance)}">${esc(l.stance)}</span> ${label}</li>`;
    }).join('');
    return `<tr><td>${esc(c.claimId)}</td><td>${esc(c.text)}</td><td>${cells ? `<ul class="claim-card-links">${cells}</ul>` : '<span class="hint">no evidence linked</span>'}</td></tr>`;
  }).join('');
  return `<div class="report-table"><table><thead><tr><th>Claim</th><th>Statement</th><th>Evidence (stance)</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderQuantitativeTable(quantFindings) {
  if (!quantFindings.length) return '<p class="status">No quantitative findings yet.</p>';
  const rows = quantFindings.map((f) => `<tr><td>${esc(f.statement)}</td><td>${esc(f.formula || '')}</td><td>${esc(f.method || '')}</td><td>${(f.inputs || []).length}</td></tr>`).join('');
  return `<div class="report-table"><table><thead><tr><th>Statement</th><th>Formula</th><th>Method</th><th>Inputs</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
