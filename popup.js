const saveBtn = document.getElementById("saveBtn");
const openManagerBtn = document.getElementById("openManagerBtn");
const tagsInput = document.getElementById("tagsInput");
const folderInput = document.getElementById("folderInput");
const tagSuggestions = document.getElementById("tagSuggestions");
const folderSuggestions = document.getElementById("folderSuggestions");
const message = document.getElementById("message");

let allKnownTags = [];
let folderPathEntries = [];
let folderPathToId = {};
let folderNameToFirstId = {};
let folderIdToPath = {};
let lastTagSuggestionValues = new Set();

function getDomain(url) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch (error) {
    return "unknown";
  }
}

function parseTags(rawValue) {
  const unique = new Set();

  rawValue
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .forEach((tag) => unique.add(tag));

  return Array.from(unique);
}

function mergeTags(currentTags = [], incomingTags = []) {
  const unique = new Set([
    ...currentTags.map((tag) => tag.trim().toLowerCase()),
    ...incomingTags.map((tag) => tag.trim().toLowerCase())
  ]);

  return Array.from(unique).filter(Boolean);
}

function inferTagFromHostname(hostname) {
  const cleanHostname = hostname
    .replace(/^www\./, "")
    .replace(/^m\./, "")
    .toLowerCase();

  const domainTagMap = {
    "youtube.com": "youtube",
    "youtu.be": "youtube",
    "facebook.com": "facebook",
    "x.com": "x",
    "twitter.com": "x",
    "instagram.com": "instagram",
    "linkedin.com": "linkedin",
    "github.com": "github",
    "gitlab.com": "gitlab",
    "reddit.com": "reddit",
    "medium.com": "medium",
    "tiktok.com": "tiktok"
  };

  if (domainTagMap[cleanHostname]) {
    return domainTagMap[cleanHostname];
  }

  const parts = cleanHostname.split(".").filter(Boolean);
  if (parts.length <= 1) {
    return cleanHostname || "";
  }

  // Handle common country-code domains like "example.co.uk".
  const lastPart = parts[parts.length - 1];
  const secondLastPart = parts[parts.length - 2];
  const commonSecondLevel = new Set(["co", "com", "net", "org"]);
  if (lastPart.length === 2 && commonSecondLevel.has(secondLastPart) && parts.length >= 3) {
    return parts[parts.length - 3];
  }

  return secondLastPart;
}

function getAutoTags(url) {
  try {
    const hostname = new URL(url).hostname;
    const inferred = inferTagFromHostname(hostname);
    return inferred ? [inferred] : [];
  } catch (error) {
    return [];
  }
}

function notifyBookmarkUpdated(url) {
  if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
    return;
  }
  chrome.runtime.sendMessage({ type: "bookmark-updated", url }, () => {
    // Ignore fire-and-forget messaging errors.
    void chrome.runtime.lastError;
  });
}

