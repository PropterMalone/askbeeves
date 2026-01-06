/**
 * AskBeeves - Browser storage helpers
 * Works with both Chrome and Firefox via abstraction layer
 */

import { storage } from './browser.js';
import {
  BlockCacheData,
  SyncStatus,
  BlockingInfo,
  FollowedUser,
  UserBlockCache,
  UserSettings,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  BskySession,
} from './types.js';

/**
 * Get cached block data from storage
 */
export async function getBlockCache(): Promise<BlockCacheData | null> {
  const result = await storage.local.get(STORAGE_KEYS.BLOCK_CACHE);
  const data = result[STORAGE_KEYS.BLOCK_CACHE] as BlockCacheData | undefined;
  return data || null;
}

/**
 * Save block cache to storage
 */
export async function saveBlockCache(data: BlockCacheData): Promise<void> {
  await storage.local.set({ [STORAGE_KEYS.BLOCK_CACHE]: data });
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
  const result = await storage.local.get(STORAGE_KEYS.SYNC_STATUS);
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
  await storage.local.set({
    [STORAGE_KEYS.SYNC_STATUS]: { ...current, ...status, lastUpdated: Date.now() },
  });
}

/**
 * Get stored auth token
 */
export async function getStoredAuth(): Promise<BskySession | null> {
  const result = await storage.local.get(STORAGE_KEYS.AUTH_TOKEN);
  const data = result[STORAGE_KEYS.AUTH_TOKEN] as BskySession | undefined;
  return data || null;
}

/**
 * Store auth token
 */
export async function storeAuth(auth: BskySession): Promise<void> {
  await storage.local.set({ [STORAGE_KEYS.AUTH_TOKEN]: auth });
}

/**
 * Get blockers for a profile from cache (exact lookup, no false positives)
 * Returns users you follow who have this profileDid in their block list
 * @param profileDid - The DID to check for blocks against
 * @param cache - Optional pre-fetched cache to avoid redundant storage reads
 */
export async function getBlockers(
  profileDid: string,
  cache?: BlockCacheData | null
): Promise<FollowedUser[]> {
  const blockCache = cache ?? (await getBlockCache());
  if (!blockCache) {
    return [];
  }

  const blockers: FollowedUser[] = [];

  for (const user of blockCache.followedUsers) {
    const userCache = blockCache.userBlockCaches[user.did];
    if (!userCache?.blocks?.length) continue;

    // Use Set for O(1) lookup when block list is large
    const hasBlock =
      userCache.blocks.length > 20
        ? new Set(userCache.blocks).has(profileDid)
        : userCache.blocks.includes(profileDid);

    if (hasBlock) {
      blockers.push({
        did: user.did,
        handle: userCache.handle || user.handle,
        displayName: userCache.displayName || user.displayName,
        avatar: userCache.avatar || user.avatar,
      });
    }
  }

  return blockers;
}

/**
 * Look up blocking info for a specific profile DID
 * Returns users you follow who block this profile, and users you follow that this profile blocks
 * @param profileDid - The DID of the profile being viewed
 * @param profileBlocks - Pre-fetched blocks for this profile (for "blocking" relationship)
 */
export async function lookupBlockingInfo(
  profileDid: string,
  profileBlocks: string[]
): Promise<BlockingInfo> {
  const cache = await getBlockCache();
  if (!cache) {
    return { blockedBy: [], blocking: [] };
  }

  // Get blockers (users you follow who block this profile) - pass cache to avoid refetch
  const blockedBy = await getBlockers(profileDid, cache);

  // Build a Map for O(1) user lookup by DID
  const followedByDid = new Map(cache.followedUsers.map((u) => [u.did, u]));

  // Find users you follow that this profile blocks
  const blocking: FollowedUser[] = [];
  for (const blockedDid of profileBlocks) {
    const user = followedByDid.get(blockedDid);
    if (user) {
      blocking.push(user);
    }
  }

  return { blockedBy, blocking };
}

/**
 * Get user settings
 */
export async function getSettings(): Promise<UserSettings> {
  const result = await storage.sync.get(STORAGE_KEYS.SETTINGS);
  const data = result[STORAGE_KEYS.SETTINGS] as UserSettings | undefined;
  return data || DEFAULT_SETTINGS;
}

/**
 * Save user settings
 */
export async function saveSettings(settings: UserSettings): Promise<void> {
  await storage.sync.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

/**
 * Clear all extension data
 */
export async function clearAllData(): Promise<void> {
  await storage.local.clear();
}
