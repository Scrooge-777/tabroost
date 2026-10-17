/**
 * Router — Handles runtime.onMessage commands from side panel, options, and content scripts
 */

import { MESSAGE_TYPES, STORAGE_KEYS } from '../shared/constants.js';
import { workspaceManager } from './workspace-manager.js';
import { windowRegistry } from './window-registry.js';
import { windowOpener } from './window-opener.js';
import { storage } from '../shared/storage.js';
import { validateImportPayload } from '../shared/schema.js';

export function registerMessageRouter() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // If message is missing or is an internal broadcast / UI event, do not handle here
    const IGNORED_TYPES = [
      MESSAGE_TYPES.WORKSPACE_UPDATED,
      MESSAGE_TYPES.STATE_CHANGED,
      'TRIGGER_NEW_WORKSPACE_MODAL',
      'CLOSE_WORKSPACES_FLYOUT'
    ];
    if (!message || !message.type || IGNORED_TYPES.includes(message.type)) {
      return false;
    }

    // Handle message asynchronously
    handleMessage(message, sender)
      .then((data) => {
        try {
          sendResponse({ success: true, data });
        } catch {
          // Port closed
        }
      })
      .catch((err) => {
        console.warn('router: Message handling error for', message?.type, err);
        try {
          sendResponse({ success: false, error: err.message || String(err) });
        } catch {
          // Port closed
        }
      });

    // Return true to keep message channel open for async sendResponse
    return true;
  });
}

