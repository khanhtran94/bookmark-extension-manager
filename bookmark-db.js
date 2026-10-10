(function attachBookmarkDB(global) {
  const MIGRATION_KEY = 'migrated_from_chrome_storage_v1';
  const BUILD = 'db-diagnostic-2026-10-10-1';
  const SOURCE = global.document?.currentScript?.src || global.location?.href || 'unknown';
  function normalizeBookmark(bookmark) {
    return {
      ...bookmark,
      id: String(bookmark.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      title: String(bookmark.title || "Khong co tieu de"),
      url: String(bookmark.url || ""),
      domain: String(bookmark.domain || ""),
      tags: Array.isArray(bookmark.tags) ? bookmark.tags : [],
      folderId: typeof bookmark.folderId === "string" ? bookmark.folderId : "",
      createdAt: typeof bookmark.createdAt === "number" ? bookmark.createdAt : Date.now(),
      clickCount: typeof bookmark.clickCount === "number" ? bookmark.clickCount : 0
    };
  }

  function normalizeFolder(folder) {
    return {
      id: String(folder.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      name: String(folder.name || "").trim(),
      parentId: typeof folder.parentId === "string" ? folder.parentId : "",
      createdAt: typeof folder.createdAt === "number" ? folder.createdAt : Date.now()
    };
  }


  let dbPromise;
  const lock = (fn) => navigator.locks.request('bookmark-data', fn);
  const request = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  function openConnection(version) {
    return new Promise((resolve, reject) => {
      const req = version === undefined
        ? indexedDB.open('bookmark_manager_db')
        : indexedDB.open('bookmark_manager_db', version);
      let blocked = false;
      req.onblocked = () => {
        blocked = true;
        reject(new Error('Hay dong cac tab Bookmark Manager va popup cu, roi Reload extension de nang cap DB.'));
      };
      req.onupgradeneeded = () => {
        if (blocked) { req.transaction.abort(); return; }
        const db = req.result;
        const store = db.objectStoreNames.contains('bookmarks')
          ? req.transaction.objectStore('bookmarks')
          : db.createObjectStore('bookmarks', { keyPath: 'id' });
        if (!store.indexNames.contains('url')) store.createIndex('url', 'url', { unique: true });
        if (!store.indexNames.contains('createdAt')) store.createIndex('createdAt', 'createdAt');
        if (!store.indexNames.contains('folderId')) store.createIndex('folderId', 'folderId');
        if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => { db.close(); dbPromise = null; };
        db.onclose = () => { dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
  }
  function hasSchema(db) {
    if (!['bookmarks', 'folders', 'meta'].every(name => db.objectStoreNames.contains(name))) return false;
    const store = db.transaction('bookmarks', 'readonly').objectStore('bookmarks');
    return ['url', 'createdAt', 'folderId'].every(name => store.indexNames.contains(name));
  }
  function openDB() {
    if (!dbPromise) {
      // Inspect the actual schema, including databases already at v2 or later.
      // Serialize repair across the popup, manager tabs and service worker.
      const opening = navigator.locks.request('bookmark-schema', async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const db = await openConnection();
          if (hasSchema(db)) return db;
          const nextVersion = db.version + 1;
          db.close();
          let repaired;
          try { repaired = await openConnection(nextVersion); }
          catch (error) {
            if (error.name === 'VersionError') continue;
            throw error;
          }
          if (hasSchema(repaired)) return repaired;
          repaired.close();
        }
        throw new Error('Khong the sua cau truc Bookmark DB. Hay dong cac tab cu va Reload extension.');
      });
      dbPromise = opening;
      opening.catch(() => { if (dbPromise === opening) dbPromise = null; });
    }
    return dbPromise;
  }
  async function transaction(mode, fn) {
    const db = await openDB();
    let tx;
    try {
      tx = db.transaction(['bookmarks', 'folders', 'meta'], mode);
    } catch (cause) {
      const detail = { build: BUILD, source: SOURCE, database: db.name,
        version: db.version, stores: Array.from(db.objectStoreNames), mode };
      console.error('BookmarkDB transaction failed', detail, cause);
      throw new Error(`${cause.name}: ${cause.message} | ${JSON.stringify(detail)}`, { cause });
    }
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Không thể lưu dữ liệu.'));
      tx.onerror = () => {};
    });
    try {
      const result = await fn(tx);
      await done;
      return result;
    } catch (error) {
      try { tx.abort(); } catch (_) {}
      await done.catch(() => {});
      throw error;
    }
  }
  const getAll = (name) => transaction('readonly', tx => request(tx.objectStore(name).getAll()));
  const getAllBookmarks = () => getAll('bookmarks');
  const getAllFolders = () => getAll('folders');
  const getMeta = (key) => transaction('readonly', tx => request(tx.objectStore('meta').get(key)));
  const setMeta = (key, value) => transaction('readwrite', tx => tx.objectStore('meta').put({ key, value }));
  function eventFor(kind, id, value) {
    return { op: crypto.randomUUID(), kind, id, value, at: Date.now() };
  }
  async function queue(tx, event) {
    const sequence = (await request(tx.objectStore('meta').get('sync-sequence')))?.value || 0;
    event.sequence = sequence + 1;
    tx.objectStore('meta').put({ key: 'sync-sequence', value: event.sequence });
    tx.objectStore('meta').put({ key: 'pending:' + event.op, value: event });
  }
  function notify() {
    if (global.document) {
      chrome.runtime.sendMessage({ type: 'sheets-dirty' }).catch(() => {});
      global.dispatchEvent(new Event('bookmark-local-change'));
    }
  }
  async function change(kind, values, deleted = []) {
    await lock(() => transaction('readwrite', async tx => {
      const store = tx.objectStore(kind);
      for (const value of values) {
        const old = await request(store.get(value.id));
        if (JSON.stringify(old) === JSON.stringify(value)) continue;
        store.put(value);
        await queue(tx, eventFor(kind, value.id, value));
      }
      for (const id of deleted) {
        store.delete(id);
        await queue(tx, eventFor(kind, id, null));
      }
    }));
    notify();
  }
  const putBookmarks = values => change('bookmarks', values.map(normalizeBookmark));
  const putFolders = values => change('folders', values.map(normalizeFolder));
  async function replaceAll(bookmarks, folders, baseline) {
    await lock(() => transaction('readwrite', async tx => {
      for (const [kind, values] of [
        ['bookmarks', bookmarks.map(normalizeBookmark)], ['folders', folders.map(normalizeFolder)]
      ]) {
        const store = tx.objectStore(kind);
        const old = await request(store.getAll());
        const next = new Map(values.map(value => [value.id, value]));
        const previous = new Map((baseline?.[kind] || old).map(value => [value.id, value]));
        const merged = new Map(old.map(value => [value.id, value]));
        for (const value of values) {
          if (JSON.stringify(previous.get(value.id)) !== JSON.stringify(value)) {
            merged.set(value.id, value);
            await queue(tx, eventFor(kind, value.id, value));
          }
        }
        for (const value of previous.values()) {
          if (!next.has(value.id)) {
            merged.delete(value.id);
            await queue(tx, eventFor(kind, value.id, null));
          }
        }
        // Clear/reinsert in one transaction also supports URL swaps under the unique index.
        store.clear();
        for (const value of merged.values()) store.put(value);
      }
    }));
    notify();
  }
  async function snapshot() {
    return transaction('readonly', async tx => {
      const [bookmarks, folders, meta] = await Promise.all(
        ['bookmarks', 'folders', 'meta'].map(name => request(tx.objectStore(name).getAll()))
      );
      return { bookmarks, folders, pending: meta.filter(x => x.key.startsWith('pending:')).map(x => x.value).sort((a, b) => a.sequence - b.sequence) };
    });
  }
  // Caller holds bookmark-data lock; applying remote state never creates outgoing changes.
  async function applyRemote(state, acknowledged) {
    return transaction('readwrite', tx => {
      for (const kind of ['bookmarks', 'folders']) {
        const store = tx.objectStore(kind);
        store.clear();
        state[kind].forEach(value => store.put(value));
      }
      acknowledged.forEach(op => tx.objectStore('meta').delete('pending:' + op));
    });
  }
  async function stageEvents(events) {
    return transaction('readwrite', async tx => {
      for (const event of events) {
        if (!(await request(tx.objectStore('meta').get('pending:' + event.op)))) await queue(tx, event);
      }
    });
  }
  function getFromChromeStorage(keys) {
    return new Promise((resolve) => {
      if (!global.chrome || !chrome.storage || !chrome.storage.local) {
        resolve({});
        return;
      }

      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
  }

  async function migrateFromChromeStorage() {
    // After cache loss, restore from the configured cloud instead of resurrecting legacy records.
    if ((await chrome.storage.local.get('sheetsConfig')).sheetsConfig?.id) return;
    const migrated = await getMeta(MIGRATION_KEY);
    if (migrated && migrated.value === true) {
      return;
    }

    const existingBookmarks = await getAllBookmarks();
    const existingFolders = await getAllFolders();
    const existingUrls = new Set(existingBookmarks.map((item) => item.url));
    const existingFolderIds = new Set(existingFolders.map((item) => item.id));

    const result = await getFromChromeStorage(["bookmarks", "folders"]);
    const bookmarks = Array.isArray(result.bookmarks) ? result.bookmarks : [];
    const folders = Array.isArray(result.folders) ? result.folders : [];

    const importedFolders = folders
      .map(normalizeFolder)
      .filter((folder) => folder.id && folder.name && !existingFolderIds.has(folder.id));
    const importedBookmarks = bookmarks
      .map(normalizeBookmark)
      .filter((bookmark) => bookmark.url && !existingUrls.has(bookmark.url));

    if (importedFolders.length) {
      await putFolders(importedFolders);
    }

    if (importedBookmarks.length) {
      await putBookmarks(importedBookmarks);
    }

    await setMeta(MIGRATION_KEY, true);
  }


  global.BookmarkDB = {
    build: BUILD,
    diagnose: async () => {
      const result = { build: BUILD, source: SOURCE, extensionId: global.chrome?.runtime?.id };
      try {
        const db = await openConnection();
        result.database = db.name;
        result.version = db.version;
        result.stores = Array.from(db.objectStoreNames);
        db.close();
      } catch (error) { result.error = `${error.name}: ${error.message}`; }
      return result;
    },
    init: openDB, lock, snapshot, applyRemote, stageEvents, eventFor, getMeta, setMeta,
    migrateFromChromeStorage, getAllBookmarks, getAllFolders,
    findBookmarkByUrl: url => transaction('readonly', tx => request(tx.objectStore('bookmarks').index('url').get(url))),
    putBookmarks, putFolders, replaceAll,
    putBookmark: value => putBookmarks([value]),
    putFolder: value => putFolders([value]),
    deleteBookmark: id => change('bookmarks', [], [id])
  };
})(globalThis);
