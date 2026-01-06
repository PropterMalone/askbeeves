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
async function saveSettings(settings) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

// src/options.ts
async function init() {
  const settings = await getSettings();
  const compactRadio = document.getElementById("display-compact");
  const detailedRadio = document.getElementById("display-detailed");
  if (settings.displayMode === "compact") {
    compactRadio.checked = true;
  } else {
    detailedRadio.checked = true;
  }
  compactRadio.addEventListener("change", () => handleDisplayModeChange("compact"));
  detailedRadio.addEventListener("change", () => handleDisplayModeChange("detailed"));
}
async function handleDisplayModeChange(mode) {
  const settings = await getSettings();
  settings.displayMode = mode;
  await saveSettings(settings);
  const savedIndicator = document.getElementById("saved-indicator");
  if (savedIndicator) {
    savedIndicator.style.opacity = "1";
    setTimeout(() => {
      savedIndicator.style.opacity = "0";
    }, 1500);
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
