import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getSession,
  getProfile,
  getFollows,
  getAllFollows,
  getUserBlocks,
  resolvePds,
  fetchWithRetry,
  sleep,
  chunk,
  clearPdsCache,
} from '../api.js';

describe('API Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPdsCache(); // Clear PDS cache between tests

    const store: Record<string, string> = {};
    const localStorageMock = {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value.toString();
      }),
      clear: vi.fn(() => {
        for (const key in store) delete store[key];
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      key: vi.fn((index: number) => Object.keys(store)[index] || null),
      get length() {
        return Object.keys(store).length;
      },
    };

    Object.setPrototypeOf(localStorageMock, Object.prototype);

    const proxy = new Proxy(localStorageMock, {
      get(target, prop, _receiver) {
        if (prop in target) return target[prop as keyof typeof target];
        if (typeof prop === 'string' && prop in store) return store[prop];
        return undefined;
      },
      ownKeys(_target) {
        return Object.keys(store);
      },
      getOwnPropertyDescriptor(target, prop) {
        if (typeof prop === 'string' && prop in store) {
          return {
            enumerable: true,
            configurable: true,
          };
        }
        return undefined;
      },
    });

    vi.stubGlobal('localStorage', proxy);
    vi.stubGlobal('window', { localStorage: proxy, location: { pathname: '/' } });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getSession', () => {
    it('should return null when no session found', () => {
      const session = getSession();
      expect(session).toBeNull();
    });

    it('should extract session from direct account object', () => {
      const mockSession = {
        accessJwt: 'test-jwt-123',
        did: 'did:plc:test123',
        handle: 'testuser.bsky.social',
        pdsUrl: 'https://pds.example.com',
      };
      localStorage.setItem('BSKY_STORAGE', JSON.stringify(mockSession));

      const session = getSession();
      expect(session).not.toBeNull();
      expect(session?.accessJwt).toBe('test-jwt-123');
      expect(session?.did).toBe('did:plc:test123');
      expect(session?.handle).toBe('testuser.bsky.social');
    });

    it('should extract session from nested structure', () => {
      const mockSession = {
        session: {
          currentAccount: { did: 'did:plc:test456' },
          accounts: [
            {
              did: 'did:plc:test456',
              accessJwt: 'jwt-456',
              pdsUrl: 'https://pds.test.com',
            },
          ],
        },
      };
      localStorage.setItem('BSKY_STATE', JSON.stringify(mockSession));

      const session = getSession();
      expect(session?.accessJwt).toBe('jwt-456');
    });

    it('should extract session from currentAccount structure (without session wrapper)', () => {
      const mockSession = {
        currentAccount: { did: 'did:plc:test789' },
        accounts: [
          {
            did: 'did:plc:test789',
            accessJwt: 'jwt-789',
            pdsUrl: 'https://pds.alt.com',
          },
        ],
      };
      localStorage.setItem('bsky_state', JSON.stringify(mockSession));

      const session = getSession();
      expect(session?.accessJwt).toBe('jwt-789');
    });

    it('should use service URL if pdsUrl not available', () => {
      const mockSession = {
        accessJwt: 'jwt',
        did: 'did:test',
        handle: 'test.bsky.social',
        service: 'https://service.bsky.social',
      };
      localStorage.setItem('BSKY_STORAGE', JSON.stringify(mockSession));

      const session = getSession();
      expect(session?.pdsUrl).toBe('https://service.bsky.social');
    });

    it('should use default PDS URL if none provided', () => {
      const mockSession = {
        accessJwt: 'jwt',
        did: 'did:test',
        handle: 'test.bsky.social',
      };
      localStorage.setItem('BSKY_STORAGE', JSON.stringify(mockSession));

      const session = getSession();
      expect(session?.pdsUrl).toBe('https://bsky.social');
    });

    it('should normalize PDS URL', () => {
      const mockSession = {
        accessJwt: 'jwt',
        did: 'did:test',
        handle: 'test.bsky.social',
        pdsUrl: 'pds.test.com/',
      };
      localStorage.setItem('BSKY_STORAGE', JSON.stringify(mockSession));

      const session = getSession();
      expect(session?.pdsUrl).toBe('https://pds.test.com');
    });

    it('should handle invalid JSON in storage', () => {
      localStorage.setItem('BSKY_INVALID', 'not-valid-json{');
      const session = getSession();
      expect(session).toBeNull();
    });

    it('should return null when localStorage is unavailable', () => {
      vi.stubGlobal('window', undefined);
      const session = getSession();
      expect(session).toBeNull();
    });

    it('should handle empty storage item', () => {
      localStorage.setItem('BSKY_EMPTY', '');
      const session = getSession();
      expect(session).toBeNull();
    });

    it('should skip accounts without accessJwt', () => {
      const mockSession = {
        session: {
          currentAccount: { did: 'did:plc:noauth' },
          accounts: [
            {
              did: 'did:plc:noauth',
              // No accessJwt
              pdsUrl: 'https://pds.test.com',
            },
          ],
        },
      };
      localStorage.setItem('BSKY_STATE', JSON.stringify(mockSession));

      const session = getSession();
      expect(session).toBeNull();
    });
  });

  describe('getProfile', () => {
    it('should fetch profile by handle', async () => {
      const mockProfile = {
        did: 'did:plc:profile123',
        handle: 'testuser.bsky.social',
        displayName: 'Test User',
      };

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(mockProfile), { status: 200 })
      );

      const profile = await getProfile('testuser.bsky.social');
      expect(profile?.did).toBe('did:plc:profile123');
      expect(profile?.handle).toBe('testuser.bsky.social');
    });

    it('should return null on API error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));

      const profile = await getProfile('notfound.bsky.social');
      expect(profile).toBeNull();
    });

    it('should return null on network error', async () => {
      // Mock all retries to fail
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const profile = await getProfile('test.bsky.social');
      expect(profile).toBeNull();
    }, 10000);
  });

  describe('getFollows', () => {
    it('should fetch paginated follows', async () => {
      const mockResponse = {
        follows: [
          { did: 'did:follow1', handle: 'user1.bsky.social', displayName: 'User 1' },
          { did: 'did:follow2', handle: 'user2.bsky.social', displayName: 'User 2' },
        ],
        cursor: 'next-cursor',
      };

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const result = await getFollows('did:source');
      expect(result.follows).toHaveLength(2);
      expect(result.follows[0].handle).toBe('user1.bsky.social');
      expect(result.cursor).toBe('next-cursor');
    });

    it('should include cursor in request when provided', async () => {
      const mockResponse = {
        follows: [],
        cursor: undefined,
      };

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      await getFollows('did:source', 'page2-cursor');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('cursor=page2-cursor'),
        expect.anything()
      );
    });

    it('should throw on API error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 500 }));

      await expect(getFollows('did:source')).rejects.toThrow('Failed to get follows');
    });
  });

  describe('getAllFollows', () => {
    it('should fetch all follows with pagination', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              follows: [{ did: 'did:1', handle: 'user1.bsky.social' }],
              cursor: 'page2',
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              follows: [{ did: 'did:2', handle: 'user2.bsky.social' }],
              cursor: undefined,
            }),
            { status: 200 }
          )
        );

      const allFollows = await getAllFollows('did:source');
      expect(allFollows).toHaveLength(2);
      expect(allFollows[0].handle).toBe('user1.bsky.social');
    });
  });

  describe('getUserBlocks', () => {
    it('should fetch user blocks', async () => {
      const mockResponse = {
        records: [
          {
            uri: 'at://did:user/app.bsky.graph.block/record1',
            cid: 'cid1',
            value: {
              $type: 'app.bsky.graph.block',
              subject: 'did:blocked1',
              createdAt: '2024-01-01T00:00:00Z',
            },
          },
        ],
      };

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const blocks = await getUserBlocks('did:user', 'https://pds.test.com');
      expect(blocks).toContain('did:blocked1');
    });

    it('should return empty array on API error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));

      const blocks = await getUserBlocks('did:user', 'https://pds.test.com');
      expect(blocks).toEqual([]);
    });

    it('should resolve PDS if not provided', async () => {
      // First call for PDS resolution
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            service: [{ id: '#atproto_pds', serviceEndpoint: 'https://resolved.pds.com' }],
          }),
          { status: 200 }
        )
      );
      // Second call for blocks
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ records: [] }), { status: 200 })
      );

      const blocks = await getUserBlocks('did:plc:testuser');
      expect(blocks).toEqual([]);
    });

    it('should use default PDS when resolution fails', async () => {
      // PDS resolution fails
      vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));
      // Blocks call to default PDS
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ records: [] }), { status: 200 })
      );

      const blocks = await getUserBlocks('did:plc:testuser');
      expect(blocks).toEqual([]);
    });

    it('should handle pagination for block lists', async () => {
      // First page
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            records: [{ value: { subject: 'did:blocked1' } }],
            cursor: 'page2',
          }),
          { status: 200 }
        )
      );
      // Second page
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            records: [{ value: { subject: 'did:blocked2' } }],
          }),
          { status: 200 }
        )
      );

      const blocks = await getUserBlocks('did:user', 'https://pds.test.com');
      expect(blocks).toContain('did:blocked1');
      expect(blocks).toContain('did:blocked2');
    });

    it('should handle records with missing subject', async () => {
      const mockResponse = {
        records: [
          { value: { subject: 'did:valid' } },
          { value: {} }, // Missing subject
        ],
      };

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const blocks = await getUserBlocks('did:user', 'https://pds.test.com');
      expect(blocks).toEqual(['did:valid']);
    });
  });

  describe('resolvePds', () => {
    it('should resolve PDS from DID', async () => {
      const mockDoc = {
        service: [
          {
            id: '#atproto_pds',
            type: 'AtprotoPersonalDataServer',
            serviceEndpoint: 'https://pds.bsky.social',
          },
        ],
      };

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(mockDoc), { status: 200 })
      );

      const pds = await resolvePds('did:plc:test123');
      expect(pds).toBe('https://pds.bsky.social');
    });

    it('should return null for non-plc DIDs', async () => {
      const pds = await resolvePds('did:key:test');
      expect(pds).toBeNull();
    });

    it('should return null on API error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));

      const pds = await resolvePds('did:plc:test123');
      expect(pds).toBeNull();
    });

    it('should return null on network error', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      const pds = await resolvePds('did:plc:test123');
      expect(pds).toBeNull();
    });

    it('should return null when no PDS service in document', async () => {
      const mockDoc = {
        service: [{ id: '#other_service', serviceEndpoint: 'https://other.com' }],
      };

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(mockDoc), { status: 200 })
      );

      const pds = await resolvePds('did:plc:test123');
      expect(pds).toBeNull();
    });
  });

  describe('fetchWithRetry', () => {
    it('should retry on 429 status', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response('', { status: 429 }))
        .mockResolvedValueOnce(new Response('success', { status: 200 }));

      const response = await fetchWithRetry('https://test.api', {}, 3, 10);
      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on network error', async () => {
      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(new Response('success', { status: 200 }));

      const response = await fetchWithRetry('https://test.api', {}, 3, 10);
      expect(response.status).toBe(200);
    });

    it('should throw after max retries', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      await expect(fetchWithRetry('https://test.api', {}, 1, 10)).rejects.toThrow();
    });
  });

  describe('sleep', () => {
    it('should delay execution', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });

  describe('chunk', () => {
    it('should split array into chunks', () => {
      const arr = [1, 2, 3, 4, 5];
      const chunks = chunk(arr, 2);
      expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('should handle empty array', () => {
      const chunks = chunk([], 2);
      expect(chunks).toEqual([]);
    });

    it('should handle chunk size larger than array', () => {
      const arr = [1, 2];
      const chunks = chunk(arr, 5);
      expect(chunks).toEqual([[1, 2]]);
    });
  });
});
