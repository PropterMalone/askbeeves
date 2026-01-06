/**
 * AskBeeves - Chrome storage helpers
 */

import {
  BlockCacheData,
  SyncStatus,
  BlockingInfo,
  FollowedUser,
  UserBlockCache,
  STORAGE_KEYS,
  BskySession,
} from './types.js';

/**
 * Get cached block data from storage
 */
export async function getBlockCache(): Promise<BlockCacheData | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.BLOCK_CACHE);
  const data = result[STORAGE_KEYS.BLOCK_CACHE] as BlockCacheData | undefined;
  return data || null;
}

/**
 * Save block cache to storage
 */
export async function saveBlockCache(data: BlockCacheData): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.BLOCK_CACHE]: data });
}

/**
 * Create an empty block cache
 */
export function createEmptyCache(currentUserDid: string): BlockCacheData {
  return {
    followedUsers: [],
    userBlockCaches: {},
    lastFullSync: 0,
    currentUserDid,
  };
}

/**
 * Update a single user's block cache
 */
export async function updateUserBlockCache(userCache: UserBlockCache): Promise<void> {
  const cache = await getBlockCache();
  if (!cache) return;

  cache.userBlockCaches[userCache.did] = userCache;
  await saveBlockCache(cache);
}

/**
 * Get sync status
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SYNC_STATUS);
  const data = result[STORAGE_KEYS.SYNC_STATUS] as SyncStatus | undefined;
  return (
    data || {
      totalFollows: 0,
      syncedFollows: 0,
      lastSync: 0,
      isRunning: false,
      lastUpdated: 0,
      errors: [],
    }
  );
}

/**
 * Update sync status (always updates lastUpdated timestamp)
 */
export async function updateSyncStatus(status: Partial<SyncStatus>): Promise<void> {
  const current = await getSyncStatus();
  await chrome.storage.local.set({
    [STORAGE_KEYS.SYNC_STATUS]: { ...current, ...status, lastUpdated: Date.now() },
  });
}

/**
 * Get stored auth token
 */
export async function getStoredAuth(): Promise<BskySession | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.AUTH_TOKEN);
  const data = result[STORAGE_KEYS.AUTH_TOKEN] as BskySession | undefined;
  return data || null;
}

/**
 * Store auth token
 */
export async function storeAuth(auth: BskySession): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.AUTH_TOKEN]: auth });
}

/**
 * Look up blocking info for a specific profile DID
 * Returns users you follow who block this profile, and users you follow that this profile blocks
 * @param profileDid - The DID of the profile being viewed
 * @param profileBlocks - Optional pre-fetched blocks for this profile (for "blocking" relationship)
 */
export async function lookupBlockingInfo(
  profileDid: string,
  profileBlocks?: string[]
): Promise<BlockingInfo> {
  const cache = await getBlockCache();
  if (!cache) {
    return { blockedBy: [], blocking: [] };
  }

  const blockedBy: FollowedUser[] = [];
  const blocking: FollowedUser[] = [];

  // Build a set of followed DIDs for quick lookup
  const followedDids = new Set(cache.followedUsers.map((u) => u.did));

  // Find users you follow who block this profile
  for (const user of cache.followedUsers) {
    const userBlocks = cache.userBlockCaches[user.did];
    if (userBlocks && userBlocks.blocks.includes(profileDid)) {
      // Use avatar from cache if available (more up-to-date)
      blockedBy.push({
        did: user.did,
        handle: userBlocks.handle || user.handle,
        displayName: userBlocks.displayName || user.displayName,
        avatar: userBlocks.avatar || user.avatar,
      });
    }
  }

  // Find users you follow that this profile blocks
  // Use provided profileBlocks if available, otherwise check cache
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

/**
 * Clear all extension data
 */
export async function clearAllData(): Promise<void> {
  await chrome.storage.local.clear();
}
