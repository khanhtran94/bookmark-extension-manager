const searchInput = document.getElementById("searchInput");
const createdViewSelect = document.getElementById("createdViewSelect");
const bookmarkList = document.getElementById("bookmarkList");
const viewButtons = document.querySelectorAll(".view-btn");
const folderTree = document.getElementById("folderTree");
const folderAllBtn = document.getElementById("folderAllBtn");
const folderNoneBtn = document.getElementById("folderNoneBtn");
const tagFilterChips = document.getElementById("tagFilterChips");
const folderParentSelect = document.getElementById("folderParentSelect");
const newFolderNameInput = document.getElementById("newFolderName");
const createFolderBtn = document.getElementById("createFolderBtn");
const renameFolderInput = document.getElementById("renameFolderInput");
const renameFolderBtn = document.getElementById("renameFolderBtn");
const importFileInput = document.getElementById("importFileInput");
const importBtn = document.getElementById("importBtn");
const importStatus = document.getElementById("importStatus");

const VIEW_MODE_KEY = "bookmarkManagerViewMode";
const TIME_VIEW_KEY = "bookmarkManagerCreatedView";
const FILTER_ALL = "__all";
const FILTER_NONE = "__none";

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
let expandedRootFolderId = "";

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

function normalizeBookmark(bookmark) {
  return {
    ...bookmark,
    tags: Array.isArray(bookmark.tags) ? bookmark.tags : [],
    folderId: typeof bookmark.folderId === "string" ? bookmark.folderId : "",
    createdAt: typeof bookmark.createdAt === "number" ? bookmark.createdAt : Date.now(),
    clickCount: typeof bookmark.clickCount === "number" ? bookmark.clickCount : 0
  };
}

function normalizeFolder(folder) {
  return {
    id: folder.id,
    name: (folder.name || "").trim(),
    parentId: typeof folder.parentId === "string" ? folder.parentId : "",
    createdAt: typeof folder.createdAt === "number" ? folder.createdAt : Date.now()
  };
}

function getFolderNameMap(folders) {
  return folders.reduce((acc, folder) => {
    acc[folder.id] = folder.name;
    return acc;
  }, {});
}

