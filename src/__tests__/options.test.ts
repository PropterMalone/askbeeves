import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock storage module before importing options
vi.mock('../storage.js', () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

import { getSettings, saveSettings } from '../storage.js';

describe('Options Page', () => {
  let mockSendMessage: ReturnType<typeof vi.fn>;
  let mockAddEventListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset DOM
    document.body.innerHTML = `
      <input type="radio" id="display-compact" name="display-mode" />
      <input type="radio" id="display-detailed" name="display-mode" />
      <div id="sync-status"></div>
      <button id="refresh-sync-btn">Refresh</button>
      <button id="clear-cache-btn">Clear Cache</button>
      <div id="saved-indicator" style="opacity: 0"></div>
    `;

    // Mock chrome.runtime.sendMessage
    mockSendMessage = vi.fn();
    mockAddEventListener = vi.fn();

    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: mockSendMessage,
      },
      storage: {
        sync: {
          get: vi.fn(),
          set: vi.fn(),
        },
      },
    });

    // Default mock implementations
    vi.mocked(getSettings).mockResolvedValue({ displayMode: 'compact' });
    vi.mocked(saveSettings).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('init', () => {
    it('should set compact radio checked when displayMode is compact', async () => {
      vi.mocked(getSettings).mockResolvedValue({ displayMode: 'compact' });
      mockSendMessage.mockResolvedValue({ success: true, syncStatus: { lastSync: 0, totalFollows: 0, syncedFollows: 0, isRunning: false, errors: [] } });

      // Import fresh module to trigger init
      const { init } = await import('../options.js');
      await init();

      const compactRadio = document.getElementById('display-compact') as HTMLInputElement;
      const detailedRadio = document.getElementById('display-detailed') as HTMLInputElement;

      expect(compactRadio.checked).toBe(true);
      expect(detailedRadio.checked).toBe(false);
    });

    it('should set detailed radio checked when displayMode is detailed', async () => {
      vi.mocked(getSettings).mockResolvedValue({ displayMode: 'detailed' });
      mockSendMessage.mockResolvedValue({ success: true, syncStatus: { lastSync: 0, totalFollows: 0, syncedFollows: 0, isRunning: false, errors: [] } });

      const { init } = await import('../options.js');
      await init();

      const compactRadio = document.getElementById('display-compact') as HTMLInputElement;
      const detailedRadio = document.getElementById('display-detailed') as HTMLInputElement;

      expect(compactRadio.checked).toBe(false);
      expect(detailedRadio.checked).toBe(true);
    });

    it('should add change listeners to radio buttons', async () => {
      mockSendMessage.mockResolvedValue({ success: true, syncStatus: { lastSync: 0, totalFollows: 0, syncedFollows: 0, isRunning: false, errors: [] } });

      const { init } = await import('../options.js');
      await init();

      const compactRadio = document.getElementById('display-compact') as HTMLInputElement;

      // Trigger change event
      compactRadio.dispatchEvent(new Event('change'));

      // saveSettings should be called when radio changes
      await vi.runAllTimersAsync();
      expect(saveSettings).toHaveBeenCalled();
    });

    it('should add click listeners to buttons', async () => {
      mockSendMessage.mockResolvedValue({ success: true, syncStatus: { lastSync: 0, totalFollows: 0, syncedFollows: 0, isRunning: false, errors: [] } });

      const { init } = await import('../options.js');
      await init();

      const refreshBtn = document.getElementById('refresh-sync-btn') as HTMLButtonElement;

      // Trigger click
      refreshBtn.click();

      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'TRIGGER_SYNC' });
    });
  });

  describe('loadSyncStatus', () => {
    it('should display sync status with all fields', async () => {
      const mockStatus = {
        lastSync: Date.now(),
        totalFollows: 100,
        syncedFollows: 50,
        isRunning: false,
        errors: [],
      };
      mockSendMessage.mockResolvedValue({ success: true, syncStatus: mockStatus });

      const { loadSyncStatus } = await import('../options.js');
      await loadSyncStatus();

      const statusEl = document.getElementById('sync-status')!;
      expect(statusEl.textContent).toContain('Last sync:');
      expect(statusEl.textContent).toContain('Follows: 100');
      expect(statusEl.textContent).toContain('Synced: 50');
    });

    it('should show "Never" when lastSync is 0', async () => {
      const mockStatus = {
        lastSync: 0,
        totalFollows: 0,
        syncedFollows: 0,
        isRunning: false,
        errors: [],
      };
      mockSendMessage.mockResolvedValue({ success: true, syncStatus: mockStatus });

      const { loadSyncStatus } = await import('../options.js');
      await loadSyncStatus();

      const statusEl = document.getElementById('sync-status')!;
      expect(statusEl.textContent).toContain('Never');
    });

    it('should show syncing indicator when isRunning is true', async () => {
      const mockStatus = {
        lastSync: Date.now(),
        totalFollows: 100,
        syncedFollows: 50,
        isRunning: true,
        errors: [],
      };
      mockSendMessage.mockResolvedValue({ success: true, syncStatus: mockStatus });

      const { loadSyncStatus } = await import('../options.js');
      await loadSyncStatus();

      const statusEl = document.getElementById('sync-status')!;
      expect(statusEl.textContent).toContain('(syncing...)');
    });

    it('should show errors count when there are errors', async () => {
      const mockStatus = {
        lastSync: Date.now(),
        totalFollows: 100,
        syncedFollows: 50,
        isRunning: false,
        errors: ['error1', 'error2'],
      };
      mockSendMessage.mockResolvedValue({ success: true, syncStatus: mockStatus });

      const { loadSyncStatus } = await import('../options.js');
      await loadSyncStatus();

      const statusEl = document.getElementById('sync-status')!;
      expect(statusEl.textContent).toContain('Errors: 2');
    });

    it('should show error message when response fails', async () => {
      mockSendMessage.mockResolvedValue({ success: false });

      const { loadSyncStatus } = await import('../options.js');
      await loadSyncStatus();

      const statusEl = document.getElementById('sync-status')!;
      expect(statusEl.textContent).toBe('Could not load sync status');
    });

    it('should show error message on exception', async () => {
      mockSendMessage.mockRejectedValue(new Error('Network error'));

      const { loadSyncStatus } = await import('../options.js');
      await loadSyncStatus();

      const statusEl = document.getElementById('sync-status')!;
      expect(statusEl.textContent).toBe('Error loading sync status');
    });

    it('should do nothing if status element not found', async () => {
      document.getElementById('sync-status')!.remove();

      const { loadSyncStatus } = await import('../options.js');
      await loadSyncStatus();

      // Should not throw
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('triggerSync', () => {
    it('should send TRIGGER_SYNC message', async () => {
      mockSendMessage.mockResolvedValue({ success: true });

      const { triggerSync } = await import('../options.js');
      await triggerSync();

      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'TRIGGER_SYNC' });
    });

    it('should show "Starting sync..." message', async () => {
      mockSendMessage.mockResolvedValue({ success: true });

      const { triggerSync } = await import('../options.js');
      await triggerSync();

      const statusEl = document.getElementById('sync-status')!;
      expect(statusEl.textContent).toBe('Starting sync...');
    });

    it('should reload status after 1 second', async () => {
      mockSendMessage
        .mockResolvedValueOnce({ success: true }) // TRIGGER_SYNC
        .mockResolvedValueOnce({ success: true, syncStatus: { lastSync: Date.now(), totalFollows: 10, syncedFollows: 10, isRunning: false, errors: [] } }); // GET_SYNC_STATUS

      const { triggerSync } = await import('../options.js');
      await triggerSync();

      // Advance timers by 1 second
      await vi.advanceTimersByTimeAsync(1000);

      // Should have called sendMessage twice (TRIGGER_SYNC + GET_SYNC_STATUS from loadSyncStatus)
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
    });

    it('should show error message on failure', async () => {
      mockSendMessage.mockRejectedValue(new Error('Sync failed'));

      const { triggerSync } = await import('../options.js');
      await triggerSync();

      const statusEl = document.getElementById('sync-status')!;
      expect(statusEl.textContent).toBe('Sync failed');
    });
  });

  describe('clearCache', () => {
    it('should send CLEAR_CACHE message', async () => {
      mockSendMessage.mockResolvedValue({ success: true });

      const { clearCache } = await import('../options.js');
      await clearCache();

      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'CLEAR_CACHE' });
    });

    it('should show "Clearing cache..." message', async () => {
      mockSendMessage.mockResolvedValue({ success: true });

      const { clearCache } = await import('../options.js');
      await clearCache();

      const statusEl = document.getElementById('sync-status')!;
      expect(statusEl.textContent).toBe('Clearing cache...');
    });

    it('should show error message on failure', async () => {
      mockSendMessage.mockRejectedValue(new Error('Clear failed'));

      const { clearCache } = await import('../options.js');
      await clearCache();

      const statusEl = document.getElementById('sync-status')!;
      expect(statusEl.textContent).toBe('Clear failed');
    });
  });

  describe('handleDisplayModeChange', () => {
    it('should save settings with new display mode', async () => {
      vi.mocked(getSettings).mockResolvedValue({ displayMode: 'compact' });

      const { handleDisplayModeChange } = await import('../options.js');
      await handleDisplayModeChange('detailed');

      expect(saveSettings).toHaveBeenCalledWith({ displayMode: 'detailed' });
    });

    it('should show and hide saved indicator', async () => {
      vi.mocked(getSettings).mockResolvedValue({ displayMode: 'compact' });

      const { handleDisplayModeChange } = await import('../options.js');
      await handleDisplayModeChange('detailed');

      const savedIndicator = document.getElementById('saved-indicator')!;
      expect(savedIndicator.style.opacity).toBe('1');

      // Advance timers by 1.5 seconds
      await vi.advanceTimersByTimeAsync(1500);

      expect(savedIndicator.style.opacity).toBe('0');
    });

    it('should handle missing saved indicator gracefully', async () => {
      document.getElementById('saved-indicator')!.remove();
      vi.mocked(getSettings).mockResolvedValue({ displayMode: 'compact' });

      const { handleDisplayModeChange } = await import('../options.js');
      await handleDisplayModeChange('detailed');

      // Should not throw
      expect(saveSettings).toHaveBeenCalled();
    });
  });
});
