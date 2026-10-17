/**
 * Service Worker — Entry point for Workspaces extension
 * Initializes listeners, session storage, side panel behavior, and startup recovery.
 */

import { registerMessageRouter } from './router.js';
import { tabSync } from './tab-sync.js';
import { startupRecovery } from './startup-recovery.js';
import { workspaceManager } from './workspace-manager.js';
import { windowRegistry } from './window-registry.js';
import { windowOpener } from './window-opener.js';

console.log('Workspaces: Service Worker initializing...');

// 1. Enable session storage access across extension contexts
if (chrome.storage?.session?.setAccessLevel) {
  chrome.storage.session
    .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
    .catch((err) => console.warn('Could not set session storage access level:', err));
}

// 2. Configure action click to open popup dropdown by default (Side Panel remains accessible via header button)
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((err) => console.warn('Could not set panel behavior:', err));
}

// 3. Register message router and tab synchronization
registerMessageRouter();
tabSync.init();

// 4. Handle installation and extension updates
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Workspaces installed or updated:', details.reason);

  // Ensure workspace state is always clean and fresh without dummy/sample workspaces
  try {
    const state = await workspaceManager.getState();
    const workspaces = state.workspaces || {};
    let changed = false;

    // Purge any previously auto-seeded dummy "College" or "Personal" workspaces
    for (const [id, ws] of Object.entries(workspaces)) {
      if (
        (ws.name === 'College' || ws.name === 'Personal') &&
        ws.tabs?.some((t) => t.url?.includes('wikipedia.org') || t.url?.includes('github.com'))
      ) {
        delete workspaces[id];
        changed = true;
      }
    }

    if (changed) {
      const remainingOrder = (state.workspaceOrder || []).filter((id) => workspaces[id]);
      await workspaceManager.saveWorkspaces(workspaces, remainingOrder);
      console.log('Workspaces: Cleaned up dummy seeded workspaces.');
    }
  } catch (err) {
    console.warn('Workspaces: Could not verify/clean initial workspaces:', err);
  }

  // Setup context menus
  try {
    await updateContextMenus();
  } catch (err) {
    console.warn('Workspaces: Failed to setup context menus onInstalled:', err);
  }
});

// 5. Handle browser startup
chrome.runtime.onStartup.addListener(async () => {
  console.log('Workspaces: Browser startup detected.');
  // Clean dead bindings and run recovery matching
  await windowRegistry.cleanupStaleBindings();
  await startupRecovery.runRecovery();
});

// 6. Handle keyboard shortcuts
// 6. Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const currentWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (!currentWindow) return;

    if (command === 'open-switcher') {
      if (chrome.action?.openPopup) {
        try {
          await chrome.action.openPopup({ windowId: currentWindow.id });
          return;
        } catch {
          // Fallback to side panel
        }
      }
      if (chrome.sidePanel?.open) {
        await chrome.sidePanel.open({ windowId: currentWindow.id });
      }
    } else if (command === 'new-workspace') {
      if (chrome.action?.openPopup) {
        try {
          await chrome.action.openPopup({ windowId: currentWindow.id });
          setTimeout(() => {
            chrome.runtime.sendMessage({ type: 'TRIGGER_NEW_WORKSPACE_MODAL' }).catch(() => {});
          }, 300);
          return;
        } catch {
          // Fallback
        }
      }
      if (chrome.sidePanel?.open) {
        await chrome.sidePanel.open({ windowId: currentWindow.id });
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: 'TRIGGER_NEW_WORKSPACE_MODAL' }).catch(() => {});
        }, 300);
      }
    }
  } catch (err) {
    console.warn('Error handling command:', command, err);
  }
});