async function handleMessage(message, sender) {
  if (!message || !message.type) {
    throw new Error('Malformed message: missing type');
  }

  switch (message.type) {
    case MESSAGE_TYPES.LIST_WORKSPACES: {
      await windowRegistry.cleanupStaleBindings();
      return await workspaceManager.getState();
    }

    case MESSAGE_TYPES.CREATE_WORKSPACE: {
      const ws = await workspaceManager.createWorkspace({
        name: message.name,
        color: message.color,
        icon: message.icon
      });
      return ws;
    }

    case MESSAGE_TYPES.CREATE_FROM_CURRENT_WINDOW: {
      const windowId = message.windowId || sender.tab?.windowId;
      if (!windowId) {
        throw new Error('Target window ID not specified');
      }
      return await workspaceManager.createFromCurrentWindow(windowId, message.name, message.color);
    }

    case MESSAGE_TYPES.OPEN_WORKSPACE: {
      const winId = await windowOpener.openWorkspace(message.id);
      return { windowId: winId };
    }

    case MESSAGE_TYPES.CLOSE_WORKSPACE: {
      await windowOpener.closeWorkspace(message.id);
      return { closed: true };
    }

    case MESSAGE_TYPES.RENAME_WORKSPACE: {
      return await workspaceManager.renameWorkspace(message.id, message.name);
    }

    case MESSAGE_TYPES.RECOLOR_WORKSPACE: {
      return await workspaceManager.recolorWorkspace(message.id, message.color);
    }

    case MESSAGE_TYPES.DELETE_WORKSPACE: {
      const deleted = await workspaceManager.deleteWorkspace(message.id);
      return { deleted };
    }

    case MESSAGE_TYPES.DUPLICATE_WORKSPACE: {
      return await workspaceManager.duplicateWorkspace(message.id);
    }

    case MESSAGE_TYPES.REORDER_WORKSPACES: {
      return await workspaceManager.reorderWorkspaces(message.order);
    }

    case MESSAGE_TYPES.ADOPT_WINDOW: {
      const windowId = message.windowId || sender.tab?.windowId;
      if (!windowId) {
        throw new Error('Target window ID not specified');
      }
      return await workspaceManager.adoptWindow(windowId, message.workspaceId);
    }

    case MESSAGE_TYPES.MOVE_TAB_TO_WORKSPACE: {
      await workspaceManager.moveTabToWorkspace(message.tabId, message.targetWorkspaceId);
      return { moved: true };
    }

    case MESSAGE_TYPES.CLOSE_TAB_IN_WORKSPACE: {
      await workspaceManager.closeTabInWorkspace(message.workspaceId, message.tabId);
      return { closed: true };
    }

    case MESSAGE_TYPES.MERGE_TABS_INTO_GROUP: {
      return await workspaceManager.mergeTabsIntoGroup({
        sourceWorkspaceId: message.sourceWorkspaceId,
        sourceTabId: message.sourceTabId,
        targetWorkspaceId: message.targetWorkspaceId,
        targetTabId: message.targetTabId
      });
    }

    case MESSAGE_TYPES.ADD_TAB_TO_GROUP: {
      return await workspaceManager.addTabToGroup({
        workspaceId: message.workspaceId,
        tabId: message.tabId,
        groupId: message.groupId
      });
    }

    case MESSAGE_TYPES.REMOVE_TAB_FROM_GROUP: {
      return await workspaceManager.removeTabFromGroup({
        workspaceId: message.workspaceId,
        tabId: message.tabId
      });
    }

    case MESSAGE_TYPES.UNGROUP_TABS: {
      return await workspaceManager.ungroupTabs({
        workspaceId: message.workspaceId,
        groupId: message.groupId
      });
    }

    case MESSAGE_TYPES.UPDATE_TAB_GROUP: {
      return await workspaceManager.updateTabGroup({
        workspaceId: message.workspaceId,
        groupId: message.groupId,
        title: message.title,
        color: message.color
      });
    }

    case MESSAGE_TYPES.ORGANIZE_TABS: {
      const windowId = message.windowId || sender.tab?.windowId;
      return await workspaceManager.organizeTabs({ workspaceId: message.workspaceId, windowId });
    }

    case MESSAGE_TYPES.OPEN_TAB_IN_WORKSPACE: {
      // Focus or open tab inside the workspace
      const winId = await windowRegistry.getWindowForWorkspace(message.workspaceId);
      if (winId !== null) {
        await chrome.windows.update(winId, { focused: true });
        if (message.tabId) {
          const tabs = await chrome.tabs.query({ windowId: winId });
          const target = tabs.find((t) => t.id === message.tabId || String(t.id) === String(message.tabId));
          if (target) {
            await chrome.tabs.update(target.id, { active: true });
          } else if (message.url) {
            await chrome.tabs.create({ windowId: winId, url: message.url, active: true });
          }
        }
        return { windowId: winId };
      } else {
        // Workspace not open, open workspace and activate target tab
        const newWinId = await windowOpener.openWorkspace(message.workspaceId, message.tabId);
        return { windowId: newWinId };
      }
    }

    case MESSAGE_TYPES.GET_CURRENT_STATUS: {
      const senderWindowId = message.windowId || sender.tab?.windowId;
      const bindings = await windowRegistry.getAllBindings();
      const currentWsId = senderWindowId ? (bindings[String(senderWindowId)] || null) : null;
      const activeWsId = await windowRegistry.getActiveWorkspaceId();

      return {
        windowId: senderWindowId,
        currentWorkspaceId: currentWsId,
        activeWorkspaceId: activeWsId,
        bindings
      };
    }

    case MESSAGE_TYPES.GET_SETTINGS: {
      const state = await workspaceManager.getState();
      return state.settings;
    }

    case MESSAGE_TYPES.UPDATE_SETTINGS: {
      const state = await workspaceManager.getState();
      const updatedSettings = { ...state.settings, ...message.settings };
      await storage.setLocal({ [STORAGE_KEYS.SETTINGS]: updatedSettings });
      return updatedSettings;
    }

    case MESSAGE_TYPES.EXPORT: {
      const state = await workspaceManager.getState();
      return {
        schemaVersion: state.schemaVersion,
        exportedAt: new Date().toISOString(),
        settings: state.settings,
        workspaces: state.workspaces,
        workspaceOrder: state.workspaceOrder
      };
    }

    case MESSAGE_TYPES.IMPORT: {
      const validated = validateImportPayload(message.payload);
      await storage.setLocal({
        [STORAGE_KEYS.SCHEMA_VERSION]: validated.schemaVersion,
        [STORAGE_KEYS.SETTINGS]: validated.settings,
        [STORAGE_KEYS.WORKSPACES]: validated.workspaces,
        [STORAGE_KEYS.WORKSPACE_ORDER]: validated.workspaceOrder
      });
      return { success: true, count: Object.keys(validated.workspaces).length };
    }

    case MESSAGE_TYPES.RESET_ALL: {
      await storage.clearLocal();
      await storage.clearSession();
      // Reseed defaults
      const seeded = await workspaceManager.getState();
      return { reset: true, state: seeded };
    }

    case MESSAGE_TYPES.OPEN_SIDE_PANEL: {
      const winId = message.windowId || sender?.tab?.windowId;
      if (chrome.sidePanel?.open && winId) {
        try {
          await chrome.sidePanel.open({ windowId: winId });
          return { success: true };
        } catch (err) {
          console.warn('router: Could not open side panel:', err);
        }
      }
      return { success: false };
    }

    default:
      console.warn(`router: Unrecognized message type: ${message.type}`);
      return null;
  }
}
