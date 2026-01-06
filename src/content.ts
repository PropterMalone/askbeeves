/**
 * AskBeeves - Content script for Bluesky profile pages
 * Injects blocking info UI and syncs auth token
 */

import { getSession, getProfile } from './api.js';
import { getSettings } from './storage.js';
import { BlockingInfo, Message, DisplayMode } from './types.js';

let currentObserver: MutationObserver | null = null;
let lastInjectedHandle: string | null = null;
let injectionInProgress = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let containerGuardObserver: MutationObserver | null = null;
let lastBlockingInfo: BlockingInfo | null = null;
let lastDisplayMode: DisplayMode = 'compact';
let lastProfileDid: string | null = null;

// Cached avatar style to avoid repeated DOM queries
let cachedAvatarStyle: { size: string; overlap: string } | null = null;

// Default avatar SVG as data URI (computed once)
const DEFAULT_AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23ccc"/></svg>';

/**
 * Validate and sanitize avatar URL to prevent XSS via javascript: URIs
 */
function getSafeAvatarUrl(url: string | undefined): string {
  if (!url) return DEFAULT_AVATAR;
  if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('data:image/')) {
    return url;
  }
  return DEFAULT_AVATAR;
}

/**
 * Extract profile handle from the URL
 */
function getProfileHandleFromUrl(): string | null {
  const match = window.location.pathname.match(/\/profile\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Find the profile description/bio element to insert our display after
 * Tries multiple strategies to find the right insertion point
 */
function findProfileInsertionPoint(): HTMLElement | null {
  // Strategy 1: Find "Followed by X" row (most reliable when present)
  const followedByXpath = "//*[contains(text(), 'Followed by')]";
  const followedByResult = document.evaluate(
    followedByXpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  );
  const followedByElement = followedByResult.singleNodeValue as HTMLElement | null;

  if (followedByElement) {
    // Walk up to find the row container
    let parent = followedByElement.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      if (style.display === 'flex' && style.flexDirection === 'row') {
        const grandparent = parent.parentElement;
        if (grandparent) {
          const gpStyle = window.getComputedStyle(grandparent);
          if (gpStyle.display === 'flex' && gpStyle.flexDirection === 'column') {
            return parent;
          }
        }
      }
      parent = parent.parentElement;
    }
    return followedByElement.parentElement;
  }

  // Strategy 2: Find the profile stats row (followers/following counts)
  // Look for elements containing "followers" text
  const followersXpath = "//*[contains(text(), 'followers')]";
  const followersResult = document.evaluate(
    followersXpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  );
  const followersElement = followersResult.singleNodeValue as HTMLElement | null;

  if (followersElement) {
    // Walk up to find a suitable container
    let parent = followersElement.parentElement;
    let depth = 0;
    while (parent && depth < 5) {
      const style = window.getComputedStyle(parent);
      if (style.display === 'flex') {
        return parent;
      }
      parent = parent.parentElement;
      depth++;
    }
    return followersElement.parentElement;
  }

  // Strategy 3: Find profile bio/description area by looking for the profile header structure
  // Bluesky profiles have a specific structure with avatar, name, handle, bio
  const profileSelectors = [
    '[data-testid="profileHeaderDescription"]',
    '[data-testid="profileHeader"]',
  ];

  for (const selector of profileSelectors) {
    const element = document.querySelector(selector) as HTMLElement | null;
    if (element) {
      return element;
    }
  }

  return null;
}

/**
 * Randomly sample n items from an array (Fisher-Yates shuffle on copy, then slice)
 */
function randomSample<T>(array: T[], n: number): T[] {
  if (array.length <= n) return array;
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/**
 * Format a list of users for display (text only)
 * Uses the provided sampled users (should be pre-sampled for consistency with avatars)
 */
function formatUserList(
  sampledUsers: Array<{ displayName?: string; handle: string; avatar?: string }>,
  totalCount: number
): string {
  if (sampledUsers.length === 0) return '';

  const names = sampledUsers.map((u) => u.displayName || `@${u.handle}`).join(', ');

  if (totalCount > sampledUsers.length) {
    const remaining = totalCount - sampledUsers.length;
    return `${names}, and ${remaining} other${remaining === 1 ? '' : 's'}`;
  }

  return names;
}

/**
 * Get avatar styling from Bluesky's "Followed by" section (cached)
 */
function getFollowedByAvatarStyle(): { size: string; overlap: string } {
  // Return cached value if available
  if (cachedAvatarStyle) {
    return cachedAvatarStyle;
  }

  // Find avatar images in the "Followed by" row
  const followedByText = document.evaluate(
    "//*[contains(text(), 'Followed by')]",
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue as HTMLElement | null;

  if (followedByText) {
    const parent = followedByText.parentElement;
    if (parent) {
      const imgs = parent.querySelectorAll('img');
      if (imgs.length > 0) {
        const firstImg = imgs[0] as HTMLElement;
        const style = window.getComputedStyle(firstImg);
        const size = style.width || '32px';
        let overlap = '-8px';
        if (imgs.length > 1) {
          const secondStyle = window.getComputedStyle(imgs[1]);
          overlap = secondStyle.marginLeft || '-8px';
        }
        cachedAvatarStyle = { size, overlap };
        return cachedAvatarStyle;
      }
    }
  }

  // Fallback defaults
  cachedAvatarStyle = { size: '32px', overlap: '-8px' };
  return cachedAvatarStyle;
}

/**
 * Create a row of profile picture thumbnails (matches Bluesky's "Followed by" style)
 * Takes pre-sampled users for consistency with text display
 */
function createAvatarRow(
  sampledUsers: Array<{ displayName?: string; handle: string; avatar?: string }>
): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;align-items:center;margin-right:4px';

  const { size, overlap } = getFollowedByAvatarStyle();

  // Display up to 3 avatars
  const count = Math.min(sampledUsers.length, 3);
  for (let i = 0; i < count; i++) {
    const user = sampledUsers[i];
    const avatar = document.createElement('img');
    avatar.src = getSafeAvatarUrl(user.avatar);
    avatar.alt = user.displayName || user.handle;
    avatar.title = user.displayName || `@${user.handle}`;
    avatar.style.cssText = `width:${size};height:${size};border-radius:50%;object-fit:cover;margin-left:${i > 0 ? overlap : '0'};position:relative;z-index:${3 - i};box-shadow:0 0 0 2px white`;
    avatar.onerror = () => { avatar.src = DEFAULT_AVATAR; };
    container.appendChild(avatar);
  }

  return container;
}

/**
 * Create a modal to show all users in a list
 */
function showFullListModal(
  users: Array<{ displayName?: string; handle: string; avatar?: string; did?: string }>,
  title: string
): void {
  // Remove any existing modal
  document.getElementById('askbeeves-full-list-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'askbeeves-full-list-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10001';

  const dialog = document.createElement('div');
  dialog.style.cssText = 'background:white;border-radius:12px;padding:20px;min-width:320px;max-width:480px;max-height:60vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.2);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';

  const titleEl = document.createElement('h3');
  titleEl.style.cssText = 'margin:0 0 16px 0;font-size:16px;font-weight:600;color:#425780';
  titleEl.textContent = title;

  const listEl = document.createElement('div');
  listEl.style.cssText = 'display:flex;flex-direction:column;gap:4px';

  // Use DocumentFragment to batch DOM operations
  const fragment = document.createDocumentFragment();
  for (const user of users) {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #e5e7eb';

    const avatar = document.createElement('img');
    avatar.src = getSafeAvatarUrl(user.avatar);
    avatar.alt = user.displayName || user.handle;
    avatar.style.cssText = 'width:32px;height:32px;border-radius:50%;object-fit:cover';
    avatar.onerror = () => { avatar.src = DEFAULT_AVATAR; };

    const textContainer = document.createElement('div');
    textContainer.style.cssText = 'display:flex;flex-direction:column';

    if (user.displayName) {
      const displayNameEl = document.createElement('span');
      displayNameEl.style.cssText = 'font-size:14px;font-weight:600;color:#1a1a1a';
      displayNameEl.textContent = user.displayName;
      textContainer.appendChild(displayNameEl);
    }

    const handleEl = document.createElement('span');
    handleEl.style.cssText = 'font-size:13px;color:#687882';
    handleEl.textContent = `@${user.handle}`;
    textContainer.appendChild(handleEl);

    item.appendChild(avatar);
    item.appendChild(textContainer);
    fragment.appendChild(item);
  }
  listEl.appendChild(fragment);

  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = 'margin-top:16px;padding:10px 16px;border:none;border-radius:8px;background:#1083fe;color:white;cursor:pointer;font-size:14px;font-weight:600;width:100%';
  closeBtn.textContent = 'Close';
  closeBtn.onclick = () => overlay.remove();

  dialog.append(titleEl, listEl, closeBtn);
  overlay.appendChild(dialog);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  document.body.appendChild(overlay);
}

/**
 * Create compact display mode: "Blocked by X people you follow and blocking Y people you follow."
 */
function createCompactDisplay(
  blockingInfo: BlockingInfo,
  onBlockedByClick: () => void,
  onBlockingClick: () => void
): HTMLElement {
  const container = document.createElement('div');
  container.id = 'askbeeves-blocking-container';
  container.style.cssText = `
    margin-top: 8px;
    font-size: 13px;
    line-height: 18px;
    color: rgb(66, 87, 108);
  `;

  const blockedByCount = blockingInfo.blockedBy.length;
  const blockingCount = blockingInfo.blocking.length;

  console.log('[AskBeeves] Compact display - blockedBy:', blockedByCount, 'blocking:', blockingCount);

  // If nothing to show
  if (blockedByCount === 0 && blockingCount === 0) {
    container.textContent = 'Not blocked by or blocking anyone you follow.';
    return container;
  }

  // Build the sentence with proper spacing using innerHTML
  // This avoids flex container whitespace issues
  const blockedByText =
    blockedByCount > 0
      ? `Blocked by ${blockedByCount} ${blockedByCount === 1 ? 'person' : 'people'} you follow`
      : 'Not blocked by anyone you follow';

  const blockingText =
    blockingCount > 0
      ? `blocking ${blockingCount} ${blockingCount === 1 ? 'person' : 'people'} you follow`
      : 'not blocking anyone you follow';

  // Create clickable span for blocked by (only if there are blockers)
  if (blockedByCount > 0) {
    const blockedBySpan = document.createElement('span');
    blockedBySpan.style.cssText = 'cursor: pointer;';
    blockedBySpan.textContent = blockedByText;
    blockedBySpan.addEventListener('click', onBlockedByClick);
    blockedBySpan.addEventListener('mouseenter', () => {
      blockedBySpan.style.textDecoration = 'underline';
    });
    blockedBySpan.addEventListener('mouseleave', () => {
      blockedBySpan.style.textDecoration = 'none';
    });
    container.appendChild(blockedBySpan);
  } else {
    container.appendChild(document.createTextNode(blockedByText));
  }

  // Add separator as text node
  container.appendChild(document.createTextNode(' and '));

  // Create clickable span for blocking (only if there are blocks)
  if (blockingCount > 0) {
    const blockingSpan = document.createElement('span');
    blockingSpan.style.cssText = 'cursor: pointer;';
    blockingSpan.textContent = blockingText;
    blockingSpan.addEventListener('click', onBlockingClick);
    blockingSpan.addEventListener('mouseenter', () => {
      blockingSpan.style.textDecoration = 'underline';
    });
    blockingSpan.addEventListener('mouseleave', () => {
      blockingSpan.style.textDecoration = 'none';
    });
    container.appendChild(blockingSpan);
  } else {
    container.appendChild(document.createTextNode(blockingText));
  }

  // Add period
  container.appendChild(document.createTextNode('.'));

  return container;
}

/**
 * Create detailed display mode: avatars + names (like "Followed by")
 */
function createDetailedDisplay(
  blockingInfo: BlockingInfo,
  onBlockedByClick: () => void,
  onBlockingClick: () => void
): HTMLElement {
  const container = document.createElement('div');
  container.id = 'askbeeves-blocking-container';
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  `;

  // Helper function to create a row with avatars + text (like "Followed by")
  const createBlockRow = (
    users: Array<{ displayName?: string; handle: string; avatar?: string }>,
    label: string,
    onClick: () => void
  ): HTMLElement => {
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      line-height: 18px;
      color: rgb(66, 87, 108);
      cursor: pointer;
    `;

    // Sample once for consistency between avatars and text
    const sampled = randomSample(users, 3);

    // Add avatars (3 max, matching "Followed by" style)
    const avatarRow = createAvatarRow(sampled);
    row.appendChild(avatarRow);

    // Add text (show 2 names max in text, but avatars show 3)
    const textSpan = document.createElement('span');
    const displayNames = formatUserList(sampled.slice(0, 2), users.length);
    textSpan.textContent = `${label} ${displayNames}`;
    row.appendChild(textSpan);

    // Make entire row clickable to show modal
    row.addEventListener('click', onClick);

    // Hover effect
    row.addEventListener('mouseenter', () => {
      row.style.textDecoration = 'underline';
    });
    row.addEventListener('mouseleave', () => {
      row.style.textDecoration = 'none';
    });

    return row;
  };

  // Helper function to create a text-only row (for "not blocked" messages)
  const createTextOnlyRow = (text: string): HTMLElement => {
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex;
      align-items: center;
      font-size: 13px;
      line-height: 18px;
      color: rgb(66, 87, 108);
    `;
    row.textContent = text;
    return row;
  };

  // "Blocked by" section
  if (blockingInfo.blockedBy.length > 0) {
    const blockedByRow = createBlockRow(
      blockingInfo.blockedBy,
      'Blocked by',
      onBlockedByClick
    );
    container.appendChild(blockedByRow);
  } else {
    container.appendChild(createTextOnlyRow('Not blocked by anyone you follow'));
  }

  // "Blocking" section
  if (blockingInfo.blocking.length > 0) {
    const blockingRow = createBlockRow(
      blockingInfo.blocking,
      'Blocking',
      onBlockingClick
    );
    container.appendChild(blockingRow);
  } else {
    container.appendChild(createTextOnlyRow('Not blocking anyone you follow'));
  }

  return container;
}

/**
 * Create and inject the blocking info container, guarding against React removal
 */
function injectContainer(
  insertionPoint: HTMLElement,
  blockingInfo: BlockingInfo,
  displayMode: DisplayMode,
  _profileDid: string
): void {
  // Click handlers for modals - both use direct lookup now (no bloom filter false positives)
  const onBlockedByClick = () => {
    showFullListModal(
      blockingInfo.blockedBy,
      'Blocked by (users you follow who block this profile)'
    );
  };

  const onBlockingClick = () => {
    showFullListModal(
      blockingInfo.blocking,
      'Blocking (users you follow that this profile blocks)'
    );
  };

  // Create display based on mode
  const container = displayMode === 'compact'
    ? createCompactDisplay(blockingInfo, onBlockedByClick, onBlockingClick)
    : createDetailedDisplay(blockingInfo, onBlockedByClick, onBlockingClick);

  // Insert after the insertion point
  if (insertionPoint.nextSibling) {
    insertionPoint.parentNode?.insertBefore(container, insertionPoint.nextSibling);
  } else {
    insertionPoint.parentNode?.appendChild(container);
  }

  console.log('[AskBeeves] Container injected into DOM');
}

/**
 * Start guarding the container against React removal
 * Watches for removal and re-injects if needed
 */
function startContainerGuard(): void {
  // Stop any existing guard
  if (containerGuardObserver) {
    containerGuardObserver.disconnect();
    containerGuardObserver = null;
  }

  // Create a guard that watches for our container being removed
  containerGuardObserver = new MutationObserver(() => {
    // Check if our container still exists
    const container = document.getElementById('askbeeves-blocking-container');
    if (container) {
      return; // Container still exists, nothing to do
    }

    // Container was removed - check if we should re-inject
    const handle = getProfileHandleFromUrl();
    if (!handle || handle !== lastInjectedHandle || !lastBlockingInfo || !lastProfileDid) {
      return; // Different page or no data
    }

    console.log('[AskBeeves] Container was removed by React, re-injecting...');

    // Find insertion point again and re-inject
    const insertionPoint = findProfileInsertionPoint();
    if (insertionPoint) {
      injectContainer(insertionPoint, lastBlockingInfo, lastDisplayMode, lastProfileDid);
    }
  });

  // Watch the main content area for changes
  const mainContent = document.querySelector('main') || document.body;
  containerGuardObserver.observe(mainContent, {
    childList: true,
    subtree: true,
  });
}

/**
 * Wait for profile insertion point to appear (with timeout)
 * Uses requestAnimationFrame for better performance
 */
async function waitForProfileInsertionPoint(maxWaitMs: number = 5000): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const check = () => {
      const element = findProfileInsertionPoint();
      if (element) {
        resolve(element);
        return;
      }

      if (Date.now() - startTime < maxWaitMs) {
        requestAnimationFrame(check);
      } else {
        resolve(null);
      }
    };

    check();
  });
}

/**
 * Inject blocking info UI into the profile page
 */
async function injectBlockingInfo(): Promise<void> {
  const handle = getProfileHandleFromUrl();
  if (!handle) {
    return;
  }

  // Skip if another injection is in progress
  if (injectionInProgress) {
    console.log('[AskBeeves] Injection already in progress, skipping');
    return;
  }

  // Check current state
  const alreadyInjected = handle === lastInjectedHandle;
  const containerExists = document.getElementById('askbeeves-blocking-container') !== null;

  // Skip only if we've already successfully injected for this exact handle AND the container exists
  if (alreadyInjected && containerExists) {
    console.log('[AskBeeves] Already injected for', handle);
    return;
  }

  injectionInProgress = true;
  console.log('[AskBeeves] Starting injection for', handle);

  // Remove any existing injected elements (might be stale from previous profile)
  const existing = document.getElementById('askbeeves-blocking-container');
  if (existing) existing.remove();

  // Start profile resolution immediately (don't wait for DOM)
  console.log('[AskBeeves] Resolving profile for:', handle);
  const profilePromise = getProfile(handle);

  // Wait for the insertion point to appear (profile may still be loading)
  const insertionPoint = await waitForProfileInsertionPoint();
  if (!insertionPoint) {
    console.log('[AskBeeves] No profile insertion point found after waiting');
    injectionInProgress = false;
    return;
  }

  // Wait for profile resolution
  const profile = await profilePromise;
  if (!profile?.did) {
    console.log('[AskBeeves] Could not resolve profile DID for:', handle);
    injectionInProgress = false;
    return;
  }
  console.log('[AskBeeves] Resolved DID:', profile.did);

  // Show loading indicator immediately
  const loadingContainer = document.createElement('div');
  loadingContainer.id = 'askbeeves-blocking-container';
  loadingContainer.style.cssText = `
    margin-top: 8px;
    font-size: 13px;
    line-height: 18px;
    color: rgb(66, 87, 108);
    opacity: 0.7;
  `;
  loadingContainer.textContent = 'Loading block info...';

  if (insertionPoint.nextSibling) {
    insertionPoint.parentNode?.insertBefore(loadingContainer, insertionPoint.nextSibling);
  } else {
    insertionPoint.parentNode?.appendChild(loadingContainer);
  }

  // Get blocking info from background script
  let response;
  try {
    if (!isExtensionContextValid()) {
      console.log('[AskBeeves] Extension context invalidated, skipping message');
      loadingContainer.remove();
      injectionInProgress = false;
      return;
    }
    response = await chrome.runtime.sendMessage({
      type: 'GET_BLOCKING_INFO',
      profileDid: profile.did,
    } as Message);
  } catch (error) {
    console.log('[AskBeeves] Error sending message:', error);
    loadingContainer.remove();
    injectionInProgress = false;
    return;
  }

  if (!response || !response.success || !response.blockingInfo) {
    console.log('[AskBeeves] Failed to get blocking info:', response?.error);
    loadingContainer.remove();
    injectionInProgress = false;
    return;
  }

  const blockingInfo = response.blockingInfo as BlockingInfo;
  console.log(
    '[AskBeeves] Blocking info:',
    blockingInfo.blockedBy.length,
    'blocked by,',
    blockingInfo.blocking.length,
    'blocking'
  );

  // Get display mode setting
  let displayMode: DisplayMode = 'compact';
  try {
    const settings = await getSettings();
    displayMode = settings.displayMode;
  } catch (error) {
    console.log('[AskBeeves] Could not load settings, using default:', error);
  }

  console.log('[AskBeeves] Display mode:', displayMode);

  // Store the data for potential re-injection if React removes our element
  lastBlockingInfo = blockingInfo;
  lastDisplayMode = displayMode;
  lastProfileDid = profile.did;

  // Remove loading indicator
  loadingContainer.remove();

  // Find insertion point again (may have changed during async operations)
  const currentInsertionPoint = findProfileInsertionPoint();
  if (!currentInsertionPoint) {
    console.log('[AskBeeves] Insertion point lost during async operations');
    injectionInProgress = false;
    return;
  }

  // Remove any existing container (may have been re-added by guard)
  const existingContainer = document.getElementById('askbeeves-blocking-container');
  if (existingContainer) {
    existingContainer.remove();
  }

  // Inject the container
  injectContainer(currentInsertionPoint, blockingInfo, displayMode, profile.did);

  // Start the container guard to re-inject if React removes it
  startContainerGuard();

  lastInjectedHandle = handle;
  injectionInProgress = false;
  console.log('[AskBeeves] Injected blocking info for', handle);
}

/**
 * Check if extension context is still valid
 */
function isExtensionContextValid(): boolean {
  try {
    return !!(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

/**
 * Check if we're on a profile page and inject if needed
 */
function checkAndInjectIfNeeded(): void {
  const handle = getProfileHandleFromUrl();

  // Clear state if we navigated away from a profile
  if (!handle) {
    lastInjectedHandle = null;
    injectionInProgress = false;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    return;
  }

  // Debounce to batch rapid DOM changes, then let injectBlockingInfo decide if work is needed
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    injectBlockingInfo();
  }, 200);
}

/**
 * Track current URL for detecting SPA navigation
 */
let lastUrl = window.location.href;

/**
 * Handle URL changes (SPA navigation)
 */
function handleUrlChange(): void {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    console.log('[AskBeeves] URL changed:', lastUrl, '->', currentUrl);
    lastUrl = currentUrl;

    // Reset ALL state for new navigation
    lastInjectedHandle = null;
    injectionInProgress = false;
    lastBlockingInfo = null;
    lastProfileDid = null;
    cachedAvatarStyle = null; // Reset cached style for new page

    // Stop the container guard
    if (containerGuardObserver) {
      containerGuardObserver.disconnect();
      containerGuardObserver = null;
    }

    // Clear any pending debounce
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Remove existing container immediately on navigation
    const existing = document.getElementById('askbeeves-blocking-container');
    if (existing) {
      console.log('[AskBeeves] Removing stale container');
      existing.remove();
    }

    // Check if we're now on a profile page
    const handle = getProfileHandleFromUrl();
    if (handle) {
      console.log('[AskBeeves] Navigated to profile:', handle);
      // Trigger injection after DOM settles
      setTimeout(() => {
        injectBlockingInfo();
      }, 250);
    }
  }
}

/**
 * Observe for page navigation (SPA)
 */
function observeNavigation(): void {
  if (currentObserver) {
    currentObserver.disconnect();
  }

  // MutationObserver for DOM changes - throttled to avoid excessive checks
  let mutationTimeout: ReturnType<typeof setTimeout> | null = null;
  currentObserver = new MutationObserver(() => {
    // Throttle mutation checks
    if (!mutationTimeout) {
      mutationTimeout = setTimeout(() => {
        mutationTimeout = null;
        handleUrlChange();
        checkAndInjectIfNeeded();
      }, 100);
    }
  });

  currentObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Listen for browser back/forward navigation
  window.addEventListener('popstate', () => {
    console.log('[AskBeeves] popstate event');
    handleUrlChange();
  });

  // Listen for clicks on links (catches SPA navigation more reliably)
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a');
    if (link?.href?.includes('/profile/')) {
      // Delay to let the navigation happen first
      setTimeout(() => {
        handleUrlChange();
      }, 100);
    }
  }, true);

  // Intercept History API for SPA navigation
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    console.log('[AskBeeves] pushState detected');
    handleUrlChange();
  };

  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    console.log('[AskBeeves] replaceState detected');
    handleUrlChange();
  };

  console.log('[AskBeeves] Navigation observer started');
}

/**
 * Sync auth token to background script
 */
async function syncAuthToBackground(): Promise<void> {
  if (!isExtensionContextValid()) {
    console.log('[AskBeeves] Extension context invalidated, skipping auth sync');
    return;
  }

  console.log('[AskBeeves] Attempting to sync auth...');
  const session = getSession();
  console.log('[AskBeeves] Session found:', session ? `DID=${session.did}` : 'null');
  if (session?.accessJwt && session?.did && session?.pdsUrl) {
    try {
      await chrome.runtime.sendMessage({
        type: 'SET_AUTH',
        auth: session,
      } as Message);
      console.log('[AskBeeves] Auth synced to background');
    } catch (error) {
      console.log('[AskBeeves] Failed to sync auth:', error);
    }
  } else {
    console.log('[AskBeeves] No valid session found - missing:',
      !session?.accessJwt ? 'accessJwt' : '',
      !session?.did ? 'did' : '',
      !session?.pdsUrl ? 'pdsUrl' : ''
    );
  }
}

/**
 * Initialize the content script
 */
function init(): void {
  console.log('[AskBeeves] Content script loaded');

  // Initial check
  checkAndInjectIfNeeded();

  // Set up observers for SPA navigation
  observeNavigation();

  // Sync auth on load
  setTimeout(syncAuthToBackground, 1000);

  // Periodically sync auth every 5 minutes
  setInterval(syncAuthToBackground, 5 * 60 * 1000);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