// 7. Context menu setup (supports Edge-style "Move tab to Workspace")
export async function updateContextMenus() {
  if (!chrome.contextMenus) return;

  try {
    if (typeof chrome.contextMenus.removeAll === 'function') {
      await chrome.contextMenus.removeAll();
    }

    chrome.contextMenus.create(
      {
        id: 'open-side-panel',
        title: 'Open Workspaces',
        contexts: ['all']
      },
      () => void chrome.runtime.lastError
    );

    chrome.contextMenus.create(
      {
        id: 'save-window-as-workspace',
        title: 'Save Current Window as Workspace',
        contexts: ['all']
      },
      () => void chrome.runtime.lastError
    );

    const state = await workspaceManager.getState();
    const workspaces = Object.values(state?.workspaces || {});

    if (workspaces.length > 0) {
      chrome.contextMenus.create(
        {
          id: 'move-tab-parent',
          title: 'Move tab to workspace',
          contexts: ['all']
        },
        () => void chrome.runtime.lastError
      );

      for (const ws of workspaces) {
        chrome.contextMenus.create(
          {
            id: `move-tab-to-${ws.id}`,
            parentId: 'move-tab-parent',
            title: ws.name || 'Untitled Workspace',
            contexts: ['all']
          },
          () => void chrome.runtime.lastError
        );
      }
    }
  } catch (err) {
    console.warn('Workspaces: Could not populate context menus:', err);
  }
}

export const setupContextMenus = updateContextMenus;

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.windowId) return;

  if (info.menuItemId === 'open-side-panel') {
    if (chrome.sidePanel?.open) {
      chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } else if (info.menuItemId === 'save-window-as-workspace') {
    const name = `Workspace ${new Date().toLocaleDateString()}`;
    await workspaceManager.createFromCurrentWindow(tab.windowId, name, 'blue');
    await updateContextMenus();
    if (chrome.sidePanel?.open) {
      chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } else if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith('move-tab-to-')) {
    const targetWsId = info.menuItemId.replace('move-tab-to-', '');
    if (tab?.id) {
      await workspaceManager.moveTabToWorkspace(tab.id, targetWsId);
    }
  }
});

// 8. Toolbar badge synchronization (reflects active workspace name and accent color)
const BADGE_COLORS = {
  blue: '#2080F0',
  cyan: '#12B886',
  green: '#2FB344',
  yellow: '#F59F00',
  orange: '#F76707',
  red: '#FA5252',
  pink: '#E64980',
  purple: '#AE3EC9',
  grey: '#868E96'
};

export async function updateToolbarBadge(windowId = null) {
  if (!chrome.action?.setBadgeText) return;
  try {
    let targetWinId = windowId;
    if (!targetWinId || targetWinId === chrome.windows.WINDOW_ID_NONE) {
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
      targetWinId = win?.id;
    }
    if (!targetWinId) return;

    const wsId = await windowRegistry.getWorkspaceForWindow(targetWinId);
    if (!wsId) {
      await chrome.action.setBadgeText({ text: '' }).catch(() => {});
      return;
    }

    const state = await workspaceManager.getState();
    const ws = state?.workspaces?.[wsId];
    if (!ws) {
      await chrome.action.setBadgeText({ text: '' }).catch(() => {});
      return;
    }

    // Abbreviate workspace name to 3-4 chars, e.g. "IMP"
    const text = (ws.name || 'WS').trim().substring(0, 4).toUpperCase();
    const colorHex = BADGE_COLORS[ws.color] || '#2080F0';

    await chrome.action.setBadgeText({ text }).catch(() => {});
    if (chrome.action.setBadgeBackgroundColor) {
      await chrome.action.setBadgeBackgroundColor({ color: colorHex }).catch(() => {});
    }
  } catch (err) {
    // Gracefully handle closed windows
  }
}

// Update context menus and toolbar badge on worker startup and listen for workspace changes
updateContextMenus().catch(() => {});
updateToolbarBadge().catch(() => {});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'WORKSPACE_UPDATED' || msg?.type === 'STATE_CHANGED') {
    updateContextMenus().catch(() => {});
    updateToolbarBadge().catch(() => {});
  }
});

chrome.windows?.onFocusChanged?.addListener((winId) => {
  if (winId && winId !== chrome.windows.WINDOW_ID_NONE) {
    updateToolbarBadge(winId).catch(() => {});
  }
});

chrome.tabs?.onActivated?.addListener((info) => {
  if (info?.windowId) {
    updateToolbarBadge(info.windowId).catch(() => {});
  }
});

// 9. Clean up stale bindings on worker startup
windowRegistry.cleanupStaleBindings().catch(() => {});
