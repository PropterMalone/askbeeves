// src/api.ts
var BSKY_PUBLIC_API = "https://public.api.bsky.app";
var BSKY_PDS_DEFAULT = "https://bsky.social";
var getLocalStorage = () => {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
};
function getSession() {
  try {
    const localStorageProxy = getLocalStorage();
    if (!localStorageProxy) {
      console.log("[AskBeeves API] localStorage not available");
      return null;
    }
    const allKeys = Object.keys(localStorageProxy);
    console.log("[AskBeeves API] All localStorage keys:", allKeys);
    const possibleKeys = allKeys.filter(
      (k) => k.includes("BSKY") || k.includes("bsky") || k.includes("session")
    );
    console.log("[AskBeeves API] Filtered keys:", possibleKeys);
    for (const storageKey of possibleKeys) {
      try {
        const raw = localStorageProxy.getItem(storageKey);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        let account = null;
        if (parsed?.session?.currentAccount) {
          const currentDid = parsed.session.currentAccount.did;
          account = parsed.session.accounts?.find((a) => a.did === currentDid) || null;
        }
        if (!account && parsed?.currentAccount) {
          const currentDid = parsed.currentAccount.did;
          account = parsed.accounts?.find((a) => a.did === currentDid) || null;
        }
        if (!account && parsed?.accessJwt && parsed?.did) {
          account = parsed;
        }
        if (account && account.accessJwt && account.did) {
          let pdsUrl = account.pdsUrl || account.service || BSKY_PDS_DEFAULT;
          pdsUrl = pdsUrl.replace(/\/+$/, "");
          if (!pdsUrl.startsWith("http://") && !pdsUrl.startsWith("https://")) {
            pdsUrl = "https://" + pdsUrl;
          }
          return {
            accessJwt: account.accessJwt,
            refreshJwt: account.refreshJwt,
            did: account.did,
            handle: account.handle || "",
            pdsUrl
          };
        }
      } catch {
      }
    }
    return null;
  } catch {
    return null;
  }
}
async function fetchWithRetry(url, options = {}, retries = 3, backoff = 1e3) {
  try {
    const response = await fetch(url, options);
    if (response.status === 429 && retries > 0) {
      await sleep(backoff);
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      await sleep(backoff);
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw error;
  }
}
async function getProfile(actor) {
  try {
    const url = `${BSKY_PUBLIC_API}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
    const response = await fetchWithRetry(url);
    if (!response.ok) return null;
    const data = await response.json();
    return {
      did: data.did,
      handle: data.handle,
      displayName: data.displayName,
      avatar: data.avatar
    };
  } catch {
    return null;
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/types.ts
var DEFAULT_SETTINGS = {
  displayMode: "compact"
};
var STORAGE_KEYS = {
  BLOCK_CACHE: "blockCache",
  SYNC_STATUS: "syncStatus",
  AUTH_TOKEN: "authToken",
  SETTINGS: "settings"
};

// src/storage.ts
async function getSettings() {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  const data = result[STORAGE_KEYS.SETTINGS];
  return data || DEFAULT_SETTINGS;
}

// src/content.ts
var currentObserver = null;
var lastInjectedHandle = null;
var injectionInProgress = false;
var debounceTimer = null;
function getProfileHandleFromUrl() {
  const match = window.location.pathname.match(/\/profile\/([^/]+)/);
  return match ? match[1] : null;
}
function findFollowedByElement() {
  const xpath = "//*[contains(text(), 'Followed by')]";
  const result = document.evaluate(
    xpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  );
  const textElement = result.singleNodeValue;
  if (!textElement) return null;
  let parent = textElement.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    if (style.display === "flex" && style.flexDirection === "row") {
      const grandparent = parent.parentElement;
      if (grandparent) {
        const gpStyle = window.getComputedStyle(grandparent);
        if (gpStyle.display === "flex" && gpStyle.flexDirection === "column") {
          return parent;
        }
      }
    }
    parent = parent.parentElement;
  }
  return textElement.parentElement;
}
function randomSample(array, n) {
  if (array.length <= n) return array;
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}
function formatUserList(sampledUsers, totalCount) {
  if (sampledUsers.length === 0) return "";
  const names = sampledUsers.map((u) => u.displayName || `@${u.handle}`).join(", ");
  if (totalCount > sampledUsers.length) {
    const remaining = totalCount - sampledUsers.length;
    return `${names}, and ${remaining} other${remaining === 1 ? "" : "s"}`;
  }
  return names;
}
function getFollowedByAvatarStyle() {
  const followedByText = document.evaluate(
    "//*[contains(text(), 'Followed by')]",
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue;
  if (followedByText) {
    const parent = followedByText.parentElement;
    if (parent) {
      const imgs = parent.querySelectorAll("img");
      if (imgs.length > 0) {
        const firstImg = imgs[0];
        const style = window.getComputedStyle(firstImg);
        const size = style.width || "32px";
        let overlap = "-8px";
        if (imgs.length > 1) {
          const secondStyle = window.getComputedStyle(imgs[1]);
          overlap = secondStyle.marginLeft || "-8px";
        }
        console.log("[AskBeeves] Detected avatar style:", { size, overlap });
        return { size, overlap };
      }
    }
  }
  return { size: "32px", overlap: "-8px" };
}
function createAvatarRow(sampledUsers) {
  const container = document.createElement("div");
  container.style.cssText = `
    display: flex;
    align-items: center;
    margin-right: 4px;
  `;
  const { size, overlap } = getFollowedByAvatarStyle();
  const displayUsers = sampledUsers.slice(0, 3);
  displayUsers.forEach((user, index) => {
    const avatar = document.createElement("img");
    avatar.src = user.avatar || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23ccc"/></svg>';
    avatar.alt = user.displayName || user.handle;
    avatar.title = user.displayName || `@${user.handle}`;
    avatar.style.cssText = `
      width: ${size};
      height: ${size};
      border-radius: 50%;
      object-fit: cover;
      margin-left: ${index > 0 ? overlap : "0"};
      position: relative;
      z-index: ${3 - index};
      box-shadow: 0 0 0 2px white;
    `;
    avatar.onerror = () => {
      avatar.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23ccc"/></svg>';
    };
    container.appendChild(avatar);
  });
  return container;
}
function showFullListModal(users, title) {
  const existing = document.getElementById("askbeeves-full-list-modal");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "askbeeves-full-list-modal";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
  `;
  const dialog = document.createElement("div");
  dialog.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 20px;
    min-width: 320px;
    max-width: 480px;
    max-height: 60vh;
    overflow-y: auto;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  const titleEl = document.createElement("h3");
  titleEl.style.cssText = `
    margin: 0 0 16px 0;
    font-size: 16px;
    font-weight: 600;
    color: #425780;
  `;
  titleEl.textContent = title;
  const listEl = document.createElement("div");
  listEl.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 4px;
  `;
  for (const user of users) {
    const item = document.createElement("div");
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid #e5e7eb;
    `;
    const avatar = document.createElement("img");
    avatar.src = user.avatar || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23ccc"/></svg>';
    avatar.alt = user.displayName || user.handle;
    avatar.style.cssText = `
      width: 32px;
      height: 32px;
      border-radius: 50%;
      object-fit: cover;
    `;
    avatar.onerror = () => {
      avatar.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23ccc"/></svg>';
    };
    const textContainer = document.createElement("div");
    textContainer.style.cssText = `display: flex; flex-direction: column;`;
    if (user.displayName) {
      const displayNameEl = document.createElement("span");
      displayNameEl.style.cssText = `font-size: 14px; font-weight: 600; color: #1a1a1a;`;
      displayNameEl.textContent = user.displayName;
      textContainer.appendChild(displayNameEl);
    }
    const handleEl = document.createElement("span");
    handleEl.style.cssText = `font-size: 13px; color: #687882;`;
    handleEl.textContent = `@${user.handle}`;
    textContainer.appendChild(handleEl);
    item.appendChild(avatar);
    item.appendChild(textContainer);
    listEl.appendChild(item);
  }
  const closeBtn = document.createElement("button");
  closeBtn.style.cssText = `
    margin-top: 16px;
    padding: 10px 16px;
    border: none;
    border-radius: 8px;
    background: #1083fe;
    color: white;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    width: 100%;
  `;
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => overlay.remove());
  dialog.appendChild(titleEl);
  dialog.appendChild(listEl);
  dialog.appendChild(closeBtn);
  overlay.appendChild(dialog);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}
