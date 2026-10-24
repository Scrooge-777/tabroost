/**
 * Service Worker — Entry point for the Tabroost extension
 * Initializes listeners, session storage, side panel behavior, and startup recovery.
 */

import { registerMessageRouter } from './router.js';
import { tabSync } from './tab-sync.js';
import { startupRecovery } from './startup-recovery.js';
import { windowRegistry } from './window-registry.js';
import { windowOpener } from './window-opener.js';
import { updateToolbarBadge } from './badge.js';
import { updateContextMenus, registerContextMenuHandlers } from './context-menus.js';
import { backups } from './backups.js';
import { pageFeatures } from './page-features.js';
import { syncEngine } from './sync-engine.js';
import { migrateLegacySecrets } from '../shared/secrets.js';
import { MESSAGE_TYPES, STORAGE_KEYS } from '../shared/constants.js';
import { debounce } from '../shared/utils.js';

// 1. Session storage is readable by extension pages only (not page scripts)
chrome.storage?.session?.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })?.catch?.(() => {});

// 2. Toolbar click opens the popup switcher; the side panel is one click away from it
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false })?.catch?.(() => {});

// 3. Core listeners (must be registered synchronously at top level for MV3 wake-ups)
registerMessageRouter();
tabSync.init();
registerContextMenuHandlers();
backups.registerAlarmHandler();
syncEngine.registerAlarmHandler();

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Tabroost installed or updated:', details.reason);
  await migrateLegacySecrets().catch(() => {});
  await updateContextMenus({ force: true });
  await backups.ensureAlarm().catch(() => {});
  await syncEngine.ensureAlarm().catch(() => {});
  await pageFeatures.sync().catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  await migrateLegacySecrets().catch(() => {});
  await windowRegistry.cleanupStaleBindings();
  await backups.ensureAlarm().catch(() => {});
  await syncEngine.ensureAlarm().catch(() => {});
  await startupRecovery.runRecovery();
  await updateToolbarBadge();
});

// 4. Keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === 'switch-to-last-workspace') {
      const previous = await windowRegistry.getPreviousWorkspaceId();
      if (previous) await windowOpener.openWorkspace(previous);
      return;
    }

    const currentWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (!currentWindow) return;

    const opened = await openSwitcher(currentWindow.id);
    if (opened && command === 'new-workspace') {
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: MESSAGE_TYPES.TRIGGER_NEW_WORKSPACE_MODAL })?.catch?.(() => {});
      }, 300);
    }
  } catch (err) {
    console.warn('Error handling command:', command, err);
  }
});

async function openSwitcher(windowId) {
  if (chrome.action?.openPopup) {
    try {
      await chrome.action.openPopup({ windowId });
      return true;
    } catch {
      // Fall back to the side panel
    }
  }
  if (chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ windowId });
    return true;
  }
  return false;
}

// 5. Badge + menus + page indicators follow storage, so they also update for
// changes made by the worker itself (runtime messages never reach their sender).
const refreshDerivedUi = debounce(() => {
  updateContextMenus().catch(() => {});
  updateToolbarBadge().catch(() => {});
  pageFeatures.refreshAll().catch(() => {});
}, 250);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes[STORAGE_KEYS.WORKSPACES] || changes[STORAGE_KEYS.WORKSPACE_ORDER] || changes[STORAGE_KEYS.SETTINGS])) {
    refreshDerivedUi();
  } else if (area === 'session' && changes[STORAGE_KEYS.WINDOW_BINDINGS]) {
    refreshDerivedUi();
  }
});

chrome.windows?.onFocusChanged?.addListener((winId) => {
  if (winId && winId !== chrome.windows.WINDOW_ID_NONE) {
    updateToolbarBadge(winId).catch(() => {});
  }
});

// 6. Worker (re)start: heal bindings, refresh derived UI
migrateLegacySecrets().catch(() => {});
windowRegistry.cleanupStaleBindings().catch(() => {});
updateContextMenus().catch(() => {});
updateToolbarBadge().catch(() => {});

export { updateContextMenus, updateToolbarBadge };
export const setupContextMenus = updateContextMenus;