function getChildrenFolders(parentId = "") {
  return currentFolders
    .filter((folder) => (folder.parentId || "") === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getOrderedFoldersForSelect() {
  const ordered = [];

  function walk(parentId, depth) {
    const children = getChildrenFolders(parentId);
    children.forEach((folder) => {
      ordered.push({ ...folder, depth });
      walk(folder.id, depth + 1);
    });
  }

  walk("", 0);
  return ordered;
}

function ensureFolderPath(pathNames, folders) {
  if (!Array.isArray(pathNames) || !pathNames.length) {
    return "";
  }

  let parentId = "";
  pathNames
    .map((name) => String(name || "").trim())
    .filter(Boolean)
    .forEach((folderName) => {
      const existing = folders.find(
        (folder) =>
          (folder.parentId || "") === parentId &&
          folder.name.toLowerCase() === folderName.toLowerCase()
      );

      if (existing) {
        parentId = existing.id;
        return;
      }

      const newFolder = {
        id: createUniqueId(),
        name: folderName,
        parentId,
        createdAt: Date.now()
      };
      folders.push(newFolder);
      parentId = newFolder.id;
    });

  return parentId;
}

function parseChromeBookmarksHtml(htmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");
  const rootDl = doc.querySelector("dl");

  if (!rootDl) {
    return [];
  }

  const importedItems = [];

  function walkDl(dlNode, folderPath = []) {
    const nodes = Array.from(dlNode.children);
    nodes.forEach((node) => {
      const tag = node.tagName ? node.tagName.toLowerCase() : "";

      if (tag === "dt") {
        const directLink = node.querySelector(":scope > a");
        if (directLink) {
          const url = directLink.getAttribute("href") || "";
          if (!url) {
            return;
          }

          const title = (directLink.textContent || "").trim() || "Khong co tieu de";
          const addDateAttr = directLink.getAttribute("add_date");
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
          return;
        }

        const heading = node.querySelector(":scope > h3");
        if (heading) {
          const folderName = (heading.textContent || "").trim();
          const siblingDl = node.nextElementSibling;
          if (folderName && siblingDl && siblingDl.tagName && siblingDl.tagName.toLowerCase() === "dl") {
            walkDl(siblingDl, [...folderPath, folderName]);
          }
        }
        return;
      }

      if (tag === "dl") {
        walkDl(node, folderPath);
      }
    });
  }

  walkDl(rootDl, []);
  return importedItems;
}

function getDescendantFolderIds(rootId) {
  const ids = new Set([rootId]);
  const queue = [rootId];

  while (queue.length) {
    const currentId = queue.shift();
    currentFolders.forEach((folder) => {
      if (folder.parentId === currentId && !ids.has(folder.id)) {
        ids.add(folder.id);
        queue.push(folder.id);
      }
    });
  }

  return ids;
}

function saveData({ bookmarks = currentBookmarks, folders = currentFolders }, callback) {
  chrome.storage.local.set({ bookmarks, folders }, () => {
    if (typeof callback === "function") {
      callback();
    }
  });
}

function renderFolderParentOptions() {
  const selectedParent = folderParentSelect.value || "";
  const orderedFolders = getOrderedFoldersForSelect();

  folderParentSelect.innerHTML = `
    <option value="">(Root folder)</option>
    ${orderedFolders
      .map((folder) => `<option value="${folder.id}">${"  ".repeat(folder.depth)}${folder.name}</option>`)
      .join("")}
  `;

  folderParentSelect.value = orderedFolders.some((folder) => folder.id === selectedParent) ? selectedParent : "";
}

function renderFolderFilterButtons() {
  folderAllBtn.classList.toggle("active", selectedFolderFilter === FILTER_ALL);
  folderNoneBtn.classList.toggle("active", selectedFolderFilter === FILTER_NONE);
}

function syncRenameFolderState() {
  const selectedFolder = currentFolders.find((folder) => folder.id === selectedFolderFilter);
  const canRename = Boolean(selectedFolder);

  renameFolderBtn.disabled = !canRename;
  if (!canRename) {
    renameFolderInput.value = "";
    renameFolderInput.placeholder = "Chon folder de doi ten...";
    return;
  }

  renameFolderInput.placeholder = "Nhap ten folder moi...";
  renameFolderInput.value = selectedFolder.name;
}

function renderFolderTree() {
  const rootFolders = getChildrenFolders("");
  const selectedFolderExists = currentFolders.some((folder) => folder.id === selectedFolderFilter);

  if (!selectedFolderExists && selectedFolderFilter !== FILTER_ALL && selectedFolderFilter !== FILTER_NONE) {
    selectedFolderFilter = FILTER_ALL;
  }

  if (selectedFolderExists) {
    const selectedFolder = currentFolders.find((folder) => folder.id === selectedFolderFilter);
    if (selectedFolder && selectedFolder.parentId) {
      expandedRootFolderId = selectedFolder.parentId;
    } else if (selectedFolder && !selectedFolder.parentId) {
      expandedRootFolderId = selectedFolder.id;
    }
  }

  folderTree.innerHTML = "";

  rootFolders.forEach((rootFolder) => {
    const rootButton = document.createElement("button");
    rootButton.type = "button";
    rootButton.className = `folder-root ${selectedFolderFilter === rootFolder.id ? "active" : ""}`;
    rootButton.setAttribute("data-folder-id", rootFolder.id);
    rootButton.setAttribute("data-folder-role", "root");
    rootButton.textContent = rootFolder.name;

    const childrenContainer = document.createElement("div");
    childrenContainer.className = `folder-children ${expandedRootFolderId === rootFolder.id ? "open" : ""}`;

    const childFolders = getChildrenFolders(rootFolder.id);
    childFolders.forEach((childFolder) => {
      const childButton = document.createElement("button");
      childButton.type = "button";
      childButton.className = `folder-child ${selectedFolderFilter === childFolder.id ? "active" : ""}`;
      childButton.setAttribute("data-folder-id", childFolder.id);
      childButton.setAttribute("data-folder-role", "child");
      childButton.setAttribute("data-parent-id", rootFolder.id);
      childButton.textContent = childFolder.name;
      childrenContainer.appendChild(childButton);
    });

    folderTree.appendChild(rootButton);
    if (childFolders.length) {
      folderTree.appendChild(childrenContainer);
    }
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

function updateViewButtons() {
  viewButtons.forEach((button) => {
    const mode = button.getAttribute("data-view-mode");
    const isActive = mode === currentViewMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function buildFolderOptionsHtml(selectedFolderId = "") {
  const orderedFolders = getOrderedFoldersForSelect();
  const options = [
    `<option value="">(Khong gan folder)</option>`,
    ...orderedFolders.map(
      (folder) =>
        `<option value="${folder.id}" ${selectedFolderId === folder.id ? "selected" : ""}>${"  ".repeat(folder.depth)}${folder.name}</option>`
    )
  ];

  return options.join("");
}

function buildListItem(bookmark, folderName) {
  const tagsHtml = bookmark.tags.length
    ? bookmark.tags.map((tag) => `<span class="tag-chip">#${tag}</span>`).join("")
    : `<span class="tag-chip">#chua-gan-tag</span>`;

  return `
    <div class="bookmark-title">${bookmark.title}</div>
    <div class="bookmark-url">${bookmark.url}</div>
    <div class="bookmark-meta">
      Folder: ${folderName || "(chua gan)"} <br />
      Da luu: ${formatDate(bookmark.createdAt)} <br />
      Da mo: ${bookmark.clickCount} lan
    </div>
    <div class="tag-list">${tagsHtml}</div>
    <div class="card-tag-input-wrap">
      <button class="add-tag-btn" data-id="${bookmark.id}" type="button">+</button>
      <input class="card-tag-input" data-id="${bookmark.id}" type="text" placeholder="Nhap tag roi Enter..." />
    </div>
    <div class="folder-editor">
      <select class="folder-select" data-id="${bookmark.id}">
        ${buildFolderOptionsHtml(bookmark.folderId)}
      </select>
      <button class="save-folder-btn" data-id="${bookmark.id}" type="button">Luu folder</button>
    </div>
    <div class="actions">
      <button class="open-btn" data-id="${bookmark.id}" data-url="${bookmark.url}" type="button">Mo link</button>
      <button class="delete-btn" data-id="${bookmark.id}" type="button">Xoa</button>
    </div>
  `;
}

function buildCardItem(bookmark, folderName) {
  const tagsHtml = bookmark.tags.length
    ? bookmark.tags.map((tag) => `<span class="tag-chip">#${tag}</span>`).join("")
    : `<span class="tag-chip">#chua-gan-tag</span>`;

  return `
    <div class="bookmark-title">${bookmark.title}</div>
    <div class="bookmark-meta">
      Folder: ${folderName || "(chua gan)"} <br />
      Da luu: ${formatDate(bookmark.createdAt)} <br />
      Da mo: ${bookmark.clickCount} lan
    </div>
    <div class="card-tag-input-wrap">
      <button class="add-tag-btn" data-id="${bookmark.id}" type="button">+</button>
      <input class="card-tag-input" data-id="${bookmark.id}" type="text" placeholder="Nhap tag roi Enter..." />
    </div>
    <div class="tag-list">${tagsHtml}</div>
    <div class="folder-editor">
      <select class="folder-select" data-id="${bookmark.id}">
        ${buildFolderOptionsHtml(bookmark.folderId)}
      </select>
      <button class="save-folder-btn" data-id="${bookmark.id}" type="button">Luu folder</button>
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
  let filtered = currentBookmarks.filter((bookmark) => {
    const text = `${bookmark.title} ${bookmark.url} ${bookmark.tags.join(" ")}`.toLowerCase();
    return text.includes(keyword);
  });

  if (selectedTagFilter !== FILTER_ALL) {
    filtered = filtered.filter((bookmark) => bookmark.tags.includes(selectedTagFilter));
  }

  if (selectedFolderFilter === FILTER_NONE) {
    filtered = filtered.filter((bookmark) => !bookmark.folderId);
  } else if (selectedFolderFilter !== FILTER_ALL) {
    const folderIds = getDescendantFolderIds(selectedFolderFilter);
    filtered = filtered.filter((bookmark) => folderIds.has(bookmark.folderId));
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

function renderBookmarks() {
  const folderNameMap = getFolderNameMap(currentFolders);
  const bookmarks = getFilteredBookmarks();

  bookmarkList.innerHTML = "";
  bookmarkList.classList.toggle("card-view", currentViewMode === "card");

  if (!bookmarks.length) {
    bookmarkList.innerHTML = `<div class="empty">Khong co bookmark nao.</div>`;
    return;
  }

  bookmarks.forEach((bookmark) => {
    const item = document.createElement("div");
    const folderName = folderNameMap[bookmark.folderId] || "";
    item.className = `bookmark-item ${currentViewMode === "card" ? "bookmark-card" : "bookmark-list"}`;
    item.innerHTML = currentViewMode === "card"
      ? buildCardItem(bookmark, folderName)
      : buildListItem(bookmark, folderName);
    bookmarkList.appendChild(item);
  });
}

function renderAllControls() {
  renderFolderParentOptions();
  renderFolderTree();
  renderTagFilterChips();
  renderBookmarks();
}

function reloadData() {
  chrome.storage.local.get(["bookmarks", "folders"], (result) => {
    const rawBookmarks = result.bookmarks || [];
    const rawFolders = result.folders || [];

    const normalizedFolders = rawFolders.map(normalizeFolder).filter((folder) => folder.id && folder.name);
    const folderIdSet = new Set(normalizedFolders.map((folder) => folder.id));
    const normalizedBookmarks = rawBookmarks.map(normalizeBookmark).map((bookmark) => ({
      ...bookmark,
      folderId: folderIdSet.has(bookmark.folderId) ? bookmark.folderId : ""
    }));

    currentFolders = normalizedFolders;
    currentBookmarks = normalizedBookmarks;

    const needsFolderInit = !Array.isArray(result.folders);
    const needsBookmarkMigration = rawBookmarks.some(
      (bookmark) =>
        !Array.isArray(bookmark.tags) ||
        typeof bookmark.folderId !== "string" ||
        typeof bookmark.clickCount !== "number"
    );

    if (needsFolderInit || needsBookmarkMigration) {
      saveData({ bookmarks: normalizedBookmarks, folders: normalizedFolders }, () => {
        renderAllControls();
      });
      return;
    }

    renderAllControls();
  });
}

function deleteBookmark(id) {
  currentBookmarks = currentBookmarks.filter((bookmark) => bookmark.id !== id);
  saveData({ bookmarks: currentBookmarks }, () => {
    renderAllControls();
  });
}

function saveBookmarkFolder(id) {
  const select = document.querySelector(`.folder-select[data-id="${id}"]`);
  const folderId = select ? select.value : "";

  currentBookmarks = currentBookmarks.map((bookmark) => {
    if (bookmark.id !== id) {
      return bookmark;
    }

    return { ...bookmark, folderId };
  });

  saveData({ bookmarks: currentBookmarks }, () => {
    renderAllControls();
  });
}

function addTagFromCardInput(id, rawInput) {
  const newTags = parseTags(rawInput || "");
  if (!newTags.length) {
    return;
  }

  currentBookmarks = currentBookmarks.map((bookmark) => {
    if (bookmark.id !== id) {
      return bookmark;
    }

    return {
      ...bookmark,
      tags: mergeTagList(bookmark.tags, newTags)
    };
  });

  saveData({ bookmarks: currentBookmarks }, () => {
    renderAllControls();
  });
}

function openBookmark(id, url) {
  if (!url) {
    return;
  }

  chrome.tabs.create({ url });

  if (!id) {
    return;
  }

  currentBookmarks = currentBookmarks.map((bookmark) => {
    if (bookmark.id !== id) {
      return bookmark;
    }

    return {
      ...bookmark,
      clickCount: (bookmark.clickCount || 0) + 1
    };
  });

  saveData({ bookmarks: currentBookmarks }, () => {
    renderAllControls();
  });
}

function createFolder() {
  const name = newFolderNameInput.value.trim();
  const parentId = folderParentSelect.value || "";

  if (!name) {
    return;
  }

  const parentExists = !parentId || currentFolders.some((folder) => folder.id === parentId);
  if (!parentExists) {
    return;
  }

  const newFolder = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    parentId,
    createdAt: Date.now()
  };

  currentFolders = [...currentFolders, newFolder];
  saveData({ folders: currentFolders }, () => {
    newFolderNameInput.value = "";
    folderParentSelect.value = "";
    renderAllControls();
  });
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

  currentFolders = currentFolders.map((folder) => {
    if (folder.id !== selectedFolderFilter) {
      return folder;
    }

    return {
      ...folder,
      name: newName
    };
  });

  saveData({ folders: currentFolders }, () => {
    renderAllControls();
  });
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

    currentFolders = workingFolders.map(normalizeFolder);
    currentBookmarks = workingBookmarks.map(normalizeBookmark);
    saveData({ folders: currentFolders, bookmarks: currentBookmarks }, () => {
      renderAllControls();
      importStatus.textContent = `Import xong: them ${insertedCount}, cap nhat ${updatedCount}.`;
      importFileInput.value = "";
    });
  } catch (error) {
    importStatus.textContent = "Import that bai. Kiem tra lai file bookmarks.html.";
  }
}

searchInput.addEventListener("input", () => {
  renderBookmarks();
});

createdViewSelect.value = selectedCreatedView;
createdViewSelect.addEventListener("change", () => {
  const value = createdViewSelect.value;
  const validValues = new Set(["newest", "oldest", "today", "last7", "last30"]);
  selectedCreatedView = validValues.has(value) ? value : "newest";
  localStorage.setItem(TIME_VIEW_KEY, selectedCreatedView);
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

renameFolderInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    renameSelectedFolder();
  }
});

importBtn.addEventListener("click", importChromeBookmarks);
importFileInput.addEventListener("change", () => {
  importStatus.textContent = "";
});

folderAllBtn.addEventListener("click", () => {
  selectedFolderFilter = FILTER_ALL;
  renderFolderTree();
  renderBookmarks();
});

folderNoneBtn.addEventListener("click", () => {
  selectedFolderFilter = FILTER_NONE;
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

  const role = target.getAttribute("data-folder-role");
  if (role === "root") {
    expandedRootFolderId = expandedRootFolderId === folderId ? "" : folderId;
    selectedFolderFilter = folderId;
    renderFolderTree();
    renderBookmarks();
    return;
  }

  if (role === "child") {
    const parentId = target.getAttribute("data-parent-id") || "";
    expandedRootFolderId = parentId;
    selectedFolderFilter = folderId;
    renderFolderTree();
    renderBookmarks();
  }
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
  renderTagFilterChips();
  renderBookmarks();
});

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
