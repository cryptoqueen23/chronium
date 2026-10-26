// Safe upgrade of the browser's case database (IndexedDB).
//
// Opening the new site changes every existing browser's database from an older version to the current one
// (production holds version 4; this build is version 12). The change is one-way: once a browser has upgraded, older
// versions of the site cannot open the database (the browser refuses, the data is untouched). So, BEFORE anything
// opens the database at the new version:
//   1. inspect the existing database WITHOUT upgrading it (opening with no version number never upgrades),
//   2. if it holds cases, offer a backup file of everything in it, readable by any later version,
//   3. only after the person chooses does the upgrade happen.
// The backup is generic (every store, every row, files as base64) so it does not depend on what each version stored.
// Restoring merges it into the current database without overwriting what is already there.
import { DB_NAME, DB_VERSION } from './db.js';

export const BACKUP_FORMAT = 'chronium-raw-backup';
export const BACKUP_VERSION = 1;

// Opens the existing database at ITS OWN version. Returns null if there is none (nothing is created).
function openExistingDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    let fresh = false;
    req.onupgradeneeded = () => { fresh = true; req.transaction.abort(); }; // there was no database: do not create one
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => (fresh ? resolve(null) : reject(req.error));
    req.onblocked = () => { /* waits for the other connection */ };
  });
}

const countAll = (db, name) => new Promise((resolve, reject) => { const r = db.transaction(name, 'readonly').objectStore(name).count(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/**
 * What the next start will do to this browser's data. Never upgrades and never creates anything.
 * Returns { pending, fromVersion, toVersion, hasData, counts }.
 */
export async function pendingUpgrade() {
  const db = await openExistingDb();
  if (!db) return { pending: false, fromVersion: 0, toVersion: DB_VERSION, hasData: false, counts: {} };
  try {
    const fromVersion = db.version;
    const counts = {};
    for (const name of ['investigations', 'records', 'evidenceItems', 'claims']) if (db.objectStoreNames.contains(name)) counts[name] = await countAll(db, name);
    const hasData = Object.values(counts).some((n) => n > 0);
    return { pending: fromVersion < DB_VERSION, fromVersion, toVersion: DB_VERSION, hasData, counts };
  } finally { db.close(); }
}

async function encodeValue(v) {
  if (v instanceof Blob) { const buf = new Uint8Array(await v.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return { __type: 'blob', mime: v.type, base64: btoa(bin) }; }
  if (v instanceof Date) return { __type: 'date', iso: v.toISOString() };
  if (v instanceof ArrayBuffer) return { __type: 'arraybuffer', base64: btoa(String.fromCharCode(...new Uint8Array(v))) };
  if (Array.isArray(v)) return Promise.all(v.map(encodeValue));
  if (v && typeof v === 'object') { const out = {}; for (const [k, x] of Object.entries(v)) out[k] = await encodeValue(x); return out; }
  return v;
}
function decodeValue(v) {
  if (Array.isArray(v)) return v.map(decodeValue);
  if (v && typeof v === 'object') {
    if (v.__type === 'blob') { const bin = atob(v.base64); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return new Blob([b], { type: v.mime || '' }); }
    if (v.__type === 'date') return new Date(v.iso);
    if (v.__type === 'arraybuffer') { const bin = atob(v.base64); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b.buffer; }
    const out = {}; for (const [k, x] of Object.entries(v)) out[k] = decodeValue(x); return out;
  }
  return v;
}

const allRows = (db, name) => new Promise((resolve, reject) => { const r = db.transaction(name, 'readonly').objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/** A complete copy of the existing database (at whatever version it has), as a plain object. */
export async function buildRawBackup() {
  const db = await openExistingDb();
  if (!db) return null;
  try {
    const stores = {};
    for (const name of [...db.objectStoreNames]) {
      const st = db.transaction(name, 'readonly').objectStore(name);
      stores[name] = { keyPath: st.keyPath, autoIncrement: st.autoIncrement, rows: await encodeValue(await allRows(db, name)) };
    }
    return { format: BACKUP_FORMAT, backupVersion: BACKUP_VERSION, dbName: DB_NAME, dbVersion: db.version, createdAt: new Date().toISOString(), counts: Object.fromEntries(Object.entries(stores).map(([k, v]) => [k, v.rows.length])), stores };
  } finally { db.close(); }
}

export function backupFileName(backup) { return `chronium-backup-${String(backup.createdAt).slice(0, 10)}-v${backup.dbVersion}.json`; }

export class BackupFileError extends Error {}
export function parseBackupText(text) {
  let b;
  try { b = JSON.parse(text); } catch { throw new BackupFileError('This is not a Chronium backup file (it could not be read).'); }
  if (!b || b.format !== BACKUP_FORMAT) throw new BackupFileError('This is not a Chronium backup file.');
  if (!Number.isInteger(b.backupVersion) || b.backupVersion > BACKUP_VERSION) throw new BackupFileError('This backup was made by a newer version of Chronium. Update Chronium, then try again.');
  if (!b.stores || typeof b.stores !== 'object') throw new BackupFileError('This backup file is damaged (it has no data section).');
  for (const [name, s] of Object.entries(b.stores)) if (!s || !Array.isArray(s.rows)) throw new BackupFileError(`This backup file is damaged (the "${name}" section is not a list).`);
  return b;
}

/**
 * Puts a backup's rows into the CURRENT database. Rows that already exist (same key) are kept as they are, never
 * overwritten. Stores the current version does not have are skipped. Returns { added, kept, skippedStores }.
 */
export async function restoreRawBackup(backup, { openCurrentDb }) {
  const db = await openCurrentDb();
  const added = {}; const kept = {}; const skippedStores = [];
  for (const [name, s] of Object.entries(backup.stores)) {
    if (!db.objectStoreNames.contains(name)) { skippedStores.push(name); continue; }
    await new Promise((resolve, reject) => {
      const t = db.transaction(name, 'readwrite'); const store = t.objectStore(name);
      added[name] = 0; kept[name] = 0;
      for (const raw of s.rows) {
        const row = decodeValue(raw);
        const add = store.add(row);
        add.onsuccess = () => { added[name] += 1; };
        add.onerror = (e) => { kept[name] += 1; e.preventDefault(); e.stopPropagation(); }; // key or unique index already present: keep what is there
      }
      t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || new Error('restore aborted'));
    });
  }
  return { added, kept, skippedStores };
}
