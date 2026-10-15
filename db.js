// Tiny IndexedDB wrapper.
// 'kv'    → library records ('books', 'audio')
// 'files' → audio blobs, keyed `${audiobookId}:${trackIndex}`
const DB_NAME = 'my-library';
const VERSION = 1;

let dbPromise = null;
function open() {
  if (!dbPromise) {
    const p = dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
      };
      req.onsuccess = () => {
        const d = req.result;
        // The browser can close the connection (e.g. Android while the app is in the
        // background); forget it so the next call opens a fresh one.
        const forget = () => { if (dbPromise === p) dbPromise = null; };
        d.onclose = forget;
        d.onversionchange = () => { forget(); d.close(); };
        resolve(d);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

async function run(store, mode, fn, retry = true) {
  const p = open();
  const d = await p;
  try {
    return await new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = t.onabort = () => reject(t.error);
    });
  } catch (e) {
    // "The database connection is closing": reopen once and try again.
    if (!retry || !e || e.name !== 'InvalidStateError') throw e;
    if (dbPromise === p) dbPromise = null;
    return run(store, mode, fn, false);
  }
}

export const db = {
  get: key => run('kv', 'readonly', s => s.get(key)),
  set: (key, value) => run('kv', 'readwrite', s => s.put(value, key)),
  del: key => run('kv', 'readwrite', s => s.delete(key)),
  getFile: key => run('files', 'readonly', s => s.get(key)),
  putFile: (key, blob) => run('files', 'readwrite', s => s.put(blob, key)),
  deleteFiles: id => run('files', 'readwrite', s => s.delete(IDBKeyRange.bound(id + ':', id + ':￿'))),
};
