/**
 * Router — Handles runtime.onMessage commands from side panel, options, and page scripts
 */

import {
  MESSAGE_TYPES,
  STORAGE_KEYS,
  BROADCAST_TYPES,
  SETTING_KEYS,
  SYNC_MIN_PASSPHRASE_LENGTH,
  EXPORT_APP_NAME
} from '../shared/constants.js';
import { workspaceManager } from './workspace-manager.js';
import { windowRegistry } from './window-registry.js';
import { windowOpener } from './window-opener.js';
import { backups } from './backups.js';
import { history } from './history.js';
import { sessionRestore } from './session-restore.js';
import { templates } from './templates.js';
import { pageFeatures } from './page-features.js';
import { syncEngine } from './sync-engine.js';
import { storage } from '../shared/storage.js';
import { validateImportPayload, sanitizeWorkspace } from '../shared/schema.js';
import { generateId } from '../shared/utils.js';
import { setSyncSecrets, applyRememberChoice, clearSyncSecrets } from '../shared/secrets.js';

// Content scripts run next to untrusted web pages, so they only get the commands the
// page indicator needs. Everything else must come from an extension page.
const CONTENT_SCRIPT_TYPES = new Set([
  MESSAGE_TYPES.GET_PAGE_INDICATOR,
  MESSAGE_TYPES.UPDATE_SETTINGS
]);
const CONTENT_SCRIPT_SETTING_KEYS = new Set(['pillOffsetX', 'pillOffsetY']);

/**
 * Decide whether a sender may send this message. Extension pages (panel, popup,
 * options, flyout) are trusted; content scripts are limited to an allowlist.
 */
export function isSenderAllowed(message, sender = {}, extensionId = chrome.runtime.id, extensionOrigin = chrome.runtime.getURL('')) {
  if (sender.id !== extensionId) return false;
  if (!sender.url || sender.url.startsWith(extensionOrigin)) return true;
  if (!CONTENT_SCRIPT_TYPES.has(message.type)) return false;
  if (message.type === MESSAGE_TYPES.UPDATE_SETTINGS) {
    const keys = Object.keys(message.settings || {});
    return keys.length > 0 && keys.every((k) => CONTENT_SCRIPT_SETTING_KEYS.has(k));
  }
  return true;
}

export function registerMessageRouter() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type || BROADCAST_TYPES.has(message.type)) return false;
    if (!isSenderAllowed(message, sender)) {
      console.warn('router: rejected', message.type, 'from', sender?.url || sender?.id);
      return false;
    }

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
          sendResponse({ success: false, error: err?.message || String(err) });
        } catch {
          // Port closed
        }
      });

    // Keep the channel open for the async response
    return true;
  });
}

