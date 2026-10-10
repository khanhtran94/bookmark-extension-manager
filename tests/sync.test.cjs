const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { IDBFactory } = require('fake-indexeddb');
const model = require('../sheets-model.js');
const bookmark = (id, title = id) => ({ id, title, url: 'https://example.com/' + id, tags: [], folderId: '', createdAt: 1, clickCount: 0, domain: 'example.com' });
function environment() {
  const storage = {}, listeners = [];
  const rows = { Bookmarks: [model.HEADER], Folders: [model.HEADER] };
  const queues = new Map();
  const control = { failAppendAfterWrite: false, failRead: false, appends: 0 };
  const chrome = {
    storage: { local: {
      async get(keys, callback) {
        const result = Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, storage[key]]));
        callback?.(structuredClone(result));
        return structuredClone(result);
      },
      async set(values) { Object.assign(storage, structuredClone(values)); }
    } },
    runtime: {
      id: 'test', getManifest: () => ({ oauth2: { client_id: 'test' } }),
      onMessage: { addListener: fn => listeners.push(fn) },
      onStartup: { addListener() {} }, onInstalled: { addListener() {} },
      async sendMessage() {}
    },
    identity: { async getAuthToken() { return { token: 'test-token' }; }, async removeCachedAuthToken() {} },
    alarms: { async create() {}, onAlarm: { addListener() {} } }
  };
  const context = vm.createContext({
    indexedDB: new IDBFactory(), chrome, crypto, AbortSignal, structuredClone, console,
    navigator: { locks: { request: (name, fn) => {
      const result = (queues.get(name) || Promise.resolve()).then(fn);
      queues.set(name, result.catch(() => {}));
      return result;
    } } },
    fetch: async (url, options) => {
      if (url.includes('values:batchGet')) {
        if (control.failRead) throw new Error('offline');
        return { ok: true, json: async () => ({ valueRanges: Object.values(rows).map(values => ({ values: structuredClone(values) })) }) };
      }
      if (url.includes(':append?')) {
        const name = decodeURIComponent(url).includes('Bookmarks!') ? 'Bookmarks' : 'Folders';
        rows[name].push(...JSON.parse(options.body).values);
        control.appends++;
        if (control.failAppendAfterWrite) { control.failAppendAfterWrite = false; throw new Error('connection lost after commit'); }
        return { ok: true, json: async () => ({}) };
      }
      throw new Error('Unexpected request: ' + url);
    }
  });
  for (const file of ['bookmark-db.js', 'sheets-model.js', 'sheets-sync.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  const sync = () => new Promise(resolve => listeners.some(fn => fn({ type: 'sheets-sync', manual: true }, { id: 'test' }, resolve)));
  const enable = () => { storage.sheetsConfig = { enabled: true, id: 'abcdefghijklmnopqrstuv' }; };
  return { db: context.BookmarkDB, storage, rows, control, enable, sync };
}
test('log preserves order, ignores retries and applies tombstones', () => {
  const a = { op: 'a', kind: 'bookmarks', id: 'a', value: bookmark('a') };
  const b = { ...a, op: 'b', value: bookmark('a', 'updated') };
  assert.equal(model.materialize([a, b, a]).bookmarks[0].title, 'updated');
  assert.equal(model.materialize([a, { ...a, op: 'c', value: null }, a]).bookmarks.length, 0);
  assert.equal(model.materialize([a, { ...b, id: 'b', value: { ...b.value, id: 'b' } }]).bookmarks.length, 1);
  assert.throws(() => model.rowsToEvents('bookmarks', [['wrong header']]));
});
test('cache and outbox roll back together on unique URL failure', async () => {
  const { db } = environment();
  await assert.rejects(db.putBookmarks([bookmark('a'), { ...bookmark('b'), url: bookmark('a').url }]));
  const snapshot = await db.snapshot();
  assert.equal(snapshot.bookmarks.length, 0);
  assert.equal(snapshot.pending.length, 0);
});
test('rapid updates retain local order', async () => {
  const { db } = environment();
  await db.putBookmark(bookmark('a', 'first'));
  await db.putBookmark(bookmark('a', 'second'));
  await db.deleteBookmark('a');
  const { pending } = await db.snapshot();
  assert.equal(pending[0].value.title, 'first');
  assert.equal(pending[1].value.title, 'second');
  assert.equal(pending[2].value, null);
});
test('empty cache restores cloud without appending deletes', async () => {
  const e = environment();
  e.rows.Bookmarks.push(model.toRow({ op: 'cloud', id: 'a', kind: 'bookmarks', at: 1, value: bookmark('a') }));
  e.enable();
  assert.equal((await e.sync()).ok, true);
  assert.equal((await e.db.getAllBookmarks())[0].id, 'a');
  assert.equal(e.control.appends, 0);
});
test('offline queue survives; ambiguous append not duplicated on retry', async () => {
  const e = environment();
  await e.db.putBookmark(bookmark('a'));
  e.enable();
  e.control.failRead = true;
  assert.equal((await e.sync()).ok, false);
  assert.equal((await e.db.snapshot()).pending.length, 1);
  e.control.failRead = false;
  e.control.failAppendAfterWrite = true;
  assert.equal((await e.sync()).ok, false);
  assert.equal((await e.db.snapshot()).pending.length, 1);
  assert.equal((await e.sync()).ok, true);
  assert.equal(e.control.appends, 1);
  assert.equal((await e.db.snapshot()).pending.length, 0);
});
test('stale bulk edit preserves another window additions', async () => {
  const { db } = environment();
  await db.putBookmark(bookmark('a'));
  const baseline = await db.snapshot();
  await db.putBookmark(bookmark('b'));
  await db.replaceAll([], [], baseline);
  assert.equal((await db.getAllBookmarks()).length, 1);
  assert.equal((await db.getAllBookmarks())[0].id, 'b');
});
test('missing cloud history stops sync before replacing local', async () => {
  const e = environment();
  await e.db.putBookmark(bookmark('a'));
  e.enable();
  assert.equal((await e.sync()).ok, true);
  e.rows.Bookmarks.splice(1);
  assert.equal((await e.sync()).ok, false);
  assert.equal((await e.db.getAllBookmarks()).length, 1);
});
test('delete syncs tombstone; fresh cache does not resurrect it', async () => {
  const e = environment();
  await e.db.putBookmark(bookmark('a'));
  e.enable();
  await e.sync();
  await e.db.deleteBookmark('a');
  assert.equal((await e.sync()).ok, true);
  assert.equal(e.rows.Bookmarks.at(-1)[2], 'delete');
  const restored = environment();
  restored.rows.Bookmarks.push(...e.rows.Bookmarks.slice(1));
  restored.enable();
  assert.equal((await restored.sync()).ok, true);
  assert.equal((await restored.db.getAllBookmarks()).length, 0);
});
test('legacy storage not reimported after cloud cache loss', async () => {
  const e = environment();
  e.storage.bookmarks = [bookmark('legacy')];
  e.enable();
  await e.db.migrateFromChromeStorage();
  assert.equal((await e.db.snapshot()).pending.length, 0);
});

test('deleting the winning duplicate URL does not resurrect an older ID', () => {
  const a = { op: 'a', kind: 'bookmarks', id: 'a', value: bookmark('a') };
  const b = { ...a, op: 'b', id: 'b', value: { ...a.value, id: 'b' } };
  assert.equal(model.materialize([a, b, { ...b, op: 'delete-b', value: null }]).bookmarks.length, 0);
});
test('malformed put with null payload rejected before any cache change', () => {
  assert.throws(() => model.rowsToEvents('bookmarks', [model.HEADER, ['op', 'a', 'put', '1', '', '', 'null']]));
});
test('existing cache without outbox is bootstrapped and survives ambiguous upload', async () => {
  const e = environment();
  await e.db.applyRemote({ bookmarks: [bookmark('old')], folders: [] }, []);
  e.enable();
  e.control.failAppendAfterWrite = true;
  assert.equal((await e.sync()).ok, false);
  assert.equal((await e.db.snapshot()).pending.length, 1);
  assert.equal((await e.sync()).ok, true);
  assert.equal(e.control.appends, 1);
});

test('upgrade repairs an empty v1 database left by the legacy background worker', async () => {
  const indexedDB = new IDBFactory();
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('bookmark_manager_db', 1);
    req.onsuccess = () => { req.result.close(); resolve(); };
    req.onerror = () => reject(req.error);
  });
  const context = vm.createContext({ indexedDB, navigator: { locks: { request: (_, fn) => fn() } }, crypto });
  vm.runInContext(fs.readFileSync('bookmark-db.js', 'utf8'), context);
  await context.BookmarkDB.putBookmark(bookmark('repaired'));
  assert.equal((await context.BookmarkDB.snapshot()).bookmarks[0].id, 'repaired');
  assert.equal((await context.BookmarkDB.init()).version, 2);
});

