/**
 * AskBeeves - Service worker background script
 * Handles periodic sync, message processing, and block list caching
 *
 * Uses bloom filters for space-efficient storage with on-demand verification
 */

import { getAllFollows, getUserBlocks, chunk, sleep } from './api.js';
import {
  getBlockCache,
  saveBlockCache,
  createEmptyCache,
  getStoredAuth,
  storeAuth,
  lookupBlockingInfo,
  getCandidateBlockers,
  updateSyncStatus,
  getSyncStatus,
} from './storage.js';
import { bloomFilterFromArray } from './bloom.js';
import { Message, MessageResponse, UserBlockBloomCache } from './types.js';

const ALARM_NAME = 'performFullSync';
const SYNC_INTERVAL_MINUTES = 60;
const RATE_LIMIT_CONCURRENT = 5;
const RATE_LIMIT_DELAY_MS = 500;
const STALE_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes - if isRunning but no update, assume stuck
const MAX_CACHE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB - leave buffer under 10MB limit

/**
 * Estimate the size of an object in bytes (rough approximation)
 */
function estimateObjectSize(obj: unknown): number {
  return new Blob([JSON.stringify(obj)]).size;
}

/**
 * Prune cache to fit within size limit by removing oldest entries first
 * (with bloom filters, all entries are roughly similar size)
 */
function pruneCache(cache: {
  followedUsers: Array<{ did: string; handle: string; displayName?: string; avatar?: string }>;
  userBlockCaches: Record<string, UserBlockBloomCache>;
  lastFullSync: number;
  currentUserDid: string;
}): void {
  // Get users sorted by lastSynced (oldest first)
  const usersByAge = Object.entries(cache.userBlockCaches)
    .map(([did, data]) => ({ did, lastSynced: data.lastSynced }))
    .sort((a, b) => a.lastSynced - b.lastSynced);

  let currentSize = estimateObjectSize(cache);
  let prunedCount = 0;

  // Remove oldest entries until we're under the limit
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

/**
 * Safely save block cache, handling quota errors by pruning
 */
async function safeSaveBlockCache(cache: {
  followedUsers: Array<{ did: string; handle: string; displayName?: string; avatar?: string }>;
  userBlockCaches: Record<string, UserBlockBloomCache>;
  lastFullSync: number;
  currentUserDid: string;
}): Promise<boolean> {
  try {
    await saveBlockCache(cache);
    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('QUOTA_BYTES') || errorMsg.includes('quota')) {
      console.log('[AskBeeves BG] Quota exceeded, pruning cache...');
      pruneCache(cache);
      try {
        await saveBlockCache(cache);
        console.log('[AskBeeves BG] Successfully saved pruned cache');
        return true;
      } catch (retryError) {
        console.error('[AskBeeves BG] Failed to save even after pruning:', retryError);
        return false;
      }
    }
    throw error;
  }
}

/**
 * Perform a full sync: fetch all follows, then batch-fetch their block lists
 */
