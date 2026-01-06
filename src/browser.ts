/**
 * AskBeeves - Browser abstraction layer
 * Provides a unified API for Chrome and Firefox extensions
 */

// Declare the browser global for TypeScript (provided by webextension-polyfill in Firefox)
declare const browser: typeof chrome | undefined;

// Detect which browser API is available
// In Firefox with polyfill, 'browser' is available; in Chrome, only 'chrome' is available
const browserApi = typeof browser !== 'undefined' ? browser : chrome;

// Type-safe wrappers around browser extension APIs
// These abstract away the differences between Chrome's callback-based API
// and Firefox's Promise-based API (when using the polyfill)

export const storage = {
  local: {
    get: async (keys: string | string[]): Promise<Record<string, unknown>> => {
      return browserApi.storage.local.get(keys);
    },
    set: async (items: Record<string, unknown>): Promise<void> => {
      return browserApi.storage.local.set(items);
    },
    clear: async (): Promise<void> => {
      return browserApi.storage.local.clear();
    },
  },
  sync: {
    get: async (keys: string | string[]): Promise<Record<string, unknown>> => {
      return browserApi.storage.sync.get(keys);
    },
    set: async (items: Record<string, unknown>): Promise<void> => {
      return browserApi.storage.sync.set(items);
    },
  },
};

export const runtime = {
  get id(): string | undefined {
    return browserApi.runtime?.id;
  },
  sendMessage: async <T = unknown>(message: unknown): Promise<T> => {
    return browserApi.runtime.sendMessage(message) as Promise<T>;
  },
  onMessage: {
    addListener: (
      callback: (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void
      ) => boolean | void
    ): void => {
      browserApi.runtime.onMessage.addListener(callback);
    },
  },
  onInstalled: {
    addListener: (callback: () => void): void => {
      browserApi.runtime.onInstalled.addListener(callback);
    },
  },
  onStartup: {
    addListener: (callback: () => void): void => {
      browserApi.runtime.onStartup.addListener(callback);
    },
  },
};

export const alarms = {
  create: async (name: string, alarmInfo: chrome.alarms.AlarmCreateInfo): Promise<void> => {
    return browserApi.alarms.create(name, alarmInfo);
  },
  clear: async (name: string): Promise<boolean> => {
    return browserApi.alarms.clear(name);
  },
  onAlarm: {
    addListener: (callback: (alarm: chrome.alarms.Alarm) => void): void => {
      browserApi.alarms.onAlarm.addListener(callback);
    },
  },
};

// Re-export for convenience
export { browserApi };
