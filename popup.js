const saveBtn = document.getElementById("saveBtn");
const openManagerBtn = document.getElementById("openManagerBtn");
const tagsInput = document.getElementById("tagsInput");
const message = document.getElementById("message");

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

saveBtn.addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];

  if (!currentTab || !currentTab.url) {
    message.textContent = "Khong lay duoc tab hien tai.";
    return;
  }

  const tags = parseTags(tagsInput.value || "");
  const newBookmark = {
    id: Date.now().toString(),
    title: currentTab.title || "Khong co tieu de",
    url: currentTab.url,
    domain: getDomain(currentTab.url),
    createdAt: Date.now(),
    tags
  };

  chrome.storage.local.get(["bookmarks"], (result) => {
    const bookmarks = result.bookmarks || [];

    const existedIndex = bookmarks.findIndex((item) => item.url === newBookmark.url);
    if (existedIndex !== -1) {
      const existing = bookmarks[existedIndex];
      bookmarks[existedIndex] = {
        ...existing,
        tags: mergeTags(Array.isArray(existing.tags) ? existing.tags : [], tags)
      };

      chrome.storage.local.set({ bookmarks }, () => {
        message.textContent = "Link da ton tai, da cap nhat tag.";
        tagsInput.value = "";
      });
      return;
    }

    bookmarks.unshift(newBookmark);

    chrome.storage.local.set({ bookmarks }, () => {
      message.textContent = "Da luu bookmark thanh cong.";
      tagsInput.value = "";
    });
  });
});

openManagerBtn.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("manager.html")
  });
});
