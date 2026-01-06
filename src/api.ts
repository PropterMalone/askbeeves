/**
 * AskBeeves - AT Protocol API helpers
 */

import {
  BskySession,
  BskyAccount,
  StorageStructure,
  Profile,
  FollowedUser,
  GetFollowsResponse,
  ListRecordsResponse,
  PlcDocument,
} from './types.js';

// Public Bluesky API endpoint (AppView)
const BSKY_PUBLIC_API = 'https://public.api.bsky.app';
// Default PDS
const BSKY_PDS_DEFAULT = 'https://bsky.social';
// PLC directory for DID resolution
const PLC_DIRECTORY = 'https://plc.directory';

// In-memory PDS URL cache to avoid repeated resolution during a session
const pdsCache = new Map<string, string>();

/**
 * Populate the PDS cache from stored data
 * Called by background script on startup
 */
export function populatePdsCache(entries: Array<{ did: string; pdsUrl: string }>): void {
  for (const entry of entries) {
    if (entry.pdsUrl) {
      pdsCache.set(entry.did, entry.pdsUrl);
    }
  }
}

/**
 * Get cached PDS URL if available
 */
export function getCachedPds(did: string): string | undefined {
  return pdsCache.get(did);
}

/**
 * Cache a PDS URL for a DID
 */
export function cachePds(did: string, pdsUrl: string): void {
  pdsCache.set(did, pdsUrl);
}

/**
 * Clear the PDS cache (for testing)
 */
export function clearPdsCache(): void {
  pdsCache.clear();
}

// Helper to safely access localStorage
const getLocalStorage = () => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
};

/**
 * Get the current session from Bluesky's localStorage
 */
