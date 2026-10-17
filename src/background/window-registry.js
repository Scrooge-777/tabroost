/**
 * Window Registry — tracks windowId <-> workspaceId bindings in chrome.storage.session
 * Backed entirely by storage.session. Survives service worker sleep.
 */

import { STORAGE_KEYS } from '../shared/constants.js';
import { storage } from '../shared/storage.js';

export const windowRegistry = {
  /**
   * Bind a window to a workspace
   */
  async bind(windowId, workspaceId) {
    if (!windowId || !workspaceId) return;
    const key = String(windowId);

    const session = await storage.getSession([
      STORAGE_KEYS.WINDOW_BINDINGS,
      STORAGE_KEYS.ACTIVE_WORKSPACE_ID
    ]);

    const bindings = session[STORAGE_KEYS.WINDOW_BINDINGS] || {};
    bindings[key] = workspaceId;

    await storage.setSession({
      [STORAGE_KEYS.WINDOW_BINDINGS]: bindings,
      [STORAGE_KEYS.ACTIVE_WORKSPACE_ID]: workspaceId
    });
  },

  /**
   * Unbind a window
   */
  async unbind(windowId) {
    if (!windowId) return;
    const key = String(windowId);

    const session = await storage.getSession([
      STORAGE_KEYS.WINDOW_BINDINGS,
      STORAGE_KEYS.ACTIVE_WORKSPACE_ID
    ]);

    const bindings = session[STORAGE_KEYS.WINDOW_BINDINGS] || {};
    const unboundWorkspaceId = bindings[key];
    delete bindings[key];

    let activeWorkspaceId = session[STORAGE_KEYS.ACTIVE_WORKSPACE_ID];
    if (activeWorkspaceId === unboundWorkspaceId) {
      activeWorkspaceId = null;
    }

    await storage.setSession({
      [STORAGE_KEYS.WINDOW_BINDINGS]: bindings,
      [STORAGE_KEYS.ACTIVE_WORKSPACE_ID]: activeWorkspaceId
    });
  },

  /**
   * Get workspace ID bound to a window
   */
  async getWorkspaceForWindow(windowId) {
    if (!windowId) return null;
    const key = String(windowId);
    const session = await storage.getSession(STORAGE_KEYS.WINDOW_BINDINGS);
    const bindings = session[STORAGE_KEYS.WINDOW_BINDINGS] || {};
    return bindings[key] || null;
  },

  /**
   * Find window ID for a given workspace
   */
  async getWindowForWorkspace(workspaceId) {
    if (!workspaceId) return null;
    const session = await storage.getSession(STORAGE_KEYS.WINDOW_BINDINGS);
    const bindings = session[STORAGE_KEYS.WINDOW_BINDINGS] || {};

    for (const [winIdStr, wsId] of Object.entries(bindings)) {
      if (wsId === workspaceId) {
        const winId = parseInt(winIdStr, 10);
        // Verify window is still open
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
    const session = await storage.getSession(STORAGE_KEYS.WINDOW_BINDINGS);
    return session[STORAGE_KEYS.WINDOW_BINDINGS] || {};
  },

  /**
   * Get active workspace ID
   */
  async getActiveWorkspaceId() {
    const session = await storage.getSession(STORAGE_KEYS.ACTIVE_WORKSPACE_ID);
    return session[STORAGE_KEYS.ACTIVE_WORKSPACE_ID] || null;
  },

  /**
   * Set active workspace ID
   */
  async setActiveWorkspaceId(workspaceId) {
    await storage.setSession({
      [STORAGE_KEYS.ACTIVE_WORKSPACE_ID]: workspaceId || null
    });
  },

  /**
   * Get suppressSync flag
   */
  async getSuppressSync() {
    const session = await storage.getSession(STORAGE_KEYS.SUPPRESS_SYNC);
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
   * Cleanup any dead window bindings
   */
  async cleanupStaleBindings() {
    const session = await storage.getSession(STORAGE_KEYS.WINDOW_BINDINGS);
    const bindings = session[STORAGE_KEYS.WINDOW_BINDINGS] || {};
    let changed = false;

    for (const winIdStr of Object.keys(bindings)) {
      const winId = parseInt(winIdStr, 10);
      try {
        await chrome.windows.get(winId);
      } catch {
        delete bindings[winIdStr];
        changed = true;
      }
    }

    if (changed) {
      await storage.setSession({ [STORAGE_KEYS.WINDOW_BINDINGS]: bindings });
    }
  }
};