function buildFolderPathEntries(folders) {
  return (folders || [])
    .map((folder) => {
      const name = String(folder.name || "").trim();
      return {
        id: String(folder.id || "").trim(),
        name,
        path: name
      };
    })
    .filter((entry) => entry.id && entry.name)
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

function updateTagSuggestions() {
  if (!tagSuggestions || !tagsInput) {
    return;
  }

  const raw = tagsInput.value || "";
  const segments = raw.split(",");
  const fixedParts = segments
    .slice(0, -1)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const keyword = String(segments[segments.length - 1] || "").trim().toLowerCase();
  const selected = new Set(fixedParts);
  const prefix = fixedParts.length ? `${fixedParts.join(", ")}, ` : "";

  const matches = allKnownTags
    .filter((tag) => !selected.has(tag) && (!keyword || tag.includes(keyword)))
    .slice(0, 20);

  const suggestionValues = matches.map((tag) => `${prefix}${tag}`);
  lastTagSuggestionValues = new Set(suggestionValues);
  tagSuggestions.innerHTML = suggestionValues.map((value) => `<option value="${value}"></option>`).join("");
}

function maybeAppendTagSeparator() {
  if (!tagsInput) {
    return;
  }

  const value = tagsInput.value || "";
  if (!value || value.endsWith(",")) {
    return;
  }

  if (!lastTagSuggestionValues.has(value)) {
    return;
  }

  tagsInput.value = `${value}, `;
  updateTagSuggestions();
}

function updateFolderSuggestions() {
  if (!folderSuggestions || !folderInput) {
    return;
  }

  const keyword = (folderInput.value || "").trim().toLowerCase();
  const matches = folderPathEntries
    .filter((entry) => {
      const pathText = entry.path.toLowerCase();
      const nameText = entry.name.toLowerCase();
      return !keyword || pathText.includes(keyword) || nameText.includes(keyword);
    })
    .slice(0, 30);

  folderSuggestions.innerHTML = matches
    .map((entry) => `<option value="${entry.path}"></option>`)
    .join("");
}

async function hydrateSuggestionsFromDB() {
  if (!window.BookmarkDB) {
    return;
  }

  await BookmarkDB.init();
  await BookmarkDB.migrateFromChromeStorage();

  const [bookmarks, folders] = await Promise.all([
    BookmarkDB.getAllBookmarks(),
    BookmarkDB.getAllFolders()
  ]);

  const tagSet = new Set();
  bookmarks.forEach((bookmark) => {
    const tags = Array.isArray(bookmark.tags) ? bookmark.tags : [];
    tags
      .map((tag) => String(tag || "").trim().toLowerCase())
      .filter(Boolean)
      .forEach((tag) => tagSet.add(tag));
  });

  allKnownTags = Array.from(tagSet).sort((a, b) => a.localeCompare(b, "vi"));

  folderPathEntries = buildFolderPathEntries(folders);
  folderPathToId = {};
  folderNameToFirstId = {};
  folderIdToPath = {};
  folderPathEntries.forEach((entry) => {
    folderPathToId[entry.path.toLowerCase()] = entry.id;
    folderIdToPath[entry.id] = entry.path;
    const nameKey = entry.name.toLowerCase();
    if (!folderNameToFirstId[nameKey]) {
      folderNameToFirstId[nameKey] = entry.id;
    }
  });

  updateTagSuggestions();
  updateFolderSuggestions();
}

function resolveFolderId(rawFolderText) {
  const folderText = String(rawFolderText || "").trim();
  if (!folderText) {
    return "";
  }

  const normalized = folderText.toLowerCase();
  if (folderPathToId[normalized]) {
    return folderPathToId[normalized];
  }

  return folderNameToFirstId[normalized] || "";
}

function resolveFolderPathById(rawFolderId) {
  const folderId = String(rawFolderId || "").trim();
  if (!folderId) {
    return "";
  }

  if (folderIdToPath[folderId]) {
    return folderIdToPath[folderId];
  }

  const normalized = folderId.toLowerCase();
  const fallbackId = folderNameToFirstId[normalized];
  if (fallbackId && folderIdToPath[fallbackId]) {
    return folderIdToPath[fallbackId];
  }

  return "";
}

async function preloadCurrentTabBookmark() {
  if (!window.BookmarkDB) {
    return;
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];
  if (!currentTab || !currentTab.url) {
    return;
  }

  const existing = await BookmarkDB.findBookmarkByUrl(currentTab.url);
  if (!existing) {
    return;
  }

  if (tagsInput) {
    const existingTags = Array.isArray(existing.tags) ? existing.tags : [];
    tagsInput.value = existingTags.join(", ");
    updateTagSuggestions();
  }

  if (folderInput) {
    folderInput.value = resolveFolderPathById(existing.folderId);
    updateFolderSuggestions();
  }
}

async function initializePopup() {
  await hydrateSuggestionsFromDB();
  await preloadCurrentTabBookmark();
}

saveBtn.addEventListener("click", async () => {
  if (!window.BookmarkDB) {
    message.textContent = "Khong the khoi tao bo luu du lieu.";
    return;
  }

  await BookmarkDB.init();
  await BookmarkDB.migrateFromChromeStorage();

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];

  if (!currentTab || !currentTab.url) {
    message.textContent = "Khong lay duoc tab hien tai.";
    return;
  }

  const tags = parseTags(tagsInput.value || "");
  const autoTags = getAutoTags(currentTab.url);
  const mergedInputTags = mergeTags(tags, autoTags);
  const selectedFolderId = resolveFolderId(folderInput ? folderInput.value : "");
  const hasFolderInput = Boolean(folderInput && folderInput.value.trim());

  if (hasFolderInput && !selectedFolderId) {
    message.textContent = "Folder khong ton tai trong danh sach goi y.";
    return;
  }

  const newBookmark = {
    id: Date.now().toString(),
    title: currentTab.title || "Khong co tieu de",
    url: currentTab.url,
    domain: getDomain(currentTab.url),
    createdAt: Date.now(),
    clickCount: 0,
    folderId: selectedFolderId,
    tags: mergedInputTags
  };

  const existing = await BookmarkDB.findBookmarkByUrl(newBookmark.url);
  if (existing) {
    const updatedBookmark = {
      ...existing,
      clickCount: typeof existing.clickCount === "number" ? existing.clickCount : 0,
      folderId: selectedFolderId || (typeof existing.folderId === "string" ? existing.folderId : ""),
      tags: mergeTags(Array.isArray(existing.tags) ? existing.tags : [], mergedInputTags)
    };
    await BookmarkDB.putBookmark(updatedBookmark);
    notifyBookmarkUpdated(updatedBookmark.url);
    message.textContent = "Link da ton tai, da cap nhat tag/folder.";
    tagsInput.value = "";
    if (folderInput) {
      folderInput.value = "";
    }
    await hydrateSuggestionsFromDB();
    return;
  }

  await BookmarkDB.putBookmark(newBookmark);
  notifyBookmarkUpdated(newBookmark.url);
  message.textContent = "Da luu bookmark thanh cong.";
  tagsInput.value = "";
  if (folderInput) {
    folderInput.value = "";
  }
  await hydrateSuggestionsFromDB();
});

openManagerBtn.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("manager.html")
  });
});

if (tagsInput) {
  tagsInput.addEventListener("input", updateTagSuggestions);
  tagsInput.addEventListener("focus", updateTagSuggestions);
  tagsInput.addEventListener("change", maybeAppendTagSeparator);
}

if (folderInput) {
  folderInput.addEventListener("input", updateFolderSuggestions);
  folderInput.addEventListener("focus", updateFolderSuggestions);
}

initializePopup().catch(() => {
  // Popup can still work without suggestion data.
});
