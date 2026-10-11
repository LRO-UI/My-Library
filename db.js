// Tiny IndexedDB wrapper.
// 'kv'    → library records ('books', 'audio')
// 'files' → audio blobs, keyed `${audiobookId}:${trackIndex}`
const DB_NAME = 'my-library';
const VERSION = 1;

let dbPromise = null;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

export const db = {
  get: key => run('kv', 'readonly', s => s.get(key)),
  set: (key, value) => run('kv', 'readwrite', s => s.put(value, key)),
  getFile: key => run('files', 'readonly', s => s.get(key)),
  putFile: (key, blob) => run('files', 'readwrite', s => s.put(blob, key)),
  deleteFiles: id => run('files', 'readwrite', s => s.delete(IDBKeyRange.bound(id + ':', id + ':￿'))),
};