export function getSession(): BskySession | null {
  try {
    const localStorageProxy = getLocalStorage();
    if (!localStorageProxy) {
      console.log('[AskBeeves API] localStorage not available');
      return null;
    }

    // Try multiple possible storage key patterns
    const allKeys = Object.keys(localStorageProxy);
    console.log('[AskBeeves API] All localStorage keys:', allKeys);

    const possibleKeys = allKeys.filter(
      (k) => k.includes('BSKY') || k.includes('bsky') || k.includes('session')
    );
    console.log('[AskBeeves API] Filtered keys:', possibleKeys);

    for (const storageKey of possibleKeys) {
      try {
        const raw = localStorageProxy.getItem(storageKey);
        if (!raw) continue;

        const parsed = JSON.parse(raw) as StorageStructure;

        let account: BskyAccount | null = null;

        // Structure 1: { session: { currentAccount: {...}, accounts: [...] } }
        if (parsed?.session?.currentAccount) {
          const currentDid = parsed.session.currentAccount.did;
          account = parsed.session.accounts?.find((a) => a.did === currentDid) || null;
        }

        // Structure 2: { currentAccount: {...}, accounts: [...] }
        if (!account && parsed?.currentAccount) {
          const currentDid = parsed.currentAccount.did;
          account = parsed.accounts?.find((a) => a.did === currentDid) || null;
        }

        // Structure 3: Direct account object
        if (!account && parsed?.accessJwt && parsed?.did) {
          account = parsed as unknown as BskyAccount;
        }

        if (account && account.accessJwt && account.did) {
          // Normalize the PDS URL
          let pdsUrl = account.pdsUrl || account.service || BSKY_PDS_DEFAULT;
          pdsUrl = pdsUrl.replace(/\/+$/, '');
          if (!pdsUrl.startsWith('http://') && !pdsUrl.startsWith('https://')) {
            pdsUrl = 'https://' + pdsUrl;
          }

          return {
            accessJwt: account.accessJwt,
            refreshJwt: account.refreshJwt,
            did: account.did,
            handle: account.handle || '',
            pdsUrl,
          };
        }
      } catch {
        // Continue to next key
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a DID to its PDS URL via PLC directory
 * Uses in-memory cache to avoid repeated lookups
 */
export async function resolvePds(did: string): Promise<string | null> {
  try {
    if (!did.startsWith('did:plc:')) {
      return null;
    }

    // Check cache first
    const cached = pdsCache.get(did);
    if (cached) {
      return cached;
    }

    const response = await fetch(`${PLC_DIRECTORY}/${did}`);
    if (!response.ok) return null;

    const doc = (await response.json()) as PlcDocument;
    const pds = doc.service?.find((s) => s.id === '#atproto_pds');
    const pdsUrl = pds?.serviceEndpoint || null;

    // Cache the result
    if (pdsUrl) {
      pdsCache.set(did, pdsUrl);
    }

    return pdsUrl;
  } catch {
    return null;
  }
}

/**
 * Fetch with retry and exponential backoff
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = 3,
  backoff = 1000
): Promise<Response> {
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

/**
 * Get a user's profile by handle or DID
 */
export async function getProfile(actor: string): Promise<Profile | null> {
  try {
    const url = `${BSKY_PUBLIC_API}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
    const response = await fetchWithRetry(url);

    if (!response.ok) return null;

    const data = (await response.json()) as Profile;
    return {
      did: data.did,
      handle: data.handle,
      displayName: data.displayName,
      avatar: data.avatar,
    };
  } catch {
    return null;
  }
}

/**
 * Get list of users the specified user follows (paginated)
 */
export async function getFollows(
  did: string,
  cursor?: string
): Promise<{ follows: FollowedUser[]; cursor?: string }> {
  const params = new URLSearchParams({
    actor: did,
    limit: '100',
  });
  if (cursor) params.set('cursor', cursor);

  const url = `${BSKY_PUBLIC_API}/xrpc/app.bsky.graph.getFollows?${params}`;
  const response = await fetchWithRetry(url);

  if (!response.ok) {
    throw new Error(`Failed to get follows: ${response.status}`);
  }

  const data = (await response.json()) as GetFollowsResponse;

  return {
    follows: data.follows.map((f) => ({
      did: f.did,
      handle: f.handle,
      displayName: f.displayName,
      avatar: f.avatar,
    })),
    cursor: data.cursor,
  };
}

/**
 * Get all follows for a user (handles pagination)
 */
export async function getAllFollows(did: string): Promise<FollowedUser[]> {
  const allFollows: FollowedUser[] = [];
  let cursor: string | undefined;

  do {
    const result = await getFollows(did, cursor);
    allFollows.push(...result.follows);
    cursor = result.cursor;

    // Small delay to be nice to the API
    if (cursor) await sleep(100);
  } while (cursor);

  return allFollows;
}

/**
 * Get block list for any user (PUBLIC - no auth required)
 * Uses com.atproto.repo.listRecords which is public
 */
export async function getUserBlocks(did: string, pdsUrl?: string): Promise<string[]> {
  const blocks: string[] = [];

  // Resolve PDS if not provided
  let pds: string | null | undefined = pdsUrl;
  if (!pds) {
    pds = await resolvePds(did);
  }
  if (!pds) {
    pds = BSKY_PDS_DEFAULT;
  }

  // Normalize PDS URL
  pds = pds.replace(/\/+$/, '');

  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      repo: did,
      collection: 'app.bsky.graph.block',
      limit: '100',
    });
    if (cursor) params.set('cursor', cursor);

    const url = `${pds}/xrpc/com.atproto.repo.listRecords?${params}`;
    const response = await fetchWithRetry(url);

    if (!response.ok) {
      // User may have blocks hidden, PDS issue, or no blocks - return what we have
      return blocks;
    }

    const data = (await response.json()) as ListRecordsResponse;

    for (const record of data.records || []) {
      if (record.value?.subject) {
        blocks.push(record.value.subject);
      }
    }

    cursor = data.cursor;
  } while (cursor);

  return blocks;
}

/**
 * Sleep helper
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Split array into chunks
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
