/**
 * Window Registry — tracks windowId <-> workspaceId bindings in chrome.storage.session
 * Backed entirely by storage.session. Survives service worker sleep.
 *
 * Also keeps "live maps" per workspace: persistent tab/group IDs -> native Chrome IDs
 * of the window currently showing that workspace. The UI only knows persistent IDs,
 * so every action on an open workspace resolves through these maps.
 */

import { STORAGE_KEYS } from '../shared/constants.js';
import { storage } from '../shared/storage.js';
import { createLock } from '../shared/utils.js';

const withLock = createLock();

async function readSession(keys) {
  return storage.getSession(keys);
}

export const windowRegistry = {
  /**
   * Bind a window to a workspace. A workspace lives in at most one window, so any
   * older binding for the same workspace is dropped.
   */
  async bind(windowId, workspaceId) {
    if (!windowId || !workspaceId) return;
    const key = String(windowId);

    await withLock(async () => {
      const session = await readSession([
        STORAGE_KEYS.WINDOW_BINDINGS,
        STORAGE_KEYS.ACTIVE_WORKSPACE_ID,
        STORAGE_KEYS.PREVIOUS_WORKSPACE_ID
      ]);

      const bindings = session[STORAGE_KEYS.WINDOW_BINDINGS] || {};
      for (const [winKey, wsId] of Object.entries(bindings)) {
        if (wsId === workspaceId && winKey !== key) delete bindings[winKey];
      }
      bindings[key] = workspaceId;

      const update = { [STORAGE_KEYS.WINDOW_BINDINGS]: bindings };
      Object.assign(update, activeUpdate(session, workspaceId));
      await storage.setSession(update);
    });
  },

  /**
   * Unbind a window
   */
  async unbind(windowId) {
    if (!windowId) return;
    const key = String(windowId);

    await withLock(async () => {
      const session = await readSession([
        STORAGE_KEYS.WINDOW_BINDINGS,
        STORAGE_KEYS.ACTIVE_WORKSPACE_ID,
        STORAGE_KEYS.LIVE_MAPS
      ]);

      const bindings = session[STORAGE_KEYS.WINDOW_BINDINGS] || {};
      const unboundWorkspaceId = bindings[key];
      if (!unboundWorkspaceId) return;
      delete bindings[key];

      const liveMaps = session[STORAGE_KEYS.LIVE_MAPS] || {};
      delete liveMaps[unboundWorkspaceId];

      const update = {
        [STORAGE_KEYS.WINDOW_BINDINGS]: bindings,
        [STORAGE_KEYS.LIVE_MAPS]: liveMaps
      };
      if (session[STORAGE_KEYS.ACTIVE_WORKSPACE_ID] === unboundWorkspaceId) {
        update[STORAGE_KEYS.ACTIVE_WORKSPACE_ID] = null;
      }
      await storage.setSession(update);
    });
  },

  /**
   * Drop every binding to a workspace (used when it is deleted)
   */
  async unbindWorkspace(workspaceId) {
    const bindings = await this.getAllBindings();
    for (const [winKey, wsId] of Object.entries(bindings)) {
      if (wsId === workspaceId) await this.unbind(Number(winKey));
    }
  },

  /**
   * Get workspace ID bound to a window
   */
  async getWorkspaceForWindow(windowId) {
    if (!windowId) return null;
    const bindings = await this.getAllBindings();
    return bindings[String(windowId)] || null;
  },

  /**
   * Find window ID for a given workspace (verifying the window still exists)
   */
  async getWindowForWorkspace(workspaceId) {
    if (!workspaceId) return null;
    const bindings = await this.getAllBindings();

    for (const [winIdStr, wsId] of Object.entries(bindings)) {
      if (wsId === workspaceId) {
        const winId = parseInt(winIdStr, 10);
        try {
          await chrome.windows.get(winId);
          return winId;
        } catch {
          // Window doesn't exist anymore; clean up stale binding
          await this.unbind(winId);
        }
      }
    }
    return null;
  },

  /**
   * Check if workspace is currently open in any window
   */
  async isWorkspaceOpen(workspaceId) {
    const winId = await this.getWindowForWorkspace(workspaceId);
    return winId !== null;
  },

  /**
   * Get all current bindings
   */
  async getAllBindings() {
    const session = await readSession(STORAGE_KEYS.WINDOW_BINDINGS);
    return session[STORAGE_KEYS.WINDOW_BINDINGS] || {};
  },

  /**
   * Get active workspace ID
   */
  async getActiveWorkspaceId() {
    const session = await readSession(STORAGE_KEYS.ACTIVE_WORKSPACE_ID);
    return session[STORAGE_KEYS.ACTIVE_WORKSPACE_ID] || null;
  },

  /**
   * The workspace that was active before the current one ("switch to last")
   */
  async getPreviousWorkspaceId() {
    const session = await readSession(STORAGE_KEYS.PREVIOUS_WORKSPACE_ID);
    return session[STORAGE_KEYS.PREVIOUS_WORKSPACE_ID] || null;
  },

  /**
   * Set active workspace ID
   */
  async setActiveWorkspaceId(workspaceId) {
    await withLock(async () => {
      const session = await readSession([STORAGE_KEYS.ACTIVE_WORKSPACE_ID, STORAGE_KEYS.PREVIOUS_WORKSPACE_ID]);
      await storage.setSession(activeUpdate(session, workspaceId || null));
    });
  },

  /**
   * Get suppressSync flag
   */
  async getSuppressSync() {
    const session = await readSession(STORAGE_KEYS.SUPPRESS_SYNC);
    return Boolean(session[STORAGE_KEYS.SUPPRESS_SYNC]);
  },

  /**
   * Set suppressSync flag
   */
  async setSuppressSync(value) {
    await storage.setSession({
      [STORAGE_KEYS.SUPPRESS_SYNC]: Boolean(value)
    });
  },

  /**
   * Live maps for a workspace: { tabs: {persistentId: chromeTabId}, groups: {persistentId: nativeGroupId} }
   */
  async getLiveMaps(workspaceId) {
    const session = await readSession(STORAGE_KEYS.LIVE_MAPS);
    const all = session[STORAGE_KEYS.LIVE_MAPS] || {};
    const maps = all[workspaceId] || {};
    return { tabs: maps.tabs || {}, groups: maps.groups || {} };
  },

  async setLiveMaps(workspaceId, maps) {
    await withLock(async () => {
      const session = await readSession(STORAGE_KEYS.LIVE_MAPS);
      const all = session[STORAGE_KEYS.LIVE_MAPS] || {};
      all[workspaceId] = { tabs: maps.tabs || {}, groups: maps.groups || {} };
      await storage.setSession({ [STORAGE_KEYS.LIVE_MAPS]: all });
    });
  },

  /**
   * Patch a single tab mapping (e.g. after moving a tab between workspace windows)
   */
  async moveLiveTab(fromWorkspaceId, toWorkspaceId, persistentTabId, chromeTabId) {
    await withLock(async () => {
      const session = await readSession(STORAGE_KEYS.LIVE_MAPS);
      const all = session[STORAGE_KEYS.LIVE_MAPS] || {};
      if (fromWorkspaceId && all[fromWorkspaceId]?.tabs) {
        delete all[fromWorkspaceId].tabs[persistentTabId];
      }
      if (toWorkspaceId) {
        all[toWorkspaceId] = all[toWorkspaceId] || { tabs: {}, groups: {} };
        all[toWorkspaceId].tabs = all[toWorkspaceId].tabs || {};
        all[toWorkspaceId].tabs[persistentTabId] = chromeTabId;
      }
      await storage.setSession({ [STORAGE_KEYS.LIVE_MAPS]: all });
    });
  },

  /**
   * Cleanup any dead window bindings
   */
  async cleanupStaleBindings() {
    const bindings = await this.getAllBindings();
    for (const winIdStr of Object.keys(bindings)) {
      const winId = parseInt(winIdStr, 10);
      try {
        await chrome.windows.get(winId);
      } catch {
        await this.unbind(winId);
      }
    }
  }
};

function activeUpdate(session, workspaceId) {
  const current = session[STORAGE_KEYS.ACTIVE_WORKSPACE_ID] || null;
  const update = { [STORAGE_KEYS.ACTIVE_WORKSPACE_ID]: workspaceId };
  if (current && workspaceId && current !== workspaceId) {
    update[STORAGE_KEYS.PREVIOUS_WORKSPACE_ID] = current;
  }
  return update;
}
