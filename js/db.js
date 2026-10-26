/*
 * MyExpense storage: IndexedDB on this device only. Nothing is sent over the network.
 *
 * IDB_VERSION controls object stores (structure). Record-level data migrations are
 * driven by the "schema" meta value and MyExpenseCore.migrateState.
 */
(function (root) {
  'use strict';

  const C = root.MyExpenseCore;
  const DB_NAME = 'myexpense';
  const IDB_VERSION = 1;
  const META = 'meta';
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in root)) {
        reject(new Error('This browser does not provide IndexedDB storage.'));
        return;
      }
      let req;
      try {
        req = root.indexedDB.open(DB_NAME, IDB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      req.onupgradeneeded = (event) => {
        const d = req.result;
        const old = event.oldVersion;
        if (old < 1) {
          for (const s of C.STORES) d.createObjectStore(s, { keyPath: 'id' });
          d.createObjectStore(META, { keyPath: 'key' });
        }
        // Future structure changes: if (old < 2) { ... }
      };
      req.onsuccess = () => {
        db = req.result;
        db.onversionchange = () => {
          db.close();
          root.dispatchEvent(new CustomEvent('myexpense:dbclosed'));
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('Could not open storage.'));
      req.onblocked = () => reject(new Error('Storage is busy in another tab. Close other MyExpense tabs and reload.'));
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Storage write failed.'));
      tx.onabort = () => reject(tx.error || new Error('Storage write was cancelled.'));
    });
  }

  function getAllFrom(store) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getMeta(key) {
    const rows = await getAllFrom(META);
    const row = rows.find((r) => r.key === key);
    return row ? row.value : undefined;
  }

  /** Load everything. Seeds defaults on first run and applies data migrations. */
  async function loadAll() {
    if (!db) await open();
    const state = {};
    for (const s of C.STORES) state[s] = await getAllFrom(s);
    const metaRows = await getAllFrom(META);
    const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
    state.settings = { ...C.DEFAULT_SETTINGS, ...(meta.settings || {}) };
    const device = meta.device || {};

    const schema = meta.schema;
    if (schema === undefined) {
      // First run on this device.
      const fresh = C.emptyState();
      await commit([
        ...fresh.categories.map((c) => ({ store: 'categories', put: c })),
        { store: META, put: { key: 'settings', value: fresh.settings } },
        { store: META, put: { key: 'schema', value: C.SCHEMA_VERSION } },
        { store: META, put: { key: 'device', value: { createdAt: C.nowISO() } } },
      ]);
      return { state: fresh, device: { createdAt: C.nowISO() }, firstRun: true };
    }
    if (schema > C.SCHEMA_VERSION) {
      throw new Error('This data was saved by a newer version of MyExpense. Reload to get the latest version.');
    }
    if (schema < C.SCHEMA_VERSION) {
      const migrated = C.migrateState(state, schema);
      await replaceAll(migrated, { schema: C.SCHEMA_VERSION });
      return { state: migrated, device, firstRun: false };
    }
    return { state, device, firstRun: false };
  }

  /**
   * Apply a list of operations in ONE IndexedDB transaction. Either all succeed or none do.
   * ops: [{ store, put: record } | { store, del: id }]
   */
  async function commit(ops) {
    if (!ops.length) return;
    if (!db) await open();
    const stores = Array.from(new Set(ops.map((o) => o.store)));
    const tx = db.transaction(stores, 'readwrite');
    const done = txDone(tx);
    for (const op of ops) {
      const os = tx.objectStore(op.store);
      if (op.put) os.put(op.put);
      else if (op.del !== undefined) os.delete(op.del);
    }
    await done;
  }

  /** Replace all app data atomically (used by restore and migrations). Device metadata is kept. */
  async function replaceAll(state, opts) {
    if (!db) await open();
    const stores = [...C.STORES, META];
    const tx = db.transaction(stores, 'readwrite');
    const done = txDone(tx);
    for (const s of C.STORES) {
      const os = tx.objectStore(s);
      os.clear();
      for (const r of state[s]) os.put(r);
    }
    const meta = tx.objectStore(META);
    meta.put({ key: 'settings', value: state.settings });
    meta.put({ key: 'schema', value: (opts && opts.schema) || C.SCHEMA_VERSION });
    await done;
  }

  /** Erase everything on this device, then reseed defaults. */
  async function eraseAll() {
    const fresh = C.emptyState();
    await replaceAll(fresh);
    await commit([{ store: META, put: { key: 'device', value: { createdAt: C.nowISO() } } }]);
    return fresh;
  }

  async function setDevice(device) {
    await commit([{ store: META, put: { key: 'device', value: device } }]);
  }

  root.MyExpenseDB = { open, loadAll, commit, replaceAll, eraseAll, getMeta, setDevice, META };
})(self);
