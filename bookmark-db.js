(function attachBookmarkDB(global) {
  const DB_NAME = "bookmark_manager_db";
  const DB_VERSION = 1;
  const BOOKMARKS_STORE = "bookmarks";
  const FOLDERS_STORE = "folders";
  const META_STORE = "meta";
  const MIGRATION_KEY = "migrated_from_chrome_storage_v1";

  let dbPromise = null;

  function promisifyRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }

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

  function openDB() {
    if (dbPromise) {
      return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(BOOKMARKS_STORE)) {
          const bookmarksStore = db.createObjectStore(BOOKMARKS_STORE, { keyPath: "id" });
          bookmarksStore.createIndex("url", "url", { unique: true });
          bookmarksStore.createIndex("createdAt", "createdAt", { unique: false });
          bookmarksStore.createIndex("folderId", "folderId", { unique: false });
        }

        if (!db.objectStoreNames.contains(FOLDERS_STORE)) {
          db.createObjectStore(FOLDERS_STORE, { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Unable to open IndexedDB"));
    });

    return dbPromise;
  }

  function getTransaction(db, stores, mode = "readonly") {
    return db.transaction(stores, mode);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function getMeta(key) {
    const db = await openDB();
    const tx = getTransaction(db, [META_STORE], "readonly");
    const store = tx.objectStore(META_STORE);
    return promisifyRequest(store.get(key));
  }

  async function setMeta(key, value, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const db = await openDB();
        const tx = getTransaction(db, [META_STORE], "readwrite");
        const store = tx.objectStore(META_STORE);
        const request = store.put({ key, value, at: Date.now() });

        await new Promise((resolve, reject) => {
          request.onerror = () => reject(request.error || new Error("Meta put failed"));
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error("Meta transaction failed"));
          tx.onabort = () => reject(tx.error || new Error("Meta transaction aborted"));
        });
        return;
      } catch (error) {
        if (error && error.name === "TransactionInactiveError" && attempt < retries) {
          await delay(0);
          continue;
        }
        throw error;
      }
    }
  }

  async function getAllBookmarks() {
    const db = await openDB();
    const tx = getTransaction(db, [BOOKMARKS_STORE], "readonly");
    const store = tx.objectStore(BOOKMARKS_STORE);
    const data = await promisifyRequest(store.getAll());
    return (data || []).map(normalizeBookmark);
  }

  async function getAllFolders() {
    const db = await openDB();
    const tx = getTransaction(db, [FOLDERS_STORE], "readonly");
    const store = tx.objectStore(FOLDERS_STORE);
    const data = await promisifyRequest(store.getAll());
    return (data || []).map(normalizeFolder);
  }

  async function findBookmarkByUrl(url) {
    const db = await openDB();
    const tx = getTransaction(db, [BOOKMARKS_STORE], "readonly");
    const store = tx.objectStore(BOOKMARKS_STORE);
    const index = store.index("url");
    const result = await promisifyRequest(index.get(url));
    return result ? normalizeBookmark(result) : null;
  }

  async function putBookmark(bookmark) {
    const db = await openDB();
    const tx = getTransaction(db, [BOOKMARKS_STORE], "readwrite");
    const store = tx.objectStore(BOOKMARKS_STORE);
    await promisifyRequest(store.put(normalizeBookmark(bookmark)));
  }

  async function putBookmarks(bookmarks) {
    const db = await openDB();
    const tx = getTransaction(db, [BOOKMARKS_STORE], "readwrite");
    const store = tx.objectStore(BOOKMARKS_STORE);
    for (const bookmark of bookmarks || []) {
      await promisifyRequest(store.put(normalizeBookmark(bookmark)));
    }
  }

  async function deleteBookmark(id) {
    const db = await openDB();
    const tx = getTransaction(db, [BOOKMARKS_STORE], "readwrite");
    const store = tx.objectStore(BOOKMARKS_STORE);
    await promisifyRequest(store.delete(id));
  }

  async function putFolder(folder) {
    const db = await openDB();
    const tx = getTransaction(db, [FOLDERS_STORE], "readwrite");
    const store = tx.objectStore(FOLDERS_STORE);
    await promisifyRequest(store.put(normalizeFolder(folder)));
  }

  async function putFolders(folders) {
    const db = await openDB();
    const tx = getTransaction(db, [FOLDERS_STORE], "readwrite");
    const store = tx.objectStore(FOLDERS_STORE);
    for (const folder of folders || []) {
      await promisifyRequest(store.put(normalizeFolder(folder)));
    }
  }

  async function replaceAll(bookmarks, folders) {
    const db = await openDB();
    const tx = getTransaction(db, [BOOKMARKS_STORE, FOLDERS_STORE], "readwrite");
    const bookmarksStore = tx.objectStore(BOOKMARKS_STORE);
    const foldersStore = tx.objectStore(FOLDERS_STORE);

    await promisifyRequest(bookmarksStore.clear());
    await promisifyRequest(foldersStore.clear());

    for (const folder of folders || []) {
      await promisifyRequest(foldersStore.put(normalizeFolder(folder)));
    }

    for (const bookmark of bookmarks || []) {
      await promisifyRequest(bookmarksStore.put(normalizeBookmark(bookmark)));
    }
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
    init: openDB,
    migrateFromChromeStorage,
    getAllBookmarks,
    getAllFolders,
    findBookmarkByUrl,
    putBookmark,
    putBookmarks,
    deleteBookmark,
    putFolder,
    putFolders,
    replaceAll
  };
})(window);
