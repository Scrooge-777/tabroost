/**
 * Tab Sync — Listens to tab and window events of workspace windows, captures window
 * snapshots with debouncing, and persists them to storage.local.
 *
 * Only windows explicitly bound to a workspace are synced. Unmanaged windows are
 * never adopted automatically (that used to overwrite saved workspaces).
 */

import { windowRegistry } from './window-registry.js';
import { workspaceManager, snapshotWindow, SKIP_SAVE } from './workspace-manager.js';
import { MESSAGE_TYPES } from '../shared/constants.js';
import { deepEqual } from '../shared/utils.js';
import { history } from './history.js';

const DEFAULT_DELAY_MS = 400;

class TabSync {
  constructor() {
    this.debounceTimers = new Map(); // wsId -> timer
    this.initialized = false;
  }

  /**
   * Register all tab and window listeners
   */
  init() {
    if (this.initialized) return;
    this.initialized = true;

    chrome.tabs.onCreated.addListener((tab) => this.triggerSyncForWindow(tab?.windowId));
    chrome.tabs.onRemoved.addListener((tabId, info) => {
      // Window closing is handled by windows.onRemoved; the last snapshot is kept
      if (!info || info.isWindowClosing) return;
      this.triggerSyncForWindow(info.windowId);
    });
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      const significant =
        changeInfo.status === 'complete' ||
        changeInfo.url !== undefined ||
        changeInfo.title !== undefined ||
        changeInfo.pinned !== undefined ||
        changeInfo.groupId !== undefined;
      if (significant) this.triggerSyncForWindow(tab?.windowId);
    });
    chrome.tabs.onMoved.addListener((tabId, info) => this.triggerSyncForWindow(info?.windowId));
    chrome.tabs.onAttached.addListener((tabId, info) => this.triggerSyncForWindow(info?.newWindowId));
    chrome.tabs.onDetached.addListener((tabId, info) => this.triggerSyncForWindow(info?.oldWindowId));
    chrome.tabs.onActivated.addListener((info) => this.triggerSyncForWindow(info?.windowId, 250));

    if (chrome.tabGroups) {
      const onGroup = (group) => this.triggerSyncForWindow(group?.windowId);
      chrome.tabGroups.onCreated.addListener(onGroup);
      chrome.tabGroups.onUpdated.addListener(onGroup);
      chrome.tabGroups.onMoved.addListener(onGroup);
      chrome.tabGroups.onRemoved.addListener(onGroup);
    }

    chrome.windows.onRemoved.addListener((windowId) => this.handleWindowRemoved(windowId));
    chrome.windows.onFocusChanged.addListener((windowId) => this.handleWindowFocusChanged(windowId));
    chrome.windows.onBoundsChanged?.addListener((win) => this.triggerSyncForWindow(win?.id, 1000));
  }

  /**
   * Handler for window removal
   */
  async handleWindowRemoved(windowId) {
    const wsId = await windowRegistry.getWorkspaceForWindow(windowId);
    if (!wsId) return;

    // The window is gone, so a pending snapshot can no longer be taken
    this.cancel(wsId);
    await windowRegistry.unbind(windowId);
    this.broadcast(MESSAGE_TYPES.STATE_CHANGED, { workspaceId: wsId });
  }

  /**
   * Handler for window focus changes
   */
  async handleWindowFocusChanged(windowId) {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;

    const wsId = await windowRegistry.getWorkspaceForWindow(windowId);
    if (wsId) {
      const current = await windowRegistry.getActiveWorkspaceId();
      if (current !== wsId) {
        await windowRegistry.setActiveWorkspaceId(wsId);
        this.broadcast(MESSAGE_TYPES.STATE_CHANGED, { activeWorkspaceId: wsId });
      }
    }
  }

  /**
   * Schedule a save if the window belongs to a workspace
   */
  async triggerSyncForWindow(windowId, delayMs = DEFAULT_DELAY_MS) {
    if (!windowId || windowId === chrome.windows?.WINDOW_ID_NONE) return;
    try {
      if (await windowRegistry.getSuppressSync()) return;
      const wsId = await windowRegistry.getWorkspaceForWindow(windowId);
      if (wsId) this.scheduleSave(wsId, delayMs);
    } catch (err) {
      console.warn('tabSync: trigger failed', err);
    }
  }

  /**
   * Schedule debounced save coalesced per workspace
   */
  scheduleSave(workspaceId, delayMs = DEFAULT_DELAY_MS) {
    this.cancel(workspaceId);
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(workspaceId);
      try {
        await this.saveWorkspaceFromWindow(workspaceId);
      } catch (err) {
        console.warn(`tabSync: Failed to save workspace ${workspaceId}`, err);
      }
    }, delayMs);
    this.debounceTimers.set(workspaceId, timer);
  }

  cancel(workspaceId) {
    if (this.debounceTimers.has(workspaceId)) {
      clearTimeout(this.debounceTimers.get(workspaceId));
      this.debounceTimers.delete(workspaceId);
    }
  }

  /**
   * Save immediately, dropping any pending debounced save
   */
  async flush(workspaceId) {
    this.cancel(workspaceId);
    await this.saveWorkspaceFromWindow(workspaceId);
  }

  /**
   * Snapshot full window state and persist to storage.local
   */
  async saveWorkspaceFromWindow(workspaceId) {
    if (await windowRegistry.getSuppressSync()) return false;

    const windowId = await windowRegistry.getWindowForWorkspace(workspaceId);
    if (windowId === null) return false;

    const existing = await workspaceManager.getWorkspace(workspaceId);
    if (!existing) return false;

    let snap;
    try {
      const liveMaps = await windowRegistry.getLiveMaps(workspaceId);
      snap = await snapshotWindow(windowId, existing, liveMaps);
    } catch {
      return false; // Window might have just closed
    }
    if (!snap.tabs.length) return false;

    await windowRegistry.setLiveMaps(workspaceId, snap.liveMaps);

    const changed = await workspaceManager.mutate((state) => {
      const ws = state.workspaces[workspaceId];
      if (!ws) return SKIP_SAVE;
      if (deepEqual(ws.tabs, snap.tabs) && deepEqual(ws.groups, snap.groups) && deepEqual(ws.window, snap.window)) {
        return SKIP_SAVE;
      }
      ws.tabs = snap.tabs;
      ws.groups = snap.groups;
      ws.window = snap.window;
      ws.updatedAt = Date.now();
      return true;
    });

    if (changed) {
      this.broadcast(MESSAGE_TYPES.WORKSPACE_UPDATED, { workspaceId });
      history.record(workspaceId, 'auto').catch((err) => console.warn('tabSync: history record failed', err));
    }
    return Boolean(changed);
  }

  /**
   * Safe runtime message broadcaster (UI pages only; the worker itself reacts to storage changes)
   */
  broadcast(type, payload = {}) {
    try {
      const p = chrome.runtime?.sendMessage?.({ type, ...payload });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // No listeners
    }
  }
}

export const tabSync = new TabSync();
