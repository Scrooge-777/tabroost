/**
 * Tab Sync — Listens to tab and window events, captures window snapshots with debouncing,
 * and persists them reliably to storage.local.
 */

import { windowRegistry } from './window-registry.js';
import { workspaceManager } from './workspace-manager.js';
import { MESSAGE_TYPES } from '../shared/constants.js';
import { generateId, deepEqual } from '../shared/utils.js';

class TabSync {
  constructor() {
    this.debounceTimers = new Map(); // wsId -> timer
    this.lastKnownSnapshots = new Map(); // wsId -> snapshot
    this.initialized = false;
    this.isGroupingTabs = false;
  }

  /**
   * Register all tab and window listeners
   */
  init() {
    if (this.initialized) return;
    this.initialized = true;

    // Tab lifecycle events
    chrome.tabs.onCreated.addListener(this.handleTabEvent.bind(this));
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));
    chrome.tabs.onUpdated.addListener(this.handleTabUpdated.bind(this));
    chrome.tabs.onMoved.addListener(this.handleTabMoved.bind(this));
    chrome.tabs.onAttached.addListener(this.handleTabEvent.bind(this));
    chrome.tabs.onDetached.addListener(this.handleTabEvent.bind(this));
    chrome.tabs.onActivated.addListener(this.handleTabActivated.bind(this));

    // Tab group events (if tabGroups API available)
    if (chrome.tabGroups) {
      chrome.tabGroups.onCreated.addListener(this.handleGroupEvent.bind(this));
      chrome.tabGroups.onUpdated.addListener(this.handleGroupEvent.bind(this));
      chrome.tabGroups.onMoved.addListener(this.handleGroupEvent.bind(this));
      chrome.tabGroups.onRemoved.addListener(this.handleGroupEvent.bind(this));
    }

    // Window lifecycle events
    chrome.windows.onRemoved.addListener(this.handleWindowRemoved.bind(this));
    chrome.windows.onFocusChanged.addListener(this.handleWindowFocusChanged.bind(this));
  }

  /**
   * General handler for tab changes
   */
  async handleTabEvent(tab) {
    if (!tab || !tab.windowId) return;
    await this.triggerSyncForWindow(tab.windowId);
  }

  /**
   * Handler for tab removal
   */
  async handleTabRemoved(tabId, removeInfo) {
    if (removeInfo && removeInfo.isWindowClosing) {
      // Window is closing; handled by windows.onRemoved
      return;
    }
    if (removeInfo && removeInfo.windowId) {
      await this.triggerSyncForWindow(removeInfo.windowId);
    }
  }

  /**
   * Handler for tab updates (filter for URL/title/status/pinned changes)
   */
  async handleTabUpdated(tabId, changeInfo, tab) {
    if (!tab || !tab.windowId) return;

    // Filter to significant changes to avoid spamming saves during loading
    const isSignificant =
      changeInfo.status === 'complete' ||
      changeInfo.url !== undefined ||
      changeInfo.title !== undefined ||
      changeInfo.pinned !== undefined ||
      changeInfo.groupId !== undefined;

    if (isSignificant) {
      await this.triggerSyncForWindow(tab.windowId);
    }
  }

  /**
   * Handler for active tab change
   */
  async handleTabActivated(activeInfo) {
    if (!activeInfo || !activeInfo.windowId) return;
    await this.triggerSyncForWindow(activeInfo.windowId, 150);
  }

  /**
   * Handler for native tab groups events
   */
  async handleGroupEvent(group) {
    if (!group || !group.windowId) return;
    await this.triggerSyncForWindow(group.windowId);
  }

  /**
   * Handler for window removal
   */
  async handleWindowRemoved(windowId) {
    const wsId = await windowRegistry.getWorkspaceForWindow(windowId);
    if (!wsId) return;

    // Unbind window. Tab snapshot was already captured on the last debounced save.
    await windowRegistry.unbind(windowId);

    // Clear any pending debounce timer for this workspace
    if (this.debounceTimers.has(wsId)) {
      clearTimeout(this.debounceTimers.get(wsId));
      this.debounceTimers.delete(wsId);
    }

    this.broadcast(MESSAGE_TYPES.STATE_CHANGED, { workspaceId: wsId });
  }

  /**
   * Handler for window focus changes
   */
  async handleWindowFocusChanged(windowId) {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;

    const wsId = await windowRegistry.getWorkspaceForWindow(windowId);
    if (wsId) {
      await windowRegistry.setActiveWorkspaceId(wsId);
      this.broadcast(MESSAGE_TYPES.STATE_CHANGED, { activeWorkspaceId: wsId });
    }
  }

  /**
   * Helper to check sync suppression and schedule save
   */
  async triggerSyncForWindow(windowId, delayMs = 400) {
    const suppress = await windowRegistry.getSuppressSync();
    if (suppress) return;

    let wsId = await windowRegistry.getWorkspaceForWindow(windowId);
    if (!wsId) {
      // Auto-bind active workspace to window if autoSyncNewTabs is enabled
      const state = await workspaceManager.getState();
      const settings = state.settings || {};
      if (settings.autoSyncNewTabs !== false) {
        let targetWsId = await windowRegistry.getActiveWorkspaceId();
        if (!targetWsId && state.workspaceOrder?.length > 0) {
          targetWsId = state.workspaceOrder[0];
        }
        if (targetWsId && state.workspaces[targetWsId]) {
          const existingWin = await windowRegistry.getWindowForWorkspace(targetWsId);
          if (!existingWin || existingWin === windowId) {
            await windowRegistry.bind(windowId, targetWsId);
            wsId = targetWsId;
            this.broadcast(MESSAGE_TYPES.STATE_CHANGED, { workspaceId: wsId });
          }
        }
      }
    }

    if (!wsId) return; // Still unmanaged, ignore

    this.scheduleSave(wsId, delayMs);
  }

  /**
   * Handler for tab movement — auto-syncs order and merges overlapping tabs into groups (Edge-style)
   */
  async handleTabMoved(tabId, moveInfo) {
    if (!moveInfo || !moveInfo.windowId) return;

    // 1. Trigger regular debounce sync for tab order
    await this.triggerSyncForWindow(moveInfo.windowId);

    // 2. Drag tab onto tab to merge into tab group (Edge style)
    if (this.isGroupingTabs) return;

    const suppress = await windowRegistry.getSuppressSync();
    if (suppress) return;

    const state = await workspaceManager.getState();
    const settings = state.settings || {};
    if (settings.dragToGroupTabs === false) return; // Enabled by default

    const { fromIndex, toIndex, windowId } = moveInfo;
    if (fromIndex === toIndex) return;

    try {
      this.isGroupingTabs = true;

      const tabs = await chrome.tabs.query({ windowId });
      if (!tabs || tabs.length < 2) return;

      const movedTab = tabs.find((t) => t.id === tabId);
      if (!movedTab || movedTab.pinned) return;

      // Identify the adjacent target tab at the drop location
      let targetTab = null;
      if (fromIndex > toIndex) {
        targetTab = tabs[toIndex + 1] || tabs[toIndex - 1];
      } else {
        targetTab = tabs[toIndex - 1] || tabs[toIndex + 1];
      }

      if (!targetTab || targetTab.id === tabId || targetTab.pinned) return;

      // Group tabs
      if (targetTab.groupId && targetTab.groupId !== -1) {
        await chrome.tabs.group({ tabIds: movedTab.id, groupId: targetTab.groupId });
      } else if (movedTab.groupId && movedTab.groupId !== -1) {
        await chrome.tabs.group({ tabIds: targetTab.id, groupId: movedTab.groupId });
      } else {
        const newGroupId = await chrome.tabs.group({ tabIds: [targetTab.id, movedTab.id] });
        if (chrome.tabGroups) {
          await chrome.tabGroups.update(newGroupId, {
            title: 'Group',
            color: 'blue'
          });
        }
      }

      await this.triggerSyncForWindow(windowId, 100);
    } catch (err) {
      console.warn('tabSync: Error in handleTabMoved drag-to-group:', err);
    } finally {
      setTimeout(() => {
        this.isGroupingTabs = false;
      }, 350);
    }
  }

  /**
   * Schedule debounced save coalesced per workspace
   */
  scheduleSave(workspaceId, delayMs = 400) {
    if (this.debounceTimers.has(workspaceId)) {
      clearTimeout(this.debounceTimers.get(workspaceId));
    }

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

  /**
   * Snapshot full window state and persist to storage.local
   */
  async saveWorkspaceFromWindow(workspaceId) {
    const suppress = await windowRegistry.getSuppressSync();
    if (suppress) return;

    const windowId = await windowRegistry.getWindowForWorkspace(workspaceId);
    if (windowId === null) return;

    // Query all tabs in the window
    let tabs = [];
    try {
      tabs = await chrome.tabs.query({ windowId });
    } catch {
      return; // Window might have just closed
    }

    if (!tabs || tabs.length === 0) return;

    // Query tab groups if available
    let nativeGroups = [];
    if (chrome.tabGroups) {
      try {
        nativeGroups = await chrome.tabGroups.query({ windowId });
      } catch {
        // Tab groups query failed
      }
    }

    // Load current workspace data to preserve persistent group IDs if possible
    const state = await workspaceManager.getState();
    const currentWs = state.workspaces[workspaceId];
    if (!currentWs) return;

    // Create a mapping from native group ID to stable persistent group ID
    const nativeToPersistentGid = new Map();
    const existingGroupsByTitle = new Map(
      (currentWs.groups || []).map((g) => [g.title + '::' + g.color, g.id])
    );

    const savedGroups = nativeGroups.map((ng) => {
      const key = (ng.title || '') + '::' + (ng.color || '');
      const persistentId = existingGroupsByTitle.get(key) || generateId('g');
      nativeToPersistentGid.set(ng.id, persistentId);
      return {
        id: persistentId,
        title: ng.title || '',
        color: ng.color || 'grey',
        collapsed: false
      };
    });

    // Map existing tabs to preserve stable tab IDs
    const existingTabsByUrl = new Map();
    for (const pt of (currentWs.tabs || [])) {
      if (pt.url && !existingTabsByUrl.has(pt.url)) {
        existingTabsByUrl.set(pt.url, pt.id);
      }
    }

    const savedTabs = tabs.map((t, idx) => {
      const tabUrl = t.url || t.pendingUrl || 'chrome://newtab/';
      let persistentTabId = null;
      if (currentWs.tabs?.[idx]?.url === tabUrl) {
        persistentTabId = currentWs.tabs[idx].id;
      } else if (existingTabsByUrl.has(tabUrl)) {
        persistentTabId = existingTabsByUrl.get(tabUrl);
      } else {
        persistentTabId = generateId('t');
      }

      return {
        id: persistentTabId,
        url: tabUrl,
        title: t.title || 'New Tab',
        favIconUrl: t.favIconUrl || '',
        pinned: Boolean(t.pinned),
        index: idx,
        groupId: t.groupId && t.groupId !== -1 ? nativeToPersistentGid.get(t.groupId) || null : null,
        active: Boolean(t.active)
      };
    });

    // Check if anything actually changed compared to last known snapshot
    const currentSnapshot = { tabs: savedTabs, groups: savedGroups };
    const lastSnapshot = this.lastKnownSnapshots.get(workspaceId);
    if (lastSnapshot && deepEqual(currentSnapshot, lastSnapshot)) {
      return; // No real change, skip write
    }

    this.lastKnownSnapshots.set(workspaceId, currentSnapshot);

    // Persist to storage
    currentWs.tabs = savedTabs;
    currentWs.groups = savedGroups;
    currentWs.updatedAt = Date.now();

    await workspaceManager.saveWorkspaces(state.workspaces);

    // Broadcast update to side panel and options
    this.broadcast(MESSAGE_TYPES.WORKSPACE_UPDATED, { workspaceId });
  }

  /**
   * Safe runtime message broadcaster
   */
  broadcast(type, payload = {}) {
    try {
      if (chrome.runtime?.sendMessage) {
        const p = chrome.runtime.sendMessage({ type, ...payload });
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      }
    } catch {
      // Ignore
    }
  }
}

export const tabSync = new TabSync();
