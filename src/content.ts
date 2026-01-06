/**
 * AskBeeves - Content script for Bluesky profile pages
 * Injects blocking info UI and syncs auth token
 */

import { getSession, getProfile } from './api.js';
import { BlockingInfo, Message } from './types.js';

let currentObserver: MutationObserver | null = null;
let lastInjectedHandle: string | null = null;
let injectionInProgress = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Extract profile handle from the URL
 */
function getProfileHandleFromUrl(): string | null {
  const match = window.location.pathname.match(/\/profile\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Find the "Followed by X" row container via XPath
 * Returns the parent row element so we can insert after the whole row
 */
function findFollowedByElement(): HTMLElement | null {
  const xpath = "//*[contains(text(), 'Followed by')]";
  const result = document.evaluate(
    xpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  );
  const textElement = result.singleNodeValue as HTMLElement | null;
  if (!textElement) return null;

  // Walk up to find the row container (usually has display:flex and contains the avatars)
  let parent = textElement.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    // Look for a flex container that's a direct child of a column flex container
    if (style.display === 'flex' && style.flexDirection === 'row') {
      const grandparent = parent.parentElement;
      if (grandparent) {
        const gpStyle = window.getComputedStyle(grandparent);
        if (gpStyle.display === 'flex' && gpStyle.flexDirection === 'column') {
          return parent; // This is the row we want to insert after
        }
      }
    }
    parent = parent.parentElement;
  }

  // Fallback: return the text element's parent
  return textElement.parentElement;
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
 * Get avatar styling from Bluesky's "Followed by" section
 */
function getFollowedByAvatarStyle(): { size: string; overlap: string } {
  // Find avatar images in the "Followed by" row
  const followedByText = document.evaluate(
    "//*[contains(text(), 'Followed by')]",
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue as HTMLElement | null;

  if (followedByText) {
    // Look for img elements near the "Followed by" text
    const parent = followedByText.parentElement;
    if (parent) {
      const imgs = parent.querySelectorAll('img');
      if (imgs.length > 0) {
        const firstImg = imgs[0] as HTMLElement;
        const style = window.getComputedStyle(firstImg);
        const size = style.width || '32px';
        // Check margin-left of second image for overlap
        let overlap = '-8px';
        if (imgs.length > 1) {
          const secondStyle = window.getComputedStyle(imgs[1]);
          overlap = secondStyle.marginLeft || '-8px';
        }
        console.log('[AskBeeves] Detected avatar style:', { size, overlap });
        return { size, overlap };
      }
    }
  }

  // Fallback defaults
  return { size: '32px', overlap: '-8px' };
}

/**
 * Create a row of profile picture thumbnails (matches Bluesky's "Followed by" style)
 * Takes pre-sampled users for consistency with text display
 */
function createAvatarRow(
  sampledUsers: Array<{ displayName?: string; handle: string; avatar?: string }>
): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = `
    display: flex;
    align-items: center;
    margin-right: 4px;
  `;

  // Get actual sizes from Bluesky's "Followed by" avatars
  const { size, overlap } = getFollowedByAvatarStyle();

  // Display up to 3 avatars from the pre-sampled users
  const displayUsers = sampledUsers.slice(0, 3);
  displayUsers.forEach((user, index) => {
    const avatar = document.createElement('img');
    avatar.src = user.avatar || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23ccc"/></svg>';
    avatar.alt = user.displayName || user.handle;
    avatar.title = user.displayName || `@${user.handle}`;
    avatar.style.cssText = `
      width: ${size};
      height: ${size};
      border-radius: 50%;
      object-fit: cover;
      margin-left: ${index > 0 ? overlap : '0'};
      position: relative;
      z-index: ${3 - index};
      box-shadow: 0 0 0 2px white;
    `;
    avatar.onerror = () => {
      avatar.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23ccc"/></svg>';
    };
    container.appendChild(avatar);
  });

  return container;
}

/**
 * Create a modal to show all users in a list
 */
function showFullListModal(
  users: Array<{ displayName?: string; handle: string; avatar?: string }>,
  title: string
): void {
  // Remove any existing modal
  const existing = document.getElementById('askbeeves-full-list-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'askbeeves-full-list-modal';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
  `;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 20px;
    min-width: 320px;
    max-width: 480px;
    max-height: 60vh;
    overflow-y: auto;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  const titleEl = document.createElement('h3');
  titleEl.style.cssText = `
    margin: 0 0 16px 0;
    font-size: 16px;
    font-weight: 600;
    color: #425780;
  `;
  titleEl.textContent = title;

  const listEl = document.createElement('div');
  listEl.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 4px;
  `;

  for (const user of users) {
    const item = document.createElement('div');
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid #e5e7eb;
    `;

    const avatar = document.createElement('img');
    avatar.src = user.avatar || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23ccc"/></svg>';
    avatar.alt = user.displayName || user.handle;
    avatar.style.cssText = `
      width: 32px;
      height: 32px;
      border-radius: 50%;
      object-fit: cover;
    `;
    avatar.onerror = () => {
      avatar.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="%23ccc"/></svg>';
    };

    const textContainer = document.createElement('div');
    textContainer.style.cssText = `display: flex; flex-direction: column;`;

    if (user.displayName) {
      const displayNameEl = document.createElement('span');
      displayNameEl.style.cssText = `font-size: 14px; font-weight: 600; color: #1a1a1a;`;
      displayNameEl.textContent = user.displayName;
      textContainer.appendChild(displayNameEl);
    }

    const handleEl = document.createElement('span');
    handleEl.style.cssText = `font-size: 13px; color: #687882;`;
    handleEl.textContent = `@${user.handle}`;
    textContainer.appendChild(handleEl);

    item.appendChild(avatar);
    item.appendChild(textContainer);
    listEl.appendChild(item);
  }

  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = `
    margin-top: 16px;
    padding: 10px 16px;
    border: none;
    border-radius: 8px;
    background: #1083fe;
    color: white;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    width: 100%;
  `;
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => overlay.remove());

  dialog.appendChild(titleEl);
  dialog.appendChild(listEl);
  dialog.appendChild(closeBtn);
  overlay.appendChild(dialog);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

/**
 * Wait for "Followed by" element to appear (with timeout)
 */
async function waitForFollowedBy(maxWaitMs: number = 3000): Promise<HTMLElement | null> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const element = findFollowedByElement();
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

/**
 * Inject blocking info UI below the "Followed by" element
 */
async function injectBlockingInfo(): Promise<void> {
  const handle = getProfileHandleFromUrl();
  if (!handle) return;

  // Skip if already injected for this handle or in progress
  if (handle === lastInjectedHandle || injectionInProgress) {
    return;
  }

  injectionInProgress = true;

  // Remove any existing injected elements
  const existing = document.getElementById('askbeeves-blocking-container');
  if (existing) existing.remove();

  // Wait for the "Followed by" element to appear (profile may still be loading)
  const followedByElement = await waitForFollowedBy();
  if (!followedByElement) {
    console.log('[AskBeeves] No "Followed by" element found after waiting');
    injectionInProgress = false;
    return;
  }

  // Resolve handle to DID
  console.log('[AskBeeves] Resolving profile for:', handle);
  const profile = await getProfile(handle);
  if (!profile?.did) {
    console.log('[AskBeeves] Could not resolve profile DID for:', handle);
    injectionInProgress = false;
    return;
  }
  console.log('[AskBeeves] Resolved DID:', profile.did);

  // Get blocking info from background script
  let response;
  try {
    if (!isExtensionContextValid()) {
      console.log('[AskBeeves] Extension context invalidated, skipping message');
      injectionInProgress = false;
      return;
    }
    response = await chrome.runtime.sendMessage({
      type: 'GET_BLOCKING_INFO',
      profileDid: profile.did,
    } as Message);
  } catch (error) {
    console.log('[AskBeeves] Error sending message:', error);
    injectionInProgress = false;
    return;
  }

  if (!response || !response.success || !response.blockingInfo) {
    console.log('[AskBeeves] Failed to get blocking info:', response?.error);
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
    modalTitle: string
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
    row.addEventListener('click', () => {
      showFullListModal(users, modalTitle);
    });

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
      'Blocked by (users you follow who block this profile)'
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
      'Blocking (users you follow that this profile blocks)'
    );
    container.appendChild(blockingRow);
  } else {
    container.appendChild(createTextOnlyRow('Not blocking anyone you follow'));
  }

  // Insert after "Followed by" element
  if (followedByElement.nextSibling) {
    followedByElement.parentNode?.insertBefore(container, followedByElement.nextSibling);
  } else {
    followedByElement.parentNode?.appendChild(container);
  }

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

  // Clear lastInjectedHandle if we navigated away
  if (!handle) {
    lastInjectedHandle = null;
    return;
  }

  // Reset if we're on a different profile
  if (handle !== lastInjectedHandle) {
    // Short debounce - just enough to batch rapid DOM changes
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      injectBlockingInfo();
    }, 100);
  }
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

    // Reset state for new navigation
    lastInjectedHandle = null;

    // Remove existing container immediately on navigation
    const existing = document.getElementById('askbeeves-blocking-container');
    if (existing) existing.remove();

    // Trigger injection check
    checkAndInjectIfNeeded();
  }
}

/**
 * Observe for page navigation (SPA)
 */
function observeNavigation(): void {
  if (currentObserver) {
    currentObserver.disconnect();
  }

  // MutationObserver for DOM changes
  currentObserver = new MutationObserver(() => {
    // Check for URL changes on every DOM mutation
    handleUrlChange();
    checkAndInjectIfNeeded();
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
