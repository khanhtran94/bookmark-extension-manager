const DB_NAME = "bookmark_manager_db";
const DB_VERSION = 1;
const BOOKMARKS_STORE = "bookmarks";

let dbPromise = null;

function openDB() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open IndexedDB"));
  });

  return dbPromise;
}

function queryByUrl(url) {
  return new Promise(async (resolve) => {
    if (!url) {
      resolve(null);
      return;
    }

    try {
      const db = await openDB();
      const tx = db.transaction([BOOKMARKS_STORE], "readonly");
      const store = tx.objectStore(BOOKMARKS_STORE);
      const index = store.index("url");
      const req = index.get(url);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (error) {
      resolve(null);
    }
  });
}

function getUrlCandidates(url) {
  const candidates = new Set();
  if (!url || typeof url !== "string") {
    return [];
  }

  candidates.add(url);
  if (url.endsWith("/")) {
    candidates.add(url.slice(0, -1));
  } else {
    candidates.add(`${url}/`);
  }

  return Array.from(candidates).filter(Boolean);
}

async function isBookmarkedUrl(url) {
  const candidates = getUrlCandidates(url);
  for (const candidate of candidates) {
    const found = await queryByUrl(candidate);
    if (found) {
      return true;
    }
  }
  return false;
}

function createIconImageData(isBookmarked, size) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const bgColor = isBookmarked ? "#34a853" : "#9aa0a6";

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = bgColor;
  const radius = Math.round(size * 0.22);
  const w = size * 0.78;
  const h = size * 0.9;
  const x = (size - w) / 2;
  const y = (size - h) / 2;

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w / 2, y + h - size * 0.2);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillRect(x + size * 0.14, y + size * 0.18, w - size * 0.28, size * 0.1);

  return ctx.getImageData(0, 0, size, size);
}

function setTabIcon(tabId, isBookmarked) {
  chrome.action.setIcon({
    tabId,
    imageData: {
      16: createIconImageData(isBookmarked, 16),
      32: createIconImageData(isBookmarked, 32)
    }
  }, () => {
    // Tab can be closed while async check is running. Ignore this expected race.
    void chrome.runtime.lastError;
  });
}

async function updateIconForTab(tab) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  const url = tab.url || "";
  if (!/^https?:\/\//i.test(url)) {
    setTabIcon(tab.id, false);
    return;
  }

  const bookmarked = await isBookmarkedUrl(url);
  setTabIcon(tab.id, bookmarked);
}

function refreshActiveTabIcon(windowId) {
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (chrome.runtime.lastError) {
      return;
    }
    if (!tabs || !tabs.length) {
      return;
    }
    updateIconForTab(tabs[0]);
  });
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      return;
    }
    updateIconForTab(tab);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    updateIconForTab(tab);
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  refreshActiveTabIcon(windowId);
});

chrome.runtime.onStartup.addListener(() => {
  refreshActiveTabIcon(chrome.windows.WINDOW_ID_CURRENT);
});

chrome.runtime.onInstalled.addListener(() => {
  refreshActiveTabIcon(chrome.windows.WINDOW_ID_CURRENT);
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "bookmark-updated") {
    return;
  }
  refreshActiveTabIcon(chrome.windows.WINDOW_ID_CURRENT);
});
