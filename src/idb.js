const DB_NAME = 'openclawCollector';
const DB_VERSION = 1;

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('visits')) {
        const visits = db.createObjectStore('visits', { keyPath: 'id', autoIncrement: true });
        visits.createIndex('byDay', 'day', { unique: false });
      }
      if (!db.objectStoreNames.contains('batches')) {
        const batches = db.createObjectStore('batches', { keyPath: 'batchId' });
        batches.createIndex('byDay', 'day', { unique: false });
      }
    };
  });
}

export async function addVisit(visit) {
  const db = await openDb();
  return txDone(db, 'visits', 'readwrite', (store) => store.add(visit));
}

export async function getVisitsByDay(day) {
  const db = await openDb();
  const tx = db.transaction('visits', 'readonly');
  const idx = tx.objectStore('visits').index('byDay');
  const req = idx.getAll(day);
  const rows = await request(req);
  await transactionDone(tx);
  return rows;
}

export async function deleteVisit(id) {
  const db = await openDb();
  return txDone(db, 'visits', 'readwrite', (store) => store.delete(id));
}

export async function deleteVisitsByDay(day) {
  const db = await openDb();
  const tx = db.transaction('visits', 'readwrite');
  const idx = tx.objectStore('visits').index('byDay');
  const range = IDBKeyRange.only(day);

  await new Promise((resolve, reject) => {
    const req = idx.openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });

  await transactionDone(tx);
}

export async function upsertBatch(batch) {
  const db = await openDb();
  return txDone(db, 'batches', 'readwrite', (store) => store.put(batch));
}

export async function getBatch(batchId) {
  const db = await openDb();
  const tx = db.transaction('batches', 'readonly');
  const req = tx.objectStore('batches').get(batchId);
  const row = await request(req);
  await transactionDone(tx);
  return row;
}

export async function getAllBatches() {
  const db = await openDb();
  const tx = db.transaction('batches', 'readonly');
  const req = tx.objectStore('batches').getAll();
  const rows = await request(req);
  await transactionDone(tx);
  return rows.sort((a, b) => (b.day || '').localeCompare(a.day || ''));
}

function txDone(db, storeName, mode, action) {
  const tx = db.transaction(storeName, mode);
  const req = action(tx.objectStore(storeName));
  return Promise.all([request(req), transactionDone(tx)]).then(([r]) => r);
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