export async function handleMessage(message, sender = {}) {
  if (!message || !message.type) {
    throw new Error('Malformed message: missing type');
  }

  switch (message.type) {
    case MESSAGE_TYPES.LIST_WORKSPACES: {
      await windowRegistry.cleanupStaleBindings();
      return {
        ...(await workspaceManager.getState()),
        pendingRestore: await sessionRestore.getPending(),
        templates: await templates.list()
      };
    }

    case MESSAGE_TYPES.CREATE_WORKSPACE:
      return workspaceManager.createWorkspace({
        name: message.name,
        color: message.color,
        icon: message.icon,
        notes: message.notes
      });

    case MESSAGE_TYPES.SAVE_TEMPLATE:
      return templates.saveFromWorkspace(message.workspaceId, message.name);

    case MESSAGE_TYPES.DELETE_TEMPLATE:
      return { deleted: await templates.remove(message.id) };

    case MESSAGE_TYPES.CREATE_FROM_TEMPLATE:
      return templates.instantiate(message.id, message.name);

    case MESSAGE_TYPES.CREATE_FROM_CURRENT_WINDOW: {
      const windowId = message.windowId || sender.tab?.windowId;
      if (!windowId) throw new Error('Target window ID not specified');
      return workspaceManager.createFromCurrentWindow(windowId, message.name, message.color, message.icon, message.notes);
    }

    case MESSAGE_TYPES.OPEN_WORKSPACE: {
      const winId = await windowOpener.openWorkspace(message.id);
      return { windowId: winId };
    }

    case MESSAGE_TYPES.CLOSE_WORKSPACE: {
      const closed = await windowOpener.closeWorkspace(message.id);
      return { closed };
    }

    case MESSAGE_TYPES.UPDATE_WORKSPACE:
      return workspaceManager.updateWorkspace(message.id, {
        name: message.name,
        color: message.color,
        icon: message.icon,
        notes: message.notes
      });

    case MESSAGE_TYPES.RENAME_WORKSPACE:
      return workspaceManager.renameWorkspace(message.id, message.name);

    case MESSAGE_TYPES.RECOLOR_WORKSPACE:
      return workspaceManager.recolorWorkspace(message.id, message.color);

    case MESSAGE_TYPES.DELETE_WORKSPACE: {
      const removed = await workspaceManager.deleteWorkspace(message.id);
      return { deleted: Boolean(removed), workspace: removed?.workspace || null, index: removed?.index ?? -1 };
    }

    case MESSAGE_TYPES.RESTORE_WORKSPACE:
      return workspaceManager.restoreWorkspace(message.workspace, message.index);

    case MESSAGE_TYPES.DUPLICATE_WORKSPACE:
      return workspaceManager.duplicateWorkspace(message.id);

    case MESSAGE_TYPES.REORDER_WORKSPACES:
      return workspaceManager.reorderWorkspaces(message.order);

    case MESSAGE_TYPES.ADOPT_WINDOW: {
      const winId = message.windowId || sender.tab?.windowId;
      if (!winId) throw new Error('Target window ID not specified');
      return workspaceManager.adoptWindow(winId, message.workspaceId);
    }

    case MESSAGE_TYPES.RESTORE_SESSION:
      return sessionRestore.restoreAll();

    case MESSAGE_TYPES.DISMISS_SESSION_RESTORE:
      await sessionRestore.dismiss();
      return { dismissed: true };

    case MESSAGE_TYPES.LIST_HISTORY:
      return { versions: await history.list(message.workspaceId) };

    case MESSAGE_TYPES.CREATE_VERSION: {
      const id = await history.record(message.workspaceId, 'manual', { force: true });
      return { created: Boolean(id) };
    }

    case MESSAGE_TYPES.RESTORE_VERSION: {
      const wasOpen = (await windowRegistry.getWindowForWorkspace(message.workspaceId)) !== null;
      // The open window would overwrite the restored tabs on its next save, so close it first
      if (wasOpen) await windowOpener.closeWorkspace(message.workspaceId);
      const result = await history.restore(message.workspaceId, message.versionId);
      if (wasOpen) await windowOpener.openWorkspace(message.workspaceId);
      return { ...result, reopened: wasOpen };
    }

    case MESSAGE_TYPES.SWITCH_TO_LAST: {
      const prevId = await windowRegistry.getPreviousWorkspaceId();
      if (!prevId) return { switched: false, reason: 'no-previous-workspace' };
      const winId = await windowOpener.openWorkspace(prevId);
      return { switched: true, workspaceId: prevId, windowId: winId };
    }

    case MESSAGE_TYPES.MOVE_TAB_TO_WORKSPACE:
      return workspaceManager.moveTabToWorkspace(message.tabId, message.targetWorkspaceId, message.sourceWorkspaceId);

    case MESSAGE_TYPES.CLOSE_TAB_IN_WORKSPACE:
      return workspaceManager.closeTabInWorkspace(message.workspaceId, message.tabId);

    case MESSAGE_TYPES.OPEN_TAB_IN_WORKSPACE:
      return windowOpener.openTabInWorkspace(message.workspaceId, message.tabId, message.url);

    case MESSAGE_TYPES.MERGE_TABS_INTO_GROUP:
      return workspaceManager.mergeTabsIntoGroup(message);

    case MESSAGE_TYPES.ADD_TAB_TO_GROUP:
      return workspaceManager.addTabToGroup(message);

    case MESSAGE_TYPES.REMOVE_TAB_FROM_GROUP:
      return workspaceManager.removeTabFromGroup(message);

    case MESSAGE_TYPES.UNGROUP_TABS:
      return workspaceManager.ungroupTabs(message);

    case MESSAGE_TYPES.UPDATE_TAB_GROUP:
      return workspaceManager.updateTabGroup(message);

    case MESSAGE_TYPES.ORGANIZE_TABS:
      return workspaceManager.organizeTabs(message);

    case MESSAGE_TYPES.GET_CURRENT_STATUS: {
      const windowId = message.windowId || sender.tab?.windowId;
      const wsId = windowId ? await windowRegistry.getWorkspaceForWindow(windowId) : null;
      return {
        workspaceId: wsId,
        currentWorkspaceId: wsId,
        isManaged: Boolean(wsId),
        bindings: await windowRegistry.getAllBindings(),
        previousWorkspaceId: await windowRegistry.getPreviousWorkspaceId()
      };
    }

    case MESSAGE_TYPES.GET_PAGE_INDICATOR:
      return pageFeatures.getIndicator(sender.tab?.windowId);

    case MESSAGE_TYPES.GET_SETTINGS: {
      const state = await workspaceManager.loadState();
      return state.settings;
    }

    case MESSAGE_TYPES.UPDATE_SETTINGS: {
      const updated = await workspaceManager.updateSettings(message.settings || {});
      if (message.settings && 'syncRememberSecrets' in message.settings) {
        await applyRememberChoice(Boolean(updated.syncRememberSecrets));
      }
      await pageFeatures.sync().catch((err) => console.warn('router: page feature sync failed', err));
      await syncEngine.ensureAlarm().catch(() => {});
      return updated;
    }

    case MESSAGE_TYPES.SYNC_PAGE_FEATURES:
      return pageFeatures.sync();

    // Cloud Sync Handlers
    case MESSAGE_TYPES.START_SYNC:
      return syncEngine.syncNow();

    case MESSAGE_TYPES.GET_SYNC_STATUS:
      return syncEngine.getStatus();

    case MESSAGE_TYPES.CLEAR_SYNC_CONFLICTS:
      await syncEngine.clearConflicts();
      return { cleared: true };

    case MESSAGE_TYPES.UPDATE_SYNC_CONFIG: {
      const secrets = message.secrets || {};
      if (typeof secrets.passphrase === 'string' && secrets.passphrase !== '' && secrets.passphrase.length < SYNC_MIN_PASSPHRASE_LENGTH) {
        throw new Error(`Passphrase must be at least ${SYNC_MIN_PASSPHRASE_LENGTH} characters`);
      }
      let settings = (await workspaceManager.loadState()).settings;
      if (message.settings) {
        settings = await workspaceManager.updateSettings(message.settings);
      }
      if (message.clearSecrets) {
        await clearSyncSecrets();
      } else if (typeof secrets.token === 'string' || typeof secrets.passphrase === 'string') {
        await setSyncSecrets(secrets, Boolean(settings.syncRememberSecrets));
      }
      await syncEngine.ensureAlarm().catch(() => {});
      return syncEngine.getStatus();
    }

    case MESSAGE_TYPES.EXPORT: {
      const state = await workspaceManager.loadState();
      return {
        app: EXPORT_APP_NAME,
        schemaVersion: state.schemaVersion,
        exportedAt: new Date().toISOString(),
        // Sync connection details stay on this device
        settings: Object.fromEntries(
          Object.entries(state.settings).filter(([k]) => !k.startsWith('sync') && k !== 'lastSyncedAt')
        ),
        workspaces: state.workspaces,
        workspaceOrder: state.workspaceOrder
      };
    }

    case MESSAGE_TYPES.IMPORT: {
      const validated = validateImportPayload(message.payload);
      await backups.create('before-import');
      const mode = message.mode === 'replace' ? 'replace' : 'merge';

      const count = await workspaceManager.mutate((state) => {
        if (mode === 'replace') {
          for (const id of Object.keys(state.workspaces)) {
            if (!validated.workspaces[id]) state.tombstones[id] = Date.now();
          }
          for (const id of Object.keys(validated.workspaces)) delete state.tombstones[id];
          state.workspaces = validated.workspaces;
          state.workspaceOrder = validated.workspaceOrder;
          return validated.workspaceOrder.length;
        }
        // Merge: imported workspaces are added; ID clashes get fresh IDs
        let added = 0;
        for (const id of validated.workspaceOrder) {
          const ws = sanitizeWorkspace(validated.workspaces[id], id);
          if (state.workspaces[ws.id]) ws.id = generateId('ws');
          state.workspaces[ws.id] = ws;
          state.workspaceOrder.push(ws.id);
          added++;
        }
        return added;
      });

      if (mode === 'replace') {
        // Keep this device's sync connection; take everything else from the file
        const current = (await workspaceManager.loadState()).settings;
        const merged = { ...validated.settings };
        for (const key of SETTING_KEYS) {
          if (key.startsWith('sync') || key === 'lastSyncedAt') merged[key] = current[key];
        }
        await storage.setLocal({ [STORAGE_KEYS.SETTINGS]: merged });
      }
      return { success: true, count, mode };
    }

    case MESSAGE_TYPES.LIST_BACKUPS:
      return backups.list();

    case MESSAGE_TYPES.CREATE_BACKUP:
      return { id: await backups.create('manual') };

    case MESSAGE_TYPES.RESTORE_BACKUP:
      return backups.restore(message.id);

    case MESSAGE_TYPES.RESET_ALL: {
      await backups.create('before-reset');
      const kept = await storage.getLocal(STORAGE_KEYS.BACKUPS);
      await storage.clearLocal();
      await storage.clearSession();
      // Backups survive a reset so it can be undone from Settings
      if (kept[STORAGE_KEYS.BACKUPS]) await storage.setLocal({ [STORAGE_KEYS.BACKUPS]: kept[STORAGE_KEYS.BACKUPS] });
      await pageFeatures.sync().catch(() => {});
      return { reset: true, state: await workspaceManager.getState() };
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
      throw new Error(`Unrecognized message type: ${message.type}`);
  }
}
