# AskBeeves for Bluesky - Developer Guide

## Build Commands

- `npm install`: Install dependencies (uses `npm ci` in CI).
- `npm run build`: Bundle TS files to `dist/` (Manifest V3).
- `npm run dev`: Build and watch for changes.
- `npm test`: Run Vitest suite.
- `npm run lint`: ESLint checks for `src/`.
- `npm run format`: Prettier formatting for `src/` and config files.
- `npm run format:check`: Verify formatting without writing changes (used in CI).
- `npm run validate`: Run all checks (lint, type-check, format:check, tests). Use this before pushing.

## Quality Standards & Anti-Laziness Policy

- **Validation Required**: Agents MUST run `npm run validate` before declaring any task complete. This ensures linting, type-checking, formatting, and tests all pass.
- **No Error Suppression**: Never use `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or similar directives to hide warnings or errors. If a tool reports an issue, FIX the underlying cause.
- **Strict Typing**: Avoid using the `any` type. Define proper interfaces or types for all data structures.
- **No Silent Failures**: Ensure all errors are properly handled and logged.
- **Robust Automation**: Ensure all scripts are robust and handle edge cases.
- **Clean Tests**: Tests should be reliable and properly mocked.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  src/content.ts │────▶│  src/background  │────▶│  Bluesky API    │
│  (UI Injection) │     │  (Sync/Cache)    │     │  (AT Protocol)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │
        ▼                        ▼
┌─────────────────┐     ┌──────────────────┐
│  src/bloom.ts   │     │  chrome.storage  │
│  (Efficient     │     │  (Local Data)    │
│   Lookups)      │     │                  │
└─────────────────┘     └──────────────────┘
```

## Project Structure

- **src/**: TypeScript source files.
- **dist/**: Compiled extension (entry points: background.js, content.js, options.js).
- **manifest.json**: Source manifest (bundled and modified into `dist/` during build).
- **scripts/**: Build and asset copy scripts.
- **.github/workflows/**: CI/CD (PR checks).

## CI/CD Pipeline

- **Checks**: Lint (ESLint), Format Check (`npm run format:check`), Type Check, and Tests (Vitest) must pass on every PR.
- **Version Sync**: A `pre-commit` hook runs `npm run sync-version` to keep `manifest.json` in sync with `package.json`.

## Versioning & Manifest Sync

- **Source of Truth**: The `version` in `package.json` is the authoritative version.
- **Automation**:
  - `pre-commit` hook syncs version.
  - Manual update of `manifest.json` version is NOT required. Only update `package.json`.

## Testing

1. Run `npm run build` to generate the `dist/` folder.
2. Load unpacked extension from `dist/` via `chrome://extensions/`.
3. Go to bsky.app and log in.
4. Visit a profile page.
5. Verify that block status appears in the header.
