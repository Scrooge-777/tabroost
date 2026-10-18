/**
 * Context menus on pages and the toolbar icon (Edge-style "Move tab to workspace")
 */

import { workspaceManager } from './workspace-manager.js';
import { windowRegistry } from './window-registry.js';
import { windowOpener } from './window-opener.js';

const CONTEXTS = ['page', 'action'];
const MOVE_PREFIX = 'move-tab-to-';
let lastSignature = null;
let rebuilding = Promise.resolve();

function createItem(props) {
  return new Promise((resolve) => {
    chrome.contextMenus.create(props, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

/**
 * Rebuild menus only when the workspace list (names/order) actually changed
 */
export function updateContextMenus({ force = false } = {}) {
  rebuilding = rebuilding.then(() => rebuild(force)).catch((err) => {
    console.warn('Tabroost: Could not populate context menus:', err);
  });
  return rebuilding;
}

async function rebuild(force) {
  if (!chrome.contextMenus) return;
  const state = await workspaceManager.loadState();
  const list = state.workspaceOrder.map((id) => state.workspaces[id]).filter(Boolean);
  const signature = JSON.stringify(list.map((ws) => [ws.id, ws.name, ws.icon]));
  if (!force && signature === lastSignature) return;
  lastSignature = signature;

  await chrome.contextMenus.removeAll();
  await createItem({ id: 'open-side-panel', title: 'Open Tabroost panel', contexts: CONTEXTS });
  await createItem({ id: 'save-window-as-workspace', title: 'Save this window as a workspace', contexts: CONTEXTS });

  if (list.length > 0) {
    await createItem({ id: 'move-tab-parent', title: 'Move tab to workspace', contexts: ['page'] });
    for (const ws of list) {
      await createItem({
        id: `${MOVE_PREFIX}${ws.id}`,
        parentId: 'move-tab-parent',
        title: `${ws.icon ? ws.icon + ' ' : ''}${ws.name || 'Untitled'}`,
        contexts: ['page']
      });
    }
  }
}

export function registerContextMenuHandlers() {
  chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
    try {
      const windowId = tab?.windowId;
      if (info.menuItemId === 'open-side-panel') {
        if (windowId && chrome.sidePanel?.open) await chrome.sidePanel.open({ windowId });
      } else if (info.menuItemId === 'save-window-as-workspace') {
        if (!windowId) return;
        const existing = await windowRegistry.getWorkspaceForWindow(windowId);
        if (!existing) {
          await workspaceManager.createFromCurrentWindow(windowId, `Workspace ${new Date().toLocaleDateString()}`);
        }
        if (chrome.sidePanel?.open) await chrome.sidePanel.open({ windowId });
      } else if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith(MOVE_PREFIX)) {
        const targetWsId = info.menuItemId.slice(MOVE_PREFIX.length);
        if (tab?.id) {
          await workspaceManager.moveTabToWorkspace(tab.id, targetWsId);
          const targetWin = await windowRegistry.getWindowForWorkspace(targetWsId);
          if (targetWin === null) return;
          await windowOpener.openWorkspace(targetWsId);
        }
      }
    } catch (err) {
      console.warn('Tabroost: context menu action failed', err);
    }
  });
}