test('upgrade adds missing stores and indexes without losing existing bookmarks', async () => {
  const indexedDB = new IDBFactory();
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('bookmark_manager_db', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('bookmarks', { keyPath: 'id' }).put(bookmark('keep'));
    };
    req.onsuccess = () => { req.result.close(); resolve(); };
    req.onerror = () => reject(req.error);
  });
  const context = vm.createContext({ indexedDB, navigator: { locks: { request: (_, fn) => fn() } }, crypto });
  vm.runInContext(fs.readFileSync('bookmark-db.js', 'utf8'), context);
  assert.equal((await context.BookmarkDB.findBookmarkByUrl(bookmark('keep').url)).id, 'keep');
  await context.BookmarkDB.putFolder({ id: 'folder', name: 'New folder' });
  assert.equal((await context.BookmarkDB.snapshot()).bookmarks.length, 1);
  assert.equal((await context.BookmarkDB.snapshot()).folders.length, 1);
});

for (const version of [2, 7]) {
  test(`repairs missing stores at version ${version}, preserving records`, async () => {
    const indexedDB = new IDBFactory();
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('bookmark_manager_db', version);
      req.onupgradeneeded = () => req.result.createObjectStore('bookmarks', { keyPath: 'id' }).put(bookmark('keep'));
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });
    const context = vm.createContext({ indexedDB, navigator: { locks: { request: (_, fn) => fn() } }, crypto });
    vm.runInContext(fs.readFileSync('bookmark-db.js', 'utf8'), context);
    const db = context.BookmarkDB;
    assert.equal((await db.snapshot()).bookmarks[0].id, 'keep');
    assert.equal((await db.init()).version, version + 1);
    await db.putFolder({ id: 'f', name: 'Folder' });
    assert.equal((await db.snapshot()).folders.length, 1);
  });
}
