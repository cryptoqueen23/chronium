// Records Recovery screen, shared by the website (the "Records Recovery" tab of an investigation) and, later, the
// extension. It never changes evidence. It lets a person: set the pattern threshold, paste a records request and
// correct how it was read, see each item compared with the case, record decisions on gaps, and edit a follow-up
// request that Chronium never sends. All data stays on this device.
import { buildRecoveryModel } from './model.js';
import { recoveryHtml, followUpDraft } from './report.js';
import { parseRequest, updateItem, removeItem, addItem, REQUEST_TYPES, TYPE_LABEL } from './request.js';
import { NOTICE } from './config.js';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * deps: {
 *   getInvestigationId: () => string|null,
 *   store: { loadRecoverySnapshot, addReview, saveRequest, saveFollowUp, deleteRequest, saveSettings },
 *   getPerson: () => string, setPerson: (name) => void,
 *   onChange: () => void
 * }
 */
export function mountRecoveryPanel(container, deps, { id = 'rr' } = {}) {
  let model = null; let snapshot = null; let draftItems = null; let draftText = ''; let draftTitle = ''; let ignored = []; let editingId = null;
  const $ = (s) => container.querySelector(`#${id}-${s}`);

  container.innerHTML = `<section class="rr-root" aria-labelledby="${id}-title">
    <h2 id="${id}-title" tabindex="-1">Records Recovery</h2>
    <p class="rr-notice" role="note"><strong>Please note.</strong> ${esc(NOTICE)}</p>
    <p id="${id}-status" class="rr-live" role="status" aria-live="polite"></p>
    <div id="${id}-body"><p>Loading…</p></div>
  </section>`;

  const say = (msg) => { $('status').textContent = msg; };

  async function refresh() {
    const invId = deps.getInvestigationId();
    const body = $('body');
    if (!invId) { body.innerHTML = '<p>Open an investigation to use Records Recovery.</p>'; return; }
    snapshot = await deps.store.loadRecoverySnapshot(invId);
    if (!snapshot) { body.innerHTML = '<p>That investigation could not be read.</p>'; return; }
    model = buildRecoveryModel(snapshot);
    render();
  }

  function itemEditor() {
    if (!draftItems) return '';
    const typeOptions = (sel) => `<option value=""${sel ? '' : ' selected'}>Not sure (leave for review)</option>${REQUEST_TYPES.map((t) => `<option value="${t}"${sel === t ? ' selected' : ''}>${esc(TYPE_LABEL[t])}</option>`).join('')}`;
    return `<form id="${id}-editor" class="rr-editor" aria-labelledby="${id}-editor-h" novalidate>
      <h3 id="${id}-editor-h">Check how your request was read</h3>
      <p>Chronium read your text into the items below. Correct anything that is wrong, add items it missed, or remove items that are not requests. Nothing is saved until you press Save request.</p>
      ${ignored.length ? `<details><summary>${ignored.length} line${ignored.length === 1 ? '' : 's'} not read as a request</summary><ul>${ignored.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details>` : ''}
      <p><label for="${id}-title-in">Name for this request</label> <input id="${id}-title-in" type="text" maxlength="120" value="${esc(draftTitle)}"></p>
      ${draftItems.map((it, n) => `<fieldset class="rr-item"><legend>Item ${n + 1}${it.confidence === 'requires-review' ? ' (requires your review)' : it.confidence === 'inferred' ? ' (partly inferred)' : ''}</legend>
        ${it.text ? `<p class="rr-quote"><q>${esc(it.text)}</q></p>` : ''}
        ${it.notes?.length ? `<ul class="rr-notes">${it.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        <p><label for="${id}-t-${it.id}">Kind of record</label> <select id="${id}-t-${it.id}" data-rr-field="type" data-rr-id="${esc(it.id)}">${typeOptions(it.type)}</select></p>
        <p><label for="${id}-b-${it.id}">Agency or body (optional)</label> <input id="${id}-b-${it.id}" type="text" data-rr-field="body" data-rr-id="${esc(it.id)}" value="${esc(it.body || '')}" maxlength="80"></p>
        <p><label for="${id}-f-${it.id}">From date (optional)</label> <input id="${id}-f-${it.id}" type="date" data-rr-field="dateFrom" data-rr-id="${esc(it.id)}" value="${esc(it.dateFrom || '')}">
           <label for="${id}-e-${it.id}">To date (optional)</label> <input id="${id}-e-${it.id}" type="date" data-rr-field="dateTo" data-rr-id="${esc(it.id)}" value="${esc(it.dateTo || '')}"></p>
        <p><label for="${id}-y-${it.id}">Fiscal year (optional)</label> <input id="${id}-y-${it.id}" type="number" min="1990" max="2100" data-rr-field="fiscalYear" data-rr-id="${esc(it.id)}" value="${it.fiscalYear || ''}">
           ${it.citationKey ? `<span>Number requested: ${esc(it.citationKey.split(':')[1])}</span>` : ''}</p>
        <p><button type="button" data-rr-remove="${esc(it.id)}">Remove item ${n + 1}</button></p></fieldset>`).join('')}
      <p class="rr-actions"><button type="button" id="${id}-add">Add an item</button> <button type="submit" class="primary">Save request</button> <button type="button" id="${id}-cancel">Cancel</button></p>
    </form>`;
  }

  function followUps() {
    return model.requests.map((rq) => {
      const text = rq.followUpDraft ?? followUpDraft(model, rq, { yourName: deps.getPerson() || '[Your name]' });
      return `<section class="rr-followup" aria-labelledby="${id}-fu-h-${rq.id}"><h3 id="${id}-fu-h-${rq.id}">Follow-up request for “${esc(rq.title)}”</h3>
        <p>This draft is built from the items above that this case does not fully answer. It describes <em>your own research file</em>, not what any agency holds. Edit it as you like. <strong>Chronium never sends it.</strong></p>
        <p><label for="${id}-fu-${rq.id}">Follow-up text</label><br><textarea id="${id}-fu-${rq.id}" rows="14" data-rr-draft="${esc(rq.id)}">${esc(text)}</textarea></p>
        <p class="rr-actions"><button type="button" data-rr-savedraft="${esc(rq.id)}">Save my edits</button> <button type="button" data-rr-rebuild="${esc(rq.id)}">Rebuild from the current results</button> <button type="button" data-rr-copy="${esc(rq.id)}">Copy text</button> <button type="button" data-rr-edit="${esc(rq.id)}">Edit request items</button> <button type="button" data-rr-delete="${esc(rq.id)}">Delete this request</button></p></section>`;
    }).join('');
  }

  function render() {
    const body = $('body');
    body.innerHTML = `
      <form id="${id}-settings" class="rr-settings" novalidate><p><label for="${id}-cad">Recognise a recurring series from at least this many dated documents</label>
        <input id="${id}-cad" type="number" min="3" max="12" step="1" value="${model.options.cadenceMinDocuments}" aria-describedby="${id}-cad-hint"> <button type="submit">Save setting</button></p>
        <p id="${id}-cad-hint" class="rr-hint">Between 3 and 12. A recognised pattern never shows that a record was created, only which dates the case holds nothing for. Saved with this case.</p></form>
      <p><label for="${id}-person">Your name, shown beside your decisions (optional)</label> <input id="${id}-person" type="text" maxlength="60" value="${esc(deps.getPerson() || '')}"></p>
      <form id="${id}-req" class="rr-req"><h3>Your records request</h3>
        <p><label for="${id}-text">Paste the text of a records request you made, or plan to make</label><br><textarea id="${id}-text" rows="6" maxlength="20000" aria-describedby="${id}-text-hint">${esc(draftText)}</textarea></p>
        <p id="${id}-text-hint" class="rr-hint">One item per line works best, for example: “Minutes of the City Council from January 1, 2023 to December 31, 2023”. Chronium reads it with fixed rules and shows you what it understood. Nothing is sent anywhere.</p>
        <p><button type="submit" class="primary">Read my request</button></p></form>
      ${itemEditor()}
      <div id="${id}-results">${recoveryHtml(model, { headingLevel: 3, buttons: true, id: `${id}-rep` })}</div>
      ${followUps()}`;
    wire();
  }

  function wire() {
    $('settings').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = Number($('cad').value);
      if (!Number.isInteger(v) || v < 3 || v > 12) { say('Enter a whole number from 3 to 12.'); $('cad').focus(); return; }
      await deps.store.saveSettings(deps.getInvestigationId(), { cadenceMinDocuments: v });
      await refresh(); say(`Saved. A recurring series is now recognised from at least ${v} dated documents.`); deps.onChange && deps.onChange();
    });
    $('person').addEventListener('change', (e) => deps.setPerson(e.target.value.trim()));
    $('req').addEventListener('submit', (e) => {
      e.preventDefault();
      draftText = $('text').value;
      if (!draftText.trim()) { say('Paste the text of a request first.'); $('text').focus(); return; }
      const r = parseRequest(draftText); draftItems = r.items; ignored = r.ignored; editingId = null; draftTitle = draftTitle || 'Records request';
      render(); say(`Read ${draftItems.length} item${draftItems.length === 1 ? '' : 's'}. Check them below.`);
      container.querySelector(`#${id}-editor-h`)?.setAttribute('tabindex', '-1'); container.querySelector(`#${id}-editor-h`)?.focus();
    });
    const ed = $('editor');
    if (ed) {
      ed.addEventListener('change', (e) => {
        const f = e.target.dataset.rrField; const itemId = e.target.dataset.rrId; if (!f) return;
        let v = e.target.value; if (f === 'fiscalYear') v = v ? Number(v) : null; if (f === 'type' && !v) v = null; if (f === 'body') v = v.trim() || null; if (f.startsWith('date')) v = v || null;
        draftItems = updateItem(draftItems, itemId, { [f]: v });
        say(draftItems.find((i) => i.id === itemId)?.notes?.some((n) => /swapped/.test(n)) ? 'The two dates were in the wrong order and were swapped.' : 'Item updated.');
      });
      ed.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-rr-remove]'); if (rm) { draftItems = removeItem(draftItems, rm.dataset.rrRemove); render(); say('Item removed.'); container.querySelector(`#${id}-editor-h`)?.focus(); }
      });
      $('add').addEventListener('click', () => { draftTitle = $('title-in').value; draftItems = addItem(draftItems, {}); render(); say('Item added. Fill in its details.'); });
      $('cancel').addEventListener('click', () => { draftItems = null; editingId = null; render(); say('Cancelled. Nothing was saved.'); });
      ed.addEventListener('submit', async (e) => {
        e.preventDefault();
        draftTitle = $('title-in').value.trim() || 'Records request';
        const row = await deps.store.saveRequest(deps.getInvestigationId(), { id: editingId || undefined, title: draftTitle, text: draftText, items: draftItems, followUpDraft: null });
        draftItems = null; editingId = null; draftText = ''; draftTitle = '';
        await refresh(); say(`Saved “${row.title}”. The comparison with this case is below.`); deps.onChange && deps.onChange();
        container.querySelector(`#${id}-rep-h`)?.focus();
      });
    }
  }

  async function onClick(e) {
    const invId = deps.getInvestigationId();
    const dec = e.target.closest('[data-rr-decide]');
    if (dec) {
      const key = dec.dataset.rrKey; const d = dec.dataset.rrDecide;
      if (d === 'acknowledged' || d === 'reopened') {
        await deps.store.addReview(invId, { itemKey: key, decision: d, investigatorName: deps.getPerson() || null });
        await refresh(); say(d === 'reopened' ? 'Reopened.' : 'Acknowledged. It stays open.'); deps.onChange && deps.onChange(); return;
      }
      showDecisionForm(dec, key, d); return;
    }
    const sd = e.target.closest('[data-rr-savedraft]');
    if (sd) { const ta = container.querySelector(`#${id}-fu-${sd.dataset.rrSavedraft}`); await deps.store.saveFollowUp(invId, sd.dataset.rrSavedraft, ta.value); say('Your edits to the follow-up text are saved.'); return; }
    const rb = e.target.closest('[data-rr-rebuild]');
    if (rb) {
      const rq = model.requests.find((r) => r.id === rb.dataset.rrRebuild);
      await deps.store.saveFollowUp(invId, rq.id, null); await refresh(); say('Rebuilt from the current results. Your earlier edits were replaced.');
      container.querySelector(`#${id}-fu-${rq.id}`)?.focus(); return;
    }
    const cp = e.target.closest('[data-rr-copy]');
    if (cp) { const ta = container.querySelector(`#${id}-fu-${cp.dataset.rrCopy}`); try { await navigator.clipboard.writeText(ta.value); say('Copied. Nothing was sent.'); } catch { ta.select(); say('Could not copy automatically. The text is selected; copy it yourself.'); } return; }
    const ei = e.target.closest('[data-rr-edit]');
    if (ei) { const rq = model.requests.find((r) => r.id === ei.dataset.rrEdit); editingId = rq.id; draftItems = rq.items.map((x) => x.item); draftText = rq.text; draftTitle = rq.title; ignored = []; render(); say('Editing the items of this request.'); container.querySelector(`#${id}-editor-h`)?.setAttribute('tabindex', '-1'); container.querySelector(`#${id}-editor-h`)?.focus(); return; }
    const de = e.target.closest('[data-rr-delete]');
    if (de) { if (window.confirm('Delete this request and its follow-up text from this case? Your sources are not affected.')) { await deps.store.deleteRequest(invId, de.dataset.rrDelete); await refresh(); say('Request deleted.'); deps.onChange && deps.onChange(); } }
  }

  function showDecisionForm(btn, key, decision) {
    container.querySelectorAll('.rr-decision-form').forEach((f) => f.remove());
    const item = [...model.items, ...model.requests.flatMap((r) => r.items)].find((i) => i.key === key);
    const records = (snapshot.records || []).slice(0, 300);
    const poss = new Set((item?.evidence || item?.held || []).map((x) => x.recordId));
    const form = document.createElement('form'); form.className = 'rr-decision-form'; form.noValidate = true;
    const fid = `${id}-df-${Math.random().toString(36).slice(2, 7)}`;
    form.innerHTML = decision === 'match-confirmed'
      ? `<p><label for="${fid}-r">Which source in this case is the record? (optional)</label> <select id="${fid}-r"><option value="">I am confirming it without choosing one</option>${records.sort((a, b) => (poss.has(b.id) ? 1 : 0) - (poss.has(a.id) ? 1 : 0)).map((r) => `<option value="${esc(r.id)}">${esc(r.title || r.originalUrl || r.id)}</option>`).join('')}</select></p><p><label for="${fid}-n">Note (optional)</label> <input id="${fid}-n" type="text" maxlength="300"></p><p class="rr-actions"><button type="submit" class="primary">Confirm</button> <button type="button" data-cancel>Cancel</button></p>`
      : `<p><label for="${fid}-n">Why is this not applicable? (required)</label> <input id="${fid}-n" type="text" maxlength="300" aria-describedby="${fid}-e"></p><p id="${fid}-e" class="rr-error" role="alert" hidden></p><p class="rr-actions"><button type="submit" class="primary">Mark not applicable</button> <button type="button" data-cancel>Cancel</button></p>`;
    btn.closest('td').appendChild(form);
    form.querySelector('input,select').focus();
    form.querySelector('[data-cancel]').addEventListener('click', () => { form.remove(); btn.focus(); });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const note = form.querySelector(`#${fid}-n`).value.trim();
      if (decision === 'not-applicable' && !note) { const err = form.querySelector(`#${fid}-e`); err.textContent = 'Enter a short reason.'; err.hidden = false; form.querySelector(`#${fid}-n`).setAttribute('aria-invalid', 'true'); form.querySelector(`#${fid}-n`).focus(); return; }
      await deps.store.addReview(deps.getInvestigationId(), { itemKey: key, decision, note, recordId: form.querySelector(`#${fid}-r`)?.value || null, investigatorName: deps.getPerson() || null });
      await refresh(); say(decision === 'match-confirmed' ? 'Recorded. The item is closed by your confirmation.' : 'Recorded. The item is set aside as not applicable.'); deps.onChange && deps.onChange();
    });
  }

  container.addEventListener('click', onClick); // once; the content is replaced on each render, the container is not
  refresh();
  return { refresh, get model() { return model; } };
}
