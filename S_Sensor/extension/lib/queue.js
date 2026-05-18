// lib/queue.js — IndexedDB offline queue (S_10.05).
// 한도 1000건. online 시 자동 drain.

const DB_NAME = 'gridge_sensor';
const DB_VERSION = 1;
const STORE = 'captures';
const MAX_RECORDS = 1000;
const DONE_TTL_MS = 24 * 60 * 60 * 1000;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('status', 'status');
        store.createIndex('captured_at', 'captured_at');
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

function tx(db, mode = 'readonly') {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(record) {
  const db = await openDb();
  record.id = record.id ?? crypto.randomUUID();
  record.status = 'pending';
  record.attempts = 0;
  record.enqueued_at = new Date().toISOString();
  await promisify(tx(db, 'readwrite').add(record));
  return record.id;
}

export async function popPending(limit = 1) {
  const db = await openDb();
  const store = tx(db, 'readonly');
  const idx = store.index('status');
  return new Promise((resolve) => {
    const out = [];
    const req = idx.openCursor(IDBKeyRange.only('pending'));
    req.onsuccess = (e) => {
      const c = e.target.result;
      if (c && out.length < limit) {
        out.push(c.value);
        c.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => resolve(out);
  });
}

export async function updateStatus(id, status, fields = {}) {
  const db = await openDb();
  const store = tx(db, 'readwrite');
  const record = await promisify(store.get(id));
  if (!record) return;
  record.status = status;
  if (status === 'sending') record.attempts = (record.attempts ?? 0) + 1;
  if (status === 'done') record.completed_at = new Date().toISOString();
  Object.assign(record, fields);
  await promisify(store.put(record));
}

export async function remove(id) {
  const db = await openDb();
  await promisify(tx(db, 'readwrite').delete(id));
}

export async function count() {
  const db = await openDb();
  return promisify(tx(db, 'readonly').count());
}

export async function listAll(limit = 200) {
  const db = await openDb();
  const store = tx(db, 'readonly');
  return new Promise((resolve) => {
    const out = [];
    const req = store.openCursor(null, 'prev');
    req.onsuccess = (e) => {
      const c = e.target.result;
      if (c && out.length < limit) {
        out.push(c.value);
        c.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => resolve(out);
  });
}

/**
 * 한도 1000건 — 오래된 'done' 우선 제거, 그래도 초과 시 'failed'.
 */
export async function trim() {
  const db = await openDb();
  const total = await count();
  if (total <= MAX_RECORDS) return;

  const overflow = total - MAX_RECORDS;
  const cutoff = new Date(Date.now() - DONE_TTL_MS).toISOString();
  const store = tx(db, 'readwrite');
  const idx = store.index('captured_at');

  await new Promise((resolve) => {
    let removed = 0;
    const req = idx.openCursor();
    req.onsuccess = (e) => {
      const c = e.target.result;
      if (!c || removed >= overflow) return resolve();
      const r = c.value;
      const tooOld = r.captured_at < cutoff;
      if ((r.status === 'done' && tooOld) || r.status === 'failed') {
        store.delete(r.id);
        removed += 1;
      }
      c.continue();
    };
    req.onerror = () => resolve();
  });
}