function createCompactDisplay(blockingInfo, onBlockedByClick, onBlockingClick) {
  const container = document.createElement("div");
  container.id = "askbeeves-blocking-container";
  container.style.cssText = `
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0;
    margin-top: 8px;
    font-size: 13px;
    line-height: 18px;
    color: rgb(66, 87, 108);
  `;
  const blockedByCount = blockingInfo.blockedBy.length;
  const blockingCount = blockingInfo.blocking.length;
  if (blockedByCount === 0 && blockingCount === 0) {
    container.textContent = "Not blocked by or blocking anyone you follow.";
    return container;
  }
  if (blockedByCount > 0) {
    const blockedBySpan = document.createElement("span");
    blockedBySpan.style.cssText = "cursor: pointer;";
    blockedBySpan.textContent = `Blocked by ${blockedByCount} ${blockedByCount === 1 ? "person" : "people"} you follow`;
    blockedBySpan.addEventListener("click", onBlockedByClick);
    blockedBySpan.addEventListener("mouseenter", () => {
      blockedBySpan.style.textDecoration = "underline";
    });
    blockedBySpan.addEventListener("mouseleave", () => {
      blockedBySpan.style.textDecoration = "none";
    });
    container.appendChild(blockedBySpan);
  } else {
    const noBlockedBy = document.createElement("span");
    noBlockedBy.textContent = "Not blocked by anyone you follow";
    container.appendChild(noBlockedBy);
  }
  const separator = document.createElement("span");
  separator.textContent = " and ";
  container.appendChild(separator);
  if (blockingCount > 0) {
    const blockingSpan = document.createElement("span");
    blockingSpan.style.cssText = "cursor: pointer;";
    blockingSpan.textContent = `blocking ${blockingCount} ${blockingCount === 1 ? "person" : "people"} you follow`;
    blockingSpan.addEventListener("click", onBlockingClick);
    blockingSpan.addEventListener("mouseenter", () => {
      blockingSpan.style.textDecoration = "underline";
    });
    blockingSpan.addEventListener("mouseleave", () => {
      blockingSpan.style.textDecoration = "none";
    });
    container.appendChild(blockingSpan);
  } else {
    const noBlocking = document.createElement("span");
    noBlocking.textContent = "not blocking anyone you follow";
    container.appendChild(noBlocking);
  }
  const period = document.createElement("span");
  period.textContent = ".";
  container.appendChild(period);
  return container;
}
function createDetailedDisplay(blockingInfo, onBlockedByClick, onBlockingClick) {
  const container = document.createElement("div");
  container.id = "askbeeves-blocking-container";
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  `;
  const createBlockRow = (users, label, onClick) => {
    const row = document.createElement("div");
    row.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      line-height: 18px;
      color: rgb(66, 87, 108);
      cursor: pointer;
    `;
    const sampled = randomSample(users, 3);
    const avatarRow = createAvatarRow(sampled);
    row.appendChild(avatarRow);
    const textSpan = document.createElement("span");
    const displayNames = formatUserList(sampled.slice(0, 2), users.length);
    textSpan.textContent = `${label} ${displayNames}`;
    row.appendChild(textSpan);
    row.addEventListener("click", onClick);
    row.addEventListener("mouseenter", () => {
      row.style.textDecoration = "underline";
    });
    row.addEventListener("mouseleave", () => {
      row.style.textDecoration = "none";
    });
    return row;
  };
  const createTextOnlyRow = (text) => {
    const row = document.createElement("div");
    row.style.cssText = `
      display: flex;
      align-items: center;
      font-size: 13px;
      line-height: 18px;
      color: rgb(66, 87, 108);
    `;
    row.textContent = text;
    return row;
  };
  if (blockingInfo.blockedBy.length > 0) {
    const blockedByRow = createBlockRow(
      blockingInfo.blockedBy,
      "Blocked by",
      onBlockedByClick
    );
    container.appendChild(blockedByRow);
  } else {
    container.appendChild(createTextOnlyRow("Not blocked by anyone you follow"));
  }
  if (blockingInfo.blocking.length > 0) {
    const blockingRow = createBlockRow(
      blockingInfo.blocking,
      "Blocking",
      onBlockingClick
    );
    container.appendChild(blockingRow);
  } else {
    container.appendChild(createTextOnlyRow("Not blocking anyone you follow"));
  }
  return container;
}
async function waitForFollowedBy(maxWaitMs = 3e3) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const element = findFollowedByElement();
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}
async function injectBlockingInfo() {
  const handle = getProfileHandleFromUrl();
  if (!handle) return;
  if (handle === lastInjectedHandle || injectionInProgress) {
    return;
  }
  injectionInProgress = true;
  const existing = document.getElementById("askbeeves-blocking-container");
  if (existing) existing.remove();
  const followedByElement = await waitForFollowedBy();
  if (!followedByElement) {
    console.log('[AskBeeves] No "Followed by" element found after waiting');
    injectionInProgress = false;
    return;
  }
  console.log("[AskBeeves] Resolving profile for:", handle);
  const profile = await getProfile(handle);
  if (!profile?.did) {
    console.log("[AskBeeves] Could not resolve profile DID for:", handle);
    injectionInProgress = false;
    return;
  }
  console.log("[AskBeeves] Resolved DID:", profile.did);
  let response;
  try {
    if (!isExtensionContextValid()) {
      console.log("[AskBeeves] Extension context invalidated, skipping message");
      injectionInProgress = false;
      return;
    }
    response = await chrome.runtime.sendMessage({
      type: "GET_BLOCKING_INFO",
      profileDid: profile.did
    });
  } catch (error) {
    console.log("[AskBeeves] Error sending message:", error);
    injectionInProgress = false;
    return;
  }
  if (!response || !response.success || !response.blockingInfo) {
    console.log("[AskBeeves] Failed to get blocking info:", response?.error);
    injectionInProgress = false;
    return;
  }
  const blockingInfo = response.blockingInfo;
  console.log(
    "[AskBeeves] Blocking info:",
    blockingInfo.blockedBy.length,
    "blocked by,",
    blockingInfo.blocking.length,
    "blocking"
  );
  let displayMode = "compact";
  try {
    const settings = await getSettings();
    displayMode = settings.displayMode;
  } catch (error) {
    console.log("[AskBeeves] Could not load settings, using default:", error);
  }
  console.log("[AskBeeves] Display mode:", displayMode);
  const onBlockedByClick = () => {
    showFullListModal(
      blockingInfo.blockedBy,
      "Blocked by (users you follow who block this profile)"
    );
  };
  const onBlockingClick = () => {
    showFullListModal(
      blockingInfo.blocking,
      "Blocking (users you follow that this profile blocks)"
    );
  };
  const container = displayMode === "compact" ? createCompactDisplay(blockingInfo, onBlockedByClick, onBlockingClick) : createDetailedDisplay(blockingInfo, onBlockedByClick, onBlockingClick);
  if (followedByElement.nextSibling) {
    followedByElement.parentNode?.insertBefore(container, followedByElement.nextSibling);
  } else {
    followedByElement.parentNode?.appendChild(container);
  }
  lastInjectedHandle = handle;
  injectionInProgress = false;
  console.log("[AskBeeves] Injected blocking info for", handle);
}
function isExtensionContextValid() {
  try {
    return !!chrome?.runtime?.id;
  } catch {
    return false;
  }
}
function checkAndInjectIfNeeded() {
  const handle = getProfileHandleFromUrl();
  if (!handle) {
    lastInjectedHandle = null;
    return;
  }
  if (handle !== lastInjectedHandle) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      injectBlockingInfo();
    }, 100);
  }
}
var lastUrl = window.location.href;
function handleUrlChange() {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    console.log("[AskBeeves] URL changed:", lastUrl, "->", currentUrl);
    lastUrl = currentUrl;
    lastInjectedHandle = null;
    const existing = document.getElementById("askbeeves-blocking-container");
    if (existing) existing.remove();
    checkAndInjectIfNeeded();
  }
}
function observeNavigation() {
  if (currentObserver) {
    currentObserver.disconnect();
  }
  currentObserver = new MutationObserver(() => {
    handleUrlChange();
    checkAndInjectIfNeeded();
  });
  currentObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  window.addEventListener("popstate", () => {
    console.log("[AskBeeves] popstate event");
    handleUrlChange();
  });
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function(...args) {
    originalPushState.apply(this, args);
    console.log("[AskBeeves] pushState detected");
    handleUrlChange();
  };
  history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    console.log("[AskBeeves] replaceState detected");
    handleUrlChange();
  };
  console.log("[AskBeeves] Navigation observer started");
}
async function syncAuthToBackground() {
  if (!isExtensionContextValid()) {
    console.log("[AskBeeves] Extension context invalidated, skipping auth sync");
    return;
  }
  console.log("[AskBeeves] Attempting to sync auth...");
  const session = getSession();
  console.log("[AskBeeves] Session found:", session ? `DID=${session.did}` : "null");
  if (session?.accessJwt && session?.did && session?.pdsUrl) {
    try {
      await chrome.runtime.sendMessage({
        type: "SET_AUTH",
        auth: session
      });
      console.log("[AskBeeves] Auth synced to background");
    } catch (error) {
      console.log("[AskBeeves] Failed to sync auth:", error);
    }
  } else {
    console.log(
      "[AskBeeves] No valid session found - missing:",
      !session?.accessJwt ? "accessJwt" : "",
      !session?.did ? "did" : "",
      !session?.pdsUrl ? "pdsUrl" : ""
    );
  }
}
function init() {
  console.log("[AskBeeves] Content script loaded");
  checkAndInjectIfNeeded();
  observeNavigation();
  setTimeout(syncAuthToBackground, 1e3);
  setInterval(syncAuthToBackground, 5 * 60 * 1e3);
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
