const searchInput = document.getElementById("searchInput");
const createdViewSelect = document.getElementById("createdViewSelect");
const bookmarkList = document.getElementById("bookmarkList");
const viewButtons = document.querySelectorAll(".view-btn");
const folderTree = document.getElementById("folderTree");
const folderAllBtn = document.getElementById("folderAllBtn");
const folderNoneBtn = document.getElementById("folderNoneBtn");
const tagFilterChips = document.getElementById("tagFilterChips");
const newFolderNameInput = document.getElementById("newFolderName");
const createFolderBtn = document.getElementById("createFolderBtn");
const renameFolderInput = document.getElementById("renameFolderInput");
const renameFolderBtn = document.getElementById("renameFolderBtn");
const deleteFolderBtn = document.getElementById("deleteFolderBtn");
const importFileInput = document.getElementById("importFileInput");
const importBtn = document.getElementById("importBtn");
const importStatus = document.getElementById("importStatus");
const exportBackupBtn = document.getElementById("exportBackupBtn");
const backupImportFileInput = document.getElementById("backupImportFileInput");
const importBackupBtn = document.getElementById("importBackupBtn");
const backupStatus = document.getElementById("backupStatus");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageInfo = document.getElementById("pageInfo");
const viewTabChips = document.getElementById("viewTabChips");
const newViewTabInput = document.getElementById("newViewTabInput");
const addViewTabBtn = document.getElementById("addViewTabBtn");

const VIEW_MODE_KEY = "bookmarkManagerViewMode";
const TIME_VIEW_KEY = "bookmarkManagerCreatedView";
const CUSTOM_VIEW_TABS_KEY = "bookmarkManagerCustomViewTabs";
const FILTER_ALL = "__all";
const FILTER_NONE = "__none";
const SEARCH_DEBOUNCE_MS = 180;
const PAGE_SIZE = 10;

let currentViewMode = localStorage.getItem(VIEW_MODE_KEY) === "card" ? "card" : "list";
let selectedCreatedView = (() => {
  const saved = localStorage.getItem(TIME_VIEW_KEY);
  const validValues = new Set(["newest", "oldest", "today", "last7", "last30"]);
  return validValues.has(saved) ? saved : "newest";
})();
let currentBookmarks = [];
let currentFolders = [];
let selectedFolderFilter = FILTER_ALL;
let selectedTagFilter = FILTER_ALL;
let selectedViewTab = FILTER_ALL;
let customViewTabs = [];
let searchDebounceTimer = null;
let currentPage = 1;

customViewTabs = loadCustomViewTabs();

function formatDate(timestamp) {
  const date = new Date(timestamp || Date.now());
  return date.toLocaleString("vi-VN");
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

function mergeTagList(currentTags = [], incomingTags = []) {
  const unique = new Set([
    ...currentTags.map((tag) => tag.trim().toLowerCase()),
    ...incomingTags.map((tag) => tag.trim().toLowerCase())
  ]);

  return Array.from(unique).filter(Boolean);
}

function normalizeViewTabName(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return "";
  }
  if (value.toLowerCase() === FILTER_ALL) {
    return "";
  }
  return value;
}

function loadCustomViewTabs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_VIEW_TABS_KEY) || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    const seen = new Set();
    const result = [];
    parsed.forEach((item) => {
      const normalized = normalizeViewTabName(item);
      const key = normalized.toLowerCase();
      if (!normalized || seen.has(key)) {
        return;
      }
      seen.add(key);
      result.push(normalized);
    });
    return result;
  } catch (error) {
    return [];
  }
}

function persistCustomViewTabs() {
  localStorage.setItem(CUSTOM_VIEW_TABS_KEY, JSON.stringify(customViewTabs));
}

function getAvailableViewTabs() {
  const seen = new Set();
  const tabs = [];

  const allCandidates = [
    ...customViewTabs,
    ...currentBookmarks.map((bookmark) => normalizeViewTabName(bookmark.viewTab))
  ];

  allCandidates.forEach((item) => {
    const normalized = normalizeViewTabName(item);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      return;
    }
    seen.add(key);
    tabs.push(normalized);
  });

  return tabs.sort((a, b) => a.localeCompare(b));
}

