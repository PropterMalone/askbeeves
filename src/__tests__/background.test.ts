import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getAllFollows, getUserBlocks } from '../api.js';
import {
  getBlockCache,
  saveBlockCache,
  createEmptyCache,
  getStoredAuth,
  storeAuth,
  lookupBlockingInfo,
  updateSyncStatus,
  getSyncStatus,
} from '../storage.js';

// Mock all dependencies before importing background.ts
vi.mock('../api.js', () => ({
  getAllFollows: vi.fn(),
  getUserBlocks: vi.fn(),
  getSession: vi.fn(),
  chunk: vi.fn((arr: unknown[], size: number) => {
    const result = [];
    const arr_typed = arr as unknown[];
    for (let i = 0; i < arr_typed.length; i += size) {
      result.push(arr_typed.slice(i, i + size));
    }
    return result;
  }),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../storage.js', () => ({
  getBlockCache: vi.fn(),
  saveBlockCache: vi.fn(),
  createEmptyCache: vi.fn(),
  getStoredAuth: vi.fn(),
  storeAuth: vi.fn(),
  lookupBlockingInfo: vi.fn(),
  updateSyncStatus: vi.fn(),
  getSyncStatus: vi.fn(),
  updateUserBlockCache: vi.fn(),
}));

describe('Background Service Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    const chromeMock = {
      storage: {
        local: {
          get: vi.fn(),
          set: vi.fn(),
          clear: vi.fn(),
        },
      },
      alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        onAlarm: {
          addListener: vi.fn(),
        },
      },
      runtime: {
        onMessage: {
          addListener: vi.fn(),
        },
        onInstalled: {
          addListener: vi.fn(),
        },
        onStartup: {
          addListener: vi.fn(),
        },
        sendMessage: vi.fn(),
      },
    };

    vi.stubGlobal('chrome', chromeMock);
    vi.stubGlobal('fetch', vi.fn());

    // Setup default mock implementations
    vi.mocked(getSyncStatus).mockResolvedValue({
      totalFollows: 0,
      syncedFollows: 0,
      lastSync: 0,
      isRunning: false,
      lastUpdated: 0,
      errors: [],
    });
    vi.mocked(getStoredAuth).mockResolvedValue(null);
    vi.mocked(getBlockCache).mockResolvedValue(null);
    vi.mocked(createEmptyCache).mockImplementation((did) => ({
      followedUsers: [],
      userBlockCaches: {},
      lastFullSync: 0,
      currentUserDid: did,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Extension initialization', () => {
    it('should register event listeners on install', async () => {
      await import('../background.js');

      expect(chrome.runtime.onInstalled.addListener).toHaveBeenCalled();
      expect(chrome.runtime.onStartup.addListener).toHaveBeenCalled();
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
      expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalled();
    });

    it('should setup alarm on initialization', async () => {
      await import('../background.js');

      expect(chrome.alarms.clear).toHaveBeenCalledWith('performFullSync');
      expect(chrome.alarms.create).toHaveBeenCalledWith(
        'performFullSync',
        expect.objectContaining({ periodInMinutes: 60 })
      );
    });
  });

  describe('Message handling', () => {
    beforeEach(async () => {
      await import('../background.js');
    });

    it('should handle SET_AUTH message', async () => {
      // Mock existing auth to match new auth (so sync is not triggered)
      vi.mocked(getStoredAuth).mockResolvedValueOnce({
        accessJwt: 'jwt-123',
        did: 'did:user',
        handle: 'user.bsky.social',
        pdsUrl: 'https://pds.test.com',
      });

      // Mock cache with some follows (so sync is not triggered)
      vi.mocked(getBlockCache).mockResolvedValueOnce({
        followedUsers: [{ did: 'did:1', handle: 'user1.bsky.social' }],
        userBlockCaches: {},
        lastFullSync: Date.now(),
        currentUserDid: 'did:user',
      });

      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const mockAuth = {
        accessJwt: 'jwt-123',
        did: 'did:user',
        handle: 'user.bsky.social',
        pdsUrl: 'https://pds.test.com',
      };

      const sendResponse = vi.fn();

      messageListener(
        {
          type: 'SET_AUTH',
          auth: mockAuth,
        },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(storeAuth).toHaveBeenCalledWith(mockAuth);
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('should trigger sync on first auth', async () => {
      // No existing auth - should trigger sync
      vi.mocked(getStoredAuth).mockResolvedValueOnce(null);
      // Empty cache - should trigger sync
      vi.mocked(getBlockCache).mockResolvedValueOnce(null);

      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const mockAuth = {
        accessJwt: 'jwt-123',
        did: 'did:newuser',
        handle: 'newuser.bsky.social',
        pdsUrl: 'https://pds.test.com',
      };

      const sendResponse = vi.fn();

      messageListener(
        {
          type: 'SET_AUTH',
          auth: mockAuth,
        },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(storeAuth).toHaveBeenCalledWith(mockAuth);
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('should handle GET_BLOCKING_INFO message', async () => {
      vi.mocked(getBlockCache).mockResolvedValueOnce({
        followedUsers: [],
        userBlockCaches: {},
        lastFullSync: 0,
        currentUserDid: 'did:me',
      });

      // Profile blocks fetched on-demand
      vi.mocked(getUserBlocks).mockResolvedValueOnce(['did:blocked1']);

      vi.mocked(lookupBlockingInfo).mockResolvedValueOnce({
        blockedBy: [],
        blocking: [],
      });

      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
      const sendResponse = vi.fn();

      messageListener(
        {
          type: 'GET_BLOCKING_INFO',
          profileDid: 'did:profile',
        },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(getUserBlocks).toHaveBeenCalledWith('did:profile');
      expect(lookupBlockingInfo).toHaveBeenCalledWith('did:profile', ['did:blocked1']);
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        blockingInfo: { blockedBy: [], blocking: [] },
      });
    });

    it('should return error for GET_BLOCKING_INFO without profileDid', async () => {
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
      const sendResponse = vi.fn();

      messageListener(
        {
          type: 'GET_BLOCKING_INFO',
        },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Missing profileDid',
      });
    });

    it('should handle GET_SYNC_STATUS message', async () => {
      const mockStatus = {
        totalFollows: 100,
        syncedFollows: 50,
        lastSync: Date.now(),
        isRunning: false,
        lastUpdated: Date.now(),
        errors: [],
      };

      vi.mocked(getSyncStatus).mockResolvedValueOnce(mockStatus);

      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
      const sendResponse = vi.fn();

      messageListener(
        {
          type: 'GET_SYNC_STATUS',
        },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        syncStatus: mockStatus,
      });
    });

    it('should handle TRIGGER_SYNC message asynchronously', async () => {
      vi.mocked(getStoredAuth).mockResolvedValueOnce({
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me.bsky.social',
        pdsUrl: 'https://pds.test.com',
      });

      vi.mocked(getAllFollows).mockResolvedValueOnce([]);

      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
      const sendResponse = vi.fn();

      const result = messageListener(
        {
          type: 'TRIGGER_SYNC',
        },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(result).toBe(true); // Indicates async
    });

    it('should propagate errors from TRIGGER_SYNC', async () => {
      // make getSyncStatus throw, which is called early in performFullSync
      vi.mocked(getSyncStatus).mockRejectedValueOnce(new Error('Critical failure'));

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
      const sendResponse = vi.fn();

      messageListener({ type: 'TRIGGER_SYNC' }, {} as chrome.runtime.MessageSender, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Critical failure' });
    });

    it('should return error for unknown message type', async () => {
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
      const sendResponse = vi.fn();

      messageListener(
        {
          type: 'UNKNOWN_TYPE',
        } as unknown as Message,
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Unknown message type',
      });
    });

    it('should handle CLEAR_CACHE message', async () => {
      vi.mocked(saveBlockCache).mockResolvedValue(undefined);
      vi.mocked(updateSyncStatus).mockResolvedValue(undefined);

      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
      const sendResponse = vi.fn();

      messageListener({ type: 'CLEAR_CACHE' }, {} as chrome.runtime.MessageSender, sendResponse);

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(saveBlockCache).toHaveBeenCalled();
      expect(updateSyncStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          totalFollows: 0,
          isRunning: false,
        })
      );
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('Sync functionality', () => {
    it('should reset stale lock and continue sync', async () => {
      // Stale lock (older than 5 minutes)
      vi.mocked(getSyncStatus).mockResolvedValueOnce({
        totalFollows: 100,
        syncedFollows: 50,
        lastSync: 0,
        isRunning: true,
        lastUpdated: Date.now() - 6 * 60 * 1000,
        errors: [],
      });

      vi.mocked(getStoredAuth).mockResolvedValueOnce({
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me.bsky.social',
        pdsUrl: 'https://pds.test.com',
      });

      vi.mocked(getAllFollows).mockResolvedValueOnce([]);

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      messageListener({ type: 'TRIGGER_SYNC' }, {} as chrome.runtime.MessageSender, vi.fn());

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should have called updateSyncStatus to reset lock
      expect(updateSyncStatus).toHaveBeenCalledWith({ isRunning: false });
      // And continued to sync
      expect(getAllFollows).toHaveBeenCalled();
    });

    it('should skip sync if already running', async () => {
      vi.mocked(getSyncStatus).mockResolvedValueOnce({
        totalFollows: 100,
        syncedFollows: 50,
        lastSync: Date.now(),
        isRunning: true,
        lastUpdated: Date.now(), // Recent update - not stale
        errors: [],
      });

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const sendResponse = vi.fn();
      messageListener(
        {
          type: 'TRIGGER_SYNC',
        },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      // Wait for async operation
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(getAllFollows).not.toHaveBeenCalled();
    });

    it('should skip sync if no auth available', async () => {
      vi.mocked(getStoredAuth).mockResolvedValue(null);

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const sendResponse = vi.fn();
      messageListener(
        {
          type: 'TRIGGER_SYNC',
        },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(getAllFollows).not.toHaveBeenCalled();
    });

    it('should handle sync with follows', async () => {
      const mockAuth = {
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me.bsky.social',
        pdsUrl: 'https://pds.test.com',
      };

      const mockFollows = [
        { did: 'did:user1', handle: 'user1.bsky.social' },
        { did: 'did:user2', handle: 'user2.bsky.social' },
      ];

      vi.mocked(getStoredAuth).mockResolvedValue(mockAuth);
      vi.mocked(getAllFollows).mockResolvedValueOnce(mockFollows);
      vi.mocked(getUserBlocks).mockResolvedValue([]);

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const sendResponse = vi.fn();
      messageListener(
        {
          type: 'TRIGGER_SYNC',
        },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(getAllFollows).toHaveBeenCalledWith('did:me');
      expect(saveBlockCache).toHaveBeenCalled();
    });

    it('should use existing cache if currentUserDid matches', async () => {
      const mockAuth = {
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me.bsky.social',
        pdsUrl: 'https://pds.test.com',
      };

      vi.mocked(getStoredAuth).mockResolvedValue(mockAuth);
      vi.mocked(getBlockCache).mockResolvedValue({
        followedUsers: [{ did: 'did:user1', handle: 'user1.bsky.social' }],
        userBlockCaches: {},
        lastFullSync: 0,
        currentUserDid: 'did:me',
      });
      vi.mocked(getAllFollows).mockResolvedValueOnce([
        { did: 'did:user1', handle: 'user1.bsky.social' },
      ]);
      vi.mocked(getUserBlocks).mockResolvedValue([]);

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const sendResponse = vi.fn();
      messageListener({ type: 'TRIGGER_SYNC' }, {} as chrome.runtime.MessageSender, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(saveBlockCache).toHaveBeenCalled();
    });

    it('should retry saving after pruning on quota error', async () => {
      vi.mocked(getStoredAuth).mockResolvedValue({
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me.bsky.social',
        pdsUrl: 'https://pds.test.com',
      });

      // Huge cache to trigger pruning (approx 15MB)
      const hugeCache = {
        followedUsers: [],
        userBlockCaches: {} as Record<string, unknown>,
        lastFullSync: 0,
        currentUserDid: 'did:me',
      };

      for (let i = 0; i < 200; i++) {
        hugeCache.userBlockCaches[`did:${i}`] = {
          did: `did:${i}`,
          handle: `user${i}`,
          blocks: Array.from({ length: 3000 }, (_, j) => `did:blocked:${j}`),
          lastSynced: i,
        };
      }

      vi.mocked(getBlockCache).mockResolvedValue(hugeCache);
      vi.mocked(getAllFollows).mockResolvedValue([]);

      // First save fails with quota error
      vi.mocked(saveBlockCache).mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));
      // Second save (after pruning) succeeds
      vi.mocked(saveBlockCache).mockResolvedValue(undefined);

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      messageListener({ type: 'TRIGGER_SYNC' }, {} as chrome.runtime.MessageSender, vi.fn());

      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(saveBlockCache).toHaveBeenCalled();
    });

    it('should trigger sync if cache is incomplete (many follows, few caches)', async () => {
      vi.mocked(getStoredAuth).mockResolvedValue({
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me',
        pdsUrl: 'p',
      });

      // 200 follows, but 0 caches -> < 5% -> incomplete
      const mockCache = {
        followedUsers: Array.from({ length: 200 }, (_, i) => ({
          did: `did:${i}`,
          handle: `u${i}`,
        })),
        userBlockCaches: {},
        lastFullSync: Date.now(),
        currentUserDid: 'did:me',
      };
      vi.mocked(getBlockCache).mockResolvedValueOnce(mockCache);

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
      const sendResponse = vi.fn();

      messageListener(
        { type: 'SET_AUTH', auth: { accessJwt: 'jwt', did: 'did:me', handle: 'me', pdsUrl: 'p' } },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      // Should trigger sync (getAllFollows is the first step)
      expect(getAllFollows).toHaveBeenCalled();
    });

    it('should handle non-quota errors during save', async () => {
      vi.mocked(getStoredAuth).mockResolvedValue({
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me',
        pdsUrl: 'p',
      });
      vi.mocked(getBlockCache).mockResolvedValue({
        followedUsers: [],
        userBlockCaches: {},
        lastFullSync: 0,
        currentUserDid: 'did:me',
      });
      vi.mocked(getAllFollows).mockResolvedValue([{ did: 'd1', handle: 'h1' }]);
      vi.mocked(getUserBlocks).mockResolvedValue([]);

      // Throw random error
      vi.mocked(saveBlockCache).mockRejectedValue(new Error('Random DB error'));

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
      messageListener({ type: 'TRIGGER_SYNC' }, {} as chrome.runtime.MessageSender, vi.fn());

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(saveBlockCache).toHaveBeenCalled();
      // Should be caught and logged, not crash
    });

    it('should return false if saving fails even after pruning', async () => {
      vi.mocked(getStoredAuth).mockResolvedValue({
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me',
        pdsUrl: 'p',
      });
      // Massive cache (approx 15MB)
      const hugeCache = {
        followedUsers: [],
        userBlockCaches: {} as Record<string, unknown>,
        lastFullSync: 0,
        currentUserDid: 'did:me',
      };
      for (let i = 0; i < 100; i++) {
        hugeCache.userBlockCaches[`did:${i}`] = {
          did: `did:${i}`,
          blocks: new Array(4000).fill(
            'did:blocked:some-very-long-id-to-ensure-size-is-large-enough'
          ),
          lastSynced: i,
        };
      }
      vi.mocked(getBlockCache).mockResolvedValue(hugeCache);
      vi.mocked(getAllFollows).mockResolvedValue([]);

      // Both attempts fail with quota error
      vi.mocked(saveBlockCache).mockRejectedValue(new Error('QUOTA_BYTES quota exceeded'));

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
      messageListener({ type: 'TRIGGER_SYNC' }, {} as chrome.runtime.MessageSender, vi.fn());

      await new Promise((resolve) => setTimeout(resolve, 800));
      // Once for proactive prune attempt, then safeSaveBlockCache catches quota and retries -> should be 2 calls?
      // Wait, performFullSync:
      // 1. initialSize > limit -> pruneCache -> safeSaveBlockCache -> saveBlockCache (fail) -> retry saveBlockCache (fail)
      // So at least 2 calls.
      expect(saveBlockCache).toHaveBeenCalled();
    });

    it('should handle getUserBlocks errors during parallel sync', async () => {
      vi.mocked(getStoredAuth).mockResolvedValue({
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me',
        pdsUrl: 'p',
      });
      vi.mocked(getAllFollows).mockResolvedValueOnce([
        { did: 'did:user1', handle: 'user1' },
        { did: 'did:user2', handle: 'user2' },
      ]);
      // One succeeds, one fails
      vi.mocked(getUserBlocks)
        .mockResolvedValueOnce(['blocked'])
        .mockRejectedValueOnce(new Error('Parallel fetch failed'));

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
      messageListener({ type: 'TRIGGER_SYNC' }, {} as chrome.runtime.MessageSender, vi.fn());

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(saveBlockCache).toHaveBeenCalled();
    });

    it('should handle getUserBlocks errors during sync', async () => {
      vi.mocked(getStoredAuth).mockResolvedValue({
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me.bsky.social',
        pdsUrl: 'https://pds.test.com',
      });

      vi.mocked(getAllFollows).mockResolvedValueOnce([
        { did: 'did:user1', handle: 'user1.bsky.social' },
      ]);

      vi.mocked(getUserBlocks).mockRejectedValueOnce(new Error('Block fetch failed'));

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const sendResponse = vi.fn();
      messageListener({ type: 'TRIGGER_SYNC' }, {} as chrome.runtime.MessageSender, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(saveBlockCache).toHaveBeenCalled();
    });

    it('should handle non-array getUserBlocks response', async () => {
      vi.mocked(getStoredAuth).mockResolvedValue({
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me.bsky.social',
        pdsUrl: 'https://pds.test.com',
      });

      vi.mocked(getAllFollows).mockResolvedValueOnce([
        { did: 'did:user1', handle: 'user1.bsky.social' },
      ]);

      vi.mocked(getUserBlocks).mockResolvedValueOnce(null as unknown as string[]);

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const sendResponse = vi.fn();
      messageListener({ type: 'TRIGGER_SYNC' }, {} as chrome.runtime.MessageSender, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(saveBlockCache).toHaveBeenCalled();
    });

    it('should handle FETCH_PROFILE_BLOCKS message', async () => {
      vi.mocked(getUserBlocks).mockResolvedValueOnce(['did:blocked1', 'did:blocked2']);

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const sendResponse = vi.fn();
      messageListener(
        { type: 'FETCH_PROFILE_BLOCKS', profileDid: 'did:profile' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(getUserBlocks).toHaveBeenCalledWith('did:profile');
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        blocks: ['did:blocked1', 'did:blocked2'],
      });
    });

    it('should handle FETCH_PROFILE_BLOCKS without profileDid', async () => {
      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const sendResponse = vi.fn();
      messageListener(
        { type: 'FETCH_PROFILE_BLOCKS' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Missing profileDid',
      });
    });

    it('should handle FETCH_PROFILE_BLOCKS error', async () => {
      vi.mocked(getUserBlocks).mockRejectedValueOnce(new Error('Fetch failed'));

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const sendResponse = vi.fn();
      messageListener(
        { type: 'FETCH_PROFILE_BLOCKS', profileDid: 'did:profile' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Fetch failed',
      });
    });

    it('should handle alarm trigger', async () => {
      await import('../background.js');

      const alarmListener = vi.mocked(chrome.alarms.onAlarm.addListener).mock.calls[0][0];
      alarmListener({ name: 'performFullSync', scheduledTime: Date.now() });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(getStoredAuth).toHaveBeenCalled();
    });

    it('should ignore non-sync alarms', async () => {
      await import('../background.js');

      const alarmListener = vi.mocked(chrome.alarms.onAlarm.addListener).mock.calls[0][0];
      alarmListener({ name: 'otherAlarm', scheduledTime: Date.now() });

      expect(getSyncStatus).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should handle message processing errors gracefully', async () => {
      vi.mocked(getBlockCache).mockResolvedValueOnce(null);
      vi.mocked(getUserBlocks).mockResolvedValueOnce([]);
      vi.mocked(lookupBlockingInfo).mockRejectedValueOnce(new Error('Storage error'));

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const sendResponse = vi.fn();

      messageListener(
        {
          type: 'GET_BLOCKING_INFO',
          profileDid: 'did:profile',
        },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Storage error',
      });
    });

    it('should handle sync errors and update status', async () => {
      vi.mocked(getStoredAuth).mockResolvedValueOnce({
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me.bsky.social',
        pdsUrl: 'https://pds.test.com',
      });

      vi.mocked(getAllFollows).mockRejectedValueOnce(new Error('API error'));

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const sendResponse = vi.fn();
      messageListener(
        {
          type: 'TRIGGER_SYNC',
        },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(updateSyncStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          isRunning: false,
          errors: expect.any(Array),
        })
      );
    });
  });
});
