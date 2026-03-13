const searchInput = document.getElementById("searchInput");
const bookmarkList = document.getElementById("bookmarkList");

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

function renderBookmarks(bookmarks) {
  bookmarkList.innerHTML = "";

  if (!bookmarks.length) {
    bookmarkList.innerHTML = `<div class="empty">Khong co bookmark nao.</div>`;
    return;
  }

  bookmarks.forEach((bookmark) => {
    const normalizedBookmark = normalizeBookmark(bookmark);
    const div = document.createElement("div");
    div.className = "bookmark-item";

    const tagsHtml = normalizedBookmark.tags.length
      ? normalizedBookmark.tags
          .map((tag) => `<span class="tag-chip">#${tag}</span>`)
          .join("")
      : `<span class="tag-chip">#chua-gan-tag</span>`;

    div.innerHTML = `
      <div class="bookmark-title">${normalizedBookmark.title}</div>
      <div class="bookmark-url">${normalizedBookmark.url}</div>
      <div class="bookmark-meta">
        Domain: ${normalizedBookmark.domain || ""} <br />
        Da luu: ${formatDate(normalizedBookmark.createdAt)}
      </div>
      <div class="tag-list">${tagsHtml}</div>
      <div class="tag-editor">
        <input class="tags-input" data-id="${normalizedBookmark.id}" type="text" value="${normalizedBookmark.tags.join(", ")}" placeholder="Nhap tag, vd: doc, react" />
        <button class="save-tags-btn" data-id="${normalizedBookmark.id}">Luu tag</button>
      </div>
      <div class="actions">
        <button class="open-btn" data-url="${normalizedBookmark.url}">Mo link</button>
        <button class="delete-btn" data-id="${normalizedBookmark.id}">Xoa</button>
      </div>
    `;

    bookmarkList.appendChild(div);
  });

  const openButtons = document.querySelectorAll(".open-btn");
  openButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const url = e.target.getAttribute("data-url");
      chrome.tabs.create({ url });
    });
  });

  const deleteButtons = document.querySelectorAll(".delete-btn");
  deleteButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-id");

      chrome.storage.local.get(["bookmarks"], (result) => {
        const bookmarks = result.bookmarks || [];
        const updatedBookmarks = bookmarks.filter((item) => item.id !== id);

        chrome.storage.local.set({ bookmarks: updatedBookmarks }, () => {
          loadBookmarks(searchInput.value);
        });
      });
    });
  });

  const saveTagButtons = document.querySelectorAll(".save-tags-btn");
  saveTagButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-id");
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
    });
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

searchInput.addEventListener("input", (e) => {
  loadBookmarks(e.target.value);
});

loadBookmarks();
