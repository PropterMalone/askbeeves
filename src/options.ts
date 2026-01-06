/**
 * AskBeeves - Options page script
 */

import { getSettings, saveSettings } from './storage.js';
import { DisplayMode } from './types.js';

async function init(): Promise<void> {
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
}

async function handleDisplayModeChange(mode: DisplayMode): Promise<void> {
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