function inferTagFromHostname(hostname) {
  const cleanHostname = (hostname || "")
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

function createUniqueId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatBackupTimestamp(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function normalizeBookmark(bookmark) {
  return {
    ...bookmark,
    tags: Array.isArray(bookmark.tags) ? bookmark.tags : [],
    folderId: typeof bookmark.folderId === "string" ? bookmark.folderId.trim() : "",
    viewTab: normalizeViewTabName(bookmark.viewTab || bookmark.tab),
    createdAt: typeof bookmark.createdAt === "number" ? bookmark.createdAt : Date.now(),
    clickCount: typeof bookmark.clickCount === "number" ? bookmark.clickCount : 0
  };
}

function normalizeFolder(folder) {
  return {
    id: String(folder.id || "").trim(),
    name: (folder.name || "").trim(),
    parentId: typeof folder.parentId === "string" ? folder.parentId.trim() : "",
    createdAt: typeof folder.createdAt === "number" ? folder.createdAt : Date.now()
  };
}

function flattenFoldersSingleLevel(folders) {
  const unique = [];
  const nameToId = {};
  const oldToFlatId = {};

  folders.forEach((folder) => {
    const key = folder.name.trim().toLowerCase();
    if (!key) {
      return;
    }

    if (!nameToId[key]) {
      nameToId[key] = folder.id;
      unique.push({
        ...folder,
        parentId: ""
      });
    }

    oldToFlatId[folder.id] = nameToId[key];
  });

  unique.sort((a, b) => a.name.localeCompare(b.name));
  return { folders: unique, oldToFlatId };
}

function buildSingleLevelState(bookmarks, folders) {
  const normalizedFolders = (folders || []).map(normalizeFolder).filter((folder) => folder.id && folder.name);
  const { folders: flatFolders, oldToFlatId } = flattenFoldersSingleLevel(normalizedFolders);
  const folderLookup = buildFolderLookup(flatFolders);

  const normalizedBookmarks = (bookmarks || [])
    .map(normalizeBookmark)
    .map((bookmark) => {
      const mappedFolderId = oldToFlatId[String(bookmark.folderId || "").trim()];
      const resolvedFolderId = mappedFolderId || resolveFolderIdForBookmark(bookmark, folderLookup);
      return {
        ...bookmark,
        id: String(bookmark.id || createUniqueId()),
        url: String(bookmark.url || "").trim(),
        folderId: resolvedFolderId
      };
    })
    .filter((bookmark) => bookmark.url);

  return {
    bookmarks: normalizedBookmarks,
    folders: flatFolders
  };
}

function getLegacyFolderNameFromBookmark(bookmark, folderNameMap = {}) {
  const idBasedName = folderNameMap[String(bookmark.folderId || "").trim()];
  if (idBasedName) {
    return idBasedName;
  }

  const directNameCandidates = [
    bookmark.folderName,
    bookmark.folder
  ];

  for (const candidate of directNameCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (Array.isArray(bookmark.folderPath) && bookmark.folderPath.length) {
    const last = bookmark.folderPath[bookmark.folderPath.length - 1];
    if (typeof last === "string" && last.trim()) {
      return last.trim();
    }
  }

  const rawFolderId = bookmark.folderId;
  if (typeof rawFolderId === "string" && rawFolderId.trim()) {
    return rawFolderId.trim();
  }

  return "";
}

function buildFolderLookup(folders) {
  const idSet = new Set();
  const nameToFirstId = {};

  folders.forEach((folder) => {
    idSet.add(folder.id);
    const key = folder.name.trim().toLowerCase();
    if (key && !nameToFirstId[key]) {
      nameToFirstId[key] = folder.id;
    }
  });

  return { idSet, nameToFirstId };
}

function resolveFolderIdForBookmark(bookmark, folderLookup) {
  const normalizedFolderId = String(bookmark.folderId || "").trim();
  if (normalizedFolderId && folderLookup.idSet.has(normalizedFolderId)) {
    return normalizedFolderId;
  }

  const legacyName = getLegacyFolderNameFromBookmark(bookmark, {});
  const normalizedLegacyName = legacyName.trim().toLowerCase();
  if (normalizedLegacyName && folderLookup.nameToFirstId[normalizedLegacyName]) {
    return folderLookup.nameToFirstId[normalizedLegacyName];
  }

  return "";
}

function getFolderNameMap(folders) {
  return folders.reduce((acc, folder) => {
    acc[folder.id] = folder.name;
    return acc;
  }, {});
}

function getOrderedFoldersForSelect() {
  return [...currentFolders]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((folder) => ({ ...folder, depth: 0 }));
}

function ensureFolderPath(pathNames, folders) {
  if (!Array.isArray(pathNames) || !pathNames.length) {
    return "";
  }

  const folderName = String(pathNames[pathNames.length - 1] || "").trim();
  if (!folderName) {
    return "";
  }

  const existing = folders.find((folder) => folder.name.toLowerCase() === folderName.toLowerCase());
  if (existing) {
    return existing.id;
  }

  const newFolder = {
    id: createUniqueId(),
    name: folderName,
    parentId: "",
    createdAt: Date.now()
  };
  folders.push(newFolder);
  return newFolder.id;
}

function parseChromeBookmarksHtml(htmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");
  const rootDl = doc.querySelector("dl");

  if (!rootDl) {
    return [];
  }

  const importedItems = [];
  const rootWrapperNames = new Set([
    "bookmarks bar",
    "bookmark bar",
    "other bookmarks",
    "mobile bookmarks",
    "bookmarks",
    "thanh dau trang",
    "dau trang khac",
    "dau trang tren di dong"
  ]);

  function shouldSkipRootWrapper(headingNode, folderName, folderPath) {
    if (!headingNode || !folderName || folderPath.length !== 0) {
      return false;
    }

    const attrNames = [
      "personal_toolbar_folder",
      "unfiled_bookmarks_folder",
      "mobile_bookmarks_folder",
      "bookmarks_menu",
      "toolbar_folder",
      "other_bookmarks_folder"
    ];
    const hasChromeRootAttr = attrNames.some((attr) => headingNode.hasAttribute(attr));
    if (hasChromeRootAttr) {
      return true;
    }

    const normalizedName = folderName.trim().toLowerCase();
    return rootWrapperNames.has(normalizedName);
  }

  function addBookmarkFromAnchor(anchorNode, folderPath) {
    const url = anchorNode.getAttribute("href") || "";
    if (!url || /^javascript:/i.test(url)) {
      return;
    }

    const title = (anchorNode.textContent || "").trim() || "Khong co tieu de";
    const addDateAttr = anchorNode.getAttribute("add_date");
    const addDateSec = Number(addDateAttr);
    const createdAt = Number.isFinite(addDateSec) && addDateSec > 0
      ? addDateSec * 1000
      : Date.now();

    importedItems.push({
      url,
      title,
      folderPath,
      createdAt
    });
  }

  function walkNode(containerNode, folderPath = []) {
    const nodes = Array.from(containerNode.children || []);
    nodes.forEach((node) => {
      const tag = node.tagName ? node.tagName.toLowerCase() : "";

      if (tag === "dt") {
        const directLink = node.querySelector(":scope > a");
        if (directLink) {
          addBookmarkFromAnchor(directLink, folderPath);
        }

        const heading = node.querySelector(":scope > h3");
        if (heading) {
          const folderName = (heading.textContent || "").trim();
          if (folderName) {
            let nestedDl = node.querySelector(":scope > dl");
            if (!nestedDl) {
              let sibling = node.nextElementSibling;
              while (sibling && sibling.tagName && sibling.tagName.toLowerCase() === "p") {
                sibling = sibling.nextElementSibling;
              }
              if (sibling && sibling.tagName && sibling.tagName.toLowerCase() === "dl") {
                nestedDl = sibling;
              }
            }

            if (nestedDl) {
              const skipWrapper = shouldSkipRootWrapper(heading, folderName, folderPath);
              const nextPath = skipWrapper ? folderPath : [...folderPath, folderName];
              walkNode(nestedDl, nextPath);
            }
          }
        }

        const nestedDlSameLevel = node.querySelector(":scope > dl");
        if (nestedDlSameLevel) {
          walkNode(nestedDlSameLevel, folderPath);
        }
        return;
      }

      if (tag === "dl" || tag === "p") {
        walkNode(node, folderPath);
      }
    });
  }

  walkNode(rootDl, []);

  if (!importedItems.length) {
    // Fallback for non-standard bookmark exports: import all anchors.
    const anchors = Array.from(doc.querySelectorAll("a[href]"));
    anchors.forEach((anchor) => addBookmarkFromAnchor(anchor, []));
  }

  return importedItems;
}

function getDescendantFolderIds(rootId) {
  return new Set([rootId]);
}

function renderFolderParentOptions() {
  // Folder hierarchy is disabled; keep this as no-op for compatibility.
}

function renderFolderFilterButtons() {
  folderAllBtn.classList.toggle("active", selectedFolderFilter === FILTER_ALL);
  folderNoneBtn.classList.toggle("active", selectedFolderFilter === FILTER_NONE);
}

function syncRenameFolderState() {
  const selectedFolder = currentFolders.find((folder) => folder.id === selectedFolderFilter);
  const canRename = Boolean(selectedFolder);

  renameFolderBtn.disabled = !canRename;
  if (deleteFolderBtn) {
    deleteFolderBtn.disabled = !canRename;
  }
  if (!canRename) {
    renameFolderInput.value = "";
    renameFolderInput.placeholder = "Chon folder de doi ten...";
    return;
  }

  renameFolderInput.placeholder = "Nhap ten folder moi...";
  renameFolderInput.value = selectedFolder.name;
}

function renderFolderTree() {
  const flatFolders = [...currentFolders].sort((a, b) => a.name.localeCompare(b.name));
  const selectedFolderExists = currentFolders.some((folder) => folder.id === selectedFolderFilter);

  if (!selectedFolderExists && selectedFolderFilter !== FILTER_ALL && selectedFolderFilter !== FILTER_NONE) {
    selectedFolderFilter = FILTER_ALL;
  }

  folderTree.innerHTML = "";

  flatFolders.forEach((folder) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `folder-root ${selectedFolderFilter === folder.id ? "active" : ""}`;
    button.setAttribute("data-folder-id", folder.id);
    button.textContent = folder.name;
    folderTree.appendChild(button);
  });

  renderFolderFilterButtons();
  syncRenameFolderState();
}

function renderTagFilterChips() {
  const uniqueTags = new Set();
  currentBookmarks.forEach((bookmark) => {
    bookmark.tags.forEach((tag) => uniqueTags.add(tag));
  });

  const sortedTags = Array.from(uniqueTags).sort((a, b) => a.localeCompare(b));
  if (selectedTagFilter !== FILTER_ALL && !sortedTags.includes(selectedTagFilter)) {
    selectedTagFilter = FILTER_ALL;
  }

  const chipsHtml = [
    `<button type="button" class="tag-filter-btn ${selectedTagFilter === FILTER_ALL ? "active" : ""}" data-tag-filter="${FILTER_ALL}">Tat ca tag</button>`,
    ...sortedTags.map(
      (tag) =>
        `<button type="button" class="tag-filter-btn ${selectedTagFilter === tag ? "active" : ""}" data-tag-filter="${tag}">#${tag}</button>`
    )
  ];

  tagFilterChips.innerHTML = chipsHtml.join("");
}

function renderViewTabChips() {
  if (!viewTabChips) {
    return;
  }

  const availableTabs = getAvailableViewTabs();
  const hasSelected = selectedViewTab === FILTER_ALL
    || availableTabs.some((tab) => tab.toLowerCase() === selectedViewTab.toLowerCase());
  if (!hasSelected) {
    selectedViewTab = FILTER_ALL;
  }

  const chipsHtml = [
    `<button type="button" class="view-tab-btn ${selectedViewTab === FILTER_ALL ? "active" : ""}" data-view-tab-filter="${FILTER_ALL}">All</button>`,
    ...availableTabs.map((tab) => {
      const isActive = selectedViewTab !== FILTER_ALL && selectedViewTab.toLowerCase() === tab.toLowerCase();
      return `<button type="button" class="view-tab-btn ${isActive ? "active" : ""}" data-view-tab-filter="${tab}">${tab}</button>`;
    })
  ];
  viewTabChips.innerHTML = chipsHtml.join("");
}

function updateViewButtons() {
  viewButtons.forEach((button) => {
    const mode = button.getAttribute("data-view-mode");
    const isActive = mode === currentViewMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function buildFolderOptionsHtml(selectedFolderId = "", orderedFolders = getOrderedFoldersForSelect()) {
  const options = [
    `<option value="">(Khong gan folder)</option>`,
    ...orderedFolders.map(
      (folder) =>
        `<option value="${folder.id}" ${selectedFolderId === folder.id ? "selected" : ""}>${"  ".repeat(folder.depth)}${folder.name}</option>`
    )
  ];

  return options.join("");
}

function buildViewTabOptionsHtml(selectedTab = "") {
  const normalizedSelected = normalizeViewTabName(selectedTab);
  const availableTabs = getAvailableViewTabs();
  const options = [
    `<option value="">(All)</option>`,
    ...availableTabs.map((tab) => {
      const isSelected = normalizedSelected && normalizedSelected.toLowerCase() === tab.toLowerCase();
      return `<option value="${tab}" ${isSelected ? "selected" : ""}>${tab}</option>`;
    })
  ];
  return options.join("");
}

function buildListItem(bookmark, folderName, orderedFolders) {
  const tagsHtml = bookmark.tags.length
    ? bookmark.tags.map((tag) => `<span class="tag-chip">#${tag}</span>`).join("")
    : `<span class="tag-chip">#chua-gan-tag</span>`;

  return `
    <div class="bookmark-title">${bookmark.title}</div>
    <div class="bookmark-url">${bookmark.url}</div>
    <div class="bookmark-meta">
      Folder: ${folderName || "(chua gan)"} <br />
      Tab: ${bookmark.viewTab || "(all)"} <br />
      Da luu: ${formatDate(bookmark.createdAt)} <br />
      Da mo: <span class="click-count" data-id="${bookmark.id}">${bookmark.clickCount}</span> lan
    </div>
    <div class="tag-list">${tagsHtml}</div>
    <div class="card-tag-input-wrap">
      <button class="add-tag-btn" data-id="${bookmark.id}" type="button">+</button>
      <input class="card-tag-input" data-id="${bookmark.id}" type="text" placeholder="Nhap tag roi Enter..." />
    </div>
    <div class="folder-editor">
      <select class="folder-select" data-id="${bookmark.id}">
        ${buildFolderOptionsHtml(bookmark.folderId, orderedFolders)}
      </select>
      <button class="save-folder-btn" data-id="${bookmark.id}" type="button">Luu folder</button>
    </div>
    <div class="folder-editor">
      <select class="view-tab-select" data-id="${bookmark.id}">
        ${buildViewTabOptionsHtml(bookmark.viewTab)}
      </select>
      <button class="save-view-tab-btn" data-id="${bookmark.id}" type="button">Luu tab</button>
    </div>
    <div class="actions">
      <button class="open-btn" data-id="${bookmark.id}" data-url="${bookmark.url}" type="button">Mo link</button>
      <button class="delete-btn" data-id="${bookmark.id}" type="button">Xoa</button>
    </div>
  `;
}

function buildCardItem(bookmark, folderName, orderedFolders) {
  const tagsHtml = bookmark.tags.length
    ? bookmark.tags.map((tag) => `<span class="tag-chip">#${tag}</span>`).join("")
    : `<span class="tag-chip">#chua-gan-tag</span>`;

  return `
    <div class="bookmark-title">${bookmark.title}</div>
    <div class="bookmark-meta">
      Folder: ${folderName || "(chua gan)"} <br />
      Tab: ${bookmark.viewTab || "(all)"} <br />
      Da luu: ${formatDate(bookmark.createdAt)} <br />
      Da mo: <span class="click-count" data-id="${bookmark.id}">${bookmark.clickCount}</span> lan
    </div>
    <div class="card-tag-input-wrap">
      <button class="add-tag-btn" data-id="${bookmark.id}" type="button">+</button>
      <input class="card-tag-input" data-id="${bookmark.id}" type="text" placeholder="Nhap tag roi Enter..." />
    </div>
    <div class="tag-list">${tagsHtml}</div>
    <div class="folder-editor">
      <select class="folder-select" data-id="${bookmark.id}">
        ${buildFolderOptionsHtml(bookmark.folderId, orderedFolders)}
      </select>
      <button class="save-folder-btn" data-id="${bookmark.id}" type="button">Luu folder</button>
    </div>
    <div class="folder-editor">
      <select class="view-tab-select" data-id="${bookmark.id}">
        ${buildViewTabOptionsHtml(bookmark.viewTab)}
      </select>
      <button class="save-view-tab-btn" data-id="${bookmark.id}" type="button">Luu tab</button>
    </div>
    <div class="actions">
      <button class="open-btn" data-id="${bookmark.id}" data-url="${bookmark.url}" type="button">Open</button>
      <button class="delete-btn" data-id="${bookmark.id}" type="button">Delete</button>
    </div>
  `;
}

function getFilteredBookmarks() {
  const keyword = searchInput.value.trim().toLowerCase();
  const now = Date.now();
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const folderNameMap = getFolderNameMap(currentFolders);
  let filtered = currentBookmarks.filter((bookmark) => {
    const folderName = folderNameMap[bookmark.folderId] || "";
    const text = `${bookmark.title} ${bookmark.url} ${bookmark.tags.join(" ")} ${folderName} ${bookmark.viewTab || ""}`.toLowerCase();
    return text.includes(keyword);
  });

  if (selectedViewTab !== FILTER_ALL) {
    filtered = filtered.filter(
      (bookmark) => normalizeViewTabName(bookmark.viewTab).toLowerCase() === selectedViewTab.toLowerCase()
    );
  }

  if (selectedTagFilter !== FILTER_ALL) {
    filtered = filtered.filter((bookmark) => bookmark.tags.includes(selectedTagFilter));
  }

  if (selectedFolderFilter === FILTER_NONE) {
    filtered = filtered.filter((bookmark) => !bookmark.folderId);
  } else if (selectedFolderFilter !== FILTER_ALL) {
    const folderIds = getDescendantFolderIds(selectedFolderFilter);
    const selectedFolderNames = new Set(
      Array.from(folderIds)
        .map((id) => (folderNameMap[id] || "").trim().toLowerCase())
        .filter(Boolean)
    );

    filtered = filtered.filter((bookmark) => {
      const bookmarkFolderId = String(bookmark.folderId || "").trim();
      if (folderIds.has(bookmarkFolderId)) {
        return true;
      }

      if (!selectedFolderNames.size) {
        return false;
      }

      const legacyFolderName = getLegacyFolderNameFromBookmark(bookmark, folderNameMap).trim().toLowerCase();
      if (!legacyFolderName) {
        return false;
      }
      return selectedFolderNames.has(legacyFolderName);
    });
  }

  if (selectedCreatedView === "today") {
    filtered = filtered.filter((bookmark) => bookmark.createdAt >= startOfToday);
  } else if (selectedCreatedView === "last7") {
    filtered = filtered.filter((bookmark) => bookmark.createdAt >= now - 7 * 24 * 60 * 60 * 1000);
  } else if (selectedCreatedView === "last30") {
    filtered = filtered.filter((bookmark) => bookmark.createdAt >= now - 30 * 24 * 60 * 60 * 1000);
  }

  return filtered.sort((a, b) => (selectedCreatedView === "oldest" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
}

function getPaginatedBookmarks(bookmarks) {
  const totalItems = bookmarks.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }
  if (currentPage < 1) {
    currentPage = 1;
  }

  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  return {
    pageItems: bookmarks.slice(start, end),
    totalItems,
    totalPages
  };
}

function renderPagination(totalItems, totalPages) {
  if (!pageInfo || !prevPageBtn || !nextPageBtn) {
    return;
  }

  pageInfo.textContent = `Trang ${currentPage}/${totalPages} (${totalItems})`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
}

function resetToFirstPage() {
  currentPage = 1;
}

function resetSecondaryFiltersForFolderView() {
  if (searchInput) {
    searchInput.value = "";
  }
  selectedTagFilter = FILTER_ALL;
  if (tagFilterChips) {
    renderTagFilterChips();
  }

  selectedCreatedView = "newest";
  localStorage.setItem(TIME_VIEW_KEY, selectedCreatedView);
  if (createdViewSelect) {
    createdViewSelect.value = selectedCreatedView;
  }
}

function renderBookmarks() {
  const folderNameMap = getFolderNameMap(currentFolders);
  const filteredBookmarks = getFilteredBookmarks();
  const { pageItems, totalItems, totalPages } = getPaginatedBookmarks(filteredBookmarks);
  const orderedFolders = getOrderedFoldersForSelect();

  bookmarkList.innerHTML = "";
  bookmarkList.classList.toggle("card-view", currentViewMode === "card");

  if (!pageItems.length) {
    bookmarkList.innerHTML = `<div class="empty">Khong co bookmark nao.</div>`;
    renderPagination(totalItems, totalPages);
    return;
  }

  const fragment = document.createDocumentFragment();
  pageItems.forEach((bookmark) => {
    const item = document.createElement("div");
    const folderName = getLegacyFolderNameFromBookmark(bookmark, folderNameMap);
    item.className = `bookmark-item ${currentViewMode === "card" ? "bookmark-card" : "bookmark-list"}`;
    item.innerHTML = currentViewMode === "card"
      ? buildCardItem(bookmark, folderName, orderedFolders)
      : buildListItem(bookmark, folderName, orderedFolders);
    fragment.appendChild(item);
  });
  bookmarkList.appendChild(fragment);
  renderPagination(totalItems, totalPages);
}

function renderAllControls() {
  renderFolderParentOptions();
  renderFolderTree();
  renderTagFilterChips();
  renderViewTabChips();
  renderBookmarks();
}

function scheduleRenderBookmarks() {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }

  searchDebounceTimer = setTimeout(() => {
    resetToFirstPage();
    renderBookmarks();
  }, SEARCH_DEBOUNCE_MS);
}

async function reloadData() {
  if (!window.BookmarkDB) {
    renderAllControls();
    return;
  }

  await BookmarkDB.init();
  await BookmarkDB.migrateFromChromeStorage();

  const rawBookmarks = await BookmarkDB.getAllBookmarks();
  const rawFolders = await BookmarkDB.getAllFolders();

  const normalizedFolders = rawFolders.map(normalizeFolder).filter((folder) => folder.id && folder.name);
  const { folders: flatFolders, oldToFlatId } = flattenFoldersSingleLevel(normalizedFolders);
  const folderLookup = buildFolderLookup(flatFolders);
  const normalizedBookmarks = rawBookmarks
    .map(normalizeBookmark)
    .map((bookmark) => ({
      ...bookmark,
      folderId: oldToFlatId[String(bookmark.folderId || "").trim()] || resolveFolderIdForBookmark(bookmark, folderLookup)
    }));

  currentFolders = flatFolders;
  currentBookmarks = normalizedBookmarks;

  if (window.BookmarkDB) {
    await BookmarkDB.replaceAll(currentBookmarks, currentFolders);
  }

  renderAllControls();
}

function deleteBookmark(id) {
  currentBookmarks = currentBookmarks.filter((bookmark) => bookmark.id !== id);
  if (window.BookmarkDB) {
    BookmarkDB.deleteBookmark(id);
  }
  renderAllControls();
}

function saveBookmarkFolder(id) {
  const select = document.querySelector(`.folder-select[data-id="${id}"]`);
  const folderId = select ? select.value : "";

  let updatedBookmark = null;
  currentBookmarks = currentBookmarks.map((bookmark) => {
    if (bookmark.id !== id) {
      return bookmark;
    }

    updatedBookmark = { ...bookmark, folderId };
    return updatedBookmark;
  });

  if (updatedBookmark && window.BookmarkDB) {
    BookmarkDB.putBookmark(updatedBookmark);
  }
  renderAllControls();
}

function saveBookmarkViewTab(id) {
  const select = document.querySelector(`.view-tab-select[data-id="${id}"]`);
  const viewTab = normalizeViewTabName(select ? select.value : "");
  if (viewTab) {
    const exists = customViewTabs.some((item) => item.toLowerCase() === viewTab.toLowerCase());
    if (!exists) {
      customViewTabs.push(viewTab);
      customViewTabs = getAvailableViewTabs();
      persistCustomViewTabs();
    }
  }

  let updatedBookmark = null;
  currentBookmarks = currentBookmarks.map((bookmark) => {
    if (bookmark.id !== id) {
      return bookmark;
    }

    updatedBookmark = { ...bookmark, viewTab };
    return updatedBookmark;
  });

  if (updatedBookmark && window.BookmarkDB) {
    BookmarkDB.putBookmark(updatedBookmark);
  }
  renderAllControls();
}

function addCustomViewTab() {
  if (!newViewTabInput) {
    return;
  }

  const tabName = normalizeViewTabName(newViewTabInput.value);
  if (!tabName) {
    return;
  }

  const exists = customViewTabs.some((item) => item.toLowerCase() === tabName.toLowerCase());
  if (!exists) {
    customViewTabs.push(tabName);
    customViewTabs = getAvailableViewTabs();
    persistCustomViewTabs();
  }

  newViewTabInput.value = "";
  selectedViewTab = tabName;
  resetToFirstPage();
  renderViewTabChips();
  renderBookmarks();
}

function addTagFromCardInput(id, rawInput) {
  const newTags = parseTags(rawInput || "");
  if (!newTags.length) {
    return;
  }

  let updatedBookmark = null;
  currentBookmarks = currentBookmarks.map((bookmark) => {
    if (bookmark.id !== id) {
      return bookmark;
    }

    updatedBookmark = {
      ...bookmark,
      tags: mergeTagList(bookmark.tags, newTags)
    };
    return updatedBookmark;
  });

  if (updatedBookmark && window.BookmarkDB) {
    BookmarkDB.putBookmark(updatedBookmark);
  }
  renderAllControls();
}

function openBookmark(id, url) {
  if (!url) {
    return;
  }

  chrome.tabs.create({ url });

  if (!id) {
    return;
  }

  let updatedBookmark = null;
  currentBookmarks = currentBookmarks.map((bookmark) => {
    if (bookmark.id !== id) {
      return bookmark;
    }

    updatedBookmark = {
      ...bookmark,
      clickCount: (bookmark.clickCount || 0) + 1
    };
    return updatedBookmark;
  });

  const nextCount = updatedBookmark ? updatedBookmark.clickCount : null;
  if (nextCount !== null) {
    const countNodes = document.querySelectorAll(`.click-count[data-id="${id}"]`);
    countNodes.forEach((node) => {
      node.textContent = String(nextCount);
    });
  }

  if (updatedBookmark && window.BookmarkDB) {
    // Persist asynchronously without forcing a heavy full re-render.
    BookmarkDB.putBookmark(updatedBookmark);
  }
}

function createFolder() {
  const name = newFolderNameInput.value.trim();

  if (!name) {
    return;
  }

  const exists = currentFolders.some((folder) => folder.name.toLowerCase() === name.toLowerCase());
  if (exists) {
    return;
  }

  const newFolder = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    parentId: "",
    createdAt: Date.now()
  };

  currentFolders = [...currentFolders, newFolder];
  if (window.BookmarkDB) {
    BookmarkDB.putFolder(newFolder);
  }
  newFolderNameInput.value = "";
  renderAllControls();
}

function renameSelectedFolder() {
  const selectedFolder = currentFolders.find((folder) => folder.id === selectedFolderFilter);
  if (!selectedFolder) {
    return;
  }

  const newName = renameFolderInput.value.trim();
  if (!newName || newName === selectedFolder.name) {
    return;
  }

  let updatedFolder = null;
  currentFolders = currentFolders.map((folder) => {
    if (folder.id !== selectedFolderFilter) {
      return folder;
    }

    updatedFolder = {
      ...folder,
      name: newName
    };
    return updatedFolder;
  });

  if (updatedFolder && window.BookmarkDB) {
    BookmarkDB.putFolder(updatedFolder);
  }
  renderAllControls();
}

async function deleteSelectedFolder() {
  const selectedFolder = currentFolders.find((folder) => folder.id === selectedFolderFilter);
  if (!selectedFolder) {
    return;
  }

  const folderIdsToDelete = getDescendantFolderIds(selectedFolder.id);
  const bookmarkCount = currentBookmarks.filter((bookmark) => folderIdsToDelete.has(bookmark.folderId)).length;

  const confirmed = window.confirm(
    `Xoa folder "${selectedFolder.name}".\n` +
    `Se xoa ${bookmarkCount} bookmark trong folder nay.\nBan chac chan?`
  );

  if (!confirmed) {
    return;
  }

  currentFolders = currentFolders.filter((folder) => !folderIdsToDelete.has(folder.id));
  currentBookmarks = currentBookmarks.filter((bookmark) => !folderIdsToDelete.has(bookmark.folderId));

  selectedFolderFilter = FILTER_ALL;
  resetToFirstPage();

  if (window.BookmarkDB) {
    await BookmarkDB.replaceAll(currentBookmarks, currentFolders);
  }

  renderAllControls();
}

async function importChromeBookmarks() {
  const file = importFileInput.files && importFileInput.files[0];
  if (!file) {
    importStatus.textContent = "Hay chon file bookmarks.html de import.";
    return;
  }

  try {
    importStatus.textContent = "Dang import...";
    const htmlText = await file.text();
    const importedItems = parseChromeBookmarksHtml(htmlText);

    if (!importedItems.length) {
      importStatus.textContent = "Khong tim thay bookmark hop le trong file.";
      return;
    }

    const workingFolders = [...currentFolders];
    const workingBookmarks = [...currentBookmarks];
    const indexByUrl = new Map();
    workingBookmarks.forEach((bookmark, index) => {
      indexByUrl.set(bookmark.url, index);
    });

    let insertedCount = 0;
    let updatedCount = 0;

    importedItems.forEach((item) => {
      const folderId = ensureFolderPath(item.folderPath, workingFolders);
      const autoTags = getAutoTags(item.url);
      const existedIndex = indexByUrl.get(item.url);

      if (typeof existedIndex === "number") {
        const existing = workingBookmarks[existedIndex];
        workingBookmarks[existedIndex] = {
          ...existing,
          tags: mergeTagList(existing.tags, autoTags),
          folderId: existing.folderId || folderId || "",
          createdAt: Math.min(existing.createdAt || Date.now(), item.createdAt || Date.now()),
          clickCount: typeof existing.clickCount === "number" ? existing.clickCount : 0
        };
        updatedCount += 1;
        return;
      }

      const createdBookmark = normalizeBookmark({
        id: createUniqueId(),
        title: item.title,
        url: item.url,
        domain: (() => {
          try {
            return new URL(item.url).hostname.replace("www.", "");
          } catch (error) {
            return "unknown";
          }
        })(),
        createdAt: item.createdAt,
        folderId,
        clickCount: 0,
        tags: autoTags
      });

      workingBookmarks.push(createdBookmark);
      indexByUrl.set(createdBookmark.url, workingBookmarks.length - 1);
      insertedCount += 1;
    });

    const nextState = buildSingleLevelState(workingBookmarks, workingFolders);
    currentFolders = nextState.folders;
    currentBookmarks = nextState.bookmarks;

    if (window.BookmarkDB) {
      await BookmarkDB.replaceAll(currentBookmarks, currentFolders);
    }

    renderAllControls();
    importStatus.textContent = `Import xong: them ${insertedCount}, cap nhat ${updatedCount}.`;
    importFileInput.value = "";
  } catch (error) {
    importStatus.textContent = "Import that bai. Kiem tra lai file bookmarks.html.";
  }
}

async function exportBackupData() {
  try {
    backupStatus.textContent = "Dang tao file backup...";

    const nextState = buildSingleLevelState(currentBookmarks, currentFolders);
    const uniqueTabs = Array.from(
      new Set(
        (customViewTabs || [])
          .map((tab) => normalizeViewTabName(tab))
          .filter(Boolean)
      )
    );

    const payload = {
      format: "bookmark-manager-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        bookmarks: nextState.bookmarks,
        folders: nextState.folders,
        customViewTabs: uniqueTabs
      }
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `bookmark-backup-${formatBackupTimestamp()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);

    backupStatus.textContent = `Da export backup: ${nextState.bookmarks.length} bookmark, ${nextState.folders.length} folder.`;
  } catch (error) {
    backupStatus.textContent = "Export backup that bai.";
  }
}

async function importBackupData() {
  const file = backupImportFileInput.files && backupImportFileInput.files[0];
  if (!file) {
    backupStatus.textContent = "Hay chon file backup .json.";
    return;
  }

  try {
    backupStatus.textContent = "Dang import backup...";
    const rawText = await file.text();
    const parsed = JSON.parse(rawText);

    const fallbackData = parsed && typeof parsed === "object" ? parsed : {};
    const dataNode = parsed && parsed.data && typeof parsed.data === "object" ? parsed.data : fallbackData;
    const incomingBookmarks = Array.isArray(dataNode.bookmarks) ? dataNode.bookmarks : [];
    const incomingFolders = Array.isArray(dataNode.folders) ? dataNode.folders : [];
    const incomingTabs = Array.isArray(dataNode.customViewTabs) ? dataNode.customViewTabs : [];

    const nextState = buildSingleLevelState(incomingBookmarks, incomingFolders);

    currentFolders = nextState.folders;
    currentBookmarks = nextState.bookmarks;
    customViewTabs = Array.from(
      new Set(incomingTabs.map((tab) => normalizeViewTabName(tab)).filter(Boolean))
    );
    persistCustomViewTabs();
    if (selectedViewTab !== FILTER_ALL) {
      const hasSelectedTab = customViewTabs.some((tab) => tab.toLowerCase() === selectedViewTab.toLowerCase());
      if (!hasSelectedTab) {
        selectedViewTab = FILTER_ALL;
      }
    }

    if (window.BookmarkDB) {
      await BookmarkDB.replaceAll(currentBookmarks, currentFolders);
    }

    resetToFirstPage();
    renderAllControls();
    backupStatus.textContent = `Import backup xong: ${currentBookmarks.length} bookmark, ${currentFolders.length} folder.`;
    backupImportFileInput.value = "";
  } catch (error) {
    backupStatus.textContent = "Import backup that bai. Kiem tra file .json hop le.";
  }
}

searchInput.addEventListener("input", () => {
  scheduleRenderBookmarks();
});

createdViewSelect.value = selectedCreatedView;
createdViewSelect.addEventListener("change", () => {
  const value = createdViewSelect.value;
  const validValues = new Set(["newest", "oldest", "today", "last7", "last30"]);
  selectedCreatedView = validValues.has(value) ? value : "newest";
  localStorage.setItem(TIME_VIEW_KEY, selectedCreatedView);
  resetToFirstPage();
  renderBookmarks();
});

viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.getAttribute("data-view-mode");
    if (mode !== "list" && mode !== "card") {
      return;
    }

    currentViewMode = mode;
    localStorage.setItem(VIEW_MODE_KEY, mode);
    updateViewButtons();
    resetToFirstPage();
    renderBookmarks();
  });
});

createFolderBtn.addEventListener("click", createFolder);

newFolderNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    createFolder();
  }
});

renameFolderBtn.addEventListener("click", renameSelectedFolder);
if (deleteFolderBtn) {
  deleteFolderBtn.addEventListener("click", () => {
    deleteSelectedFolder();
  });
}

renameFolderInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    renameSelectedFolder();
  }
});

importBtn.addEventListener("click", importChromeBookmarks);
importFileInput.addEventListener("change", () => {
  importStatus.textContent = "";
});
if (exportBackupBtn) {
  exportBackupBtn.addEventListener("click", exportBackupData);
}
if (importBackupBtn) {
  importBackupBtn.addEventListener("click", importBackupData);
}
if (backupImportFileInput) {
  backupImportFileInput.addEventListener("change", () => {
    backupStatus.textContent = "";
  });
}

folderAllBtn.addEventListener("click", () => {
  resetSecondaryFiltersForFolderView();
  selectedFolderFilter = FILTER_ALL;
  resetToFirstPage();
  renderFolderTree();
  renderBookmarks();
});

folderNoneBtn.addEventListener("click", () => {
  resetSecondaryFiltersForFolderView();
  selectedFolderFilter = FILTER_NONE;
  resetToFirstPage();
  renderFolderTree();
  renderBookmarks();
});

folderTree.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const folderId = target.getAttribute("data-folder-id");
  if (!folderId) {
    return;
  }

  resetSecondaryFiltersForFolderView();
  if (selectedFolderFilter === folderId) {
    selectedFolderFilter = FILTER_ALL;
    resetToFirstPage();
    renderFolderTree();
    renderBookmarks();
    return;
  }

  selectedFolderFilter = folderId;
  resetToFirstPage();
  renderFolderTree();
  renderBookmarks();
});

tagFilterChips.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const tag = target.getAttribute("data-tag-filter");
  if (!tag) {
    return;
  }

  selectedTagFilter = tag;
  resetToFirstPage();
  renderTagFilterChips();
  renderBookmarks();
});

if (viewTabChips) {
  viewTabChips.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const tab = target.getAttribute("data-view-tab-filter");
    if (!tab) {
      return;
    }

    selectedViewTab = tab;
    resetToFirstPage();
    renderViewTabChips();
    renderBookmarks();
  });
}

if (addViewTabBtn) {
  addViewTabBtn.addEventListener("click", addCustomViewTab);
}

if (newViewTabInput) {
  newViewTabInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addCustomViewTab();
    }
  });
}

if (prevPageBtn) {
  prevPageBtn.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage -= 1;
      renderBookmarks();
    }
  });
}

if (nextPageBtn) {
  nextPageBtn.addEventListener("click", () => {
    currentPage += 1;
    renderBookmarks();
  });
}

bookmarkList.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.classList.contains("open-btn")) {
    const id = target.getAttribute("data-id");
    const url = target.getAttribute("data-url");
    openBookmark(id, url);
    return;
  }

  if (target.classList.contains("delete-btn")) {
    const id = target.getAttribute("data-id");
    if (id) {
      deleteBookmark(id);
    }
    return;
  }

  if (target.classList.contains("save-folder-btn")) {
    const id = target.getAttribute("data-id");
    if (id) {
      saveBookmarkFolder(id);
    }
    return;
  }

  if (target.classList.contains("save-view-tab-btn")) {
    const id = target.getAttribute("data-id");
    if (id) {
      saveBookmarkViewTab(id);
    }
    return;
  }

  if (target.classList.contains("add-tag-btn")) {
    const id = target.getAttribute("data-id");
    if (!id) {
      return;
    }

    const input = document.querySelector(`.card-tag-input[data-id="${id}"]`);
    if (!input) {
      return;
    }

    input.classList.add("open");
    input.focus();
  }
});

bookmarkList.addEventListener("keydown", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  if (!target.classList.contains("card-tag-input")) {
    return;
  }

  if (e.key !== "Enter") {
    return;
  }

  const id = target.getAttribute("data-id");
  if (!id) {
    return;
  }

  addTagFromCardInput(id, target.value);
});

updateViewButtons();
reloadData();
