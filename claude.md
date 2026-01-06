# AskBeeves Development Guidelines

## Project Overview

AskBeeves is a Chrome extension for Bluesky that shows blocking relationships. It uses TypeScript, Chrome Extension APIs, and the AT Protocol.

## TypeScript Best Practices

### Type Safety

```typescript
// GOOD: Explicit return types and null handling
export async function getBlockCache(): Promise<BlockCacheData | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.BLOCK_CACHE);
  const data = result[STORAGE_KEYS.BLOCK_CACHE] as BlockCacheData | undefined;
  return data || null;
}

// BAD: Implicit any and unsafe assertions
async function getBlockCache() {
  const result = await chrome.storage.local.get('blockCache');
  return result.blockCache as BlockCacheData; // Dangerous if undefined
}
```

### Interface Design

- Use `interface` for object shapes that may be extended
- Use `type` for unions, intersections, and aliases
- Export types from a central `types.ts` file
- Prefer explicit property types over `any`

```typescript
// GOOD: Well-defined interfaces with optional properties marked
export interface FollowedUser {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

// BAD: Loose typing
interface User {
  [key: string]: any;
}
```

### Const Assertions

Use `as const` for literal objects that shouldn't be modified:

```typescript
export const STORAGE_KEYS = {
  BLOCK_CACHE: 'blockCache',
  SYNC_STATUS: 'syncStatus',
  AUTH_TOKEN: 'authToken',
  SETTINGS: 'settings',
} as const;
```

### Discriminated Unions for Messages

```typescript
export type MessageType =
  | 'SET_AUTH'
  | 'GET_BLOCKING_INFO'
  | 'FETCH_PROFILE_BLOCKS'
  | 'TRIGGER_SYNC'
  | 'GET_SYNC_STATUS'
  | 'CLEAR_CACHE';

export interface Message {
  type: MessageType;
  profileDid?: string;
  handle?: string;
  auth?: BskySession;
}
```

## Security Guidelines

### Input Validation

Always validate external input before use:

```typescript
// GOOD: Validate DID format before API calls
export async function resolvePds(did: string): Promise<string | null> {
  if (!did.startsWith('did:plc:')) {
    return null;
  }
  // ... proceed with API call
}

// GOOD: Sanitize URLs
let pdsUrl = account.pdsUrl || account.service || BSKY_PDS_DEFAULT;
pdsUrl = pdsUrl.replace(/\/+$/, '');
if (!pdsUrl.startsWith('http://') && !pdsUrl.startsWith('https://')) {
  pdsUrl = 'https://' + pdsUrl;
}
```

### URL Construction

Use `URLSearchParams` for query parameters to prevent injection:

```typescript
// GOOD: Safe URL construction
const params = new URLSearchParams({
  actor: did,
  limit: '100',
});
if (cursor) params.set('cursor', cursor);
const url = `${BSKY_PUBLIC_API}/xrpc/app.bsky.graph.getFollows?${params}`;

// BAD: String concatenation vulnerable to injection
const url = `${api}/xrpc/endpoint?actor=${did}&cursor=${cursor}`;
```

### DOM Manipulation

Use `textContent` instead of `innerHTML` for user-provided content:

```typescript
// GOOD: Safe text insertion
element.textContent = userProvidedText;

// BAD: XSS vulnerability
element.innerHTML = userProvidedText;
```

When HTML is needed, create elements programmatically:

```typescript
// GOOD: Programmatic element creation
const link = document.createElement('a');
link.href = sanitizedUrl;
link.textContent = displayText;
container.appendChild(link);
```

### Error Handling

Never expose internal errors to users. Log details internally, show generic messages:

```typescript
// GOOD: Safe error handling
try {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return await response.json();
} catch (error) {
  console.error('[AskBeeves] API error:', error);
  return null; // Return safe default
}

// BAD: Exposing error details
catch (error) {
  alert(error.message); // May leak sensitive info
}
```

### Sensitive Data

