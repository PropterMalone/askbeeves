# AskBeeves Context Document

## Project Overview

Chrome extension for checking block status (Blocking/Blocked By) of follows on Bluesky profiles.

## Tech Stack

- TypeScript (strict mode)
- esbuild bundler
- Vitest for testing
- Chrome Extension Manifest V3
- Bloom Filters for efficient storage
- Bluesky AT Protocol API

## Key Files

### Core Logic

- `src/background.ts` - Service worker: handles syncing follows and block lists, manages bloom filters.
- `src/content.ts` - Content script: injects UI into profile pages on `bsky.app`.
- `src/bloom.ts` - Implementation of bloom filters for compressed storage of block lists.
- `src/api.ts` - AT Protocol API helpers (`app.bsky.graph.getFollows`, `com.atproto.repo.listRecords`).
- `src/storage.ts` - Chrome storage wrappers.

### UI

- `src/options.ts` + `src/options.html` - Extension settings (Compact vs Detailed mode).

## Data Structures

### Bloom Filters

Used to store the set of blocked DIDs for each followed user.

- **Space Efficiency**: ~3% of raw storage.
- **Privacy**: Local storage only.

### Storage Keys (chrome.storage.local)

- `follows`: List of users the current user follows.
- `blockLists`: Map of DID -> BloomFilter data.
- `lastSync`: Timestamp of last sync.
- `options`: User preferences (display mode).

## Workflow

1.  **Sync (Background)**:
    - Fetches user's follows.
    - For each follow, fetches their public block list (repo records).
    - Compresses block list into a Bloom Filter.
    - Saves to `chrome.storage.local`.

2.  **Check (Content)**:
    - User visits a profile.
    - Content script extracts the profile DID.
    - Queries background/storage to check if any followed user's bloom filter contains this DID.
    - If a match is found (probabilistic), verification _may_ occur (implementation detail: check if false positives are handled via on-demand fetch or if UI indicates uncertainty).

## Build Commands

```bash
npm run build          # Build for Chrome
npm run test           # Run tests
npm run lint           # ESLint
npm run validate       # Run all checks
```
