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

saveBtn.addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];

  if (!currentTab || !currentTab.url) {
    message.textContent = "Khong lay duoc tab hien tai.";
    return;
  }

  const tags = parseTags(tagsInput.value || "");
  const autoTags = getAutoTags(currentTab.url);
  const mergedInputTags = mergeTags(tags, autoTags);
  const newBookmark = {
    id: Date.now().toString(),
    title: currentTab.title || "Khong co tieu de",
    url: currentTab.url,
    domain: getDomain(currentTab.url),
    createdAt: Date.now(),
    clickCount: 0,
    tags: mergedInputTags
  };

  chrome.storage.local.get(["bookmarks"], (result) => {
    const bookmarks = result.bookmarks || [];

    const existedIndex = bookmarks.findIndex((item) => item.url === newBookmark.url);
    if (existedIndex !== -1) {
      const existing = bookmarks[existedIndex];
      bookmarks[existedIndex] = {
        ...existing,
        clickCount: typeof existing.clickCount === "number" ? existing.clickCount : 0,
        tags: mergeTags(Array.isArray(existing.tags) ? existing.tags : [], mergedInputTags)
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