- Never log JWT tokens or credentials
- Store auth tokens in `chrome.storage.local` (not localStorage)
- Clear sensitive data when no longer needed

```typescript
// Auth tokens stored securely in extension storage
export async function storeAuth(auth: BskySession): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.AUTH_TOKEN]: auth });
}
```

## API Patterns

### Fetch with Retry

Implement exponential backoff for resilient API calls:

```typescript
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
```

### Rate Limiting

Be respectful of external APIs:

```typescript
// Small delay between paginated requests
if (cursor) await sleep(100);
```

### Caching

Use in-memory caches for frequently accessed data:

```typescript
const pdsCache = new Map<string, string>();

export async function resolvePds(did: string): Promise<string | null> {
  const cached = pdsCache.get(did);
  if (cached) return cached;

  // ... fetch and cache result
  if (pdsUrl) pdsCache.set(did, pdsUrl);
  return pdsUrl;
}
```

## Chrome Extension Patterns

### Message Passing

Use typed message handlers:

```typescript
chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse): boolean => {
    handleMessage(message).then(sendResponse);
    return true; // Keep channel open for async response
  }
);
```

### Storage Access

Prefer async/await over callbacks:

```typescript
// GOOD: Async/await
const result = await chrome.storage.local.get(STORAGE_KEYS.BLOCK_CACHE);

// AVOID: Callback style
chrome.storage.local.get(key, (result) => { ... });
```

### Content Script Isolation

Content scripts run in isolated worlds. Access page data through specific APIs only:

```typescript
// Access page localStorage safely
const getLocalStorage = () => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
};
```

## Testing

### Test File Location

Place tests in `src/__tests__/` with `.test.ts` suffix.

### Mocking Chrome APIs

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock chrome.storage
const mockStorage = new Map();
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((key) => Promise.resolve({ [key]: mockStorage.get(key) })),
      set: vi.fn((data) => {
        Object.entries(data).forEach(([k, v]) => mockStorage.set(k, v));
        return Promise.resolve();
      }),
    },
  },
});
```

### Testing Async Functions

```typescript
it('should return null for invalid DID', async () => {
  const result = await resolvePds('invalid-did');
  expect(result).toBeNull();
});
```

## Code Style

### Imports

- Use `.js` extension for local imports (ESM requirement)
- Group imports: external packages, then local modules

```typescript
import { vi, describe, it, expect } from 'vitest';

import { getBlockCache, saveBlockCache } from './storage.js';
import { BlockCacheData, FollowedUser } from './types.js';
```

### Naming Conventions

- `camelCase` for variables and functions
- `PascalCase` for interfaces and types
- `SCREAMING_SNAKE_CASE` for constants
- Prefix private/internal with underscore only when necessary

### Comments

- Use JSDoc for exported functions
- Avoid obvious comments
- Explain "why" not "what"

```typescript
/**
 * Get block list for any user (PUBLIC - no auth required)
 * Uses com.atproto.repo.listRecords which is public
 */
export async function getUserBlocks(did: string, pdsUrl?: string): Promise<string[]> {
```

## Performance

### Efficient Lookups

Use `Set` or `Map` for large collections:

```typescript
// Use Set for O(1) lookup when block list is large
const hasBlock =
  userCache.blocks.length > 20
    ? new Set(userCache.blocks).has(profileDid)
    : userCache.blocks.includes(profileDid);
```

### Avoid Redundant Storage Reads

Pass pre-fetched data when available:

```typescript
export async function getBlockers(
  profileDid: string,
  cache?: BlockCacheData | null // Accept pre-fetched cache
): Promise<FollowedUser[]> {
  const blockCache = cache ?? (await getBlockCache());
  // ...
}
```

## Commands

```bash
npm test              # Run tests
npm run test:coverage # Run with coverage
npm run type-check    # TypeScript validation
npm run lint          # ESLint
npm run format        # Prettier
npm run build         # Production build
```
