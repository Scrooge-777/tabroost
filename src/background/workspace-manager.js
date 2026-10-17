/**
 * Workspace Manager — handles CRUD, persistence, duplication, and window adoption
 */

import { STORAGE_KEYS } from '../shared/constants.js';
import { storage } from '../shared/storage.js';
import { createWorkspaceModel, migrateStorageData, sanitizeTab, sanitizeGroup } from '../shared/schema.js';
import { windowRegistry } from './window-registry.js';
import { generateId } from '../shared/utils.js';

export const workspaceManager = {
  /**
   * Load full workspaces state from storage
   */
  async getState() {
    const raw = await storage.getLocal([
      STORAGE_KEYS.WORKSPACES,
      STORAGE_KEYS.WORKSPACE_ORDER,
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.SCHEMA_VERSION
    ]);

    const state = migrateStorageData(raw);
    const bindings = await windowRegistry.getAllBindings();
    const activeWorkspaceId = await windowRegistry.getActiveWorkspaceId();

    return {
      ...state,
      bindings,
      activeWorkspaceId
    };
  },

  /**
   * Get single workspace by ID
   */
  async getWorkspace(id) {
    const state = await this.getState();
    return state.workspaces[id] || null;
  },

  /**
   * Save updated workspaces dictionary and order
   */
  async saveWorkspaces(workspaces, workspaceOrder = null) {
    const update = {
      [STORAGE_KEYS.WORKSPACES]: workspaces
    };
    if (workspaceOrder) {
      update[STORAGE_KEYS.WORKSPACE_ORDER] = workspaceOrder;
    }
    await storage.setLocal(update);
  },

  /**
   * Create a new workspace
   */
  async createWorkspace({ name, color, icon, tabs = [], groups = [] }) {
    const state = await this.getState();
    const newWs = createWorkspaceModel({ name, color, icon, tabs, groups });

    state.workspaces[newWs.id] = newWs;
    state.workspaceOrder.push(newWs.id);

    await this.saveWorkspaces(state.workspaces, state.workspaceOrder);
    return newWs;
  },

  /**
   * Create a workspace from an existing browser window
   */
  async createFromCurrentWindow(windowId, name, color) {
    const [tabs, nativeGroups] = await Promise.all([
      chrome.tabs.query({ windowId }),
      chrome.tabGroups ? chrome.tabGroups.query({ windowId }) : Promise.resolve([])
    ]);

    // Map native group IDs to persistent group IDs
    const groupIdMap = new Map();
    const savedGroups = nativeGroups.map((ng) => {
      const persistentId = generateId('g');
      groupIdMap.set(ng.id, persistentId);
      return {
        id: persistentId,
        title: ng.title || '',
        color: ng.color || 'grey',
        collapsed: false
      };
    });

    const savedTabs = tabs.map((t, idx) => ({
      id: generateId('t'),
      url: t.url || t.pendingUrl || 'chrome://newtab/',
      title: t.title || 'New Tab',
      favIconUrl: t.favIconUrl || '',
      pinned: t.pinned || false,
      index: idx,
      groupId: t.groupId && t.groupId !== -1 ? groupIdMap.get(t.groupId) || null : null,
      active: t.active || false
    }));

    const ws = await this.createWorkspace({
      name: name || 'Window Workspace',
      color: color || 'blue',
      tabs: savedTabs,
      groups: savedGroups
    });

    // Bind this window immediately
    await windowRegistry.bind(windowId, ws.id);
    return ws;
  },

  /**
   * Rename workspace
   */
  async renameWorkspace(id, newName) {
    const state = await this.getState();
    if (!state.workspaces[id]) {
      throw new Error(`Workspace ${id} not found`);
    }

    state.workspaces[id].name = (newName || 'Workspace').trim();
    state.workspaces[id].updatedAt = Date.now();

    await this.saveWorkspaces(state.workspaces);
    return state.workspaces[id];
  },

  /**
   * Recolor workspace
   */
  async recolorWorkspace(id, newColor) {
    const state = await this.getState();
    if (!state.workspaces[id]) {
      throw new Error(`Workspace ${id} not found`);
    }

    state.workspaces[id].color = newColor;
    state.workspaces[id].updatedAt = Date.now();

    await this.saveWorkspaces(state.workspaces);
    return state.workspaces[id];
  },

  /**
   * Delete workspace
   */
  async deleteWorkspace(id) {
    const state = await this.getState();
    if (!state.workspaces[id]) return false;

    // If window is currently open, unbind it so it becomes unmanaged
    const winId = await windowRegistry.getWindowForWorkspace(id);
    if (winId) {
      await windowRegistry.unbind(winId);
    }

    delete state.workspaces[id];
    state.workspaceOrder = state.workspaceOrder.filter((wId) => wId !== id);

    await this.saveWorkspaces(state.workspaces, state.workspaceOrder);
    return true;
  },

  /**
   * Duplicate workspace
   */
  async duplicateWorkspace(id) {
    const state = await this.getState();
    const source = state.workspaces[id];
    if (!source) {
      throw new Error(`Workspace ${id} not found`);
    }

    // Remap group IDs
    const groupIdMap = new Map();
    const newGroups = (source.groups || []).map((g) => {
      const newGid = generateId('g');
      groupIdMap.set(g.id, newGid);
      return {
        ...g,
        id: newGid
      };
    });

    const newTabs = (source.tabs || []).map((t) => ({
      ...t,
      id: generateId('t'),
      groupId: t.groupId ? groupIdMap.get(t.groupId) || null : null
    }));

    const copy = createWorkspaceModel({
      name: `${source.name} (Copy)`,
      color: source.color,
      icon: source.icon,
      tabs: newTabs,
      groups: newGroups
    });

    state.workspaces[copy.id] = copy;

    // Insert copy directly after original
    const idx = state.workspaceOrder.indexOf(id);
    if (idx !== -1) {
      state.workspaceOrder.splice(idx + 1, 0, copy.id);
    } else {
      state.workspaceOrder.push(copy.id);
    }

    await this.saveWorkspaces(state.workspaces, state.workspaceOrder);
    return copy;
  },

  /**
   * Reorder workspaces
   */
  async reorderWorkspaces(newOrder) {
    const state = await this.getState();
    // Validate that newOrder contains valid IDs
    const validIds = newOrder.filter((id) => Boolean(state.workspaces[id]));
    for (const id of state.workspaceOrder) {
      if (!validIds.includes(id)) validIds.push(id);
    }

    await storage.setLocal({ [STORAGE_KEYS.WORKSPACE_ORDER]: validIds });
    return validIds;
  },

  /**
   * Adopt current window into an existing workspace
   */
  async adoptWindow(windowId, workspaceId) {
    const state = await this.getState();
    const ws = state.workspaces[workspaceId];
    if (!ws) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    // Capture current tabs and groups in the window
    const [tabs, nativeGroups] = await Promise.all([
      chrome.tabs.query({ windowId }),
      chrome.tabGroups ? chrome.tabGroups.query({ windowId }) : Promise.resolve([])
    ]);

    const groupIdMap = new Map();
    const savedGroups = nativeGroups.map((ng) => {
      const persistentId = generateId('g');
      groupIdMap.set(ng.id, persistentId);
      return {
        id: persistentId,
        title: ng.title || '',
        color: ng.color || 'grey',
        collapsed: false
      };
    });

    const savedTabs = tabs.map((t, idx) => ({
      id: generateId('t'),
      url: t.url || t.pendingUrl || 'chrome://newtab/',
      title: t.title || 'New Tab',
      favIconUrl: t.favIconUrl || '',
      pinned: t.pinned || false,
      index: idx,
      groupId: t.groupId && t.groupId !== -1 ? groupIdMap.get(t.groupId) || null : null,
      active: t.active || false
    }));

    ws.tabs = savedTabs;
    ws.groups = savedGroups;
    ws.updatedAt = Date.now();
    ws.lastOpenedAt = Date.now();

    await this.saveWorkspaces(state.workspaces);
    await windowRegistry.bind(windowId, workspaceId);
    return ws;
  },

  /**
   * Move a tab to a target workspace
   */
  async moveTabToWorkspace(tabId, targetWorkspaceId) {
    const state = await this.getState();
    const targetWs = state.workspaces[targetWorkspaceId];
    if (!targetWs) {
      throw new Error(`Target workspace ${targetWorkspaceId} not found`);
    }

    const targetWinId = await windowRegistry.getWindowForWorkspace(targetWorkspaceId);

    if (targetWinId !== null) {
      // Target workspace is currently open in a window: move tab natively
      await chrome.tabs.move(tabId, { windowId: targetWinId, index: -1 });
    } else {
      // Target workspace is closed: get tab info, append to target tabs, close tab in current window
      const tab = await chrome.tabs.get(tabId);
      const newTabEntry = {
        id: generateId('t'),
        url: tab.url || tab.pendingUrl || 'chrome://newtab/',
        title: tab.title || 'New Tab',
        favIconUrl: tab.favIconUrl || '',
        pinned: tab.pinned || false,
        index: targetWs.tabs.length,
        groupId: null,
        active: false
      };

      targetWs.tabs.push(newTabEntry);
      targetWs.updatedAt = Date.now();
      await this.saveWorkspaces(state.workspaces);

      // Close the tab in the current window
      await chrome.tabs.remove(tabId);
    }
  },

  /**
   * Close a specific tab in a workspace
   */
  async closeTabInWorkspace(workspaceId, tabId) {
    const winId = await windowRegistry.getWindowForWorkspace(workspaceId);
    if (winId !== null) {
      // Check if tab exists in active window
      const tabs = await chrome.tabs.query({ windowId: winId });
      const found = tabs.find((t) => String(t.id) === String(tabId) || t.id === tabId);
      if (found) {
        await chrome.tabs.remove(found.id);
        return;
      }
    }

    // Otherwise remove from persisted tab list
    const state = await this.getState();
    const ws = state.workspaces[workspaceId];
    if (ws) {
      ws.tabs = ws.tabs.filter((t) => t.id !== tabId);
      if (ws.tabs.length === 0) {
        // Always keep at least one tab
        ws.tabs.push({
          id: generateId('t'),
          url: 'chrome://newtab/',
          title: 'New Tab',
          favIconUrl: '',
          pinned: false,
          index: 0,
          groupId: null,
          active: true
        });
      }
      ws.updatedAt = Date.now();
      await this.saveWorkspaces(state.workspaces);
    }
  },

  /**
   * Merge one tab into another tab's group (or create a new group with both)
   */
  async mergeTabsIntoGroup({ sourceWorkspaceId, sourceTabId, targetWorkspaceId, targetTabId }) {
    if (!sourceTabId || !targetTabId || sourceTabId === targetTabId) {
      return { success: false, reason: 'invalid_tabs' };
    }

    const state = await this.getState();
    const targetWs = state.workspaces[targetWorkspaceId];
    if (!targetWs) throw new Error(`Target workspace ${targetWorkspaceId} not found`);

    // If source tab belongs to a different workspace, move it over first
    if (sourceWorkspaceId && sourceWorkspaceId !== targetWorkspaceId) {
      await this.moveTabToWorkspace(sourceTabId, targetWorkspaceId);
    }

    const winId = await windowRegistry.getWindowForWorkspace(targetWorkspaceId);
    if (winId !== null) {
      // Target workspace is currently open in a window
      try {
        const liveTabs = await chrome.tabs.query({ windowId: winId });
        let sourceLive = liveTabs.find((t) => t.id === sourceTabId || String(t.id) === String(sourceTabId));
        let targetLive = liveTabs.find((t) => t.id === targetTabId || String(t.id) === String(targetTabId));

        if (!targetLive) {
          const tIdx = targetWs.tabs.findIndex((t) => t.id === targetTabId);
          if (tIdx !== -1 && liveTabs[tIdx]) targetLive = liveTabs[tIdx];
        }
        if (!sourceLive) {
          const sIdx = targetWs.tabs.findIndex((t) => t.id === sourceTabId);
          if (sIdx !== -1 && liveTabs[sIdx]) sourceLive = liveTabs[sIdx];
        }

        if (sourceLive && targetLive) {
          if (targetLive.groupId && targetLive.groupId !== -1) {
            await chrome.tabs.group({ tabIds: sourceLive.id, groupId: targetLive.groupId });
            return { success: true, groupId: targetLive.groupId, isNew: false };
          } else if (sourceLive.groupId && sourceLive.groupId !== -1) {
            await chrome.tabs.group({ tabIds: targetLive.id, groupId: sourceLive.groupId });
            return { success: true, groupId: sourceLive.groupId, isNew: false };
          } else {
            const newGroupId = await chrome.tabs.group({ tabIds: [targetLive.id, sourceLive.id] });
            return { success: true, groupId: newGroupId, isNew: true };
          }
        }
      } catch (err) {
        console.warn('Live chrome.tabs.group failed, falling back to model update:', err);
      }
    }

    // Closed workspace or fallback: update stored model directly
    const currentState = await this.getState();
    const currentTargetWs = currentState.workspaces[targetWorkspaceId];
    if (!currentTargetWs) return { success: false };

    const targetTab = currentTargetWs.tabs.find((t) => t.id === targetTabId);
    const sourceTab = currentTargetWs.tabs.find((t) => t.id === sourceTabId);

    if (!targetTab || !sourceTab) {
      return { success: false, reason: 'tabs_not_found' };
    }

    let targetGid = targetTab.groupId || sourceTab.groupId;
    let isNew = false;
    if (!targetGid) {
      targetGid = generateId('g');
      isNew = true;
      if (!currentTargetWs.groups) currentTargetWs.groups = [];
      currentTargetWs.groups.push({
        id: targetGid,
        title: 'Group',
        color: 'blue',
        collapsed: false
      });
    }

    targetTab.groupId = targetGid;
    sourceTab.groupId = targetGid;
    currentTargetWs.updatedAt = Date.now();

    await this.saveWorkspaces(currentState.workspaces);
    return { success: true, groupId: targetGid, isNew };
  },

  /**
   * Update title and/or color of a tab group within a workspace model
   */
  async updateTabGroup({ workspaceId, groupId, title, color }) {
    const state = await this.getState();
    const ws = state.workspaces[workspaceId];
    if (!ws) return { success: false };

    if (!ws.groups) ws.groups = [];
    let group = ws.groups.find((g) => g.id === groupId);
    if (!group) {
      group = { id: groupId, title: title || 'Group', color: color || 'blue', collapsed: false };
      ws.groups.push(group);
    } else {
      if (title !== undefined) group.title = title || 'Group';
      if (color !== undefined) group.color = color;
    }

    ws.updatedAt = Date.now();
    await this.saveWorkspaces(state.workspaces);
    return { success: true, group };
  },

  /**
   * Add a tab to an existing group in a workspace
   */
  async addTabToGroup({ workspaceId, tabId, groupId }) {
    if (!workspaceId || !tabId || !groupId) return { success: false };

    const winId = await windowRegistry.getWindowForWorkspace(workspaceId);
    if (winId !== null && chrome.tabs) {
      try {
        const liveTabs = await chrome.tabs.query({ windowId: winId });
        const targetTab = liveTabs.find((t) => t.id === tabId || String(t.id) === String(tabId));
        if (targetTab) {
          const numGid = typeof groupId === 'number' ? groupId : parseInt(groupId, 10);
          if (Number.isInteger(numGid) && numGid > 0) {
            await chrome.tabs.group({ tabIds: targetTab.id, groupId: numGid });
            return { success: true, groupId: numGid };
          }
        }
      } catch (err) {
        console.warn('Live addTabToGroup failed, updating model:', err);
      }
    }

    const state = await this.getState();
    const ws = state.workspaces[workspaceId];
    if (!ws) return { success: false };

    const tab = (ws.tabs || []).find((t) => t.id === tabId || String(t.id) === String(tabId));
    if (tab) {
      tab.groupId = groupId;
      ws.updatedAt = Date.now();
      await this.saveWorkspaces(state.workspaces);
      return { success: true, groupId };
    }
    return { success: false };
  },

  /**
   * Remove a single tab from its group in a workspace
   */
  async removeTabFromGroup({ workspaceId, tabId }) {
    if (!workspaceId || !tabId) return { success: false };

    const winId = await windowRegistry.getWindowForWorkspace(workspaceId);
    if (winId !== null && chrome.tabs && chrome.tabs.ungroup) {
      try {
        const liveTabs = await chrome.tabs.query({ windowId: winId });
        const targetTab = liveTabs.find((t) => t.id === tabId || String(t.id) === String(tabId));
        if (targetTab && targetTab.groupId && targetTab.groupId !== (chrome.tabGroups?.TAB_GROUP_ID_NONE ?? -1)) {
          await chrome.tabs.ungroup(targetTab.id);
        }
      } catch (err) {
        console.warn('Live removeTabFromGroup failed:', err);
      }
    }

    const state = await this.getState();
    const ws = state.workspaces[workspaceId];
    if (!ws) return { success: false };

    const tab = (ws.tabs || []).find((t) => t.id === tabId || String(t.id) === String(tabId));
    if (tab) {
      const prevGid = tab.groupId;
      delete tab.groupId;

      // If no more tabs in this group, clean up the group metadata
      if (prevGid && ws.groups) {
        const remainingInGroup = ws.tabs.filter((t) => t.groupId === prevGid || String(t.groupId) === String(prevGid));
        if (remainingInGroup.length === 0) {
          ws.groups = ws.groups.filter((g) => g.id !== prevGid && String(g.id) !== String(prevGid));
        }
      }

      ws.updatedAt = Date.now();
      await this.saveWorkspaces(state.workspaces);
      return { success: true };
    }
    return { success: false };
  },

  /**
   * Ungroup tabs belonging to a group within a workspace
   */
  async ungroupTabs({ workspaceId, groupId }) {
    if (!workspaceId || !groupId) return { success: false };

    const winId = await windowRegistry.getWindowForWorkspace(workspaceId);
    if (winId !== null && chrome.tabs) {
      try {
        const liveTabs = await chrome.tabs.query({ windowId: winId });
        const numGid = typeof groupId === 'number' ? groupId : parseInt(groupId, 10);
        let tabIdsToUngroup = [];
        if (Number.isInteger(numGid) && numGid > 0) {
          tabIdsToUngroup = liveTabs.filter((t) => t.groupId === numGid).map((t) => t.id);
        } else {
          const state = await this.getState();
          const ws = state.workspaces[workspaceId];
          if (ws) {
            const memberIds = new Set((ws.tabs || []).filter((t) => t.groupId === groupId || String(t.groupId) === String(groupId)).map((t) => t.id));
            tabIdsToUngroup = liveTabs.filter((t) => memberIds.has(t.id)).map((t) => t.id);
          }
        }
        if (tabIdsToUngroup.length > 0 && chrome.tabs.ungroup) {
          await chrome.tabs.ungroup(tabIdsToUngroup);
        }
      } catch (err) {
        console.warn('Live ungroupTabs failed:', err);
      }
    }

    const state = await this.getState();
    const ws = state.workspaces[workspaceId];
    if (ws) {
      if (ws.groups) {
        ws.groups = ws.groups.filter((g) => g.id !== groupId && String(g.id) !== String(groupId));
      }
      if (ws.tabs) {
        ws.tabs.forEach((t) => {
          if (t.groupId === groupId || String(t.groupId) === String(groupId)) {
            delete t.groupId;
          }
        });
      }
      ws.updatedAt = Date.now();
      await this.saveWorkspaces(state.workspaces);
      return { success: true };
    }
    return { success: false };
  },

  /**
   * Intelligently organize and cluster tabs into color-coded groups (Edge-style)
   */
  async organizeTabs({ workspaceId, windowId } = {}) {
    let targetWinId = windowId;
    if (!targetWinId && workspaceId) {
      targetWinId = await windowRegistry.getWindowForWorkspace(workspaceId);
    }
    if (!targetWinId) {
      try {
        const lastFocused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        targetWinId = lastFocused ? lastFocused.id : null;
      } catch {}
    }

    const getCategoryForUrl = (urlStr) => {
      try {
        const u = new URL(urlStr);
        const host = u.hostname.toLowerCase().replace(/^www\./, '');

        if (/github\.com|gitlab\.com|stackoverflow\.com|developer\.mozilla\.org|npmjs\.com|localhost|vercel\.app|bitbucket\.org|codepen\.io|replit\.com/.test(host)) {
          return { title: 'Development', color: 'blue' };
        }
        if (/youtube\.com|netflix\.com|spotify\.com|twitch\.tv|soundcloud\.com|vimeo\.com|disneyplus\.com|primevideo\.com|hulu\.com/.test(host)) {
          return { title: 'Media', color: 'red' };
        }
        if (/reddit\.com|twitter\.com|x\.com|instagram\.com|facebook\.com|linkedin\.com|threads\.net|tiktok\.com|discord\.com/.test(host)) {
          return { title: 'Social', color: 'purple' };
        }
        if (/docs\.google\.com|drive\.google\.com|sheets\.google\.com|notion\.so|slack\.com|trello\.com|atlassian\.net|figma\.com|canva\.com|office\.com/.test(host)) {
          return { title: 'Productivity', color: 'green' };
        }
        if (/amazon\.|ebay\.|walmart\.|aliexpress\.|etsy\.|target\.|bestbuy\./.test(host)) {
          return { title: 'Shopping', color: 'yellow' };
        }
        if (/google\.com\/search|bing\.com|chatgpt\.com|openai\.com|claude\.ai|gemini\.google\.com|perplexity\.ai/.test(host + u.pathname)) {
          return { title: 'Search & AI', color: 'cyan' };
        }
        if (/wikipedia\.org|medium\.com|news\.ycombinator\.com|bbc\.com|nytimes\.com|cnn\.com|theverge\.com/.test(host)) {
          return { title: 'News & Reading', color: 'orange' };
        }

        const parts = host.split('.');
        const namePart = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
        const capitalized = namePart.charAt(0).toUpperCase() + namePart.slice(1);
        return { title: capitalized, color: 'blue' };
      } catch {
        return { title: 'Other', color: 'grey' };
      }
    };

    if (targetWinId && chrome.tabs) {
      try {
        const liveTabs = await chrome.tabs.query({ windowId: targetWinId });
        const unpinned = liveTabs.filter((t) => !t.pinned);
        if (unpinned.length >= 2) {
          const clusters = new Map();

          unpinned.forEach((t) => {
            const url = t.url || t.pendingUrl || '';
            if (!url || url.startsWith('chrome://') || url.startsWith('brave://')) return;
            const cat = getCategoryForUrl(url);
            if (!clusters.has(cat.title)) {
              clusters.set(cat.title, { color: cat.color, tabIds: [] });
            }
            clusters.get(cat.title).tabIds.push(t.id);
          });

          let groupsCreated = 0;
          for (const [title, info] of clusters.entries()) {
            if (info.tabIds.length >= 2) {
              const gid = await chrome.tabs.group({ tabIds: info.tabIds, windowId: targetWinId });
              if (chrome.tabGroups) {
                await chrome.tabGroups.update(gid, {
                  title,
                  color: info.color
                });
              }
              groupsCreated++;
            }
          }

          return { success: true, live: true, groupsCreated };
        }
      } catch (err) {
        console.warn('workspaceManager.organizeTabs live error:', err);
      }
    }

    if (workspaceId) {
      const state = await this.getState();
      const ws = state.workspaces[workspaceId];
      if (ws && ws.tabs && ws.tabs.length >= 2) {
        const clusters = new Map();
        ws.tabs.forEach((t) => {
          if (t.pinned) return;
          const cat = getCategoryForUrl(t.url || '');
          if (!clusters.has(cat.title)) {
            clusters.set(cat.title, { color: cat.color, tabs: [] });
          }
          clusters.get(cat.title).tabs.push(t);
        });

        const newGroups = [];
        for (const [title, info] of clusters.entries()) {
          if (info.tabs.length >= 2) {
            const gid = generateId('g');
            newGroups.push({
              id: gid,
              title,
              color: info.color,
              collapsed: false
            });
            info.tabs.forEach((t) => {
              t.groupId = gid;
            });
          }
        }

        ws.groups = newGroups;
        ws.updatedAt = Date.now();
        await this.saveWorkspaces(state.workspaces);
        return { success: true, live: false, groupsCreated: newGroups.length };
      }
    }

    return { success: false, reason: 'no_tabs' };
  }
};

