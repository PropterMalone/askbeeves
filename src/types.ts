/**
 * AskBeeves - Type definitions
 */

// Session extracted from Bluesky localStorage
export interface BskySession {
  accessJwt: string;
  refreshJwt?: string;
  did: string;
  handle: string;
  pdsUrl: string;
}

// Account structure from Bluesky storage
export interface BskyAccount {
  did: string;
  handle?: string;
  accessJwt?: string;
  refreshJwt?: string;
  service?: string;
  pdsUrl?: string;
}

// Multiple possible storage structures from Bluesky
export interface StorageStructure {
  session?: {
    currentAccount?: BskyAccount;
    accounts?: BskyAccount[];
  };
  currentAccount?: BskyAccount;
  accounts?: BskyAccount[];
  accessJwt?: string;
  did?: string;
  handle?: string;
  service?: string;
  pdsUrl?: string;
}

// User profile from Bluesky API
export interface Profile {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

// A user the logged-in user follows
export interface FollowedUser {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

// Response from app.bsky.graph.getFollows
export interface GetFollowsResponse {
  follows: Array<{
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  }>;
  cursor?: string;
}

// Block record from com.atproto.repo.listRecords
export interface BlockRecord {
  uri: string;
  cid: string;
  value: {
    $type: 'app.bsky.graph.block';
    subject: string;
    createdAt: string;
  };
}

// Response from com.atproto.repo.listRecords
export interface ListRecordsResponse {
  records: BlockRecord[];
  cursor?: string;
}

// Bloom filter data structure (re-exported from bloom.ts for convenience)
export interface BloomFilterData {
  bits: string; // Base64-encoded bit array
  size: number; // Number of bits in the filter
  numHashes: number; // Number of hash functions used
  count: number; // Number of elements added
}

// Cached block list for a single user (legacy - full DID array)
export interface UserBlockCache {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  blocks: string[]; // Array of DIDs this user blocks
  lastSynced: number;
}

// Space-efficient block cache using bloom filter (hybrid approach)
export interface UserBlockBloomCache {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  pdsUrl?: string; // Cached PDS URL to avoid re-resolution
  bloomFilter: BloomFilterData; // Bloom filter for "might contain" checks
  blockCount: number; // Total number of blocks (for stats)
  lastSynced: number;
}

// Main cache structure stored in chrome.storage.local (bloom filter version)
export interface BlockCacheData {
  followedUsers: FollowedUser[];
  userBlockCaches: Record<string, UserBlockBloomCache>; // Now uses bloom filters
  lastFullSync: number;
  currentUserDid: string;
}

// Sync status for tracking progress
export interface SyncStatus {
  totalFollows: number;
  syncedFollows: number;
  lastSync: number;
  isRunning: boolean;
  lastUpdated: number; // Timestamp of last status update (for stale lock detection)
  errors: string[];
}

// Result for profile page display
export interface BlockingInfo {
  blockedBy: FollowedUser[]; // Users you follow who block this profile
  blocking: FollowedUser[]; // Users you follow that this profile blocks
}

// PLC directory document structure
export interface PlcDocument {
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
}

// Message types for background/content script communication
export type MessageType =
  | 'SET_AUTH'
  | 'GET_BLOCKING_INFO'
  | 'GET_VERIFIED_BLOCKERS'
  | 'FETCH_PROFILE_BLOCKS'
  | 'TRIGGER_SYNC'
  | 'GET_SYNC_STATUS'
  | 'CLEAR_CACHE';

export interface Message {
  type: MessageType;
  profileDid?: string;
  handle?: string;
  auth?: BskySession;
  candidateDids?: string[]; // For GET_VERIFIED_BLOCKERS
}

export interface MessageResponse {
  success?: boolean;
  error?: string;
  blockingInfo?: BlockingInfo;
  blocks?: string[];
  syncStatus?: SyncStatus;
  verifiedBlockers?: FollowedUser[]; // For GET_VERIFIED_BLOCKERS response
}

// Display mode for blocking info
export type DisplayMode = 'compact' | 'detailed';

// User settings
export interface UserSettings {
  displayMode: DisplayMode; // 'compact' = single sentence, 'detailed' = avatars + names
}

export const DEFAULT_SETTINGS: UserSettings = {
  displayMode: 'compact',
};

// Storage keys
export const STORAGE_KEYS = {
  BLOCK_CACHE: 'blockCache',
  SYNC_STATUS: 'syncStatus',
  AUTH_TOKEN: 'authToken',
  SETTINGS: 'settings',
} as const;
