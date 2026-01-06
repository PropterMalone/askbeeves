/**
 * AskBeeves - Chrome storage helpers
 */

import {
  BlockCacheData,
  SyncStatus,
  BlockingInfo,
  FollowedUser,
  UserBlockBloomCache,
  UserSettings,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  BskySession,
} from './types.js';
import { bloomFilterMightContain, estimateFalsePositiveRate } from './bloom.js';

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
 * Update a single user's block cache (bloom filter version)
 */
export async function updateUserBlockCache(userCache: UserBlockBloomCache): Promise<void> {
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
 * Get candidate blockers using bloom filters (may include false positives)
 * Returns DIDs of followed users whose bloom filter indicates they MIGHT block the profile
 * These need to be verified by fetching actual block lists
 */
export async function getCandidateBlockers(profileDid: string): Promise<FollowedUser[]> {
  const cache = await getBlockCache();
  if (!cache) {
    console.log('[AskBeeves Storage] getCandidateBlockers: no cache');
    return [];
  }

  const candidates: FollowedUser[] = [];
  let usersWithBloomFilters = 0;
  let totalBlockCount = 0;
  let minBlocks = Infinity;
  let maxBlocks = 0;
  let totalFpRate = 0;
  let saturatedFilters = 0;

  for (const user of cache.followedUsers) {
    const userCache = cache.userBlockCaches[user.did];
    if (userCache?.bloomFilter) {
      usersWithBloomFilters++;
      totalBlockCount += userCache.blockCount || 0;
      minBlocks = Math.min(minBlocks, userCache.blockCount || 0);
      maxBlocks = Math.max(maxBlocks, userCache.blockCount || 0);

      // Check estimated FP rate
      const fpRate = estimateFalsePositiveRate(userCache.bloomFilter);
      totalFpRate += fpRate;
      if (fpRate > 0.5) {
        saturatedFilters++;
      }

      if (bloomFilterMightContain(userCache.bloomFilter, profileDid)) {
        candidates.push({
          did: user.did,
          handle: userCache.handle || user.handle,
          displayName: userCache.displayName || user.displayName,
          avatar: userCache.avatar || user.avatar,
        });
      }
    }
  }

  const avgBlocks = usersWithBloomFilters > 0 ? Math.round(totalBlockCount / usersWithBloomFilters) : 0;
  const avgFpRate = usersWithBloomFilters > 0 ? (totalFpRate / usersWithBloomFilters * 100).toFixed(1) : '0';
  const candidateRate = usersWithBloomFilters > 0 ? ((candidates.length / usersWithBloomFilters) * 100).toFixed(1) : '0';

  console.log(
    `[AskBeeves Storage] getCandidateBlockers: checked ${usersWithBloomFilters} bloom filters, found ${candidates.length} candidates (${candidateRate}%) for ${profileDid}`
  );
  console.log(
    `[AskBeeves Storage] Block stats: avg=${avgBlocks}, min=${minBlocks === Infinity ? 0 : minBlocks}, max=${maxBlocks}`
  );
  console.log(
    `[AskBeeves Storage] Bloom filter stats: avg FP rate=${avgFpRate}%, saturated (>50% FP)=${saturatedFilters}`
  );

  return candidates;
}

/**
 * Look up blocking info for a specific profile DID
 * Returns users you follow who block this profile, and users you follow that this profile blocks
 * @param profileDid - The DID of the profile being viewed
 * @param verifiedBlockers - DIDs of users verified to actually block this profile (from API fetch)
 * @param profileBlocks - Pre-fetched blocks for this profile (for "blocking" relationship)
 */
export async function lookupBlockingInfo(
  profileDid: string,
  verifiedBlockers: string[],
  profileBlocks: string[]
): Promise<BlockingInfo> {
  const cache = await getBlockCache();
  if (!cache) {
    return { blockedBy: [], blocking: [] };
  }

  const blockedBy: FollowedUser[] = [];
  const blocking: FollowedUser[] = [];

  // Build a set of followed DIDs for quick lookup
  const followedDids = new Set(cache.followedUsers.map((u) => u.did));

  // Convert verified blockers to FollowedUser objects
  const verifiedSet = new Set(verifiedBlockers);
  for (const user of cache.followedUsers) {
    if (verifiedSet.has(user.did)) {
      const userCache = cache.userBlockCaches[user.did];
      blockedBy.push({
        did: user.did,
        handle: userCache?.handle || user.handle,
        displayName: userCache?.displayName || user.displayName,
        avatar: userCache?.avatar || user.avatar,
      });
    }
  }

  // Find users you follow that this profile blocks
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

/**
 * Get user settings
 */
export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  const data = result[STORAGE_KEYS.SETTINGS] as UserSettings | undefined;
  return data || DEFAULT_SETTINGS;
}

/**
 * Save user settings
 */
export async function saveSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

/**
 * Clear all extension data
 */
export async function clearAllData(): Promise<void> {
  await chrome.storage.local.clear();
}
