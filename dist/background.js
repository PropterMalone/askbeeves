// src/api.ts
var BSKY_PUBLIC_API = "https://public.api.bsky.app";
var BSKY_PDS_DEFAULT = "https://bsky.social";
var PLC_DIRECTORY = "https://plc.directory";
async function resolvePds(did) {
  try {
    if (!did.startsWith("did:plc:")) {
      return null;
    }
    const response = await fetch(`${PLC_DIRECTORY}/${did}`);
    if (!response.ok) return null;
    const doc = await response.json();
    const pds = doc.service?.find((s) => s.id === "#atproto_pds");
    return pds?.serviceEndpoint || null;
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
async function getFollows(did, cursor) {
  const params = new URLSearchParams({
    actor: did,
    limit: "100"
  });
  if (cursor) params.set("cursor", cursor);
  const url = `${BSKY_PUBLIC_API}/xrpc/app.bsky.graph.getFollows?${params}`;
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`Failed to get follows: ${response.status}`);
  }
  const data = await response.json();
  return {
    follows: data.follows.map((f) => ({
      did: f.did,
      handle: f.handle,
      displayName: f.displayName,
      avatar: f.avatar
    })),
    cursor: data.cursor
  };
}
async function getAllFollows(did) {
  const allFollows = [];
  let cursor;
  do {
    const result = await getFollows(did, cursor);
    allFollows.push(...result.follows);
    cursor = result.cursor;
    if (cursor) await sleep(100);
  } while (cursor);
  return allFollows;
}
async function getUserBlocks(did, pdsUrl) {
  const blocks = [];
  let pds = pdsUrl;
  if (!pds) {
    pds = await resolvePds(did);
  }
  if (!pds) {
    pds = BSKY_PDS_DEFAULT;
  }
  pds = pds.replace(/\/+$/, "");
  let cursor;
  do {
    const params = new URLSearchParams({
      repo: did,
      collection: "app.bsky.graph.block",
      limit: "100"
    });
    if (cursor) params.set("cursor", cursor);
    const url = `${pds}/xrpc/com.atproto.repo.listRecords?${params}`;
    const response = await fetchWithRetry(url);
    if (!response.ok) {
      return blocks;
    }
    const data = await response.json();
    for (const record of data.records || []) {
      if (record.value?.subject) {
        blocks.push(record.value.subject);
      }
    }
    cursor = data.cursor;
  } while (cursor);
  return blocks;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// src/types.ts
var STORAGE_KEYS = {
  BLOCK_CACHE: "blockCache",
  SYNC_STATUS: "syncStatus",
  AUTH_TOKEN: "authToken"
};

// src/bloom.ts
var DEFAULT_BITS_PER_ELEMENT = 10;
var DEFAULT_NUM_HASHES = 7;
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
function createBloomFilter(expectedElements, bitsPerElement = DEFAULT_BITS_PER_ELEMENT, numHashes = DEFAULT_NUM_HASHES) {
  const size = Math.max(64, Math.ceil(expectedElements * bitsPerElement));
  const byteSize = Math.ceil(size / 8);
  const bytes = new Uint8Array(byteSize);
  return {
    bits: uint8ArrayToBase64(bytes),
    size,
    numHashes,
    count: 0
  };
}
function bloomFilterFromArray(items, bitsPerElement = DEFAULT_BITS_PER_ELEMENT, numHashes = DEFAULT_NUM_HASHES) {
  const filter = createBloomFilter(items.length, bitsPerElement, numHashes);
  for (const item of items) {
    bloomFilterAdd(filter, item);
  }
  return filter;
}
function bloomFilterAdd(filter, item) {
  const bytes = base64ToUint8Array(filter.bits);
  const hashes = getHashValues(item, filter.numHashes, filter.size);
  for (const hash of hashes) {
    const byteIndex = Math.floor(hash / 8);
    const bitIndex = hash % 8;
    bytes[byteIndex] |= 1 << bitIndex;
  }
  filter.bits = uint8ArrayToBase64(bytes);
  filter.count++;
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
function uint8ArrayToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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

// src/background.ts
var ALARM_NAME = "performFullSync";
var SYNC_INTERVAL_MINUTES = 60;
var RATE_LIMIT_CONCURRENT = 5;
var RATE_LIMIT_DELAY_MS = 500;
var STALE_LOCK_TIMEOUT_MS = 5 * 60 * 1e3;
var MAX_CACHE_SIZE_BYTES = 8 * 1024 * 1024;
function estimateObjectSize(obj) {
  return new Blob([JSON.stringify(obj)]).size;
}
function pruneCache(cache) {
  const usersByAge = Object.entries(cache.userBlockCaches).map(([did, data]) => ({ did, lastSynced: data.lastSynced })).sort((a, b) => a.lastSynced - b.lastSynced);
  let currentSize = estimateObjectSize(cache);
  let prunedCount = 0;
  for (const { did } of usersByAge) {
    if (currentSize <= MAX_CACHE_SIZE_BYTES) break;
    const removedSize = estimateObjectSize(cache.userBlockCaches[did]);
    delete cache.userBlockCaches[did];
    currentSize -= removedSize;
    prunedCount++;
  }
  if (prunedCount > 0) {
    console.log(`[AskBeeves BG] Pruned ${prunedCount} users from cache to fit size limit`);
  }
}
async function safeSaveBlockCache(cache) {
  try {
    await saveBlockCache(cache);
    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes("QUOTA_BYTES") || errorMsg.includes("quota")) {
      console.log("[AskBeeves BG] Quota exceeded, pruning cache...");
      pruneCache(cache);
      try {
        await saveBlockCache(cache);
        console.log("[AskBeeves BG] Successfully saved pruned cache");
        return true;
      } catch (retryError) {
        console.error("[AskBeeves BG] Failed to save even after pruning:", retryError);
        return false;
      }
    }
    throw error;
  }
}
async function performFullSync() {
  console.log("[AskBeeves BG] Starting full sync...");
  const syncStatus = await getSyncStatus();
  if (syncStatus.isRunning) {
    const timeSinceUpdate = Date.now() - (syncStatus.lastUpdated || 0);
    if (timeSinceUpdate < STALE_LOCK_TIMEOUT_MS) {
      console.log("[AskBeeves BG] Sync already in progress, skipping");
      return;
    }
    console.log(`[AskBeeves BG] Stale lock detected (${Math.round(timeSinceUpdate / 1e3)}s old), resetting...`);
    await updateSyncStatus({ isRunning: false });
  }
  try {
    const auth = await getStoredAuth();
    if (!auth?.did) {
      console.log("[AskBeeves BG] No auth available, skipping sync");
      return;
    }
    await updateSyncStatus({
      isRunning: true,
      errors: [],
      syncedFollows: 0
    });
    let cache = await getBlockCache();
    if (!cache || cache.currentUserDid !== auth.did) {
      cache = createEmptyCache(auth.did);
    }
    const initialSize = estimateObjectSize(cache);
    if (initialSize > MAX_CACHE_SIZE_BYTES * 0.9) {
      console.log(`[AskBeeves BG] Cache size (${Math.round(initialSize / 1024 / 1024)}MB) approaching limit, pruning...`);
      pruneCache(cache);
      await safeSaveBlockCache(cache);
    }
    console.log("[AskBeeves BG] Fetching all follows...");
    const follows = await getAllFollows(auth.did);
    cache.followedUsers = follows;
    console.log(`[AskBeeves BG] Got ${follows.length} follows, fetching block lists...`);
    const chunks = chunk(follows, RATE_LIMIT_CONCURRENT);
    let syncedCount = 0;
    const errors = [];
    const SAVE_INTERVAL = 10;
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk_arr = chunks[chunkIndex];
      const blockPromises = chunk_arr.map(async (user) => {
        try {
          let blocks = await getUserBlocks(user.did);
          if (!Array.isArray(blocks)) {
            blocks = [];
          }
          if (blocks.length > 0) {
            const bloomFilter = bloomFilterFromArray(blocks);
            const userCache = {
              did: user.did,
              handle: user.handle,
              displayName: user.displayName,
              avatar: user.avatar,
              bloomFilter,
              blockCount: blocks.length,
              lastSynced: Date.now()
            };
            cache.userBlockCaches[user.did] = userCache;
          }
          syncedCount++;
          await updateSyncStatus({
            syncedFollows: syncedCount,
            totalFollows: follows.length
          });
          console.log(
            `[AskBeeves BG] Synced blocks for ${user.handle} (${syncedCount}/${follows.length})${blocks.length > 0 ? ` - ${blocks.length} blocks (bloom)` : ""}`
          );
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          errors.push(`Failed to sync ${user.handle}: ${errorMsg}`);
          console.error(`[AskBeeves BG] Error syncing ${user.handle}:`, error);
        }
      });
      await Promise.all(blockPromises);
      if ((chunkIndex + 1) % SAVE_INTERVAL === 0 || chunkIndex === chunks.length - 1) {
        cache.lastFullSync = Date.now();
        const saved = await safeSaveBlockCache(cache);
        if (saved) {
          console.log(`[AskBeeves BG] Saved cache (batch ${chunkIndex + 1}/${chunks.length})`);
        } else {
          console.error("[AskBeeves BG] Failed to save cache after pruning");
        }
      }
      if (chunkIndex < chunks.length - 1) {
        await sleep(RATE_LIMIT_DELAY_MS);
      }
    }
    await updateSyncStatus({
      isRunning: false,
      lastSync: Date.now(),
      syncedFollows: syncedCount,
      totalFollows: follows.length,
      errors
    });
    console.log("[AskBeeves BG] Full sync complete");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[AskBeeves BG] Sync error:", error);
    await updateSyncStatus({
      isRunning: false,
      errors: [errorMsg]
    });
  }
}
async function setupAlarm() {
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: SYNC_INTERVAL_MINUTES
  });
  console.log(`[AskBeeves BG] Alarm set to ${SYNC_INTERVAL_MINUTES} minutes`);
}
function handleMessage(message, _sender, sendResponse) {
  console.log("[AskBeeves BG] Received message:", message.type);
  if (message.type === "TRIGGER_SYNC") {
    performFullSync().then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      sendResponse({ success: false, error: errorMsg });
    });
    return true;
  }
  handleSyncMessage(message, sendResponse);
  return true;
}
async function handleSyncMessage(message, sendResponse) {
  try {
    switch (message.type) {
      case "SET_AUTH": {
        if (message.auth) {
          const existingAuth = await getStoredAuth();
          await storeAuth(message.auth);
          console.log("[AskBeeves BG] Auth stored");
          const cache = await getBlockCache();
          const cacheIsEmpty = !cache || cache.followedUsers.length === 0;
          const isNewUser = !existingAuth || existingAuth.did !== message.auth.did;
          const blockCacheCount = cache ? Object.keys(cache.userBlockCaches).length : 0;
          const cacheIncomplete = cache && cache.followedUsers.length > 100 && blockCacheCount < cache.followedUsers.length * 0.05;
          if (isNewUser || cacheIsEmpty || cacheIncomplete) {
            console.log(
              "[AskBeeves BG] Triggering sync:",
              isNewUser ? "new user" : cacheIsEmpty ? "empty cache" : "incomplete cache"
            );
            performFullSync();
          } else {
            console.log(
              `[AskBeeves BG] Skipping sync - cache looks complete (${blockCacheCount} block caches for ${cache?.followedUsers.length} follows)`
            );
          }
        }
        sendResponse({ success: true });
        break;
      }
      case "GET_BLOCKING_INFO": {
        if (!message.profileDid) {
          sendResponse({ success: false, error: "Missing profileDid" });
          break;
        }
        const cache = await getBlockCache();
        const cacheCount = cache ? Object.keys(cache.userBlockCaches).length : 0;
        console.log(
          "[AskBeeves BG] Cache state:",
          cache ? `${cache.followedUsers.length} follows, ${cacheCount} bloom filters` : "empty"
        );
        const candidates = await getCandidateBlockers(message.profileDid);
        console.log(`[AskBeeves BG] Bloom filter candidates: ${candidates.length} users might block this profile`);
        const verifiedBlockers = [];
        if (candidates.length > 0) {
          console.log(`[AskBeeves BG] Verifying ${candidates.length} candidates...`);
          const verifyPromises = candidates.map(async (candidate) => {
            try {
              const blocks = await getUserBlocks(candidate.did);
              if (blocks.includes(message.profileDid)) {
                verifiedBlockers.push(candidate.did);
                console.log(`[AskBeeves BG] Verified: ${candidate.handle} blocks this profile`);
              } else {
                console.log(`[AskBeeves BG] False positive: ${candidate.handle} doesn't actually block`);
              }
            } catch (error) {
              console.log(`[AskBeeves BG] Could not verify ${candidate.handle}:`, error);
            }
          });
          await Promise.all(verifyPromises);
          console.log(`[AskBeeves BG] Verified ${verifiedBlockers.length}/${candidates.length} actual blockers`);
        }
        let profileBlocks = [];
        try {
          profileBlocks = await getUserBlocks(message.profileDid);
          console.log(`[AskBeeves BG] Fetched ${profileBlocks.length} blocks for viewed profile`);
        } catch (error) {
          console.log("[AskBeeves BG] Could not fetch profile blocks:", error);
        }
        const blockingInfo = await lookupBlockingInfo(message.profileDid, verifiedBlockers, profileBlocks);
        console.log(
          "[AskBeeves BG] Blocking info for",
          message.profileDid,
          ":",
          blockingInfo.blockedBy.length,
          "blockedBy,",
          blockingInfo.blocking.length,
          "blocking"
        );
        sendResponse({ success: true, blockingInfo });
        break;
      }
      case "FETCH_PROFILE_BLOCKS": {
        if (!message.profileDid) {
          sendResponse({ success: false, error: "Missing profileDid" });
          break;
        }
        try {
          const blocks = await getUserBlocks(message.profileDid);
          sendResponse({ success: true, blocks });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          sendResponse({ success: false, error: errorMsg });
        }
        break;
      }
      case "GET_SYNC_STATUS": {
        const syncStatus = await getSyncStatus();
        sendResponse({ success: true, syncStatus });
        break;
      }
      case "CLEAR_CACHE": {
        console.log("[AskBeeves BG] Clearing cache and resetting sync status...");
        await saveBlockCache(createEmptyCache(""));
        await updateSyncStatus({
          totalFollows: 0,
          syncedFollows: 0,
          lastSync: 0,
          isRunning: false,
          errors: []
        });
        console.log("[AskBeeves BG] Cache cleared, triggering full sync...");
        await new Promise((resolve) => setTimeout(resolve, 100));
        performFullSync();
        sendResponse({ success: true });
        break;
      }
      default:
        sendResponse({ success: false, error: "Unknown message type" });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[AskBeeves BG] Message handler error:", error);
    sendResponse({ success: false, error: errorMsg });
  }
}
function initializeExtension() {
  console.log("[AskBeeves BG] Initializing extension");
  setupAlarm();
  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      console.log("[AskBeeves BG] Alarm triggered, starting sync");
      performFullSync();
    }
  });
}
chrome.runtime.onInstalled.addListener(() => {
  console.log("[AskBeeves BG] Extension installed");
  initializeExtension();
});
chrome.runtime.onStartup.addListener(() => {
  console.log("[AskBeeves BG] Extension started");
  initializeExtension();
});
initializeExtension();
