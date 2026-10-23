// Records Recovery: the local store. Only three things are ever stored, per case:
//   - a reviewer's decisions (append-only; the latest decision for an item wins),
//   - the person's records requests, with their corrections and any follow-up draft they edited,
//   - the case's recovery settings (for example the pattern threshold).
// Calculated results are never stored, so they are always reproducible from the case itself.
// Nothing here writes evidence, claims, relationships or findings, and nothing here touches the network.
import { openDb, tx, reqToPromise } from '../db.js';
import { readInvestigationForExport } from '../portableDb.js';
import { resolveOptions } from './config.js';
import { DECISIONS } from './model.js';
import { normalizeItem } from './request.js';

const id = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();

// The snapshot Records Recovery is computed from: the same one the three views use.
export async function loadRecoverySnapshot(investigationId) {
  const snap = await readInvestigationForExport(investigationId, { includeFiles: false });
  return snap;
}

export async function addReview(investigationId, { itemKey, decision, note = '', recordId = null, investigatorId = null, investigatorName = null }) {
  if (!Object.values(DECISIONS).includes(decision)) throw new Error('That decision is not one of the allowed choices.');
  if (!itemKey) throw new Error('A decision needs the item it is about.');
  if (decision === DECISIONS.NOT_APPLICABLE && !String(note).trim()) throw new Error('A note is required to mark an item not applicable: say why.');
  const row = { id: id('rrv'), investigationId, itemKey: String(itemKey).slice(0, 400), decision, note: String(note).slice(0, 1000), recordId, investigatorId, investigatorName, at: now() };
  const db = await openDb();
  await tx(db, ['recoveryReviews'], 'readwrite', (t) => t.objectStore('recoveryReviews').add(row));
  return row;
}

export async function listReviews(investigationId) {
  const db = await openDb();
  return tx(db, ['recoveryReviews'], 'readonly', (t) => reqToPromise(t.objectStore('recoveryReviews').index('investigationId').getAll(investigationId)));
}

export async function saveRequest(investigationId, { id: existing, title = 'Records request', text = '', items = [], followUpDraft = null }) {
  const db = await openDb();
  return tx(db, ['recoveryRequests'], 'readwrite', async (t) => {
    const store = t.objectStore('recoveryRequests');
    const prev = existing ? await reqToPromise(store.get(existing)) : null;
    const row = { ...(prev || {}), id: existing || id('rrq'), investigationId, title: String(title).slice(0, 120), text: String(text).slice(0, 20000), items: items.map(normalizeItem), followUpDraft, createdAt: prev?.createdAt || now(), updatedAt: now() };
    await reqToPromise(store.put(row));
    return row;
  });
}

export async function saveFollowUp(investigationId, requestId, draft) {
  const db = await openDb();
  return tx(db, ['recoveryRequests'], 'readwrite', async (t) => {
    const store = t.objectStore('recoveryRequests');
    const row = await reqToPromise(store.get(requestId));
    if (!row || row.investigationId !== investigationId) throw new Error('That request is not in this case.');
    const next = { ...row, followUpDraft: draft === null ? null : String(draft).slice(0, 20000), updatedAt: now() };
    await reqToPromise(store.put(next));
    return next;
  });
}

export async function deleteRequest(investigationId, requestId) {
  const db = await openDb();
  await tx(db, ['recoveryRequests'], 'readwrite', async (t) => {
    const row = await reqToPromise(t.objectStore('recoveryRequests').get(requestId));
    if (row && row.investigationId === investigationId) t.objectStore('recoveryRequests').delete(requestId);
  });
}

export async function saveSettings(investigationId, options) {
  const clean = resolveOptions(options); // clamps every value into its allowed range
  const keep = {}; for (const k of Object.keys(options || {})) if (k in clean) keep[k] = clean[k];
  const db = await openDb();
  const row = { investigationId, options: keep, updatedAt: now() };
  await tx(db, ['recoverySettings'], 'readwrite', (t) => t.objectStore('recoverySettings').put(row));
  return row;
}
