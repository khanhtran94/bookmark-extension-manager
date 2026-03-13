const saveBtn = document.getElementById("saveBtn");
const bookmarkList = document.getElementById("bookmarkList");

saveBtn.addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];

  if (!currentTab || !currentTab.url) {
    return;
  }

  const newBookmark = {
    id: Date.now().toString(),
    title: currentTab.title || "Không có tiêu đề",
    url: currentTab.url,
    createdAt: Date.now()
  };

  chrome.storage.local.get(["bookmarks"], (result) => {
    const bookmarks = result.bookmarks || [];
    bookmarks.unshift(newBookmark);

    chrome.storage.local.set({ bookmarks }, () => {
      renderBookmarks(bookmarks);
    });
  });
});

function renderBookmarks(bookmarks) {
  bookmarkList.innerHTML = "";

  if (!bookmarks.length) {
    bookmarkList.innerHTML = "<p>Chưa có bookmark nào.</p>";
    return;
  }

  bookmarks.forEach((bookmark) => {
    const div = document.createElement("div");
    div.className = "bookmark-item";

    div.innerHTML = `
      <div class="bookmark-title">${bookmark.title}</div>
      <div class="bookmark-url">${bookmark.url}</div>
      <button class="delete-btn" data-id="${bookmark.id}">Xóa</button>
    `;

    bookmarkList.appendChild(div);
  });

  const deleteButtons = document.querySelectorAll(".delete-btn");
  deleteButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-id");

      chrome.storage.local.get(["bookmarks"], (result) => {
        const bookmarks = result.bookmarks || [];
        const updatedBookmarks = bookmarks.filter((item) => item.id !== id);

        chrome.storage.local.set({ bookmarks: updatedBookmarks }, () => {
          renderBookmarks(updatedBookmarks);
        });
      });
    });
  });
}

function loadBookmarks() {
  chrome.storage.local.get(["bookmarks"], (result) => {
    const bookmarks = result.bookmarks || [];
    renderBookmarks(bookmarks);
  });
}

loadBookmarks();