async function performFullSync(): Promise<void> {
  console.log('[AskBeeves BG] Starting full sync...');

  const syncStatus = await getSyncStatus();
  if (syncStatus.isRunning) {
    // Check if the lock is stale (service worker may have been killed mid-sync)
    const timeSinceUpdate = Date.now() - (syncStatus.lastUpdated || 0);
    if (timeSinceUpdate < STALE_LOCK_TIMEOUT_MS) {
      console.log('[AskBeeves BG] Sync already in progress, skipping');
      return;
    }
    console.log(`[AskBeeves BG] Stale lock detected (${Math.round(timeSinceUpdate / 1000)}s old), resetting...`);
    await updateSyncStatus({ isRunning: false });
  }

  try {
    // Get auth from storage
    const auth = await getStoredAuth();
    if (!auth?.did) {
      console.log('[AskBeeves BG] No auth available, skipping sync');
      return;
    }

    await updateSyncStatus({
      isRunning: true,
      errors: [],
      syncedFollows: 0,
    });

    // Get current block cache
    let cache = await getBlockCache();
    if (!cache || cache.currentUserDid !== auth.did) {
      cache = createEmptyCache(auth.did);
    }

    // Proactively prune if cache is already too large
    const initialSize = estimateObjectSize(cache);
    if (initialSize > MAX_CACHE_SIZE_BYTES * 0.9) {
      console.log(`[AskBeeves BG] Cache size (${Math.round(initialSize / 1024 / 1024)}MB) approaching limit, pruning...`);
      pruneCache(cache);
      await safeSaveBlockCache(cache);
    }

    // Fetch all follows
    console.log('[AskBeeves BG] Fetching all follows...');
    const follows = await getAllFollows(auth.did);
    cache.followedUsers = follows;

    console.log(`[AskBeeves BG] Got ${follows.length} follows, fetching block lists...`);

    // Batch fetch block lists with rate limiting
    const chunks = chunk(follows, RATE_LIMIT_CONCURRENT);
    let syncedCount = 0;
    const errors: string[] = [];

    // Save every N batches to avoid quota issues
    const SAVE_INTERVAL = 10;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk_arr = chunks[chunkIndex];

      // Fetch blocks in parallel within this chunk
      const blockPromises = chunk_arr.map(async (user) => {
        try {
          let blocks = await getUserBlocks(user.did);
          if (!Array.isArray(blocks)) {
            blocks = [];
          }

          // Only store if user has blocks (saves space - most users have 0 blocks)
          if (blocks.length > 0) {
            // Create bloom filter instead of storing full block list
            const bloomFilter = bloomFilterFromArray(blocks);

            const userCache: UserBlockBloomCache = {
              did: user.did,
              handle: user.handle,
              displayName: user.displayName,
              avatar: user.avatar,
              bloomFilter,
              blockCount: blocks.length,
              lastSynced: Date.now(),
            };

            cache!.userBlockCaches[user.did] = userCache;
          }

          syncedCount++;

          await updateSyncStatus({
            syncedFollows: syncedCount,
            totalFollows: follows.length,
          });

          console.log(
            `[AskBeeves BG] Synced blocks for ${user.handle} (${syncedCount}/${follows.length})${blocks.length > 0 ? ` - ${blocks.length} blocks (bloom)` : ''}`
          );
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Failed to sync ${user.handle}: ${errorMsg}`);
          console.error(`[AskBeeves BG] Error syncing ${user.handle}:`, error);
        }
      });

      await Promise.all(blockPromises);

      // Save incrementally to avoid quota issues
      if ((chunkIndex + 1) % SAVE_INTERVAL === 0 || chunkIndex === chunks.length - 1) {
        cache.lastFullSync = Date.now();
        const saved = await safeSaveBlockCache(cache);
        if (saved) {
          console.log(`[AskBeeves BG] Saved cache (batch ${chunkIndex + 1}/${chunks.length})`);
        } else {
          console.error('[AskBeeves BG] Failed to save cache after pruning');
        }
      }

      // Add delay between batches (except after the last one)
      if (chunkIndex < chunks.length - 1) {
        await sleep(RATE_LIMIT_DELAY_MS);
      }
    }

    await updateSyncStatus({
      isRunning: false,
      lastSync: Date.now(),
      syncedFollows: syncedCount,
      totalFollows: follows.length,
      errors,
    });

    console.log('[AskBeeves BG] Full sync complete');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AskBeeves BG] Sync error:', error);
    await updateSyncStatus({
      isRunning: false,
      errors: [errorMsg],
    });
  }
}

/**
 * Setup the periodic sync alarm
 */
async function setupAlarm(): Promise<void> {
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: SYNC_INTERVAL_MINUTES,
  });
  console.log(`[AskBeeves BG] Alarm set to ${SYNC_INTERVAL_MINUTES} minutes`);
}

/**
 * Handle incoming messages from content script
 */
function handleMessage(
  message: Message,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
): boolean {
  console.log('[AskBeeves BG] Received message:', message.type);

  // Handle async messages that need to return true
  if (message.type === 'TRIGGER_SYNC') {
    performFullSync()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        sendResponse({ success: false, error: errorMsg });
      });
    return true; // Indicates async response
  }

  // Handle all other messages asynchronously
  handleSyncMessage(message, sendResponse);
  return true; // Keep channel open for async response
}

/**
 * Handle synchronous messages
 */
async function handleSyncMessage(
  message: Message,
  sendResponse: (response: MessageResponse) => void
): Promise<void> {
  try {
    switch (message.type) {
      case 'SET_AUTH': {
        if (message.auth) {
          const existingAuth = await getStoredAuth();
          await storeAuth(message.auth);
          console.log('[AskBeeves BG] Auth stored');

          // Check if we need to sync
          const cache = await getBlockCache();
          const cacheIsEmpty = !cache || cache.followedUsers.length === 0;
          const isNewUser = !existingAuth || existingAuth.did !== message.auth.did;
          // Also sync if we have follows but very few block caches (incomplete sync)
          const blockCacheCount = cache ? Object.keys(cache.userBlockCaches).length : 0;
          const cacheIncomplete =
            cache && cache.followedUsers.length > 100 && blockCacheCount < cache.followedUsers.length * 0.05;

          if (isNewUser || cacheIsEmpty || cacheIncomplete) {
            console.log(
              '[AskBeeves BG] Triggering sync:',
              isNewUser ? 'new user' : cacheIsEmpty ? 'empty cache' : 'incomplete cache'
            );
            performFullSync(); // Fire and forget
          } else {
            console.log(
              `[AskBeeves BG] Skipping sync - cache looks complete (${blockCacheCount} block caches for ${cache?.followedUsers.length} follows)`
            );
          }
        }
        sendResponse({ success: true });
        break;
      }

      case 'GET_BLOCKING_INFO': {
        if (!message.profileDid) {
          sendResponse({ success: false, error: 'Missing profileDid' });
          break;
        }
        const cache = await getBlockCache();
        const cacheCount = cache ? Object.keys(cache.userBlockCaches).length : 0;
        const totalBlocks = cache
          ? Object.values(cache.userBlockCaches).reduce((sum, uc) => sum + (uc.blockCount || 0), 0)
          : 0;
        console.log(
          '[AskBeeves BG] Cache state:',
          cache
            ? `${cache.followedUsers.length} follows, ${cacheCount} bloom filters, ${totalBlocks} total blocks indexed`
            : 'empty'
        );

        // Get candidate blockers from bloom filters (may have false positives - that's OK)
        // We skip verification here for speed - verification happens on click
        const candidates = await getCandidateBlockers(message.profileDid);
        console.log(`[AskBeeves BG] Bloom filter candidates: ${candidates.length} users might block this profile`);

        // Fetch viewed profile's blocks (for "blocking" relationship)
        const profileBlocks = await getUserBlocks(message.profileDid).catch((error) => {
          console.log('[AskBeeves BG] Could not fetch profile blocks:', error);
          return [] as string[];
        });

        console.log(`[AskBeeves BG] Fetched ${profileBlocks.length} blocks for viewed profile`);

        // Build blocking info using bloom filter candidates directly (unverified)
        // The "blockedBy" list may have false positives, but that's fine for display counts
        const blockingInfo = await lookupBlockingInfo(
          message.profileDid,
          candidates.map((c) => c.did), // Use candidate DIDs directly
          profileBlocks
        );
        console.log(
          '[AskBeeves BG] Blocking info for',
          message.profileDid,
          ':',
          blockingInfo.blockedBy.length,
          'blockedBy (unverified),',
          blockingInfo.blocking.length,
          'blocking'
        );

        sendResponse({ success: true, blockingInfo });
        break;
      }

      case 'GET_VERIFIED_BLOCKERS': {
        // Verify bloom filter candidates by fetching actual block lists
        // Called when user clicks to see the full list
        if (!message.profileDid || !message.candidateDids) {
          sendResponse({ success: false, error: 'Missing profileDid or candidateDids' });
          break;
        }

        console.log(`[AskBeeves BG] Verifying ${message.candidateDids.length} candidates...`);

        const cache = await getBlockCache();
        const verifiedBlockers: Array<{ did: string; handle: string; displayName?: string; avatar?: string }> = [];

        // Verify each candidate in parallel
        await Promise.all(
          message.candidateDids.map(async (candidateDid) => {
            try {
              const blocks = await getUserBlocks(candidateDid);
              if (blocks.includes(message.profileDid!)) {
                // Find the user info from cache
                const userCache = cache?.userBlockCaches[candidateDid];
                const followedUser = cache?.followedUsers.find((u) => u.did === candidateDid);
                verifiedBlockers.push({
                  did: candidateDid,
                  handle: userCache?.handle || followedUser?.handle || candidateDid,
                  displayName: userCache?.displayName || followedUser?.displayName,
                  avatar: userCache?.avatar || followedUser?.avatar,
                });
                console.log(`[AskBeeves BG] Verified: ${userCache?.handle || candidateDid} blocks this profile`);
              } else {
                console.log(`[AskBeeves BG] False positive: ${candidateDid}`);
              }
            } catch (error) {
              console.log(`[AskBeeves BG] Could not verify ${candidateDid}:`, error);
            }
          })
        );

        console.log(`[AskBeeves BG] Verified ${verifiedBlockers.length}/${message.candidateDids.length} actual blockers`);
        sendResponse({ success: true, verifiedBlockers });
        break;
      }

      case 'FETCH_PROFILE_BLOCKS': {
        if (!message.profileDid) {
          sendResponse({ success: false, error: 'Missing profileDid' });
          break;
        }
        try {
          const blocks = await getUserBlocks(message.profileDid);
          sendResponse({ success: true, blocks });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          sendResponse({ success: false, error: errorMsg });
        }
        break;
      }

      case 'GET_SYNC_STATUS': {
        const syncStatus = await getSyncStatus();
        sendResponse({ success: true, syncStatus });
        break;
      }

      case 'CLEAR_CACHE': {
        console.log('[AskBeeves BG] Clearing cache and resetting sync status...');
        // Clear cache
        await saveBlockCache(createEmptyCache(''));
        // Reset sync status including isRunning flag
        await updateSyncStatus({
          totalFollows: 0,
          syncedFollows: 0,
          lastSync: 0,
          isRunning: false,
          errors: [],
        });
        console.log('[AskBeeves BG] Cache cleared, triggering full sync...');
        // Small delay to ensure status is saved before sync checks it
        await new Promise((resolve) => setTimeout(resolve, 100));
        performFullSync(); // Fire and forget
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AskBeeves BG] Message handler error:', error);
    sendResponse({ success: false, error: errorMsg });
  }
}

/**
 * Initialize on install/startup
 */
function initializeExtension(): void {
  console.log('[AskBeeves BG] Initializing extension');
  setupAlarm();

  // Sync auth from content script
  chrome.runtime.onMessage.addListener(handleMessage);

  // Set up alarm listener
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      console.log('[AskBeeves BG] Alarm triggered, starting sync');
      performFullSync();
    }
  });
}

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('[AskBeeves BG] Extension installed');
  initializeExtension();
});

// Initialize on startup
chrome.runtime.onStartup.addListener(() => {
  console.log('[AskBeeves BG] Extension started');
  initializeExtension();
});

// Initialize on load (in case background script is already running)
initializeExtension();
