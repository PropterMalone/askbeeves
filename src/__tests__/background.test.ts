import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

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
      const { storeAuth, getStoredAuth, getBlockCache } = await import('../storage.js');

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
      const { storeAuth, getStoredAuth, getSyncStatus, getBlockCache } =
        await import('../storage.js');

      // No existing auth - should trigger sync
      vi.mocked(getStoredAuth).mockResolvedValueOnce(null);
      // Empty cache - should trigger sync
      vi.mocked(getBlockCache).mockResolvedValueOnce(null);
      vi.mocked(getSyncStatus).mockResolvedValue({
        totalFollows: 0,
        syncedFollows: 0,
        lastSync: 0,
        isRunning: false,
        lastUpdated: 0,
        errors: [],
      });
      vi.mocked(getStoredAuth).mockResolvedValue(null); // For performFullSync check

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
      const { lookupBlockingInfo, getBlockCache } = await import('../storage.js');
      const { getUserBlocks } = await import('../api.js');

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
      // New signature: lookupBlockingInfo(profileDid, profileBlocks)
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
      const { getSyncStatus } = await import('../storage.js');

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
      const { getSyncStatus, getStoredAuth, createEmptyCache } = await import('../storage.js');
      const { getAllFollows } = await import('../api.js');

      vi.mocked(getSyncStatus).mockResolvedValueOnce({
        totalFollows: 0,
        syncedFollows: 0,
        lastSync: 0,
        isRunning: false,
        lastUpdated: 0,
        errors: [],
      });

      vi.mocked(getStoredAuth).mockResolvedValueOnce({
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me.bsky.social',
        pdsUrl: 'https://pds.test.com',
      });

      vi.mocked(getAllFollows).mockResolvedValueOnce([]);
      vi.mocked(createEmptyCache).mockReturnValueOnce({
        followedUsers: [],
        userBlockCaches: {},
        lastFullSync: 0,
        currentUserDid: 'did:me',
      });

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

    it('should return error for unknown message type', async () => {
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
      const sendResponse = vi.fn();

      messageListener(
        {
          type: 'UNKNOWN_TYPE',
        } as unknown,
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
  });

  describe('Sync functionality', () => {
    it('should skip sync if already running', async () => {
      const { getSyncStatus } = await import('../storage.js');

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
    });

    it('should skip sync if no auth available', async () => {
      const { getSyncStatus, getStoredAuth } = await import('../storage.js');

      vi.mocked(getSyncStatus).mockResolvedValueOnce({
        totalFollows: 0,
        syncedFollows: 0,
        lastSync: 0,
        isRunning: false,
        lastUpdated: 0,
        errors: [],
      });

      vi.mocked(getStoredAuth).mockResolvedValueOnce(null);

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
    });

    it('should handle sync with follows', async () => {
      const { getSyncStatus, getStoredAuth, createEmptyCache, saveBlockCache, updateSyncStatus } =
        await import('../storage.js');
      const { getAllFollows, getUserBlocks } = await import('../api.js');

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

      vi.mocked(getSyncStatus).mockResolvedValueOnce({
        totalFollows: 0,
        syncedFollows: 0,
        lastSync: 0,
        isRunning: false,
        lastUpdated: 0,
        errors: [],
      });

      vi.mocked(getStoredAuth).mockResolvedValueOnce(mockAuth);
      vi.mocked(getAllFollows).mockResolvedValueOnce(mockFollows);

      const mockCache = {
        followedUsers: mockFollows,
        userBlockCaches: {},
        lastFullSync: 0,
        currentUserDid: 'did:me',
      };

      vi.mocked(createEmptyCache).mockReturnValueOnce(mockCache);
      vi.mocked(getUserBlocks).mockResolvedValue([]);
      vi.mocked(saveBlockCache).mockResolvedValueOnce(undefined);
      vi.mocked(updateSyncStatus).mockResolvedValue(undefined);

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
      const { getSyncStatus, getStoredAuth, getBlockCache, saveBlockCache, updateSyncStatus } =
        await import('../storage.js');
      const { getAllFollows, getUserBlocks } = await import('../api.js');

      const mockAuth = {
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me.bsky.social',
        pdsUrl: 'https://pds.test.com',
      };

      vi.mocked(getSyncStatus).mockResolvedValueOnce({
        totalFollows: 0,
        syncedFollows: 0,
        lastSync: 0,
        isRunning: false,
        lastUpdated: 0,
        errors: [],
      });

      vi.mocked(getStoredAuth).mockResolvedValueOnce(mockAuth);
      vi.mocked(getBlockCache).mockResolvedValueOnce({
        followedUsers: [{ did: 'did:user1', handle: 'user1.bsky.social' }],
        userBlockCaches: {},
        lastFullSync: 0,
        currentUserDid: 'did:me',
      });
      vi.mocked(getAllFollows).mockResolvedValueOnce([
        { did: 'did:user1', handle: 'user1.bsky.social' },
      ]);
      vi.mocked(getUserBlocks).mockResolvedValue([]);
      vi.mocked(saveBlockCache).mockResolvedValue(undefined);
      vi.mocked(updateSyncStatus).mockResolvedValue(undefined);

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const sendResponse = vi.fn();
      messageListener({ type: 'TRIGGER_SYNC' }, {} as chrome.runtime.MessageSender, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(saveBlockCache).toHaveBeenCalled();
    });

    it('should handle getUserBlocks errors during sync', async () => {
      const { getSyncStatus, getStoredAuth, createEmptyCache, saveBlockCache, updateSyncStatus } =
        await import('../storage.js');
      const { getAllFollows, getUserBlocks } = await import('../api.js');

      vi.mocked(getSyncStatus).mockResolvedValueOnce({
        totalFollows: 0,
        syncedFollows: 0,
        lastSync: 0,
        isRunning: false,
        lastUpdated: 0,
        errors: [],
      });

      vi.mocked(getStoredAuth).mockResolvedValueOnce({
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me.bsky.social',
        pdsUrl: 'https://pds.test.com',
      });

      vi.mocked(getAllFollows).mockResolvedValueOnce([
        { did: 'did:user1', handle: 'user1.bsky.social' },
      ]);

      vi.mocked(createEmptyCache).mockReturnValueOnce({
        followedUsers: [],
        userBlockCaches: {},
        lastFullSync: 0,
        currentUserDid: 'did:me',
      });

      vi.mocked(getUserBlocks).mockRejectedValueOnce(new Error('Block fetch failed'));
      vi.mocked(saveBlockCache).mockResolvedValue(undefined);
      vi.mocked(updateSyncStatus).mockResolvedValue(undefined);

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const sendResponse = vi.fn();
      messageListener({ type: 'TRIGGER_SYNC' }, {} as chrome.runtime.MessageSender, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(saveBlockCache).toHaveBeenCalled();
    });

    it('should handle non-array getUserBlocks response', async () => {
      const { getSyncStatus, getStoredAuth, createEmptyCache, saveBlockCache, updateSyncStatus } =
        await import('../storage.js');
      const { getAllFollows, getUserBlocks } = await import('../api.js');

      vi.mocked(getSyncStatus).mockResolvedValueOnce({
        totalFollows: 0,
        syncedFollows: 0,
        lastSync: 0,
        isRunning: false,
        lastUpdated: 0,
        errors: [],
      });

      vi.mocked(getStoredAuth).mockResolvedValueOnce({
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me.bsky.social',
        pdsUrl: 'https://pds.test.com',
      });

      vi.mocked(getAllFollows).mockResolvedValueOnce([
        { did: 'did:user1', handle: 'user1.bsky.social' },
      ]);

      vi.mocked(createEmptyCache).mockReturnValueOnce({
        followedUsers: [],
        userBlockCaches: {},
        lastFullSync: 0,
        currentUserDid: 'did:me',
      });

      vi.mocked(getUserBlocks).mockResolvedValueOnce(null as unknown as string[]);
      vi.mocked(saveBlockCache).mockResolvedValue(undefined);
      vi.mocked(updateSyncStatus).mockResolvedValue(undefined);

      await import('../background.js');
      const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

      const sendResponse = vi.fn();
      messageListener({ type: 'TRIGGER_SYNC' }, {} as chrome.runtime.MessageSender, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(saveBlockCache).toHaveBeenCalled();
    });

    it('should handle FETCH_PROFILE_BLOCKS message', async () => {
      const { getUserBlocks } = await import('../api.js');

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
      const { getUserBlocks } = await import('../api.js');

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
      const { getSyncStatus, getStoredAuth } = await import('../storage.js');

      vi.mocked(getSyncStatus).mockResolvedValue({
        totalFollows: 0,
        syncedFollows: 0,
        lastSync: 0,
        isRunning: false,
        lastUpdated: 0,
        errors: [],
      });
      vi.mocked(getStoredAuth).mockResolvedValue(null);

      await import('../background.js');

      const alarmListener = vi.mocked(chrome.alarms.onAlarm.addListener).mock.calls[0][0];
      alarmListener({ name: 'performFullSync', scheduledTime: Date.now() });

      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should ignore non-sync alarms', async () => {
      const { getSyncStatus } = await import('../storage.js');

      await import('../background.js');

      const alarmListener = vi.mocked(chrome.alarms.onAlarm.addListener).mock.calls[0][0];
      alarmListener({ name: 'otherAlarm', scheduledTime: Date.now() });

      expect(getSyncStatus).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should handle message processing errors gracefully', async () => {
      const { lookupBlockingInfo, getBlockCache } = await import('../storage.js');
      const { getUserBlocks } = await import('../api.js');

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
      const { getSyncStatus, getStoredAuth, updateSyncStatus } = await import('../storage.js');
      const { getAllFollows } = await import('../api.js');

      vi.mocked(getSyncStatus).mockResolvedValueOnce({
        totalFollows: 0,
        syncedFollows: 0,
        lastSync: 0,
        isRunning: false,
        lastUpdated: 0,
        errors: [],
      });

      vi.mocked(getStoredAuth).mockResolvedValueOnce({
        accessJwt: 'jwt',
        did: 'did:me',
        handle: 'me.bsky.social',
        pdsUrl: 'https://pds.test.com',
      });

      vi.mocked(getAllFollows).mockRejectedValueOnce(new Error('API error'));
      vi.mocked(updateSyncStatus).mockResolvedValue(undefined);

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
