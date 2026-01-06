import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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
  getCandidateBlockers,
  clearAllData,
} from '../storage.js';

// Mock bloom filter module
vi.mock('../bloom.js', () => ({
  bloomFilterMightContain: vi.fn((filter, did) => {
    // Simple mock: return true if the filter's "mockBlocks" contains the DID
    // This is set up in tests by adding a mockBlocks property
    return filter.mockBlocks?.includes(did) ?? false;
  }),
  estimateFalsePositiveRate: vi.fn(() => 0.001), // Mock 0.1% FP rate
}));

type StorageResult = Record<string, unknown>;

describe('Storage Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const storageMock = {
      local: {
        get: vi.fn(),
        set: vi.fn(),
        clear: vi.fn(),
      },
    };

    vi.stubGlobal('chrome', {
      storage: storageMock,
    } as unknown as typeof chrome);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getBlockCache', () => {
    it('should return cached block data', async () => {
      const mockCache = {
        followedUsers: [],
        userBlockCaches: {},
        lastFullSync: 0,
        currentUserDid: 'did:test',
      };

      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({
        blockCache: mockCache,
      } as unknown as Record<string, unknown>);

      const cache = await getBlockCache();
      expect(cache).toEqual(mockCache);
    });

    it('should return null when no cache exists', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce(
        {} as unknown as Record<string, unknown>
      );

      const cache = await getBlockCache();
      expect(cache).toBeNull();
    });
  });

  describe('saveBlockCache', () => {
    it('should save cache to storage', async () => {
      vi.mocked(chrome.storage.local.set).mockResolvedValueOnce(undefined);

      const mockCache = {
        followedUsers: [],
        userBlockCaches: {},
        lastFullSync: Date.now(),
        currentUserDid: 'did:test',
      };

      await saveBlockCache(mockCache);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
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

      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({
        blockCache: mockCache,
      } as StorageResult);

      vi.mocked(chrome.storage.local.set).mockResolvedValueOnce(undefined);

      const userCache = {
        did: 'did:user1',
        handle: 'user1.bsky.social',
        displayName: 'User 1',
        bloomFilter: { bits: 'AAAA', size: 64, numHashes: 7, count: 1 },
        blockCount: 1,
        lastSynced: Date.now(),
      };

      await updateUserBlockCache(userCache);

      expect(chrome.storage.local.set).toHaveBeenCalled();
      const callArg = vi.mocked(chrome.storage.local.set).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect((callArg.blockCache as Record<string, unknown>).userBlockCaches).toBeDefined();
    });

    it('should handle missing cache gracefully', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({} as StorageResult);

      const userCache = {
        did: 'did:user1',
        handle: 'user1.bsky.social',
        displayName: 'User 1',
        bloomFilter: { bits: 'AAAA', size: 64, numHashes: 7, count: 0 },
        blockCount: 0,
        lastSynced: Date.now(),
      };

      await updateUserBlockCache(userCache);
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
  });

  describe('getSyncStatus', () => {
    it('should return default sync status when none exists', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({} as StorageResult);

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

      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({
        syncStatus: mockStatus,
      } as StorageResult);

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

      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({
        syncStatus: currentStatus,
      } as StorageResult);

      vi.mocked(chrome.storage.local.set).mockResolvedValueOnce(undefined);

      const beforeUpdate = Date.now();
      await updateSyncStatus({
        isRunning: true,
        syncedFollows: 50,
      });

      expect(chrome.storage.local.set).toHaveBeenCalled();
      const callArg = vi.mocked(chrome.storage.local.set).mock.calls[0][0] as Record<
        string,
        unknown
      >;
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

      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({
        authToken: mockAuth,
      } as StorageResult);

      const auth = await getStoredAuth();
      expect(auth).toEqual(mockAuth);
    });

    it('should return null when no auth exists', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({} as StorageResult);

      const auth = await getStoredAuth();
      expect(auth).toBeNull();
    });
  });

  describe('storeAuth', () => {
    it('should store auth token', async () => {
      vi.mocked(chrome.storage.local.set).mockResolvedValueOnce(undefined);

      const mockAuth = {
        accessJwt: 'jwt-456',
        did: 'did:user2',
        handle: 'user2.bsky.social',
        pdsUrl: 'https://pds.test.com',
      };

      await storeAuth(mockAuth);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        authToken: mockAuth,
      });
    });
  });

  describe('getCandidateBlockers', () => {
    it('should return candidates from bloom filter matches', async () => {
      const mockCache = {
        followedUsers: [
          { did: 'did:user1', handle: 'user1.bsky.social' },
          { did: 'did:user2', handle: 'user2.bsky.social' },
        ],
        userBlockCaches: {
          'did:user1': {
            did: 'did:user1',
            handle: 'user1.bsky.social',
            bloomFilter: { bits: 'AAAA', size: 64, numHashes: 7, count: 1, mockBlocks: ['did:profile'] },
            blockCount: 1,
            lastSynced: Date.now(),
          },
          'did:user2': {
            did: 'did:user2',
            handle: 'user2.bsky.social',
            bloomFilter: { bits: 'BBBB', size: 64, numHashes: 7, count: 0, mockBlocks: [] },
            blockCount: 0,
            lastSynced: Date.now(),
          },
        },
        lastFullSync: Date.now(),
        currentUserDid: 'did:me',
      };

      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({
        blockCache: mockCache,
      } as StorageResult);

      const candidates = await getCandidateBlockers('did:profile');

      expect(candidates).toHaveLength(1);
      expect(candidates[0].handle).toBe('user1.bsky.social');
    });

    it('should return empty array when no cache exists', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({} as StorageResult);

      const candidates = await getCandidateBlockers('did:profile');

      expect(candidates).toEqual([]);
    });
  });

  describe('lookupBlockingInfo', () => {
    it('should find users from verified blockers list', async () => {
      const mockCache = {
        followedUsers: [
          { did: 'did:user1', handle: 'user1.bsky.social' },
          { did: 'did:user2', handle: 'user2.bsky.social' },
        ],
        userBlockCaches: {
          'did:user1': {
            did: 'did:user1',
            handle: 'user1.bsky.social',
            bloomFilter: { bits: 'AAAA', size: 64, numHashes: 7, count: 1 },
            blockCount: 1,
            lastSynced: Date.now(),
          },
        },
        lastFullSync: Date.now(),
        currentUserDid: 'did:me',
      };

      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({
        blockCache: mockCache,
      } as StorageResult);

      // Verified that user1 blocks the profile
      const result = await lookupBlockingInfo('did:profile', ['did:user1'], []);

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

      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({
        blockCache: mockCache,
      } as StorageResult);

      // Profile blocks user1 (from on-demand fetch)
      const result = await lookupBlockingInfo('did:profile', [], ['did:user1']);

      expect(result.blocking).toHaveLength(1);
      expect(result.blocking[0].handle).toBe('user1.bsky.social');
    });

    it('should return empty arrays when no cache exists', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({} as StorageResult);

      const result = await lookupBlockingInfo('did:profile', [], []);

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
            bloomFilter: { bits: 'AAAA', size: 64, numHashes: 7, count: 1 },
            blockCount: 1,
            lastSynced: Date.now(),
          },
        },
        lastFullSync: Date.now(),
        currentUserDid: 'did:me',
      };

      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({
        blockCache: mockCache,
      } as StorageResult);

      // User1 verified to block profile, profile blocks user1
      const result = await lookupBlockingInfo('did:profile', ['did:user1'], ['did:user1']);

      expect(result.blockedBy).toHaveLength(1);
      expect(result.blocking).toHaveLength(1);
    });
  });

  describe('clearAllData', () => {
    it('should clear all storage data', async () => {
      vi.mocked(chrome.storage.local.clear).mockResolvedValueOnce(undefined);

      await clearAllData();
      expect(chrome.storage.local.clear).toHaveBeenCalled();
    });
  });
});
