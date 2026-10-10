/* Runs only in the extension service worker. Tokens stay in Chrome's identity cache. */
(function () {
  const CONFIG = 'sheetsConfig';
  const STATUS = 'sheetsStatus';
  const names = { bookmarks: 'Bookmarks', folders: 'Folders' };
  let active;
  let retryAfter = 0;
  let failures = 0;
  const status = value => chrome.storage.local.set({ [STATUS]: value });
  async function token(interactive = false) {
    if (!chrome.runtime.getManifest().oauth2?.client_id)
      throw new Error('Chưa cấu hình OAuth Client ID. Mở hướng dẫn Google Sheets.');
    const result = await chrome.identity.getAuthToken({ interactive });
    if (!result.token) throw new Error('Cần đăng nhập Google và cấp quyền Google Sheets.');
    return result.token;
  }
  async function api(id, path = '', method = 'GET', body, retry = true) {
    const accessToken = await token();
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}${path}`, {
      method, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000)
    });
    if (response.status === 401 && retry) {
      await chrome.identity.removeCachedAuthToken({ token: accessToken });
      return api(id, path, method, body, false);
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(`Google Sheets (${response.status}): ${detail.error?.message || 'Không thể kết nối'}`);
    }
    return response.json();
  }
  async function read(id) {
    const query = Object.values(names).map(name => `ranges=${encodeURIComponent(name + '!A:G')}`).join('&');
    const result = await api(id, '/values:batchGet?' + query);
    if (result.valueRanges?.length !== 2) throw new Error('Không đọc được đầy đủ hai tab dữ liệu.');
    return Object.keys(names).flatMap((kind, index) => {
      const rows = result.valueRanges[index].values;
      if (!rows?.length) throw new Error(`Tab ${names[kind]} thiếu tiêu đề; dừng đồng bộ để bảo vệ dữ liệu.`);
      return SheetsModel.rowsToEvents(kind, rows);
    });
  }
  async function initializeSheet(id) {
    const result = await api(id, '?fields=sheets.properties');
    const titles = new Set(result.sheets.map(sheet => sheet.properties.title));
    const missing = Object.values(names).filter(name => !titles.has(name));
    if (missing.length) await api(id, ':batchUpdate', 'POST', {
      requests: missing.map(title => ({ addSheet: { properties: { title } } }))
    });
    for (const title of Object.values(names)) {
      const range = encodeURIComponent(title + '!A:G');
      const existing = await api(id, '/values/' + range);
      if (existing.values?.length) SheetsModel.rowsToEvents(title === 'Bookmarks' ? 'bookmarks' : 'folders', existing.values);
      else await api(id, '/values/' + encodeURIComponent(title + '!A1:G1') + '?valueInputOption=RAW', 'PUT', {
        values: [SheetsModel.HEADER]
      });
    }
  }
  async function synchronize() {
    const { [CONFIG]: config } = await chrome.storage.local.get(CONFIG);
    if (!config?.enabled) return;
    const previous = (await chrome.storage.local.get(STATUS))[STATUS];
    await status({ state: 'syncing', lastSync: previous?.lastSync });
    try {
      await BookmarkDB.lock(async () => {
        const local = await BookmarkDB.snapshot();
        const remote = await read(config.id);
        const countKey = 'sheets-count:' + config.id;
        const previousCount = (await BookmarkDB.getMeta(countKey))?.value || 0;
        if (new Set(remote.map(event => event.op)).size < previousCount)
          throw new Error('Lịch sử trên Sheet bị thiếu dòng. Dừng đồng bộ; hãy khôi phục phiên bản Sheet trước đó.');
        const knownOps = new Set(remote.map(event => event.op));
        const knownIds = new Set(remote.map(event => event.kind + ':' + event.id));
        const queuedIds = new Set(local.pending.map(event => event.kind + ':' + event.id));
        let pending = [...local.pending];
        const seedKey = 'sheets-seeded:' + config.id;
        if (!(await BookmarkDB.getMeta(seedKey))?.value) {
          for (const kind of Object.keys(names)) {
            for (const value of local[kind]) {
              if (!knownIds.has(kind + ':' + value.id) && !queuedIds.has(kind + ':' + value.id))
                pending.push(BookmarkDB.eventFor(kind, value.id, value));
            }
          }
          // Persist bootstrap operation IDs before sending so ambiguous failures retry safely.
          await BookmarkDB.stageEvents(pending);
        }
        pending = pending.filter(event => !knownOps.has(event.op));
        for (const kind of Object.keys(names)) {
          const events = pending.filter(event => event.kind === kind);
          for (let start = 0; start < events.length; start += 100) {
            await api(config.id, '/values/' + encodeURIComponent(names[kind] + '!A:G') +
              ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', 'POST', {
                values: events.slice(start, start + 100).map(SheetsModel.toRow)
              });
          }
        }
        // Re-read the authoritative log to include concurrent writes from another device.
        const confirmed = pending.length ? await read(config.id) : remote;
        const confirmedOps = new Set(confirmed.map(event => event.op));
        if (pending.some(event => !confirmedOps.has(event.op))) throw new Error('Google chưa xác nhận đầy đủ thay đổi. Sẽ thử lại.');
        await BookmarkDB.applyRemote(SheetsModel.materialize(confirmed), [...confirmedOps]);
        await BookmarkDB.setMeta(seedKey, true);
        await BookmarkDB.setMeta(countKey, confirmedOps.size);
      });
      failures = 0;
      retryAfter = 0;
      await status({ state: 'synced', lastSync: Date.now() });
      chrome.runtime.sendMessage({ type: 'sheets-refreshed' }).catch(() => {});
    } catch (error) {
      failures += 1;
      retryAfter = Date.now() + Math.min(15 * 60000, 30000 * 2 ** Math.min(failures, 5));
      await status({ state: 'error', message: error.message, lastSync: previous?.lastSync });
      throw error;
    }
  }
  function sync(manual = false) {
    if (active) return active;
    if (!manual && Date.now() < retryAfter) return Promise.resolve();
    active = synchronize().finally(() => { active = null; });
    return active;
  }
  async function connect(raw) {
    const id = String(raw || '').trim().match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] || String(raw || '').trim();
    if (!/^[\w-]{20,}$/.test(id)) throw new Error('Nhập URL hoặc ID Google Sheet hợp lệ.');
    await token(true);
    if (active) await active.catch(() => {});
    await BookmarkDB.lock(async () => {
      const old = (await chrome.storage.local.get(CONFIG))[CONFIG];
      if (old?.id && old.id !== id) throw new Error('Đã gắn với Sheet khác. Hãy tiếp tục dùng Sheet cũ để giữ hàng đợi an toàn.');
      await initializeSheet(id);
      await chrome.storage.local.set({ [CONFIG]: { id, enabled: true } });
    });
    await sync(true);
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    let task;
    if (message.type === 'sheets-connect') task = connect(message.sheet);
    else if (message.type === 'sheets-sync') task = sync(Boolean(message.manual));
    else if (message.type === 'sheets-pause') task = (async () => {
      if (active) await active.catch(() => {});
      const config = (await chrome.storage.local.get(CONFIG))[CONFIG];
      if (config) await chrome.storage.local.set({ [CONFIG]: { ...config, enabled: false } });
      await status({ state: 'paused' });
    })();
    else if (message.type === 'sheets-dirty') task = (async () => {
      const previous = (await chrome.storage.local.get(STATUS))[STATUS];
      await status({ state: 'pending', lastSync: previous?.lastSync });
      await chrome.alarms.create('sheets-soon', { when: Date.now() + 5000 });
    })();
    else return;
    task.then(() => respond({ ok: true }), error => respond({ ok: false, error: error.message }));
    return true;
  });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name.startsWith('sheets-')) sync().catch(() => {});
  });
  const start = () => {
    chrome.alarms.create('sheets-periodic', { periodInMinutes: 5 });
    sync().catch(() => {});
  };
  chrome.runtime.onStartup.addListener(start);
  chrome.runtime.onInstalled.addListener(start);
})();
