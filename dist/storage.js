// src/types.ts
var STORAGE_KEYS = {
  BLOCK_CACHE: "blockCache",
  SYNC_STATUS: "syncStatus",
  AUTH_TOKEN: "authToken"
};

// src/storage.ts
async function getBlockCache() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.BLOCK_CACHE);
  const data = result[STORAGE_KEYS.BLOCK_CACHE];
  return data || null;
}
async function saveBlockCache(data) {
  await chrome.storage.local.set({ [STORAGE_KEYS.BLOCK_CACHE]: data });
}
function createEmptyCache(currentUserDid) {
  return {
    followedUsers: [],
    userBlockCaches: {},
    lastFullSync: 0,
    currentUserDid
  };
}
async function updateUserBlockCache(userCache) {
  const cache = await getBlockCache();
  if (!cache) return;
  cache.userBlockCaches[userCache.did] = userCache;
  await saveBlockCache(cache);
}
async function getSyncStatus() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SYNC_STATUS);
  const data = result[STORAGE_KEYS.SYNC_STATUS];
  return data || {
    totalFollows: 0,
    syncedFollows: 0,
    lastSync: 0,
    isRunning: false,
    lastUpdated: 0,
    errors: []
  };
}
async function updateSyncStatus(status) {
  const current = await getSyncStatus();
  await chrome.storage.local.set({
    [STORAGE_KEYS.SYNC_STATUS]: { ...current, ...status, lastUpdated: Date.now() }
  });
}
async function getStoredAuth() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.AUTH_TOKEN);
  const data = result[STORAGE_KEYS.AUTH_TOKEN];
  return data || null;
}
async function storeAuth(auth) {
  await chrome.storage.local.set({ [STORAGE_KEYS.AUTH_TOKEN]: auth });
}
async function lookupBlockingInfo(profileDid, profileBlocks) {
  const cache = await getBlockCache();
  if (!cache) {
    return { blockedBy: [], blocking: [] };
  }
  const blockedBy = [];
  const blocking = [];
  const followedDids = new Set(cache.followedUsers.map((u) => u.did));
  for (const user of cache.followedUsers) {
    const userBlocks = cache.userBlockCaches[user.did];
    if (userBlocks && userBlocks.blocks.includes(profileDid)) {
      blockedBy.push({
        did: user.did,
        handle: userBlocks.handle || user.handle,
        displayName: userBlocks.displayName || user.displayName,
        avatar: userBlocks.avatar || user.avatar
      });
    }
  }
  const blocksToCheck = profileBlocks || cache.userBlockCaches[profileDid]?.blocks || [];
  for (const blockedDid of blocksToCheck) {
    if (followedDids.has(blockedDid)) {
      const user = cache.followedUsers.find((u) => u.did === blockedDid);
      if (user) {
        blocking.push(user);
      }
    }
  }
  return { blockedBy, blocking };
}
async function clearAllData() {
  await chrome.storage.local.clear();
}
export {
  clearAllData,
  createEmptyCache,
  getBlockCache,
  getStoredAuth,
  getSyncStatus,
  lookupBlockingInfo,
  saveBlockCache,
  storeAuth,
  updateSyncStatus,
  updateUserBlockCache
};
