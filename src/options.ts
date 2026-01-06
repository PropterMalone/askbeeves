/**
 * AskBeeves - Options page script
 */

import { getSettings, saveSettings } from './storage.js';
import { DisplayMode, Message, SyncStatus } from './types.js';

export async function init(): Promise<void> {
  const settings = await getSettings();

  // Set initial radio button state
  const compactRadio = document.getElementById('display-compact') as HTMLInputElement;
  const detailedRadio = document.getElementById('display-detailed') as HTMLInputElement;

  if (settings.displayMode === 'compact') {
    compactRadio.checked = true;
  } else {
    detailedRadio.checked = true;
  }

  // Add change listeners
  compactRadio.addEventListener('change', () => handleDisplayModeChange('compact'));
  detailedRadio.addEventListener('change', () => handleDisplayModeChange('detailed'));

  // Load sync status
  await loadSyncStatus();

  // Set up button listeners
  const refreshBtn = document.getElementById('refresh-sync-btn');
  const clearBtn = document.getElementById('clear-cache-btn');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', triggerSync);
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', clearCache);
  }
}

export async function loadSyncStatus(): Promise<void> {
  const statusEl = document.getElementById('sync-status');
  if (!statusEl) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_SYNC_STATUS',
    } as Message);

    if (response?.success && response.syncStatus) {
      const status = response.syncStatus as SyncStatus;
      const lastSync = status.lastSync ? new Date(status.lastSync).toLocaleString() : 'Never';
      const isRunning = status.isRunning ? ' (syncing...)' : '';

      // Clear existing content safely
      statusEl.textContent = '';

      // Build DOM elements safely (avoids XSS)
      const createStatusRow = (label: string, value: string | number, color?: string): HTMLDivElement => {
        const row = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = `${label}: `;
        row.appendChild(strong);
        row.appendChild(document.createTextNode(String(value)));
        if (color) {
          row.style.color = color;
        }
        return row;
      };

      statusEl.appendChild(createStatusRow('Last sync', `${lastSync}${isRunning}`));
      statusEl.appendChild(createStatusRow('Follows', status.totalFollows || 0));
      statusEl.appendChild(createStatusRow('Synced', status.syncedFollows || 0));

      if (status.errors?.length) {
        statusEl.appendChild(createStatusRow('Errors', status.errors.length, '#dc2626'));
      }
    } else {
      statusEl.textContent = 'Could not load sync status';
    }
  } catch (error) {
    statusEl.textContent = 'Error loading sync status';
    console.error('[AskBeeves Options] Error:', error);
  }
}

export async function triggerSync(): Promise<void> {
  const statusEl = document.getElementById('sync-status');
  if (statusEl) {
    statusEl.textContent = 'Starting sync...';
  }

  try {
    await chrome.runtime.sendMessage({
      type: 'TRIGGER_SYNC',
    } as Message);

    // Reload status after a moment
    setTimeout(loadSyncStatus, 1000);
  } catch (error) {
    console.error('[AskBeeves Options] Sync error:', error);
    if (statusEl) {
      statusEl.textContent = 'Sync failed';
    }
  }
}

export async function clearCache(): Promise<void> {
  const statusEl = document.getElementById('sync-status');
  if (statusEl) {
    statusEl.textContent = 'Clearing cache...';
  }

  try {
    await chrome.runtime.sendMessage({
      type: 'CLEAR_CACHE',
    } as Message);

    // Reload status after a moment
    setTimeout(loadSyncStatus, 1000);
  } catch (error) {
    console.error('[AskBeeves Options] Clear error:', error);
    if (statusEl) {
      statusEl.textContent = 'Clear failed';
    }
  }
}

export async function handleDisplayModeChange(mode: DisplayMode): Promise<void> {
  const settings = await getSettings();
  settings.displayMode = mode;
  await saveSettings(settings);

  // Show saved indicator
  const savedIndicator = document.getElementById('saved-indicator');
  if (savedIndicator) {
    savedIndicator.style.opacity = '1';
    setTimeout(() => {
      savedIndicator.style.opacity = '0';
    }, 1500);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
