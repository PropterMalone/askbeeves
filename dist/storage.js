// src/types.ts
var STORAGE_KEYS = {
  BLOCK_CACHE: "blockCache",
  SYNC_STATUS: "syncStatus",
  AUTH_TOKEN: "authToken"
};

// src/bloom.ts
function fnv1a(str, seed = 0) {
  let hash = 2166136261 ^ seed;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function getHashValues(item, numHashes, size) {
  const h1 = fnv1a(item, 0);
  const h2 = fnv1a(item, h1);
  const hashes = [];
  for (let i = 0; i < numHashes; i++) {
    const hash = (h1 + i * h2) % size;
    hashes.push(Math.abs(hash));
  }
  return hashes;
}
function bloomFilterMightContain(filter, item) {
  const bytes = base64ToUint8Array(filter.bits);
  const hashes = getHashValues(item, filter.numHashes, filter.size);
  for (const hash of hashes) {
    const byteIndex = Math.floor(hash / 8);
    const bitIndex = hash % 8;
    if ((bytes[byteIndex] & 1 << bitIndex) === 0) {
      return false;
    }
  }
  return true;
}
function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

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
async function getCandidateBlockers(profileDid) {
  const cache = await getBlockCache();
  if (!cache) {
    return [];
  }
  const candidates = [];
  for (const user of cache.followedUsers) {
    const userCache = cache.userBlockCaches[user.did];
    if (userCache?.bloomFilter && bloomFilterMightContain(userCache.bloomFilter, profileDid)) {
      candidates.push({
        did: user.did,
        handle: userCache.handle || user.handle,
        displayName: userCache.displayName || user.displayName,
        avatar: userCache.avatar || user.avatar
      });
    }
  }
  return candidates;
}
async function lookupBlockingInfo(profileDid, verifiedBlockers, profileBlocks) {
  const cache = await getBlockCache();
  if (!cache) {
    return { blockedBy: [], blocking: [] };
  }
  const blockedBy = [];
  const blocking = [];
  const followedDids = new Set(cache.followedUsers.map((u) => u.did));
  const verifiedSet = new Set(verifiedBlockers);
  for (const user of cache.followedUsers) {
    if (verifiedSet.has(user.did)) {
      const userCache = cache.userBlockCaches[user.did];
      blockedBy.push({
        did: user.did,
        handle: userCache?.handle || user.handle,
        displayName: userCache?.displayName || user.displayName,
        avatar: userCache?.avatar || user.avatar
      });
    }
  }
  for (const blockedDid of profileBlocks) {
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
  getCandidateBlockers,
  getStoredAuth,
  getSyncStatus,
  lookupBlockingInfo,
  saveBlockCache,
  storeAuth,
  updateSyncStatus,
  updateUserBlockCache
};
