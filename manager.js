const searchInput = document.getElementById("searchInput");
const bookmarkList = document.getElementById("bookmarkList");
const viewButtons = document.querySelectorAll(".view-btn");

const VIEW_MODE_KEY = "bookmarkManagerViewMode";
let currentViewMode = localStorage.getItem(VIEW_MODE_KEY) === "card" ? "card" : "list";

function formatDate(timestamp) {
  const date = new Date(timestamp);
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

function normalizeBookmark(bookmark) {
  return {
    ...bookmark,
    tags: Array.isArray(bookmark.tags) ? bookmark.tags : []
  };
}

function updateViewButtons() {
  viewButtons.forEach((button) => {
    const mode = button.getAttribute("data-view-mode");
    const isActive = mode === currentViewMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function buildListItem(bookmark) {
  const tagsHtml = bookmark.tags.length
    ? bookmark.tags.map((tag) => `<span class="tag-chip">#${tag}</span>`).join("")
    : `<span class="tag-chip">#chua-gan-tag</span>`;

  return `
    <div class="bookmark-title">${bookmark.title}</div>
    <div class="bookmark-url">${bookmark.url}</div>
    <div class="bookmark-meta">
      Domain: ${bookmark.domain || ""} <br />
      Da luu: ${formatDate(bookmark.createdAt)}
    </div>
    <div class="tag-list">${tagsHtml}</div>
    <div class="tag-editor">
      <input class="tags-input" data-id="${bookmark.id}" type="text" value="${bookmark.tags.join(", ")}" placeholder="Nhap tag, vd: doc, react" />
      <button class="save-tags-btn" data-id="${bookmark.id}" type="button">Luu tag</button>
    </div>
    <div class="actions">
      <button class="open-btn" data-url="${bookmark.url}" type="button">Mo link</button>
      <button class="delete-btn" data-id="${bookmark.id}" type="button">Xoa</button>
    </div>
  `;
}

function buildCardItem(bookmark) {
  const tagsHtml = bookmark.tags.length
    ? bookmark.tags.map((tag) => `<span class="tag-chip">#${tag}</span>`).join("")
    : `<span class="tag-chip">#chua-gan-tag</span>`;

  return `
    <div class="bookmark-title">${bookmark.title}</div>
    <div class="tag-list">${tagsHtml}</div>
    <div class="actions">
      <button class="open-btn" data-url="${bookmark.url}" type="button">Open</button>
      <button class="delete-btn" data-id="${bookmark.id}" type="button">Delete</button>
    </div>
  `;
}

function renderBookmarks(bookmarks) {
  bookmarkList.innerHTML = "";
  bookmarkList.classList.toggle("card-view", currentViewMode === "card");

  if (!bookmarks.length) {
    bookmarkList.innerHTML = `<div class="empty">Khong co bookmark nao.</div>`;
    return;
  }

  bookmarks.forEach((bookmark) => {
    const normalizedBookmark = normalizeBookmark(bookmark);
    const item = document.createElement("div");
    item.className = `bookmark-item ${currentViewMode === "card" ? "bookmark-card" : "bookmark-list"}`;
    item.innerHTML = currentViewMode === "card"
      ? buildCardItem(normalizedBookmark)
      : buildListItem(normalizedBookmark);
    bookmarkList.appendChild(item);
  });
}

function loadBookmarks(keyword = "") {
  chrome.storage.local.get(["bookmarks"], (result) => {
    const bookmarks = (result.bookmarks || []).map(normalizeBookmark);
    const normalizedKeyword = keyword.trim().toLowerCase();

    const filtered = bookmarks.filter((item) => {
      const text = `${item.title} ${item.url} ${item.tags.join(" ")}`.toLowerCase();
      return text.includes(normalizedKeyword);
    });

    renderBookmarks(filtered);
  });
}

function deleteBookmark(id) {
  chrome.storage.local.get(["bookmarks"], (result) => {
    const bookmarks = result.bookmarks || [];
    const updatedBookmarks = bookmarks.filter((item) => item.id !== id);

    chrome.storage.local.set({ bookmarks: updatedBookmarks }, () => {
      loadBookmarks(searchInput.value);
    });
  });
}

function saveBookmarkTags(id) {
  const input = document.querySelector(`.tags-input[data-id="${id}"]`);
  const tags = parseTags(input ? input.value : "");

  chrome.storage.local.get(["bookmarks"], (result) => {
    const bookmarks = result.bookmarks || [];
    const updatedBookmarks = bookmarks.map((item) => {
      if (item.id !== id) {
        return normalizeBookmark(item);
      }

      return {
        ...item,
        tags
      };
    });

    chrome.storage.local.set({ bookmarks: updatedBookmarks }, () => {
      loadBookmarks(searchInput.value);
    });
  });
}

searchInput.addEventListener("input", (e) => {
  loadBookmarks(e.target.value);
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
    loadBookmarks(searchInput.value);
  });
});

bookmarkList.addEventListener("click", (e) => {
  const target = e.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.classList.contains("open-btn")) {
    const url = target.getAttribute("data-url");
    if (url) {
      chrome.tabs.create({ url });
    }
    return;
  }

  if (target.classList.contains("delete-btn")) {
    const id = target.getAttribute("data-id");
    if (id) {
      deleteBookmark(id);
    }
    return;
  }

  if (target.classList.contains("save-tags-btn")) {
    const id = target.getAttribute("data-id");
    if (id) {
      saveBookmarkTags(id);
    }
  }
});

updateViewButtons();
loadBookmarks();
