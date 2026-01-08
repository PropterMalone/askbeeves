import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Create mock storage functions
const mockStorageLocalGet = vi.fn();
const mockStorageLocalSet = vi.fn();
const mockStorageLocalClear = vi.fn();
const mockStorageSyncGet = vi.fn();
const mockStorageSyncSet = vi.fn();

// Mock the browser module before importing storage
vi.mock('../browser.js', () => ({
  storage: {
    local: {
      get: (keys: string | string[]) => mockStorageLocalGet(keys),
      set: (items: Record<string, unknown>) => mockStorageLocalSet(items),
      clear: () => mockStorageLocalClear(),
    },
    sync: {
      get: (keys: string | string[]) => mockStorageSyncGet(keys),
      set: (items: Record<string, unknown>) => mockStorageSyncSet(items),
    },
  },
}));

import {
  getBlockCache,
  saveBlockCache,
  createEmptyCache,
  updateUserBlockCache,
  getSyncStatus,
  updateSyncStatus,
  getStoredAuth,
  storeAuth,
  lookupBlockingInfo,
  getBlockers,
  clearAllData,
} from '../storage.js';

describe('Storage Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getBlockCache', () => {
    it('should return cached block data', async () => {
      const mockCache = {
        followedUsers: [],
        userBlockCaches: {},
        lastFullSync: 0,
        currentUserDid: 'did:test',
      };

      mockStorageLocalGet.mockResolvedValueOnce({
        blockCache: mockCache,
      });

      const cache = await getBlockCache();
      expect(cache).toEqual(mockCache);
    });

    it('should return null when no cache exists', async () => {
      mockStorageLocalGet.mockResolvedValueOnce({});

      const cache = await getBlockCache();
      expect(cache).toBeNull();
    });
  });

  describe('saveBlockCache', () => {
    it('should save cache to storage', async () => {
      mockStorageLocalSet.mockResolvedValueOnce(undefined);

      const mockCache = {
        followedUsers: [],
        userBlockCaches: {},
        lastFullSync: Date.now(),
        currentUserDid: 'did:test',
      };

      await saveBlockCache(mockCache);
      expect(mockStorageLocalSet).toHaveBeenCalledWith({
        blockCache: mockCache,
      });
    });
  });

  describe('createEmptyCache', () => {
    it('should create empty cache with correct structure', () => {
      const cache = createEmptyCache('did:user123');

      expect(cache.currentUserDid).toBe('did:user123');
      expect(cache.followedUsers).toEqual([]);
      expect(cache.userBlockCaches).toEqual({});
      expect(cache.lastFullSync).toBe(0);
    });
  });

  describe('updateUserBlockCache', () => {
    it('should update user block cache', async () => {
      const mockCache = {
        followedUsers: [],
        userBlockCaches: {},
        lastFullSync: 0,
        currentUserDid: 'did:test',
      };

      mockStorageLocalGet.mockResolvedValueOnce({
        blockCache: mockCache,
      });

      mockStorageLocalSet.mockResolvedValueOnce(undefined);

      const userCache = {
        did: 'did:user1',
        handle: 'user1.bsky.social',
        displayName: 'User 1',
        blocks: ['did:blocked1'],
        lastSynced: Date.now(),
      };

      await updateUserBlockCache(userCache);

      expect(mockStorageLocalSet).toHaveBeenCalled();
      const callArg = mockStorageLocalSet.mock.calls[0][0] as Record<string, unknown>;
      expect((callArg.blockCache as Record<string, unknown>).userBlockCaches).toBeDefined();
    });

    it('should handle missing cache gracefully', async () => {
      mockStorageLocalGet.mockResolvedValueOnce({});

      const userCache = {
        did: 'did:user1',
        handle: 'user1.bsky.social',
        displayName: 'User 1',
        blocks: [],
        lastSynced: Date.now(),
      };

      await updateUserBlockCache(userCache);
      expect(mockStorageLocalSet).not.toHaveBeenCalled();
    });
  });

  describe('getSyncStatus', () => {
    it('should return default sync status when none exists', async () => {
      mockStorageLocalGet.mockResolvedValueOnce({});

      const status = await getSyncStatus();

      expect(status.totalFollows).toBe(0);
      expect(status.syncedFollows).toBe(0);
      expect(status.isRunning).toBe(false);
      expect(status.lastUpdated).toBe(0);
      expect(status.errors).toEqual([]);
    });

    it('should return saved sync status', async () => {
      const mockStatus = {
        totalFollows: 100,
        syncedFollows: 50,
        lastSync: Date.now(),
        isRunning: true,
        lastUpdated: Date.now(),
        errors: [],
      };

      mockStorageLocalGet.mockResolvedValueOnce({
        syncStatus: mockStatus,
      });

      const status = await getSyncStatus();
      expect(status).toEqual(mockStatus);
    });
  });

  describe('updateSyncStatus', () => {
    it('should update sync status and set lastUpdated', async () => {
      const currentStatus = {
        totalFollows: 100,
        syncedFollows: 0,
        lastSync: 0,
        isRunning: false,
        lastUpdated: 0,
        errors: [],
      };

      mockStorageLocalGet.mockResolvedValueOnce({
        syncStatus: currentStatus,
      });

      mockStorageLocalSet.mockResolvedValueOnce(undefined);

      const beforeUpdate = Date.now();
      await updateSyncStatus({
        isRunning: true,
        syncedFollows: 50,
      });

      expect(mockStorageLocalSet).toHaveBeenCalled();
      const callArg = mockStorageLocalSet.mock.calls[0][0] as Record<string, unknown>;
      const syncStatusData = callArg.syncStatus as Record<string, unknown>;
      expect(syncStatusData.isRunning).toBe(true);
      expect(syncStatusData.syncedFollows).toBe(50);
      expect(syncStatusData.totalFollows).toBe(100);
      expect(syncStatusData.lastUpdated).toBeGreaterThanOrEqual(beforeUpdate);
    });
  });

  describe('getStoredAuth', () => {
    it('should return stored auth token', async () => {
      const mockAuth = {
        accessJwt: 'jwt-123',
        did: 'did:user',
        handle: 'user.bsky.social',
        pdsUrl: 'https://pds.test.com',
      };

      mockStorageLocalGet.mockResolvedValueOnce({
        authToken: mockAuth,
      });

      const auth = await getStoredAuth();
      expect(auth).toEqual(mockAuth);
    });

    it('should return null when no auth exists', async () => {
      mockStorageLocalGet.mockResolvedValueOnce({});

      const auth = await getStoredAuth();
      expect(auth).toBeNull();
    });
  });

  describe('storeAuth', () => {
    it('should store auth token', async () => {
      mockStorageLocalSet.mockResolvedValueOnce(undefined);

      const mockAuth = {
        accessJwt: 'jwt-456',
        did: 'did:user2',
        handle: 'user2.bsky.social',
        pdsUrl: 'https://pds.test.com',
      };

      await storeAuth(mockAuth);
      expect(mockStorageLocalSet).toHaveBeenCalledWith({
        authToken: mockAuth,
      });
    });
  });

  describe('getBlockers', () => {
    it('should return users who block the profile', async () => {
      const mockCache = {
        followedUsers: [
          { did: 'did:user1', handle: 'user1.bsky.social' },
          { did: 'did:user2', handle: 'user2.bsky.social' },
        ],
        userBlockCaches: {
          'did:user1': {
            did: 'did:user1',
            handle: 'user1.bsky.social',
            blocks: ['did:profile', 'did:other'],
            lastSynced: Date.now(),
          },
          'did:user2': {
            did: 'did:user2',
            handle: 'user2.bsky.social',
            blocks: ['did:someone-else'],
            lastSynced: Date.now(),
          },
        },
        lastFullSync: Date.now(),
        currentUserDid: 'did:me',
      };

      mockStorageLocalGet.mockResolvedValueOnce({
        blockCache: mockCache,
      });

      const blockers = await getBlockers('did:profile');

      expect(blockers).toHaveLength(1);
      expect(blockers[0].handle).toBe('user1.bsky.social');
    });

    it('should return empty array when no cache exists', async () => {
      mockStorageLocalGet.mockResolvedValueOnce({});

      const blockers = await getBlockers('did:profile');

      expect(blockers).toEqual([]);
    });

    it('should return empty array when no one blocks the profile', async () => {
      const mockCache = {
        followedUsers: [{ did: 'did:user1', handle: 'user1.bsky.social' }],
        userBlockCaches: {
          'did:user1': {
            did: 'did:user1',
            handle: 'user1.bsky.social',
            blocks: ['did:someone-else'],
            lastSynced: Date.now(),
          },
        },
        lastFullSync: Date.now(),
        currentUserDid: 'did:me',
      };

      mockStorageLocalGet.mockResolvedValueOnce({
        blockCache: mockCache,
      });

      const blockers = await getBlockers('did:profile');

      expect(blockers).toEqual([]);
    });
    it('should handle large block lists efficiently', async () => {
      // Generate 25 blocks to trigger Set optimization (>20)
      const blocks = Array.from({ length: 25 }, (_, i) => `did:block${i}`);
      blocks.push('did:profile');

      const mockCache = {
        followedUsers: [{ did: 'did:user1', handle: 'user1.bsky.social' }],
        userBlockCaches: {
          'did:user1': {
            did: 'did:user1',
            handle: 'user1.bsky.social',
            blocks: blocks,
            lastSynced: Date.now(),
          },
        },
        lastFullSync: Date.now(),
        currentUserDid: 'did:me',
      };

      mockStorageLocalGet.mockResolvedValueOnce({
        blockCache: mockCache,
      });

      const blockers = await getBlockers('did:profile');
      expect(blockers).toHaveLength(1);
    });
  });

  describe('lookupBlockingInfo', () => {
    it('should ignore blocked users not in follows list', async () => {
      const mockCache = {
        followedUsers: [{ did: 'did:user1', handle: 'user1.bsky.social' }],
        userBlockCaches: {},
        lastFullSync: 0,
        currentUserDid: 'did:me',
      };

      mockStorageLocalGet.mockResolvedValue({
        blockCache: mockCache,
      });

      const result = await lookupBlockingInfo('did:profile', ['did:user1', 'did:unknown']);

      expect(result.blocking).toHaveLength(1);
      expect(result.blocking[0].did).toBe('did:user1');
    });

    it('should find users who block the profile from cached blocks', async () => {
      const mockCache = {
        followedUsers: [
          { did: 'did:user1', handle: 'user1.bsky.social' },
          { did: 'did:user2', handle: 'user2.bsky.social' },
        ],
        userBlockCaches: {
          'did:user1': {
            did: 'did:user1',
            handle: 'user1.bsky.social',
            blocks: ['did:profile'],
            lastSynced: Date.now(),
          },
        },
        lastFullSync: Date.now(),
        currentUserDid: 'did:me',
      };

      mockStorageLocalGet.mockResolvedValue({
        blockCache: mockCache,
      });

      // lookupBlockingInfo now takes (profileDid, profileBlocks)
      const result = await lookupBlockingInfo('did:profile', []);

      expect(result.blockedBy).toHaveLength(1);
      expect(result.blockedBy[0].handle).toBe('user1.bsky.social');
    });

    it('should find users that the profile blocks', async () => {
      const mockCache = {
        followedUsers: [
          { did: 'did:user1', handle: 'user1.bsky.social' },
          { did: 'did:user2', handle: 'user2.bsky.social' },
        ],
        userBlockCaches: {},
        lastFullSync: Date.now(),
        currentUserDid: 'did:me',
      };

      mockStorageLocalGet.mockResolvedValue({
        blockCache: mockCache,
      });

      // Profile blocks user1 (passed as profileBlocks parameter)
      const result = await lookupBlockingInfo('did:profile', ['did:user1']);

      expect(result.blocking).toHaveLength(1);
      expect(result.blocking[0].handle).toBe('user1.bsky.social');
    });

    it('should return empty arrays when no cache exists', async () => {
      mockStorageLocalGet.mockResolvedValue({});

      const result = await lookupBlockingInfo('did:profile', []);

      expect(result.blockedBy).toEqual([]);
      expect(result.blocking).toEqual([]);
    });

    it('should handle bidirectional blocks', async () => {
      const mockCache = {
        followedUsers: [{ did: 'did:user1', handle: 'user1.bsky.social' }],
        userBlockCaches: {
          'did:user1': {
            did: 'did:user1',
            handle: 'user1.bsky.social',
            blocks: ['did:profile'],
            lastSynced: Date.now(),
          },
        },
        lastFullSync: Date.now(),
        currentUserDid: 'did:me',
      };

      mockStorageLocalGet.mockResolvedValue({
        blockCache: mockCache,
      });

      // User1 blocks profile (in cache), profile blocks user1 (passed as parameter)
      const result = await lookupBlockingInfo('did:profile', ['did:user1']);

      expect(result.blockedBy).toHaveLength(1);
      expect(result.blocking).toHaveLength(1);
    });
  });

  describe('clearAllData', () => {
    it('should clear all storage data', async () => {
      mockStorageLocalClear.mockResolvedValueOnce(undefined);

      await clearAllData();
      expect(mockStorageLocalClear).toHaveBeenCalled();
    });
  });
});
